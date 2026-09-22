"use server";

/**
 * Data Bank writes — folders, records, imports and promotion.
 *
 * Managing roles throughout, with one exception: an employee may file a
 * **personal lead** under one of the admin's folders (`addPersonalLead`). Cold
 * lists are a company asset, so even then they see folder names and nothing
 * else — never a row.
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
  verifyAuth,
  assertManagesFolder,
  type DecodedAuth,
} from "@/lib/firebase/serverAuth";
import { runAction, UserFacingError, type ActionResult } from "@/lib/actionResult";
import { FieldValue } from "firebase-admin/firestore";
import {
  assignedPhoneMessage,
  duplicatePhoneMessage,
  personalDuplicateMessage,
  fieldKeyFor,
  phoneKey,
  MAX_FIELDS_PER_FOLDER,
  PROMOTED_FOLDER_ID,
  WRITE_BATCH_SIZE,
  DELETE_BUDGET,
  RECORD_STATUSES,
  type ColumnMap,
  type DataBankField,
  type DataBankStatus,
  type FieldRoles,
} from "@/lib/dataBank";
import { applyFieldMapping, normalizeMapsTo } from "@/lib/fieldMapping";
import { normalizeLaneUids } from "@/lib/distribution";
import { folderScopeIds } from "@/lib/dataBankAssigned";
import { campaignForFolderLead } from "@/lib/metaIntake";

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
  fields: Array<{ key?: string; label: string; mapsTo?: string | null }>;
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
    // Validated here rather than trusted: a target this build does not know
    // would be written and then silently never applied.
    const mapsTo = normalizeMapsTo(raw.mapsTo);
    fields.push(mapsTo ? { key, label, mapsTo } : { key, label });
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
 * Who this folder's leads go to — the whole rotation, or the people named here.
 *
 * **The case this exists for.** A client runs ads for one project and wants
 * every lead from it on one desk: the folder the intake created for that
 * campaign is restricted to those people, and the lane stops being company-wide
 * *for that folder only*. Everything else about the offer is unchanged — the
 * priority order, each person's own `leadsPerTurn`, the five-minute window, the
 * popup, Pass on, and the loop back to the top when everybody has had a turn.
 * It is the same lane, drawn round fewer people — so a lead routed to a desk
 * goes round that desk's group for as long as it takes, and never cascades off
 * it.
 *
 * **An empty list is the absence of a rule, not a rule that nobody gets them.**
 * Clearing the selection returns the folder to the general rotation, which is
 * what every folder that predates this means — so this can never be the reason
 * a paid lead reaches nobody.
 *
 * **Automatic distribution only** (the owner's call). Promoting or reassigning
 * a row by hand is a decision, and the restriction does not override it.
 *
 * The chosen people are validated here rather than at distribution time: a
 * disabled account or a uid that is not a person at all must be refused at the
 * moment somebody is choosing, not silently skipped an hour later when a lead
 * lands. A manager may only route their own folder to their own team or to
 * themselves — routing somebody else's staff is the admin's call.
 */
export async function setFolderLane(
  token: string,
  folderId: string,
  uids: string[]
): Promise<ActionResult<{ names: string[] }>> {
  return runAction("setFolderLane", async () => {
    const auth = await requireManager(token);

    const ref = adminDb.collection(FOLDERS).doc(folderId);
    const snap = await ref.get();
    if (!snap.exists) throw new UserFacingError("That folder no longer exists.");
    assertFolderAccess(auth, {
      subAdminUid: (snap.data()?.subAdminUid as string | undefined) ?? null,
    });

    const chosen = normalizeLaneUids(uids);
    if (chosen.length === 0) {
      await ref.update({
        laneUids: FieldValue.delete(),
        laneUidsUpdatedAt: FieldValue.serverTimestamp(),
        laneUidsByUid: auth.uid,
      });
      return { names: [] };
    }

    const people = await adminDb.getAll(
      ...chosen.map((uid) => adminDb.collection("users").doc(uid))
    );

    const names: string[] = [];
    for (const person of people) {
      if (!person.exists) {
        throw new UserFacingError("One of the people you chose no longer has an account.");
      }
      const data = person.data()!;
      const role = data.role;
      if (role !== "employee" && role !== "subadmin" && role !== "admin") {
        throw new UserFacingError("Leads can only be routed to a person in the team.");
      }
      if (data.status === "DISABLED") {
        throw new UserFacingError(
          `${data.name ?? "That account"} is paused, so leads sent there would sit unworked. Reactivate the account or choose somebody else.`
        );
      }
      // A manager routes their own folder to their own people. The admin's
      // reach is everybody, which is why this is asked of the caller's role and
      // not of the folder.
      if (auth.role !== "admin" && person.id !== auth.uid && data.subAdminUid !== auth.uid) {
        throw new UserFacingError("You can only send these leads to your own team.");
      }
      names.push(String(data.name ?? data.email ?? person.id));
    }

    await ref.update({
      laneUids: chosen,
      laneUidsUpdatedAt: FieldValue.serverTimestamp(),
      laneUidsByUid: auth.uid,
    });

    return { names };
  });
}

/**
 * Deletes a folder and every record in it.
 *
 * Records are removed in batches before the folder itself, so a failure
 * halfway leaves a folder with fewer rows rather than orphaned rows with no
 * folder — which would be invisible in the UI and impossible to clean up.
 */
/**
 * How much deleting a folder would cost, before anybody presses the button.
 *
 * **One read, not one per record.** A `count()` aggregation is billed as a
 * single document read for up to a thousand matches, so asking "how big is
 * this" is free next to the answer. That is what makes it worth asking every
 * time rather than only when somebody is suspicious.
 */
export async function countFolderRecords(
  token: string,
  folderId: string
): Promise<ActionResult<{ live: number; promoted: number; total: number; withinOneRun: boolean }>> {
  return runAction("countFolderRecords", async () => {
    await requireManager(token);
    const [live, promoted] = await Promise.all([
      adminDb.collection(RECORDS).where("folderId", "==", folderId).count().get(),
      adminDb.collection(RECORDS).where("promotedFromFolderId", "==", folderId).count().get(),
    ]);
    const total = live.data().count + promoted.data().count;
    return {
      live: live.data().count,
      promoted: promoted.data().count,
      total,
      withinOneRun: total <= DELETE_BUDGET,
    };
  });
}

/**
 * Deletes a folder and its records, **bounded so it cannot take the day down**.
 *
 * The free plan meters deletes at 20,000 a day and **the whole app stops when
 * that runs out** — every write fails, not just this one. A folder of 5,500
 * rows used to spend a quarter of the budget in a single press, and two of them
 * took the business offline until midnight Pacific. That is the failure this
 * bound exists to prevent.
 *
 * So one run removes at most `DELETE_BUDGET` documents and then **stops and
 * says so**. The folder is marked `deletionPending` and disappears from every
 * screen immediately — from the reader's point of view it is gone — and the
 * next run finishes it. Resumable rather than atomic is the right trade here:
 * a half-deleted folder leaves unreachable rows, which is untidy; a spent
 * quota leaves a company that cannot record a lead, which is not.
 *
 * **The cost is one read plus one delete per document and that is a floor**,
 * not a setting: one record is one document. The only way past it is fewer,
 * larger documents — see the note on bucketing in CLAUDE.md — which is a
 * storage rewrite and the owner's call.
 */
export async function deleteDataBankFolder(
  token: string,
  folderId: string
): Promise<ActionResult<{ deleted: number; remaining: number; done: boolean }>> {
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
    let hitTheCeiling = false;

    // Two passes: the folder's live rows, then any promoted row whose
    // tombstone outlived its own delete (see `PROMOTED_FOLDER_ID`). Without
    // the second pass those documents become unreachable — their `folderId`
    // no longer names a folder that exists.
    for (const [field, value] of [
      ["folderId", folderId],
      ["promotedFromFolderId", folderId],
    ] as const) {
      while (deleted < DELETE_BUDGET) {
        const page = await adminDb
          .collection(RECORDS)
          .where(field, "==", value)
          // Never overshoot the budget on the last page.
          .limit(Math.min(WRITE_BATCH_SIZE, DELETE_BUDGET - deleted))
          .get();
        if (page.empty) break;

        const batch = adminDb.batch();
        page.docs.forEach((doc) => batch.delete(doc.ref));
        await batch.commit();
        deleted += page.size;
      }
      if (deleted >= DELETE_BUDGET) {
        hitTheCeiling = true;
        break;
      }
    }

    if (!hitTheCeiling) {
      await adminDb.collection(FOLDERS).doc(folderId).delete();
      return { deleted, remaining: 0, done: true };
    }

    /*
      Still rows left. The folder is **marked rather than deleted**: its own
      document is what the next run needs to find the rest, and a reader must
      not see a folder that is on its way out — so every surface filters
      `deletionPending` out and it is gone from their point of view.
    */
    const [live, promoted] = await Promise.all([
      adminDb.collection(RECORDS).where("folderId", "==", folderId).count().get(),
      adminDb.collection(RECORDS).where("promotedFromFolderId", "==", folderId).count().get(),
    ]);
    const remaining = live.data().count + promoted.data().count;

    await adminDb.collection(FOLDERS).doc(folderId).update({
      deletionPending: true,
      deletionRemaining: remaining,
      deletionUpdatedAt: FieldValue.serverTimestamp(),
    });

    return { deleted, remaining, done: false };
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
    deletionPending?: boolean;
    metaSource?: { basis?: string; campaignId?: string | null } | null;
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
    deletionPending: data.deletionPending === true,
    // Which Meta campaign the folder is, when it is one — see `campaignForFolderLead`.
    metaSource: data.metaSource ?? null,
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
 * Deletes a manager's mirror once the last row has left it.
 *
 * A mirror is created by handing rows to a manager and is *only* a holding
 * place: the manager promotes each row into their team's pipeline, and when the
 * last one goes the folder is an empty duplicate of its source, with the same
 * name, sitting next to it in a name-ordered list. That is the "folders
 * appearing on their own" the owner's client reported — measured 2026-09-12,
 * three of the four mirrors in the project were already empty.
 *
 * Deleting it is safe because the id is deterministic (`mgr_{uid}_{sourceId}`):
 * the next hand-off to the same manager recreates the same folder.
 *
 * **The counts move back to the source so the numbers still add up.** The rows
 * the manager promoted were promoted out of *this* folder, so its
 * `promotedCount` is added to the source's, and the source's `handedOffCount`
 * comes down by everything that was ever handed here — otherwise the source
 * would read "9 handed on" pointing at a folder that no longer exists, which is
 * the confusion this is meant to remove. Clamped at zero: a mirror written
 * before `handedInCount` existed falls back to its promoted figure, which can
 * only be an under-estimate.
 *
 * Best-effort by design. It runs after the promotion has committed, so a
 * failure leaves an empty folder and nothing else — never a lead that did not
 * get created, and never a delete quota taking a promotion down with it.
 */
async function cleanupEmptyMirror(mirrorId: string): Promise<void> {
  try {
    await adminDb.runTransaction(async (tx) => {
      const mirrorRef = adminDb.collection(FOLDERS).doc(mirrorId);
      const mirror = await tx.get(mirrorRef);
      if (!mirror.exists) return;

      const data = mirror.data() as {
        sourceFolderId?: string | null;
        recordCount?: number;
        promotedCount?: number;
        handedInCount?: number;
      };
      const sourceId = data.sourceFolderId;
      // Not a mirror, or still holding rows: leave it exactly as it is.
      if (!sourceId) return;
      if ((data.recordCount ?? 0) > 0) return;

      const promotedHere = Math.max(0, Number(data.promotedCount ?? 0) || 0);
      const handedIn =
        typeof data.handedInCount === "number" ? Math.max(0, data.handedInCount) : promotedHere;

      const sourceRef = adminDb.collection(FOLDERS).doc(sourceId);
      const source = await tx.get(sourceRef);
      if (source.exists) {
        const handedOff = Math.max(0, Number(source.data()?.handedOffCount ?? 0) || 0);
        tx.update(sourceRef, {
          handedOffCount: Math.max(0, handedOff - handedIn),
          promotedCount: FieldValue.increment(promotedHere),
        });
      }
      tx.delete(mirrorRef);
    });
  } catch (error) {
    console.warn(`[dataBank] empty mirror ${mirrorId} left in place`, error);
  }
}

/**
 * Refuses a phone number the folder already holds, **naming who holds it**.
 *
 * One number is one prospective client, and two rows for one number means two
 * people ringing it. The scope is the folder plus any mirror a manager has
 * been handed rows into: a row that left for a manager is still that folder's
 * row, and typing it again here would make a second. Deliberately *not* wider
 * than that — the owner's call. Two different source lists legitimately hold
 * the same number, and refusing a fresh sheet because a number appears in last
 * year's would make importing one impossible.
 *
 * The message names the person rather than only the number, because "already
 * in this folder" leaves the reader hunting for a row they cannot search for
 * by a number they have just been told not to use.
 *
 * `ignoreRecordId` is the row being edited: saving a record without touching
 * its number must not report the record as its own duplicate.
 */
async function refuseDuplicatePhone(
  folder: { ref: { id: string }; handedOffCount: number; sourceFolderId: string | null },
  key: string,
  written: string | null,
  ignoreRecordId?: string
): Promise<void> {
  const folderId = folder.ref.id;
  const scope = [
    folderId,
    ...(folder.handedOffCount > 0 ? await mirrorFolderIds(folderId) : []),
  ];

  for (const id of scope) {
    const clash = await adminDb
      .collection(RECORDS)
      .where("folderId", "==", id)
      .where("phoneKey", "==", key)
      // Two, so a hit that is only this row itself does not hide a real one
      // behind it.
      .limit(2)
      .get();

    const other = clash.docs.find((doc) => doc.id !== ignoreRecordId);
    if (!other) continue;

    throw new UserFacingError(
      duplicatePhoneMessage(written || key, other.data().name as string, id !== folderId)
    );
  }

  // **And the numbers it has already handed out.** A promoted row leaves the
  // folder, so the check above cannot see it — which is exactly how re-importing
  // a sheet put the same client into the pipeline twice.
  const held = (await assignedPhoneHolders(folder, [key])).get(key);
  if (held) throw new UserFacingError(assignedPhoneMessage(written || key, held.name, held.assignee));
}

/**
 * The folder's scope for "already handed out": the origin folder plus every
 * manager's mirror of it, whether or not that mirror still exists.
 *
 * A mirror answers for its origin, because a mirror's rows *are* the origin's
 * rows — a number the admin promoted out of Faisal Town 2 is already handed out
 * as far as the manager holding the rest of Faisal Town 2 is concerned.
 */
async function leadScopeFor(folder: { ref: { id: string }; sourceFolderId: string | null }) {
  const managers = await adminDb.collection("users").where("role", "==", "subadmin").select().get();
  return folderScopeIds(
    folder.sourceFolderId ?? folder.ref.id,
    managers.docs.map((doc) => doc.id)
  );
}

/**
 * Which of these numbers this folder has already turned into leads, and who
 * holds each.
 *
 * Queried on `phoneKey` alone and narrowed to the folder in memory: one `in`
 * query per 30 numbers, served by the automatic single-field index, and the
 * handful of leads a number matches in other folders cost a read each. Scoping
 * the query by folder instead would multiply the lookups by the number of
 * managers, since Firestore caps a query at 30 disjunctions.
 *
 * Reads `leads.phoneKey`, which promotion writes and
 * `scripts/backfill-lead-phone-keys.mts` fills in on older leads. A lead
 * without it is simply not found — the check is no worse than before for it.
 */
async function assignedPhoneHolders(
  folder: { ref: { id: string }; sourceFolderId: string | null },
  keys: string[]
): Promise<Map<string, { name: string; assignee: string | null }>> {
  const wanted = [...new Set(keys.filter(Boolean))];
  const found = new Map<string, { name: string; assignee: string | null }>();
  if (wanted.length === 0) return found;

  const scope = new Set(await leadScopeFor(folder));
  for (let i = 0; i < wanted.length; i += 30) {
    const snap = await adminDb
      .collection("leads")
      .where("phoneKey", "in", wanted.slice(i, i + 30))
      .select("phoneKey", "name", "assigneeName", "dataBankFolderId")
      .get();
    for (const doc of snap.docs) {
      const lead = doc.data();
      if (!scope.has(lead.dataBankFolderId as string)) continue;
      if (found.has(lead.phoneKey as string)) continue;
      found.set(lead.phoneKey as string, {
        name: (lead.name as string) ?? "",
        assignee: (lead.assigneeName as string | undefined) ?? null,
      });
    }
  }
  return found;
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

    await refuseDuplicatePhone(folder, record.phoneKey, record.phone);

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
      // **Editing had no duplicate check at all.** Adding a number already in
      // the folder was refused; retyping an existing row's number to the same
      // value was not, so the one rule the folder has could be walked straight
      // round. `ignoreRecordId` is this row itself — saving a record without
      // touching its number must not report the record as its own duplicate.
      if (record.phoneKey !== snap.data()!.phoneKey) {
        await refuseDuplicatePhone(folder, record.phoneKey, record.phone, recordId);
      }
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
    const folder = await loadFolder(folderId);
    assertFolderAccess(auth, folder);
    await ref.delete();
    await adminDb
      .collection(FOLDERS)
      .doc(folderId)
      .update({ recordCount: FieldValue.increment(-1) });

    // The other way a manager's mirror empties — see `cleanupEmptyMirror`.
    if (folder.sourceFolderId) await cleanupEmptyMirror(folderId);
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

    // Numbers this folder has already handed out count as held too. A promoted
    // row is no longer in the folder, so without this re-importing a sheet
    // recreated every row that had been worked and the same client went into
    // the pipeline a second time.
    const handedOut = await assignedPhoneHolders(
      folder,
      keys.filter((key) => !existing.has(key))
    );
    for (const key of handedOut.keys()) existing.add(key);

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

    // One number, one lead per folder. The row being promoted is still in the
    // folder, so this can only find a *second* row for a number that was
    // already worked — the re-imported duplicates this check exists to stop.
    const key = (record.phoneKey as string | undefined) || phoneKey(record.phone as string);
    const alreadyOut = key ? (await assignedPhoneHolders(folder, [key])).get(key) : undefined;
    if (alreadyOut) {
      throw new UserFacingError(
        assignedPhoneMessage(record.phone as string, alreadyOut.name, alreadyOut.assignee)
      );
    }
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

    /**
     * What the sheet already knew, carried onto the lead (§ "connect those
     * fields with the KYC section").
     *
     * Copied **once, here** rather than read through to the row afterwards: a
     * cold row is provenance and a lead is a working record, so reading through
     * would let a corrected KYC revert to whatever the spreadsheet said. See
     * `lib/fieldMapping`.
     */
    const mapped = applyFieldMapping(folder.fields, record.values ?? {});

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
      // The folder's dedupe key, carried onto the lead so the folder can still
      // recognise the number after the row itself is gone.
      phoneKey: key || null,
      email: mapped.lead.email ?? null,
      city: mapped.lead.city ?? null,
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
      // A Meta row promoted by hand still counts in its campaign.
      ...campaignForFolderLead({ record, folder }),
      followUpCount: 0,
      callCount: 0,
      customFields,
      // Only written when the folder actually maps something, so a lead from an
      // unmapped folder carries no empty objects to reason about.
      ...(Object.keys(mapped.kyc).length > 0 ? { kyc: mapped.kyc } : {}),
      ...(Object.keys(mapped.deal).length > 0 ? { dealDefaults: mapped.deal } : {}),
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

    // If that was the last row in a manager's mirror, the mirror is now an
    // empty copy of its source sitting beside it in the list. See
    // `cleanupEmptyMirror` — best effort, after the lead exists.
    if (folder.sourceFolderId) await cleanupEmptyMirror(folder.ref.id);

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
): Promise<ActionResult<{ promoted: number; skipped: number; duplicates: number; leadIds: string[] }>> {
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

    /** The rows that actually became leads — only these tombstones are removed. */
    const promotedRecordIds: string[] = [];
    /** Numbers already handed out, per origin folder, including by this run. */
    const handedOut = new Map<string, Set<string>>();
    let duplicates = 0;

    for (let i = 0; i < ids.length; i += 100) {
      const slice = ids.slice(i, i + 100);
      const snaps = await adminDb.getAll(...slice.map((id) => adminDb.collection(RECORDS).doc(id)));

      // Folders first, then one "already handed out" lookup per folder for the
      // whole slice, rather than a query per record.
      const keysByFolder = new Map<string, string[]>();
      for (const snap of snaps) {
        if (!snap.exists || snap.data()!.promotedLeadId) continue;
        const folderId = snap.data()!.folderId as string;
        if (!folders.has(folderId)) {
          const loaded = await loadFolder(folderId);
          assertFolderAccess(admin, loaded);
          folders.set(folderId, loaded);
        }
        const key = (snap.data()!.phoneKey as string | undefined) || phoneKey(snap.data()!.phone as string);
        if (key) keysByFolder.set(folderId, [...(keysByFolder.get(folderId) ?? []), key]);
      }
      for (const [folderId, keys] of keysByFolder) {
        const folder = folders.get(folderId)!;
        const origin = folder.sourceFolderId ?? folderId;
        const held = handedOut.get(origin) ?? new Set<string>();
        for (const key of (await assignedPhoneHolders(folder, keys)).keys()) held.add(key);
        handedOut.set(origin, held);
      }

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
        const folder = folders.get(folderId)!;

        // One number, one lead per folder — see the single-record path. The
        // set also catches the same number twice inside this selection.
        const key = (record.phoneKey as string | undefined) || phoneKey(record.phone as string);
        const held = handedOut.get(folder.sourceFolderId ?? folderId)!;
        if (key && held?.has(key)) {
          skipped += 1;
          duplicates += 1;
          continue;
        }
        if (key) held?.add(key);

        const labels = new Map(folder.fields.map((field) => [field.key, field.label]));
        const customFields: Record<string, string> = {};
        for (const [key, value] of Object.entries((record.values ?? {}) as Record<string, string>)) {
          if (key === folder.roles.name || key === folder.roles.phone) continue;
          const label = labels.get(key);
          if (label && value) customFields[label] = value;
        }

        const leadRef = adminDb.collection("leads").doc();
        leadIds.push(leadRef.id);
        promotedRecordIds.push(snap.id);

        batch.set(leadRef, {
          name: record.name,
          phone: record.phone ?? null,
          phoneKey: key || null,
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
          ...campaignForFolderLead({ record, folder }),
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
      //
      // **Only the rows that were promoted.** This used to delete the first
      // `promoted` ids of the selection, which is the same set only when nothing
      // was skipped — a skipped row near the top would have been deleted while
      // still a live, unworked record.
      await Promise.all(
        promotedRecordIds.map((id) => adminDb.collection(RECORDS).doc(id).delete().catch(() => {}))
      );

      // Any manager's mirror this selection emptied. `folders` already holds
      // every folder the records came out of, so this costs no extra read on
      // the overwhelming majority of promotions, which touch no mirror at all.
      for (const [folderId, folder] of folders) {
        if (folder.sourceFolderId) await cleanupEmptyMirror(folderId);
      }
    }

    return { promoted, skipped, duplicates, leadIds };
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
          // The **origin**, when the row is being moved on out of one manager's
          // mirror into another's — it is still that folder's row.
          handedOffFromFolderId: source.sourceFolderId ?? sourceId,
          handedOffToUid: managerUid,
          handedOffByUid: admin.uid,
          handedOffAt: now,
        });

        perSource.set(sourceId, (perSource.get(sourceId) ?? 0) + 1);
        mirrorAdds.set(mirror.id, (mirrorAdds.get(mirror.id) ?? 0) + 1);
        moved += 1;
      }

      for (const [sourceId, count] of perSource) {
        const from = folders.get(sourceId);
        batch.update(
          adminDb.collection(FOLDERS).doc(sourceId),
          from?.sourceFolderId
            ? {
                // **Reassigned from one manager to another.** The rows were
                // already counted as handed off on the origin, and they still
                // are; what changes is which mirror holds them. Taking them off
                // this mirror's `handedInCount` is what stops
                // `cleanupEmptyMirror` returning them to the origin twice —
                // once from each mirror — when both eventually empty.
                recordCount: FieldValue.increment(-count),
                handedInCount: FieldValue.increment(-count),
              }
            : {
                recordCount: FieldValue.increment(-count),
                handedOffCount: FieldValue.increment(count),
              }
        );
      }
      for (const [mirrorId, count] of mirrorAdds) {
        batch.update(adminDb.collection(FOLDERS).doc(mirrorId), {
          recordCount: FieldValue.increment(count),
          // How many have *ever* been handed here, which `recordCount` stops
          // being the moment one is promoted or deleted. `cleanupEmptyMirror`
          // needs it to give the source back the right `handedOffCount` when
          // the mirror empties.
          handedInCount: FieldValue.increment(count),
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

    // A mirror this emptied — every row moved on to another manager — is an
    // empty copy of its source now. Same best-effort cleanup as promotion.
    if (moved > 0) {
      for (const [folderId, folder] of folders) {
        if (folder.sourceFolderId) await cleanupEmptyMirror(folderId);
      }
    }

    return { moved, skipped, folderIds: [...mirrors.values()].map((ref) => ref.id) };
  });
}

/* -------------------------------------------------------------------------- */
/* An employee's personal lead                                                 */
/* -------------------------------------------------------------------------- */

/** What an employee is shown when choosing where a personal lead is filed: a name, nothing more. */
export interface PersonalLeadFolder {
  id: string;
  name: string;
  code: string | null;
}

/**
 * The folders an employee may file a personal lead under.
 *
 * **The admin's own folders only** — not a manager's list, not a manager's
 * mirror, not one being deleted. An employee cannot create a folder and cannot
 * read the Data Bank at all (the Security Rules refuse both collections), so
 * this action is the only view they get of it, and it returns names and ids and
 * nothing else: no counts, no fields, no rows.
 */
export async function listPersonalLeadFolders(
  token: string
): Promise<ActionResult<PersonalLeadFolder[]>> {
  return runAction("listPersonalLeadFolders", async () => {
    const auth = await verifyAuth(token);
    if (auth.role !== "employee") {
      throw new UserFacingError("Personal leads are added from an employee's own account.");
    }

    const snap = await adminDb.collection(FOLDERS).orderBy("name").get();
    return snap.docs
      .filter((doc) => {
        const data = doc.data();
        return !data.subAdminUid && !data.sourceFolderId && data.deletionPending !== true;
      })
      .map((doc) => ({
        id: doc.id,
        name: (doc.data().name as string) ?? "Untitled",
        code: (doc.data().code as string | null | undefined) ?? null,
      }));
  });
}

/**
 * Adds a lead an employee found themselves, filed under a Data Bank folder.
 *
 * **It is their lead from the first second**: written straight to ACCEPTED,
 * assigned to them, on their manager's team — the same shape a promotion
 * writes, so every screen that reads a promoted lead reads this one. And it is
 * the folder's: `dataBankFolderId` is what puts it in that folder's Assigned
 * list under the employee's name, and what makes its source read
 * `Data Bank (GFS)` everywhere.
 *
 * **No record row is written.** A folder's assigned rows are derived from the
 * leads that name it (`lib/dataBankAssigned`), so a row would only be a second
 * copy of a number that is already a lead — the thing this module refuses.
 *
 * **One number, one lead per folder**, the same rule an import and a promotion
 * follow: refused if the folder still holds it as a row or has already handed
 * it out. The refusal names nobody (`personalDuplicateMessage`).
 */
export async function addPersonalLead(
  token: string,
  input: { folderId: string; name: string; phone: string }
): Promise<ActionResult<{ leadId: string; folderName: string }>> {
  return runAction("addPersonalLead", async () => {
    const auth = await verifyAuth(token);
    if (auth.role !== "employee") {
      throw new UserFacingError("Personal leads are added from an employee's own account.");
    }

    const name = (input.name ?? "").trim();
    const phone = (input.phone ?? "").trim();
    const key = phoneKey(phone);
    if (!name) throw new UserFacingError("Enter the lead's name.");
    if (name.length > 120) throw new UserFacingError("Keep the name under 120 characters.");
    if (!key) throw new UserFacingError("Enter a usable phone number.");
    if (!input.folderId) throw new UserFacingError("Choose the Data Bank folder this lead belongs to.");

    const folder = await loadFolder(input.folderId);
    // The same set `listPersonalLeadFolders` offers, re-checked rather than
    // trusted: a crafted request must not file a lead under a manager's list.
    if (folder.subAdminUid || folder.sourceFolderId || folder.deletionPending) {
      throw new UserFacingError("Choose one of the Data Bank folders offered.");
    }

    const duplicate = personalDuplicateMessage(folder.name);
    const scope = [
      folder.ref.id,
      ...(folder.handedOffCount > 0 ? await mirrorFolderIds(folder.ref.id) : []),
    ];
    for (const id of scope) {
      const clash = await adminDb
        .collection(RECORDS)
        .where("folderId", "==", id)
        .where("phoneKey", "==", key)
        .limit(1)
        .get();
      if (!clash.empty) throw new UserFacingError(duplicate);
    }
    if ((await assignedPhoneHolders(folder, [key])).has(key)) {
      throw new UserFacingError(duplicate);
    }

    const profileSnap = await adminDb.collection("users").doc(auth.uid).get();
    const profile = profileSnap.data() ?? {};
    const employeeName = (profile.name as string) ?? auth.email ?? "An employee";
    const subAdminUid = (profile.subAdminUid as string | undefined) ?? null;

    const now = FieldValue.serverTimestamp();
    const leadRef = adminDb.collection("leads").doc();
    const batch = adminDb.batch();

    batch.set(leadRef, {
      name,
      phone,
      phoneKey: key,
      email: null,
      city: null,
      status: "ACCEPTED",
      source: "DATA_BANK",
      dataBankFolderId: folder.ref.id,
      dataBankFolderName: folder.name,
      // Marks the lead as one the employee brought in, rather than one handed
      // to them. Nothing gates on it; it is the answer to "where did this come
      // from" when somebody asks.
      personalLead: true,
      assignedUserId: auth.uid,
      assigneeName: employeeName,
      attemptedAssignees: [auth.uid],
      distributionMethod: "MANUAL",
      assignedByUid: auth.uid,
      assignedByRole: "employee",
      assignedByName: employeeName,
      subAdminUid,
      // Added into a campaign's folder, it counts in that campaign.
      ...campaignForFolderLead({ folder }),
      followUpCount: 0,
      callCount: 0,
      customFields: {},
      createdAt: now,
      assignedAt: now,
      acceptedAt: now,
      lastActivityAt: now,
    });

    batch.set(leadRef.collection("events").doc(), {
      type: "PERSONAL_LEAD_ADDED",
      actorUid: auth.uid,
      at: now,
      meta: { folderId: folder.ref.id, folderName: folder.name, addedByName: employeeName },
    });

    // The folder's own figure moves with it, so its card still adds up.
    batch.update(folder.ref, { promotedCount: FieldValue.increment(1) });

    const message = `${employeeName} added a personal lead, ${name}, to ${folder.name ?? "the Data Bank"}.`;
    batch.set(adminDb.collection("notifications").doc(), {
      type: "PERSONAL_LEAD_ADDED",
      leadId: leadRef.id,
      targetRole: "admin",
      targetUid: null,
      payload: { message },
      createdAt: now,
      readAt: null,
    });
    if (subAdminUid) {
      batch.set(adminDb.collection("notifications").doc(), {
        type: "PERSONAL_LEAD_ADDED",
        leadId: leadRef.id,
        targetRole: "subadmin",
        targetUid: subAdminUid,
        payload: { message },
        createdAt: now,
        readAt: null,
      });
    }

    await batch.commit();
    return { leadId: leadRef.id, folderName: folder.name ?? "the Data Bank" };
  });
}
