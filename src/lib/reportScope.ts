/**
 * Who a Team report is *about*, and how the figures add up for them.
 *
 * The report has one subject at a time, chosen from a grouped selector:
 *
 * | subject | figures |
 * |---|---|
 * | an employee | their own activity |
 * | a manager | **their own activity plus every employee assigned to them** |
 * | the admin | their own activity |
 * | All Employees | every employee, summed |
 * | All Managers | every manager, each including their own team |
 *
 * **The unit of measurement is one person, counted once.** Every figure in the
 * report is built per-person first (`PersonMetrics`), and a composite subject
 * is the sum of a *set of people* — so a manager's row cannot double-count an
 * employee's connects, and "All Managers" cannot count an employee twice
 * because an employee belongs to exactly one manager. That is the whole reason
 * this module exists rather than the server summing rows ad hoc: the "no
 * double-counting" requirement is a property of how the sets are built, not
 * something to be careful about at each call site.
 *
 * An employee with no manager is nobody's team member. They appear under All
 * Employees and on their own row, and are deliberately absent from All
 * Managers — inventing a "no manager" bucket there would read as a team that
 * does not exist.
 *
 * Dependency-free so the unit tests run under raw
 * `node --experimental-strip-types`.
 */

/** The metrics every subject reports, in column order. */
export interface PersonMetrics {
  /**
   * Remarks written in the range — the **first** entry on a lead.
   *
   * Every entry, not only the ones where a call connected. "How many leads did
   * this person open this week" and "how many of those calls were answered" are
   * different questions, and the connect columns already answer the second; a
   * report that only counted connected work would show a zero for somebody who
   * spent the day on numbers that did not pick up.
   */
  remarks: number;
  /** Follow-ups written in the range — every entry after the first on a lead. */
  followUps: number;
  /** Connected calls recorded on a Remark — the first contact on a lead. */
  newConnects: number;
  /** Connected calls recorded on a Follow-Up — every contact after the first. */
  followUpConnects: number;
  meetings: number;
  siteVisits: number;
  dealsClosed: number;
  tokensReceived: number;
  p1: number;
  p2: number;
  p3: number;
}

export const METRIC_KEYS: (keyof PersonMetrics)[] = [
  'remarks',
  'followUps',
  'newConnects',
  'followUpConnects',
  'meetings',
  'siteVisits',
  'dealsClosed',
  'tokensReceived',
  'p1',
  'p2',
  'p3',
];

export function blankMetrics(): PersonMetrics {
  return {
    remarks: 0,
    followUps: 0,
    newConnects: 0,
    followUpConnects: 0,
    meetings: 0,
    siteVisits: 0,
    dealsClosed: 0,
    tokensReceived: 0,
    p1: 0,
    p2: 0,
    p3: 0,
  };
}

export function addMetrics(into: PersonMetrics, from: PersonMetrics): PersonMetrics {
  for (const key of METRIC_KEYS) into[key] += from[key];
  return into;
}

export function sumMetrics(all: PersonMetrics[]): PersonMetrics {
  return all.reduce((total, one) => addMetrics(total, one), blankMetrics());
}

/* -------------------------------------------------------------------------- */
/* People                                                                      */
/* -------------------------------------------------------------------------- */

export type PersonRole = 'admin' | 'subadmin' | 'employee';

export interface ReportPerson {
  uid: string;
  name: string;
  role: PersonRole;
  /** The manager who runs them. Null for a manager, an admin, or a direct report. */
  subAdminUid: string | null;
}

/**
 * What the selector offers.
 *
 * `ALL_EMPLOYEES` and `ALL_MANAGERS` are subjects in their own right rather
 * than a "select all" on the list: the aggregate a manager belongs to is not
 * the same shape as the aggregate an employee belongs to, and conflating them
 * is exactly the mistake that makes a report add up to more work than happened.
 */
export type ReportSubjectKind = 'ALL_EMPLOYEES' | 'ALL_MANAGERS' | 'PERSON';

export interface ReportSubject {
  /** The selector value. `ALL_EMPLOYEES`, `ALL_MANAGERS`, or a uid. */
  id: string;
  kind: ReportSubjectKind;
}

export const ALL_EMPLOYEES = 'ALL_EMPLOYEES';
export const ALL_MANAGERS = 'ALL_MANAGERS';

export function parseSubject(raw: string | null | undefined): ReportSubject {
  const token = (raw ?? '').trim();
  if (!token || token === ALL_EMPLOYEES) return { id: ALL_EMPLOYEES, kind: 'ALL_EMPLOYEES' };
  if (token === ALL_MANAGERS) return { id: ALL_MANAGERS, kind: 'ALL_MANAGERS' };
  return { id: token, kind: 'PERSON' };
}

/* -------------------------------------------------------------------------- */
/* The sets                                                                    */
/* -------------------------------------------------------------------------- */

/** Everyone a manager's row covers: themselves, then their team. */
export function teamOf(people: ReportPerson[], managerUid: string): ReportPerson[] {
  const manager = people.find((person) => person.uid === managerUid);
  const team = people.filter(
    (person) => person.role === 'employee' && person.subAdminUid === managerUid
  );
  return manager ? [manager, ...team] : team;
}

/**
 * The rows a subject breaks down into, in display order.
 *
 * A composite subject shows its parts as well as its total, because "the team
 * did 300 connects" is the answer to a different question from "who did them".
 * A single employee is one row; a single manager is the manager plus their
 * team, so the row that carries the manager's own figures is visible rather
 * than silently folded into a headline.
 */
export function rowsForSubject(people: ReportPerson[], subject: ReportSubject): ReportPerson[] {
  if (subject.kind === 'ALL_EMPLOYEES') {
    return people.filter((person) => person.role === 'employee');
  }

  if (subject.kind === 'ALL_MANAGERS') {
    // Every manager, each followed by their own team. An employee under no
    // manager is not here — see the module note.
    const rows: ReportPerson[] = [];
    const seen = new Set<string>();
    for (const manager of people.filter((person) => person.role === 'subadmin')) {
      for (const member of teamOf(people, manager.uid)) {
        if (seen.has(member.uid)) continue;
        seen.add(member.uid);
        rows.push(member);
      }
    }
    return rows;
  }

  const person = people.find((entry) => entry.uid === subject.id);
  if (!person) return [];
  return person.role === 'subadmin' ? teamOf(people, person.uid) : [person];
}

/**
 * The label under the subject's headline — what the reader is looking at.
 *
 * Spelled out rather than implied, because "Manager A" and "Manager A's whole
 * team" are different numbers and the selector shows the same words for both.
 */
export function describeSubject(people: ReportPerson[], subject: ReportSubject): string {
  if (subject.kind === 'ALL_EMPLOYEES') {
    const count = people.filter((person) => person.role === 'employee').length;
    return `All employees · ${count} ${count === 1 ? 'person' : 'people'}`;
  }
  if (subject.kind === 'ALL_MANAGERS') {
    const managers = people.filter((person) => person.role === 'subadmin').length;
    return `All managers and their teams · ${managers} ${managers === 1 ? 'team' : 'teams'}`;
  }

  const person = people.find((entry) => entry.uid === subject.id);
  if (!person) return 'Nobody selected';
  if (person.role === 'subadmin') {
    const size = teamOf(people, person.uid).length - 1;
    return `${person.name} and their team · ${size} ${size === 1 ? 'employee' : 'employees'}`;
  }
  return person.role === 'admin' ? `${person.name} · admin's own activity` : person.name;
}

/**
 * A short, stable identifier for the ID column.
 *
 * Firestore uids are 28 characters of noise; a report needs something a person
 * can read out. Derived from the uid rather than stored, so it is stable across
 * reloads and needs no migration — the full uid is still on the row for anyone
 * who needs to match it against the database.
 */
export function shortId(uid: string): string {
  const clean = (uid ?? '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  return clean ? clean.slice(0, 5).padEnd(5, '0') : '—';
}

/** The team column: who runs this person. */
export function teamLabel(
  person: ReportPerson,
  managerNames: Map<string, string>
): string {
  if (person.role === 'admin') return 'Admin';
  if (person.role === 'subadmin') return 'Manager';
  return person.subAdminUid ? (managerNames.get(person.subAdminUid) ?? 'Manager') : 'Admin';
}
