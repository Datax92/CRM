/**
 * Job titles an employee can hold.
 *
 * Distinct from the auth `role` field on the same document, which is only ever
 * "admin" or "employee" and governs access. This is the human job title shown
 * in the directory; it carries no permissions.
 */
export const JOB_TITLES = [
  'Sales Executive',
  'Senior Sales Executive',
  'Team Lead',
  'Account Manager',
  'Business Development',
  'Intern',
] as const;

export type JobTitle = (typeof JOB_TITLES)[number];

export const DEFAULT_JOB_TITLE: JobTitle = 'Sales Executive';

/** Falls back rather than showing a blank cell for pre-existing records. */
export function normalizeJobTitle(value: unknown): string {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || DEFAULT_JOB_TITLE;
}
