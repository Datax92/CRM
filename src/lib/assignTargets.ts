/**
 * Who a Data Bank record may be handed to.
 *
 * Three kinds of recipient, and they are not interchangeable:
 *
 * | group | what happens to the lead |
 * |---|---|
 * | Employee | lands in their pipeline, exactly as it always has |
 * | Sub Admin / Manager | lands in **their Client section**, in a folder mirroring the source |
 * | Admin / Myself | lands in the **admin's own Client section** |
 *
 * Handing a lead to a manager or to yourself is not a distribution decision —
 * nobody is being given work off a rotation — so it does not belong in the
 * employee lead flow. The server enforces that; this module only builds the
 * list the two Data Bank surfaces offer, so desktop and phone cannot show
 * different options.
 *
 * Dependency-free, so the unit tests run under raw
 * `node --experimental-strip-types`.
 */

export interface AssignablePerson {
  uid: string;
  name: string;
  status?: string;
  priority?: number;
  accessRole?: 'employee' | 'subadmin';
}

export interface AssignOption {
  uid: string;
  label: string;
  /** A short line under the name — the lane priority, or where the lead goes. */
  hint: string;
  group: 'MYSELF' | 'MANAGERS' | 'EMPLOYEES';
}

export const ASSIGN_GROUP_LABELS: Record<AssignOption['group'], string> = {
  MYSELF: 'Me',
  MANAGERS: 'Managers',
  EMPLOYEES: 'Employees',
};

/**
 * The options, in the order they should be offered.
 *
 * **Yourself first.** Taking a lead is the quickest thing anyone does on this
 * screen and burying it under twenty names makes it the slowest. The label is
 * spelled out — "Admin / Myself" — because "Usman Sheikh" in a list of
 * employees does not tell the admin that picking it routes the lead somewhere
 * completely different.
 *
 * Paused accounts are dropped: the server refuses them, and offering a choice
 * that will be refused is worse than not offering it.
 */
export function buildAssignOptions(
  people: AssignablePerson[],
  viewer: { uid: string; name: string; role: 'admin' | 'subadmin' | 'employee' | null }
): AssignOption[] {
  const active = people.filter((person) => person.status !== 'DISABLED');

  const options: AssignOption[] = [];

  if (viewer.role === 'admin' || viewer.role === 'subadmin') {
    options.push({
      uid: viewer.uid,
      label: viewer.role === 'admin' ? 'Admin / Myself' : `${viewer.name} (Myself)`,
      hint: 'Goes to your Client section, not the employee pipeline',
      group: 'MYSELF',
    });
  }

  for (const person of active) {
    // The viewer is already offered above; listing them twice would be two
    // options that do the same thing and read as though they do not.
    if (person.uid === viewer.uid) continue;

    if (person.accessRole === 'subadmin') {
      options.push({
        uid: person.uid,
        label: person.name,
        hint: 'Manager — goes to their Client section',
        group: 'MANAGERS',
      });
    } else {
      options.push({
        uid: person.uid,
        label: person.name,
        hint: person.priority ? `Employee · lane P${person.priority}` : 'Employee',
        group: 'EMPLOYEES',
      });
    }
  }

  return options;
}

/** The options grouped for a `<select>`, empty groups omitted. */
export function groupAssignOptions(
  options: AssignOption[]
): { group: AssignOption['group']; label: string; options: AssignOption[] }[] {
  return (['MYSELF', 'MANAGERS', 'EMPLOYEES'] as const)
    .map((group) => ({
      group,
      label: ASSIGN_GROUP_LABELS[group],
      options: options.filter((option) => option.group === group),
    }))
    .filter((section) => section.options.length > 0);
}

/** The chosen option, for a confirmation message that names where it went. */
export function describeAssignee(options: AssignOption[], uid: string): string {
  const option = options.find((entry) => entry.uid === uid);
  if (!option) return 'the team';
  return option.group === 'MYSELF' ? 'you' : option.label;
}
