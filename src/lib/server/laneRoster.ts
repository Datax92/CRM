import 'server-only';

/**
 * Who a lead may go to — the whole rotation, or the people one folder is
 * restricted to.
 *
 * **Why this is one function.** Three paths move a lead automatically: the
 * Meta intake that offers it the moment it lands, the cron sweep that cascades
 * it when a window lapses, and Pass on. Each used to build its own roster, and
 * the last time that mapping was written out three times one copy quietly
 * stopped reading `autoAssign` — four employees marked out of distribution kept
 * receiving leads for weeks. A folder restriction has exactly the same shape,
 * so it is read in exactly one place.
 *
 * **The restriction rides on the lead, not on a join back to the folder.** It
 * is stamped as `laneUids` when the lead is created, so a cascade five minutes
 * later costs no folder read and cannot be changed underneath a lead already in
 * flight — the same reason a lead's recorded source is denormalised.
 */

import { adminDb } from '@/lib/firebase/server';
import type { DocumentData, Transaction } from 'firebase-admin/firestore';
import {
  normalizeLaneUids,
  readChosenLaneMember,
  readLaneEmployee,
  type Employee,
} from '@/lib/distribution';

export interface LaneRoster {
  /** In priority order once the lane rule sorts them; disabled people included and skipped there. */
  employees: Employee[];
  /** The stored profile behind each of them — the name, the role, the team. */
  profiles: Map<string, DocumentData>;
  /** True when this is one folder's own group rather than the whole rotation. */
  restricted: boolean;
}

/**
 * The roster a lead is distributed within.
 *
 * With a restriction, the chosen people are read by id — a `getAll` of at most
 * `MAX_LANE_UIDS` documents, which is cheaper than the roster query it replaces
 * and reaches the **admin** as well, whose `role` the roster query deliberately
 * excludes. A chosen account that has since been deleted is simply not in the
 * result; the group shrinks rather than the routing failing.
 */
export async function readLaneRoster(t: Transaction, laneUids: unknown): Promise<LaneRoster> {
  const chosen = normalizeLaneUids(laneUids);
  const employees: Employee[] = [];
  const profiles = new Map<string, DocumentData>();

  if (chosen.length > 0) {
    const refs = chosen.map((uid) => adminDb.collection('users').doc(uid));
    const snaps = await t.getAll(...refs);
    for (const snap of snaps) {
      if (!snap.exists) continue;
      const data = snap.data()!;
      employees.push(readChosenLaneMember(snap.id, data));
      profiles.set(snap.id, data);
    }
    return { employees, profiles, restricted: true };
  }

  // Managers too — only the ones an admin has put in the rotation get a turn,
  // which `readLaneEmployee` decides.
  const usersSnap = await t.get(
    adminDb.collection('users').where('role', 'in', ['employee', 'subadmin'])
  );
  usersSnap.forEach((doc) => {
    const data = doc.data();
    employees.push(readLaneEmployee(doc.id, data));
    profiles.set(doc.id, data);
  });

  return { employees, profiles, restricted: false };
}
