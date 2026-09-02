"use server";

import { adminDb } from "@/lib/firebase/server";
import { requireAdmin } from "@/lib/firebase/serverAuth";
import { runAction, UserFacingError, type ActionResult } from "@/lib/actionResult";
import { parseMoney } from "@/lib/money";
import { FieldValue } from "firebase-admin/firestore";

export interface AccountRecordInput {
  title: string;
  amount: number;
  description?: string;
  date?: string;
}

function parseRecordDate(raw: string | undefined): Date {
  if (!raw) return new Date();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
  if (!match) return new Date();
  const [, year, month, day] = match;
  const parsed = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), 12, 0, 0));
  if (Number.isNaN(parsed.getTime())) return new Date();
  return parsed;
}

async function addGenericRecord(
  token: string,
  collectionName: string,
  input: AccountRecordInput
): Promise<{ id: string }> {
  const admin = await requireAdmin(token);
  const title = (input.title ?? "").trim();
  if (!title) {
    throw new UserFacingError("Give the record a title.");
  }
  const amount = parseMoney(input.amount);
  if (amount === 0) {
    throw new UserFacingError("Enter an amount greater than zero.");
  }
  const ref = adminDb.collection(collectionName).doc();
  await ref.create({
    title,
    amount,
    description: (input.description ?? "").trim() || null,
    date: parseRecordDate(input.date),
    addedByUid: admin.uid,
    addedByEmail: admin.email ?? null,
    createdAt: FieldValue.serverTimestamp(),
  });
  return { id: ref.id };
}

export async function addCommitteeRecord(
  token: string,
  input: AccountRecordInput
): Promise<ActionResult<{ recordId: string }>> {
  return runAction("addCommitteeRecord", async () => {
    const res = await addGenericRecord(token, "committee", input);
    return { recordId: res.id };
  });
}

export async function addInvestmentRecord(
  token: string,
  input: AccountRecordInput
): Promise<ActionResult<{ recordId: string }>> {
  return runAction("addInvestmentRecord", async () => {
    const res = await addGenericRecord(token, "investments", input);
    return { recordId: res.id };
  });
}

export async function addCapitalInvestmentRecord(
  token: string,
  input: AccountRecordInput
): Promise<ActionResult<{ recordId: string }>> {
  return runAction("addCapitalInvestmentRecord", async () => {
    const res = await addGenericRecord(token, "capitalInvestments", input);
    return { recordId: res.id };
  });
}

export async function addPersonalExpense(
  token: string,
  input: AccountRecordInput
): Promise<ActionResult<{ recordId: string }>> {
  return runAction("addPersonalExpense", async () => {
    const res = await addGenericRecord(token, "personalExpenses", input);
    return { recordId: res.id };
  });
}
