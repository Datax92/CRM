"use server";

import { adminDb } from "@/lib/firebase/server";
import { requireAdmin } from "@/lib/firebase/serverAuth";
import { runAction, UserFacingError, type ActionResult } from "@/lib/actionResult";
import { parseMoney } from "@/lib/money";
import { FieldValue } from "firebase-admin/firestore";
import { EXPENSE_CATEGORIES, type ExpenseCategory } from "@/lib/constants";

export interface ExpenseInput {
  title: string;
  category: string;
  amount: number;
  description?: string;
  /** ISO date (yyyy-mm-dd) — expenses are often logged after the fact. */
  date?: string;
}

/** Records an office expense (FR-26, BR-20). Admin only. */
export async function addExpense(
  token: string,
  input: ExpenseInput
): Promise<ActionResult<{ expenseId: string }>> {
  return runAction("addExpense", async () => {
    const admin = await requireAdmin(token);

    const title = (input.title ?? "").trim();
    if (!title) {
      throw new UserFacingError("Give the expense a title.");
    }

    if (!EXPENSE_CATEGORIES.includes(input.category as ExpenseCategory)) {
      throw new UserFacingError("Choose one of the listed expense categories.");
    }

    const amount = parseMoney(input.amount);
    if (amount === 0) {
      throw new UserFacingError("Enter an amount greater than zero.");
    }

    const expenseRef = adminDb.collection("expenses").doc();
    await expenseRef.create({
      title,
      category: input.category,
      amount,
      description: (input.description ?? "").trim() || null,
      date: parseExpenseDate(input.date),
      addedByUid: admin.uid,
      addedByEmail: admin.email ?? null,
      createdAt: FieldValue.serverTimestamp(),
    });

    return { expenseId: expenseRef.id };
  });
}

function parseExpenseDate(raw: string | undefined): Date {
  if (!raw) return new Date();

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
  if (!match) return new Date();

  const [, year, month, day] = match;
  const parsed = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), 12, 0, 0));
  if (Number.isNaN(parsed.getTime())) return new Date();

  if (parsed.getTime() > Date.now() + 24 * 60 * 60 * 1000) {
    throw new UserFacingError("The expense date cannot be in the future.");
  }
  return parsed;
}
