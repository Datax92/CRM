import 'server-only';

/**
 * Offering a freshly-arrived Meta lead to the priority lane.
 *
 * **The gap this closes.** `fileMetaLead` files a Facebook lead into the
 * admin's Data Bank, which is where the owner wants it — but there it simply
 * sat until somebody distributed it by hand. Meanwhile the whole accept
 * machinery (the 5-minute window, the popup, the cascade, the Railway sweep)
 * only ever engages for a lead that is `ASSIGNED` with a live deadline, and
 * nothing in the product produced one. The lane had no source.
 *
 * So a Meta lead is now **offered** the moment it lands: the record is promoted
 * into a lead assigned to whoever holds priority 1, `ASSIGNED` with a
 * five-minute window. Accept and it is theirs; pass or say nothing and it
 * cascades down the lane exactly as a missed lead always has.
 *
 * **Straight to the lane, no admin holding window.** The owner's call: these
 * are paid leads and the first call should not wait five minutes for an admin
 * who is probably not watching. The admin still sees it — the Meta Ads panel
 * counts it under *In pipeline* instead of *To give out* — and can reassign it
 * at any point.
 *
 * **Promotion, not duplication.** The record moves to `PROMOTED_FOLDER_ID` the
 * same way a hand-promoted row does, so one prospective client is one document
 * and two people can never be given the same number.
 *
 * **An empty lane leaves the record alone.** If nobody is available the record
 * stays in the Data Bank to be handed out by hand, rather than becoming a lead
 * with no owner. A record waiting in a folder is a normal state somebody can
 * act on; an unassigned lead is a thing to go and clean up.
 */

import { adminDb } from '@/lib/firebase/server';
import { owningSubAdminFor } from '@/lib/constants/hierarchy';
import { FieldValue, type Transaction } from 'firebase-admin/firestore';
import {
  getNextAssigneeAndState,
  readLaneEmployee,
  laneDisplayName,
  type CycleState,
  type Employee,
} from '@/lib/distribution';
import { ACCEPT_WINDOW_MS, ACCEPT_WINDOW_MINUTES } from '@/lib/constants/distribution';
import { PROMOTED_FOLDER_ID } from '@/lib/dataBank';
import { fileMetaLead, type FileResult } from './metaFiling';
import type { MetaLeadInput } from '@/lib/metaIntake';

export type MetaOfferOutcome =
  /** A lead was created and offered to somebody. */
  | 'OFFERED'
  /** Nobody is in the lane. The record stays in the Data Bank. */
  | 'NO_LANE'
  /** The record is gone, or somebody promoted it first. Not an error. */
  | 'SKIPPED';

export interface MetaOfferResult {
  outcome: MetaOfferOutcome;
  leadId: string | null;
  assignedTo: string | null;
  assigneeName: string | null;
}

/**
 * Promotes one just-filed Meta record into a lead and offers it to the lane.
 *
 * All of it in a single transaction, because the rotation counter is a
 * read-modify-write: two leads arriving together would otherwise both read the
 * same cycle state and both be handed to the same person, which is precisely
 * the unfairness the rotation exists to prevent.
 */
export async function offerMetaRecordToLane(recordId: string): Promise<MetaOfferResult> {
  return adminDb.runTransaction(async (t: Transaction) => {
    const recordRef = adminDb.collection('dataBankRecords').doc(recordId);

    /* ---- every read first; Firestore refuses a read after a write ---- */
    const recordSnap = await t.get(recordRef);
    if (!recordSnap.exists) {
      return { outcome: 'SKIPPED' as const, leadId: null, assignedTo: null, assigneeName: null };
    }
    const record = recordSnap.data()!;

    // Somebody promoted it by hand between filing and this call. Their decision
    // stands — re-offering it would hand one number to two people.
    if (record.promotedLeadId || record.folderId === PROMOTED_FOLDER_ID) {
      return { outcome: 'SKIPPED' as const, leadId: null, assignedTo: null, assigneeName: null };
    }

    const folderRef = adminDb.collection('dataBankFolders').doc(String(record.folderId));
    const folderSnap = await t.get(folderRef);
    const folder = folderSnap.data() ?? {};

    // Managers too — only the ones an admin has put in the rotation get a turn.
    const usersSnap = await t.get(adminDb.collection('users').where('role', 'in', ['employee', 'subadmin']));
    const employees: Employee[] = [];
    const profiles = new Map<string, Record<string, unknown>>();
    usersSnap.forEach((doc) => {
      employees.push(readLaneEmployee(doc.id, doc.data()));
      profiles.set(doc.id, doc.data());
    });

    const configRef = adminDb.collection('config').doc('distribution');
    const configSnap = await t.get(configRef);
    const cycleState: CycleState = configSnap.exists ? (configSnap.data()?.cycleState ?? {}) : {};

    const { uid: assignee, newState } = getNextAssigneeAndState(employees, cycleState);
    if (!assignee) {
      return { outcome: 'NO_LANE' as const, leadId: null, assignedTo: null, assigneeName: null };
    }

    const profile = profiles.get(assignee) ?? {};
    const assigneeName = laneDisplayName(profile);
    const recipientIsManager = profile.role === 'subadmin';

    /* ---- writes ---- */
    const now = FieldValue.serverTimestamp();
    const leadRef = adminDb.collection('leads').doc();

    /*
      Every column the form asked, carried onto the lead labelled as the folder
      labels it, so the rep sees what the customer actually typed. Same shape
      `promoteDataBankRecord` builds.
    */
    const labels = new Map(
      ((folder.fields ?? []) as Array<{ key: string; label: string }>).map((f) => [f.key, f.label])
    );
    const roles = (folder.roles ?? {}) as { name?: string; phone?: string };
    const customFields: Record<string, string> = {};
    for (const [key, value] of Object.entries((record.values ?? {}) as Record<string, string>)) {
      if (key === roles.name || key === roles.phone) continue;
      const label = labels.get(key);
      if (label && value) customFields[label] = value;
    }

    t.set(leadRef, {
      name: record.name ?? 'Unnamed lead',
      phone: record.phone ?? null,
      phoneKey: record.phoneKey ?? null,
      email: null,
      city: null,
      /*
        **`META_ADS`, not `DATA_BANK`.** The lead came from a Facebook ad and
        passed through the Data Bank on its way; `leadSourceDetail` reads the
        campaign name off these fields and prints "Meta Ads (Ramadan Offer)",
        which is the origin somebody actually needs. It is also what the
        employee's Meta Leads screen filters on.
      */
      source: 'META_ADS',
      campaignId: record.metaCampaignId ?? null,
      campaignName: record.metaCampaignName ?? null,
      adName: record.metaAdName ?? null,
      formId: record.metaFormId ?? null,
      // Provenance kept as well, so the folder it came through is still known.
      dataBankFolderId: record.folderId ?? null,
      dataBankFolderName: folder.name ?? null,
      notes: record.notes ?? null,

      status: 'ASSIGNED',
      assignedUserId: assignee,
      assigneeName,
      // The recipient's team — their own uid for a manager, or a Sales manager
      // could not read the lead they were just offered.
      subAdminUid: owningSubAdminFor({
        uid: assignee,
        role: profile.role,
        subAdminUid: (profile.subAdminUid as string | undefined) ?? null,
      }),
      distributionMethod: 'AUTO',
      acceptDeadlineAt: new Date(Date.now() + ACCEPT_WINDOW_MS),
      attemptedAssignees: [assignee],
      autoRotationCycleSnapshot: newState,

      followUpCount: 0,
      callCount: 0,
      customFields,
      createdAt: now,
      assignedAt: now,
      lastActivityAt: now,
      metaCreatedTime: record.metaSubmittedAt ?? null,
    });

    t.create(leadRef.collection('events').doc(), {
      type: 'AUTO_ASSIGNED',
      actorUid: 'system:meta',
      at: now,
      meta: {
        assignedTo: assignee,
        rotationCounts: newState,
        promotedFrom: record.folderId ?? null,
        promotedFromName: folder.name ?? null,
      },
    });

    /*
      **A write, not a delete** — the standing rule here. Deletes are a separate
      daily allowance from writes, and when it is spent Firestore refuses them
      while still accepting writes, which would take the whole transaction down
      and stop leads being created at all.
    */
    t.update(recordRef, {
      folderId: PROMOTED_FOLDER_ID,
      promotedFromFolderId: record.folderId,
      promotedLeadId: leadRef.id,
      promotedToUid: assignee,
      promotedAt: now,
    });

    if (folderSnap.exists) {
      t.update(folderRef, {
        recordCount: FieldValue.increment(-1),
        promotedCount: FieldValue.increment(1),
      });
    }

    t.set(adminDb.collection('notifications').doc(), {
      type: 'NEW_LEAD_ASSIGNED',
      leadId: leadRef.id,
      targetRole: recipientIsManager ? 'subadmin' : 'employee',
      targetUid: assignee,
      payload: {
        message: `New Facebook lead: ${record.name ?? 'Unnamed lead'}. You have ${ACCEPT_WINDOW_MINUTES} minutes to accept.`,
      },
      createdAt: now,
      readAt: null,
    });

    t.set(configRef, { cycleState: newState, updatedAt: now }, { merge: true });

    return {
      outcome: 'OFFERED' as const,
      leadId: leadRef.id,
      assignedTo: assignee,
      assigneeName,
    };
  });
}

/**
 * File a Meta lead and immediately offer it to the lane.
 *
 * **One function, because there are two doors.** The direct Meta webhook and
 * the Make.com bridge both take delivery of the same lead, and if each did its
 * own filing-then-offering the two would eventually disagree about what happens
 * to a Facebook lead depending on which route Meta happened to use.
 *
 * **Offering can fail without the filing failing.** By the time it runs the
 * record is already safely in the Data Bank, which is a perfectly good state —
 * the admin distributes it by hand. Letting a distribution problem bubble up
 * would make the webhook answer non-2xx and Meta redeliver a lead that was
 * already stored, which is how one submission becomes two rows.
 */
export async function fileAndOfferMetaLead(
  lead: MetaLeadInput
): Promise<FileResult & { offer: MetaOfferResult | null }> {
  const filed = await fileMetaLead(lead);

  if (filed.outcome !== 'CREATED' || !filed.recordId) {
    return { ...filed, offer: null };
  }

  try {
    const offer = await offerMetaRecordToLane(filed.recordId);
    return { ...filed, offer };
  } catch (error) {
    // Recorded rather than thrown: the lead is filed and reachable, and this
    // is the difference between "nobody was offered it yet" and "we lost it".
    console.error('[meta] Filed the lead but could not offer it to the lane:', error);
    return { ...filed, offer: null };
  }
}
