"use server";

/**
 * The modules that sit on the ledger: personal expenses, StateLife, and
 * Mahziyar marketing income.
 *
 * **None of them moves money.** Each records an obligation or an earning and
 * leaves the movement to `payFromAccounts` in `actions/ledger`, so there is one
 * path into the ledger and one place the "where are we paying this from?"
 * rules live. A module that wrote its own transaction would be the second
 * source of truth this rebuild exists to remove.
 *
 * Office expenses are not here: they already had a module (`actions/officeExpenses`)
 * with categories, receipts and approvals, and it keeps its records and its
 * history. All it needed was to be paid through the same call as everything
 * else.
 */

import { assertMonthOpen } from "@/lib/groupMonthGuard";
import { adminDb } from "@/lib/firebase/server";
import { verifyAuth, requireAdmin, type DecodedAuth } from "@/lib/firebase/serverAuth";
import { runAction, UserFacingError, type ActionResult } from "@/lib/actionResult";
import { karachiDayKey } from "@/lib/dates";
import { money } from "@/lib/ledger";
import { formatMoney } from "@/lib/money";
import {
  stateLifeCommission,
  stateLifeSlabs,
  slabMeta,
  normalizeRates,
  STATELIFE_SLABS,
  type StateLifeRates,
  type StateLifeSlab,
} from "@/lib/stateLife";
import { PERSONAL_EXPENSE_CATEGORIES } from "@/lib/personalExpenses";
import { calculateMarketingSplit, type MarketingCut } from "@/lib/marketingIncome";
import { FieldValue } from "firebase-admin/firestore";

const PERSONAL = "personalExpenses";
/** The ledger owns this collection; named here only to restore a balance. */
const ACCOUNTS_FOR_RESTORE = "accounts";
const PERSONAL_CATEGORY_DOC = "personalExpenseCategories";
const TRANSACTIONS_FOR_SLABS = "transactions";
const STATELIFE_RATES_DOC = "stateLifeRates";
const STATELIFE = "stateLifePolicies";
const MARKETING = "marketingIncome";

async function requireFinance(token: string): Promise<DecodedAuth> {
  const auth = await verifyAuth(token);
  if (!auth.isHr) throw new UserFacingError("Only an administrator or HR can do this.");
  return auth;
}

const dayOrToday = (raw?: string) =>
  raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : karachiDayKey();

/* -------------------------------------------------------------------------- */
/* Personal expense categories                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The categories the personal expense form offers.
 *
 * Same shape as the office expense list and deliberately **a separate list**:
 * "Rent" and "Utilities" are things the company pays and have no business in a
 * dropdown of what somebody spent out of their own pocket, and mixing them
 * would make both lists longer and less useful.
 *
 * **Read by anybody, edited by the admin or HR.** Everybody files their own
 * expenses, so everybody needs the list to fill the form in; but the list is
 * shared company configuration, and one person renaming a category renames it
 * on everybody's records.
 */
export async function getPersonalExpenseCategories(
  token: string
): Promise<ActionResult<{ categories: string[]; custom: string[] }>> {
  return runAction("getPersonalExpenseCategories", async () => {
    await verifyAuth(token);

    const snap = await adminDb.collection("config").doc(PERSONAL_CATEGORY_DOC).get();
    const custom = ((snap.data()?.categories ?? []) as unknown[])
      .map((value) => String(value).trim())
      .filter(Boolean);

    // Deduplicated, so somebody adding a name that is already built in is a
    // no-op rather than a second entry in every dropdown.
    return {
      categories: [...new Set([...PERSONAL_EXPENSE_CATEGORIES, ...custom])],
      custom,
    };
  });
}

/**
 * Adds, renames or removes a personal expense category.
 *
 * **Renaming rewrites the records that use it**, in batches — leaving old ones
 * pointing at a name that no longer exists would split one category into two
 * everywhere it is counted, which is worse than the write cost. **Removing does
 * not**: it takes the name out of the dropdown and leaves the history alone,
 * because rewriting records to tidy a list is not a trade worth making.
 *
 * The built-in names cannot be renamed or removed, only added to. They are what
 * existing records are written against, and letting them be edited from a
 * settings dialog would rewrite history from the wrong place.
 */
export async function managePersonalExpenseCategory(
  token: string,
  action: "ADD" | "RENAME" | "REMOVE",
  name: string,
  renameTo?: string
): Promise<ActionResult<{ categories: string[]; custom: string[]; moved?: number }>> {
  return runAction("managePersonalExpenseCategory", async () => {
    const auth = await requireFinance(token);
    const ref = adminDb.collection("config").doc(PERSONAL_CATEGORY_DOC);

    const snap = await ref.get();
    const custom = ((snap.data()?.categories ?? []) as unknown[])
      .map((value) => String(value).trim())
      .filter(Boolean);

    const label = name.trim();
    if (!label) throw new UserFacingError("Give the category a name.");
    if (label.length > 40) throw new UserFacingError("That name is too long for a category.");

    let next = custom;
    let moved: number | undefined;

    if (action === "ADD") {
      const known = new Set<string>([...PERSONAL_EXPENSE_CATEGORIES, ...custom]);
      if (known.has(label)) throw new UserFacingError(`"${label}" is already a category.`);
      next = [...custom, label];
    } else if (action === "REMOVE") {
      next = custom.filter((entry) => entry !== label);
      if (next.length === custom.length) {
        throw new UserFacingError("Only categories you added can be removed.");
      }
    } else {
      const target = (renameTo ?? "").trim();
      if (!target) throw new UserFacingError("Give the category its new name.");
      if (!custom.includes(label)) {
        throw new UserFacingError("Only categories you added can be renamed.");
      }
      next = custom.map((entry) => (entry === label ? target : entry));

      const affected = await adminDb.collection(PERSONAL).where("category", "==", label).get();
      moved = affected.size;
      for (let index = 0; index < affected.docs.length; index += 400) {
        const batch = adminDb.batch();
        for (const doc of affected.docs.slice(index, index + 400)) {
          batch.update(doc.ref, { category: target });
        }
        await batch.commit();
      }
    }

    await ref.set(
      { categories: next, updatedAt: FieldValue.serverTimestamp(), updatedByUid: auth.uid },
      { merge: true }
    );

    return {
      categories: [...new Set([...PERSONAL_EXPENSE_CATEGORIES, ...next])],
      custom: next,
      moved,
    };
  });
}

/* -------------------------------------------------------------------------- */
/* Personal expenses — one person's own spending                               */
/* -------------------------------------------------------------------------- */

/**
 * What somebody spent out of their own pocket, and which account paid it back.
 *
 * **No approval, and no second person.** This was a reimbursement workflow —
 * submit, approve, reject, cancel, with a claimant chosen from the roster and a
 * manager to decide it — and the owner removed all of it: *"remove employees
 * and manager, it should be personal expense only."* So there is no `status`
 * written any more and no `employeeUid` to choose: the record belongs to
 * whoever filed it, and the only question left about it is how much of it an
 * account has paid back.
 *
 * **`employeeUid` is still stamped, and must be** — it is the clause the
 * Security Rule checks (`where('employeeUid','==',uid)`), so a record without
 * it would be unreadable by the person who owns it. It is taken from the token
 * and can no longer be sent in.
 */
export interface PersonalExpenseInput {
  title: string;
  category: string;
  amount: number;
  dayKey?: string;
  vendor?: string | null;
  purpose?: string | null;
  notes?: string | null;
  receiptUrl?: string | null;
  receiptName?: string | null;
}

export async function savePersonalExpense(
  token: string,
  input: PersonalExpenseInput,
  expenseId?: string
): Promise<ActionResult<{ expenseId: string }>> {
  return runAction("savePersonalExpense", async () => {
    const auth = await verifyAuth(token);

    const title = (input.title ?? "").trim();
    if (!title) throw new UserFacingError("Say what the expense was for.");
    const amount = money(input.amount);
    if (amount <= 0) throw new UserFacingError("Enter an amount greater than zero.");

    const payload = {
      title,
      category: (input.category ?? "Other").trim() || "Other",
      amount,
      dayKey: dayOrToday(input.dayKey),
      vendor: (input.vendor ?? "").trim() || null,
      purpose: (input.purpose ?? "").trim() || null,
      notes: (input.notes ?? "").trim() || null,
      receiptUrl: input.receiptUrl ?? null,
      receiptName: input.receiptName ?? null,
      updatedAt: FieldValue.serverTimestamp(),
    };

    if (expenseId) {
      const ref = adminDb.collection(PERSONAL).doc(expenseId);
      const snap = await ref.get();
      if (!snap.exists) throw new UserFacingError("That expense no longer exists.");
      const current = snap.data()!;
      if (current.employeeUid !== auth.uid && !auth.isHr) {
        throw new UserFacingError("That is not your expense.");
      }
      await assertMonthOpen(current.dayKey as string | undefined, payload.dayKey);

      /*
        **The amount may not fall below what an account has already paid back.**
        The transactions funding it are real money movements and are not
        rewritten by editing the record, so a smaller amount would leave one
        insisting it was over-paid. Everything else about it stays editable,
        including after it has been paid — correcting a category or a date on a
        settled expense is ordinary, not an audit event.
      */
      const paidSoFar = money(current.paidAmount);
      if (paidSoFar > 0 && amount < paidSoFar) {
        throw new UserFacingError(
          `${formatMoney(paidSoFar)} has already been paid back for this. Reduce or delete that payment first.`
        );
      }

      await ref.update({
        ...payload,
        history: FieldValue.arrayUnion({
          at: new Date().toISOString(),
          action: "EDITED",
          byUid: auth.uid,
          byName: auth.name ?? auth.email ?? null,
        }),
      });
      return { expenseId };
    }

    const profile = await adminDb.collection("users").doc(auth.uid).get();
    await assertMonthOpen(payload.dayKey);
    const ref = adminDb.collection(PERSONAL).doc();
    await ref.create({
      ...payload,
      // The Security Rule's clause. Taken from the token, never from the input.
      employeeUid: auth.uid,
      employeeName: (profile.data()?.name as string) ?? auth.name ?? null,
      subAdminUid: (profile.data()?.subAdminUid as string) ?? null,
      paidAmount: 0,
      paymentStatus: "UNPAID",
      createdByUid: auth.uid,
      createdAt: FieldValue.serverTimestamp(),
      history: [
        {
          at: new Date().toISOString(),
          action: "CREATED",
          byUid: auth.uid,
          byName: auth.name ?? auth.email ?? null,
        },
      ],
    });
    return { expenseId: ref.id };
  });
}

/**
 * Deletes a personal expense **and the payments made against it**.
 *
 * A plain delete would leave the ledger holding transactions whose `sourceId`
 * points at nothing — money recorded as having left an account for a record
 * that no longer exists. So the movements go with it and each account's cached
 * balance is put back, which is what deleting the expense actually means.
 *
 * That is destructive and irreversible, so the action **reports what it will
 * cost before it is called** (`countPersonalExpensePayments`) and the screen
 * names the figure in the confirmation rather than afterwards.
 *
 * Yours to delete, or HR's. The balances are restored outside the batch: a
 * stale cache is a display problem that `balancesFor` recomputes from the
 * transactions anyway, and failing there must not leave the delete half done.
 */
export async function deletePersonalExpense(
  token: string,
  expenseId: string
): Promise<ActionResult<{ removedPayments: number; restored: number }>> {
  return runAction("deletePersonalExpense", async () => {
    const auth = await verifyAuth(token);

    const ref = adminDb.collection(PERSONAL).doc(expenseId);
    const snap = await ref.get();
    if (!snap.exists) throw new UserFacingError("That expense no longer exists.");
    if (snap.data()!.employeeUid !== auth.uid && !auth.isHr) {
      throw new UserFacingError("That is not your expense.");
    }
    await assertMonthOpen(snap.data()!.dayKey as string | undefined);

    const legs = await adminDb
      .collection("transactions")
      .where("sourceModule", "==", "PERSONAL_EXPENSE")
      .where("sourceId", "==", expenseId)
      .get();

    const restore = new Map<string, number>();
    const batch = adminDb.batch();
    for (const leg of legs.docs) {
      const row = leg.data();
      const accountId = row.accountId as string;
      const amount = money(row.amount);
      // An OUT leg took money away, so undoing it puts money back.
      const delta = row.direction === "OUT" ? amount : -amount;
      restore.set(accountId, (restore.get(accountId) ?? 0) + delta);
      batch.delete(leg.ref);
    }
    batch.delete(ref);
    await batch.commit();

    await Promise.all(
      [...restore].map(([accountId, delta]) =>
        adminDb.collection(ACCOUNTS_FOR_RESTORE).doc(accountId).update({
          cachedBalance: FieldValue.increment(Math.round(delta * 100) / 100),
        })
      )
    );

    return {
      removedPayments: legs.size,
      restored: Math.round([...restore.values()].reduce((sum, value) => sum + value, 0) * 100) / 100,
    };
  });
}

/** What deleting this expense would also delete. Read before the confirmation. */
export async function countPersonalExpensePayments(
  token: string,
  expenseId: string
): Promise<ActionResult<{ payments: number; total: number }>> {
  return runAction("countPersonalExpensePayments", async () => {
    await verifyAuth(token);
    const legs = await adminDb
      .collection("transactions")
      .where("sourceModule", "==", "PERSONAL_EXPENSE")
      .where("sourceId", "==", expenseId)
      .get();
    return {
      payments: legs.size,
      total: legs.docs.reduce((sum, leg) => sum + money(leg.data().amount), 0),
    };
  });
}

/* -------------------------------------------------------------------------- */
/* StateLife                                                                   */
/* -------------------------------------------------------------------------- */

export interface StateLifeInputRow {
  proposalNo: string;
  name: string;
  fyp: number;
  pass: number;
  srCode?: string | null;
  dayKey?: string;
  paidAmount?: number;
  paidDayKey?: string | null;
  policyNumber?: string | null;
  description?: string | null;
  srName?: string | null;
  discount?: number;
  incomeNote?: string | null;
  /** Per-policy override. Absent means the business default at creation. */
  rates?: Partial<StateLifeRates> | null;
}

/**
 * One policy row.
 *
 * **The commissions are computed here, never accepted from the client** — the
 * same rule the deal entry follows. `lib/stateLife` holds the arithmetic,
 * transcribed from the workbook, and stores the derived columns alongside the
 * typed ones so the table and its totals need no recomputation to draw.
 */
/**
 * The commission rates new policies start from.
 *
 * **These are defaults, not the truth about any policy.** Each policy stores
 * the rates it was written under; changing these changes what the *next* one
 * starts at and nothing that already exists. That separation is the whole
 * safety of making them editable — otherwise correcting a rate in September
 * would silently restate every commission earned since January, including ones
 * already banked.
 */
export async function getStateLifeRates(
  token: string
): Promise<ActionResult<{ rates: StateLifeRates; isDefault: boolean }>> {
  return runAction("getStateLifeRates", async () => {
    await requireFinance(token);
    const snap = await adminDb.collection("config").doc(STATELIFE_RATES_DOC).get();
    return {
      rates: normalizeRates(snap.data()?.rates),
      isDefault: !snap.exists,
    };
  });
}

export async function setStateLifeRates(
  token: string,
  rates: Partial<StateLifeRates>
): Promise<ActionResult<{ rates: StateLifeRates }>> {
  return runAction("setStateLifeRates", async () => {
    const auth = await requireFinance(token);
    const next = normalizeRates(rates);

    if (next.first + next.second + next.quarter + next.december <= 0) {
      throw new UserFacingError("Every rate is zero — a policy written at these would earn nothing.");
    }

    await adminDb.collection("config").doc(STATELIFE_RATES_DOC).set(
      { rates: next, updatedAt: FieldValue.serverTimestamp(), updatedByUid: auth.uid },
      { merge: true }
    );
    return { rates: next };
  });
}

export async function saveStateLifePolicy(
  token: string,
  input: StateLifeInputRow,
  policyId?: string
): Promise<ActionResult<{ policyId: string }>> {
  return runAction("saveStateLifePolicy", async () => {
    const auth = await requireFinance(token);

    const name = (input.name ?? "").trim();
    if (!name) throw new UserFacingError("Enter the policyholder's name.");
    const pass = money(input.pass);
    if (pass <= 0) throw new UserFacingError("Enter the passed amount — every commission is a percentage of it.");

    /*
      **The rates the policy is written under, frozen onto it.** Typed on the
      form when somebody overrides them, otherwise the business default at the
      moment it is created — read once, here, rather than looked up on every
      later render, so a policy's figures never move under it.
    */
    const existing = policyId
      ? (await adminDb.collection(STATELIFE).doc(policyId).get()).data()
      : undefined;
    const rates = input.rates
      ? normalizeRates(input.rates)
      : existing?.rates
        ? normalizeRates(existing.rates)
        : normalizeRates(
            (await adminDb.collection("config").doc(STATELIFE_RATES_DOC).get()).data()?.rates
          );

    const commission = stateLifeCommission(
      { fyp: money(input.fyp), pass, discount: money(input.discount) },
      rates
    );

    const payload = {
      proposalNo: (input.proposalNo ?? "").trim() || null,
      name,
      fyp: money(input.fyp),
      pass,
      srCode: (input.srCode ?? "").trim() || null,
      dayKey: dayOrToday(input.dayKey),
      paidAmount: money(input.paidAmount),
      paidDayKey: input.paidDayKey && /^\d{4}-\d{2}-\d{2}$/.test(input.paidDayKey) ? input.paidDayKey : null,
      policyNumber: (input.policyNumber ?? "").trim() || null,
      description: (input.description ?? "").trim() || null,
      srName: (input.srName ?? "").trim() || null,
      incomeNote: (input.incomeNote ?? "").trim() || null,
      rates,
      ...commission,
      updatedAt: FieldValue.serverTimestamp(),
      updatedByUid: auth.uid,
    };

    if (policyId) {
      const ref = adminDb.collection(STATELIFE).doc(policyId);
      if (!existing) throw new UserFacingError("That policy no longer exists.");

      /*
        **A slab cannot be edited below what has already been banked.** Dropping
        a rate, or raising the discount, after a slab has been received would
        leave the account holding money the policy says it never earned. The
        received figure is what actually arrived and is never rewritten; it is
        the rate that has to give.
      */
      const receipts = (existing.slabReceipts ?? {}) as Record<string, { amount?: number }>;
      const names = slabMeta(rates);
      for (const entry of stateLifeSlabs({ fyp: money(input.fyp), pass, discount: money(input.discount) }, rates)) {
        const received = money(receipts[entry.slab]?.amount);
        if (received > 0 && entry.amount < received) {
          throw new UserFacingError(
            `${formatMoney(received)} has already been received on the ${names[entry.slab].short} slab, and these figures make it ${formatMoney(entry.amount)}. Undo that receipt first.`
          );
        }
      }

      await ref.update(payload);
      return { policyId };
    }

    const ref = adminDb.collection(STATELIFE).doc();
    await ref.create({ ...payload, createdByUid: auth.uid, createdAt: FieldValue.serverTimestamp() });
    return { policyId: ref.id };
  });
}

/**
 * Records that a commission slab has come in, and **puts the money into an
 * account**.
 *
 * This is the whole answer to *"this is an income account — bills can be paid
 * from this income as well"*. StateLife earns money in three slabs months
 * apart; until this action existed, that money was a number on a sheet and
 * nothing could be paid out of it. Now receiving a slab posts an ordinary
 * **IN** transaction to whichever account it landed in, and from that moment an
 * office expense, a personal expense or anything else can be funded from it
 * through the same split control every other module uses — with no line of
 * StateLife-specific code in any of them. Exactly the trick Committee plays.
 *
 * **The guard is a re-read inside the transaction**, not a check in the
 * browser: two people marking the same slab received at once, or one person
 * double-clicking, and only the first commits. `payFromAccounts` prevents
 * double payment the same way, and for the same reason — whatever the screen
 * believed when it submitted, this is the current state.
 *
 * A slab worth nothing or less cannot be received. Row 15 of the workbook is
 * −2,592, where the discount exceeded the commission: StateLife does not owe
 * that policy money, so there is nothing to bank.
 */
export async function receiveStateLifeSlab(
  token: string,
  policyId: string,
  slab: StateLifeSlab,
  accountId: string,
  input?: { amount?: number; dayKey?: string; note?: string | null }
): Promise<ActionResult<{ amount: number; transactionId: string }>> {
  return runAction("receiveStateLifeSlab", async () => {
    const auth = await requireFinance(token);

    if (!(STATELIFE_SLABS as readonly string[]).includes(slab)) {
      throw new UserFacingError("That is not a commission slab.");
    }

    const policyRef = adminDb.collection(STATELIFE).doc(policyId);
    const accountRef = adminDb.collection(ACCOUNTS_FOR_RESTORE).doc(accountId);
    const txnRef = adminDb.collection(TRANSACTIONS_FOR_SLABS).doc();
    const dayKey = dayOrToday(input?.dayKey);

    const amount = await adminDb.runTransaction(async (t) => {
      const [policySnap, accountSnap] = await Promise.all([t.get(policyRef), t.get(accountRef)]);
      if (!policySnap.exists) throw new UserFacingError("That policy no longer exists.");
      if (!accountSnap.exists) throw new UserFacingError("That account no longer exists.");
      if (accountSnap.data()?.status === "ARCHIVED") {
        throw new UserFacingError(`${accountSnap.data()?.name ?? "That account"} is archived.`);
      }

      const policy = policySnap.data()!;
      // **The policy's own rates**, not today's defaults: a slab is worth what
      // the policy was written at, and renaming it "40%" when the book moved to
      // 35% would put a wrong figure in the account's statement for ever.
      const names = slabMeta(policy.rates);
      const receipts = (policy.slabReceipts ?? {}) as Record<string, unknown>;
      if (receipts[slab]) {
        throw new UserFacingError(
          `The ${names[slab].short} slab is already recorded as received.`
        );
      }

      const due = stateLifeSlabs(
        { fyp: money(policy.fyp), pass: money(policy.pass), discount: money(policy.discount) },
        policy.rates
      ).find((entry) => entry.slab === slab)!.amount;

      if (due <= 0) {
        throw new UserFacingError(
          `There is nothing to receive on the ${names[slab].short} slab — the discount used it up.`
        );
      }

      // Typing a figure is allowed because the sheet's own notes record part
      // payments ("5K PENDING", "22K PENDING"). More than the slab is not.
      const received = input?.amount === undefined ? due : money(input.amount);
      if (received <= 0) throw new UserFacingError("Enter an amount greater than zero.");
      if (received > due) {
        throw new UserFacingError(
          `The ${names[slab].short} slab is ${formatMoney(due)}. You cannot receive more than that.`
        );
      }

      t.create(txnRef, {
        accountId,
        direction: "IN",
        amount: received,
        type: "INCOME",
        dayKey,
        sourceModule: "STATELIFE",
        sourceId: policyId,
        sourceLabel: `StateLife ${names[slab].short} — ${policy.name ?? "policy"}`,
        groupId: null,
        status: "POSTED",
        note: input?.note?.trim() || null,
        // The slab is in the key, or a policy's second slab would collide with
        // its first: the standard `module:source:account` shape assumes one
        // movement per record per account and a policy has three.
        idempotencyKey: `STATELIFE:${policyId}:${slab}:${accountId}`,
        createdByUid: auth.uid,
        createdByName: auth.name ?? auth.email ?? null,
        createdAt: FieldValue.serverTimestamp(),
      });

      t.update(policyRef, {
        [`slabReceipts.${slab}`]: {
          amount: received,
          dayKey,
          accountId,
          accountName: (accountSnap.data()?.name as string) ?? null,
          transactionId: txnRef.id,
        },
        history: FieldValue.arrayUnion({
          at: new Date().toISOString(),
          action: "SLAB_RECEIVED",
          byUid: auth.uid,
          byName: auth.name ?? auth.email ?? null,
          amount: received,
          detail: `${names[slab].short} into ${accountSnap.data()?.name ?? "an account"}`,
        }),
        updatedAt: FieldValue.serverTimestamp(),
      });

      return received;
    });

    // Read-free, and outside the transaction: a stale cache is a display
    // problem `balancesFor` recomputes anyway, and it must never fail the write.
    await accountRef.update({
      cachedBalance: FieldValue.increment(Math.round(amount * 100) / 100),
    });

    return { amount, transactionId: txnRef.id };
  });
}

/**
 * Undoes a received slab — the money goes back out of the account with it.
 *
 * The right answer when a slab was marked received in error or against the
 * wrong account. There is no "reverse it first" gate: the movement and the
 * record of it are one fact, so removing one removes the other.
 */
export async function unreceiveStateLifeSlab(
  token: string,
  policyId: string,
  slab: StateLifeSlab
): Promise<ActionResult<{ removed: number }>> {
  return runAction("unreceiveStateLifeSlab", async () => {
    await requireFinance(token);

    const ref = adminDb.collection(STATELIFE).doc(policyId);
    const snap = await ref.get();
    if (!snap.exists) throw new UserFacingError("That policy no longer exists.");

    const receipt = ((snap.data()?.slabReceipts ?? {}) as Record<string, { amount?: number; accountId?: string; transactionId?: string }>)[slab];
    if (!receipt) throw new UserFacingError("That slab has not been received.");

    const amount = money(receipt.amount);

    // The transaction is found by its idempotency key rather than by the id
    // stored on the policy, so a row written before the id was recorded — or
    // one re-created by a retry — is still found and still removed.
    const legs = await adminDb
      .collection(TRANSACTIONS_FOR_SLABS)
      .where("idempotencyKey", "==", `STATELIFE:${policyId}:${slab}:${receipt.accountId}`)
      .get();
    await Promise.all(legs.docs.map((doc) => doc.ref.delete()));

    await ref.update({
      [`slabReceipts.${slab}`]: FieldValue.delete(),
      history: FieldValue.arrayUnion({
        at: new Date().toISOString(),
        action: "SLAB_UNRECEIVED",
        amount,
        detail: `${slabMeta(snap.data()?.rates)[slab].short} removed`,
      }),
      updatedAt: FieldValue.serverTimestamp(),
    });

    if (receipt.accountId && amount > 0) {
      await adminDb.collection(ACCOUNTS_FOR_RESTORE).doc(receipt.accountId).update({
        cachedBalance: FieldValue.increment(-Math.round(amount * 100) / 100),
      });
    }

    return { removed: amount };
  });
}

/**
 * Deletes a policy, and the slab receipts go with it.
 *
 * Same rule the personal expense delete follows: leaving transactions pointing
 * at a record that no longer exists would show money arriving in an account for
 * nothing. The movements are removed and the balances put back.
 */
export async function deleteStateLifePolicy(token: string, policyId: string): Promise<ActionResult> {
  return runAction("deleteStateLifePolicy", async () => {
    await requireAdmin(token);

    const legs = await adminDb
      .collection(TRANSACTIONS_FOR_SLABS)
      .where("sourceModule", "==", "STATELIFE")
      .where("sourceId", "==", policyId)
      .get();

    const restore = new Map<string, number>();
    const batch = adminDb.batch();
    for (const leg of legs.docs) {
      const row = leg.data();
      const accountId = row.accountId as string;
      // An IN leg brought money in, so undoing it takes the money back out.
      const delta = row.direction === "IN" ? -money(row.amount) : money(row.amount);
      restore.set(accountId, (restore.get(accountId) ?? 0) + delta);
      batch.delete(leg.ref);
    }
    batch.delete(adminDb.collection(STATELIFE).doc(policyId));
    await batch.commit();

    await Promise.all(
      [...restore].map(([accountId, delta]) =>
        adminDb.collection(ACCOUNTS_FOR_RESTORE).doc(accountId).update({
          cachedBalance: FieldValue.increment(Math.round(delta * 100) / 100),
        })
      )
    );
  });
}

/* -------------------------------------------------------------------------- */
/* Mahziyar marketing income                                                   */
/* -------------------------------------------------------------------------- */

/* -------------------------------------------------------------------------- */
/* The marketing account                                                        */
/* -------------------------------------------------------------------------- */

/**
 * **Mahziyar Marketing is an account**, and that is the whole of the owner's
 * *"there shouldn't be an option to add receive balance"*.
 *
 * There used to be two steps: record a sale, then separately receive it into an
 * account before anything could be paid from it. Two steps for one fact, and
 * the second one existed only because the module had no account of its own. Now
 * the profit lands the moment the sale is recorded, in an account named after
 * the business — so an office expense or a personal one can be paid **from
 * Mahziyar Marketing** through the same split control every module already
 * uses, with no receiving in between.
 *
 * The id is fixed rather than searched for by name: renaming the account on
 * screen must not make the next sale create a second one beside it.
 */
const MARKETING_ACCOUNT_ID = "mahziyar_marketing";

async function ensureMarketingAccount(uid: string): Promise<string> {
  const ref = adminDb.collection(ACCOUNTS_FOR_RESTORE).doc(MARKETING_ACCOUNT_ID);
  const snap = await ref.get();
  if (!snap.exists) {
    await ref.set({
      name: "Mahziyar Marketing",
      kind: "INCOME",
      openingBalance: 0,
      cachedBalance: 0,
      status: "ACTIVE",
      note: "Profit from marketing sales. Expenses can be paid straight out of it.",
      createdByUid: uid,
      createdAt: FieldValue.serverTimestamp(),
    });
  }
  return MARKETING_ACCOUNT_ID;
}

export async function getMarketingAccountId(): Promise<string> {
  return MARKETING_ACCOUNT_ID;
}

/* -------------------------------------------------------------------------- */

export interface MarketingIncomeInput {
  dayKey?: string;
  customerName: string;
  soldByUid?: string | null;
  soldByName?: string | null;
  /**
   * **Who sold it, and therefore which cuts the sale can carry.**
   *
   * A sale is not always an employee's: a manager can close one, and so can the
   * admin. It is stored rather than derived from the uid because the roster
   * changes — an employee promoted to manager next year must not retrospectively
   * turn last year's sale into a manager's.
   */
  soldByRole?: "EMPLOYEE" | "MANAGER" | "ADMIN" | null;
  description?: string | null;
  amountReceived: number;
  /** One row per recipient, as a **percentage**. The company keeps the rest. */
  cuts?: MarketingCut[];
}

/**
 * A marketing sale, its percentage cuts, and the profit it puts in the bank.
 *
 * **Three things changed together at the owner's instruction**, and they only
 * make sense as one shape:
 *
 * 1. **The cuts are percentages with as many recipients as the sale needs** —
 *    two managers, three staff — and the rupees are computed, never typed.
 * 2. **Everything left is the company's.** There is no company percentage: a
 *    typed one could disagree with the arithmetic, and `received − Σ cuts` is
 *    the only figure that always adds up.
 * 3. **The profit is banked here, not received later.** One `IN` transaction to
 *    the Mahziyar Marketing account, labelled with the customer, so the account
 *    statement reads *"Imran Khan — sold lead"* and the money is immediately
 *    spendable.
 *
 * Editing a sale **moves the posted profit by the difference** rather than
 * writing a second transaction, so the account can never hold two versions of
 * one sale.
 */
export async function saveMarketingIncome(
  token: string,
  input: MarketingIncomeInput,
  recordId?: string
): Promise<ActionResult<{ recordId: string; profit: number }>> {
  return runAction("saveMarketingIncome", async () => {
    const auth = await requireFinance(token);

    const customerName = (input.customerName ?? "").trim();
    if (!customerName) throw new UserFacingError("Enter the customer's name.");

    const amountReceived = money(input.amountReceived);
    const split = calculateMarketingSplit(amountReceived, input.cuts ?? []);
    if (!split.valid) throw new UserFacingError(split.errors[0]);

    const accountId = await ensureMarketingAccount(auth.uid);
    const dayKey = dayOrToday(input.dayKey);
    const label = `${customerName} — sold lead`;

    const payload = {
      dayKey,
      customerName,
      soldByUid: input.soldByUid ?? null,
      soldByName: (input.soldByName ?? "").trim() || null,
      soldByRole: input.soldByRole ?? null,
      description: (input.description ?? "").trim() || null,
      amountReceived,
      // Stored **and** recomputed on read — the percentages are the record, the
      // rupees are a convenience for exports and reports.
      cuts: split.lines,
      totalCost: split.totalCost,
      totalPercent: split.totalPercent,
      /** What the business keeps once every cut is paid. */
      netIncome: split.companyKeeps,
      accountId,
      // Named `amount` too, so anything reading obligations generically sees it.
      amount: amountReceived,
      updatedAt: FieldValue.serverTimestamp(),
      updatedByUid: auth.uid,
    };

    const ref = recordId
      ? adminDb.collection(MARKETING).doc(recordId)
      : adminDb.collection(MARKETING).doc();

    const previousProfit = await adminDb.runTransaction(async (t) => {
      const snap = await t.get(ref);
      if (recordId && !snap.exists) throw new UserFacingError("That record no longer exists.");
      const before = snap.exists ? money(snap.data()?.netIncome) : 0;

      t.set(
        ref,
        recordId
          ? {
              ...payload,
              history: FieldValue.arrayUnion({
                at: new Date().toISOString(),
                action: "EDITED",
                byUid: auth.uid,
                byName: auth.name ?? auth.email ?? null,
                amount: split.companyKeeps,
              }),
            }
          : {
              ...payload,
              createdByUid: auth.uid,
              createdAt: FieldValue.serverTimestamp(),
              history: [
                {
                  at: new Date().toISOString(),
                  action: "CREATED",
                  byUid: auth.uid,
                  byName: auth.name ?? auth.email ?? null,
                  amount: split.companyKeeps,
                },
              ],
            },
        { merge: Boolean(recordId) }
      );

      return before;
    });

    /*
      **One transaction per sale, updated in place.** `set` with a deterministic
      id rather than `create`, so editing a sale rewrites the movement it
      already posted instead of leaving the old one beside the new — which is
      how an account ends up holding one sale twice.
    */
    const txnRef = adminDb.collection(TRANSACTIONS_FOR_SLABS).doc(`marketing_${ref.id}`);
    await txnRef.set({
      accountId,
      direction: "IN",
      amount: split.companyKeeps,
      type: "INCOME",
      dayKey,
      sourceModule: "MARKETING_INCOME",
      sourceId: ref.id,
      sourceLabel: label,
      groupId: null,
      status: "POSTED",
      note: input.description?.trim() || null,
      idempotencyKey: `MARKETING_INCOME:${ref.id}:${accountId}`,
      createdByUid: auth.uid,
      createdByName: auth.name ?? auth.email ?? null,
      createdAt: FieldValue.serverTimestamp(),
    });

    // The cache moves by the **difference**, so an edit does not double-count.
    const delta = Math.round((split.companyKeeps - previousProfit) * 100) / 100;
    if (delta !== 0) {
      await adminDb.collection(ACCOUNTS_FOR_RESTORE).doc(accountId).update({
        cachedBalance: FieldValue.increment(delta),
      });
    }

    return { recordId: ref.id, profit: split.companyKeeps };
  });
}

/**
 * Deletes a sale, and takes its profit back out of the account.
 *
 * **Refused once the account has spent below what this sale put in** — deleting
 * would leave the balance short of money that has already gone out on
 * something else, and an account cannot un-spend. The message says how much and
 * what to do instead.
 */
export async function deleteMarketingIncome(
  token: string,
  recordId: string
): Promise<ActionResult<{ reversed: number }>> {
  return runAction("deleteMarketingIncome", async () => {
    await requireAdmin(token);

    const ref = adminDb.collection(MARKETING).doc(recordId);
    const snap = await ref.get();
    if (!snap.exists) throw new UserFacingError("That record no longer exists.");

    const profit = money(snap.data()?.netIncome);
    const accountId = (snap.data()?.accountId as string) ?? MARKETING_ACCOUNT_ID;

    const accountSnap = await adminDb.collection(ACCOUNTS_FOR_RESTORE).doc(accountId).get();
    const balance = money(accountSnap.data()?.cachedBalance);
    if (profit > 0 && balance < profit) {
      throw new UserFacingError(
        `Mahziyar Marketing holds ${formatMoney(balance)}, less than the ${formatMoney(profit)} this sale put in — some of it has already been spent. Remove those payments first, or edit the sale instead of deleting it.`
      );
    }

    const batch = adminDb.batch();
    batch.delete(adminDb.collection(TRANSACTIONS_FOR_SLABS).doc(`marketing_${recordId}`));
    batch.delete(ref);
    await batch.commit();

    if (profit !== 0) {
      await adminDb.collection(ACCOUNTS_FOR_RESTORE).doc(accountId).update({
        cachedBalance: FieldValue.increment(-profit),
      });
    }

    return { reversed: profit };
  });
}

/**
 * What deleting a sale would cost, read before the confirmation.
 *
 * The question changed with the model. It used to be "how many receipts came
 * in"; now the profit is banked automatically, so the only thing worth asking
 * is whether the account can give it back — and if not, by how much it falls
 * short.
 */
export async function countMarketingIncomeReceipts(
  token: string,
  recordId: string
): Promise<ActionResult<{ profit: number; balance: number; shortBy: number }>> {
  return runAction("countMarketingIncomeReceipts", async () => {
    await verifyAuth(token);

    const snap = await adminDb.collection(MARKETING).doc(recordId).get();
    const profit = money(snap.data()?.netIncome);
    const accountId = (snap.data()?.accountId as string) ?? MARKETING_ACCOUNT_ID;
    const balance = money(
      (await adminDb.collection(ACCOUNTS_FOR_RESTORE).doc(accountId).get()).data()?.cachedBalance
    );

    return { profit, balance, shortBy: Math.max(0, Math.round((profit - balance) * 100) / 100) };
  });
}

