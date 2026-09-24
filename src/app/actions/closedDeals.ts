"use server";

import { adminDb } from "@/lib/firebase/server";
import { requireAdmin, verifyAuth } from "@/lib/firebase/serverAuth";
import { runAction, UserFacingError, type ActionResult } from "@/lib/actionResult";
import { dealAmounts, describeDealAmounts, validateDealAmounts } from "@/lib/dealAmounts";
import { toE164Digits } from "@/lib/phone";
import { isTerminal } from "@/lib/leadStatus";
import { karachiMonthKey } from "@/lib/dates";
import { normalizeDealCategory } from "@/lib/constants/deals";
import { FieldValue, Timestamp, Transaction } from "firebase-admin/firestore";

/**
 * The Entry Module (FR-20, FR-21, BR-18, BR-19).
 *
 * Every won deal is recorded here, and this is the only path to CLOSED_WON.
 * The record is deliberately fuller than the amounts alone: a lead arrives from
 * Meta with whatever the customer typed into an ad form, which is rarely what
 * you want in a permanent customer record. At the point of sale the employee
 * confirms and completes the customer's details, and that confirmed version is
 * what the business keeps.
 */

export interface DealCustomerInput {
  name: string;
  phone: string;
  email?: string;
  cnic?: string;
  address?: string;
  city?: string;
}

export interface DealEntryInput {
  customer: DealCustomerInput;
  serviceDescription: string;
  /**
   * Which of the four the deal is. Decides which of the figures below are read
   * at all — see `lib/dealAmounts`. Absent means Installments, which is what
   * every deal recorded before the selector existed is.
   */
  dealType?: string;
  /** Down Payment / Confirmation: the sale price agreed with the client. */
  totalPrice?: number;
  /** Down Payment: what they have handed over so far. */
  downPayment?: number;
  /** Confirmation: what they have handed over to confirm. */
  confirmationAmount?: number;
  /** Anything knocked off the price: an old file traded in. */
  adjustment?: number;
  /** Down Payment / Confirmation: comes off the price before the adjustment. */
  discount?: number;
  /** Down Payment only: `DOWN_PAYMENT` or `TOKEN_RECEIVED`. A label. */
  downPaymentKind?: string;
  /** Installments / Lump Sum: the money received. */
  receivedAmount?: number;
  /** Installments / Lump Sum: what is payable out of it. */
  payableAmount?: number;
  /** Lump Sum only: what the builder pays us. **Typed, never derived.** */
  commission?: number;
  paymentMethod?: string;
  /** Rental / Installment / Investment — drives the portfolio breakdown. */
  dealCategory?: string;
  dealDate?: string; // ISO date (yyyy-mm-dd) from the form
  notes?: string;
}

/**
 * Records a closed deal and moves the lead to CLOSED_WON.
 *
 * The deal document id is the lead id, which makes the whole operation
 * idempotent: a double-submitted form, or an impatient second click, hits an
 * existing document and is rejected instead of silently double-counting the
 * revenue.
 *
 * Profit is computed here and never read from the client payload (BR-19).
 */
export async function closeDeal(
  token: string,
  leadId: string,
  input: DealEntryInput
): Promise<ActionResult<{ dealId: string; profit: number }>> {
  return runAction("closeDeal", async () => {
    const auth = await verifyAuth(token);

    const customerName = (input.customer?.name ?? "").trim();
    if (!customerName) {
      throw new UserFacingError("Enter the customer's name.");
    }

    const phoneDigits = toE164Digits(input.customer?.phone);
    if (!phoneDigits) {
      throw new UserFacingError("Enter a valid contact number for the customer.");
    }

    const serviceDescription = (input.serviceDescription ?? "").trim();
    if (!serviceDescription) {
      throw new UserFacingError("Describe what was sold, so the record makes sense later.");
    }

    /**
     * **The money, computed here and never read from the payload** (BR-19).
     *
     * Every figure below comes out of `lib/dealAmounts` from the deal type and
     * the typed fields, so the form's live preview and the stored record cannot
     * disagree. The two that matter downstream are deliberately separate:
     * `cutBase` is what a Cut percentage multiplies and `payoutSource` is what
     * the finalised Cut comes out of — see the table in that module.
     *
     * **The Cut itself is not decided here.** Deal Entry stores the figures;
     * the admin finalises the percentage in Profit Distribution. There is one
     * source of truth for each and this is not it.
     */
    const amountErrors = validateDealAmounts(input);
    if (amountErrors.length > 0) throw new UserFacingError(amountErrors[0]);

    const amounts = dealAmounts(input);
    const { dealType, totalPrice, downPayment, confirmationAmount, adjustment } = amounts;
    const { discount, downPaymentKind } = amounts;
    const { receivedAmount, commission, remaining, cutBase, payoutSource, profit } = amounts;
    // The two fields every existing revenue rollup reads. Mirrors, not inputs:
    // for a Lump Sum they carry the Commission, because the client's money goes
    // to the builder and is not the company's revenue.
    const { amountReceived, legacyPayableAmount } = amounts;

    const email = (input.customer?.email ?? "").trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new UserFacingError("That email address doesn't look right.");
    }

    const dealDate = parseDealDate(input.dealDate);
    const dealCategory = normalizeDealCategory(input.dealCategory);
    const monthKey = karachiMonthKey(dealDate);

    return adminDb.runTransaction(async (t: Transaction) => {
      const leadRef = adminDb.collection("leads").doc(leadId);
      const dealRef = adminDb.collection("closedDeals").doc(leadId);

      const [leadSnap, dealSnap] = await Promise.all([t.get(leadRef), t.get(dealRef)]);

      if (!leadSnap.exists) {
        throw new UserFacingError("That lead no longer exists.");
      }
      if (dealSnap.exists) {
        throw new UserFacingError("This deal has already been entered.");
      }

      const lead = leadSnap.data()!;
      const kyc = (lead.kyc ?? {}) as Record<string, string>;

      const mayClose =
        auth.role === "admin" ||
        (auth.role === "subadmin" && lead.subAdminUid === auth.uid) ||
        lead.assignedUserId === auth.uid;
      if (!mayClose) {
        throw new UserFacingError("This lead is not assigned to you.");
      }
      if (isTerminal(lead.status)) {
        throw new UserFacingError("This lead is already closed.");
      }
      if (!lead.assignedUserId) {
        throw new UserFacingError("Assign this lead to an employee before entering a deal.");
      }

      t.create(dealRef, {
        leadId,

        // Revenue is credited to whoever worked the lead, which is not
        // necessarily whoever typed the form — an admin may enter on their
        // behalf. Both are recorded so performance reporting stays honest.
        userId: lead.assignedUserId,
        enteredByUid: auth.uid,

        // KYC is the client record, so anything the form left blank falls back
        // to it rather than being stored empty. The rep confirmed these details
        // on the first call; making them retype the CNIC at the point of sale
        // is exactly what the KYC feature exists to stop.
        customer: {
          name: customerName,
          phone: phoneDigits,
          email: email || kyc.email || null,
          cnic: (input.customer?.cnic ?? "").trim() || kyc.cnic || null,
          address: (input.customer?.address ?? "").trim() || kyc.address || null,
          city: (input.customer?.city ?? "").trim() || kyc.city || null,
        },

        serviceDescription,
        paymentMethod: input.paymentMethod || "Cash",
        dealCategory,
        notes: (input.notes ?? "").trim() || null,

        // The deal as it is now recorded. Every type's fields are written,
        // because a figure that is meaningless for this type is zero rather
        // than absent — an absent field and a zero one are indistinguishable
        // later, and `dealType` is what says which ones to read.
        dealType,
        totalPrice,
        downPayment,
        confirmationAmount,
        adjustment,
        discount,
        downPaymentKind,
        // Null for a Lump Sum, which has no Remaining at all. Stored as null
        // rather than 0 so nothing can print a confident "Rs 0 remaining".
        remaining,
        receivedAmount,
        commission,

        /*
         * **The two Cut numbers, stored apart on purpose.** `cutBase` is what
         * the admin's percentage multiplies; `payoutSource` is the pot it comes
         * out of. They differ on every type but Installments-with-no-payable,
         * and collapsing them is the mistake this pair exists to prevent.
         * Frozen here at entry so a later edit to the deal cannot silently
         * restate what somebody was paid.
         */
        cutBase,
        payoutSource,

        /*
         * Written for the ~30 readers that predate the type selector — every
         * revenue rollup, the KPI portfolio, the income sheet, campaign ROI.
         * `amountReceived − payableAmount` still equals what the company books,
         * so none of them had to change and no historical deal needs migrating.
         * Nothing new should read these; use `lib/dealAmounts`.
         */
        amountReceived,
        payableAmount: legacyPayableAmount,
        profit,

        // Denormalised so campaign reporting doesn't need a lead join.
        campaignId: lead.campaignId ?? null,
        campaignName: lead.campaignName ?? null,
        source: lead.source ?? null,
        dataBankFolderId: lead.dataBankFolderId ?? null,
        dataBankFolderName: lead.dataBankFolderName ?? null,

        // Whose team earned this. Carried onto the deal so a sub admin's
        // financial query is provable to Security Rules without a lead join,
        // and so the profit split knows which sub admin is in line for a cut.
        subAdminUid: lead.subAdminUid ?? null,

        // Every closed deal now waits for the admin to split the profit
        // (§12–§14). PENDING is the state the notification below is about; it
        // is not a claim that anything is wrong with the deal.
        distributionStatus: "PENDING",

        dealDate,
        enteredAt: FieldValue.serverTimestamp(),
      });

      t.update(leadRef, {
        status: "CLOSED_WON",
        closedAt: FieldValue.serverTimestamp(),
        closedDealId: leadId,
      });

      // A closed deal is a "Client Registration" on the KPI dashboard. Counted
      // in the month of the deal date, and credited to the employee who worked
      // the lead — the same person the revenue above is credited to.
      t.set(
        adminDb
          .collection("users")
          .doc(lead.assignedUserId)
          .collection("kpiMonths")
          .doc(monthKey),
        {
          monthKey,
          registrations: FieldValue.increment(1),
          revenue: FieldValue.increment(amountReceived),
          // Nested map rather than a dotted key: in set({merge:true}) a dotted
          // string is a literal field name, only update() reads it as a path.
          portfolio: { [dealCategory]: FieldValue.increment(amountReceived) },
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      // The admin has to be told, because nothing else in the product would
      // surface a deal sitting unsplit. The sentence names the Cut base and the
      // payment source rather than one headline figure: those are the two
      // numbers the admin is about to work with, and on three of the four types
      // they are not the same number.
      t.create(adminDb.collection("notifications").doc(), {
        type: "DEAL_CLOSED_REVIEW",
        leadId,
        dealId: leadId,
        targetRole: "admin",
        targetUid: null,
        payload: {
          message: `${customerName}: ${describeDealAmounts(amounts)} Finalize Profit Distribution.`,
          dealType,
          netProfit: profit,
          cutBase,
          payoutSource,
          totalPrice,
          downPayment,
          confirmationAmount,
          adjustment,
          remaining,
          receivedAmount,
          commission,
          amountReceived,
        },
        createdAt: FieldValue.serverTimestamp(),
        readAt: null,
      });

      t.create(leadRef.collection("events").doc(), {
        type: "DEAL_CLOSED",
        actorUid: auth.uid,
        at: FieldValue.serverTimestamp(),
        meta: {
          dealId: leadId,
          creditedTo: lead.assignedUserId,
          dealType,
          totalPrice,
          downPayment,
          confirmationAmount,
          adjustment,
          remaining,
          receivedAmount,
          commission,
          cutBase,
          payoutSource,
          amountReceived,
          payableAmount: legacyPayableAmount,
          profit,
        },
      });

      return { dealId: leadId, profit };
    });
  });
}

/**
 * The form supplies a plain date. Anchor it to midday so that rendering it back
 * in Asia/Karachi can't roll it onto the previous day.
 */
function parseDealDate(raw: string | undefined): Date {
  if (!raw) return new Date();

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
  if (!match) return new Date();

  const [, year, month, day] = match;
  const parsed = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), 12, 0, 0));

  if (Number.isNaN(parsed.getTime())) return new Date();
  if (parsed.getTime() > Date.now() + 24 * 60 * 60 * 1000) {
    throw new UserFacingError("The deal date cannot be in the future.");
  }

  return parsed;
}

/**
 * The admin corrects a closed deal (owner, 2026-09-24).
 *
 * Everything the Deal Entry form captured can be changed — the customer, what
 * was sold, the type and every figure, the payment method, category, date and
 * notes. The money is recomputed by `lib/dealAmounts` exactly as `closeDeal`
 * computes it, never read from the payload.
 *
 * - **Nothing is lost.** The values as they stood are appended to `revisions`
 *   with who changed them and when, and a `DEAL_EDITED` event goes on the lead.
 * - **The KPI counters move by the difference**, in the month the deal now
 *   belongs to — a corrected price, date or category does not leave revenue
 *   booked where it used to be.
 * - **A split already finalised goes back for re-splitting** when the money
 *   changes. The old split stays on record and is superseded when the new one
 *   is finalised, exactly as Reopen does; leaving the deal FINALIZED would show
 *   people paid on figures the deal no longer has.
 * - Who the deal is credited to does not change here.
 */
export async function updateClosedDeal(
  token: string,
  dealId: string,
  input: DealEntryInput
): Promise<ActionResult<{ dealId: string; profit: number; reopened: boolean }>> {
  return runAction("updateClosedDeal", async () => {
    const admin = await requireAdmin(token);

    const customerName = (input.customer?.name ?? "").trim();
    if (!customerName) throw new UserFacingError("Enter the customer's name.");
    const phoneDigits = toE164Digits(input.customer?.phone);
    if (!phoneDigits) throw new UserFacingError("Enter a valid contact number for the customer.");
    const serviceDescription = (input.serviceDescription ?? "").trim();
    if (!serviceDescription) {
      throw new UserFacingError("Describe what was sold, so the record makes sense later.");
    }
    const email = (input.customer?.email ?? "").trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new UserFacingError("That email address doesn't look right.");
    }

    const amountErrors = validateDealAmounts(input);
    if (amountErrors.length > 0) throw new UserFacingError(amountErrors[0]);
    const amounts = dealAmounts(input);
    // Absent means "unchanged", never "today" — an edit must not move a deal's
    // date because a box was left alone.
    const typedDate = input.dealDate ? parseDealDate(input.dealDate) : null;
    const dealCategory = normalizeDealCategory(input.dealCategory);

    return adminDb.runTransaction(async (t: Transaction) => {
      const dealRef = adminDb.collection("closedDeals").doc(dealId);
      const dealSnap = await t.get(dealRef);
      if (!dealSnap.exists) throw new UserFacingError("That deal no longer exists.");
      const before = dealSnap.data()!;

      const beforeDate: Date =
        typeof before.dealDate?.toDate === "function" ? before.dealDate.toDate() : new Date();
      const dealDate = typedDate ?? beforeDate;
      const beforeMonth = karachiMonthKey(beforeDate);
      const monthKey = karachiMonthKey(dealDate);
      const beforeCategory = normalizeDealCategory(before.dealCategory);
      const beforeRevenue = typeof before.amountReceived === "number" ? before.amountReceived : 0;

      const figures: Record<string, unknown> = {
        dealType: amounts.dealType,
        totalPrice: amounts.totalPrice,
        downPayment: amounts.downPayment,
        confirmationAmount: amounts.confirmationAmount,
        adjustment: amounts.adjustment,
        discount: amounts.discount,
        downPaymentKind: amounts.downPaymentKind,
        remaining: amounts.remaining,
        receivedAmount: amounts.receivedAmount,
        commission: amounts.commission,
        cutBase: amounts.cutBase,
        payoutSource: amounts.payoutSource,
        amountReceived: amounts.amountReceived,
        payableAmount: amounts.legacyPayableAmount,
        profit: amounts.profit,
      };
      const previous: Record<string, unknown> = {};
      for (const key of Object.keys(figures)) previous[key] = before[key] ?? null;
      const moneyChanged = Object.entries(figures).some(
        ([key, value]) => (before[key] ?? null) !== (value ?? null)
      );
      const reopened = moneyChanged && before.distributionStatus === "FINALIZED";

      t.update(dealRef, {
        customer: {
          name: customerName,
          phone: phoneDigits,
          email: email || null,
          cnic: (input.customer?.cnic ?? "").trim() || null,
          address: (input.customer?.address ?? "").trim() || null,
          city: (input.customer?.city ?? "").trim() || null,
        },
        serviceDescription,
        paymentMethod: input.paymentMethod || "Cash",
        dealCategory,
        notes: (input.notes ?? "").trim() || null,
        dealDate,
        ...figures,
        ...(reopened
          ? {
              distributionStatus: "PENDING",
              distributionReopenedAt: FieldValue.serverTimestamp(),
              distributionReopenedByUid: admin.uid,
            }
          : {}),
        editedAt: FieldValue.serverTimestamp(),
        editedByUid: admin.uid,
        revisions: FieldValue.arrayUnion({
          at: Timestamp.now(),
          byUid: admin.uid,
          previous: {
            ...previous,
            customer: before.customer ?? null,
            serviceDescription: before.serviceDescription ?? null,
            paymentMethod: before.paymentMethod ?? null,
            dealCategory: before.dealCategory ?? null,
            dealDate: before.dealDate ?? null,
            notes: before.notes ?? null,
          },
        }),
      });

      // **KPI: the old booking out, the new one in**, merged into one write
      // per month document so a same-month edit is a single increment.
      const creditUid = before.userId as string | undefined;
      if (creditUid) {
        type Move = { registrations: number; revenue: number; portfolio: Record<string, number> };
        const moves = new Map<string, Move>();
        const move = (month: string, registrations: number, revenue: number, category: string) => {
          const entry = moves.get(month) ?? { registrations: 0, revenue: 0, portfolio: {} };
          entry.registrations += registrations;
          entry.revenue += revenue;
          entry.portfolio[category] = (entry.portfolio[category] ?? 0) + revenue;
          moves.set(month, entry);
        };
        move(beforeMonth, -1, -beforeRevenue, beforeCategory);
        move(monthKey, 1, amounts.amountReceived, dealCategory);

        for (const [month, entry] of moves) {
          const portfolio: Record<string, FieldValue> = {};
          for (const [category, value] of Object.entries(entry.portfolio)) {
            if (value !== 0) portfolio[category] = FieldValue.increment(value);
          }
          const hasPortfolio = Object.keys(portfolio).length > 0;
          if (entry.registrations === 0 && entry.revenue === 0 && !hasPortfolio) continue;
          t.set(
            adminDb.collection("users").doc(creditUid).collection("kpiMonths").doc(month),
            {
              monthKey: month,
              ...(entry.registrations !== 0 ? { registrations: FieldValue.increment(entry.registrations) } : {}),
              ...(entry.revenue !== 0 ? { revenue: FieldValue.increment(entry.revenue) } : {}),
              ...(hasPortfolio ? { portfolio } : {}),
              updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true }
          );
        }
      }

      const leadId = (before.leadId as string | undefined) ?? dealId;
      t.create(adminDb.collection("leads").doc(leadId).collection("events").doc(), {
        type: "DEAL_EDITED",
        actorUid: admin.uid,
        at: FieldValue.serverTimestamp(),
        meta: { dealId, before: previous, after: figures, reopenedSplit: reopened },
      });

      if (reopened) {
        t.create(adminDb.collection("notifications").doc(), {
          type: "DEAL_CLOSED_REVIEW",
          leadId,
          dealId,
          targetRole: "admin",
          targetUid: null,
          payload: {
            message: `${customerName}: the deal was edited, so its profit split needs finalising again. ${describeDealAmounts(amounts)}`,
            dealType: amounts.dealType,
            cutBase: amounts.cutBase,
            payoutSource: amounts.payoutSource,
          },
          createdAt: FieldValue.serverTimestamp(),
          readAt: null,
        });
      }

      return { dealId, profit: amounts.profit, reopened };
    });
  });
}
