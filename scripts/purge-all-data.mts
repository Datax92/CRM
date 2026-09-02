/**
 * Wipes the live project's business records so you can start from a clean
 * database.
 *
 * This deletes real data and cannot be undone. It therefore runs a **dry run
 * by default** — it prints exactly what it would remove and touches nothing
 * until you pass `--confirm`.
 *
 *   npm run purge-all-data                          # dry run, everything
 *   npm run purge-all-data -- --confirm             # do it
 *   npm run purge-all-data -- --only=leads,data-bank
 *   npm run purge-all-data -- --skip=employees --confirm
 *
 * ## What it never touches
 *
 * **Administrators.** Every `users/*` document whose role is `admin` — and the
 * Firebase Auth account behind it — is kept, always, with no flag to override.
 * Deleting the account you are signed in with locks you out of the app and out
 * of this script's own project, and re-creating it means going back to
 * `set-admin-role`. If you genuinely want an admin gone, remove that one by
 * hand in the console.
 *
 * **`config/*`.** The office-network allow-list and any other settings live
 * here. They are configuration, not records, and losing them silently turns
 * every attendance day into "Unverified". Pass `--include-config` if you really
 * do want a factory reset.
 *
 * ## What it does to Auth
 *
 * An employee's Firebase Auth account is deleted along with their profile
 * document. An Auth account with no `users/{uid}` document can still sign in
 * and lands in a broken session, so leaving them behind is worse than removing
 * them. `--keep-auth` keeps the sign-ins and removes only the profiles.
 */

import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, type Firestore, type CollectionReference } from 'firebase-admin/firestore';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

/**
 * The groups, in the order they are deleted.
 *
 * Leads go before employees so that if the run dies half way you are left with
 * employees who have no leads, rather than leads assigned to people who no
 * longer exist.
 */
const GROUPS = {
  leads: {
    label: 'Leads, follow-ups, deals, notifications and campaigns',
    // `leads` carries `events` and `followUps` subcollections; recursiveDelete
    // takes them with it.
    collections: ['leads', 'closedDeals', 'notifications', 'campaigns'],
  },
  employees: {
    label: 'Employee profiles, their KPI counters and all attendance',
    // Handled specially — admins are filtered out. `attendance` is listed here
    // because every one of its documents belongs to a person.
    collections: ['attendance'],
  },
  financials: {
    label: 'Expenses and the accounts ledgers',
    collections: [
      'expenses',
      'committee',
      'investments',
      'capitalInvestments',
      'receivables',
      'personalExpenses',
    ],
  },
  'data-bank': {
    label: 'Data Bank folders and every cold record in them',
    collections: ['dataBankFolders', 'dataBankRecords'],
  },
} as const;

type GroupName = keyof typeof GROUPS;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`\nMissing ${name}.`);
    console.error('This script needs Admin SDK credentials — the same three variables');
    console.error('the Server Actions use. Put them in .env.local:\n');
    console.error('  FIREBASE_PROJECT_ID=your-project-id');
    console.error('  FIREBASE_CLIENT_EMAIL=firebase-adminsdk-...@your-project.iam.gserviceaccount.com');
    console.error('  FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\\n...\\n-----END PRIVATE KEY-----\\n"\n');
    console.error('They come from Firebase Console → Project settings → Service accounts →');
    console.error('Generate new private key. NEXT_PUBLIC_* keys cannot delete anything:');
    console.error('Security Rules deny every client write in this project.\n');
    process.exit(1);
  }
  return value;
}

/** `--only=a,b` / `--skip=a,b` — value form only, so a typo cannot mean "all". */
function listFlag(args: string[], name: string): string[] | null {
  const raw = args.find((arg) => arg.startsWith(`${name}=`));
  if (!raw) return null;
  return raw
    .slice(name.length + 1)
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

/** Counts a collection without reading its documents' fields. */
async function countOf(ref: CollectionReference): Promise<number> {
  const snapshot = await ref.count().get();
  return snapshot.data().count;
}

async function main() {
  const args = process.argv.slice(2);
  const confirm = args.includes('--confirm');
  const keepAuth = args.includes('--keep-auth');
  const includeConfig = args.includes('--include-config');

  const only = listFlag(args, '--only');
  const skip = listFlag(args, '--skip') ?? [];

  const unknown = [...(only ?? []), ...skip].filter((name) => !(name in GROUPS));
  if (unknown.length > 0) {
    console.error(`\nUnknown group: ${unknown.join(', ')}`);
    console.error(`Valid groups: ${Object.keys(GROUPS).join(', ')}\n`);
    process.exit(1);
  }

  const groups = (Object.keys(GROUPS) as GroupName[])
    .filter((name) => (only ? only.includes(name) : true))
    .filter((name) => !skip.includes(name));

  if (groups.length === 0) {
    console.error('\nNothing selected — every group was skipped.\n');
    process.exit(1);
  }

  const projectId = requireEnv('FIREBASE_PROJECT_ID');
  const clientEmail = requireEnv('FIREBASE_CLIENT_EMAIL');
  const privateKey = requireEnv('FIREBASE_PRIVATE_KEY')
    .replace(/^["']|["']$/g, '')
    .replace(/\\n/g, '\n');

  if (!getApps().length) {
    initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
  }
  const db = getFirestore();
  const auth = getAuth();

  console.log(`\nProject:  ${projectId}`);
  console.log(`Groups:   ${groups.join(', ')}`);
  console.log(`Mode:     ${confirm ? 'DELETING' : 'dry run — nothing will be touched'}\n`);

  // ---- survey ------------------------------------------------------------
  // Everything is counted first so the confirmation prompt can state real
  // numbers. "Delete 4,182 records?" is a question somebody can answer;
  // "Delete everything?" is not.

  const plan: Array<{ path: string; count: number }> = [];
  const collectionsToWipe: string[] = [];

  for (const group of groups) {
    for (const name of GROUPS[group].collections) {
      const count = await countOf(db.collection(name));
      plan.push({ path: name, count });
      collectionsToWipe.push(name);
    }
  }

  // Employees are picked out individually so administrators survive.
  const employeeDocs: Array<{ uid: string; label: string }> = [];
  const keptAdmins: string[] = [];

  if (groups.includes('employees')) {
    const users = await db.collection('users').get();
    for (const snap of users.docs) {
      const data = snap.data();
      const label = data.email ?? data.name ?? '(no email)';
      if (data.role === 'admin') keptAdmins.push(label);
      else employeeDocs.push({ uid: snap.id, label });
    }
    plan.push({ path: 'users (employees only)', count: employeeDocs.length });
  }

  if (includeConfig) {
    const count = await countOf(db.collection('config'));
    plan.push({ path: 'config', count });
    collectionsToWipe.push('config');
  }

  const width = Math.max(...plan.map((row) => row.path.length));
  for (const row of plan) {
    console.log(`  ${row.path.padEnd(width)}  ${String(row.count).padStart(7)}`);
  }

  const total = plan.reduce((sum, row) => sum + row.count, 0);
  console.log(`  ${'—'.repeat(width)}  ${'—'.repeat(7)}`);
  console.log(`  ${'total'.padEnd(width)}  ${String(total).padStart(7)}\n`);

  if (keptAdmins.length > 0) {
    console.log(`Keeping ${keptAdmins.length} administrator account(s):`);
    for (const label of keptAdmins) console.log(`  · ${label}`);
    console.log('');
  } else if (groups.includes('employees')) {
    // Deleting every employee when no admin exists leaves a database nobody
    // can sign into. That is almost certainly not what was meant.
    console.log('WARNING: no users/* document has role "admin".');
    console.log('Nothing here would be preserved, and after this runs no account can');
    console.log('sign in. Run `npm run set-admin-role -- you@example.com` first.\n');
  }

  if (!includeConfig) {
    console.log('config/* is preserved (office network allow-list and settings).');
    console.log('Pass --include-config to wipe it too.\n');
  }

  if (total === 0) {
    console.log('Nothing to delete.\n');
    return;
  }

  if (!confirm) {
    console.log('Dry run only. Re-run with --confirm to delete.\n');
    return;
  }

  // ---- confirmation ------------------------------------------------------
  // `--confirm` gets you to the prompt, not past it. Typing the project id is
  // the check that this is the project you think it is: the flag is easy to
  // copy out of a README into the wrong terminal.

  const rl = createInterface({ input: stdin, output: stdout });
  const answer = await rl.question(
    `This permanently deletes ${total} document(s) from "${projectId}".\n` +
      `Type the project id to proceed: `
  );
  rl.close();

  if (answer.trim() !== projectId) {
    console.log('\nDoes not match. Nothing was deleted.\n');
    return;
  }

  console.log('');

  // ---- delete ------------------------------------------------------------

  for (const name of collectionsToWipe) {
    process.stdout.write(`  ${name} … `);
    // recursiveDelete walks subcollections too — `leads/*/events` and
    // `leads/*/followUps` would otherwise be left orphaned and unreachable,
    // still billing storage with no parent document to find them from.
    await db.recursiveDelete(db.collection(name));
    console.log('done');
  }

  if (employeeDocs.length > 0) {
    process.stdout.write(`  users (employees) … `);
    for (const employee of employeeDocs) {
      // Per document rather than per collection, so admins are stepped over.
      // This also takes users/{uid}/kpiMonths with it.
      await db.recursiveDelete(db.collection('users').doc(employee.uid));
    }
    console.log('done');

    if (!keepAuth) {
      process.stdout.write(`  auth accounts … `);
      let deleted = 0;
      const failed: string[] = [];
      for (const employee of employeeDocs) {
        try {
          await auth.deleteUser(employee.uid);
          deleted++;
        } catch (error: unknown) {
          // A profile written by a seed script may have no Auth account at
          // all; that is not a failure worth stopping the run for.
          const code = (error as { code?: string }).code;
          if (code !== 'auth/user-not-found') failed.push(employee.label);
        }
      }
      console.log(`${deleted} removed`);
      if (failed.length > 0) {
        console.log(`    could not remove: ${failed.join(', ')}`);
      }
    } else {
      console.log('  auth accounts … kept (--keep-auth)');
    }
  }

  console.log('\nDone.\n');
  console.log('Two things worth doing now:');
  console.log('  1. Sign out and back in — a stale session holds data in memory.');
  console.log('  2. Check Firebase Console → Authentication for any account left');
  console.log('     without a profile document.\n');
}

main().catch((error) => {
  console.error('\nFailed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
