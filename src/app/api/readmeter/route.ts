import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Where the browser half of the read meter (`lib/firebase/meteredFirestore`)
 * sends its tally: one `[readmeter]` line in the server log per note, and
 * nothing else — **no Firestore read, no Firestore write**, so the meter never
 * costs what it measures. Collected from the Vercel log by
 * `scripts/readmeter-collect.mjs`.
 *
 * It needs no sign-in (a page closing sends its last note with
 * `sendBeacon`, which carries no auth header) and has nothing to protect: the
 * worst anybody can do is add a line to a log. It still refuses notes that are
 * not from the CRM's own pages or are too large to be one.
 */

const MAX_BYTES = 32_000;

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (origin && host && new URL(origin).host !== host) {
    return new NextResponse(null, { status: 403 });
  }

  const text = await request.text();
  if (text.length > MAX_BYTES) return new NextResponse(null, { status: 413 });

  let body: { uid?: unknown; items?: unknown };
  try {
    body = JSON.parse(text);
  } catch {
    return new NextResponse(null, { status: 400 });
  }

  const items: Record<string, number> = {};
  if (body.items && typeof body.items === "object") {
    for (const [key, value] of Object.entries(body.items as Record<string, unknown>)) {
      const reads = Number(value);
      if (typeof key === "string" && key.length <= 300 && Number.isFinite(reads) && reads > 0) items[key] = reads;
    }
  }
  if (Object.keys(items).length === 0) return new NextResponse(null, { status: 204 });

  console.info(
    `[readmeter] ${JSON.stringify({
      src: "client",
      uid: typeof body.uid === "string" ? body.uid.slice(0, 64) : null,
      items,
      at: new Date().toISOString(),
    })}`
  );
  return new NextResponse(null, { status: 204 });
}
