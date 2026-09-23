import { AsyncLocalStorage } from "node:async_hooks";
import { DocumentReference, Firestore, Query, Transaction } from "firebase-admin/firestore";

/**
 * The server half of the read meter (owner, 2026-09-23): how many Firestore
 * documents each Server Action, cron run and webhook actually read — written to
 * the server log as one `[readmeter]` line, **never to Firestore**, so the
 * meter costs no reads and no writes of its own, and nobody sees it on screen.
 *
 * **Counted where the reads happen, once each.** firebase-admin reads through
 * five entry points and they do not call one another: `Query.get`,
 * `AggregateQuery.get`, `Firestore.getAll` (which `DocumentReference.get` goes
 * through), `Transaction.get` and `Transaction.getAll` (which use their own
 * reader, not the other three). Each is wrapped here to add what it returned:
 * a document is one read, a query is one per document and **one when it
 * returns nothing** (Firestore bills an empty query as a read), a count
 * aggregation is one per 1,000 matched.
 *
 * **Attributed by `AsyncLocalStorage`**, so a read inside `runAction("x")` is
 * charged to `action:x` however deep it happens, and concurrent requests never
 * mix. Reads with no label (module-level work) are pooled under
 * `server:other` and flushed once a minute.
 */

interface Meter {
  label: string;
  reads: number;
  byCollection: Map<string, number>;
}

const store = new AsyncLocalStorage<Meter>();
let installed = false;
let other: Meter | null = null;
let otherTimer: ReturnType<typeof setTimeout> | null = null;

/** `leads/abc/followUps/x` → `leads/*\/followUps`; collection names only. */
function collectionOf(path: string | undefined): string {
  if (!path) return "?";
  const parts = path.split("/");
  const names = parts.filter((_, index) => index % 2 === 0);
  return names.join("/*/") || "?";
}

function add(count: number, collection: string): void {
  if (count <= 0) return;
  const meter = store.getStore() ?? pooled();
  meter.reads += count;
  meter.byCollection.set(collection, (meter.byCollection.get(collection) ?? 0) + count);
}

function pooled(): Meter {
  if (!other) other = { label: "server:other", reads: 0, byCollection: new Map() };
  if (!otherTimer) {
    otherTimer = setTimeout(() => {
      otherTimer = null;
      if (other && other.reads > 0) log(other, 0);
      other = null;
    }, 60_000);
    otherTimer.unref?.();
  }
  return other;
}

function log(meter: Meter, ms: number): void {
  console.info(
    `[readmeter] ${JSON.stringify({
      src: "server",
      label: meter.label,
      reads: meter.reads,
      ms,
      by: Object.fromEntries(meter.byCollection),
      at: new Date().toISOString(),
    })}`
  );
}

/** Runs `body` with its reads charged to `label`, and logs the total when it ends. */
export async function meterReads<T>(label: string, body: () => Promise<T>): Promise<T> {
  if (store.getStore()) return body(); // already inside a metered scope
  const meter: Meter = { label, reads: 0, byCollection: new Map() };
  const startedAt = Date.now();
  try {
    return await store.run(meter, body);
  } finally {
    if (meter.reads > 0) log(meter, Date.now() - startedAt);
  }
}

type AnyFn = (...args: unknown[]) => unknown;

function wrap(proto: Record<string, unknown>, name: string, count: (self: unknown, args: unknown[], result: unknown) => void): void {
  const original = proto[name] as AnyFn | undefined;
  if (typeof original !== "function") return;
  proto[name] = function (this: unknown, ...args: unknown[]) {
    const out = original.apply(this, args);
    if (out && typeof (out as Promise<unknown>).then === "function") {
      (out as Promise<unknown>).then(
        (result) => {
          try {
            count(this, args, result);
          } catch {
            // The meter must never break a read.
          }
        },
        () => {}
      );
    }
    return out;
  };
}

/** Documents a query result billed: its size, or one for an empty result. */
function querySize(result: unknown): number {
  const size = (result as { size?: number })?.size;
  return typeof size === "number" ? Math.max(1, size) : 1;
}

function queryCollection(query: unknown): string {
  const q = query as { _queryOptions?: { collectionId?: string; allDescendants?: boolean; parentPath?: { relativeName?: string } } };
  const id = q?._queryOptions?.collectionId;
  if (!id) return "?";
  return q._queryOptions?.allDescendants ? `**/${id}` : id;
}

export function installReadMeter(db: Firestore): void {
  if (installed) return;
  installed = true;

  wrap(Query.prototype as unknown as Record<string, unknown>, "get", (self, _args, result) =>
    add(querySize(result), queryCollection(self))
  );

  // AggregateQuery is not exported by name; its prototype is reached through a
  // count query built on this instance — building one sends nothing. Billed at
  // one read per 1,000 matched, and one for none.
  try {
    const aggregateProto = Object.getPrototypeOf(db.collection("_readmeter").count());
    wrap(aggregateProto as Record<string, unknown>, "get", (self, _args, result) => {
      const matched = Number((result as { data?: () => { count?: number } })?.data?.().count ?? 0);
      add(Math.max(1, Math.ceil(matched / 1000)), `count:${queryCollection((self as { _query?: unknown })._query)}`);
    });
  } catch {
    // Not reachable in this version: counts are rare here, the meter carries on.
  }

  wrap(Firestore.prototype as unknown as Record<string, unknown>, "getAll", (_self, args) => {
    const refs = args.filter((arg): arg is DocumentReference => arg instanceof DocumentReference);
    for (const ref of refs) add(1, collectionOf(ref.path));
  });

  wrap(Transaction.prototype as unknown as Record<string, unknown>, "get", (_self, args, result) => {
    // A CollectionReference has a `path` too, and is a query: tell them apart
    // by class, or a whole-collection read counts as one document.
    const target = args[0];
    if (target instanceof DocumentReference) add(1, collectionOf(target.path));
    else add(querySize(result), queryCollection(target));
  });

  wrap(Transaction.prototype as unknown as Record<string, unknown>, "getAll", (_self, args) => {
    const refs = args.filter((arg): arg is DocumentReference => arg instanceof DocumentReference);
    for (const ref of refs) add(1, collectionOf(ref.path));
  });
}
