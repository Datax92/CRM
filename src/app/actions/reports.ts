"use server";

/**
 * Team Reports (§4–§6).
 *
 * One row per person: Connects, Follow-Up Connects, Meetings Done, Site Visits,
 * and how many of their leads sit at P3 / P2 / P1 — over a date range the user
 * picks.
 *
 * **Computed from the records that already exist**, as §4 asks. Nothing here is
 * a maintained statistic:
 *
 * | column | read from |
 * |---|---|
 * | Connect | the **first** contact on a lead — its Remark, when the call connected |
 * | Follow-Up Connect | every **later** connected contact on that lead |
 * | Meetings Done | entries with `meetingHeld` |
 * | Site Visits | entries with `siteVisit` |
 * | P3 / P2 / P1 | the person's leads, by the stage their status implies |
 *
 * **Why a Server Action rather than a client query.** The entries live in a
 * subcollection per lead, so a range across everybody is a collection-group
 * query — and a collection-group read is the one shape this project's Security
 * Rules cannot scope safely, because a rule cannot see which lead a follow-up
 * belongs to without a lookup per document. Running it with the Admin SDK and
 * filtering by role here keeps the boundary where it can actually be enforced.
 *
 * The range is matched on `dayKey`, the `YYYY-MM-DD` Karachi string already
 * stored on every entry: string comparison on that format *is* date comparison,
 * and it sidesteps the timezone question entirely — a report for "1 September"
 * means the Karachi day, which is what everyone reading it means too.
 */

import { adminDb } from "@/lib/firebase/server";
import { verifyAuth } from "@/lib/firebase/serverAuth";
import { isHrManager } from "@/lib/constants/hierarchy";
import { runAction, UserFacingError, type ActionResult } from "@/lib/actionResult";
import { stageForStatus } from "@/lib/leadStatus";

export interface ReportRow {
  uid: string;
  name: string;
  /** The manager who runs them, or "Admin" when nobody does. */
  assignedTo: string;
  connects: number;
  followUpConnects: number;
  meetings: number;
  siteVisits: number;
  p3: number;
  p2: number;
  p1: number;
}

export interface TeamReport {
  from: string;
  to: string;
  rows: ReportRow[];
  totals: Omit<ReportRow, "uid" | "name" | "assignedTo">;
  /**
   * Set when the report had to run the slow way — the collection-group index
   * is missing. The figures are the same; only the cost differs, and the
   * screen says so rather than pretending nothing happened.
   */
  warning?: string | null;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export async function buildTeamReport(
  token: string,
  from: string,
  to: string
): Promise<ActionResult<TeamReport>> {
  return runAction("buildTeamReport", async () => {
    const auth = await verifyAuth(token);

    if (!DAY.test(from) || !DAY.test(to)) {
      throw new UserFacingError("Choose a start and an end date.");
    }
    if (from > to) {
      throw new UserFacingError("The start date is after the end date.");
    }

    /* ---------------------------------------------------------------- */
    /* Who the report covers                                            */
    /* ---------------------------------------------------------------- */

    // §10: an admin sees everyone; **an HR manager sees everyone too**, since
    // HR runs the whole company's people reporting; a Sales manager sees their
    // own team; an employee sees only themselves. Decided here from the
    // verified token, never from a parameter the caller sends.
    //
    // The HR check needs the manager kind, which lives on the profile. One
    // extra read, and only for a manager — an admin and an employee never pay
    // for it.
    let seesEveryone = auth.role === "admin";
    if (auth.role === "subadmin") {
      const profile = await adminDb.collection("users").doc(auth.uid).get();
      seesEveryone = isHrManager(auth.role, profile.data()?.managerKind);
    }

    const roster = seesEveryone
      ? await adminDb.collection("users").where("role", "==", "employee").get()
      : auth.role === "subadmin"
        ? await adminDb.collection("users").where("subAdminUid", "==", auth.uid).get()
        : await adminDb.collection("users").where("__name__", "==", auth.uid).get();

    const people = roster.docs.map((doc) => ({
      uid: doc.id,
      name: (doc.data().name as string) || (doc.data().email as string) || "Unnamed",
      subAdminUid: (doc.data().subAdminUid as string | undefined) ?? null,
    }));

    if (people.length === 0) {
      return {
        from,
        to,
        rows: [],
        totals: { connects: 0, followUpConnects: 0, meetings: 0, siteVisits: 0, p3: 0, p2: 0, p1: 0 },
      };
    }

    const scope = new Set(people.map((person) => person.uid));

    // Manager names, so the "Assigned To" column reads as a person rather than
    // a uid. One read for the whole management layer.
    const managers = await adminDb.collection("users").where("role", "==", "subadmin").get();
    const managerName = new Map(
      managers.docs.map((doc) => [doc.id, (doc.data().name as string) || "Manager"])
    );

    /* ---------------------------------------------------------------- */
    /* Activity in the range                                            */
    /* ---------------------------------------------------------------- */

    /* ---------------------------------------------------------------- */
    /* Where their leads stand                                          */
    /* ---------------------------------------------------------------- */

    // Read **first**, because the activity fallback below needs the lead ids.
    //
    // The stage columns describe the pipeline *now*, not during the range: a
    // lead's stage is its current status, and back-dating it would need an
    // event replay this report does not pretend to do.
    //
    // Batched 30 at a time — Firestore's `in` ceiling. One query per employee
    // meant twenty round trips for a twenty-person team before a single figure
    // could be drawn; this is one per thirty.
    const uids = [...scope];
    const chunks: string[][] = [];
    for (let index = 0; index < uids.length; index += 30) {
      chunks.push(uids.slice(index, index + 30));
    }

    const leadSnaps = await Promise.all(
      chunks.map((chunk) => adminDb.collection("leads").where("assignedUserId", "in", chunk).get())
    );

    const leadIds: string[] = [];
    for (const snap of leadSnaps) {
      for (const doc of snap.docs) leadIds.push(doc.id);
    }

    const blank = () => ({
      connects: 0,
      followUpConnects: 0,
      meetings: 0,
      siteVisits: 0,
      p3: 0,
      p2: 0,
      p1: 0,
    });
    const tally = new Map(people.map((person) => [person.uid, blank()]));

    /* ---------------------------------------------------------------- */
    /* Activity in the range                                            */
    /* ---------------------------------------------------------------- */

    /**
     * One query across every lead's `followUps`, which needs a
     * **collection-group** index: Firestore's automatic single-field indexes
     * are collection-scoped only, so `followUps.dayKey` needs an explicit
     * field exemption.
     *
     * **When that index is missing the report no longer fails.** It falls back
     * to querying each lead's own `followUps` subcollection — a *collection*
     * query, which the automatic index already covers. That is one round trip
     * per lead instead of one in total, which is why it is a fallback and not
     * the plan; but a slower report is worth incomparably more than a screen
     * that says "something went wrong", and the pipeline columns were never
     * affected either way.
     */
    let entryDocs: FirebaseFirestore.QueryDocumentSnapshot[] = [];
    let degraded: string | null = null;

    try {
      const snap = await adminDb
        .collectionGroup("followUps")
        .where("dayKey", ">=", from)
        .where("dayKey", "<=", to)
        .get();
      entryDocs = snap.docs;
    } catch (error) {
      // **Match on the message, not the code.** Measured against the live
      // project: over the REST transport this arrives as HTTP `400`, not the
      // gRPC `9`/`failed-precondition` you would expect — and the wording is
      // "requires a COLLECTION_GROUP_ASC index", not "requires an index". An
      // earlier version of this check tested for both of those and caught
      // neither, so the screen showed the generic "something went wrong".
      const code = (error as { code?: number | string })?.code;
      const message = (error as { message?: string })?.message ?? "";
      const missingIndex =
        code === 9 ||
        code === "failed-precondition" ||
        /requires a[n]?[^.]*index/i.test(message) ||
        /index.*(is not ready|does not exist)/i.test(message);

      if (!missingIndex) throw error;

      // Per lead, in parallel batches. Bounded by the leads this reader can
      // already see, so it cannot become an unbounded scan.
      degraded =
        "Running without the followUps.dayKey collection-group index, so this took longer than " +
        "it should. An administrator can add it in Firestore → Indexes → Single field → " +
        "Add exemption (collection group: followUps, field: dayKey, Collection group scope: " +
        "Ascending). The figures below are correct either way.";

      const BATCH = 25;
      for (let index = 0; index < leadIds.length; index += BATCH) {
        const slice = leadIds.slice(index, index + BATCH);
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
        for (const snap of snaps) entryDocs.push(...snap.docs);
      }
    }

    for (const snap of leadSnaps) {
      for (const doc of snap.docs) {
        const lead = doc.data();
        const row = tally.get(lead.assignedUserId as string);
        if (!row) continue;

        // A verified Cold lead is out of the P-bands entirely; it is neither
        // being worked nor progressing.
        if (lead.pipelineStageOverride === "COLD") continue;

        const stage = stageForStatus(lead.status as string);
        if (stage === "P3") row.p3 += 1;
        else if (stage === "P2") row.p2 += 1;
        else if (stage === "P1") row.p1 += 1;
      }
    }

    for (const doc of entryDocs) {
      const entry = doc.data();
      // Credited to whoever works the lead, not whoever typed the form — the
      // same rule the KPI counters follow. `authorUid` is the fallback for
      // entries written before `creditUid` existed.
      const uid = (entry.creditUid as string) ?? (entry.authorUid as string) ?? "";
      const row = tally.get(uid);
      if (!row) continue; // Outside this reader's scope.

      if (entry.connect) {
        // **The two columns are disjoint**, and that is the point of having
        // both: Connect is the first time somebody actually got through to a
        // lead, Follow-Up Connect is every time after. Counting the opening
        // call in both would make the columns add up to more than the work
        // that happened, and would make "Connect" mean the same as "total
        // contact" — which the report already has no need for.
        //
        // The split is read from the entry's own `kind`, which the follow-up
        // transaction stores. Entries written before that field existed are
        // treated as follow-ups, which is what all but the first of them were.
        if (entry.kind === "REMARK") row.connects += 1;
        else row.followUpConnects += 1;
      }
      if (entry.meetingHeld) row.meetings += 1;
      if (entry.siteVisit) row.siteVisits += 1;
    }

    const rows: ReportRow[] = people
      .map((person) => ({
        uid: person.uid,
        name: person.name,
        assignedTo: person.subAdminUid ? (managerName.get(person.subAdminUid) ?? "Manager") : "Admin",
        ...(tally.get(person.uid) ?? blank()),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const totals = rows.reduce(
      (sum, row) => ({
        connects: sum.connects + row.connects,
        followUpConnects: sum.followUpConnects + row.followUpConnects,
        meetings: sum.meetings + row.meetings,
        siteVisits: sum.siteVisits + row.siteVisits,
        p3: sum.p3 + row.p3,
        p2: sum.p2 + row.p2,
        p1: sum.p1 + row.p1,
      }),
      blank()
    );

    return { from, to, rows, totals, warning: degraded };
  });
}
