"use server";

/**
 * Receivables and Payables — the owner's two sheets, as records.
 *
 * **No account moves**, by the owner's choice: this is who owes whom and how
 * much of it has come back. `lib/receivableSheet` holds the arithmetic;
 * `AMOUNT PENDING` is derived and never stored.
 *
 * Settling part of an entry **adds** to what has been settled and writes the
 * amount, the date and who recorded it into the entry's history, so "Bhatti
 * paid 3,000 on the 12th" is still readable after the pending figure has moved
 * on. Editing the settled figure directly is also allowed — everything on the
 * sheet is editable — and is recorded the same way.
 */

import { adminDb } from "@/lib/firebase/server";
import { verifyAuth, requireAdmin, type DecodedAuth } from "@/lib/firebase/serverAuth";
import { runAction, UserFacingError, type ActionResult } from "@/lib/actionResult";
import { karachiDayKey } from "@/lib/dates";
import { money } from "@/lib/ledger";
import {
  DEFAULT_PAYABLE_GROUPS,
  DEFAULT_RECEIVABLE_GROUPS,
  normalizeGroups,
  type LedgerSide,
} from "@/lib/receivableSheet";
import { FieldValue } from "firebase-admin/firestore";

const ENTRIES = "receivableEntries";
const CONFIG = "receivableSheetConfig";
const CONFIG_DOC = "main";

async function requireFinance(token: string): Promise<DecodedAuth> {
  const auth = await verifyAuth(token);
  if (!auth.isHr) throw new UserFacingError("Only an administrator or HR can do this.");
  return auth;
}

const dayOrNull = (raw?: string | null) => (raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null);

export interface SheetEntryInput {
  side: LedgerSide;
  group: string;
  dayKey?: string | null;
  name: string;
  amount: number;
  settled?: number;
  returnDayKey?: string | null;
  purpose?: string | null;
  description?: string | null;
}

export async function saveSheetEntry(
  token: string,
  input: SheetEntryInput,
  entryId?: string
): Promise<ActionResult<{ entryId: string }>> {
  return runAction("saveSheetEntry", async () => {
    const auth = await requireFinance(token);

    const side: LedgerSide = input.side === "PAYABLE" ? "PAYABLE" : "RECEIVABLE";
    const name = (input.name ?? "").trim().slice(0, 80);
    if (!name) throw new UserFacingError(side === "PAYABLE" ? "Enter who the money is owed to." : "Enter the customer's name.");
    const amount = money(input.amount);
    if (amount <= 0) throw new UserFacingError("Enter the pending amount.");
    const settled = money(input.settled);
    if (settled < 0) throw new UserFacingError("The amount settled cannot be negative.");
    const group = (input.group ?? "").trim().slice(0, 50) || (side === "PAYABLE" ? DEFAULT_PAYABLE_GROUPS[0] : DEFAULT_RECEIVABLE_GROUPS[0]);

    const payload = {
      side,
      group,
      dayKey: dayOrNull(input.dayKey) ?? karachiDayKey(),
      name,
      amount,
      settled,
      returnDayKey: side === "PAYABLE" ? dayOrNull(input.returnDayKey) : null,
      purpose: (input.purpose ?? "").trim() || null,
      description: (input.description ?? "").trim() || null,
      updatedAt: FieldValue.serverTimestamp(),
      updatedByUid: auth.uid,
    };

    const ref = entryId ? adminDb.collection(ENTRIES).doc(entryId) : adminDb.collection(ENTRIES).doc();
    await adminDb.runTransaction(async (t) => {
      const snap = await t.get(ref);
      if (entryId && !snap.exists) throw new UserFacingError("That entry no longer exists.");
      const entry = {
        at: new Date().toISOString(),
        action: entryId ? "EDITED" : "CREATED",
        byUid: auth.uid,
        byName: auth.name ?? auth.email ?? null,
        amount,
        detail: settled > 0 ? `settled ${settled}` : null,
      };
      t.set(
        ref,
        entryId
          ? { ...payload, history: FieldValue.arrayUnion(entry) }
          : { ...payload, createdByUid: auth.uid, createdAt: FieldValue.serverTimestamp(), history: [entry] },
        { merge: Boolean(entryId) }
      );
    });

    return { entryId: ref.id };
  });
}

/**
 * Records money coming back on a receivable, or going back on a payable.
 *
 * Refused past what is pending — settling more than was owed is a typo or the
 * wrong row, and either way the sheet should say so rather than go quietly
 * negative.
 */
export async function settleSheetEntry(
  token: string,
  entryId: string,
  input: { amount: number; dayKey?: string | null; note?: string | null }
): Promise<ActionResult<{ settled: number; pending: number }>> {
  return runAction("settleSheetEntry", async () => {
    const auth = await requireFinance(token);
    const amount = money(input.amount);
    if (amount <= 0) throw new UserFacingError("Enter an amount greater than zero.");

    const ref = adminDb.collection(ENTRIES).doc(entryId);
    return adminDb.runTransaction(async (t) => {
      const snap = await t.get(ref);
      if (!snap.exists) throw new UserFacingError("That entry no longer exists.");
      const data = snap.data()!;
      const owed = money(data.amount);
      const before = money(data.settled);
      const pending = Math.round((owed - before) * 100) / 100;
      if (amount > pending) {
        throw new UserFacingError(
          `Only ${pending.toLocaleString("en-PK")} is pending on this entry. Enter that or less.`
        );
      }
      const settled = Math.round((before + amount) * 100) / 100;
      t.update(ref, {
        settled,
        updatedAt: FieldValue.serverTimestamp(),
        history: FieldValue.arrayUnion({
          at: new Date().toISOString(),
          action: data.side === "PAYABLE" ? "PAID_BACK" : "RECEIVED",
          byUid: auth.uid,
          byName: auth.name ?? auth.email ?? null,
          amount,
          detail: [dayOrNull(input.dayKey) ?? karachiDayKey(), (input.note ?? "").trim()].filter(Boolean).join(" · "),
        }),
      });
      return { settled, pending: Math.round((owed - settled) * 100) / 100 };
    });
  });
}

export async function deleteSheetEntry(token: string, entryId: string): Promise<ActionResult> {
  return runAction("deleteSheetEntry", async () => {
    await requireAdmin(token);
    await adminDb.collection(ENTRIES).doc(entryId).delete();
  });
}

/** Saves the group names for one side. A renamed group moves its entries with it. */
export async function saveSheetGroups(
  token: string,
  side: LedgerSide,
  groups: string[],
  renames: Array<{ from: string; to: string }> = []
): Promise<ActionResult<{ groups: string[]; moved: number }>> {
  return runAction("saveSheetGroups", async () => {
    const auth = await requireFinance(token);
    const fallback = side === "PAYABLE" ? DEFAULT_PAYABLE_GROUPS : DEFAULT_RECEIVABLE_GROUPS;
    const clean = normalizeGroups(groups, fallback);

    let moved = 0;
    for (const rename of renames) {
      const from = (rename.from ?? "").trim();
      const to = (rename.to ?? "").trim();
      if (!from || !to || from === to) continue;
      const rows = await adminDb.collection(ENTRIES).where("side", "==", side).where("group", "==", from).get();
      for (let i = 0; i < rows.docs.length; i += 400) {
        const batch = adminDb.batch();
        rows.docs.slice(i, i + 400).forEach((doc) => batch.update(doc.ref, { group: to }));
        await batch.commit();
      }
      moved += rows.size;
    }

    await adminDb.collection(CONFIG).doc(CONFIG_DOC).set(
      {
        [side === "PAYABLE" ? "payableGroups" : "receivableGroups"]: clean,
        updatedAt: FieldValue.serverTimestamp(),
        updatedByUid: auth.uid,
      },
      { merge: true }
    );
    return { groups: clean, moved };
  });
}

/**
 * Brings the receivables recorded on the old Receivable screen into the sheet.
 *
 * **Adds, never moves or deletes.** Each old row is copied into the sheet as a
 * pending receivable and marked `migratedTo` with the new entry's id, so a
 * second press finds nothing to do and the originals can still be read.
 */
export async function importLegacyReceivables(
  token: string
): Promise<ActionResult<{ imported: number }>> {
  return runAction("importLegacyReceivables", async () => {
    const auth = await requireFinance(token);
    const legacy = await adminDb.collection("receivables").get();
    const pending = legacy.docs.filter((doc) => !doc.data().migratedTo);
    if (pending.length === 0) return { imported: 0 };

    const batch = adminDb.batch();
    for (const doc of pending) {
      const data = doc.data();
      const date = data.date?.toDate?.() as Date | undefined;
      const ref = adminDb.collection(ENTRIES).doc();
      batch.set(ref, {
        side: "RECEIVABLE",
        group: DEFAULT_RECEIVABLE_GROUPS[0],
        dayKey: date ? karachiDayKey(date) : karachiDayKey(),
        name: ((data.title as string) ?? "").trim() || "Unnamed",
        amount: money(data.amount),
        settled: 0,
        returnDayKey: null,
        purpose: null,
        description: data.size ? `Imported from the old Receivable screen (${data.size})` : "Imported from the old Receivable screen",
        legacyReceivableId: doc.id,
        createdByUid: auth.uid,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        history: [
          {
            at: new Date().toISOString(),
            action: "IMPORTED",
            byUid: auth.uid,
            byName: auth.name ?? auth.email ?? null,
            amount: money(data.amount),
            detail: null,
          },
        ],
      });
      batch.update(doc.ref, { migratedTo: ref.id });
    }
    await batch.commit();
    return { imported: pending.length };
  });
}

/** How many old receivables are still waiting to be brought in. */
export async function countLegacyReceivables(token: string): Promise<ActionResult<{ waiting: number }>> {
  return runAction("countLegacyReceivables", async () => {
    await requireFinance(token);
    const legacy = await adminDb.collection("receivables").get();
    return { waiting: legacy.docs.filter((doc) => !doc.data().migratedTo).length };
  });
}
