/**
 * Saves the read meter's `[readmeter]` lines from the Vercel log before Vercel
 * drops them (the Hobby plan keeps about an hour). Runs until stopped, every
 * `--every` minutes (default 20), appending new lines to
 * `.readmeter/log.jsonl` (gitignored). Needs the Vercel CLI signed in.
 *
 *   node scripts/readmeter-collect.mjs            # loop
 *   node scripts/readmeter-collect.mjs --once     # one pull, then exit
 *
 * Reads nothing from Firestore. Summarise with `scripts/readmeter-report.mjs`.
 */

import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const OUT_DIR = new URL('../.readmeter/', import.meta.url);
const OUT = new URL('log.jsonl', OUT_DIR);
const once = process.argv.includes('--once');
const everyArg = process.argv.indexOf('--every');
const EVERY_MIN = everyArg > -1 ? Number(process.argv[everyArg + 1]) : 20;

if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

const seen = new Set();
if (existsSync(OUT)) {
  for (const line of readFileSync(OUT, 'utf8').split('\n')) if (line) seen.add(hash(line));
}

function hash(text) {
  return createHash('sha1').update(text).digest('hex');
}

function pull() {
  let raw = '';
  try {
    raw = execFileSync(
      process.platform === 'win32' ? 'vercel.cmd' : 'vercel',
      ['logs', '--project', 'crm', '--scope', 'datax-s-projects', '--environment', 'production', '--no-branch',
        '--since', `${EVERY_MIN + 15}m`, '-n', '5000', '-q', 'readmeter', '--expand', '--json', '--non-interactive'],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'], shell: process.platform === 'win32' }
    );
  } catch (error) {
    console.error(`[collect] vercel logs failed: ${error.message.split('\n')[0]}`);
    return;
  }
  let added = 0;
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const text = String(entry.message ?? '');
    for (const match of text.matchAll(/\[readmeter\] (\{.*?\})(?=\s*(\[readmeter\]|$))/gs)) {
      let record;
      try {
        record = JSON.parse(match[1]);
      } catch {
        continue;
      }
      const out = JSON.stringify(record);
      const key = hash(out);
      if (seen.has(key)) continue;
      seen.add(key);
      appendFileSync(OUT, `${out}\n`);
      added++;
    }
  }
  console.log(`[collect] ${new Date().toISOString()} +${added} lines (${seen.size} total)`);
}

pull();
if (!once) setInterval(pull, EVERY_MIN * 60_000);
