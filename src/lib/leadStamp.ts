/**
 * Every write to a lead carries `updatedAt` — the field "only what changed"
 * syncing is built on (owner, 2026-09-23, the day the free read quota ran out).
 *
 * **Stamped centrally, never by hand.** Leads are written from ~60 places —
 * Server Actions, the cron sweep, both Meta webhooks, the lane — and a delta
 * sync is only as good as its least careful writer: one path that forgot the
 * field would leave every device holding the old version of that lead with
 * nothing to say so. So `lib/server/leadStampInstall` wraps the one class every
 * firebase-admin write goes through, and this module decides what to add. A
 * writer added next month is stamped without knowing this exists.
 *
 * Complete because of two facts checked when it was built: **browsers cannot
 * write `leads`** (the rule is `allow write: if false`), and **the app never
 * deletes a lead** — only the owner's purge script does. A delete would be
 * invisible to a delta query; the periodic full resync (`lib/leadSync`) is
 * what bounds that, and anything a script writes outside this hook.
 *
 * Only the lead document itself — `leads/{id}` — never its `followUps` or
 * `events`, which are separate documents with their own reads.
 *
 * Dependency-free so the raw `--experimental-strip-types` test loader runs it.
 */

export const LEAD_UPDATED_AT = "updatedAt";

/** `leads/{id}` exactly — not a subcollection document under it. */
export function isLeadDocPath(path: string | null | undefined): boolean {
  if (!path) return false;
  const parts = path.split("/");
  return parts.length === 2 && parts[0] === "leads" && parts[1].length > 0;
}

type Data = Record<string, unknown>;

function isPlainData(value: unknown): value is Data {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

/** `create(ref, data)` / `set(ref, data)`: the stamp added unless the writer set one. */
export function stampData(data: unknown, stamp: unknown): unknown {
  if (!isPlainData(data) || LEAD_UPDATED_AT in data) return data;
  return { ...data, [LEAD_UPDATED_AT]: stamp };
}

/**
 * `set(ref, data, options)`. With `mergeFields`, only the listed fields are
 * written, so the stamp is added to the list as well as the data — otherwise
 * it would be silently dropped.
 */
export function stampSetOptions(options: unknown): unknown {
  if (!isPlainData(options)) return options;
  const mergeFields = (options as { mergeFields?: unknown }).mergeFields;
  if (!Array.isArray(mergeFields) || mergeFields.includes(LEAD_UPDATED_AT)) return options;
  return { ...options, mergeFields: [...mergeFields, LEAD_UPDATED_AT] };
}

/**
 * `update(ref, data, precondition?)` is stamped; the field-path form
 * `update(ref, "field", value, …)` is left alone — nothing in this codebase
 * uses it, and appending to its varargs would collide with a trailing
 * precondition.
 */
export function stampUpdateData(dataOrField: unknown, stamp: unknown): unknown {
  return stampData(dataOrField, stamp);
}
