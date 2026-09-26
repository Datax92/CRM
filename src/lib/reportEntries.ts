/**
 * Reading a date range's follow-up entries, server side.
 *
 * Lifted out of `app/actions/reports.ts` when the employee dossier needed the
 * same entries: a `"use server"` module may only export Server Actions, so a
 * helper two of them share has to live outside one. **There is one query for
 * "what was written between these dates", and both screens run it** — the
 * dossier's activity cuts and the report's activity columns are the same
 * question asked of the same records, and a second implementation is how they
 * came to disagree in the first place.
 *
 * The range is matched on `dayKey`, the `YYYY-MM-DD` Karachi string already
 * stored on every entry: string comparison on that format *is* date
 * comparison, and it sidesteps the timezone question entirely.
 */

import { adminDb } from "@/lib/firebase/server";
import type { CountableEntry } from "@/lib/leadBuckets";

/**
 * Every follow-up entry in the range.
 *
 * One collection-group query, which needs the `followUps.dayKey` field
 * exemption: Firestore's automatic single-field indexes are collection-scoped
 * only.
 *
 * **When that index is missing the report no longer fails.** It falls back to
 * querying each lead's own `followUps` subcollection — a *collection* query,
 * which the automatic index already covers. That is one round trip per lead
 * instead of one in total, which is why it is a fallback and not the plan; but
 * a slower report is worth incomparably more than a screen that says something
 * went wrong.
 */
/** Firestore's `in` takes at most 30 values. */
const IN_LIMIT = 30;

/**
 * The last day holding entries written before `creditUid` existed. Measured on
 * the live project 2026-09-26: 12 of 12 entries on 2026-09-02 lack it, 0 of
 * the 228 from 2026-09-03 to 2026-09-08 do. See `loadEntries`.
 */
export const LAST_UNCREDITED_DAY = "2026-09-02";

export async function loadEntries(
  from: string,
  to: string,
  /**
   * Only used by the slow fallback, so it may be a function: the dossier
   * passes one and reads the subject's leads **only if the index is missing**
   * — otherwise every open paid a read per lead for a list it never used.
   */
  leadIds: string[] | (() => Promise<string[]>),
  /**
   * Whose entries are wanted. **Given, the read is scoped to them** (owner,
   * 2026-09-23, the day the free read quota ran out): the unscoped query paid
   * for every entry the whole company wrote in the range and discarded all but
   * the subject's — and Reports opens on "This month", so every open bought the
   * whole company's month.
   *
   * Two queries, unioned: entries **credited** to these people, and entries
   * **written** by them. An entry is counted for `creditUid ?? authorUid`
   * (`toCountableEntries`), and entries older than `creditUid` (2026-09-03)
   * carry only `authorUid` — a `creditUid` query alone would drop them. The
   * union is a superset of what the tally counts, for any range; the extra rows
   * (written by the subject, credited to somebody else) are ignored by the
   * callers, which tally by credited person.
   *
   * Omitted, the range is read unscoped as before.
   */
  creditUids?: string[]
): Promise<{ entries: FirebaseFirestore.QueryDocumentSnapshot[]; warning: string | null }> {
  try {
    if (creditUids) {
      const uids = [...new Set(creditUids.filter(Boolean))];
      if (uids.length === 0) return { entries: [], warning: null };
      const slices: string[][] = [];
      for (let index = 0; index < uids.length; index += IN_LIMIT) slices.push(uids.slice(index, index + IN_LIMIT));
      /*
        **The `authorUid` half covers only the days that need it** (2026-09-26).
        It exists for entries without `creditUid`, and measured against the live
        project the last such day is `LAST_UNCREDITED_DAY`: every entry from
        2026-09-03 on carries it. Run over the whole range, as it was, the two
        queries returned the same entries twice — the read meter's dossier opens
        paid double for every entry written since September began. An entry is
        dated by when the work happened and can only be back-dated, so nothing
        written after `creditUid` shipped can land on an uncredited day without
        carrying it.
      */
      const authorTo = to < LAST_UNCREDITED_DAY ? to : LAST_UNCREDITED_DAY;
      const needAuthor = from <= authorTo;
      const snaps = await Promise.all(
        slices.flatMap((slice) => [
          adminDb
            .collectionGroup("followUps")
            .where("creditUid", "in", slice)
            .where("dayKey", ">=", from)
            .where("dayKey", "<=", to)
            .get(),
          ...(needAuthor
            ? [
                adminDb
                  .collectionGroup("followUps")
                  .where("authorUid", "in", slice)
                  .where("dayKey", ">=", from)
                  .where("dayKey", "<=", authorTo)
                  .get(),
              ]
            : []),
        ])
      );
      const byPath = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();
      for (const snap of snaps) for (const doc of snap.docs) byPath.set(doc.ref.path, doc);
      return { entries: [...byPath.values()], warning: null };
    }
    const snap = await adminDb
      .collectionGroup("followUps")
      .where("dayKey", ">=", from)
      .where("dayKey", "<=", to)
      .get();
    return { entries: snap.docs, warning: null };
  } catch (error) {
    // **Match on the message, not only the code.** Measured against the live
    // project: over the REST transport this arrives as HTTP `400`, not the
    // gRPC `9`/`failed-precondition` you would expect — and the wording is
    // "requires a COLLECTION_GROUP_ASC index", not "requires an index".
    const code = (error as { code?: number | string })?.code;
    const message = (error as { message?: string })?.message ?? "";
    const missingIndex =
      code === 9 ||
      code === "failed-precondition" ||
      /requires a[n]?[^.]*index/i.test(message) ||
      /index.*(is not ready|does not exist)/i.test(message);

    if (!missingIndex) throw error;

    const ids = typeof leadIds === "function" ? await leadIds() : leadIds;
    const entries: FirebaseFirestore.QueryDocumentSnapshot[] = [];
    const BATCH = 25;
    for (let index = 0; index < ids.length; index += BATCH) {
      const slice = ids.slice(index, index + BATCH);
      const snaps = await Promise.all(
        slice.map((leadId) =>
          adminDb
            .collection("leads")
            .doc(leadId)
            .collection("followUps")
            .where("dayKey", ">=", from)
            .where("dayKey", "<=", to)
            .get()
        )
      );
      for (const snap of snaps) entries.push(...snap.docs);
    }

    return {
      entries,
      // Names the command rather than a console path. The console's
      // "Single field → Add exemption" screen is genuinely hard to find, and
      // `npm run deploy:indexes` creates this override and every other missing
      // index in one go from `firestore.indexes.json`.
      /**
       * **Not "these figures are correct".** They usually are, and the wording
       * used to promise it — but the fallback can only look inside leads the
       * subject holds *now*, so work somebody did on a lead that has since been
       * reassigned is missing from it and present on the fast path. Saying so
       * costs nothing and stops the fallback being trusted as identical.
       */
      warning:
        "The report ran the slow way: the followUps.dayKey collection-group index is " +
        "missing. Figures may under-count work done on leads that have since been " +
        "reassigned to somebody else. A developer can create the index with " +
        "`npm run deploy:indexes` — see docs/deployment-runbook.md for the one IAM " +
        "role that needs granting first.",
    };
  }
}

/** Every entry in the range, reduced to what a tally needs. */
export function toCountableEntries(
  docs: FirebaseFirestore.QueryDocumentSnapshot[]
): CountableEntry[] {
  return docs.map((doc) => {
    const entry = doc.data();
    return {
      // The parent of a `followUps` document is its lead. Read from the
      // reference rather than a denormalised field, which these entries have
      // never carried.
      leadId: doc.ref.parent.parent?.id ?? "",
      uid: (entry.creditUid as string) ?? (entry.authorUid as string) ?? "",
      kind: (entry.kind as string | undefined) ?? null,
      connect: entry.connect === true,
      // Both were missing here, so the dossier's Meeting-aligned count read 0
      // whatever was written.
      meetingAligned: entry.meetingAligned === true,
      callMade: entry.callMade === true,
    };
  });
}
