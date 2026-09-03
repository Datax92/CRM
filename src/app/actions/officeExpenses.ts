"use server";

import { adminDb } from "@/lib/firebase/server";
import { requireAdmin, requireManager, type DecodedAuth } from "@/lib/firebase/serverAuth";
import { isHrManager } from "@/lib/constants/hierarchy";
import { runAction, UserFacingError, type ActionResult } from "@/lib/actionResult";
import { parseMoney } from "@/lib/money";
import { karachiDayKey } from "@/lib/dates";
import {
  DEFAULT_EXPENSE_CATEGORIES,
  EXPENSE_STATUSES,
  LEGACY_EXPENSE_CATEGORIES,
  PAYMENT_METHODS,
  normalizeExpenseStatus,
  type ExpenseStatus,
} from "@/lib/officeExpenses";
import { FieldValue } from "firebase-admin/firestore";

/**
 * Office expenses.
 *
 * **Admin and HR only** — the brief is explicit, and it is enforced here in
 * every action rather than by hiding a menu item. A manager or an employee
 * reaching any of these is refused, whatever route they came in on.
 *
 * This extends the **existing `expenses` collection** rather than starting a
 * second one. `addExpense` in `actions/expenses.ts` still works and still
 * writes readable records; what is new is the approval state, who paid, how,
 * the receipt, and a change history. Records written before this module have
 * no status and read as approved — see `normalizeExpenseStatus` for why.
 */

const EXPENSES = "expenses";
const CATEGORY_DOC = "expenseCategories";

/** Admin or HR. Nobody else, and no team-scoped middle ground. */
async function requireExpenseAccess(token: string): Promise<DecodedAuth> {
  const auth = await requireManager(token);
  if (auth.role === "admin") return auth;

  const profile = await adminDb.collection("users").doc(auth.uid).get();
  if (isHrManager(auth.role, profile.data()?.managerKind)) return auth;

  throw new UserFacingError("Office expenses are limited to the admin and HR.");
}

/* -------------------------------------------------------------------------- */
/* Categories                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The categories in force.
 *
 * The defaults plus anything the admin has added, plus the four legacy names,
 * so an old record never fails validation on its next edit. Deduplicated,
 * because an admin adding "Rent" a second time should be a no-op rather than a
 * duplicate entry in every dropdown.
 */
export async function getExpenseCategories(
  token: string
): Promise<ActionResult<{ categories: string[]; custom: string[] }>> {
  return runAction("getExpenseCategories", async () => {
    await requireExpenseAccess(token);

    const snap = await adminDb.collection("config").doc(CATEGORY_DOC).get();
    const custom = ((snap.data()?.categories ?? []) as unknown[])
      .map((value) => String(value).trim())
      .filter(Boolean);

    const categories = [
      ...new Set([...DEFAULT_EXPENSE_CATEGORIES, ...custom, ...LEGACY_EXPENSE_CATEGORIES]),
    ];

    return { categories, custom };
  });
}

/**
 * Adds, renames or removes a category.
 *
 * **Renaming rewrites the expenses that use it**, in batches. The alternative —
 * leaving old records pointing at a name that no longer exists — would split
 * one category into two on every report, which is worse than the write cost.
 * Removing a category only removes it from the dropdown: the expenses that
 * used it keep their label, because rewriting history to tidy a list is not a
 * trade worth making.
 */
export async function manageExpenseCategory(
  token: string,
  action: "ADD" | "RENAME" | "REMOVE",
  name: string,
  renameTo?: string
): Promise<ActionResult<{ categories: string[]; moved?: number }>> {
  return runAction("manageExpenseCategory", async () => {
    const auth = await requireExpenseAccess(token);
    const ref = adminDb.collection("config").doc(CATEGORY_DOC);

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
      const known = new Set<string>([
        ...DEFAULT_EXPENSE_CATEGORIES,
        ...LEGACY_EXPENSE_CATEGORIES,
        ...custom,
      ]);
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
      next = custom.map((entry) => (entry === label ? target : entry));

      // Move the records with it, so one category does not become two.
      const affected = await adminDb.collection(EXPENSES).where("category", "==", label).get();
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
      {
        categories: next,
        updatedAt: FieldValue.serverTimestamp(),
        updatedByUid: auth.uid,
      },
      { merge: true }
    );

    return {
      categories: [...new Set([...DEFAULT_EXPENSE_CATEGORIES, ...next, ...LEGACY_EXPENSE_CATEGORIES])],
      moved,
    };
  });
}

/* -------------------------------------------------------------------------- */
/* Expenses                                                                    */
/* -------------------------------------------------------------------------- */

export interface OfficeExpenseInput {
  title: string;
  category: string;
  amount: number;
  /** `YYYY-MM-DD`. Expenses are usually recorded after the money went out. */
  date?: string;
  paidBy?: string;
  paymentMethod?: string;
  description?: string;
  /** Artifact asset URL or any link to the scanned receipt. */
  receiptUrl?: string;
  receiptName?: string;
  /** New expenses start Pending unless the person recording it approves it. */
  status?: ExpenseStatus;
}

/** Validates and normalises the shared parts of create and edit. */
async function cleanInput(input: OfficeExpenseInput) {
  const title = (input.title ?? "").trim();
  if (!title) throw new UserFacingError("Give the expense a title.");

  const amount = parseMoney(input.amount);
  if (amount <= 0) throw new UserFacingError("Enter an amount greater than zero.");

  const category = (input.category ?? "").trim();
  if (!category) throw new UserFacingError("Choose a category.");

  const method = (input.paymentMethod ?? "").trim();
  if (method && !PAYMENT_METHODS.includes(method as (typeof PAYMENT_METHODS)[number])) {
    throw new UserFacingError("Choose one of the listed payment methods.");
  }

  const dayKey = normalizeDayKey(input.date);

  return {
    title,
    category,
    amount,
    dayKey,
    date: new Date(`${dayKey}T12:00:00+05:00`),
    paidBy: (input.paidBy ?? "").trim() || null,
    paymentMethod: method || null,
    description: (input.description ?? "").trim() || null,
    receiptUrl: (input.receiptUrl ?? "").trim() || null,
    receiptName: (input.receiptName ?? "").trim() || null,
  };
}

/** `YYYY-MM-DD`, today when unset, never in the future. */
function normalizeDayKey(raw: string | undefined): string {
  const today = karachiDayKey();
  const value = (raw ?? "").trim().slice(0, 10);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return today;
  if (value > today) throw new UserFacingError("The expense date cannot be in the future.");
  return value;
}

/** Records an office expense. */
export async function createOfficeExpense(
  token: string,
  input: OfficeExpenseInput
): Promise<ActionResult<{ expenseId: string }>> {
  return runAction("createOfficeExpense", async () => {
    const auth = await requireExpenseAccess(token);
    const clean = await cleanInput(input);

    const status: ExpenseStatus = EXPENSE_STATUSES.includes(input.status as ExpenseStatus)
      ? (input.status as ExpenseStatus)
      : "PENDING";

    const ref = adminDb.collection(EXPENSES).doc();
    await ref.create({
      ...clean,
      status,
      addedByUid: auth.uid,
      addedByEmail: auth.email ?? null,
      addedByName: auth.name ?? null,
      createdAt: FieldValue.serverTimestamp(),
      // An expense recorded as already approved records who approved it, or the
      // audit trail would show an approval with nobody behind it.
      ...(status === "APPROVED"
        ? { decidedByUid: auth.uid, decidedByName: auth.name ?? auth.email ?? null }
        : {}),
      history: [
        {
          at: new Date(),
          byUid: auth.uid,
          byName: auth.name ?? auth.email ?? null,
          action: "CREATED",
          detail: `${clean.title} — ${clean.amount}`,
        },
      ],
    });

    return { expenseId: ref.id };
  });
}

/**
 * Edits an expense.
 *
 * Every change appends the fields that moved, with their previous values, to
 * the expense's own history. A receipt and an amount are the two things people
 * dispute, so an amount that changed silently would be the one thing this
 * module could not answer for.
 */
export async function updateOfficeExpense(
  token: string,
  expenseId: string,
  input: OfficeExpenseInput
): Promise<ActionResult> {
  return runAction("updateOfficeExpense", async () => {
    const auth = await requireExpenseAccess(token);
    const clean = await cleanInput(input);

    const ref = adminDb.collection(EXPENSES).doc(expenseId);
    const snap = await ref.get();
    if (!snap.exists) throw new UserFacingError("That expense no longer exists.");

    const before = snap.data() ?? {};
    const changes: string[] = [];
    for (const [key, value] of Object.entries(clean)) {
      if (key === "date") continue; // Covered by dayKey.
      const previous = before[key] ?? null;
      if (String(previous ?? "") !== String(value ?? "")) {
        changes.push(`${key}: ${previous ?? "—"} → ${value ?? "—"}`);
      }
    }

    await ref.update({
      ...clean,
      updatedAt: FieldValue.serverTimestamp(),
      updatedByUid: auth.uid,
      history: FieldValue.arrayUnion({
        at: new Date(),
        byUid: auth.uid,
        byName: auth.name ?? auth.email ?? null,
        action: "EDITED",
        detail: changes.join("; ") || "No field changed",
      }),
    });
  });
}

/** Approves or rejects, with the reason kept. */
export async function setOfficeExpenseStatus(
  token: string,
  expenseId: string,
  status: ExpenseStatus,
  note?: string
): Promise<ActionResult<{ status: ExpenseStatus }>> {
  return runAction("setOfficeExpenseStatus", async () => {
    const auth = await requireExpenseAccess(token);

    if (!EXPENSE_STATUSES.includes(status)) {
      throw new UserFacingError("That is not an expense status.");
    }

    const ref = adminDb.collection(EXPENSES).doc(expenseId);
    const snap = await ref.get();
    if (!snap.exists) throw new UserFacingError("That expense no longer exists.");

    const current = normalizeExpenseStatus(snap.data()?.status);
    if (current === status) {
      throw new UserFacingError(`This expense is already ${status.toLowerCase()}.`);
    }

    await ref.update({
      status,
      decidedByUid: auth.uid,
      decidedByName: auth.name ?? auth.email ?? null,
      decidedAt: FieldValue.serverTimestamp(),
      decisionNote: (note ?? "").trim() || null,
      history: FieldValue.arrayUnion({
        at: new Date(),
        byUid: auth.uid,
        byName: auth.name ?? auth.email ?? null,
        action: `STATUS_${status}`,
        detail: `${current} → ${status}${note?.trim() ? ` (${note.trim()})` : ""}`,
      }),
    });

    return { status };
  });
}

/**
 * Deletes an expense.
 *
 * **Admin only**, deliberately narrower than the rest of this module: an
 * expense is a financial record, and removing one should be rare enough to
 * need the account that owns the books. Approved expenses cannot be deleted at
 * all — correcting one that has been counted means rejecting it, which leaves
 * the record and the reason behind.
 */
export async function deleteOfficeExpense(
  token: string,
  expenseId: string
): Promise<ActionResult> {
  return runAction("deleteOfficeExpense", async () => {
    await requireAdmin(token);

    const ref = adminDb.collection(EXPENSES).doc(expenseId);
    const snap = await ref.get();
    if (!snap.exists) throw new UserFacingError("That expense no longer exists.");

    if (normalizeExpenseStatus(snap.data()?.status) === "APPROVED") {
      throw new UserFacingError(
        "An approved expense cannot be deleted. Reject it instead — that keeps the record and the reason."
      );
    }

    await ref.delete();
  });
}
