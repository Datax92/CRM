/**
 * Diagnoses sign-in problems.
 *
 * Uses only the public web config, so it works before the Admin SDK service
 * account is set up — which is exactly the point in setup where sign-in tends
 * to fail for reasons that are hard to tell apart from the login screen.
 *
 *   npm run check-auth -- admin@crm.com 'Admin@123456'
 *
 * Reports the exact Firebase error code, what it means, and — if sign-in
 * succeeds — whether the account actually carries a role claim, which is the
 * difference between "signed in" and "can use the CRM".
 */

import { initializeApp, getApps } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';

const EXPLANATIONS: Record<string, string> = {
  'auth/configuration-not-found':
    'Email/Password sign-in is NOT enabled on this Firebase project.\n' +
    '   Fix: Firebase console -> Authentication -> Sign-in method -> enable "Email/Password".',
  'auth/operation-not-allowed':
    'Email/Password sign-in is disabled on this Firebase project.\n' +
    '   Fix: Firebase console -> Authentication -> Sign-in method -> enable "Email/Password".',
  'auth/invalid-credential':
    'No account with that email, or the password is wrong.\n' +
    '   Firebase deliberately does not say which. Check Authentication -> Users for the address.\n' +
    '   If the account does not exist: npm run set-admin-role -- <email>',
  'auth/user-not-found':
    'No account with that email.\n' +
    '   Fix: npm run set-admin-role -- <email>',
  'auth/wrong-password': 'That password is wrong for this account.',
  'auth/user-disabled': 'This account exists but has been disabled in Firebase Auth.',
  'auth/invalid-email': 'That is not a valid email address.',
  'auth/too-many-requests':
    'Firebase has temporarily blocked sign-in attempts from this machine.\n' +
    '   Wait a few minutes, or reset the password from the console.',
  'auth/network-request-failed': 'Could not reach Firebase. Check your internet connection.',
  'auth/api-key-not-valid': 'NEXT_PUBLIC_FIREBASE_API_KEY is wrong or missing.',
  'auth/invalid-api-key': 'NEXT_PUBLIC_FIREBASE_API_KEY is wrong or missing.',
};

async function main() {
  const [email, password] = process.argv.slice(2);

  if (!email || !password) {
    console.error("\nUsage: npm run check-auth -- <email> '<password>'\n");
    process.exit(1);
  }

  const config = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  };

  const missing = Object.entries(config)
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (missing.length > 0) {
    console.error(`\nMissing web config: ${missing.join(', ')}`);
    console.error('Check .env.local against .env.example.\n');
    process.exit(1);
  }

  console.log(`\nProject:  ${config.projectId}`);
  console.log(`Account:  ${email}`);
  console.log('Signing in...\n');

  if (!getApps().length) initializeApp(config);
  const auth = getAuth();

  try {
    const credential = await signInWithEmailAndPassword(auth, email, password);
    const token = await credential.user.getIdTokenResult(true);
    const role = token.claims.role;

    console.log('SIGN-IN OK');
    console.log(`  uid:   ${credential.user.uid}`);
    console.log(`  role:  ${role ?? '(none)'}\n`);

    if (role === 'admin' || role === 'employee') {
      console.log(`This account can use the CRM as ${role}.\n`);
    } else {
      console.log('But this account has NO role claim, so the app will reject it');
      console.log('with "This account has no role assigned yet."\n');
      console.log(`  Fix: npm run set-admin-role -- ${email}`);
      console.log('  (needs FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY in .env.local)\n');
    }
  } catch (error: unknown) {
    const code = (error as { code?: string })?.code ?? 'unknown';
    console.log('SIGN-IN FAILED');
    console.log(`  code: ${code}\n`);
    console.log(EXPLANATIONS[code] ?? `Unrecognised error.\n   ${String(error)}`);
    console.log('');
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('\nUnexpected failure:', error);
  process.exit(1);
});
