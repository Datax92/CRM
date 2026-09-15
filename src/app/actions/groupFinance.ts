"use server";

/**
 * Mahziyar Group — the month's added lines, its edits, and its closing.
 *
 * The arithmetic is `lib/groupFinance`, and **closing runs it here, on the
 * server**, from the records themselves: a closing is the one figure somebody
 * will later quote as final, so it must not be whatever a browser that had
 * been open all afternoon happened to believe.
 *
 * Everything is on one document per month (`groupMonths/{YYYY-MM}`): the lines
 * added by hand, the income corrections, the cell overrides, the description
 * and, once closed, the frozen figures. A month holds a few dozen lines at most,
 * so one document is one read for the whole sheet and one transaction per edit.
 *
 * A closed month refuses every edit here, and `lib/groupMonthGuard` refuses
 * changes to the office and personal expenses dated in it.
 */

import { adminDb } from "@/lib/firebase/server";
import { verifyAuth, requireAdmin, type DecodedAuth } from "@/lib/firebase/serverAuth";
import { runAction, UserFacingError, type ActionResult } from "@/lib/actionResult";
import { money } from "@/lib/ledger";
import {
  BUILTIN_COLUMNS,
  closingFrom,
  computeGroupMonth,
  isMonthKey,
  monthLabel,
  normalizeGroupFields,
  readGroupConfig,
  readGroupMonth,
  type BuiltinColumn,
  type GroupField,
  type LedgerRowInput,
} from "@/lib/groupFinance";
import { GROUP_MONTHS } from "@/lib/groupMonthGuard";
import { FieldValue } from "firebase-admin/firestore";

const CONFIG = "groupFinanceConfig";
const CONFIG_DOC = "main";

async function requireFinance(token: string): Promise<DecodedAuth> {
  const auth = await verifyAuth(token);
  if (!auth.isHr) throw new UserFacingError("Only an administrator or HR can do this.");
  return auth;
}

function monthRef(monthKey: string) {
  if (!isMonthKey(monthKey)) throw new UserFacingError("That is not a month.");
  return adminDb.collection(GROUP_MONTHS).doc(monthKey);
}

async function loadConfig() {
  const snap = await adminDb.collection(CONFIG).doc(CONFIG_DOC).get();
  return readGroupConfig(snap.exists ? snap.data() : null);
}

/**
 * Runs an edit against an open month, inside a transaction, and appends what
 * changed to its history.
 */
async function editOpenMonth(
  auth: DecodedAuth,
  monthKey: string,
  action: string,
  detail: string | null,
  change: (month: ReturnType<typeof readGroupMonth>) => Record<string, unknown>
): Promise<void> {
  const ref = monthRef(monthKey);
  await adminDb.runTransaction(async (t) => {
    const snap = await t.get(ref);
    const month = readGroupMonth(snap.exists ? snap.data() : null);
    if (month.status === "CLOSED") {
      throw new UserFacingError(`${monthLabel(monthKey)} is closed. Reopen it to make changes.`);
    }
    t.set(
      ref,
      {
        monthKey,
        status: "OPEN",
        ...change(month),
        updatedAt: FieldValue.serverTimestamp(),
        history: FieldValue.arrayUnion({
          at: new Date().toISOString(),
          action,
          byUid: auth.uid,
          byName: auth.name ?? auth.email ?? null,
          detail,
        }),
      },
      { merge: true }
    );
  });
}

/* -------------------------------------------------------------------------- */
/* Fields                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Saves the sheet's columns: the builtin labels and the added fields.
 *
 * A removed field is **archived, not deleted** — its lines stay on their months
 * and bring their totals back if the field is restored. The screen sends the
 * whole list, archived ones included.
 */
export async function saveGroupConfig(
  token: string,
  input: { fields: Array<Partial<GroupField>>; labels?: Partial<Record<BuiltinColumn, string>> }
): Promise<ActionResult<{ fields: GroupField[] }>> {
  return runAction("saveGroupConfig", async () => {
    const auth = await requireFinance(token);
    const current = await loadConfig();

    const fields = normalizeGroupFields(input.fields ?? []);
    // A field that disappeared from the list is kept, archived: somebody's lines
    // are stored against its key.
    for (const old of current.fields) {
      if (!fields.some((field) => field.key === old.key)) fields.push({ ...old, archived: true });
    }

    const labels: Record<string, string> = {};
    for (const key of BUILTIN_COLUMNS) {
      const label = (input.labels?.[key] ?? current.labels[key] ?? "").trim().slice(0, 40);
      if (label) labels[key] = label;
    }

    await adminDb.collection(CONFIG).doc(CONFIG_DOC).set(
      { fields, labels, updatedAt: FieldValue.serverTimestamp(), updatedByUid: auth.uid },
      { merge: true }
    );
    return { fields };
  });
}

/* -------------------------------------------------------------------------- */
/* Lines added by hand                                                         */
/* -------------------------------------------------------------------------- */

export interface GroupEntryInput {
  fieldKey: string;
  amount: number;
  dayKey?: string | null;
  note?: string | null;
}

async function cleanEntry(input: GroupEntryInput, monthKey: string) {
  const config = await loadConfig();
  const field = config.fields.find((entry) => entry.key === input.fieldKey && !entry.archived);
  if (!field) throw new UserFacingError("Choose one of the sheet's fields for this line.");
  const amount = money(input.amount);
  if (amount <= 0) throw new UserFacingError("Enter an amount greater than zero.");
  const dayKey = input.dayKey && /^\d{4}-\d{2}-\d{2}$/.test(input.dayKey) ? input.dayKey : `${monthKey}-01`;
  if (!dayKey.startsWith(monthKey)) {
    throw new UserFacingError(`The date must be in ${monthLabel(monthKey)}.`);
  }
  return { field, amount, dayKey, note: (input.note ?? "").trim() || null };
}

export async function saveGroupEntry(
  token: string,
  monthKey: string,
  input: GroupEntryInput,
  entryId?: string
): Promise<ActionResult<{ entryId: string }>> {
  return runAction("saveGroupEntry", async () => {
    const auth = await requireFinance(token);
    const clean = await cleanEntry(input, monthKey);
    const id = entryId || adminDb.collection(GROUP_MONTHS).doc().id;

    await editOpenMonth(auth, monthKey, entryId ? "LINE_EDITED" : "LINE_ADDED", `${clean.field.label} ${clean.amount}`, (month) => {
      const entries = month.entries.filter((entry) => entry.id !== id);
      if (entryId && entries.length === month.entries.length) {
        throw new UserFacingError("That line no longer exists.");
      }
      entries.push({ id, fieldKey: clean.field.key, amount: clean.amount, dayKey: clean.dayKey, note: clean.note });
      entries.sort((a, b) => a.dayKey.localeCompare(b.dayKey) || a.id.localeCompare(b.id));
      return { entries };
    });
    return { entryId: id };
  });
}

export async function deleteGroupEntry(token: string, monthKey: string, entryId: string): Promise<ActionResult> {
  return runAction("deleteGroupEntry", async () => {
    const auth = await requireFinance(token);
    await editOpenMonth(auth, monthKey, "LINE_REMOVED", null, (month) => {
      const entries = month.entries.filter((entry) => entry.id !== entryId);
      if (entries.length === month.entries.length) throw new UserFacingError("That line no longer exists.");
      return { entries };
    });
  });
}

/* -------------------------------------------------------------------------- */
/* Edits over the automatic figures                                            */
/* -------------------------------------------------------------------------- */

/**
 * Corrects what one income line counts as on this month's sheet — `null`
 * brings the automatic figure back, `0` leaves the line out.
 *
 * **The sale, the car or the policy behind it is untouched**: this is the
 * month's reading of the money, not a rewrite of where it came from. The
 * account's balance does not move either.
 */
export async function setGroupIncomeEdit(
  token: string,
  monthKey: string,
  transactionId: string,
  amount: number | null,
  note?: string | null
): Promise<ActionResult> {
  return runAction("setGroupIncomeEdit", async () => {
    const auth = await requireFinance(token);
    if (!transactionId || !/^[A-Za-z0-9_-]+$/.test(transactionId)) {
      throw new UserFacingError("That income line no longer exists.");
    }
    await editOpenMonth(
      auth,
      monthKey,
      amount === null ? "INCOME_RESET" : "INCOME_EDITED",
      amount === null ? transactionId : `${transactionId} → ${money(amount)}`,
      // Nested rather than a dotted key: `set` with `merge` treats a dotted
      // key as one literal field name, not a path.
      () => ({
        incomeEdits: {
          [transactionId]:
            amount === null
              ? FieldValue.delete()
              : { amount: Math.round(Number(amount) * 100) / 100, note: (note ?? "").trim() || null },
        },
      })
    );
  });
}

/** Overrides one cell of the month — `null` gives the automatic value back. */
export async function setGroupCell(
  token: string,
  monthKey: string,
  columnKey: string,
  value: number | null
): Promise<ActionResult> {
  return runAction("setGroupCell", async () => {
    const auth = await requireFinance(token);
    if (!/^[a-z0-9_]+$/.test(columnKey)) throw new UserFacingError("That column no longer exists.");
    if (value !== null && !Number.isFinite(Number(value))) throw new UserFacingError("Enter a number.");
    await editOpenMonth(
      auth,
      monthKey,
      value === null ? "CELL_RESET" : "CELL_EDITED",
      value === null ? columnKey : `${columnKey} → ${value}`,
      () => ({
        cellOverrides: {
          [columnKey]: value === null ? FieldValue.delete() : Math.round(Number(value) * 100) / 100,
        },
      })
    );
  });
}

export async function setGroupDescription(
  token: string,
  monthKey: string,
  description: string
): Promise<ActionResult> {
  return runAction("setGroupDescription", async () => {
    const auth = await requireFinance(token);
    await editOpenMonth(auth, monthKey, "DESCRIPTION_EDITED", null, () => ({
      description: (description ?? "").trim().slice(0, 1000) || null,
    }));
  });
}

/* -------------------------------------------------------------------------- */
/* Closing                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Closes a month: computes its figures from the records, freezes them on the
 * month, and locks it.
 */
export async function closeGroupMonth(
  token: string,
  monthKey: string
): Promise<ActionResult<{ income: number; spent: number; remaining: number }>> {
  return runAction("closeGroupMonth", async () => {
    const auth = await requireFinance(token);
    const ref = monthRef(monthKey);
    const first = `${monthKey}-01`;
    const last = `${monthKey}-31`;

    const [config, transactions, accounts, office, personal] = await Promise.all([
      loadConfig(),
      adminDb.collection("transactions").where("dayKey", ">=", first).where("dayKey", "<=", last).get(),
      adminDb.collection("accounts").get(),
      adminDb.collection("expenses").where("dayKey", ">=", first).where("dayKey", "<=", last).get(),
      adminDb.collection("personalExpenses").where("dayKey", ">=", first).where("dayKey", "<=", last).get(),
    ]);

    const closing = await adminDb.runTransaction(async (t) => {
      const snap = await t.get(ref);
      const month = readGroupMonth(snap.exists ? snap.data() : null);
      if (month.status === "CLOSED") throw new UserFacingError(`${monthLabel(monthKey)} is already closed.`);

      const figures = computeGroupMonth({
        monthKey,
        transactions: transactions.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as LedgerRowInput),
        accountNames: new Map(accounts.docs.map((doc) => [doc.id, (doc.data().name as string) ?? "Account"])),
        officeExpenses: office.docs.map((doc) => ({
          id: doc.id,
          dayKey: doc.data().dayKey as string,
          amount: money(doc.data().amount),
          status: (doc.data().status as string | undefined) ?? null,
        })),
        personalExpenses: personal.docs.map((doc) => ({
          id: doc.id,
          dayKey: doc.data().dayKey as string,
          amount: money(doc.data().amount),
        })),
        month,
        fields: config.fields,
        labels: config.labels,
      });

      const frozen = closingFrom(figures, auth.name ?? auth.email ?? null);
      t.set(
        ref,
        {
          monthKey,
          status: "CLOSED",
          closing: frozen,
          updatedAt: FieldValue.serverTimestamp(),
          history: FieldValue.arrayUnion({
            at: frozen.closedAt,
            action: "CLOSED",
            byUid: auth.uid,
            byName: auth.name ?? auth.email ?? null,
            detail: `made ${frozen.income} · spent ${frozen.spent} · remaining ${frozen.remaining}`,
          }),
        },
        { merge: true }
      );
      return frozen;
    });

    return { income: closing.income, spent: closing.spent, remaining: closing.remaining };
  });
}

/**
 * Reopens a closed month — the admin's alone. The closing it replaces is kept
 * in the month's history, so a reopened-and-reclosed month still shows what the
 * first close said.
 */
export async function reopenGroupMonth(token: string, monthKey: string): Promise<ActionResult> {
  return runAction("reopenGroupMonth", async () => {
    const auth = await requireAdmin(token);
    const ref = monthRef(monthKey);
    await adminDb.runTransaction(async (t) => {
      const snap = await t.get(ref);
      const month = readGroupMonth(snap.exists ? snap.data() : null);
      if (month.status !== "CLOSED") throw new UserFacingError(`${monthLabel(monthKey)} is not closed.`);
      t.update(ref, {
        status: "OPEN",
        closing: null,
        previousClosings: FieldValue.arrayUnion({ ...month.closing, reopenedAt: new Date().toISOString() }),
        updatedAt: FieldValue.serverTimestamp(),
        history: FieldValue.arrayUnion({
          at: new Date().toISOString(),
          action: "REOPENED",
          byUid: auth.uid,
          byName: auth.name ?? auth.email ?? null,
          detail: null,
        }),
      });
    });
  });
}
