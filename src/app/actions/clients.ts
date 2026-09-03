"use server";

/**
 * Client folders (§15–§20) — a second way to organise leads that already exist.
 *
 * **A folder holds references, never copies.** §17 and §19 are explicit about
 * it, and the reason is not storage: a copied lead would have its own
 * follow-ups, its own status, its own deal — and within a week the two would
 * disagree about the same customer, with nothing to say which was right. So a
 * membership is `{ folderId, leadId }` and the lead is read from `leads` as
 * usual. Opening it from a folder opens the *same record* the pipeline shows.
 *
 * A membership collection rather than an array on the folder: an array caps a
 * folder at what fits in one 1 MB document, and two people adding leads at once
 * would overwrite each other's writes. Rows also let Security Rules scope the
 * read, which an array cannot.
 *
 * **Ownership** follows the hierarchy already in place (§20). A folder carries
 * `subAdminUid` when a manager owns it; an admin sees every folder, a manager
 * sees their own. The admin can read a manager's folders — §20 says so
 * explicitly — but a manager cannot read another manager's.
 */

import { adminDb } from "@/lib/firebase/server";
import { requireManager, type DecodedAuth } from "@/lib/firebase/serverAuth";
import { runAction, UserFacingError, type ActionResult } from "@/lib/actionResult";
import { FieldValue } from "firebase-admin/firestore";

const FOLDERS = "clientFolders";
const MEMBERS = "clientFolderLeads";

/** Throws unless this caller owns the folder, or is the admin. */
async function loadOwnFolder(auth: DecodedAuth, folderId: string) {
  const snap = await adminDb.collection(FOLDERS).doc(folderId).get();
  if (!snap.exists) throw new UserFacingError("That folder no longer exists.");

  const folder = snap.data()!;
  if (auth.role === "admin") return { ref: snap.ref, folder };

  if (folder.subAdminUid !== auth.uid) {
    throw new UserFacingError("That folder belongs to someone else.");
  }
  return { ref: snap.ref, folder };
}

export async function createClientFolder(
  token: string,
  input: { name: string; description?: string | null; color?: string | null }
): Promise<ActionResult<{ folderId: string }>> {
  return runAction("createClientFolder", async () => {
    const auth = await requireManager(token);

    const name = (input.name ?? "").trim();
    if (!name) throw new UserFacingError("Give the folder a name.");
    if (name.length > 80) throw new UserFacingError("Keep the folder name under 80 characters.");

    const ref = await adminDb.collection(FOLDERS).add({
      name,
      description: (input.description ?? "").trim() || null,
      color: (input.color ?? "").trim() || null,
      // A manager's folder is theirs; an admin's belongs to the company. The
      // absence of the field is what "the admin's own" means, exactly as it
      // does on employees and Data Bank folders.
      ...(auth.role === "subadmin" ? { subAdminUid: auth.uid } : {}),
      leadCount: 0,
      createdByUid: auth.uid,
      createdByName: auth.name ?? auth.email ?? null,
      createdAt: FieldValue.serverTimestamp(),
    });

    return { folderId: ref.id };
  });
}

export async function updateClientFolder(
  token: string,
  folderId: string,
  input: { name?: string; description?: string | null; color?: string | null }
): Promise<ActionResult> {
  return runAction("updateClientFolder", async () => {
    const auth = await requireManager(token);
    const { ref } = await loadOwnFolder(auth, folderId);

    const patch: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };

    if (input.name !== undefined) {
      const name = input.name.trim();
      if (!name) throw new UserFacingError("Give the folder a name.");
      patch.name = name;
    }
    if (input.description !== undefined) patch.description = input.description?.trim() || null;
    if (input.color !== undefined) patch.color = input.color?.trim() || null;

    await ref.update(patch);
  });
}

/**
 * Deletes a folder and its memberships.
 *
 * **The leads themselves are untouched** — that is the whole point of a folder
 * being a view. Deleting one removes an organisation of the pipeline, never a
 * part of it, and the confirmation says so.
 */
export async function deleteClientFolder(
  token: string,
  folderId: string
): Promise<ActionResult<{ removed: number }>> {
  return runAction("deleteClientFolder", async () => {
    const auth = await requireManager(token);
    const { ref } = await loadOwnFolder(auth, folderId);

    let removed = 0;
    for (;;) {
      const page = await adminDb.collection(MEMBERS).where("folderId", "==", folderId).limit(400).get();
      if (page.empty) break;

      const batch = adminDb.batch();
      page.docs.forEach((doc) => batch.delete(doc.ref));
      await batch.commit();
      removed += page.size;
    }

    await ref.delete();
    return { removed };
  });
}

/**
 * Adds leads to a folder (§17).
 *
 * The membership id is `${folderId}__${leadId}`, which makes adding the same
 * lead twice a no-op rather than a duplicate row — a person clicking "add"
 * twice, or two managers curating the same folder, cannot produce two entries
 * for one lead.
 *
 * Both of §17's sources arrive here as the same call: a lead promoted out of
 * the Data Bank *is* a CRM lead by the time it can be added, so there is one
 * code path rather than two that could drift.
 */
export async function addLeadsToClientFolder(
  token: string,
  folderId: string,
  leadIds: string[]
): Promise<ActionResult<{ added: number; alreadyThere: number }>> {
  return runAction("addLeadsToClientFolder", async () => {
    const auth = await requireManager(token);
    const { folder } = await loadOwnFolder(auth, folderId);

    const ids = [...new Set((leadIds ?? []).filter(Boolean))];
    if (ids.length === 0) throw new UserFacingError("Select at least one lead.");
    if (ids.length > 500) throw new UserFacingError("Add at most 500 leads at a time.");

    let added = 0;
    let alreadyThere = 0;

    for (let i = 0; i < ids.length; i += 100) {
      const slice = ids.slice(i, i + 100);
      const [leadSnaps, memberSnaps] = await Promise.all([
        adminDb.getAll(...slice.map((id) => adminDb.collection("leads").doc(id))),
        adminDb.getAll(...slice.map((id) => adminDb.collection(MEMBERS).doc(`${folderId}__${id}`))),
      ]);

      const batch = adminDb.batch();
      const now = FieldValue.serverTimestamp();

      leadSnaps.forEach((leadSnap, index) => {
        if (!leadSnap.exists) return;
        if (memberSnaps[index].exists) {
          alreadyThere += 1;
          return;
        }

        const lead = leadSnap.data()!;
        // A manager may only file leads their own team is working — the same
        // boundary every other read of theirs respects.
        if (auth.role === "subadmin" && lead.subAdminUid !== auth.uid) return;

        batch.set(adminDb.collection(MEMBERS).doc(`${folderId}__${leadSnap.id}`), {
          folderId,
          leadId: leadSnap.id,
          // Denormalised for the folder's own list: a folder view sorts and
          // searches on these, and reading every lead to render a list of 200
          // would cost 200 reads per open. The lead stays the source of truth —
          // the folder screen reads it live when a row is opened.
          leadName: lead.name ?? null,
          subAdminUid: (folder.subAdminUid as string | undefined) ?? null,
          addedByUid: auth.uid,
          addedAt: now,
        });
        added += 1;
      });

      await batch.commit();
    }

    if (added > 0) {
      await adminDb.collection(FOLDERS).doc(folderId).update({
        leadCount: FieldValue.increment(added),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    return { added, alreadyThere };
  });
}

/** Takes a lead out of a folder. The lead itself is untouched. */
export async function removeLeadFromClientFolder(
  token: string,
  folderId: string,
  leadId: string
): Promise<ActionResult> {
  return runAction("removeLeadFromClientFolder", async () => {
    const auth = await requireManager(token);
    await loadOwnFolder(auth, folderId);

    const ref = adminDb.collection(MEMBERS).doc(`${folderId}__${leadId}`);
    const snap = await ref.get();
    if (!snap.exists) return;

    await ref.delete();
    await adminDb.collection(FOLDERS).doc(folderId).update({
      leadCount: FieldValue.increment(-1),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
}
