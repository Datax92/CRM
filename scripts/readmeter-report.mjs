/**
 * Turns `.readmeter/log.jsonl` into the table that answers "where do the reads
 * go": reads per hour (Karachi), and the biggest sources — server actions and
 * cron by label, browser reads by page and collection — plus who.
 *
 *   node scripts/readmeter-report.mjs                 # everything collected
 *   node scripts/readmeter-report.mjs 2026-09-24      # one Karachi day
 *
 * Reads nothing from Firestore.
 */

import { readFileSync } from 'node:fs';

const day = process.argv[2] ?? null;
const lines = readFileSync(new URL('../.readmeter/log.jsonl', import.meta.url), 'utf8').split('\n').filter(Boolean);

const karachi = (iso) => new Date(new Date(iso).getTime() + 5 * 3600_000).toISOString();
const byHour = new Map();
const bySource = new Map();
const byUser = new Map();
let total = 0;
let initial = 0;

for (const line of lines) {
  const record = JSON.parse(line);
  const local = karachi(record.at);
  if (day && !local.startsWith(day)) continue;
  const hour = local.slice(0, 13).replace('T', ' ') + ':00';

  const entries =
    record.src === 'server'
      ? Object.entries(record.by ?? {}).map(([collection, reads]) => [`server ${record.label} · ${collection}`, reads, 'server'])
      : Object.entries(record.items ?? {}).map(([key, reads]) => {
          const [page, collection, kind] = key.split('|');
          if (kind === 'initial') initial += reads;
          return [`browser ${page} · ${collection} (${kind})`, reads, record.uid ?? 'unknown'];
        });

  for (const [source, reads, who] of entries) {
    total += reads;
    byHour.set(hour, (byHour.get(hour) ?? 0) + reads);
    bySource.set(source, (bySource.get(source) ?? 0) + reads);
    byUser.set(who, (byUser.get(who) ?? 0) + reads);
  }
}

const table = (map, limit) =>
  [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([k, v]) => `${String(v).padStart(8)}  ${k}`).join('\n');

console.log(`Total reads counted${day ? ` on ${day}` : ''}: ${total.toLocaleString()}` +
  ` (browser "initial" answers ${initial.toLocaleString()} — an over-count when a listen resumed within 30 min)\n`);
console.log('By hour (Karachi):');
console.log([...byHour.entries()].sort().map(([h, v]) => `${h}  ${String(v).padStart(7)}  ${'█'.repeat(Math.min(60, Math.round(v / 200)))}`).join('\n'));
console.log('\nBiggest sources:');
console.log(table(bySource, 25));
console.log('\nBy person (uid) / server:');
console.log(table(byUser, 15));
