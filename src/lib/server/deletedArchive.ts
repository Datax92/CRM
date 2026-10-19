import { adminDb } from "@/lib/firebase/server";
import { FieldValue, type DocumentSnapshot, type Transaction, type WriteBatch } from "firebase-admin/firestore";
import type { DecodedAuth } from "@/lib/firebase/serverAuth";

/**
 * **Nothing about money is erased.** A deleted money record is copied whole into
 * `deletedRecords` — who removed it, when, and every field it held — in the same
 * batch that removes it, so the delete and its copy cannot come apart.
 *
 * The live collections stay clean (balances, rollups and statements read them
 * and must not count a removed row), while the archive answers "where did that
 * 200,000 go" for as long as anybody asks. Server-only: the catch-all rule
 * denies clients, and the screens read it through `listDeletedForAccount`.
 *
 * `accountId` is lifted to the top level so one equality query finds every row
 * removed from an account, with no index to deploy.
 */
export const DELETED_RECORDS = "deletedRecords";

export function archiveInBatch(
  batch: WriteBatch,
  snap: DocumentSnapshot,
  auth: Pick<DecodedAuth, "uid" | "name" | "email">,
  reason: string
): void {
  if (!snap.exists) return;
  batch.set(adminDb.collection(DELETED_RECORDS).doc(), archiveRecord(snap, auth, reason));
}

/** The same copy, written inside a Firestore transaction. */
export function archiveInTransaction(
  t: Transaction,
  snap: DocumentSnapshot,
  auth: Pick<DecodedAuth, "uid" | "name" | "email">,
  reason: string
): void {
  if (!snap.exists) return;
  t.set(adminDb.collection(DELETED_RECORDS).doc(), archiveRecord(snap, auth, reason));
}

function archiveRecord(
  snap: DocumentSnapshot,
  auth: Pick<DecodedAuth, "uid" | "name" | "email">,
  reason: string
): Record<string, unknown> {
  const data = snap.data() ?? {};
  return {
    collection: snap.ref.parent.path,
    docId: snap.id,
    accountId: typeof data.accountId === "string" ? data.accountId : null,
    data,
    reason,
    deletedAt: FieldValue.serverTimestamp(),
    deletedAtIso: new Date().toISOString(),
    deletedByUid: auth.uid,
    deletedByName: auth.name ?? auth.email ?? null,
  };
}
