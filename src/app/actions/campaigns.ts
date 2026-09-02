"use server";

import { adminDb } from "@/lib/firebase/server";
import { requireAdmin } from "@/lib/firebase/serverAuth";
import { runAction, UserFacingError, type ActionResult } from "@/lib/actionResult";
import { parseMoney } from "@/lib/money";
import { FieldValue } from "firebase-admin/firestore";

export interface CreateCampaignInput {
  name: string;
  externalId?: string;
  platform?: string;
  category?: string;
  status: "ACTIVE" | "COMPLETED" | "PAUSED" | "ARCHIVED";
  startDate?: string;
  endDate?: string;
  budget?: number;
  description?: string;
  notes?: string;
  historicalLeadsCount?: number;
  historicalRevenue?: number;
}

export interface CampaignRecord {
  id: string;
  name: string;
  externalId?: string | null;
  platform: string;
  category?: string | null;
  status: "ACTIVE" | "COMPLETED" | "PAUSED" | "ARCHIVED";
  startDate?: { toDate: () => Date } | null;
  endDate?: { toDate: () => Date } | null;
  budget?: number;
  description?: string | null;
  notes?: string | null;
  historicalLeadsCount?: number;
  historicalRevenue?: number;
  addedByUid: string;
  addedByEmail?: string | null;
  createdAt: { toDate: () => Date };
}

function parseInputDate(raw: string | undefined): Date | null {
  if (!raw) return null;
  const d = new Date(raw.trim());
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

export async function createCampaign(
  token: string,
  input: CreateCampaignInput
): Promise<ActionResult<{ campaignId: string }>> {
  return runAction("createCampaign", async () => {
    const admin = await requireAdmin(token);
    const name = (input.name ?? "").trim();
    if (!name) {
      throw new UserFacingError("Enter the campaign name.");
    }

    const budget = input.budget ? parseMoney(input.budget) : 0;
    const historicalLeadsCount = input.historicalLeadsCount ? Math.max(0, Math.floor(input.historicalLeadsCount)) : 0;
    const historicalRevenue = input.historicalRevenue ? parseMoney(input.historicalRevenue) : 0;

    const ref = adminDb.collection("campaigns").doc();
    const startDate = parseInputDate(input.startDate);
    const endDate = parseInputDate(input.endDate);

    await ref.create({
      name,
      externalId: input.externalId?.trim() || null,
      platform: input.platform?.trim() || "Meta Ads",
      category: input.category?.trim() || null,
      status: input.status || "COMPLETED",
      startDate: startDate || null,
      endDate: endDate || null,
      budget,
      description: input.description?.trim() || null,
      notes: input.notes?.trim() || null,
      historicalLeadsCount,
      historicalRevenue,
      addedByUid: admin.uid,
      addedByEmail: admin.email ?? null,
      createdAt: FieldValue.serverTimestamp(),
    });

    return { campaignId: ref.id };
  });
}
