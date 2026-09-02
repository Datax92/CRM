"use server";

/**
 * Know Your Client — the confirmed client record behind a lead.
 *
 * One write does three things, and they have to be atomic: store the KYC map,
 * mirror the four shared columns onto the lead so every list and search shows
 * the confirmed values, and append an audit event. A partial version of that —
 * KYC saved but the lead row still showing the ad form's misspelling — is
 * exactly the inconsistency the feature exists to remove, so it is a
 * transaction rather than three writes.
 *
 * Validation is `lib/kyc.validateKyc`, the same function the form runs as the
 * user types. The client's copy is a convenience; this one is the rule.
 */

import { adminDb } from "@/lib/firebase/server";
import { verifyAuth, type DecodedAuth } from "@/lib/firebase/serverAuth";
import { runAction, UserFacingError, type ActionResult } from "@/lib/actionResult";
import { validateKyc, leadPatchFromKyc, type KycValues } from "@/lib/kyc";
import { FieldValue, Transaction } from "firebase-admin/firestore";

/**
 * Who may edit a lead's client record.
 *
 * The assigned employee, their sub admin, or an admin. Deliberately the same
 * test the lead's own status changes use — a person who can move a lead
 * through the pipeline is a person who can record who the client is.
 */
function canEditLead(auth: DecodedAuth, lead: Record<string, unknown>): boolean {
  if (auth.role === "admin") return true;
  if (auth.role === "subadmin") return lead.subAdminUid === auth.uid;
  return lead.assignedUserId === auth.uid;
}

export async function saveKyc(
  token: string,
  leadId: string,
  values: KycValues
): Promise<ActionResult<{ values: KycValues }>> {
  return runAction("saveKyc", async () => {
    const auth = await verifyAuth(token);

    const { values: clean, errors } = validateKyc(values ?? {});
    if (errors.length > 0) {
      throw new UserFacingError(errors[0]);
    }

    await adminDb.runTransaction(async (t: Transaction) => {
      const leadRef = adminDb.collection("leads").doc(leadId);
      const snap = await t.get(leadRef);

      if (!snap.exists) {
        throw new UserFacingError("That lead no longer exists.");
      }

      const lead = snap.data()!;
      if (!canEditLead(auth, lead)) {
        throw new UserFacingError("This lead is not assigned to you.");
      }

      // The lead's own columns follow the KYC, but only where the KYC has an
      // answer — an empty KYC email must not wipe the address the ad form
      // supplied, which may be the only one anybody has.
      const mirrored = leadPatchFromKyc(clean);

      // Which of the shared columns this save actually moved. Recorded on the
      // event so the audit trail says "email and city updated", not merely
      // "somebody opened the KYC form".
      const changed = Object.entries(mirrored)
        .filter(([field, value]) => (lead[field] ?? null) !== value)
        .map(([field]) => field);

      t.update(leadRef, {
        kyc: clean,
        kycUpdatedAt: FieldValue.serverTimestamp(),
        kycUpdatedByUid: auth.uid,
        ...mirrored,
        lastActivityAt: FieldValue.serverTimestamp(),
      });

      t.create(leadRef.collection("events").doc(), {
        type: "KYC_UPDATED",
        actorUid: auth.uid,
        at: FieldValue.serverTimestamp(),
        meta: {
          fieldsFilled: Object.keys(clean).length,
          leadFieldsUpdated: changed,
        },
      });
    });

    return { values: clean };
  });
}
