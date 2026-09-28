"use server";

/**
 * Amanat (Trust & Safekeeping Sheet) — Server Actions.
 *
 * Supports recording Amanat received (Money In) and Amanat expenses/disbursements
 * (Money Out), with multi-account payments posted directly to the double-entry ledger.
 */

import { adminDb } from "@/lib/firebase/server";
import { verifyAuth, type DecodedAuth } from "@/lib/firebase/serverAuth";
import { runAction, UserFacingError, type ActionResult } from "@/lib/actionResult";
import { karachiDayKey } from "@/lib/dates";
import { allocationsToTransactions, checkAllocations, money } from "@/lib/ledger";
import { FieldValue } from "firebase-admin/firestore";
import type { AmanatType } from "@/lib/amanatSheet";

const ENTRIES = "amanatEntries";

async function requireFinance(token: string): Promise<DecodedAuth> {
  const auth = await verifyAuth(token);
  if (!auth.isHr) throw new UserFacingError("Only an administrator or HR can do this.");
  return auth;
}

const dayOrNull = (raw?: string | null) => (raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null);

export interface AmanatEntryInput {
  type: AmanatType;
  party: string;
  title?: string | null;
  amount: number;
  paidAmount?: number;
  dayKey?: string | null;
  purpose?: string | null;
  notes?: string | null;
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

    const type: AmanatType = input.type === "EXPENSE" ? "EXPENSE" : "RECEIVED";
    const title = (input.title ?? "").trim() || (type === "RECEIVED" ? "Amanat Received" : "Amanat Expense");
    const dayKey = dayOrNull(input.dayKey) ?? karachiDayKey();
    const purpose = (input.purpose ?? "").trim() || null;
    const notes = (input.notes ?? "").trim() || null;
    const depositAccountId = (input.depositAccountId ?? "").trim() || null;

    let depositAccountName: string | null = null;
    if (depositAccountId) {
      const accSnap = await adminDb.collection("accounts").doc(depositAccountId).get();
      if (accSnap.exists) {
        depositAccountName = String(accSnap.data()?.name ?? "").trim() || null;
      }
    }

    const ref = entryId ? adminDb.collection(ENTRIES).doc(entryId) : adminDb.collection(ENTRIES).doc();

    const existingSnap = entryId ? await ref.get() : null;
    const existing = existingSnap?.exists ? existingSnap.data() : null;

    const payload: Record<string, unknown> = {
      type,
      party,
      title,
      amount,
      paidAmount: type === "RECEIVED" ? 0 : money(input.paidAmount ?? existing?.paidAmount ?? 0),
      dayKey,
      purpose,
      notes,
      depositAccountId,
      depositAccountName,
      updatedAt: FieldValue.serverTimestamp(),
      updatedByUid: auth.uid,
    };

    if (!existingSnap?.exists) {
      payload.history = [];
      payload.createdAt = FieldValue.serverTimestamp();
      payload.createdByUid = auth.uid;
      payload.createdByName = auth.name ?? auth.email ?? null;

      // If new RECEIVED entry and depositAccountId is chosen, post an IN ledger transaction
      if (type === "RECEIVED" && depositAccountId) {
        const txnRef = adminDb.collection("transactions").doc();
        await txnRef.set({
          accountId: depositAccountId,
          direction: "IN",
          amount,
          type: "LOAN",
          dayKey,
          sourceModule: "AMANAT",
          sourceId: ref.id,
          sourceLabel: `Amanat Received — ${party}`,
          status: "POSTED",
          createdByUid: auth.uid,
          createdByName: auth.name ?? auth.email ?? null,
          createdAt: FieldValue.serverTimestamp(),
          note: purpose ?? notes ?? "Trust money deposited",
        });
      }
    }

    await ref.set(payload, { merge: true });
    return { id: ref.id, name: `${party} (${title})` };
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
    const groupId = adminDb.collection("transactions").doc().id;
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
        allocations.map((a) => t.get(adminDb.collection("accounts").doc(a.accountId)))
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
        t.create(adminDb.collection("transactions").doc(), {
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

    return result;
  });
}

export async function deleteAmanatEntry(token: string, entryId: string): Promise<ActionResult> {
  return runAction("deleteAmanatEntry", async () => {
    await requireFinance(token);
    const ref = adminDb.collection(ENTRIES).doc(entryId);
    const snap = await ref.get();
    if (!snap.exists) return;

    await ref.delete();
  });
}
