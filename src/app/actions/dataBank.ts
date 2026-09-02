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

export async function createDataBankFolder(
  token: string,
  input: FolderInput
): Promise<ActionResult<{ folderId: string }>> {
  return runAction("createDataBankFolder", async () => {
    const admin = await requireAdmin(token);
    const name = (input.name ?? "").trim();
    if (!name) throw new UserFacingError("Enter a name for the folder.");

    const { fields, roles } = normalizeFields(input);
    const subAdminUid = await resolveFolderOwner(input.subAdminUid);

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

export async function updateDataBankFolder(
  token: string,
  folderId: string,
  input: FolderInput
): Promise<ActionResult> {
  return runAction("updateDataBankFolder", async () => {
    await requireAdmin(token);
    const name = (input.name ?? "").trim();
    if (!name) throw new UserFacingError("Enter a name for the folder.");

    const ref = adminDb.collection(FOLDERS).doc(folderId);
    const snap = await ref.get();
    if (!snap.exists) throw new UserFacingError("That folder no longer exists.");

    const { fields, roles } = normalizeFields(input);

    // Removing a field leaves its values on existing records rather than
    // rewriting thousands of documents. They stop displaying; nothing is lost,
    // and re-adding the field brings them back.
    const subAdminUid =
      input.subAdminUid === undefined ? undefined : await resolveFolderOwner(input.subAdminUid);

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
    await requireAdmin(token);

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
  };
  // `name` comes back here so callers never re-read the document for it —
  // promotion used to fetch this same folder a second time just for the name.
  return {
    ref: snap.ref,
    name: data.name ?? null,
    fields: data.fields ?? [],
    roles: data.roles,
    subAdminUid: data.subAdminUid ?? null,
  };
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

    const clash = await adminDb
      .collection(RECORDS)
      .where("folderId", "==", folderId)
      .where("phoneKey", "==", record.phoneKey)
      .limit(1)
      .get();
    if (!clash.empty) {
      throw new UserFacingError(`That number is already in this folder (${clash.docs[0].data().name}).`);
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

    // Which of these numbers does the folder already hold? Firestore's `in`
    // takes 30 values, so this is a handful of reads per chunk rather than one
    // read per row.
    const keys = [...new Set(prepared.map((record) => record.phoneKey))];
    const existing = new Set<string>();
    for (let i = 0; i < keys.length; i += 30) {
      const slice = keys.slice(i, i + 30);
      const found = await adminDb
        .collection(RECORDS)
        .where("folderId", "==", folderId)
        .where("phoneKey", "in", slice)
        .get();
      found.docs.forEach((doc) => existing.add(doc.data().phoneKey as string));
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
): Promise<ActionResult<{ leadId: string }>> {
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
    const [admin, snap, employee] = await Promise.all([
      requireManager(token),
      recordRef.get(),
      adminDb.collection("users").doc(assignedUserId).get(),
    ]);

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

    if (!employee.exists || employee.data()?.role !== "employee") {
      throw new UserFacingError("Choose a team member to assign this to.");
    }
    if (employee.data()?.status === "DISABLED") {
      throw new UserFacingError("That employee is paused — resume them or choose someone else.");
    }
    // A sub admin promotes out of their own folders, to their own team. Both
    // halves are checked: either one alone would let them route a lead across
    // the hierarchy.
    if (admin.role === "subadmin" && employee.data()?.subAdminUid !== admin.uid) {
      throw new UserFacingError("That team member is not on your team.");
    }

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
      assigneeName: employee.data()?.name ?? employee.data()?.email ?? null,
      attemptedAssignees: [assignedUserId],
      distributionMethod: "MANUAL",
      // Who handed this out, and whose team it landed on (§8, §9). Read off the
      // employee rather than the actor, so an admin promoting into Sub Admin
      // A's team files the lead under that team.
      assignedByUid: admin.uid,
      assignedByRole: admin.role,
      assignedByName: admin.name ?? admin.email ?? null,
      subAdminUid: (employee.data()?.subAdminUid as string | undefined) ?? null,
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
      targetRole: "employee",
      targetUid: assignedUserId,
      payload: { message: `${record.name} has been assigned to you.` },
      createdAt: now,
      readAt: null,
    });

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

    return { leadId: leadRef.id };
  });
}
