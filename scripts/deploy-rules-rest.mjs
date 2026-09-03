/**
 * Deploys Firestore Security Rules and indexes over the REST APIs.
 *
 * **Why this exists.** `npm run deploy:rules` shells out to `firebase-tools`,
 * which is ~460 packages and several hundred megabytes. On a machine where the
 * CLI is not installed — or where there is no room to install it — the same
 * deploy is three HTTPS calls against APIs the project already has a service
 * account for. Nothing here is a substitute for the CLI in general; it does the
 * two things `firestore:rules,firestore:indexes` does and no more.
 *
 * Credentials come from `.env.local` (`FIREBASE_CLIENT_EMAIL` /
 * `FIREBASE_PRIVATE_KEY`) — the same service account the app's Server Actions
 * use. The key is never printed.
 *
 * Usage:
 *   node scripts/deploy-rules-rest.mjs           # dry run: validate only
 *   node scripts/deploy-rules-rest.mjs --confirm # actually release
 */

import fs from 'node:fs';
import { GoogleAuth } from 'google-auth-library';

const CONFIRM = process.argv.includes('--confirm');

/* -------------------------------------------------------------------------- */
/* Credentials                                                                 */
/* -------------------------------------------------------------------------- */

function readEnv(path) {
  const env = {};
  if (!fs.existsSync(path)) return env;

  for (const line of fs.readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = /^([A-Z_0-9]+)=(.*)$/.exec(line);
    if (!match) continue;
    // Strip surrounding quotes and turn the escaped newlines a .env file has to
    // use back into the real ones a PEM key needs.
    env[match[1]] = match[2].replace(/^"|"$/g, '').replace(/\\n/g, '\n');
  }
  return env;
}

const env = { ...readEnv('.env.local'), ...process.env };
const projectId = env.FIREBASE_PROJECT_ID || env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
const clientEmail = env.FIREBASE_CLIENT_EMAIL;
const privateKey = env.FIREBASE_PRIVATE_KEY;

if (!projectId || !clientEmail || !privateKey) {
  console.error('Missing FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY.');
  process.exit(1);
}

const auth = new GoogleAuth({
  credentials: { client_email: clientEmail, private_key: privateKey },
  scopes: ['https://www.googleapis.com/auth/cloud-platform'],
});

const client = await auth.getClient();

/** One request, with the error body kept — an API error here is the whole point. */
async function call(method, url, body) {
  const response = await client.request({
    method,
    url,
    data: body,
    // Errors are the interesting case, so they are returned rather than thrown.
    validateStatus: () => true,
  });
  return { status: response.status, data: response.data };
}

/* -------------------------------------------------------------------------- */
/* Rules                                                                       */
/* -------------------------------------------------------------------------- */

async function deployRules() {
  const source = fs.readFileSync('firestore.rules', 'utf8');

  // Creating a ruleset compiles it. A syntax error fails here, before anything
  // is released — which is why the dry run is worth having: it proves the file
  // is valid without pointing the project at it.
  const created = await call(
    'POST',
    `https://firebaserules.googleapis.com/v1/projects/${projectId}/rulesets`,
    { source: { files: [{ name: 'firestore.rules', content: source }] } }
  );

  if (created.status !== 200) {
    console.error('\nRuleset rejected:');
    console.error(JSON.stringify(created.data, null, 2));
    return { ok: false };
  }

  const rulesetName = created.data.name;
  const issues = created.data.metadata?.services ?? [];
  console.log(`  compiled OK — ruleset ${rulesetName.split('/').pop()} (${issues.join(', ') || 'firestore'})`);

  if (!CONFIRM) {
    console.log('  dry run: NOT released. Re-run with --confirm to point the project at it.');
    return { ok: true, released: false };
  }

  // Releasing is the step that changes what the live project enforces. The
  // release already exists, so this is an update rather than a create.
  const release = `projects/${projectId}/releases/cloud.firestore`;
  const updated = await call(
    'PATCH',
    `https://firebaserules.googleapis.com/v1/${release}`,
    // An UpdateReleaseRequest, not a bare Release: the resource is nested.
    { release: { name: release, rulesetName }, updateMask: 'rulesetName' }
  );

  if (updated.status !== 200) {
    // A project that has never had rules released needs a create instead.
    const createdRelease = await call(
      'POST',
      `https://firebaserules.googleapis.com/v1/projects/${projectId}/releases`,
      { name: release, rulesetName }
    );
    if (createdRelease.status !== 200) {
      console.error('\nRelease failed:');
      console.error(JSON.stringify(updated.data ?? createdRelease.data, null, 2));
      return { ok: false };
    }
  }

  console.log('  released — the live project now enforces this file.');
  return { ok: true, released: true };
}

/* -------------------------------------------------------------------------- */
/* Indexes                                                                     */
/* -------------------------------------------------------------------------- */

const DB = `projects/${projectId}/databases/(default)`;

async function deployIndexes() {
  const file = JSON.parse(fs.readFileSync('firestore.indexes.json', 'utf8'));
  const indexes = file.indexes ?? [];
  const overrides = file.fieldOverrides ?? [];

  console.log(`  ${indexes.length} composite indexes, ${overrides.length} field override(s)`);

  if (!CONFIRM) {
    console.log('  dry run: nothing created.');
    return { created: 0, existing: 0, failed: 0 };
  }

  let created = 0;
  let existing = 0;
  let failed = 0;

  for (const index of indexes) {
    const body = {
      queryScope: index.queryScope ?? 'COLLECTION',
      fields: index.fields.map((field) => {
        if (field.arrayConfig) return { fieldPath: field.fieldPath, arrayConfig: field.arrayConfig };
        return { fieldPath: field.fieldPath, order: field.order ?? 'ASCENDING' };
      }),
    };

    const result = await call(
      'POST',
      `https://firestore.googleapis.com/v1/${DB}/collectionGroups/${index.collectionGroup}/indexes`,
      body
    );

    if (result.status === 200) {
      created += 1;
      console.log(
        `    + ${index.collectionGroup}: ${index.fields.map((f) => f.fieldPath).join(', ')}`
      );
    } else if (result.status === 409) {
      // Already there. Re-running this script has to be safe, so an existing
      // index is a success, not an error.
      existing += 1;
    } else {
      failed += 1;
      console.error(
        `    ! ${index.collectionGroup}: ${index.fields.map((f) => f.fieldPath).join(', ')} — ${
          result.data?.error?.message ?? result.status
        }`
      );
    }
  }

  // Field overrides are a PATCH on the field itself, not a create. This is what
  // gives `followUps.dayKey` its COLLECTION_GROUP scope — Firestore's automatic
  // single-field indexes are collection-scoped only, so the reports' collection
  // group query cannot run without it.
  for (const override of overrides) {
    const name = `${DB}/collectionGroups/${override.collectionGroup}/fields/${override.fieldPath}`;
    const result = await call(
      'PATCH',
      `https://firestore.googleapis.com/v1/${name}?updateMask=indexConfig`,
      {
        name,
        indexConfig: {
          indexes: override.indexes.map((entry) => ({
            queryScope: entry.queryScope ?? 'COLLECTION',
            fields: [
              entry.arrayConfig
                ? { fieldPath: override.fieldPath, arrayConfig: entry.arrayConfig }
                : { fieldPath: override.fieldPath, order: entry.order ?? 'ASCENDING' },
            ],
          })),
        },
      }
    );

    if (result.status === 200) {
      created += 1;
      console.log(`    + field override ${override.collectionGroup}.${override.fieldPath}`);
    } else {
      failed += 1;
      console.error(
        `    ! field override ${override.collectionGroup}.${override.fieldPath} — ${
          result.data?.error?.message ?? result.status
        }`
      );
    }
  }

  return { created, existing, failed };
}

/* -------------------------------------------------------------------------- */

console.log(`\nProject: ${projectId}`);
console.log(`Mode:    ${CONFIRM ? 'DEPLOY' : 'dry run (validate only)'}\n`);

console.log('Rules');
const rules = await deployRules();

console.log('\nIndexes');
const indexes = await deployIndexes();

console.log('\nSummary');
console.log(`  rules:   ${rules.ok ? (rules.released ? 'released' : 'validated') : 'FAILED'}`);
console.log(
  `  indexes: ${indexes.created} created, ${indexes.existing} already present, ${indexes.failed} failed`
);

if (!rules.ok || indexes.failed > 0) process.exit(1);

if (CONFIRM) {
  console.log(
    '\nIndexes build in the background — a query can still fail with "requires an index" for a few minutes.'
  );
}
