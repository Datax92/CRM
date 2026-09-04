/**
 * Creates every index in `firestore.indexes.json` that is not live yet.
 *
 *   npm run deploy:indexes            # create what is missing
 *   npm run deploy:indexes -- --dry   # list what it would create
 *
 * **Why this exists rather than `firebase deploy --only firestore:indexes`.**
 * The Firebase CLI is not installed on this machine and installing it needs a
 * separate interactive login. The service account in `.env.local` can already
 * talk to the Firestore Admin API, so this asks that API directly — the same
 * thing the CLI does, minus the CLI.
 *
 * Two kinds of thing get created, and they are different API calls:
 *
 *  - **Composite indexes** — `POST …/collectionGroups/{group}/indexes`.
 *  - **Field overrides** — `PATCH …/collectionGroups/{group}/fields/{field}`.
 *    This is the one the console calls *Single field → Add exemption*, and it
 *    is the only way to make a **collection-group** query on a field work:
 *    Firestore's automatic single-field indexes are collection-scoped only, so
 *    `collectionGroup('followUps').where('dayKey', …)` has nothing to run on
 *    until the override exists. That is the index the Team report asks for.
 *
 * Creating an index returns immediately and it builds in the background —
 * minutes on a large collection. `npm run check:indexes` says when it is READY.
 *
 * Safe to re-run: an index that already exists comes back 409 and is counted,
 * not treated as a failure. Nothing is ever deleted.
 */

import fs from 'node:fs';
import { GoogleAuth } from 'google-auth-library';

/* -------------------------------------------------------------------------- */
/* Credentials                                                                 */
/* -------------------------------------------------------------------------- */

function readEnv(path) {
  const env = {};
  if (!fs.existsSync(path)) return env;
  for (const line of fs.readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) env[match[1]] = match[2].replace(/^"|"$/g, '').replace(/\\n/g, '\n');
  }
  return env;
}

const env = { ...readEnv('.env.local'), ...process.env };
const project = env.FIREBASE_PROJECT_ID || env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
const dryRun = process.argv.includes('--dry');

if (!project) {
  console.error('\n  No project id. Set FIREBASE_PROJECT_ID in .env.local.\n');
  process.exit(1);
}
if (!env.FIREBASE_CLIENT_EMAIL || !env.FIREBASE_PRIVATE_KEY) {
  console.error('\n  No service account. Run: npm run set-admin-key\n');
  process.exit(1);
}

const auth = new GoogleAuth({
  credentials: { client_email: env.FIREBASE_CLIENT_EMAIL, private_key: env.FIREBASE_PRIVATE_KEY },
  scopes: ['https://www.googleapis.com/auth/cloud-platform'],
});
const client = await auth.getClient();
const DB = `projects/${project}/databases/(default)`;

const file = JSON.parse(fs.readFileSync('firestore.indexes.json', 'utf8'));

/** `field:ORDER,…` — `__name__` dropped, since Firestore always appends it. */
function signature(fields) {
  return fields
    .filter((field) => field.fieldPath !== '__name__')
    .map((field) => `${field.fieldPath}:${field.arrayConfig ?? field.order ?? 'ASCENDING'}`)
    .join(',');
}

let created = 0;
let existed = 0;
let failed = 0;
/** Set once, so the permission explanation is printed once rather than per index. */
let denied = null;

function report(result, label) {
  if (result.status < 300) {
    created += 1;
    console.log(`  created  ${label}`);
    return;
  }
  if (result.status === 409) {
    existed += 1;
    console.log(`  exists   ${label}`);
    return;
  }

  failed += 1;
  const message = result.data?.error?.message ?? `HTTP ${result.status}`;
  console.log(`  FAILED   ${label}`);
  console.log(`           ${message}`);
  if (result.status === 403 && !denied) denied = message;
}

console.log(`\nProject: ${project}${dryRun ? '  (dry run — nothing will be created)' : ''}\n`);

/* -------------------------------------------------------------------------- */
/* Composite indexes                                                           */
/* -------------------------------------------------------------------------- */

const wanted = file.indexes ?? [];
const groups = [...new Set(wanted.map((index) => index.collectionGroup))];
const live = new Map();

for (const group of groups) {
  const result = await client.request({
    method: 'GET',
    url: `https://firestore.googleapis.com/v1/${DB}/collectionGroups/${group}/indexes`,
    validateStatus: () => true,
  });
  if (result.status !== 200) {
    console.error(`  Could not list indexes for ${group}: ${result.data?.error?.message ?? result.status}`);
    process.exit(1);
  }
  live.set(group, new Set((result.data.indexes ?? []).map((index) => signature(index.fields ?? []))));
}

const missing = wanted.filter(
  (index) => !live.get(index.collectionGroup)?.has(signature(index.fields))
);

console.log(`Composite indexes: ${wanted.length - missing.length} live, ${missing.length} missing`);

for (const index of missing) {
  const label = `${index.collectionGroup}: ${signature(index.fields)}`;
  if (dryRun) {
    console.log(`  would create  ${label}`);
    continue;
  }

  const result = await client.request({
    method: 'POST',
    url: `https://firestore.googleapis.com/v1/${DB}/collectionGroups/${index.collectionGroup}/indexes`,
    data: {
      queryScope: index.queryScope ?? 'COLLECTION',
      fields: index.fields.map((field) => ({
        fieldPath: field.fieldPath,
        ...(field.arrayConfig ? { arrayConfig: field.arrayConfig } : { order: field.order }),
      })),
    },
    validateStatus: () => true,
  });
  report(result, label);
}

/* -------------------------------------------------------------------------- */
/* Field overrides — the "Single field → Add exemption" ones                   */
/* -------------------------------------------------------------------------- */

const overrides = file.fieldOverrides ?? [];
if (overrides.length > 0) console.log(`\nField overrides: ${overrides.length} declared`);

for (const override of overrides) {
  const label = `${override.collectionGroup}.${override.fieldPath} (${override.indexes
    .map((index) => `${index.queryScope ?? 'COLLECTION'}/${index.order}`)
    .join(', ')})`;

  if (dryRun) {
    console.log(`  would set  ${label}`);
    continue;
  }

  // PATCH, not POST: the field document always exists, and this replaces its
  // whole `indexConfig`. Every scope the file declares has to be listed in one
  // call — sending only the collection-group entry would drop the ordinary
  // per-collection indexes the same field still needs.
  const result = await client.request({
    method: 'PATCH',
    url:
      `https://firestore.googleapis.com/v1/${DB}/collectionGroups/${override.collectionGroup}` +
      // `updateMask` is a FieldMask, which serialises in the query string as a
      // plain comma-separated list — not `updateMask.fieldPaths`, which the API
      // rejects outright as an unknown parameter.
      `/fields/${encodeURIComponent(override.fieldPath)}?updateMask=indexConfig`,
    data: {
      indexConfig: {
        indexes: override.indexes.map((index) => ({
          queryScope: index.queryScope ?? 'COLLECTION',
          fields: [
            {
              fieldPath: override.fieldPath,
              ...(index.arrayConfig ? { arrayConfig: index.arrayConfig } : { order: index.order }),
            },
          ],
        })),
      },
    },
    validateStatus: () => true,
  });
  report(result, label);
}

/* -------------------------------------------------------------------------- */

console.log(
  `\n${dryRun ? 'Would create' : 'Created'} ${dryRun ? missing.length + overrides.length : created}` +
    `${dryRun ? '' : `, ${existed} already existed, ${failed} failed`}.`
);

if (denied) {
  console.log(
    '\n  The service account is not allowed to create indexes. Grant it one role:\n' +
      '\n    Google Cloud console → IAM & Admin → IAM → find\n' +
      `    ${env.FIREBASE_CLIENT_EMAIL}\n` +
      '    → Edit → Add another role → "Cloud Datastore Index Admin" → Save.\n' +
      '\n  Then run this again. The role only permits index management.'
  );
  process.exit(1);
}

if (!dryRun && created > 0) {
  console.log('\n  Indexes build in the background — minutes on a large collection.');
  console.log('  Run `npm run check:indexes` to see when they are READY.\n');
}

process.exit(failed > 0 ? 1 : 0);
