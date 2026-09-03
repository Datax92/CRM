/**
 * Compares `firestore.indexes.json` against what is actually live.
 *
 * The Admin SDK service account can **list** indexes but not create them, so
 * when a deploy is blocked this answers the only question that matters: which
 * ones are missing. Every missing index is a query that will fail at runtime
 * with "The query requires an index", and knowing the list beforehand beats
 * discovering it one broken screen at a time.
 *
 * Comparison is on the ordered field list. Firestore appends `__name__` to
 * every composite index it builds, so that trailing field is ignored — a
 * previous round of this project reported false negatives by comparing it.
 *
 *   node scripts/check-indexes.mjs
 */

import fs from 'node:fs';
import { GoogleAuth } from 'google-auth-library';

function readEnv(path) {
  const env = {};
  if (!fs.existsSync(path)) return env;
  for (const line of fs.readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = /^([A-Z_0-9]+)=(.*)$/.exec(line);
    if (match) env[match[1]] = match[2].replace(/^"|"$/g, '').replace(/\\n/g, '\n');
  }
  return env;
}

const env = { ...readEnv('.env.local'), ...process.env };
const project = env.FIREBASE_PROJECT_ID || env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;

const auth = new GoogleAuth({
  credentials: { client_email: env.FIREBASE_CLIENT_EMAIL, private_key: env.FIREBASE_PRIVATE_KEY },
  scopes: ['https://www.googleapis.com/auth/cloud-platform'],
});
const client = await auth.getClient();
const DB = `projects/${project}/databases/(default)`;

/** `field:ORDER,field:ORDER` — `__name__` dropped, since Firestore always adds it. */
function signature(fields) {
  return fields
    .filter((field) => field.fieldPath !== '__name__')
    .map((field) => `${field.fieldPath}:${field.arrayConfig ?? field.order ?? 'ASCENDING'}`)
    .join(',');
}

const file = JSON.parse(fs.readFileSync('firestore.indexes.json', 'utf8'));
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
    console.error(`Could not list ${group}: ${result.data?.error?.message ?? result.status}`);
    continue;
  }

  live.set(
    group,
    (result.data.indexes ?? []).map((index) => ({
      signature: signature(index.fields ?? []),
      state: index.state,
    }))
  );
}

const missing = [];
const building = [];
let ready = 0;

for (const index of wanted) {
  const want = signature(index.fields);
  const match = (live.get(index.collectionGroup) ?? []).find((entry) => entry.signature === want);

  if (!match) missing.push(index);
  else if (match.state !== 'READY') building.push({ ...index, state: match.state });
  else ready += 1;
}

console.log(`\nProject: ${project}`);
console.log(`${ready} of ${wanted.length} composite indexes are live and READY.`);

if (building.length) {
  console.log(`\n${building.length} still building:`);
  for (const index of building) {
    console.log(`  ~ ${index.collectionGroup}: ${signature(index.fields)} (${index.state})`);
  }
}

if (missing.length) {
  console.log(`\n${missing.length} MISSING — every query needing one of these will fail:`);
  for (const index of missing) {
    console.log(`  ! ${index.collectionGroup}: ${signature(index.fields)}`);
  }
  process.exitCode = 1;
} else {
  console.log('\nNothing missing.');
}

// The single-field overrides are read from the field resource rather than the
// index list — a collection-group scope on a single field is not a composite
// index and never appears above.
for (const override of file.fieldOverrides ?? []) {
  const name = `${DB}/collectionGroups/${override.collectionGroup}/fields/${override.fieldPath}`;
  const result = await client.request({
    method: 'GET',
    url: `https://firestore.googleapis.com/v1/${name}`,
    validateStatus: () => true,
  });

  const scopes = (result.data?.indexConfig?.indexes ?? []).map((index) => index.queryScope);
  const hasGroup = scopes.includes('COLLECTION_GROUP');
  console.log(
    `\nField override ${override.collectionGroup}.${override.fieldPath}: ` +
      (hasGroup ? 'COLLECTION_GROUP present' : 'COLLECTION_GROUP MISSING — collection group queries will fail')
  );
  if (!hasGroup) process.exitCode = 1;
}
