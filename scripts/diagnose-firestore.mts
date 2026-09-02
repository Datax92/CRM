/**
 * Answers one question: **why are this machine's Server Actions slow?**
 *
 *   npm run diagnose
 *
 * The app's browser code and its server code reach Firestore over two
 * completely different connections, and only one of them has ever been the
 * problem on this project:
 *
 * | | transport | used by |
 * |---|---|---|
 * | browser | HTTP long-polling / WebSocket | every `hooks/use*.ts` listener |
 * | server  | **gRPC over HTTP/2** by default | every Server Action |
 *
 * gRPC is the fragile one. Corporate proxies, some consumer ISPs, VPNs,
 * Windows firewalls and antivirus TLS inspection all routinely stall HTTP/2
 * streams while leaving ordinary HTTPS untouched — and the SDK does not fail
 * when that happens, it retries with backoff. The symptom is a Server Action
 * that takes tens of seconds, or never returns, on a machine where the same
 * user's browser reads and writes the same data instantly.
 *
 * This script times both transports doing the same trivial write, then says
 * which to use. It writes and deletes one document in `__diagnostic`.
 */

import { initializeApp, getApps, cert, deleteApp, type App } from "firebase-admin/app";
import { initializeFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";

function env(name: string): string | undefined {
  return process.env[name];
}

function credentials() {
  const projectId = env("FIREBASE_PROJECT_ID") || env("NEXT_PUBLIC_FIREBASE_PROJECT_ID");
  const clientEmail = env("FIREBASE_CLIENT_EMAIL");
  const privateKey = env("FIREBASE_PRIVATE_KEY")
    ?.replace(/^["']|["']$/g, "")
    .replace(/\\n/g, "\n");
  return { projectId, clientEmail, privateKey };
}

function makeApp(name: string): App {
  const { projectId, clientEmail, privateKey } = credentials();
  if (clientEmail && privateKey) {
    return initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) }, name);
  }
  return initializeApp({ projectId }, name);
}

/** Runs `work`, returning either its duration or the error it produced. */
async function time(label: string, work: () => Promise<unknown>) {
  const startedAt = Date.now();
  try {
    await work();
    const ms = Date.now() - startedAt;
    console.log(`  ${label.padEnd(26)} ${String(ms).padStart(6)} ms   ok`);
    return { ms, ok: true as const };
  } catch (error) {
    const ms = Date.now() - startedAt;
    const message = (error instanceof Error ? error.message : String(error)).split("\n")[0];
    console.log(`  ${label.padEnd(26)} ${String(ms).padStart(6)} ms   FAILED — ${message.slice(0, 90)}`);
    return { ms, ok: false as const };
  }
}

async function main() {
  const { projectId, clientEmail, privateKey } = credentials();

  console.log("\nFirestore transport diagnostic");
  console.log(`  project           ${projectId ?? "(not set)"}`);
  console.log(`  admin credentials ${clientEmail && privateKey ? "configured" : "MISSING — see below"}`);
  console.log(`  proxy             ${env("HTTPS_PROXY") || env("https_proxy") || "(none)"}\n`);

  if (!projectId) {
    console.error("FIREBASE_PROJECT_ID / NEXT_PUBLIC_FIREBASE_PROJECT_ID is not set. Nothing to test.\n");
    process.exit(1);
  }
  if (!clientEmail || !privateKey) {
    console.error(
      "FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY are not set in .env.local.\n" +
        "Every Server Action needs them. Firebase Console → Project settings →\n" +
        "Service accounts → Generate new private key.\n"
    );
    process.exit(1);
  }

  // Auth first: it runs before any Firestore call in every action, so if it is
  // the slow part nothing else matters.
  const authApp = makeApp("diag-auth");
  await time("auth (list 1 user)", () => getAuth(authApp).listUsers(1));

  const doc = `__diagnostic/probe-${Date.now()}`;
  const results: Record<string, { ms: number; ok: boolean }> = {};

  for (const [label, preferRest] of [
    ["Firestore over gRPC", false],
    ["Firestore over REST", true],
  ] as const) {
    const app = makeApp(`diag-${preferRest ? "rest" : "grpc"}`);
    const db = initializeFirestore(app, { preferRest });
    results[preferRest ? "rest" : "grpc"] = await time(label, async () => {
      await db.doc(doc).set({ at: new Date().toISOString(), transport: label });
      await db.doc(doc).delete();
    });
    await deleteApp(app);
  }
  await deleteApp(authApp);

  const { grpc, rest } = results;
  console.log("\nVerdict");

  if (!grpc.ok && rest.ok) {
    console.log("  gRPC cannot reach Firestore from this machine; REST can.");
    console.log("  → Add this to .env.local and restart:  FIREBASE_PREFER_REST=true\n");
  } else if (grpc.ok && !rest.ok) {
    console.log("  REST failed and gRPC worked. Leave FIREBASE_PREFER_REST unset.\n");
  } else if (!grpc.ok && !rest.ok) {
    console.log("  Neither transport reached Firestore. This is a network or");
    console.log("  credentials problem, not a transport one — check the errors above.\n");
  } else if (grpc.ms > 3000 && rest.ms * 2 < grpc.ms) {
    console.log(`  gRPC is ${(grpc.ms / rest.ms).toFixed(1)}× slower than REST here.`);
    console.log("  → Add this to .env.local and restart:  FIREBASE_PREFER_REST=true\n");
  } else if (grpc.ms > 3000) {
    console.log("  Both transports are slow, so the bottleneck is the network path");
    console.log("  to Firestore rather than the transport. Consider hosting the app");
    console.log("  closer to the database region.\n");
  } else {
    console.log("  Both transports are healthy. If the app still feels slow, the");
    console.log("  time is going somewhere other than Firestore — watch the");
    console.log("  `[action:…] took Nms` lines in the dev server terminal.\n");
  }
}

main().catch((error) => {
  console.error("\nDiagnostic failed:", error instanceof Error ? error.message : error, "\n");
  process.exit(1);
});
