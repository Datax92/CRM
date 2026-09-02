import { initializeApp, getApps, cert, type App } from "firebase-admin/app";
import { getFirestore, initializeFirestore, type Firestore } from "firebase-admin/firestore";
import { getAuth, type Auth } from "firebase-admin/auth";

function getAdminApp(): App {
  const existing = getApps();
  if (existing.length > 0) {
    return existing[0];
  }

  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "leadway-496cd";
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  let privateKey = process.env.FIREBASE_PRIVATE_KEY;

  if (privateKey) {
    privateKey = privateKey.replace(/^["']|["']$/g, '').replace(/\\n/g, '\n');
  }

  if (clientEmail && privateKey) {
    return initializeApp({
      credential: cert({
        projectId,
        clientEmail,
        privateKey,
      }),
    });
  }

  return initializeApp({
    projectId,
  });
}

/**
 * **The Admin SDK talks to Firestore over plain HTTPS, not gRPC.**
 *
 * This is the fix for the single most stubborn bug on this project: Server
 * Actions that hung for tens of seconds — or never returned — while the same
 * user's browser read and wrote the same collections instantly.
 *
 * The two use completely different transports. The browser SDK speaks HTTP
 * long-polling / WebSocket to `firestore.googleapis.com`. The Admin SDK
 * defaults to **gRPC over HTTP/2**, and gRPC is far more fragile in the wild:
 * corporate proxies, some consumer ISPs, VPNs, Windows firewalls and
 * antivirus TLS inspection all routinely mangle or stall HTTP/2 streams while
 * leaving ordinary HTTPS working perfectly. When that happens the SDK does not
 * fail — it retries with backoff, which is exactly the "sometimes it works,
 * sometimes it hangs for 25 seconds" signature that was reported four times.
 *
 * **REST is now the default**, and the reason is stronger than transport
 * fragility: *it is the only way a refused write reports itself*. Measured
 * against the live project on 2026-09-02, with the day's delete quota spent:
 *
 * | transport | a delete Firestore is refusing |
 * |---|---|
 * | gRPC | still retrying after **170 s** — no error, ever |
 * | REST | `429 RESOURCE_EXHAUSTED` in **293 ms** |
 *
 * gRPC treats `RESOURCE_EXHAUSTED` as retryable and backs off forever, so the
 * error never reaches `runAction`, never reaches `isQuotaExhausted`, and the
 * user gets a 25-second timeout that blames the network. Over REST the same
 * condition surfaces immediately as the quota message it actually is. Every
 * "sometimes it works, sometimes it hangs" report on this project has this
 * shape.
 *
 * The only feature that needs gRPC is a **server-side** `onSnapshot`, which
 * this app never uses — every realtime listener lives in the browser
 * (`hooks/use*.ts`).
 *
 * Set `FIREBASE_PREFER_REST=false` to go back to gRPC. The emulator forces
 * gRPC regardless: `FIRESTORE_EMULATOR_HOST` is honoured by the gRPC path but
 * the REST path still demands a real access token, so REST cannot talk to the
 * emulator at all.
 */
const EMULATED = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
const PREFER_REST = !EMULATED && process.env.FIREBASE_PREFER_REST !== "false";

let firestore: Firestore | null = null;

export function getAdminDb(): Firestore {
  if (firestore) return firestore;

  const app = getAdminApp();
  try {
    firestore = initializeFirestore(app, { preferRest: PREFER_REST });
  } catch {
    // Already initialised — this happens on a hot reload, where the module's
    // own `firestore` cache is cleared but the Firebase app survives. The
    // existing instance already carries the settings applied the first time.
    firestore = getFirestore(app);
  }
  return firestore;
}

export function getAdminAuth(): Auth {
  return getAuth(getAdminApp());
}

export const adminDb: Firestore = new Proxy({} as Firestore, {
  get(_target, prop) {
    const db = getAdminDb();
    const val = (db as unknown as Record<string | symbol, unknown>)[prop];
    return typeof val === "function" ? val.bind(db) : val;
  },
});

export const adminAuth: Auth = new Proxy({} as Auth, {
  get(_target, prop) {
    const auth = getAdminAuth();
    const val = (auth as unknown as Record<string | symbol, unknown>)[prop];
    return typeof val === "function" ? val.bind(auth) : val;
  },
});
