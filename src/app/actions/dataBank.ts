"use server";

/**
 * Data Bank writes — folders, records, imports and promotion.
 *
 * Admin-only throughout. Cold lists are a company asset: an employee gets a
 * lead when an admin promotes one to them, never by browsing the source data.
 *
 * Imports are the one operation here that is genuinely large. They are written
 * in batches of 500 (Firestore's hard cap) and the client sends one chunk at a
 * time, so a 20,000-row sheet arrives as a sequence of calls with a progress
 * bar rather than one request that times out halfway and leaves the folder in
 * an unknown state.
 */

import { adminDb } from "@/lib/firebase/server";
import {
  requireAdmin,
  requireManager,
  assertManagesFolder,
  type DecodedAuth,
} from "@/lib/firebase/serverAuth";
import { runAction, UserFacingError, type ActionResult } from "@/lib/actionResult";
import { FieldValue } from "firebase-admin/firestore";
import {
  fieldKeyFor,
  phoneKey,
  MAX_FIELDS_PER_FOLDER,
  PROMOTED_FOLDER_ID,
  WRITE_BATCH_SIZE,
  RECORD_STATUSES,
  type ColumnMap,
  type DataBankField,
  type DataBankStatus,
  type FieldRoles,
} from "@/lib/dataBank";

const FOLDERS = "dataBankFolders";
const RECORDS = "dataBankRecords";

/* -------------------------------------------------------------------------- */
/* Folders                                                                     */
/* -------------------------------------------------------------------------- */

export interface FolderInput {
  name: string;
  code?: string | null;
  description?: string | null;
  /** Labels in display order. Keys are assigned here, never by the client. */
  fields: Array<{ key?: string; label: string }>;
  /** Indexes into `fields` — which one is the name, which the phone. */
  nameIndex: number;
  phoneIndex: number;
  /**
   * The sub admin this folder is handed to, or `null` for admin-only.
   *
   * Stored on the folder rather than as a list on the sub admin for the same
   * reason the employee link is stored on the employee: a Security Rule can
   * prove `where('subAdminUid','==',me)` is safe, and cannot prove anything
   * about a scope that lives in a different document.
   */
  subAdminUid?: string | null;
}

/** Validates a proposed folder owner. Only an actual sub admin may hold one. */
async function resolveFolderOwner(raw: string | null | undefined): Promise<string | null> {
  const uid = (raw ?? "").trim();
  if (!uid) return null;

  const snap = await adminDb.collection("users").doc(uid).get();
  if (!snap.exists || snap.data()?.role !== "subadmin") {
    throw new UserFacingError("Choose a sub admin, or leave the folder with the admin.");
  }
  return uid;
}

/**
 * Normalises a submitted field list.
 *
 * Keys for existing fields are preserved so records keep resolving; new fields
 * get a fresh key derived from the label. Renaming a label therefore never
 * orphans data, which is the whole reason keys and labels are separate.
 */
function normalizeFields(input: FolderInput): { fields: DataBankField[]; roles: FieldRoles } {
  const seen = new Set<string>();
  const fields: DataBankField[] = [];

  for (const raw of input.fields) {
    const label = (raw.label ?? "").trim();
    if (!label) continue;
    const key = raw.key && !seen.has(raw.key) ? raw.key : fieldKeyFor(label, seen);
    seen.add(key);
    fields.push({ key, label });
  }

  if (fields.length === 0) {
    throw new UserFacingError("Add at least one field — the columns your sheet has.");
  }
  if (fields.length > MAX_FIELDS_PER_FOLDER) {
    throw new UserFacingError(`A folder can hold up to ${MAX_FIELDS_PER_FOLDER} fields.`);
  }

  const name = fields[input.nameIndex]?.key;
  const phone = fields[input.phoneIndex]?.key;
  if (!name || !phone) {
    throw new UserFacingError("Choose which field is the name and which is the phone number.");
  }
  if (name === phone) {
    throw new UserFacingError("The name and the phone number must be two different fields.");
  }

  return { fields, roles: { name, phone } };
}

/**
 * Creates a folder.
 *
 * **Both managing roles.** A manager building their own cold list — a walk-in
 * sheet, an event sign-up, numbers they sourced themselves — is the ordinary
 * case, and it was refused: only the admin could make a folder, so a manager's
 * Data Bank held nothing but the mirrors an admin had handed them. What stays
 * the admin's is *whose* folder it is: a manager's is always their own, and the
 * owner field is taken from their token rather than from the request, so no
 * amount of crafting lets one manager file a folder under another.
 */
export async function createDataBankFolder(
  token: string,
  input: FolderInput
): Promise<ActionResult<{ folderId: string }>> {
  return runAction("createDataBankFolder", async () => {
    const admin = await requireManager(token);
    const name = (input.name ?? "").trim();
    if (!name) throw new UserFacingError("Enter a name for the folder.");

    const { fields, roles } = normalizeFields(input);
    // The admin may hand the folder to somebody; a manager gets their own and
    // is never asked. Read from the verified token, not the payload.
    const subAdminUid =
      admin.role === "admin" ? await resolveFolderOwner(input.subAdminUid) : admin.uid;

    const ref = await adminDb.collection(FOLDERS).add({
      name,
      // Absent means "the admin's own folder", which is what every folder that
      // predates the hierarchy means. Nothing needs migrating.
      ...(subAdminUid ? { subAdminUid } : {}),
      code: (input.code ?? "").trim() || null,
      description: (input.description ?? "").trim() || null,
      fields,
      roles,
      columnMap: {},
      recordCount: 0,
      promotedCount: 0,
      addedByUid: admin.uid,
      createdAt: FieldValue.serverTimestamp(),
    });

    return { folderId: ref.id };
  });
}

/**
 * Renames a folder and changes its columns.
 *
 * A manager may edit their own; **only the admin may move one between owners**,
 * which is why `subAdminUid` is ignored outright for a manager rather than
 * validated. Handing a cold list to somebody is the decision the admin owns,
 * and a manager who could reassign their own folder could give it away.
 */
export async function updateDataBankFolder(
  token: string,
  folderId: string,
  input: FolderInput
): Promise<ActionResult> {
  return runAction("updateDataBankFolder", async () => {
    const auth = await requireManager(token);
    const name = (input.name ?? "").trim();
    if (!name) throw new UserFacingError("Enter a name for the folder.");

    const ref = adminDb.collection(FOLDERS).doc(folderId);
    const snap = await ref.get();
    if (!snap.exists) throw new UserFacingError("That folder no longer exists.");

    assertFolderAccess(auth, {
      subAdminUid: (snap.data()?.subAdminUid as string | undefined) ?? null,
    });

    const { fields, roles } = normalizeFields(input);

    // Removing a field leaves its values on existing records rather than
    // rewriting thousands of documents. They stop displaying; nothing is lost,
    // and re-adding the field brings them back.
    const subAdminUid =
      auth.role !== "admin" || input.subAdminUid === undefined
        ? undefined
        : await resolveFolderOwner(input.subAdminUid);

    await ref.update({
      name,
      code: (input.code ?? "").trim() || null,
      description: (input.description ?? "").trim() || null,
      fields,
      roles,
      ...(subAdminUid === undefined
        ? {}
        : { subAdminUid: subAdminUid ?? FieldValue.delete() }),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
}

/**
 * Deletes a folder and every record in it.
 *
 * Records are removed in batches before the folder itself, so a failure
 * halfway leaves a folder with fewer rows rather than orphaned rows with no
 * folder — which would be invisible in the UI and impossible to clean up.
 */
export async function deleteDataBankFolder(
  token: string,
  folderId: string
): Promise<ActionResult<{ deleted: number }>> {
  return runAction("deleteDataBankFolder", async () => {
    const auth = await requireManager(token);

    // Their own folder only. `assertFolderAccess` is the same predicate every
    // record write in this module already goes through, so a manager cannot
    // delete a list they were merely shown.
    const folderSnap = await adminDb.collection(FOLDERS).doc(folderId).get();
    if (folderSnap.exists) {
      assertFolderAccess(auth, {
        subAdminUid: (folderSnap.data()?.subAdminUid as string | undefined) ?? null,
      });
    }

    let deleted = 0;
    // Two passes: the folder's live rows, then any promoted row whose
    // tombstone outlived its own delete (see `PROMOTED_FOLDER_ID`). Without
    // the second pass those documents become unreachable — their `folderId`
    // no longer names a folder that exists.
    for (const [field, value] of [
      ["folderId", folderId],
      ["promotedFromFolderId", folderId],
    ] as const) {
      for (;;) {
        const page = await adminDb
          .collection(RECORDS)
          .where(field, "==", value)
          .limit(WRITE_BATCH_SIZE)
          .get();
        if (page.empty) break;

        const batch = adminDb.batch();
        page.docs.forEach((doc) => batch.delete(doc.ref));
        await batch.commit();
        deleted += page.size;
      }
    }

    await adminDb.collection(FOLDERS).doc(folderId).delete();
    return { deleted };
  });
}

/** Remembers the admin's column choices so the next import is one click. */
export async function saveColumnMap(
  token: string,
  folderId: string,
  columnMap: ColumnMap
): Promise<ActionResult> {
  return runAction("saveColumnMap", async () => {
    const auth = await requireManager(token);
    await assertManagesFolder(auth, folderId);
    await adminDb.collection(FOLDERS).doc(folderId).update({ columnMap });
  });
}

/* -------------------------------------------------------------------------- */
/* Records                                                                     */
/* -------------------------------------------------------------------------- */

interface IncomingRow {
  values: Record<string, string>;
}

async function loadFolder(folderId: string) {
  const snap = await adminDb.collection(FOLDERS).doc(folderId).get();
  if (!snap.exists) throw new UserFacingError("That folder no longer exists.");
  const data = snap.data() as {
    name?: string;
    fields: DataBankField[];
    roles: FieldRoles;
    subAdminUid?: string | null;
    sourceFolderId?: string | null;
    sourceFolderName?: string | null;
    handedOffCount?: number;
  };
  // `name` comes back here so callers never re-read the document for it —
  // promotion used to fetch this same folder a second time just for the name.
  return {
    ref: snap.ref,
    name: data.name ?? null,
    fields: data.fields ?? [],
    roles: data.roles,
    subAdminUid: data.subAdminUid ?? null,
    // Set on a manager's mirror (see `ensureManagerFolder`). A lead promoted
    // out of a mirror is filed under the *original* folder, so one source does
    // not fragment into a Client folder per manager who touched it.
    sourceFolderId: data.sourceFolderId ?? null,
    sourceFolderName: data.sourceFolderName ?? null,
    // How many rows have left for a manager's mirror. Read here so the import
    // can skip the mirror lookup entirely when the answer is none.
    handedOffCount: data.handedOffCount ?? 0,
  };
}

/**
 * The managers' mirrors of a folder, if it has handed anything on.
 *
 * Read from the folders rather than kept as a list on the source, so a mirror
 * created later is found without the source ever being written to.
 */
async function mirrorFolderIds(folderId: string): Promise<string[]> {
  const snap = await adminDb.collection(FOLDERS).where("sourceFolderId", "==", folderId).get();
  return snap.docs.map((doc) => doc.id);
}

/**
 * Throws unless this caller may work this folder.
 *
 * Takes the folder that has already been read rather than re-reading it: every
 * caller here has it in hand, and a second get() per record write would double
 * the cost of an import for a check whose answer cannot have changed.
 */
function assertFolderAccess(auth: DecodedAuth, folder: { subAdminUid: string | null }): void {
  if (auth.role === "admin") return;
  if (auth.role === "subadmin" && folder.subAdminUid === auth.uid) return;
  throw new UserFacingError("That folder has not been assigned to you.");
}

/**
 * Builds the stored shape of one row.
 *
 * `name` and `phone` are lifted out of the free-form values into real columns
 * because the app queries and displays them; everything else stays in `values`
 * exactly as the source named it.
 */
function buildRecord(
  values: Record<string, string>,
  fields: DataBankField[],
  roles: FieldRoles
) {
  const valid = new Set(fields.map((field) => field.key));
  const clean: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    if (valid.has(key)) clean[key] = String(value ?? "").trim();
  }

  const name = (clean[roles.name] ?? "").trim();
  const phone = (clean[roles.phone] ?? "").trim();
  return { values: clean, name, phone, phoneKey: phoneKey(phone) };
}

export async function addDataBankRecord(
  token: string,
  folderId: string,
  values: Record<string, string>
): Promise<ActionResult<{ recordId: string }>> {
  return runAction("addDataBankRecord", async () => {
    const admin = await requireManager(token);
    const folder = await loadFolder(folderId);
    assertFolderAccess(admin, folder);
    const record = buildRecord(values, folder.fields, folder.roles);

    if (!record.name) throw new UserFacingError("Enter the name.");
    if (!record.phoneKey) throw new UserFacingError("Enter a usable phone number.");

    // The folder, plus any mirror a manager has been handed rows into — a row
    // that left for a manager is still one row for one prospective client, and
    // typing it again here would make two. Same rule the import follows.
    const scope = [
      folderId,
      ...(folder.handedOffCount > 0 ? await mirrorFolderIds(folderId) : []),
    ];
    for (const id of scope) {
      const clash = await adminDb
        .collection(RECORDS)
        .where("folderId", "==", id)
        .where("phoneKey", "==", record.phoneKey)
        .limit(1)
        .get();
      if (!clash.empty) {
        const name = clash.docs[0].data().name;
        throw new UserFacingError(
          id === folderId
            ? `That number is already in this folder (${name}).`
            : `That number has already been handed to a manager (${name}).`
        );
      }
    }

    const ref = await adminDb.collection(RECORDS).add({
      folderId,
      ...record,
      status: "NEW" as DataBankStatus,
      notes: null,
      addedByUid: admin.uid,
      createdAt: FieldValue.serverTimestamp(),
    });
    await folder.ref.update({ recordCount: FieldValue.increment(1) });

    return { recordId: ref.id };
  });
}

export async function updateDataBankRecord(
  token: string,
  recordId: string,
  input: { values?: Record<string, string>; status?: DataBankStatus; notes?: string | null }
): Promise<ActionResult> {
  return runAction("updateDataBankRecord", async () => {
    const auth = await requireManager(token);
    const ref = adminDb.collection(RECORDS).doc(recordId);
    const snap = await ref.get();
    if (!snap.exists) throw new UserFacingError("That record no longer exists.");

    // A sub admin may edit rows in their own folders and nowhere else, so the
    // folder is read even when only the status is changing.
    const owningFolder = await loadFolder(snap.data()!.folderId as string);
    assertFolderAccess(auth, owningFolder);

    const patch: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };

    if (input.values) {
      const folder = owningFolder;
      const record = buildRecord(input.values, folder.fields, folder.roles);
      if (!record.name) throw new UserFacingError("Enter the name.");
      if (!record.phoneKey) throw new UserFacingError("Enter a usable phone number.");
      Object.assign(patch, record);
    }
    if (input.status && RECORD_STATUSES.includes(input.status)) patch.status = input.status;
    if (input.notes !== undefined) patch.notes = (input.notes ?? "").trim() || null;

    await ref.update(patch);
  });
}

export async function deleteDataBankRecord(
  token: string,
  recordId: string
): Promise<ActionResult> {
  return runAction("deleteDataBankRecord", async () => {
    const auth = await requireManager(token);
    const ref = adminDb.collection(RECORDS).doc(recordId);
    const snap = await ref.get();
    if (!snap.exists) return;

    const folderId = snap.data()!.folderId as string;
    assertFolderAccess(auth, await loadFolder(folderId));
    await ref.delete();
    await adminDb
      .collection(FOLDERS)
      .doc(folderId)
      .update({ recordCount: FieldValue.increment(-1) });
  });
}

/* -------------------------------------------------------------------------- */
/* Import                                                                      */
/* -------------------------------------------------------------------------- */

export interface ImportChunkResult {
  written: number;
  /** Rows skipped because that number is already in the folder. */
  duplicates: number;
}

/**
 * Writes one chunk of an import.
 *
 * The client parses the file, maps the columns and sends up to 500 rows at a
 * time. Chunking is the client's job because it also owns the progress bar;
 * the server's job is to check the rows against what is already in the folder
 * and write them atomically.
 *
 * **Existing numbers are skipped, never overwritten.** Re-importing last
 * month's sheet on top of this month's should not wipe the statuses somebody
 * has been setting all week.
 */
export async function importDataBankRows(
  token: string,
  folderId: string,
  rows: IncomingRow[]
): Promise<ActionResult<ImportChunkResult>> {
  return runAction("importDataBankRows", async () => {
    const admin = await requireManager(token);
    if (rows.length === 0) return { written: 0, duplicates: 0 };
    if (rows.length > WRITE_BATCH_SIZE) {
      throw new UserFacingError(`Send at most ${WRITE_BATCH_SIZE} rows at a time.`);
    }

    const folder = await loadFolder(folderId);
    assertFolderAccess(admin, folder);
    const prepared = rows
      .map((row) => buildRecord(row.values, folder.fields, folder.roles))
      .filter((record) => record.name && record.phoneKey);

    // Which of these numbers are already held? Firestore's `in` takes 30
    // values, so this is a handful of reads per chunk rather than one per row.
    //
    // **Rows handed to a manager count as held.** They have left this folder
    // for a mirror of it (`assignRecordsToManager`), so a query scoped to
    // `folderId` alone would not see them — and re-importing last month's
    // sheet would recreate every handed-over row here, leaving two documents
    // for one prospective client and two people ringing the same number.
    //
    // Deliberately one query **per folder** rather than one query with an `in`
    // on folderId: this reuses the existing `folderId, phoneKey` index instead
    // of needing a new one, and a folder that has handed nothing on
    // (`handedOffCount` 0, the overwhelming majority) pays nothing at all.
    const scope = [
      folderId,
      ...(folder.handedOffCount > 0 ? await mirrorFolderIds(folderId) : []),
    ];

    const keys = [...new Set(prepared.map((record) => record.phoneKey))];
    const existing = new Set<string>();
    for (let i = 0; i < keys.length; i += 30) {
      const slice = keys.slice(i, i + 30);
      const found = await Promise.all(
        scope.map((id) =>
          adminDb
            .collection(RECORDS)
            .where("folderId", "==", id)
            .where("phoneKey", "in", slice)
            .get()
        )
      );
      for (const snap of found) {
        snap.docs.forEach((doc) => existing.add(doc.data().phoneKey as string));
      }
    }

    const batch = adminDb.batch();
    let written = 0;
    let duplicates = 0;

    for (const record of prepared) {
      if (existing.has(record.phoneKey)) {
        duplicates += 1;
        continue;
      }
      // Guard against the same number appearing twice inside this chunk.
      existing.add(record.phoneKey);

      batch.set(adminDb.collection(RECORDS).doc(), {
        folderId,
        ...record,
        status: "NEW" as DataBankStatus,
        notes: null,
        addedByUid: admin.uid,
        createdAt: FieldValue.serverTimestamp(),
      });
      written += 1;
    }

    if (written > 0) {
      batch.update(folder.ref, { recordCount: FieldValue.increment(written) });
      await batch.commit();
    }

    return { written, duplicates };
  });
}

/* -------------------------------------------------------------------------- */
/* Promotion                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Turns a cold row into a real lead and removes it from the folder.
 *
 * An admin handing out a lead is a decision, not an offer, so the lead is
 * written straight to ACCEPTED with no acceptance window — the same rule
 * `assignLead` and `reassignLeadManual` follow.
 *
 * The row **leaves the folder**, by the owner's decision. Every field the
 * source carried is copied onto the lead's `customFields` first, so nothing is
 * lost — the address and form number travel with the lead into the pipeline.
 */
export async function promoteDataBankRecord(
  token: string,
  recordId: string,
  assignedUserId: string
): Promise<ActionResult<{ leadId: string; clientFolderId: string | null }>> {
  return runAction("promoteDataBankRecord", async () => {
    const recordRef = adminDb.collection(RECORDS).doc(recordId);

    // Per-phase timing, printed only when a phase is slow. Promotion is the
    // operation users report as "sometimes it works": three phases with very
    // different failure modes, and without this the only evidence is a
    // spinner. `mark` returns the ms since the previous mark.
    let last = Date.now();
    const mark = () => {
      const now = Date.now();
      const took = now - last;
      last = now;
      return took;
    };

    // These three do not depend on each other, so they go out together.
    // Sequentially — as they were — this is three full round trips before any
    // work begins, on top of the auth check's own network call, and that was
    // most of why promoting felt slow and sometimes timed out.
    const [admin, snap] = await Promise.all([requireManager(token), recordRef.get()]);
    const authAndReadsMs = mark();

    if (!snap.exists) throw new UserFacingError("That record no longer exists.");
    const record = snap.data()!;

    // A row that is already a lead. Reachable only if the tombstoned document
    // outlived its own delete (see PROMOTED_FOLDER_ID) and somebody re-sent the
    // request — promoting it twice would put two identical leads in the
    // pipeline, assigned to whoever happened to be picked each time.
    if (record.promotedLeadId) {
      throw new UserFacingError("That record has already been promoted to a lead.");
    }

    const target = await resolveAssignee(admin, assignedUserId);

    const folder = await loadFolder(record.folderId as string);
    assertFolderAccess(admin, folder);
    const folderMs = mark();
    const labels = new Map(folder.fields.map((field) => [field.key, field.label]));

    // Carry every source column onto the lead, labelled as the sheet labelled
    // it, so the rep sees the same detail the folder held.
    const customFields: Record<string, string> = {};
    for (const [key, value] of Object.entries((record.values ?? {}) as Record<string, string>)) {
      if (key === folder.roles.name || key === folder.roles.phone) continue;
      const label = labels.get(key);
      if (label && value) customFields[label] = value;
    }

    const now = FieldValue.serverTimestamp();
    const leadRef = adminDb.collection("leads").doc();

    // A **batch**, not a transaction. Nothing here reads inside the critical
    // section — the record, the employee and the folder were all read above and
    // no write depends on their current value — so a transaction was paying for
    // a begin/commit round trip and retry machinery it never used. A batch is
    // just as atomic and is a single commit.
    const batch = adminDb.batch();

    batch.set(leadRef, {
      name: record.name,
      phone: record.phone ?? null,
      email: null,
      city: null,
      status: "ACCEPTED",
      source: "DATA_BANK",
      dataBankFolderId: record.folderId,
      dataBankFolderName: folder.name,
      assignedUserId,
      assigneeName: target.name,
      attemptedAssignees: [assignedUserId],
      distributionMethod: "MANUAL",
      // Who handed this out, and whose team it landed on (§8, §9). Read off the
      // employee rather than the actor, so an admin promoting into Sub Admin
      // A's team files the lead under that team.
      assignedByUid: admin.uid,
      assignedByRole: admin.role,
      assignedByName: admin.name ?? admin.email ?? null,
      subAdminUid: target.subAdminUid,
      campaignId: null,
      campaignName: null,
      followUpCount: 0,
      callCount: 0,
      customFields,
      createdAt: now,
      assignedAt: now,
      acceptedAt: now,
      lastActivityAt: now,
      });

    batch.set(leadRef.collection("events").doc(), {
      type: "FORCE_ACCEPTED",
      actorUid: admin.uid,
      at: now,
      meta: {
        assignedTo: assignedUserId,
        promotedFrom: record.folderId,
        promotedFromName: folder.name,
        assignedByRole: admin.role,
        assignedByName: admin.name ?? admin.email ?? null,
      },
    });

    batch.set(adminDb.collection("notifications").doc(), {
      type: "NEW_LEAD_ASSIGNED",
      leadId: leadRef.id,
      targetRole: target.role,
      targetUid: assignedUserId,
      payload: {
        message:
          target.role === "employee"
            ? `${record.name} has been assigned to you.`
            : `${record.name} was added to your ${folder.name} client folder.`,
      },
      createdAt: now,
      readAt: null,
    });

    // §5 — a manager or the admin taking a lead gets it in their **Client
    // section**, in a folder mirroring the one it came from, rather than in
    // the employee lead area. The lead itself is the same record either way:
    // same id, same source, same history.
    let clientFolderId: string | null = null;
    if (target.role !== "employee") {
      // The **original** folder, not the manager's mirror of it: a lead that
      // reached a manager via a hand-off and one promoted straight from the
      // source belong in the same Client folder, or one source ends up
      // fragmented into a folder per route it took.
      const { ref: clientFolder } = await ensureClientFolder(
        target,
        {
          id: folder.sourceFolderId ?? (record.folderId as string),
          name: folder.sourceFolderName ?? folder.name ?? "Data Bank",
        },
        admin
      );
      clientFolderId = clientFolder.id;

      batch.set(clientMemberRef(clientFolder.id, leadRef.id), {
        folderId: clientFolder.id,
        leadId: leadRef.id,
        leadName: record.name,
        subAdminUid: target.role === "subadmin" ? target.uid : null,
        dataBankFolderId: record.folderId,
        addedByUid: admin.uid,
        addedAt: now,
      });
      batch.update(clientFolder, {
        leadCount: FieldValue.increment(1),
        updatedAt: now,
      });
    }

    // **A write, not a delete.** See `PROMOTED_FOLDER_ID`: deletes are a
    // separate daily allowance from writes, and when it is spent Firestore
    // refuses them while still accepting writes — which used to take the whole
    // batch down and stop leads being created at all. The row leaves the folder
    // here; the document is removed below, where failing costs nothing.
    batch.update(recordRef, {
      folderId: PROMOTED_FOLDER_ID,
      promotedFromFolderId: record.folderId,
      promotedLeadId: leadRef.id,
      promotedToUid: assignedUserId,
      promotedAt: now,
    });
    batch.update(folder.ref, {
      recordCount: FieldValue.increment(-1),
      promotedCount: FieldValue.increment(1),
    });

    await batch.commit();
    const commitMs = mark();

    // Best-effort cleanup. The lead exists and the row has left the folder, so
    // whether this succeeds changes nothing the user can see — and a delete is
    // exactly the operation most likely to be refused. Never let it fail the
    // promotion, and never let it hold the response.
    try {
      await recordRef.delete();
    } catch (error) {
      console.warn(`[promote] record ${recordId} tombstoned but not deleted`, error);
    }

    // One line, only when it was actually slow, naming which phase cost the
    // time: the auth check and the three parallel reads, the folder read, or
    // the write itself.
    const total = authAndReadsMs + folderMs + commitMs;
    if (total >= 2_000) {
      console.warn(
        `[promote] ${total}ms — auth+reads ${authAndReadsMs}ms, folder ${folderMs}ms, commit ${commitMs}ms`
      );
    }

    return { leadId: leadRef.id, clientFolderId };
  });
}


/* -------------------------------------------------------------------------- */
/* Data Bank -> Clients                                                        */
/* -------------------------------------------------------------------------- */

/** Who a record may be handed to, and what happens to it afterwards. */
export interface AssigneeTarget {
  uid: string;
  name: string;
  role: "admin" | "subadmin" | "employee";
  /** The team the resulting lead belongs to. Null means the admin, directly. */
  subAdminUid: string | null;
}

/**
 * Reads and checks whoever a record is being assigned to.
 *
 * Three kinds of recipient now, not one:
 *
 * | recipient | where the lead lands |
 * |---|---|
 * | Employee | their pipeline, exactly as before |
 * | Sub Admin / Manager | **their Client section**, not the employee lead area |
 * | Admin / Myself | the admin's own Client section |
 *
 * A manager or the admin taking a lead is not a distribution decision — nobody
 * is being given work off a rotation — so it does not belong in the employee
 * lead flow at all. It belongs in the Client folder that mirrors the Data Bank
 * folder it came from, which is what `ensureClientFolder` builds.
 */
async function resolveAssignee(
  actor: DecodedAuth,
  assignedUserId: string
): Promise<AssigneeTarget> {
  const snap = await adminDb.collection("users").doc(assignedUserId).get();
  if (!snap.exists) throw new UserFacingError("That account no longer exists.");

  const data = snap.data()!;
  const role = (data.role as AssigneeTarget["role"]) ?? "employee";
  const name = (data.name as string) ?? (data.email as string) ?? "Unnamed";

  if (data.status === "DISABLED") {
    throw new UserFacingError(`${name} is paused — resume them or choose someone else.`);
  }

  // A sub admin hands out inside their own team, or takes the lead themselves.
  // Both halves matter: either one alone would let them route a lead across
  // the hierarchy.
  if (actor.role === "subadmin") {
    const ownTeam = role === "employee" && data.subAdminUid === actor.uid;
    const themselves = assignedUserId === actor.uid;
    if (!ownTeam && !themselves) {
      throw new UserFacingError("You can assign to your own team, or to yourself.");
    }
  }

  return {
    uid: assignedUserId,
    name,
    role,
    // A manager taking a lead owns it themselves; an employee's team is on
    // their profile; the admin's leads belong to no team.
    subAdminUid:
      role === "subadmin"
        ? assignedUserId
        : role === "admin"
          ? null
          : ((data.subAdminUid as string | undefined) ?? null),
  };
}

/**
 * The Client folder that mirrors a Data Bank folder, for one owner.
 *
 * **Deterministic id**, so importing the same source folder again — a week
 * later, one lead at a time — lands in the folder that already exists rather
 * than creating "Facile Town 2" three times. That is the whole of §5's "add
 * them to the existing Client folder".
 *
 * The folder records where it came from (`dataBankFolderId`), so the link back
 * to the source survives a rename on either side.
 */
function clientFolderRefFor(ownerUid: string, sourceFolderId: string) {
  return adminDb.collection("clientFolders").doc(`db_${ownerUid}_${sourceFolderId}`);
}

/**
 * Creates the mirrored folder if it is not there yet, and returns its ref.
 *
 * Called before the batch so the create and the membership writes can go in
 * one commit — a folder created in a batch cannot be read back in the same
 * batch to find out whether it already existed.
 */
async function ensureClientFolder(
  owner: AssigneeTarget,
  source: { id: string; name: string },
  actor: DecodedAuth
): Promise<{ ref: FirebaseFirestore.DocumentReference; created: boolean }> {
  const ref = clientFolderRefFor(owner.uid, source.id);
  const snap = await ref.get();
  if (snap.exists) return { ref, created: false };

  await ref.set({
    name: source.name,
    description: `Imported from the ${source.name} data bank folder.`,
    color: null,
    // Ownership is the same shape every other scoped collection uses: a
    // manager's folder carries their uid, the admin's carries nothing.
    ...(owner.role === "subadmin" ? { subAdminUid: owner.uid } : {}),
    ownerUid: owner.uid,
    ownerRole: owner.role,
    dataBankFolderId: source.id,
    dataBankFolderName: source.name,
    leadCount: 0,
    createdByUid: actor.uid,
    createdByName: actor.name ?? actor.email ?? null,
    createdAt: FieldValue.serverTimestamp(),
  });

  return { ref, created: true };
}

/** The membership row that puts a lead in a Client folder. Ids are stable. */
function clientMemberRef(folderId: string, leadId: string) {
  return adminDb.collection("clientFolderLeads").doc(`${folderId}__${leadId}`);
}

/**
 * Promotes many records at once (§9, §10).
 *
 * The single-record path is the reference — same lead shape, same provenance,
 * same tombstone-then-delete — so the two cannot produce different leads. What
 * differs is only the scale: records are read and written in chunks, and one
 * notification is sent for the batch rather than one per lead, because fifty
 * separate alerts would bury everything else in the employee's bell.
 *
 * **Partial success is reported, not hidden.** A record somebody promoted
 * while this ran is skipped and counted; the caller is told how many of each.
 * Silently returning "done" for 43 of 50 is how a calling list quietly ends up
 * short.
 */
export async function promoteDataBankRecords(
  token: string,
  recordIds: string[],
  assignedUserId: string
): Promise<ActionResult<{ promoted: number; skipped: number; leadIds: string[] }>> {
  return runAction("promoteDataBankRecords", async () => {
    const ids = [...new Set((recordIds ?? []).filter(Boolean))];
    if (ids.length === 0) throw new UserFacingError("Select at least one record.");
    if (ids.length > 500) throw new UserFacingError("Promote at most 500 records at a time.");

    const admin = await requireManager(token);
    // Employee, manager or admin — the same three the single path takes, and
    // the same rule about where the leads end up (§2, §5).
    const target = await resolveAssignee(admin, assignedUserId);

    /**
     * The mirrored Client folder per source folder, created at most once each.
     * A bulk promotion usually spans one folder, but a selection can cross
     * several, and creating the same folder per record would be a read and a
     * write per lead for no reason.
     */
    const clientFolders = new Map<string, FirebaseFirestore.DocumentReference>();
    const clientAdds = new Map<string, number>();

    let promoted = 0;
    let skipped = 0;
    const leadIds: string[] = [];
    // One folder read per folder, not per record: a bulk promotion is normally
    // one folder, and re-reading it 50 times would be 50 wasted reads.
    const folders = new Map<string, Awaited<ReturnType<typeof loadFolder>>>();

    for (let i = 0; i < ids.length; i += 100) {
      const slice = ids.slice(i, i + 100);
      const snaps = await adminDb.getAll(...slice.map((id) => adminDb.collection(RECORDS).doc(id)));

      const batch = adminDb.batch();
      const now = FieldValue.serverTimestamp();
      const perFolder = new Map<string, number>();

      for (const snap of snaps) {
        if (!snap.exists) {
          skipped += 1;
          continue;
        }
        const record = snap.data()!;
        // Already a lead — see PROMOTED_FOLDER_ID on the single-record path.
        if (record.promotedLeadId) {
          skipped += 1;
          continue;
        }

        const folderId = record.folderId as string;
        let folder = folders.get(folderId);
        if (!folder) {
          folder = await loadFolder(folderId);
          assertFolderAccess(admin, folder);
          folders.set(folderId, folder);
        }

        const labels = new Map(folder.fields.map((field) => [field.key, field.label]));
        const customFields: Record<string, string> = {};
        for (const [key, value] of Object.entries((record.values ?? {}) as Record<string, string>)) {
          if (key === folder.roles.name || key === folder.roles.phone) continue;
          const label = labels.get(key);
          if (label && value) customFields[label] = value;
        }

        const leadRef = adminDb.collection("leads").doc();
        leadIds.push(leadRef.id);

        batch.set(leadRef, {
          name: record.name,
          phone: record.phone ?? null,
          email: null,
          city: null,
          status: "ACCEPTED",
          source: "DATA_BANK",
          dataBankFolderId: folderId,
          dataBankFolderName: folder.name,
          assignedUserId,
          assigneeName: target.name,
          attemptedAssignees: [assignedUserId],
          distributionMethod: "MANUAL",
          assignedByUid: admin.uid,
          assignedByRole: admin.role,
          assignedByName: admin.name ?? admin.email ?? null,
          subAdminUid: target.subAdminUid,
          campaignId: null,
          campaignName: null,
          followUpCount: 0,
          callCount: 0,
          customFields,
          createdAt: now,
          assignedAt: now,
          acceptedAt: now,
          lastActivityAt: now,
        });

        batch.set(leadRef.collection("events").doc(), {
          type: "FORCE_ACCEPTED",
          actorUid: admin.uid,
          at: now,
          meta: {
            assignedTo: assignedUserId,
            promotedFrom: folderId,
            promotedFromName: folder.name,
            assignedByRole: admin.role,
            bulk: ids.length,
          },
        });

        // A write, not a delete — deletes are a separate daily allowance and
        // are the first thing Firestore refuses. See PROMOTED_FOLDER_ID.
        batch.update(snap.ref, {
          folderId: PROMOTED_FOLDER_ID,
          promotedFromFolderId: folderId,
          promotedLeadId: leadRef.id,
          promotedToUid: assignedUserId,
          promotedAt: now,
        });

        // §5 — a manager or the admin gets these in their Client section, in
        // a folder mirroring the source, rather than in the employee lead
        // area. Same lead, same id, same history either way.
        if (target.role !== "employee") {
          let clientFolder = clientFolders.get(folderId);
          if (!clientFolder) {
            clientFolder = (
              await ensureClientFolder(
                target,
                {
                  // The original folder, not a manager's mirror of it — see the
                  // single-record path.
                  id: folder.sourceFolderId ?? folderId,
                  name: folder.sourceFolderName ?? folder.name ?? "Data Bank",
                },
                admin
              )
            ).ref;
            clientFolders.set(folderId, clientFolder);
          }

          batch.set(clientMemberRef(clientFolder.id, leadRef.id), {
            folderId: clientFolder.id,
            leadId: leadRef.id,
            leadName: record.name,
            subAdminUid: target.role === "subadmin" ? target.uid : null,
            dataBankFolderId: folderId,
            addedByUid: admin.uid,
            addedAt: now,
          });
          clientAdds.set(clientFolder.id, (clientAdds.get(clientFolder.id) ?? 0) + 1);
        }

        perFolder.set(folderId, (perFolder.get(folderId) ?? 0) + 1);
        promoted += 1;
      }

      for (const [folderId, count] of perFolder) {
        batch.update(adminDb.collection(FOLDERS).doc(folderId), {
          recordCount: FieldValue.increment(-count),
          promotedCount: FieldValue.increment(count),
        });
      }

      // The mirrored folders' counts, in the same commit as the memberships.
      for (const [clientFolderId, count] of clientAdds) {
        batch.update(adminDb.collection("clientFolders").doc(clientFolderId), {
          leadCount: FieldValue.increment(count),
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
      clientAdds.clear();

      await batch.commit();
    }

    if (promoted > 0) {
      await adminDb.collection("notifications").add({
        type: "NEW_LEAD_ASSIGNED",
        leadId: leadIds[0],
        targetRole: target.role,
        targetUid: assignedUserId,
        payload: {
          message:
            target.role === "employee"
              ? `${promoted} new lead${promoted === 1 ? "" : "s"} assigned to you from the Data Bank.`
              : `${promoted} lead${promoted === 1 ? "" : "s"} added to your client folders.`,
          count: promoted,
        },
        createdAt: FieldValue.serverTimestamp(),
        readAt: null,
      });

      // Best-effort cleanup of the tombstones, exactly as the single path does.
      // Failing here changes nothing the user can see.
      await Promise.all(
        ids.slice(0, promoted).map((id) => adminDb.collection(RECORDS).doc(id).delete().catch(() => {}))
      );
    }

    return { promoted, skipped, leadIds };
  });
}

/* -------------------------------------------------------------------------- */
/* Data Bank -> a manager's Data Bank                                          */
/* -------------------------------------------------------------------------- */

/**
 * The manager's mirror of a source folder.
 *
 * **Deterministic id**, for the same reason the Client mirror has one: handing
 * over ten more records from Facile Town 2 next week must land in the folder
 * the manager already has, not create a second one with the same name.
 */
function managerFolderRefFor(managerUid: string, sourceFolderId: string) {
  return adminDb.collection(FOLDERS).doc(`mgr_${managerUid}_${sourceFolderId}`);
}

/**
 * Creates the manager's mirror if it is not there yet, and returns its ref.
 *
 * The mirror carries the **same fields, keys and roles** as the source. That is
 * not a convenience: records are stored against field *keys*, so a mirror with
 * its own keys would render every handed-over row blank. It is the same folder
 * shape, owned by somebody else.
 *
 * Read before the batch, because a folder created inside a batch cannot be read
 * back in the same batch to find out whether it already existed.
 */
async function ensureManagerFolder(
  manager: { uid: string; name: string },
  source: Awaited<ReturnType<typeof loadFolder>> & { id: string },
  actor: DecodedAuth
): Promise<{ ref: FirebaseFirestore.DocumentReference; created: boolean }> {
  const ref = managerFolderRefFor(manager.uid, source.id);
  const snap = await ref.get();
  if (snap.exists) return { ref, created: false };

  await ref.set({
    name: source.name ?? "Data Bank",
    description: `Handed to ${manager.name} from the ${source.name ?? "Data Bank"} folder.`,
    // Ownership is the same shape every other scoped collection uses, and the
    // shape the Security Rule already checks: `subAdminUid == request.auth.uid`
    // is what makes the manager's folder list a query Firestore can prove.
    subAdminUid: manager.uid,
    fields: source.fields,
    roles: source.roles,
    // Where these rows came from, so the source is still traceable after a
    // rename on either side — and so promotion can file the resulting lead
    // under the *original* folder's Client mirror rather than this one.
    sourceFolderId: source.id,
    sourceFolderName: source.name ?? null,
    recordCount: 0,
    promotedCount: 0,
    createdByUid: actor.uid,
    createdByName: actor.name ?? actor.email ?? null,
    createdAt: FieldValue.serverTimestamp(),
  });

  return { ref, created: true };
}

export interface HandoffResult {
  moved: number;
  skipped: number;
  /** The manager's folder the rows landed in, for a link in the confirmation. */
  folderIds: string[];
}

/**
 * Hands cold records to a manager's own Data Bank.
 *
 * **This is not a promotion.** Assigning a record to an employee turns it into
 * a lead; assigning it to a manager gives the manager the row to *distribute* —
 * they decide which of their people works it, or take it themselves. So the
 * record stays a record and simply changes folder.
 *
 * **The rows move rather than being copied.** A copy would mean two documents
 * for one prospective client: the admin could promote their copy while the
 * manager promoted theirs, producing two identical leads for the same phone
 * number and two people calling it. Moving keeps one row for one person, which
 * is the same rule promotion already follows.
 *
 * The admin does not lose sight of them — an admin reads every folder, so the
 * manager's mirror is listed for them too, and the source folder's
 * `handedOffCount` records how many left.
 *
 * **Only the named manager.** The mirror carries their uid and nothing else's,
 * so a record handed to Manager A is unreachable by Manager B: their folder
 * query is `where('subAdminUid','==',them)` and the rule enforces exactly that
 * clause.
 */
export async function assignRecordsToManager(
  token: string,
  recordIds: string[],
  managerUid: string
): Promise<ActionResult<HandoffResult>> {
  return runAction("assignRecordsToManager", async () => {
    const ids = [...new Set((recordIds ?? []).filter(Boolean))];
    if (ids.length === 0) throw new UserFacingError("Select at least one record.");
    if (ids.length > 500) throw new UserFacingError("Hand over at most 500 records at a time.");

    // Admin only. A manager handing rows to another manager would move work
    // sideways across the hierarchy, which is the admin's decision to make.
    const admin = await requireAdmin(token);

    const managerSnap = await adminDb.collection("users").doc(managerUid).get();
    if (!managerSnap.exists) throw new UserFacingError("That account no longer exists.");

    const managerData = managerSnap.data()!;
    const managerName = (managerData.name as string) ?? (managerData.email as string) ?? "Manager";

    if (managerData.role !== "subadmin") {
      throw new UserFacingError(`${managerName} is not a manager.`);
    }
    if (managerData.status === "DISABLED") {
      throw new UserFacingError(`${managerName} is paused — resume them or choose someone else.`);
    }

    const manager = { uid: managerUid, name: managerName };

    let moved = 0;
    let skipped = 0;
    const folders = new Map<string, Awaited<ReturnType<typeof loadFolder>> & { id: string }>();
    const mirrors = new Map<string, FirebaseFirestore.DocumentReference>();
    const mirrorAdds = new Map<string, number>();

    for (let index = 0; index < ids.length; index += 100) {
      const slice = ids.slice(index, index + 100);
      const snaps = await adminDb.getAll(...slice.map((id) => adminDb.collection(RECORDS).doc(id)));

      const batch = adminDb.batch();
      const now = FieldValue.serverTimestamp();
      const perSource = new Map<string, number>();

      for (const snap of snaps) {
        if (!snap.exists) {
          skipped += 1;
          continue;
        }
        const record = snap.data()!;
        // Already a lead, or already handed to this manager — either way there
        // is nothing to move, and moving it again would double the counters.
        if (record.promotedLeadId) {
          skipped += 1;
          continue;
        }

        const sourceId = record.folderId as string;
        if (!sourceId || sourceId === PROMOTED_FOLDER_ID) {
          skipped += 1;
          continue;
        }

        let source = folders.get(sourceId);
        if (!source) {
          const loaded = await loadFolder(sourceId);
          assertFolderAccess(admin, loaded);
          source = { ...loaded, id: sourceId };
          folders.set(sourceId, source);
        }

        // Already in this manager's mirror of this folder.
        if (source.subAdminUid === managerUid) {
          skipped += 1;
          continue;
        }

        let mirror = mirrors.get(sourceId);
        if (!mirror) {
          // A folder that is *itself* a mirror hands over its own origin, so a
          // record passed on twice does not nest `mgr_x_mgr_y_…` ids.
          const originId = (source.sourceFolderId as string | undefined) ?? sourceId;
          const originName = (source.sourceFolderName as string | undefined) ?? source.name;
          const { ref } = await ensureManagerFolder(
            manager,
            { ...source, id: originId, name: originName },
            admin
          );
          mirror = ref;
          mirrors.set(sourceId, ref);
        }

        batch.update(snap.ref, {
          folderId: mirror.id,
          // Where it came from and who sent it, so the trail survives the move.
          handedOffFromFolderId: sourceId,
          handedOffToUid: managerUid,
          handedOffByUid: admin.uid,
          handedOffAt: now,
        });

        perSource.set(sourceId, (perSource.get(sourceId) ?? 0) + 1);
        mirrorAdds.set(mirror.id, (mirrorAdds.get(mirror.id) ?? 0) + 1);
        moved += 1;
      }

      for (const [sourceId, count] of perSource) {
        batch.update(adminDb.collection(FOLDERS).doc(sourceId), {
          recordCount: FieldValue.increment(-count),
          handedOffCount: FieldValue.increment(count),
        });
      }
      for (const [mirrorId, count] of mirrorAdds) {
        batch.update(adminDb.collection(FOLDERS).doc(mirrorId), {
          recordCount: FieldValue.increment(count),
          updatedAt: now,
        });
      }
      mirrorAdds.clear();

      await batch.commit();
    }

    if (moved > 0) {
      await adminDb.collection("notifications").add({
        type: "DATA_BANK_ASSIGNED",
        leadId: null,
        targetRole: "subadmin",
        targetUid: managerUid,
        payload: {
          message: `${moved} Data Bank record${moved === 1 ? "" : "s"} handed to you. Assign them to your team from your Data Bank.`,
          count: moved,
        },
        createdAt: FieldValue.serverTimestamp(),
        readAt: null,
      });
    }

    return { moved, skipped, folderIds: [...mirrors.values()].map((ref) => ref.id) };
  });
}
