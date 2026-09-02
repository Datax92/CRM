"use server";

import { adminDb } from "@/lib/firebase/server";
import { requireAdmin } from "@/lib/firebase/serverAuth";
import { runAction, UserFacingError, type ActionResult } from "@/lib/actionResult";
import { FieldValue } from "firebase-admin/firestore";

/**
 * Alerts are admin-facing (FR-19). Marking one read is a soft acknowledgement —
 * the document is kept so the audit record of what was raised, and when it was
 * seen, survives.
 */
export async function markNotificationRead(
  token: string,
  notificationId: string
): Promise<ActionResult> {
  return runAction("markNotificationRead", async () => {
    const admin = await requireAdmin(token);

    const ref = adminDb.collection("notifications").doc(notificationId);
    const snap = await ref.get();
    if (!snap.exists) {
      throw new UserFacingError("That alert no longer exists.");
    }
    if (snap.data()?.readAt) return;

    await ref.update({
      readAt: FieldValue.serverTimestamp(),
      readByUid: admin.uid,
    });
  });
}

/** Clears the whole unread queue in one action. */
export async function markAllNotificationsRead(token: string): Promise<ActionResult<{ cleared: number }>> {
  return runAction("markAllNotificationsRead", async () => {
    const admin = await requireAdmin(token);

    const unread = await adminDb
      .collection("notifications")
      .where("readAt", "==", null)
      .limit(400)
      .get();

    if (unread.empty) return { cleared: 0 };

    const batch = adminDb.batch();
    for (const doc of unread.docs) {
      batch.update(doc.ref, {
        readAt: FieldValue.serverTimestamp(),
        readByUid: admin.uid,
      });
    }
    await batch.commit();

    return { cleared: unread.size };
  });
}
