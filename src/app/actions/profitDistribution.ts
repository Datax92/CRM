"use server";

/**
 * Finalising how a closed deal's profit is split (§14–§24).
 *
 * The admin enters percentages; this writes three things:
 *
 * | written | who can read it | why it exists |
 * |---|---|---|
 * | `dealDistributions/{id}` | admin only | the whole split — every recipient, every percentage |
 * | `dealPayouts/{id}` (one per person) | that person, their sub admin, the admin | somebody's own earnings |
 * | `closedDeals/{dealId}.distributionStatus` | as the deal | so a finalised deal leaves the queue |
 *
 * **The split is stored twice on purpose, and that is the whole privacy
 * design.** §22 says an employee sees their own commission and nothing else,
 * and a sub admin must not see another sub admin's cut. A single document
 * holding all four lines could not satisfy that — Firestore grants or denies a
 * whole document, never a field of one. So the complete picture lives in a
 * collection only the admin can read, and each person gets their own row
 * carrying only their own number.
 *
 * **Amounts are recomputed here from the percentages.** The client sends
 * percentages and shows the rupee figures as they type; it does not get to say
 * what anybody is paid. `calculateDistribution` is the same function the screen
 * runs, so the two cannot disagree — but this call is the one that counts.
 *
 * **Nothing is overwritten.** Re-finalising a deal marks the previous
 * distribution and its payouts `current: false` with a `supersededAt`, then
 * writes a fresh set. §24 requires the history to survive, and "who approved
 * that payout, and when" has to keep having an answer.
 */

import { adminDb } from "@/lib/firebase/server";
import { requireAdmin } from "@/lib/firebase/serverAuth";
import { runAction, UserFacingError, type ActionResult } from "@/lib/actionResult";
import {
  calculateDistribution,
  parsePercentage,
  type DistributionShare,
} from "@/lib/profitDistribution";
import { FieldValue } from "firebase-admin/firestore";

const DISTRIBUTIONS = "dealDistributions";
const PAYOUTS = "dealPayouts";

/** One line as the admin's screen sends it — percentage only, never an amount. */
export interface ShareInput {
  recipientUid: string | null;
  recipientRole: "employee" | "subadmin" | "company";
  kind: "EMPLOYEE" | "OWN_SUBADMIN" | "OTHER_SUBADMIN" | "COMPANY_BASE";
  percentage: number;
}

export interface FinalizeResult {
  distributionId: string;
  netProfit: number;
  distributedAmount: number;
  companyTotalAmount: number;
}

export async function finalizeProfitDistribution(
  token: string,
  dealId: string,
  shares: ShareInput[]
): Promise<ActionResult<FinalizeResult>> {
  return runAction("finalizeProfitDistribution", async () => {
    const admin = await requireAdmin(token);

    const dealRef = adminDb.collection("closedDeals").doc(dealId);
    const dealSnap = await dealRef.get();
    if (!dealSnap.exists) {
      throw new UserFacingError("That deal no longer exists.");
    }

    const deal = dealSnap.data()!;
    const netProfit = Number(deal.profit ?? 0);

    // Names are resolved here, from the profile documents, and stored beside
    // the uids. A payout record that reads "assigned to <uid>" after somebody
    // leaves the company is not a record, it is a puzzle.
    const uids = [...new Set(shares.map((share) => share.recipientUid).filter(Boolean))] as string[];
    const profiles = uids.length
      ? await adminDb.getAll(...uids.map((uid) => adminDb.collection("users").doc(uid)))
      : [];
    const nameOf = new Map(
      profiles.map((snap) => [
        snap.id,
        (snap.data()?.name as string) || (snap.data()?.email as string) || "Unknown",
      ])
    );

    for (const uid of uids) {
      if (!nameOf.has(uid)) {
        throw new UserFacingError("One of the people in this split no longer has an account.");
      }
    }

    const prepared: DistributionShare[] = shares.map((share) => ({
      recipientUid: share.recipientUid || null,
      recipientRole: share.recipientRole,
      kind: share.kind,
      recipientName:
        share.recipientRole === "company"
          ? "Company"
          : nameOf.get(share.recipientUid ?? "") ?? "Unknown",
      // Re-parsed rather than trusted: a crafted request could otherwise carry
      // a negative or a 900% share straight into the arithmetic.
      percentage: parsePercentage(share.percentage),
    }));

    const result = calculateDistribution(netProfit, prepared);
    if (!result.valid) {
      throw new UserFacingError(result.errors[0]);
    }

    const batch = adminDb.batch();
    const now = FieldValue.serverTimestamp();

    // Supersede the previous split rather than deleting it. Both collections
    // are queried by `current`, so the history stays out of the way without
    // being destroyed.
    const [priorDistributions, priorPayouts] = await Promise.all([
      adminDb.collection(DISTRIBUTIONS).where("dealId", "==", dealId).where("current", "==", true).get(),
      adminDb.collection(PAYOUTS).where("dealId", "==", dealId).where("current", "==", true).get(),
    ]);

    for (const snap of [...priorDistributions.docs, ...priorPayouts.docs]) {
      batch.update(snap.ref, { current: false, supersededAt: now, supersededByUid: admin.uid });
    }

    const distributionRef = adminDb.collection(DISTRIBUTIONS).doc();
    batch.set(distributionRef, {
      dealId,
      leadId: deal.leadId ?? dealId,
      employeeUid: deal.userId ?? null,
      subAdminUid: deal.subAdminUid ?? null,
      customerName: deal.customer?.name ?? null,
      // The deal as it stood when the split was finalised. Frozen here on
      // purpose: re-reading the deal later would let a corrected price silently
      // restate what people were paid.
      totalPrice: deal.totalPrice ?? deal.amountReceived ?? 0,
      downPayment: deal.downPayment ?? null,
      adjustment: deal.adjustment ?? deal.payableAmount ?? 0,
      remaining: deal.remaining ?? deal.profit ?? 0,
      amountReceived: deal.amountReceived ?? 0,
      payableAmount: deal.payableAmount ?? 0,
      netProfit: result.netProfit,
      lines: result.lines,
      distributedPercentage: result.distributedPercentage,
      distributedAmount: result.distributedAmount,
      remainingPercentage: result.remainingPercentage,
      remainingAmount: result.remainingAmount,
      companyBaseAmount: result.companyBaseAmount,
      companyTotalAmount: result.companyTotalAmount,
      finalizedByUid: admin.uid,
      finalizedAt: now,
      current: true,
      supersededAt: null,
    });

    for (const line of result.lines) {
      // The company's share has no recipient to show it to, and it is already
      // on the admin-only summary above. Writing a payout row for it would put
      // the company's profit in the one collection employees can read.
      if (line.recipientRole === "company" || !line.recipientUid) continue;

      batch.set(adminDb.collection(PAYOUTS).doc(), {
        dealId,
        leadId: deal.leadId ?? dealId,
        distributionId: distributionRef.id,
        recipientUid: line.recipientUid,
        recipientName: line.recipientName,
        recipientRole: line.recipientRole,
        kind: line.kind,
        // The recipient's own manager, so a sub admin can read their team's
        // earnings with a query Security Rules can prove. For a sub admin's own
        // payout this is themselves.
        subAdminUid:
          line.recipientRole === "subadmin" ? line.recipientUid : (deal.subAdminUid ?? null),
        percentage: line.percentage,
        amount: line.amount,
        netProfit: result.netProfit,
        customerName: deal.customer?.name ?? null,
        dealDate: deal.dealDate ?? null,
        finalizedByUid: admin.uid,
        finalizedAt: now,
        current: true,
        supersededAt: null,
      });

      // Everyone in the split is told what they earned. Without this the only
      // way to learn your commission moved is to go looking for it.
      batch.set(adminDb.collection("notifications").doc(), {
        type: "PROFIT_SHARE_ASSIGNED",
        leadId: deal.leadId ?? dealId,
        dealId,
        targetRole: line.recipientRole === "subadmin" ? "subadmin" : "employee",
        targetUid: line.recipientUid,
        payload: {
          message: `Your share of the ${deal.customer?.name ?? "closed"} deal: ${line.percentage}% — Rs ${line.amount.toLocaleString("en-PK")}.`,
          amount: line.amount,
          percentage: line.percentage,
        },
        createdAt: now,
        readAt: null,
      });
    }

    batch.update(dealRef, {
      distributionStatus: "FINALIZED",
      distributionId: distributionRef.id,
      distributionFinalizedAt: now,
      distributionFinalizedByUid: admin.uid,
    });

    await batch.commit();

    return {
      distributionId: distributionRef.id,
      netProfit: result.netProfit,
      distributedAmount: result.distributedAmount,
      companyTotalAmount: result.companyTotalAmount,
    };
  });
}

/**
 * Puts a finalised deal back in the queue.
 *
 * The superseding rule means "reopen" is not a delete: the existing split stays
 * on record, marked superseded, and the deal simply goes back to PENDING so a
 * corrected split can be entered. An admin who mistypes 20% instead of 2% needs
 * a way back that does not involve rewriting history.
 */
export async function reopenProfitDistribution(
  token: string,
  dealId: string
): Promise<ActionResult> {
  return runAction("reopenProfitDistribution", async () => {
    const admin = await requireAdmin(token);

    const dealRef = adminDb.collection("closedDeals").doc(dealId);
    const snap = await dealRef.get();
    if (!snap.exists) {
      throw new UserFacingError("That deal no longer exists.");
    }

    await dealRef.update({
      distributionStatus: "PENDING",
      distributionReopenedAt: FieldValue.serverTimestamp(),
      distributionReopenedByUid: admin.uid,
    });
  });
}
