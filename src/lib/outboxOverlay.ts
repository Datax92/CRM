/**
 * How queued saves (`lib/outbox`) look on screen before they are sent. Pure and
 * import-free, so it is unit-tested under the raw strip-types loader.
 */

export interface QueuedItem {
  id: string;
  name: string;
  args: unknown[];
  at: number;
}

/** A timestamp shaped like Firestore's, for the screens that show queued items. */
export function pendingStamp(ms: number) {
  const date = new Date(ms);
  return { toDate: () => date, toMillis: () => ms, seconds: Math.floor(ms / 1000), nanoseconds: 0 };
}

/** A lead list as it will be once the queue is sent: statuses moved, passed leads gone. */
export function overlayLeads<T extends { id: string; status?: string }>(rows: T[], items: QueuedItem[]): T[] {
  if (items.length === 0) return rows;
  const status = new Map<string, string>();
  const gone = new Set<string>();
  for (const item of items) {
    const leadId = String(item.args[0] ?? '');
    if (item.name === 'setLeadStatus') status.set(leadId, String(item.args[1]));
    else if (item.name === 'acceptLead') status.set(leadId, 'ACCEPTED');
    else if (item.name === 'passLead') gone.add(leadId);
  }
  if (status.size === 0 && gone.size === 0) return rows;
  return rows
    .filter((row) => !gone.has(row.id))
    .map((row) => (status.has(row.id) ? { ...row, status: status.get(row.id) } : row));
}

/** A lead's entries as they will be once the queue is sent, newest first. */
export function overlayFollowUps<T extends { id: string; occurredAt?: unknown }>(
  leadId: string | null,
  rows: T[],
  items: QueuedItem[]
): T[] {
  if (!leadId || items.length === 0) return rows;
  const mine = items.filter((item) => String(item.args[0]) === leadId);
  if (mine.length === 0) return rows;
  let next = [...rows];
  for (const item of mine) {
    if (item.name === 'addFollowUp') {
      const input = (item.args[1] ?? {}) as Record<string, unknown>;
      const at = Date.parse(String(input.occurredAt ?? '')) || item.at;
      next.push({
        ...input,
        id: `pending-${item.id}`,
        kind: next.length === 0 ? 'REMARK' : 'FOLLOW_UP',
        connect: Number(input.durationSeconds ?? 0) >= 70,
        occurredAt: pendingStamp(at),
        createdAt: pendingStamp(at),
      } as unknown as T);
    } else if (item.name === 'updateFollowUp') {
      const followUpId = String(item.args[1]);
      const patch = (item.args[2] ?? {}) as Record<string, unknown>;
      next = next.map((row) => (row.id === followUpId ? ({ ...row, ...patch } as T) : row));
    }
  }
  const time = (row: T) => {
    const value = row.occurredAt as { toMillis?: () => number } | undefined;
    return value?.toMillis?.() ?? 0;
  };
  return next.sort((a, b) => time(b) - time(a));
}
