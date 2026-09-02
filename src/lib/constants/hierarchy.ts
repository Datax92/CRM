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
