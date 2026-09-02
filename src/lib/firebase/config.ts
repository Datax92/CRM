export const firebaseConfig = {
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  // Keep static Firebase imports harmless while the documented demo mode is active.
  apiKey:
    process.env.NEXT_PUBLIC_FIREBASE_API_KEY ??
    (process.env.NEXT_PUBLIC_DEMO_MODE === "true"
      ? "AIzaSyDemoMode0000000000000000000000000"
      : undefined),
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
};
