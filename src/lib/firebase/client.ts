import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth, connectAuthEmulator } from "firebase/auth";
import {
  getFirestore,
  initializeFirestore,
  connectFirestoreEmulator,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from "firebase/firestore";
import { getFunctions, connectFunctionsEmulator } from "firebase/functions";
import { getStorage, connectStorageEmulator } from "firebase/storage";
import { firebaseConfig } from "./config";

const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();

const auth = getAuth(app);

/**
 * Firestore with an **on-disk cache**, which is the single biggest saving
 * available on the read quota.
 *
 * Without it every listener starts cold: opening Accounts re-downloads every
 * account and every transaction from the server, and does it again on the next
 * page load, and again in the next tab. With it, the second visit is served
 * from IndexedDB and costs **nothing** — a listener only pays for documents
 * that have actually changed since the cache was written.
 *
 * `persistentMultipleTabManager` shares one cache across tabs, so a second tab
 * is free rather than a second full download. Without it Firestore refuses
 * persistence in the second tab entirely.
 *
 * It has to be `initializeFirestore`, not `getFirestore`: the cache can only be
 * chosen before the instance exists. Wrapped because persistence genuinely
 * fails in some conditions — a private window, a browser with site data
 * blocked, an unsupported engine — and a CRM that will not load at all is far
 * worse than one that pays for its reads.
 */
function firestoreWithCache(): Firestore {
  if (typeof window === "undefined") return getFirestore(app);
  try {
    return initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
  } catch {
    // Already initialised (fast refresh), or persistence unavailable here.
    return getFirestore(app);
  }
}

const db = firestoreWithCache();
const functions = getFunctions(app);
const storage = getStorage(app);

// Use emulators in development if true
const USE_EMULATORS = process.env.NEXT_PUBLIC_USE_EMULATORS === "true";

if (USE_EMULATORS && typeof window !== "undefined") {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
  connectStorageEmulator(storage, "127.0.0.1", 9199);
}

export { app, auth, db, functions, storage };
