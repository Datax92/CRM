"use server";

/**
 * Amanat (Trust & Safekeeping) — Server Actions.
 *
 * **Amanat is an account** (`lib/amanatSheet`). Money received on trust is held
 * in one — the Amanat account unless another is chosen — so every "Pay from…"
 * in the CRM can spend out of it, and this file's own job is only the two
 * things that are Amanat's: recording a receipt, and returning or disbursing
 * money against it.
 *
 * Every write here keeps the entry and the ledger in step **in one Firestore
 * transaction**, and moves balances by what is actually posted. It used to
 * write the entry and its ledger row separately, and to delete the entry
 * alone: an entry deleted on 2026-10-03 left its money sitting in the account
 * it had been banked in.
 */

import { adminDb } from "@/lib/firebase/server";
import { verifyAuth, type DecodedAuth } from "@/lib/firebase/serverAuth";
import { runAction, UserFacingError, type ActionResult } from "@/lib/actionResult";
import { karachiDayKey } from "@/lib/dates";
import { allocationsToTransactions, checkAllocations, money } from "@/lib/ledger";
import { FieldValue } from "firebase-admin/firestore";
import {
  AMANAT_ACCOUNT_ID,
  AMANAT_ACCOUNT_NAME,
  planReceiptLeg,
  type AmanatLedgerRow,
  type AmanatType,
} from "@/lib/amanatSheet";

const ENTRIES = "amanatEntries";
const ACCOUNTS = "accounts";
const TRANSACTIONS = "transactions";

async function requireFinance(token: string): Promise<DecodedAuth> {
  const auth = await verifyAuth(token);
  if (!auth.isHr) throw new UserFacingError("Only an administrator or HR can do this.");
  return auth;
}

const dayOrNull = (raw?: string | null) => (raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null);

/** Every ledger row an entry has caused. Two equality filters — no index to deploy. */
const legsOf = (entryId: string) =>
  adminDb.collection(TRANSACTIONS).where("sourceModule", "==", "AMANAT").where("sourceId", "==", entryId);

/**
 * Moves the cached balances after a write has committed.
 *
 * Outside the transaction and never allowed to fail it, as in `actions/ledger`:
 * a stale cache is a display problem (`useLedger` derives the real figure from
 * the transactions), a refused save is a real one.
 */
async function bumpBalances(deltas: Map<string, number>): Promise<void> {
  await Promise.all(
    [...deltas].map(([accountId, delta]) =>
      !Number.isFinite(delta) || delta === 0
        ? Promise.resolve()
        : adminDb
            .collection(ACCOUNTS)
            .doc(accountId)
            .update({ cachedBalance: FieldValue.increment(Math.round(delta * 100) / 100) })
            .catch(() => undefined)
    )
  );
}

export interface AmanatEntryInput {
  type: AmanatType;
  party: string;
  title?: string | null;
  amount: number;
  dayKey?: string | null;
  purpose?: string | null;
  notes?: string | null;
  /**
   * For a receipt: the account holding the money. `AMANAT_ACCOUNT_ID` is the
   * Amanat account, made here if it does not exist yet. Empty means it is held
   * outside the accounts, and so cannot be paid from.
   */
  depositAccountId?: string | null;
}

export async function saveAmanatEntry(
  token: string,
  input: AmanatEntryInput,
  entryId?: string
): Promise<ActionResult<{ id: string; name: string }>> {
  return runAction("saveAmanatEntry", async () => {
    const auth = await requireFinance(token);
    const party = (input.party ?? "").trim();
    if (!party) throw new UserFacingError("Party / person name is required.");

    const amount = money(input.amount);
    if (amount <= 0) throw new UserFacingError("Amount must be greater than zero.");

    const dayKey = dayOrNull(input.dayKey) ?? karachiDayKey();
    const purpose = (input.purpose ?? "").trim() || null;
    const notes = (input.notes ?? "").trim() || null;
    const wantedAccountId = (input.depositAccountId ?? "").trim() || null;
    const byName = auth.name ?? auth.email ?? null;

    const ref = entryId ? adminDb.collection(ENTRIES).doc(entryId) : adminDb.collection(ENTRIES).doc();

    const deltas = await adminDb.runTransaction(async (t) => {
      const existingSnap = entryId ? await t.get(ref) : null;
      const existing = existingSnap?.exists ? existingSnap.data()! : null;
      if (entryId && !existing) throw new UserFacingError("That Amanat entry no longer exists.");

      // What an entry *is* does not change on edit: a receipt turned into an
      // expense would leave its money in an account with nothing to explain it.
      const type: AmanatType = existing
        ? existing.type === "EXPENSE" ? "EXPENSE" : "RECEIVED"
        : input.type === "EXPENSE" ? "EXPENSE" : "RECEIVED";
      const title = (input.title ?? "").trim() || (type === "RECEIVED" ? "Amanat Received" : "Amanat Expense");
      const paidAmount = type === "EXPENSE" ? money(existing?.paidAmount) : 0;
      if (type === "EXPENSE" && amount < paidAmount) {
        throw new UserFacingError(
          `Rs ${paidAmount.toLocaleString("en-PK")} has already been paid on this. The amount cannot go below it.`
        );
      }

      const payload: Record<string, unknown> = {
        type,
        party,
        title,
        amount,
        paidAmount,
        dayKey,
        purpose,
        notes,
        updatedAt: FieldValue.serverTimestamp(),
        updatedByUid: auth.uid,
      };
      if (!existing) {
        payload.history = [];
        payload.createdAt = FieldValue.serverTimestamp();
        payload.createdByUid = auth.uid;
        payload.createdByName = byName;
      }

      let moved = new Map<string, number>();

      if (type === "RECEIVED") {
        const accountId = wantedAccountId;
        const legsSnap = existing ? await t.get(legsOf(ref.id)) : null;
        const accountSnap = accountId ? await t.get(adminDb.collection(ACCOUNTS).doc(accountId)) : null;

        let accountName: string | null = null;
        if (accountId && accountSnap) {
          if (accountSnap.exists) {
            if (accountSnap.data()?.status === "ARCHIVED") {
              throw new UserFacingError(`${accountSnap.data()?.name ?? "That account"} is archived and cannot hold new money.`);
            }
            accountName = String(accountSnap.data()?.name ?? "").trim() || null;
          } else if (accountId === AMANAT_ACCOUNT_ID) {
            // The Amanat account, on the first receipt. Nothing opens it with:
            // every rupee in it is a receipt on the statement.
            accountName = AMANAT_ACCOUNT_NAME;
            t.create(accountSnap.ref, {
              name: AMANAT_ACCOUNT_NAME,
              kind: "AMANAT",
              openingBalance: 0,
              startedOn: dayKey,
              note: "Money held on trust. Anything paid from it shows on the Amanat screen.",
              status: "ACTIVE",
              cachedBalance: 0,
              createdByUid: auth.uid,
              createdAt: FieldValue.serverTimestamp(),
            });
          } else {
            throw new UserFacingError("That account no longer exists.");
          }
        }

        const posted = (legsSnap?.docs ?? []).map((doc) => ({ id: doc.id, ...doc.data() }) as AmanatLedgerRow);
        const plan = planReceiptLeg(ref.id, posted, { accountId, amount });
        moved = plan.deltas;

        for (const id of plan.removeIds) t.delete(adminDb.collection(TRANSACTIONS).doc(id));
        if (plan.write) {
          const current = legsSnap?.docs.find((doc) => doc.id === plan.write!.id)?.data();
          t.set(adminDb.collection(TRANSACTIONS).doc(plan.write.id), {
            accountId: plan.write.accountId,
            direction: "IN",
            amount: plan.write.amount,
            // Held on trust: neither income nor spending, so no rollup counts it.
            type: "LOAN",
            dayKey,
            sourceModule: "AMANAT",
            sourceId: ref.id,
            sourceLabel: `Amanat received — ${party}`,
            groupId: null,
            status: "POSTED",
            note: purpose ?? notes ?? null,
            createdByUid: current?.createdByUid ?? auth.uid,
            createdByName: current?.createdByName ?? byName,
            createdAt: current?.createdAt ?? FieldValue.serverTimestamp(),
          });
        }

        payload.depositAccountId = accountId;
        payload.depositAccountName = accountName;
      } else {
        payload.depositAccountId = null;
        payload.depositAccountName = null;
      }

      t.set(ref, payload, { merge: true });
      return moved;
    });

    await bumpBalances(deltas);
    return { id: ref.id, name: `${party}` };
  });
}

export async function payAmanatExpenseThroughAccounts(
  token: string,
  entryId: string,
  input: {
    allocations: Array<{ accountId: string; amount: number }>;
    dayKey?: string | null;
    note?: string | null;
  }
): Promise<ActionResult<{ paidAmount: number; pending: number; posted: number; fullyPaid: boolean }>> {
  return runAction("payAmanatExpenseThroughAccounts", async () => {
    const auth = await requireFinance(token);
    const allocations = (input.allocations ?? [])
      .map((line) => ({ accountId: (line.accountId ?? "").trim(), amount: money(line.amount) }))
      .filter((line) => line.accountId);
    if (allocations.length === 0) throw new UserFacingError("Choose at least one account.");

    const dayKey = dayOrNull(input.dayKey) ?? karachiDayKey();
    const note = (input.note ?? "").trim() || null;
    const groupId = adminDb.collection(TRANSACTIONS).doc().id;
    const ref = adminDb.collection(ENTRIES).doc(entryId);

    const result = await adminDb.runTransaction(async (t) => {
      const snap = await t.get(ref);
      if (!snap.exists) throw new UserFacingError("That Amanat entry no longer exists.");
      const data = snap.data()!;
      if (data.type !== "EXPENSE") throw new UserFacingError("Only Amanat expenses can be paid out.");

      const owed = money(data.amount);
      const beforePaid = money(data.paidAmount);

      const check = checkAllocations(owed, allocations, beforePaid);
      if (!check.valid) throw new UserFacingError(check.errors[0]);

      const accountSnaps = await Promise.all(
        allocations.map((a) => t.get(adminDb.collection(ACCOUNTS).doc(a.accountId)))
      );
      const accountNameMap = new Map<string, string>();
      for (const account of accountSnaps) {
        if (!account.exists) throw new UserFacingError("One of those accounts no longer exists.");
        if (account.data()?.status === "ARCHIVED") {
          throw new UserFacingError(`${account.data()?.name ?? "That account"} is archived and cannot be used.`);
        }
        accountNameMap.set(account.id, String(account.data()?.name ?? "Account"));
      }

      const party = String(data.party ?? "").trim() || "Amanat";
      const title = String(data.title ?? "").trim() || "Expense";
      const legs = allocationsToTransactions({
        allocations,
        direction: "OUT",
        type: "EXPENSE",
        dayKey,
        sourceModule: "AMANAT",
        sourceId: entryId,
        sourceLabel: `Amanat: ${title} (${party})`,
        groupId,
        createdByUid: auth.uid,
        note,
      });

      for (const leg of legs) {
        const { idempotencyKey, ...row } = leg;
        t.create(adminDb.collection(TRANSACTIONS).doc(), {
          ...row,
          idempotencyKey,
          createdByName: auth.name ?? auth.email ?? null,
          createdAt: FieldValue.serverTimestamp(),
        });
      }

      const nowIso = new Date().toISOString();
      const historyLegs = allocations.map((a) => ({
        amount: a.amount,
        accountId: a.accountId,
        accountName: accountNameMap.get(a.accountId),
        dayKey,
        note,
        at: nowIso,
      }));

      const afterPaid = Math.round((beforePaid + check.allocated) * 100) / 100;
      t.update(ref, {
        paidAmount: afterPaid,
        history: FieldValue.arrayUnion(...historyLegs),
        updatedAt: FieldValue.serverTimestamp(),
        updatedByUid: auth.uid,
      });

      return {
        paidAmount: afterPaid,
        pending: check.unallocated,
        posted: allocations.length,
        fullyPaid: check.unallocated <= 0,
      };
    });

    // These rows were posted without moving the balances before; the screen's
    // own figure was right (it is derived), the cached one drifted.
    await bumpBalances(new Map(allocations.map((line) => [line.accountId, -line.amount])));
    return result;
  });
}

/**
 * Deletes an entry **and the ledger rows it caused**, putting each account's
 * balance back.
 *
 * Deleting a receipt takes its money out of the account that held it; if that
 * money has since been spent the account goes negative, which is the true
 * state — it paid for things with money that is no longer recorded as received.
 */
export async function deleteAmanatEntry(
  token: string,
  entryId: string
): Promise<ActionResult<{ removed: number }>> {
  return runAction("deleteAmanatEntry", async () => {
    await requireFinance(token);
    const ref = adminDb.collection(ENTRIES).doc(entryId);

    const { deltas, removed } = await adminDb.runTransaction(async (t) => {
      const snap = await t.get(ref);
      const legs = await t.get(legsOf(entryId));
      const moved = new Map<string, number>();

      for (const doc of legs.docs) {
        const leg = doc.data();
        if (leg.status === "POSTED") {
          // The opposite of what the row contributed. A reversed row and its
          // reversal are both here and cancel, as they did on the statement.
          const effect = leg.direction === "IN" ? money(leg.amount) : -money(leg.amount);
          const accountId = String(leg.accountId);
          moved.set(accountId, Math.round(((moved.get(accountId) ?? 0) - effect) * 100) / 100);
        }
        t.delete(doc.ref);
      }
      if (snap.exists) t.delete(ref);
      return { deltas: moved, removed: legs.size };
    });

    await bumpBalances(deltas);
    return { removed };
  });
}
