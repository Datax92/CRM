"use server";

/**
 * Car Sale — an income account, fed by cars bought with partners and sold on.
 *
 * **Built from the owner's `car sale.xlsx`**, whose fourteen columns are the
 * specification; `lib/carSale` carries the arithmetic and the reasoning, and is
 * unit-tested against every row of that sheet including its totals.
 *
 * What this file adds is the half the sheet cannot do: **the money reaches the
 * ledger.** Each car's net profit is posted to a single `Car Sale` account the
 * moment the car is recorded, exactly as a marketing sale banks its profit — so
 * an office expense, a personal expense, a committee bill or a capital spending
 * can be paid straight **from Car Sale** through the same split control every
 * other module already uses, and the balance falls as it is spent. That is the
 * whole of "interlinked with the other accounts": it is an ordinary account,
 * and being ordinary is what makes every existing screen able to spend from it.
 *
 * Two things are deliberately *not* here:
 *
 * - **Buying a car moves no money.** `MY PAYMENT` is recorded on the record and
 *   touches no account, at the owner's instruction — he adds the money, the app
 *   does not move it.
 * - **There is no "receive" step.** The profit is banked when the car is
 *   entered; two steps for one fact was one step too many on the marketing
 *   module and would be one too many here.
 *
 * **A loss posts as an outflow.** Two cars in the sheet lost money, and the
 * Corolla turned a 35,000 profit into a 4,900 loss once the investor was paid.
 * Amounts on a transaction are always positive and `direction` carries the
 * sign, so a negative net profit is an `OUT` leg of its absolute value — never
 * a negative `IN`, which every balance in the ledger would then have to know to
 * special-case.
 */

import { adminDb } from "@/lib/firebase/server";
import { verifyAuth, requireAdmin, type DecodedAuth } from "@/lib/firebase/serverAuth";
import { runAction, UserFacingError, type ActionResult } from "@/lib/actionResult";
import { karachiDayKey } from "@/lib/dates";
import { money } from "@/lib/ledger";
import { formatMoney } from "@/lib/money";
import {
  calculateCarSale,
  partnershipLabel,
  type CarDeductions,
  type CarPartner,
} from "@/lib/carSale";
import { FieldValue } from "firebase-admin/firestore";

const CAR_SALES = "carSales";
const ACCOUNTS = "accounts";
const TRANSACTIONS = "transactions";

/**
 * The account every car's net profit lands in.
 *
 * Fixed rather than looked up by name: renaming it on screen must not make the
 * next car create a second account beside it. `CarSaleView` writes the same id.
 *
 * **Not exported.** A `"use server"` module may export nothing but async
 * functions — a const gets past typecheck, lint and `next build` and kills the
 * route at runtime with *"found object"*. `getCarSaleAccountId` is the export.
 */
const CAR_SALE_ACCOUNT_ID = "car_sale";

async function requireFinance(token: string): Promise<DecodedAuth> {
  const auth = await verifyAuth(token);
  if (!auth.isHr) throw new UserFacingError("Only an administrator or HR can do this.");
  return auth;
}

const dayOrToday = (raw?: string) =>
  raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : karachiDayKey();

/** Created on first use, so the account exists the moment a car does. */
async function ensureCarSaleAccount(uid: string): Promise<string> {
  const ref = adminDb.collection(ACCOUNTS).doc(CAR_SALE_ACCOUNT_ID);
  const snap = await ref.get();
  if (!snap.exists) {
    await ref.set({
      name: "Car Sale",
      kind: "INCOME",
      openingBalance: 0,
      cachedBalance: 0,
      status: "ACTIVE",
      note: "Net profit from cars bought and sold. Expenses can be paid straight out of it.",
      createdByUid: uid,
      createdAt: FieldValue.serverTimestamp(),
    });
  }
  return CAR_SALE_ACCOUNT_ID;
}

export async function getCarSaleAccountId(): Promise<string> {
  return CAR_SALE_ACCOUNT_ID;
}

export interface CarSaleInput {
  carName: string;
  /** `PURCHASING DATE`. */
  purchaseDayKey?: string | null;
  /** `PURCHASING RATE + COST` — everything the car cost to get. */
  purchaseCost: number;
  /**
   * `MY PAYMENT` — what the owner put in himself.
   *
   * **Recorded, never moved.** It explains the purchase; it is not a movement
   * on any account, at the owner's instruction.
   */
  myPayment?: number;
  /** `SELLING DATE`. Doubles as the record's `dayKey`, since that is when the money arrived. */
  dayKey?: string;
  /** `SALE PRICE`. */
  salePrice: number;
  /** `DESCRIPTION IF ANY` — about the sale itself. */
  saleNote?: string | null;
  /** `PARTNERSHIP STATUS`, as named lines with a share each. */
  partners?: CarPartner[];
  /** `INVESTOR`, `CC CHARGES`, `MISC`. */
  deductions?: Partial<CarDeductions>;
  /** The sheet's last column — where the net profit went. */
  description?: string | null;
}

/**
 * Records a car, and banks what it earned.
 *
 * Editing one **moves the posted profit by the difference** rather than writing
 * a second transaction — a deterministic transaction id (`car_{recordId}`) is
 * what makes that true, and is why an account can never hold one car twice.
 */
export async function saveCarSale(
  token: string,
  input: CarSaleInput,
  recordId?: string
): Promise<ActionResult<{ recordId: string; netProfit: number }>> {
  return runAction("saveCarSale", async () => {
    const auth = await requireFinance(token);

    const carName = (input.carName ?? "").trim();
    if (!carName) throw new UserFacingError("Enter the car's name.");

    const partners = input.partners ?? [];
    const split = calculateCarSale({
      purchaseCost: money(input.purchaseCost),
      salePrice: money(input.salePrice),
      partners,
      deductions: input.deductions,
    });
    if (!split.valid) throw new UserFacingError(split.errors[0]);

    const accountId = await ensureCarSaleAccount(auth.uid);
    const dayKey = dayOrToday(input.dayKey);
    const label = `${carName} — car sold`;

    const payload = {
      dayKey,
      carName,
      purchaseDayKey: input.purchaseDayKey?.trim() || null,
      purchaseCost: split.purchaseCost,
      myPayment: money(input.myPayment),
      salePrice: split.salePrice,
      saleNote: (input.saleNote ?? "").trim() || null,
      // Stored **and** recomputed on read — the typed column is the record, the
      // derived one is a convenience for exports and reports.
      partners: split.lines.map((line) => ({
        name: line.name,
        percent: line.percent,
        amount: line.amount,
        basis: line.basis,
        mine: line.mine,
      })),
      partnership: partnershipLabel(partners),
      totalProfit: split.totalProfit,
      grossProfit: split.grossProfit,
      deductions: split.deductions,
      totalDeductions: split.totalDeductions,
      netProfit: split.netProfit,
      description: (input.description ?? "").trim() || null,
      accountId,
      // Named `amount` too, so anything reading obligations generically sees it.
      amount: split.salePrice,
      updatedAt: FieldValue.serverTimestamp(),
      updatedByUid: auth.uid,
    };

    const ref = recordId
      ? adminDb.collection(CAR_SALES).doc(recordId)
      : adminDb.collection(CAR_SALES).doc();

    const previousNet = await adminDb.runTransaction(async (t) => {
      const snap = await t.get(ref);
      if (recordId && !snap.exists) throw new UserFacingError("That car no longer exists.");
      const before = snap.exists ? money(snap.data()?.netProfit) : 0;

      const entry = {
        at: new Date().toISOString(),
        action: recordId ? "EDITED" : "CREATED",
        byUid: auth.uid,
        byName: auth.name ?? auth.email ?? null,
        amount: split.netProfit,
      };

      t.set(
        ref,
        recordId
          ? { ...payload, history: FieldValue.arrayUnion(entry) }
          : {
              ...payload,
              createdByUid: auth.uid,
              createdAt: FieldValue.serverTimestamp(),
              history: [entry],
            },
        { merge: Boolean(recordId) }
      );

      return before;
    });

    /*
      **One transaction per car, rewritten in place.** `set` with a
      deterministic id rather than `create`, so editing a car replaces the
      movement it already posted instead of leaving the old one beside the new.

      A loss is an `OUT` leg of its absolute value — see the module note.
    */
    await adminDb.collection(TRANSACTIONS).doc(`car_${ref.id}`).set({
      accountId,
      direction: split.netProfit < 0 ? "OUT" : "IN",
      amount: Math.abs(split.netProfit),
      type: split.netProfit < 0 ? "EXPENSE" : "INCOME",
      dayKey,
      sourceModule: "CAR_SALE",
      sourceId: ref.id,
      sourceLabel: split.netProfit < 0 ? `${carName} — car sold at a loss` : label,
      groupId: null,
      status: "POSTED",
      note: input.description?.trim() || input.saleNote?.trim() || null,
      idempotencyKey: `CAR_SALE:${ref.id}:${accountId}`,
      createdByUid: auth.uid,
      createdByName: auth.name ?? auth.email ?? null,
      createdAt: FieldValue.serverTimestamp(),
    });

    // The cache moves by the **difference**, so an edit does not double-count.
    const delta = Math.round((split.netProfit - previousNet) * 100) / 100;
    if (delta !== 0) {
      await adminDb.collection(ACCOUNTS).doc(accountId).update({
        cachedBalance: FieldValue.increment(delta),
      });
    }

    return { recordId: ref.id, netProfit: split.netProfit };
  });
}

/**
 * Deletes a car, and takes its profit back out of the account.
 *
 * **Refused once the account has spent below what this car put in** — deleting
 * would leave the balance short of money that has already gone out on something
 * else, and an account cannot un-spend. A car that *lost* money has nothing to
 * give back, so it is never refused.
 */
export async function deleteCarSale(
  token: string,
  recordId: string
): Promise<ActionResult<{ reversed: number }>> {
  return runAction("deleteCarSale", async () => {
    await requireAdmin(token);

    const ref = adminDb.collection(CAR_SALES).doc(recordId);
    const snap = await ref.get();
    if (!snap.exists) throw new UserFacingError("That car no longer exists.");

    const net = money(snap.data()?.netProfit);
    const carName = (snap.data()?.carName as string) ?? "This car";
    const accountId = (snap.data()?.accountId as string) ?? CAR_SALE_ACCOUNT_ID;

    const balance = money((await adminDb.collection(ACCOUNTS).doc(accountId).get()).data()?.cachedBalance);
    if (net > 0 && balance < net) {
      throw new UserFacingError(
        `Car Sale holds ${formatMoney(balance)}, less than the ${formatMoney(net)} ${carName} put in — some of it has already been spent. Remove those payments first, or edit the car instead of deleting it.`
      );
    }

    const batch = adminDb.batch();
    batch.delete(adminDb.collection(TRANSACTIONS).doc(`car_${recordId}`));
    batch.delete(ref);
    await batch.commit();

    if (net !== 0) {
      await adminDb.collection(ACCOUNTS).doc(accountId).update({
        cachedBalance: FieldValue.increment(-net),
      });
    }

    return { reversed: net };
  });
}

/** What deleting a car would cost, read before the confirmation. */
export async function countCarSaleProfit(
  token: string,
  recordId: string
): Promise<ActionResult<{ netProfit: number; balance: number; shortBy: number }>> {
  return runAction("countCarSaleProfit", async () => {
    await verifyAuth(token);

    const snap = await adminDb.collection(CAR_SALES).doc(recordId).get();
    const netProfit = money(snap.data()?.netProfit);
    const accountId = (snap.data()?.accountId as string) ?? CAR_SALE_ACCOUNT_ID;
    const balance = money(
      (await adminDb.collection(ACCOUNTS).doc(accountId).get()).data()?.cachedBalance
    );

    return { netProfit, balance, shortBy: Math.max(0, Math.round((netProfit - balance) * 100) / 100) };
  });
}
