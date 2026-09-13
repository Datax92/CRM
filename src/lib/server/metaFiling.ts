/**
 * Filing a Meta lead into the Data Bank.
 *
 * **One implementation, two doors.** Meta's own `leadgen` webhook is the
 * eventual route; until App Review completes, an approved intermediary
 * (Make.com / Zapier) posts the same leads at `/api/webhooks/meta-bridge`.
 * Both call `fileMetaLead`, so a lead is filed identically whichever way it
 * arrived — which is what makes switching the bridge off a no-op rather than a
 * migration.
 *
 * **The folder is created by the first lead that needs it**, keyed on the
 * campaign/form/ad *id*. That is the whole of "autonomous": the client launches
 * a campaign next month and its folder appears by itself, correctly named, with
 * nobody touching the CRM.
 *
 * **Duplicates are refused twice over**, because Meta retries and an
 * intermediary can replay:
 *  - the `leadgenId` is the record's document id, so the same submission can
 *    never be written twice whatever the route;
 *  - the phone number is checked against the folder, the same rule a hand-typed
 *    row obeys, so one person filling two forms is not two rows.
 */

import { adminDb } from '@/lib/firebase/server';
import { FieldValue } from 'firebase-admin/firestore';
import { phoneKey } from '@/lib/dataBank';
import {
  buildMetaRecord,
  metaFolderId,
  resolveMetaSource,
  META_FOLDER_FIELDS,
  META_FOLDER_ROLES,
  type MetaLeadInput,
} from '@/lib/metaIntake';

const FOLDERS = 'dataBankFolders';
const RECORDS = 'dataBankRecords';

export type FileOutcome = 'CREATED' | 'DUPLICATE_LEAD' | 'DUPLICATE_PHONE' | 'NO_PHONE';

export interface FileResult {
  outcome: FileOutcome;
  folderId: string;
  folderName: string;
  recordId: string | null;
}

/**
 * Files one lead, creating its folder if this is the first from that ad.
 *
 * Never throws for an *expected* condition — a duplicate or a missing phone
 * number comes back as an outcome so the caller can answer Meta with a 200 and
 * stop it retrying something that will never succeed. Only a genuine failure
 * (Firestore unreachable) throws, because that one *should* be retried.
 */
export async function fileMetaLead(lead: MetaLeadInput): Promise<FileResult> {
  const source = resolveMetaSource(lead);
  const folderId = metaFolderId(source);
  const folderRef = adminDb.collection(FOLDERS).doc(folderId);
  const { values, extraFields } = buildMetaRecord(lead);

  /*
    The record id **is** Meta's leadgen id, so redelivery is harmless: the
    second write of the same submission fails the `create` and is reported as a
    duplicate rather than producing a second row.
  */
  const recordRef = adminDb.collection(RECORDS).doc(`meta_${lead.leadgenId}`);
  if ((await recordRef.get()).exists) {
    return { outcome: 'DUPLICATE_LEAD', folderId, folderName: source.label, recordId: recordRef.id };
  }

  const phone = String(values[META_FOLDER_ROLES.phone] ?? '').trim();
  const key = phoneKey(phone);
  if (!key) {
    return { outcome: 'NO_PHONE', folderId, folderName: source.label, recordId: null };
  }

  const folderSnap = await folderRef.get();
  if (!folderSnap.exists) {
    await folderRef.set({
      name: source.label,
      code: 'META',
      description: `Leads from the Meta ad "${source.label}". Created automatically on the first lead.`,
      fields: [...META_FOLDER_FIELDS, ...extraFields],
      roles: { ...META_FOLDER_ROLES },
      recordCount: 0,
      promotedCount: 0,
      handedOffCount: 0,
      /*
        **The admin's folder, deliberately.** A Meta lead belongs to nobody
        until somebody distributes it; filing it under a manager would hide it
        from the admin queue, which is where the owner wants these to land.
      */
      subAdminUid: null,
      metaSource: {
        key: source.key,
        basis: source.basis,
        campaignId: source.campaignId,
        formId: source.formId,
        adId: source.adId,
      },
      createdByUid: 'system:meta',
      createdAt: FieldValue.serverTimestamp(),
    });
  } else {
    /*
      The folder exists. Two things are kept current, and nothing else is
      touched: the label, so an Ads Manager rename shows here; and any column
      this form asks that the folder has not seen before, so a question added to
      a live form does not silently lose its answers.
    */
    const data = folderSnap.data() ?? {};
    const known = new Set(
      ((data.fields ?? []) as Array<{ key: string }>).map((field) => field.key)
    );
    const missing = extraFields.filter((field) => !known.has(field.key));
    const patch: Record<string, unknown> = {};
    if (source.label && data.name !== source.label) patch.name = source.label;
    if (missing.length > 0) patch.fields = FieldValue.arrayUnion(...missing);
    if (Object.keys(patch).length > 0) await folderRef.update(patch);
  }

  /*
    **The same duplicate-phone rule a hand-typed row obeys.** Scoped to this
    folder, which is the project's standing decision: two different campaigns
    legitimately reach the same person, and a global rule would refuse the
    second ad's leads entirely.
  */
  const clash = await adminDb
    .collection(RECORDS)
    .where('folderId', '==', folderId)
    .where('phoneKey', '==', key)
    .limit(1)
    .get();
  if (!clash.empty) {
    return { outcome: 'DUPLICATE_PHONE', folderId, folderName: source.label, recordId: clash.docs[0].id };
  }

  await recordRef.create({
    folderId,
    values,
    name: String(values[META_FOLDER_ROLES.name] ?? '').trim() || 'Unnamed lead',
    phone,
    phoneKey: key,
    status: 'NEW',
    notes: null,
    source: 'META_ADS',
    // Provenance, frozen on the row — a campaign renamed later must not restate
    // where this particular lead came from.
    metaLeadgenId: lead.leadgenId,
    metaCampaignId: source.campaignId,
    metaCampaignName: lead.campaignName ?? null,
    metaFormId: source.formId,
    metaFormName: lead.formName ?? null,
    metaAdId: source.adId,
    metaAdName: lead.adName ?? null,
    metaSubmittedAt: lead.submittedAt ?? null,
    addedByUid: 'system:meta',
    createdAt: FieldValue.serverTimestamp(),
  });

  await folderRef.update({
    recordCount: FieldValue.increment(1),
    lastLeadAt: FieldValue.serverTimestamp(),
  });

  return { outcome: 'CREATED', folderId, folderName: source.label, recordId: recordRef.id };
}

/**
 * Tells the admin a lead arrived, at most once per folder per day.
 *
 * A notification per lead would bury every other alert the moment a campaign
 * performs — the project already has 481 unread notifications from being too
 * talkative. One per source per day says the same thing usefully.
 */
export async function notifyMetaLead(folderId: string, folderName: string, dayKey: string): Promise<void> {
  const ref = adminDb.collection('notifications').doc(`metalead_${folderId}_${dayKey}`);
  await ref.set(
    {
      type: 'DATA_BANK_ASSIGNED',
      leadId: null,
      targetRole: 'admin',
      targetUid: null,
      payload: {
        message: `New Facebook leads arrived in "${folderName}". Open Meta Ads to distribute them.`,
        folderId,
      },
      createdAt: FieldValue.serverTimestamp(),
      readAt: null,
    },
    { merge: true }
  );
}
