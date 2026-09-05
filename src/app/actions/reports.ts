"use server";

/**
 * Team → Reports.
 *
 * One row per person over a date range, with a **subject** chosen by the
 * reader: one employee, one manager (their own work plus their team's), the
 * admin, all employees, or all managers.
 *
 * **Every figure is computed from records that already exist.** Nothing here is
 * a maintained statistic:
 *
 * | column | read from |
 * |---|---|
 * | Remarks | first entries written on a lead in the range |
 * | Follow-ups | every later entry written in the range |
 * | New Connects | connected calls logged on a **Remark** — the first contact on a lead |
 * | Follow-Up Connects | connected calls logged on a **Follow-Up** — every contact after |
 * | Meetings Done | entries with `meetingHeld` |
 * | Site Visits Done | entries with `siteVisit` |
 * | Deals Closed | `closedDeals` settled in the range |
 * | Tokens Received | leads whose token money arrived in the range |
 * | P1 / P2 / P3 | where the person's leads stand **now**, by `pipelineStage` |
 *
 * The activity columns are range-scoped; the P-bands are not, and cannot be —
 * a lead's stage is a property of its status today, and back-dating it would
 * need an event replay this report does not pretend to do. The screen says so.
 *
 * **Why a Server Action rather than a client query.** The entries live in a
 * subcollection per lead, so a range across everybody is a collection-group
 * query — the one shape this project's Security Rules cannot scope safely,
 * because a rule cannot see which lead a follow-up belongs to without a lookup
 * per document. Running it with the Admin SDK and deciding the scope here from
 * the verified token keeps the boundary where it can be enforced.
 *
 * The range is matched on `dayKey`, the `YYYY-MM-DD` Karachi string already
 * stored on every entry: string comparison on that format *is* date
 * comparison, and it sidesteps the timezone question entirely.
 */

import { adminDb } from "@/lib/firebase/server";
import { verifyAuth } from "@/lib/firebase/serverAuth";
import { isHrManager } from "@/lib/constants/hierarchy";
import { runAction, UserFacingError, type ActionResult } from "@/lib/actionResult";
import { pipelineStage } from "@/lib/pipelineStage";
import {
  blankMetrics,
  describeSubject,
  parseSubject,
  rowsForSubject,
  shortId,
  sumMetrics,
  teamLabel,
  type PersonMetrics,
  type ReportPerson,
} from "@/lib/reportScope";

export interface ReportRow extends PersonMetrics {
  uid: string;
  /** Short readable identifier, derived from the uid. */
  id: string;
  name: string;
  role: "admin" | "subadmin" | "employee";
  /** The manager who runs them, or "Admin" when nobody does. */
  team: string;
}

/** One entry in the grouped selector. */
export interface ReportOption {
  value: string;
  label: string;
  group: "OVERALL" | "EMPLOYEES" | "MANAGERS" | "ADMIN";
  hint?: string;
}

export interface TeamReport {
  from: string;
  to: string;
  /** The subject actually reported on — echoed back so the UI cannot drift. */
  subject: string;
  subjectLabel: string;
  rows: ReportRow[];
  totals: PersonMetrics;
  /** Everything this reader may select, grouped. */
  options: ReportOption[];
  /**
   * Set when the report had to run the slow way — the collection-group index
   * is missing. The figures are the same; only the cost differs, and the
   * screen says so rather than pretending nothing happened.
   */
  warning?: string | null;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Firestore's `in` ceiling. */
const IN_CHUNK = 30;

function chunk<T>(all: T[], size = IN_CHUNK): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < all.length; index += size) out.push(all.slice(index, index + size));
  return out;
}

export async function buildTeamReport(
  token: string,
  from: string,
  to: string,
  subjectId?: string | null
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
    /* Who this reader may see                                          */
    /* ---------------------------------------------------------------- */

    // An admin sees everyone; **an HR manager sees everyone too**, since HR
    // runs the whole company's people reporting; a Sales manager sees their own
    // team and themselves; an employee sees only themselves. Decided from the
    // verified token, never from a parameter the caller sends.
    //
    // The HR check needs the manager kind, which lives on the profile: one
    // extra read, and only for a manager. An admin and an employee never pay
    // for it.
    let seesEveryone = auth.role === "admin";
    let ownProfile: FirebaseFirestore.DocumentData | undefined;

    if (auth.role === "subadmin") {
      const profile = await adminDb.collection("users").doc(auth.uid).get();
      ownProfile = profile.data();
      seesEveryone = isHrManager(auth.role, ownProfile?.managerKind);
    }

    const people = await loadPeople(auth, seesEveryone, ownProfile);

    if (people.length === 0) {
      return {
        from,
        to,
        subject: "ALL_EMPLOYEES",
        subjectLabel: "Nobody to report on",
        rows: [],
        totals: blankMetrics(),
        options: [],
        warning: null,
      };
    }

    /* ---------------------------------------------------------------- */
    /* The subject                                                      */
    /* ---------------------------------------------------------------- */

    const options = buildOptions(people, auth.uid);
    let subject = parseSubject(subjectId);

    // A subject this reader cannot see falls back to the widest thing they
    // can — an employee asking for the company report gets their own row
    // rather than an error, because the selector they were shown never
    // offered it and a hand-edited request is not worth a failure page.
    const valid = new Set(options.map((option) => option.value));
    if (!valid.has(subject.id)) {
      subject = parseSubject(options[0]?.value ?? "ALL_EMPLOYEES");
    }

    const subjectPeople = rowsForSubject(people, subject);
    if (subjectPeople.length === 0) {
      return {
        from,
        to,
        subject: subject.id,
        subjectLabel: describeSubject(people, subject),
        rows: [],
        totals: blankMetrics(),
        options,
        warning: null,
      };
    }

    /* ---------------------------------------------------------------- */
    /* The figures                                                      */
    /* ---------------------------------------------------------------- */

    const uids = subjectPeople.map((person) => person.uid);
    const tally = new Map<string, PersonMetrics>(uids.map((uid) => [uid, blankMetrics()]));
    const window = karachiWindow(from, to);

    // Phase timings, printed only when the whole thing is slow. "The report is
    // slow" is unanswerable without them: four very different reads, and only
    // one line is needed to say which.
    let mark = Date.now();
    const since = () => {
      const now = Date.now();
      const took = now - mark;
      mark = now;
      return took;
    };

    // Leads and deals depend on nothing but the uid list, so they go out
    // together. Sequentially this was two full round trips before a single
    // figure could be drawn.
    const [leadSnaps, dealSnaps] = await Promise.all([
      Promise.all(
        chunk(uids).map((slice) =>
          adminDb.collection("leads").where("assignedUserId", "in", slice).get()
        )
      ),
      Promise.all(
        chunk(uids).map((slice) =>
          adminDb.collection("closedDeals").where("userId", "in", slice).get()
        )
      ),
    ]);

    /**
     * Leads that could hold an entry in the range — the fallback's whole input.
     *
     * `lastFollowUpAt` is the newest entry's write time, denormalised on the
     * lead. A lead whose newest entry predates the range cannot have one
     * inside it, and a lead with no entries at all has no field. Pruning here
     * is what makes the fallback survive a real pipeline: without it a folder
     * of 3,000 worked leads means 3,000 subcollection queries to find the
     * handful of people who logged something this week.
     *
     * Safe because an entry can only be **back**-dated, never forward: its
     * `dayKey` comes from `occurredAt`, which cannot be later than the write.
     */
    const leadIds: string[] = [];
    for (const snap of leadSnaps) {
      for (const doc of snap.docs) {
        const lead = doc.data();
        const lastEntry = lead.lastFollowUpAt as { toMillis?: () => number } | undefined;
        if (lastEntry?.toMillis && lastEntry.toMillis() >= window.start) leadIds.push(doc.id);
        const row = tally.get(lead.assignedUserId as string);
        if (!row) continue;

        // **The same stage rule the whole app uses**, not a second reading of
        // the status table. It is what keeps a freshly accepted lead out of P3
        // until its Remark is written, and a verified Cold lead out of the
        // bands entirely.
        const stage = pipelineStage({
          status: lead.status as string,
          followUpCount: lead.followUpCount as number | undefined,
          pipelineStageOverride: lead.pipelineStageOverride,
          temperatureOverride: lead.temperatureOverride,
        }).value;

        if (stage === "P3") row.p3 += 1;
        else if (stage === "P2") row.p2 += 1;
        else if (stage === "P1") row.p1 += 1;

        // Token money, over the range. `tokenReceivedAt` is stamped one-way
        // when the status first reaches TOKEN_RECEIVED, because the status
        // moves on to Deal Closed while the fact that a token arrived does
        // not. A lead recorded before that field existed is counted from its
        // current status instead, so history does not read as zero.
        if (inWindow(lead.tokenReceivedAt, window)) row.tokensReceived += 1;
        else if (!lead.tokenReceivedAt && lead.status === "TOKEN_RECEIVED") row.tokensReceived += 1;
      }
    }

    // Deals, by the day the money was recorded — the same date the ledger and
    // the payroll commission run off.
    for (const snap of dealSnaps) {
      for (const doc of snap.docs) {
        const deal = doc.data();
        const row = tally.get(deal.userId as string);
        if (!row) continue;
        if (inWindow(deal.dealDate ?? deal.enteredAt, window)) row.dealsClosed += 1;
      }
    }

    const readsMs = since();
    const { entries, warning } = await loadEntries(from, to, leadIds);
    const activityMs = since();

    for (const doc of entries) {
      const entry = doc.data();
      // Credited to whoever works the lead, not whoever typed the form — the
      // same rule the KPI counters follow. `authorUid` is the fallback for
      // entries written before `creditUid` existed.
      const uid = (entry.creditUid as string) ?? (entry.authorUid as string) ?? "";
      const row = tally.get(uid);
      if (!row) continue;

      /**
       * **The work, then the work that connected.**
       *
       * Remarks and Follow-ups count every entry; the two connect columns count
       * the subset where somebody actually got through. They are deliberately
       * not the same number and are not meant to add up — a day of unanswered
       * calls is real work and shows here as remarks with no connects, which is
       * exactly what a manager needs to be able to see.
       *
       * `kind` is stored by the follow-up transaction. Entries written before
       * that field existed count as follow-ups, which is what all but the first
       * of them were.
       */
      if (entry.kind === "REMARK") row.remarks += 1;
      else row.followUps += 1;

      if (entry.connect) {
        // **The two connect columns are disjoint**, and that is the point of
        // having both: New Connects is the first time somebody got through to
        // a lead, Follow-Up Connects is every time after. Counting the opening
        // call in both would make them sum to more contact than happened.
        //
        // Read from the entry's own `kind`, which the follow-up transaction
        // stores. Entries written before that field existed count as
        // follow-ups, which is what all but the first of them were.
        if (entry.kind === "REMARK") row.newConnects += 1;
        else row.followUpConnects += 1;
      }
      if (entry.meetingHeld) row.meetings += 1;
      if (entry.siteVisit) row.siteVisits += 1;
    }

    /* ---------------------------------------------------------------- */
    /* Rows                                                             */
    /* ---------------------------------------------------------------- */

    const managerNames = new Map(
      people.filter((person) => person.role === "subadmin").map((person) => [person.uid, person.name])
    );

    const rows: ReportRow[] = subjectPeople.map((person) => ({
      uid: person.uid,
      id: shortId(person.uid),
      name: person.name,
      role: person.role,
      team: teamLabel(person, managerNames),
      ...(tally.get(person.uid) ?? blankMetrics()),
    }));

    // Summed over the rows, and the rows are a set of distinct people — which
    // is what makes double-counting impossible rather than merely unlikely.
    const totals = sumMetrics(rows.map((row) => pick(row)));

    const total = readsMs + activityMs;
    if (total >= 2_000) {
      console.warn(
        `[report] ${total}ms — leads+deals ${readsMs}ms, activity ${activityMs}ms ` +
          `(${uids.length} people, ${leadIds.length} leads with activity since ${from}` +
          `${warning ? ", collection-group index MISSING" : ""})`
      );
    }

    return {
      from,
      to,
      subject: subject.id,
      subjectLabel: describeSubject(people, subject),
      rows,
      totals,
      options,
      warning,
    };
  });
}

/* -------------------------------------------------------------------------- */
/* Pieces                                                                      */
/* -------------------------------------------------------------------------- */

function pick(row: ReportRow): PersonMetrics {
  return {
    remarks: row.remarks,
    followUps: row.followUps,
    newConnects: row.newConnects,
    followUpConnects: row.followUpConnects,
    meetings: row.meetings,
    siteVisits: row.siteVisits,
    dealsClosed: row.dealsClosed,
    tokensReceived: row.tokensReceived,
    p1: row.p1,
    p2: row.p2,
    p3: row.p3,
  };
}

/**
 * The range as a pair of millisecond bounds.
 *
 * The obvious implementation runs `karachiDayKey` on every lead and every
 * deal, and that is an `Intl.DateTimeFormat` per row — on a pipeline of a few
 * thousand leads it is seconds of pure formatting for a comparison that is two
 * integers. Karachi is a fixed UTC+5 with no daylight saving, so the whole
 * range reduces to one interval computed once.
 */
function karachiWindow(from: string, to: string): { start: number; end: number } {
  return {
    start: Date.parse(`${from}T00:00:00.000+05:00`),
    end: Date.parse(`${to}T23:59:59.999+05:00`),
  };
}

/** Firestore Timestamp, Date or ISO string → is it inside that window. */
function inWindow(value: unknown, window: { start: number; end: number }): boolean {
  if (!value) return false;

  let ms: number;
  if (value instanceof Date) ms = value.getTime();
  else if (typeof value === "string") ms = Date.parse(value);
  else if (typeof (value as { toMillis?: () => number }).toMillis === "function") {
    ms = (value as { toMillis: () => number }).toMillis();
  } else if (typeof (value as { toDate?: () => Date }).toDate === "function") {
    ms = (value as { toDate: () => Date }).toDate().getTime();
  } else return false;

  return Number.isFinite(ms) && ms >= window.start && ms <= window.end;
}

/**
 * Everyone this reader may report on — employees, managers and the admins,
 * because §"Admin Report" needs the logged-in admin to be a subject like
 * anybody else.
 */
async function loadPeople(
  auth: { uid: string; role: string | null; name?: string | null; email?: string | null },
  seesEveryone: boolean,
  ownProfile?: FirebaseFirestore.DocumentData
): Promise<ReportPerson[]> {
  const toPerson = (uid: string, data: FirebaseFirestore.DocumentData): ReportPerson => ({
    uid,
    name: (data.name as string) || (data.email as string) || "Unnamed",
    role: (data.role as ReportPerson["role"]) ?? "employee",
    subAdminUid: (data.subAdminUid as string | undefined) ?? null,
  });

  if (seesEveryone) {
    // One read of the whole user collection rather than three role queries:
    // this is a handful of documents and the report needs every role anyway.
    const snap = await adminDb.collection("users").get();
    return snap.docs
      .map((doc) => toPerson(doc.id, doc.data()))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  if (auth.role === "subadmin") {
    const team = await adminDb.collection("users").where("subAdminUid", "==", auth.uid).get();
    const self: ReportPerson = {
      uid: auth.uid,
      name:
        (ownProfile?.name as string) ||
        (ownProfile?.email as string) ||
        auth.name ||
        auth.email ||
        "Me",
      role: "subadmin",
      subAdminUid: null,
    };
    return [
      self,
      ...team.docs
        .map((doc) => toPerson(doc.id, doc.data()))
        .sort((a, b) => a.name.localeCompare(b.name)),
    ];
  }

  const own = await adminDb.collection("users").doc(auth.uid).get();
  if (!own.exists) return [];
  return [toPerson(own.id, own.data()!)];
}

/**
 * The grouped selector, in the order it is offered.
 *
 * Overall first — an admin opening this screen wants the company picture
 * before they want one person — then the individuals. Groups with nobody in
 * them are dropped by the UI, so a single-employee reader sees exactly one
 * option and no empty headings.
 */
function buildOptions(people: ReportPerson[], viewerUid: string): ReportOption[] {
  const employees = people.filter((person) => person.role === "employee");
  const managers = people.filter((person) => person.role === "subadmin");
  const admins = people.filter((person) => person.role === "admin");

  const options: ReportOption[] = [];

  if (employees.length > 1) {
    options.push({
      value: "ALL_EMPLOYEES",
      label: "All Employees",
      group: "OVERALL",
      hint: `Combined performance of ${employees.length} employees`,
    });
  }
  // Only when there is more than one team. With a single manager "All
  // Managers" and selecting that manager produce identical figures, and two
  // options that do the same thing read as though they do not.
  if (managers.length > 1) {
    options.push({
      value: "ALL_MANAGERS",
      label: "All Managers",
      group: "OVERALL",
      hint: "Every manager, each including their own team",
    });
  }

  for (const person of employees) {
    options.push({
      value: person.uid,
      label: person.name,
      group: "EMPLOYEES",
      hint: person.uid === viewerUid ? "You" : undefined,
    });
  }
  for (const person of managers) {
    options.push({
      value: person.uid,
      label: person.name,
      group: "MANAGERS",
      hint: person.uid === viewerUid ? "You — with your team" : "Includes their team",
    });
  }
  for (const person of admins) {
    options.push({
      value: person.uid,
      label: person.uid === viewerUid ? `${person.name} (You)` : person.name,
      group: "ADMIN",
      hint: "The admin's own activity",
    });
  }

  // Something always has to be selectable, or the screen opens on nothing.
  if (options.length === 0 && people.length > 0) {
    options.push({ value: people[0].uid, label: people[0].name, group: "EMPLOYEES" });
  }

  return options;
}

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
async function loadEntries(
  from: string,
  to: string,
  leadIds: string[]
): Promise<{ entries: FirebaseFirestore.QueryDocumentSnapshot[]; warning: string | null }> {
  try {
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

    const entries: FirebaseFirestore.QueryDocumentSnapshot[] = [];
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
      for (const snap of snaps) entries.push(...snap.docs);
    }

    return {
      entries,
      // Names the command rather than a console path. The console's
      // "Single field → Add exemption" screen is genuinely hard to find, and
      // `npm run deploy:indexes` creates this override and every other missing
      // index in one go from `firestore.indexes.json`.
      warning:
        "These figures are correct, but the report ran the slow way: the " +
        "followUps.dayKey collection-group index is missing. A developer can create it " +
        "with `npm run deploy:indexes` — see docs/deployment-runbook.md for the one " +
        "IAM role that needs granting first.",
    };
  }
}
