/**
 * Sharing one person's open leads out among others — the arithmetic.
 *
 * Used when somebody leaves (or is simply overloaded): the admin says who gets
 * how many, and this decides which lead goes to whom. Pure and import-free, so
 * the Server Action, the demo store and the tests all run the same function.
 *
 * **Dealt round the recipients, not sliced.** The leads arrive newest first;
 * giving the first 60 to one person and the next 60 to another would hand one
 * of them every fresh lead and the other only the old ones. Dealing them like
 * cards gives each recipient the same mix.
 */

export interface RedistributionShare {
  uid: string;
  count: number;
}

/** The most one call moves. A person's whole pipeline, with room to spare. */
export const MAX_REDISTRIBUTION = 2000;

/**
 * Cleans what the form sent: whole, positive counts, one row per recipient.
 * Rows of zero are dropped rather than refused — an untouched row on the form
 * is not a mistake. Returns an error sentence instead of a list when the
 * request cannot be carried out as asked.
 */
export function normalizeShares(
  raw: unknown,
  sourceUid: string
): { shares: RedistributionShare[] } | { error: string } {
  if (!Array.isArray(raw)) return { error: 'Choose who gets the leads.' };

  const shares: RedistributionShare[] = [];
  const seen = new Set<string>();
  for (const row of raw as Array<{ uid?: unknown; count?: unknown }>) {
    const uid = typeof row?.uid === 'string' ? row.uid.trim() : '';
    const count = Number(row?.count);
    if (!uid || !Number.isFinite(count) || count === 0) continue;
    if (count < 0 || !Number.isInteger(count)) return { error: 'Enter a whole number of leads for each person.' };
    if (uid === sourceUid) return { error: 'Leads cannot be reassigned to the person they are being taken from.' };
    if (seen.has(uid)) return { error: 'Each person can be listed once.' };
    seen.add(uid);
    shares.push({ uid, count });
  }

  if (shares.length === 0) return { error: 'Enter how many leads at least one person gets.' };
  if (totalOf(shares) > MAX_REDISTRIBUTION) {
    return { error: `Reassign at most ${MAX_REDISTRIBUTION} leads at a time.` };
  }
  return { shares };
}

export function totalOf(shares: RedistributionShare[]): number {
  return shares.reduce((sum, share) => sum + share.count, 0);
}

/**
 * Which leads each recipient gets, in the order the leads were given.
 *
 * Asking for more than there are is the caller's to refuse; here the leads
 * simply run out and nobody is given one twice.
 */
export function planRedistribution(
  leadIds: string[],
  shares: RedistributionShare[]
): Map<string, string[]> {
  const plan = new Map<string, string[]>(shares.map((share) => [share.uid, []]));
  const left = new Map(shares.map((share) => [share.uid, share.count]));
  let waiting = shares.filter((share) => share.count > 0).map((share) => share.uid);

  let next = 0;
  while (next < leadIds.length && waiting.length > 0) {
    for (const uid of waiting) {
      if (next >= leadIds.length) break;
      plan.get(uid)!.push(leadIds[next]);
      next += 1;
      left.set(uid, left.get(uid)! - 1);
    }
    waiting = waiting.filter((uid) => left.get(uid)! > 0);
  }
  return plan;
}
