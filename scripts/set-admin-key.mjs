/**
 * Installs a Firebase service-account key into `.env.local`, then proves it works.
 *
 *   npm run set-admin-key                 # finds the newest key in Downloads
 *   npm run set-admin-key -- <path.json>  # or name the file
 *
 * **Why this is a script and not an instruction.** The three values are copied
 * out of a JSON file by hand, and one of them — `private_key` — is a
 * multi-line PEM that a `.env` file cannot hold literally. It has to be one
 * line, double-quoted, with its newlines left as the two characters `\n`. That
 * is the step that goes wrong, it goes wrong silently, and the failure it
 * produces ("Failed to parse private key") looks nothing like its cause.
 * `JSON.stringify` produces exactly the right form, so doing it here removes
 * the class of mistake rather than documenting it.
 *
 * Safe to re-run: it rewrites the three lines in place and leaves every other
 * line of `.env.local` untouched. The key is never printed.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const ENV_PATH = '.env.local';
const KEYS = ['FIREBASE_PROJECT_ID', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY'];

function die(message, hint) {
  console.error(`\n  ✖ ${message}`);
  if (hint) console.error(`    ${hint}`);
  console.error('');
  process.exit(1);
}

/* -------------------------------------------------------------------------- */
/* Find the key file                                                           */
/* -------------------------------------------------------------------------- */

/**
 * The console names the download `<project>-firebase-adminsdk-<hash>.json`, so
 * the newest match in Downloads is almost always the one just generated.
 * Guessing is fine here because the file is validated before anything is
 * written — a wrong guess is refused, not installed.
 */
function findDownloadedKey() {
  const downloads = join(homedir(), 'Downloads');
  if (!existsSync(downloads)) return null;

  const candidates = readdirSync(downloads)
    .filter((name) => name.endsWith('.json') && /firebase[-_]?adminsdk|serviceaccount/i.test(name))
    .map((name) => {
      const path = join(downloads, name);
      return { path, at: statSync(path).mtimeMs };
    })
    .sort((a, b) => b.at - a.at);

  return candidates[0]?.path ?? null;
}

const given = process.argv[2];
const keyPath = given ?? findDownloadedKey();

if (!keyPath) {
  die(
    'No service-account key found.',
    'Download one from Firebase console → Project settings → Service accounts →\n' +
      '    Generate new private key, then re-run this. Or pass the path:\n' +
      '    npm run set-admin-key -- "C:\\path\\to\\key.json"'
  );
}
if (!existsSync(keyPath)) die(`No such file: ${keyPath}`);

/* -------------------------------------------------------------------------- */
/* Validate it                                                                 */
/* -------------------------------------------------------------------------- */

let key;
try {
  key = JSON.parse(readFileSync(keyPath, 'utf8'));
} catch {
  die(`${keyPath} is not valid JSON.`, 'Make sure it is the key file itself, not a zip or a folder.');
}

if (key.type !== 'service_account') {
  die(
    'That JSON is not a service-account key.',
    'A service-account key has "type": "service_account". The file you want is the\n' +
      '    one Firebase downloads from Service accounts → Generate new private key.'
  );
}
for (const field of ['project_id', 'client_email', 'private_key']) {
  if (!key[field]) die(`The key file has no "${field}".`);
}
if (!/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(key.private_key)) {
  die('The "private_key" field does not look like a PEM key.');
}

/* -------------------------------------------------------------------------- */
/* Check it is the right project                                               */
/* -------------------------------------------------------------------------- */

if (!existsSync(ENV_PATH)) die(`No ${ENV_PATH} in this directory.`, 'Run this from the repo root.');

const original = readFileSync(ENV_PATH, 'utf8');
const webProject = original.match(/^NEXT_PUBLIC_FIREBASE_PROJECT_ID=(.*)$/m)?.[1].trim();

if (webProject && webProject !== key.project_id) {
  die(
    `That key is for "${key.project_id}", but this app talks to "${webProject}".`,
    'The browser and the server must be on the same project, or the server would\n' +
      '    read a different database from the one on screen. Generate the key from\n' +
      `    the ${webProject} project.`
  );
}

/* -------------------------------------------------------------------------- */
/* Write the three lines                                                       */
/* -------------------------------------------------------------------------- */

// The file's own line endings, so a CRLF file does not become mixed.
const eol = original.includes('\r\n') ? '\r\n' : '\n';

const values = {
  FIREBASE_PROJECT_ID: key.project_id,
  FIREBASE_CLIENT_EMAIL: key.client_email,
  // `JSON.stringify` gives the whole PEM on one line, wrapped in double quotes,
  // with every newline as a literal backslash-n — which is exactly what
  // `getAdminApp()` unescapes. This is the whole reason for the script.
  FIREBASE_PRIVATE_KEY: JSON.stringify(key.private_key),
};

let next = original;
const added = [];

for (const name of KEYS) {
  // Only a real assignment at the start of a line — never a commented example.
  const line = new RegExp(`^${name}=.*$`, 'm');
  const replacement = `${name}=${values[name]}`;

  if (line.test(next)) next = next.replace(line, replacement);
  else added.push(replacement);
}

if (added.length > 0) {
  next = `${next.replace(/\s*$/, '')}${eol}${eol}${added.join(eol)}${eol}`;
}

// A timestamped copy, because this rewrites the file holding every other
// setting too and a bad run should cost nothing.
const backup = `${ENV_PATH}.backup-${new Date().toISOString().replace(/[:.]/g, '-')}`;
writeFileSync(backup, original, 'utf8');
writeFileSync(ENV_PATH, next, 'utf8');

console.log(`\n  Read   ${keyPath}`);
console.log(`  Backup ${backup}`);
console.log(`\n  Wrote into ${ENV_PATH}:`);
console.log(`    FIREBASE_PROJECT_ID   = ${key.project_id}`);
console.log(`    FIREBASE_CLIENT_EMAIL = ${key.client_email}`);
console.log(`    FIREBASE_PRIVATE_KEY  = (${key.private_key.length} characters, not shown)`);

/* -------------------------------------------------------------------------- */
/* Prove it works                                                              */
/* -------------------------------------------------------------------------- */

console.log('\n  Checking it against the live project…');

const { initializeApp, cert } = await import('firebase-admin/app');
const { initializeFirestore } = await import('firebase-admin/firestore');

const started = Date.now();
try {
  // `cert()` parses the PEM and throws **synchronously** on a malformed one,
  // so it belongs inside the same guard as the read — outside it, the one
  // failure this script exists to prevent would print a raw stack trace.
  const app = initializeApp({
    credential: cert({
      projectId: key.project_id,
      clientEmail: key.client_email,
      privateKey: key.private_key,
    }),
    projectId: key.project_id,
  });

  // REST, matching the app — see the note in `lib/firebase/server.ts`.
  const db = initializeFirestore(app, { preferRest: true });

  const snap = await db.collection('users').limit(1).get();
  console.log(`  ✔ Firestore answered in ${Date.now() - started}ms (${snap.size} document read).`);
  console.log('\n  Now restart the dev server — .env.local is only read at startup.');
  console.log('  The [firebase-admin] warning should stop appearing.\n');
  console.log(`  Then delete the key file: ${keyPath}`);
  console.log('  It is full access to your database and cannot be changed, only revoked.\n');
  process.exit(0);
} catch (error) {
  console.error(`\n  ✖ The key was written but Firestore refused it after ${Date.now() - started}ms.`);
  console.error(`    ${error.message}\n`);

  if (/invalid_grant/i.test(error.message)) {
    console.error("    invalid_grant usually means this machine's clock is wrong, or the key");
    console.error('    has been revoked in the console. Check the time, then try a new key.');
  } else if (/parse|DECODER|PEM|invalid-credential/i.test(`${error.message} ${error.code ?? ''}`)) {
    console.error('    "Failed to parse private key" means the PEM itself is malformed — the');
    console.error('    file was edited, truncated, or is not the original download. Generate a');
    console.error('    fresh key and run this again without opening the JSON.');
  } else if (/permission|PERMISSION_DENIED/i.test(error.message)) {
    console.error('    The service account exists but lacks Firestore access. In Google Cloud');
    console.error('    IAM, give it "Cloud Datastore User" — or generate the key from the');
    console.error('    Firebase console, which grants it automatically.');
  }
  console.error(`\n    Your previous .env.local is at ${backup}\n`);
  process.exit(1);
}
