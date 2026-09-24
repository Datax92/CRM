"use server";

/**
 * What one person — or a manager's whole team — actually wrote, between two
 * dates, lead by lead.
 *
 * **The employee dossier's activity cuts run off this, and Reports runs off
 * the same records through the same classification** (`entryTally`). Before
 * it, the dossier answered "Remarks · Today" from the lead's all-time
 * `followUpCount` and "Connected · Today" from its all-time `connectCount`,
 * with only the *lead's last touch* filtered to the period. So a lead touched
 * today that had been connected with a fortnight ago counted as a connect
 * today. Measured against the live project on 2026-09-09: one employee's
 * dossier read **7 connects** on a day she made **3**.
 *
 * Now: an entry is counted on the day it was written, on the lead it was
 * written on, credited to whoever works that lead — and the same entry can be
 * both a Remark and a New Connect, which is what the owner asked for.
 *
 * **Why a Server Action rather than a client query.** The entries live in a
 * subcollection per lead, so a range across a person's whole pipeline is a
 * collection-group query — the one shape this project's Security Rules cannot
 * scope safely, because a rule cannot see which lead a follow-up belongs to
 * without a lookup per document. Running it with the Admin SDK and deciding
 * the scope here from the verified token keeps the boundary where it can be
 * enforced. Same reasoning, same shape, as `buildTeamReport`.
 */

import { adminDb } from "@/lib/firebase/server";
import { verifyAuth } from "@/lib/firebase/serverAuth";
import { runAction, UserFacingError, type ActionResult } from "@/lib/actionResult";
import { loadEntries, toCountableEntries } from "@/lib/reportEntries";
import { addTally, tallyEntries, EMPTY_TALLY, type EntryTally } from "@/lib/leadBuckets";
import { loadWorkedMinutes } from "@/lib/server/activityDays";

export interface ActivityItem {
  id: string;
  leadId: string;
  action: string;
  detail: string;
  at: string;
  icon: string;
  kind?: string;
  connect?: boolean;
}

export interface ActivityBreakdown {
  from: string;
  to: string;
  /** The subject's own totals — the four figures Reports shows for the range. */
  totals: EntryTally;
  /** Minutes worked in the range, from attendance — the dossier's Hours figure. */
  workedMinutes: number;
  /**
   * Per lead, for the dossier's cuts. A lead with no entry in the range is
   * simply absent rather than present as four zeroes: the map is the answer to
   * "which leads were worked in these dates", and padding it would make an
   * untouched pipeline of 3,000 leads a 3,000-entry payload.
   */
  byLead: Record<string, EntryTally>;
  /** Feed of entries written in this date range. */
  items?: ActivityItem[];
  /** Set when the collection-group index is missing and the slow path ran. */
  warning?: string | null;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Firestore's `in` ceiling. */
const IN_CHUNK = 30;

export async function buildActivityBreakdown(
  token: string,
  /** The people whose work to count — one employee, or a manager's whole team. */
  uids: string[],
  from: string,
  to: string
): Promise<ActionResult<ActivityBreakdown>> {
  return runAction("buildActivityBreakdown", async () => {
    const auth = await verifyAuth(token);

    if (!DAY.test(from) || !DAY.test(to)) {
      throw new UserFacingError("Choose a start and an end date.");
    }
    if (from > to) {
      throw new UserFacingError("The start date is after the end date.");
    }

    const wanted = [...new Set((uids ?? []).filter(Boolean))];
    if (wanted.length === 0) throw new UserFacingError("Choose whose activity to show.");
    if (wanted.length > 200) throw new UserFacingError("That is too many people at once.");

    /* ------------------------------------------------------------------ */
    /* Who this reader may count                                          */
    /* ------------------------------------------------------------------ */

    // Decided from the verified token, never from the request. An admin and an
    // HR manager reach everybody; a Sales manager reaches their own team and
    // themselves; an employee reaches only themselves. The same reach the
    // dossier itself is gated on, re-checked here because a Server Action is
    // the boundary and the component is not.
    const allowed = await resolveReach(auth, wanted);
    const refused = wanted.filter((uid) => !allowed.has(uid));
    if (refused.length > 0) {
      throw new UserFacingError("That is not somebody you can see the activity for.");
    }

    /* ------------------------------------------------------------------ */
    /* Their leads, then the entries inside them                          */
    /* ------------------------------------------------------------------ */

    // The fallback path needs lead ids, and pruning them by `lastFollowUpAt`
    // is what keeps it survivable: a lead whose newest entry predates the
    // range cannot hold one inside it. Safe because an entry can only be
    // **back**-dated — its `dayKey` comes from `occurredAt`, which cannot be
    // later than the write.
    //
    // **Read only if the fast path fails** (2026-09-24). The lead list feeds the
    // fallback and nothing else, and every dossier open used to read the
    // subject's whole pipeline for it — hundreds of reads for a list that the
    // deployed index makes unnecessary.
    const start = Date.parse(`${from}T00:00:00.000+05:00`);
    const leadIdsForFallback = async () => {
      const leadSnaps = await Promise.all(
        chunk(wanted).map((slice) =>
          adminDb.collection("leads").where("assignedUserId", "in", slice).get()
        )
      );
      const ids: string[] = [];
      for (const snap of leadSnaps) {
        for (const doc of snap.docs) {
          const last = doc.data().lastFollowUpAt as { toMillis?: () => number } | undefined;
          if (last?.toMillis && last.toMillis() >= start) ids.push(doc.id);
        }
      }
      return ids;
    };

    const [{ entries, warning }, minutesByUid] = await Promise.all([
      loadEntries(from, to, leadIdsForFallback, wanted),
      loadWorkedMinutes(wanted, from, to),
    ]);
    const workedMinutes = [...minutesByUid.values()].reduce((sum, minutes) => sum + minutes, 0);
    const { byUid, byLead } = tallyEntries(toCountableEntries(entries), new Set(wanted));

    // A composite subject — a manager and their team — is the sum of a set of
    // distinct people, which is what makes double-counting impossible rather
    // than merely unlikely. Same property `reportScope` relies on.
    const totals = { ...EMPTY_TALLY };
    for (const tally of byUid.values()) addTally(totals, tally);

    const items: ActivityItem[] = [];
    for (const doc of entries) {
      const data = doc.data();
      const creditUid = (data.creditUid as string) ?? (data.authorUid as string) ?? "";
      if (!wanted.includes(creditUid)) continue;

      const leadId = doc.ref.parent.parent?.id ?? "";
      const occurred = data.occurredAt?.toDate?.() ?? new Date();
      const kind = data.kind as string | undefined;
      const isRemark = kind === "REMARK";
      const isCall = Boolean(data.callMade);
      const isConnect = data.connect === true;
      const duration = data.durationSeconds ? Number(data.durationSeconds) : 0;
      const msg = (data.message as string | undefined)?.trim() ?? "";

      let action = isRemark ? "Logged remark" : "Logged follow-up";
      if (isCall) {
        action = isConnect ? "Connected call" : "Answered call";
      }

      let detail = msg;
      if (isCall && duration > 0) {
        const min = Math.floor(duration / 60);
        const sec = duration % 60;
        const durStr = min > 0 ? `${min}m ${sec}s` : `${sec}s`;
        detail = `${durStr} call${isConnect ? " (Connect)" : ""}${msg ? ` · ${msg}` : ""}`;
      }

      items.push({
        id: doc.id,
        leadId,
        action,
        detail,
        at: occurred.toISOString(),
        icon: isCall
          ? "M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"
          : isRemark
            ? "M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"
            : "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z",
        kind,
        connect: isConnect,
      });
    }

    return { from, to, totals, workedMinutes, byLead: Object.fromEntries(byLead), items, warning };
  });
}

/* -------------------------------------------------------------------------- */

function chunk<T>(all: T[], size = IN_CHUNK): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < all.length; index += size) out.push(all.slice(index, index + size));
  return out;
}

/** The uids this caller is entitled to count, out of the ones they asked for. */
async function resolveReach(
  auth: { uid: string; role: string; isHr: boolean },
  wanted: string[]
): Promise<Set<string>> {
  if (auth.role === "admin" || auth.isHr) return new Set(wanted);

  // Everyone may always see their own.
  const allowed = new Set<string>([auth.uid]);

  if (auth.role === "subadmin") {
    const team = await adminDb.collection("users").where("subAdminUid", "==", auth.uid).get();
    for (const doc of team.docs) allowed.add(doc.id);
  }

  return allowed;
}
