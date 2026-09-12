/**
 * The three access roles and what each one may reach.
 *
 * ```
 * ADMIN
 * ├── Sub Admin A ── Employee 1, 2, 3
 * ├── Sub Admin B ── Employee 4, 5
 * └── (directly managed) Employee 6, 7
 * ```
 *
 * A **sub admin** is a manager: they run a subset of the roster and a subset of
 * the Data Bank, and they see everything those employees do. They are not a
 * junior admin — they never see another sub admin's money, the company's
 * profit, or a folder they were not given.
 *
 * **The link is stored on the subordinate, not on the manager.** An employee
 * carries `subAdminUid`; a Data Bank folder carries `subAdminUid`. A list on
 * the manager would need a transaction to stay consistent with the other side,
 * and — the reason that actually decides it — Security Rules can prove a query
 * like `where('subAdminUid','==',me)` is safe, while they cannot prove anything
 * about a query whose scope lives in a different document.
 *
 * `subAdminUid` absent means "managed directly by the admin", which is what
 * every record that predates this file means. Nothing needs migrating.
 */

export const USER_ROLES = ['admin', 'subadmin', 'employee'] as const;

export type UserRole = (typeof USER_ROLES)[number];

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Admin',
  subadmin: 'Sub Admin',
  employee: 'Employee',
};

/** Plural, for headings and counts. */
export const ROLE_LABELS_PLURAL: Record<UserRole, string> = {
  admin: 'Admins',
  subadmin: 'Sub Admins',
  employee: 'Employees',
};

/** Highest first. Used for sorting a mixed roster and for rank comparisons. */
export const ROLE_RANK: Record<UserRole, number> = {
  admin: 0,
  subadmin: 1,
  employee: 2,
};

export function isUserRole(value: unknown): value is UserRole {
  return typeof value === 'string' && (USER_ROLES as readonly string[]).includes(value);
}

/** Falls back to `employee` — the least privileged reading of a broken value. */
export function normalizeRole(value: unknown): UserRole {
  return isUserRole(value) ? value : 'employee';
}

/** Admin or sub admin: the two roles that can manage people and hand out leads. */
export function isManagerRole(role: unknown): boolean {
  return role === 'admin' || role === 'subadmin';
}

/**
 * Whether `role` may see records belonging to `subject`.
 *
 * Deliberately not a permission check on its own — every server action still
 * verifies the specific link (is this employee mine?). This is the coarse
 * rank test that keeps the UI honest.
 */
export function outranks(role: UserRole, subject: UserRole): boolean {
  return ROLE_RANK[role] < ROLE_RANK[subject];
}

/* -------------------------------------------------------------------------- */
/* What kind of manager                                                        */
/* -------------------------------------------------------------------------- */

/**
 * A sub admin is either an **HR Manager** or a **Sales Manager**.
 *
 * Not a fourth role: they share every permission the hierarchy already grants a
 * manager, and differ in exactly one dimension — **reach**. A Sales manager
 * sees their own team and nobody else's. HR runs the company: attendance and
 * leave (§13), the salary figures, and — since the owner asked for it — the
 * **lead pipeline**, so HR can hand any lead to any active employee whatever
 * team they are on. Adding a role would have meant re-deciding every existing
 * rule for it; a flag on the manager decides only the new thing.
 *
 * The distinction is one predicate, `isHrManager`, read by the server actions,
 * the read hooks and the Security Rules alike — a second spelling of "is this
 * person HR" is how two surfaces end up disagreeing about one person.
 *
 * Absent means `SALES`, so every manager who existed before this module keeps
 * exactly the reach they had.
 */
export const MANAGER_KINDS = ['SALES', 'HR'] as const;

export type ManagerKind = (typeof MANAGER_KINDS)[number];

export const MANAGER_KIND_LABELS: Record<ManagerKind, string> = {
  SALES: 'Sales Manager',
  HR: 'HR Manager',
};

export function normalizeManagerKind(value: unknown): ManagerKind {
  return value === 'HR' ? 'HR' : 'SALES';
}

/**
 * Whether this person's reach is the whole company rather than one team.
 *
 * True for the admin and for an HR manager. It governs attendance, leave,
 * office expenses, salary, the report subjects — and lead distribution: an HR
 * manager reads the whole pipeline and may assign or reassign any lead to any
 * active employee, exactly as the admin does.
 */
export function isHrManager(role: unknown, managerKind: unknown): boolean {
  return role === 'admin' || (role === 'subadmin' && normalizeManagerKind(managerKind) === 'HR');
}

/**
 * **What this person's role reads as, on any screen that shows people.**
 *
 * The one answer to "what is written under their name", and the reason it
 * exists: a **manager has no job title**. The Add Manager form does not ask for
 * one (§ *A Manager is not an employee*), so `jobTitle` on a manager's document
 * is either absent or a leftover from before they were promoted — and every
 * manager in the live project carries the stale default, **"Sales Executive"**.
 * Printing it made a manager's own dossier contradict the card behind it: the
 * card said `SALES MANAGER`, the dossier said `Sales Executive`.
 *
 * So a manager reads as their **kind** — Sales Manager or HR Manager — which is
 * the distinction that actually governs what they can reach (§13), and an
 * employee reads as their job title. Nothing on a manager's record is thrown
 * away; `jobTitle` is simply not the field that answers this question about
 * them.
 *
 * | role | reads as |
 * |---|---|
 * | admin | Admin |
 * | subadmin, `managerKind: 'HR'` | HR Manager |
 * | subadmin, anything else | Sales Manager |
 * | employee | their job title, or `Employee` |
 *
 * An absent `managerKind` falls back to Sales, so every manager who existed
 * before that field keeps exactly the reading they had.
 */
export function roleTitle(person: {
  role?: unknown;
  /** `useEmployees` spells the same field `accessRole`; either is accepted. */
  accessRole?: unknown;
  managerKind?: unknown;
  jobTitle?: string | null;
}): string {
  const role = person.role ?? person.accessRole;
  if (role === 'admin') return ROLE_LABELS.admin;
  if (role === 'subadmin') return MANAGER_KIND_LABELS[normalizeManagerKind(person.managerKind)];
  return (person.jobTitle ?? '').trim() || ROLE_LABELS.employee;
}

/**
 * Whether `actor` may hand a lead to `recipient`.
 *
 * The one place this question is answered. `assignLead`, `reassignLeadManual`
 * and `assignLeadsBulk` all ask it, and the read hooks build their assignment
 * list from the same distinction — three call sites restating "unless they are
 * HR" is how one of them ends up not saying it.
 *
 * | actor | reach |
 * |---|---|
 * | admin | anybody, employee or manager |
 * | HR manager | anybody, employee or manager — their reach is the company (§13) |
 * | Sales manager | the employees on their own team, and no manager |
 * | employee | nobody |
 *
 * **A manager can be given a lead, and only by the admin or HR.** A manager
 * works their own leads — `canWorkLead` has always allowed it, and a Data Bank
 * promotion into their Client section already produces one — so there was never
 * a reason the pipeline could not hand them one directly, except that nothing
 * offered it. What stays closed is a Sales manager handing work sideways to
 * another manager: that is cross-team distribution, which is the admin's and
 * HR's to do.
 *
 * It answers *reach* only. Whether the recipient exists and is still active are
 * separate checks the actions make against the document itself — this function
 * is given the link and the role, not the person's whole state, precisely so it
 * cannot be mistaken for all of them.
 */
export function canAssignLeadTo(
  actor: { role: unknown; uid: string; managerKind?: unknown },
  recipient: { subAdminUid?: string | null; role?: unknown }
): boolean {
  if (actor.role === 'admin') return true;
  if (actor.role !== 'subadmin') return false;
  if (isHrManager(actor.role, actor.managerKind)) return true;

  /*
    A Sales manager's reach is their own team, and a manager is not on it.

    The role test is **belt and braces, not load-bearing**: a manager carries no
    `subAdminUid`, so the comparison below would refuse them anyway. It is
    spelled out because the next person to widen this function should have to
    delete a line that says "no manager" rather than discover the rule by
    accident in a field that happens to be empty.

    `Boolean(actor.uid)` is load-bearing: with an actor whose uid is somehow
    missing, `undefined === undefined` would say yes to every recipient whose
    own link is unset.
  */
  if (recipient.role === 'subadmin' || recipient.role === 'admin') return false;
  return Boolean(actor.uid) && recipient.subAdminUid === actor.uid;
}

/**
 * Which sub admin a lead belongs to once `recipient` is working it.
 *
 * For an employee it is their manager, as it always was. **For a manager it is
 * themselves**, and that is not a nicety: a manager's leads query is
 * `where('subAdminUid','==',me)` and the Security Rule checks exactly that
 * clause, so a lead handed to a manager with somebody else's uid on it — or
 * with none — is one they are refused and cannot see. The screen would render
 * empty, which is this project's most-repeated symptom.
 */
export function owningSubAdminFor(recipient: {
  uid?: string | null;
  role?: unknown;
  subAdminUid?: string | null;
}): string | null {
  if (recipient.role === 'subadmin') return recipient.uid ?? null;
  return recipient.subAdminUid ?? null;
}
