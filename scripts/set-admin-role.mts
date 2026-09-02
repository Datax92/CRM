/**
 * Grants the admin role to a user account.
 *
 * Role lives in a Firebase custom claim, which only the Admin SDK can set —
 * there is deliberately no in-app way to make someone an admin. This script is
 * how the first administrator is created, and how you promote anyone after.
 *
 *   npm run set-admin-role -- someone@example.com
 *   npm run set-admin-role -- someone@example.com --name "Ayesha Khan"
 *   npm run set-admin-role -- someone@example.com --password 'Str0ngPass!'
 *
 * Creates the Firebase Auth user if they do not exist yet (you will be asked
 * for a password), and writes the matching users/{uid} profile document.
 *
 * The user must sign out and back in afterwards for the new claim to appear in
 * their ID token.
 */

import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`\nMissing ${name}.`);
    console.error('Run this with your local env file loaded:');
    console.error('  node --env-file=.env.local --experimental-strip-types scripts/set-admin-role.ts <email>\n');
    process.exit(1);
  }
  return value;
}

async function main() {
  const args = process.argv.slice(2);
  const flagValues = new Set<string>();
  for (const flag of ['--name', '--password']) {
    const i = args.indexOf(flag);
    if (i >= 0 && args[i + 1]) flagValues.add(args[i + 1]);
  }
  const email = args.find((a) => !a.startsWith('--') && !flagValues.has(a))?.trim().toLowerCase();

  if (!email) {
    console.error('Usage: npm run set-admin-role -- <email> [--name "Full Name"] [--password "..."]');
    process.exit(1);
  }

  const nameFlagIndex = args.indexOf('--name');
  const providedName = nameFlagIndex >= 0 ? args[nameFlagIndex + 1] : undefined;

  const passwordFlagIndex = args.indexOf('--password');
  const passwordFlag = passwordFlagIndex >= 0 ? args[passwordFlagIndex + 1]?.trim() : undefined;

  const projectId = requireEnv('FIREBASE_PROJECT_ID');
  const clientEmail = requireEnv('FIREBASE_CLIENT_EMAIL');
  const privateKey = requireEnv('FIREBASE_PRIVATE_KEY').replace(/\\n/g, '\n');

  if (!getApps().length) {
    initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
  }

  const auth = getAuth();
  const db = getFirestore();

  let user;
  try {
    user = await auth.getUserByEmail(email);
    console.log(`Found existing account ${email} (${user.uid}).`);
  } catch {
    console.log(`No account exists for ${email}. Creating one.`);

    // --password lets this run unattended (CI, or someone else driving the
    // terminal). Prompting is still the default, because a password passed as
    // an argument lands in shell history.
    let password = passwordFlag;
    if (!password) {
      const rl = createInterface({ input: stdin, output: stdout });
      password = (await rl.question('Choose a password (min 8 characters): ')).trim();
      rl.close();
    }

    if (password.length < 8) {
      console.error('Password too short. Nothing was changed.');
      process.exit(1);
    }

    user = await auth.createUser({ email, password, displayName: providedName });
    console.log(`Created account ${user.uid}.`);
  }

  await auth.setCustomUserClaims(user.uid, { role: 'admin' });

  const profileRef = db.collection('users').doc(user.uid);
  const existing = await profileRef.get();

  await profileRef.set(
    {
      name: providedName ?? existing.data()?.name ?? user.displayName ?? email.split('@')[0],
      email,
      role: 'admin',
      status: 'ACTIVE',
      ...(existing.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
      roleUpdatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  // Force existing sessions to pick up the new claim.
  await auth.revokeRefreshTokens(user.uid);

  console.log(`\n${email} is now an administrator.`);
  console.log('They must sign out and sign in again for the change to take effect.\n');
}

main().catch((error) => {
  console.error('\nFailed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
