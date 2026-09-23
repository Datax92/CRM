import { FieldValue, WriteBatch } from "firebase-admin/firestore";
import { isLeadDocPath, stampData, stampSetOptions, stampUpdateData } from "@/lib/leadStamp";

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

export function installLeadStamp(): void {
  if (installed) return;
  installed = true;

  const proto = WriteBatch.prototype as unknown as {
    create: (ref: RefLike, data: unknown) => unknown;
    set: (ref: RefLike, data: unknown, options?: unknown) => unknown;
    update: (ref: RefLike, dataOrField: unknown, ...rest: unknown[]) => unknown;
  };
  const create = proto.create;
  const set = proto.set;
  const update = proto.update;

  proto.create = function (ref, data) {
    return create.call(this, ref, isLeadDocPath(ref?.path) ? stampData(data, FieldValue.serverTimestamp()) : data);
  };

  proto.set = function (ref, data, ...rest: unknown[]) {
    if (!isLeadDocPath(ref?.path)) return set.call(this, ref, data, ...(rest as [unknown?]));
    const stamped = stampData(data, FieldValue.serverTimestamp());
    // Keep the arity the caller used: `set(ref, data)` and
    // `set(ref, data, undefined)` are not treated identically everywhere.
    return rest.length > 0
      ? set.call(this, ref, stamped, stampSetOptions(rest[0]))
      : set.call(this, ref, stamped);
  };

  proto.update = function (ref, dataOrField, ...rest) {
    if (!isLeadDocPath(ref?.path)) return update.call(this, ref, dataOrField, ...rest);
    return update.call(this, ref, stampUpdateData(dataOrField, FieldValue.serverTimestamp()), ...rest);
  };
}
