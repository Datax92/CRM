"use server";

import { adminDb } from "@/lib/firebase/server";
import { requireAdmin } from "@/lib/firebase/serverAuth";
import { runAction, UserFacingError, type ActionResult } from "@/lib/actionResult";
import { parseMoney } from "@/lib/money";
import { FieldValue } from "firebase-admin/firestore";
import { RECEIVABLE_SIZES, type ReceivableSize } from "@/lib/constants";

export interface ReceivableInput {
  title: string;
  size: string;
  amount: number;
  date?: string;
}

export async function addReceivable(
  token: string,
  input: ReceivableInput
): Promise<ActionResult<{ receivableId: string }>> {
  return runAction("addReceivable", async () => {
    const admin = await requireAdmin(token);

    const title = (input.title ?? "").trim();
    if (!title) {
      throw new UserFacingError("Give the receivable a title.");
    }

    if (!RECEIVABLE_SIZES.includes(input.size as ReceivableSize)) {
      throw new UserFacingError("Choose either Large or Small for size.");
    }

    const amount = parseMoney(input.amount);
    if (amount === 0) {
      throw new UserFacingError("Enter an amount greater than zero.");
    }

    const recRef = adminDb.collection("receivables").doc();
    await recRef.create({
      title,
      size: input.size,
      amount,
      date: parseReceivableDate(input.date),
      addedByUid: admin.uid,
      addedByEmail: admin.email ?? null,
      createdAt: FieldValue.serverTimestamp(),
    });

    return { receivableId: recRef.id };
  });
}

function parseReceivableDate(raw: string | undefined): Date {
  if (!raw) return new Date();

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
  if (!match) return new Date();

  const [, year, month, day] = match;
  const parsed = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), 12, 0, 0));
  if (Number.isNaN(parsed.getTime())) return new Date();

  return parsed;
}
