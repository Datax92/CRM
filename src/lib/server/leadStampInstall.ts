import { FieldValue, WriteBatch } from "firebase-admin/firestore";
import { isLeadDocPath, stampData, stampSetOptions, stampUpdateData } from "@/lib/leadStamp";
import { noteWrite } from "@/lib/server/serverCache";

/**
 * Installs the `updatedAt` stamp on every firebase-admin write to `leads/{id}`.
 * The rules — and why this is central rather than per call site — are in
 * `lib/leadStamp`.
 *
 * **Why `WriteBatch` covers everything:** in `@google-cloud/firestore`,
 * `DocumentReference.set/update/create` build a `WriteBatch`, `Transaction`
 * forwards to its own `WriteBatch`, and `BulkWriter`'s batches extend it. One
 * prototype, every path. Installed once per process, from `getAdminDb`.
 */

let installed = false;

type RefLike = { path?: string };

/** The paths a batch has queued, dropped from the cache again once it commits. */
const queued = new WeakMap<object, string[]>();

function note(batch: object, ref: RefLike | undefined): void {
  const path = ref?.path;
  if (!path) return;
  noteWrite(path);
  const paths = queued.get(batch) ?? [];
  paths.push(path);
  queued.set(batch, paths);
}

export function installLeadStamp(): void {
  if (installed) return;
  installed = true;

  const proto = WriteBatch.prototype as unknown as {
    create: (ref: RefLike, data: unknown) => unknown;
    delete: (ref: RefLike, precondition?: unknown) => unknown;
    _commit: (...args: unknown[]) => Promise<unknown>;
    set: (ref: RefLike, data: unknown, options?: unknown) => unknown;
    update: (ref: RefLike, dataOrField: unknown, ...rest: unknown[]) => unknown;
  };
  const create = proto.create;
  const set = proto.set;
  const update = proto.update;
  const remove = proto.delete;
  const commit = proto._commit;

  // Dropped again after the write lands: a read between queueing and
  // committing could otherwise cache the old value for the rest of its window.
  // `_commit` is where both `WriteBatch.commit` and a transaction finish.
  if (typeof commit === "function") {
    proto._commit = async function (...args: unknown[]) {
      const result = await commit.apply(this, args);
      for (const path of queued.get(this) ?? []) noteWrite(path);
      queued.delete(this);
      return result;
    };
  }

  // Every write also drops that document from this server's short-lived read
  // cache (`lib/server/serverCache`), so a cached profile or setting is never
  // served after this server itself changed it.
  proto.delete = function (this: object, ref, ...rest: unknown[]) {
    note(this, ref);
    return remove.call(this, ref, ...(rest as [unknown?]));
  };

  proto.create = function (this: object, ref, data) {
    note(this, ref);
    return create.call(this, ref, isLeadDocPath(ref?.path) ? stampData(data, FieldValue.serverTimestamp()) : data);
  };

  proto.set = function (this: object, ref, data, ...rest: unknown[]) {
    note(this, ref);
    if (!isLeadDocPath(ref?.path)) return set.call(this, ref, data, ...(rest as [unknown?]));
    const stamped = stampData(data, FieldValue.serverTimestamp());
    // Keep the arity the caller used: `set(ref, data)` and
    // `set(ref, data, undefined)` are not treated identically everywhere.
    return rest.length > 0
      ? set.call(this, ref, stamped, stampSetOptions(rest[0]))
      : set.call(this, ref, stamped);
  };

  proto.update = function (this: object, ref, dataOrField, ...rest) {
    note(this, ref);
    if (!isLeadDocPath(ref?.path)) return update.call(this, ref, dataOrField, ...rest);
    return update.call(this, ref, stampUpdateData(dataOrField, FieldValue.serverTimestamp()), ...rest);
  };
}
