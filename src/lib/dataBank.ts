/**
 * The Data Bank — cold lead lists, organised by source.
 *
 * The pipeline (`leads`) holds inbound Meta Ads leads: a small, live working
 * set that five people share. The Data Bank holds the opposite — tens of
 * thousands of cold rows imported from spreadsheets, grouped into folders by
 * where they came from (Capital Smart City, F2F, ASMR), each folder carrying
 * its own field list because every source's sheet has different columns.
 *
 * They are separate collections rather than one, because they are separate
 * things: mixing 20,000 cold rows into `leads` would slow every pipeline query
 * and make "how is the pipeline doing" meaningless.
 *
 * **Every folder defines its own fields, and two of them are load-bearing.**
 * A folder's fields are free-form and named exactly as the source's sheet names
 * them. But one field must be designated the name and one the phone, because
 * without knowing which column holds the number the app cannot dial it, cannot
 * tell you a row is already in the folder, and cannot promote it into a lead —
 * a lead has no meaning without a name and a number.
 *
 * Field **keys are generated and permanent**; only labels are editable. Storing
 * rows against the label would orphan every record the moment somebody fixed a
 * typo in a column name.
 */

/** A column on a folder, named as the source's own sheet names it. */
export interface DataBankField {
  /** Generated, permanent. Records are keyed on this, never on the label. */
  key: string;
  /** What the admin typed — "Member Name", "Form Number". Freely editable. */
  label: string;
}

/** Which of a folder's own fields carry the two meanings the app depends on. */
export interface FieldRoles {
  name: string;
  phone: string;
}

export interface DataBankFolderInput {
  name: string;
  /** Short label for the chip — "CSC", "F2F". Falls back to the name. */
  code?: string | null;
  description?: string | null;
  fields: DataBankField[];
  roles: FieldRoles;
}

export const MAX_FIELDS_PER_FOLDER = 40;

/**
 * The most rows one import will accept.
 *
 * This is a guard against a mis-picked file, not a capability limit — the
 * importer sends the sheet in chunks, so the only thing a large file actually
 * costs is time and a progress bar. It sits high enough that a real export
 * (a 40,000-row society transfer list, say) goes through in one pass, and low
 * enough that dropping a 2 GB log file onto the picker fails with a sentence
 * instead of hanging the tab.
 */
export const MAX_IMPORT_ROWS = 200_000;

/** Firestore's hard cap on a single batched write. */
export const WRITE_BATCH_SIZE = 500;

/**
 * The most JSON one chunk may carry to the Server Action.
 *
 * Row *count* is the wrong unit on its own. A folder may define up to 40
 * fields, and a transfer sheet's address and CNIC columns are long — 500 of
 * those rows is comfortably over Next's default 1 MB Server Action body limit,
 * and the request is rejected with an opaque error partway through an import
 * that has already written half the file. Chunks are therefore capped by
 * *both* row count and estimated payload size, whichever comes first.
 *
 * `next.config.ts` raises the body limit above this, so the margin absorbs the
 * envelope (the token, the folder id, the JSON structure itself).
 */
export const MAX_CHUNK_BYTES = 1_000_000;

/* -------------------------------------------------------------------------- */
/* What an import costs                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Firestore bills per *document*, and one record is one document, so **a
 * 40,000-row import cannot cost fewer than 40,000 writes.** That floor is the
 * single most useful fact about importing here, and it is invisible until a
 * project hits its daily ceiling and every write in the app starts stalling.
 *
 * Everything else in an import is rounding error, which is worth knowing
 * because it is where optimisation effort would otherwise go:
 *
 * - **the duplicate check** batches phone numbers 30 at a time into `in`
 *   queries, and a query that matches nothing still bills one read — so a
 *   500-row chunk costs 17 reads, not 500. For 40,000 rows that is ~1,360
 *   reads: **about 3% of the operation.**
 * - **the folder counter** is one extra write per chunk — 80 for 40,000 rows.
 * - **a duplicate row costs a read, not a write.** Re-importing a sheet that is
 *   already in the folder is nearly free, by design.
 *
 * So the import path is already close to its floor. Cutting the *writes* would
 * mean not storing one document per record, which is a different data model,
 * not a tuning change.
 */
export const IMPORT_KEYS_PER_LOOKUP = 30;

/** Blaze pay-as-you-go, us-central. Cents-level accuracy is the point. */
const USD_PER_WRITE = 0.18 / 100_000;
const USD_PER_READ = 0.06 / 100_000;

export interface ImportCost {
  /** Record documents, plus one folder-counter update per chunk. */
  writes: number;
  /** Duplicate-check lookups, assuming none of the numbers already exist. */
  reads: number;
  /** Cost on the Blaze plan, in US dollars. Zero on the free plan — until the daily ceiling. */
  usd: number;
}

/**
 * What sending `rowCount` rows will actually cost, counted the way Firestore
 * bills it. Used to warn *before* the button is pressed rather than explain
 * afterwards.
 */
export function estimateImportCost(rowCount: number): ImportCost {
  if (rowCount <= 0) return { writes: 0, reads: 0, usd: 0 };

  const chunks = Math.ceil(rowCount / WRITE_BATCH_SIZE);
  const writes = rowCount + chunks;
  const reads = chunks * Math.ceil(Math.min(rowCount, WRITE_BATCH_SIZE) / IMPORT_KEYS_PER_LOOKUP);

  return { writes, reads, usd: writes * USD_PER_WRITE + reads * USD_PER_READ };
}

/** A row as it sits in a folder. */
export interface DataBankRecordInput {
  /** Values keyed by `DataBankField.key`. Unknown keys are dropped. */
  values: Record<string, string>;
  notes?: string | null;
}

export const RECORD_STATUSES = ["NEW", "CONTACTED", "NOT_INTERESTED"] as const;
export type DataBankStatus = (typeof RECORD_STATUSES)[number];

export const RECORD_STATUS_LABELS: Record<DataBankStatus, string> = {
  NEW: "Not called",
  CONTACTED: "Called",
  NOT_INTERESTED: "Not interested",
};

/**
 * Where a promoted row is filed instead of being deleted.
 *
 * Promotion used to end in `batch.delete(record)`. A delete is a separate,
 * scarcer resource from a write — the free plan allows 20,000 a day, and a
 * folder cleanup or a re-import spends them in thousands — and when that
 * allowance is gone Firestore refuses *deletes while still accepting writes*.
 * The whole batch then failed, so the lead was never created either: promotion
 * stopped working entirely because of a quota that had nothing to do with
 * creating leads.
 *
 * Moving the row to this reserved folder id is a write, so promotion now
 * depends only on the resource it actually needs. Every records query is
 * `where("folderId", "==", …)`, so the row leaves its folder exactly as
 * visibly as a deletion did — no new status, no query change, no index.
 * The document itself is deleted straight after, best-effort; if that is
 * refused the row is already gone from the UI and the leftover is swept later.
 */
export const PROMOTED_FOLDER_ID = "__promoted";

/* -------------------------------------------------------------------------- */
/* Field keys                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * A stable key for a new field, derived from the label but made unique.
 *
 * Readable rather than random, so a raw Firestore document is legible when
 * somebody opens it in the console two years from now.
 */
export function fieldKeyFor(label: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 32) || "field";

  if (!used.has(base)) return base;
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${base}_${n}`;
    if (!used.has(candidate)) return candidate;
  }
  return `${base}_${Date.now()}`;
}

/* -------------------------------------------------------------------------- */
/* Phone normalisation                                                         */
/* -------------------------------------------------------------------------- */

/**
 * The dedupe key for a phone number.
 *
 * Spreadsheets write the same Pakistani mobile a dozen ways — `0300 1234567`,
 * `+92 300 1234567`, `92-300-1234567`, and Excel's favourite, `3001234567`
 * with the leading zero eaten by number formatting. All of those are one
 * person, so all of them must reduce to one key.
 *
 * The rule: keep digits only, drop a `92` country prefix, drop a leading `0`,
 * and keep the last 10 digits. Returns `""` for anything with too few digits to
 * be a number — an empty key never matches, so junk rows are never treated as
 * duplicates of each other.
 */
export function phoneKey(raw: string | null | undefined): string {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (digits.length < 7) return "";

  let rest = digits;
  if (rest.startsWith("92") && rest.length >= 12) rest = rest.slice(2);
  if (rest.startsWith("0")) rest = rest.replace(/^0+/, "");

  return rest.slice(-10);
}

/** True when two written numbers are the same line. */
export function samePhone(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = phoneKey(a);
  return left !== "" && left === phoneKey(b);
}

/* -------------------------------------------------------------------------- */
/* CSV                                                                         */
/* -------------------------------------------------------------------------- */

/**
 * A CSV parser, written here rather than pulled in.
 *
 * The npm build of SheetJS is pinned at a version carrying two unpatched
 * advisories, and CSV is a small enough grammar to own outright — quoted
 * fields, embedded commas, embedded newlines, and `""` as an escaped quote.
 * Sixty lines with tests beats a dependency that parses spreadsheets from
 * outside the building.
 *
 * Handles CRLF, a UTF-8 BOM (which Excel writes and which otherwise turns the
 * first header into `﻿Member Name`), and a trailing newline.
 */
export function parseCsv(text: string): string[][] {
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;
  let i = 0;

  const endValue = () => {
    row.push(value);
    value = "";
  };
  const endRow = () => {
    endValue();
    // A blank trailing line is an artefact of the file ending in a newline,
    // not a row of one empty cell.
    if (row.length > 1 || row[0] !== "") rows.push(row);
    row = [];
  };

  while (i < input.length) {
    const char = input[i];

    if (quoted) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          value += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i += 1;
        continue;
      }
      value += char;
      i += 1;
      continue;
    }

    if (char === '"' && value === "") {
      quoted = true;
      i += 1;
      continue;
    }
    if (char === ",") {
      endValue();
      i += 1;
      continue;
    }
    if (char === "\r") {
      // Swallow CRLF as one break.
      if (input[i + 1] === "\n") i += 1;
      endRow();
      i += 1;
      continue;
    }
    if (char === "\n") {
      endRow();
      i += 1;
      continue;
    }

    value += char;
    i += 1;
  }

  // Whatever is left when the file ends without a newline.
  if (value !== "" || row.length > 0) endRow();

  return rows;
}

export interface ParsedSheet {
  headers: string[];
  rows: string[][];
}

/**
 * Splits a parsed grid into headers and body.
 *
 * Blank header cells become `Column 3` and the like rather than an empty
 * string, so the mapping screen has something to point at. Rows that are
 * entirely empty are dropped — spreadsheets are full of them.
 */
export function toSheet(grid: string[][]): ParsedSheet {
  if (grid.length === 0) return { headers: [], rows: [] };

  const headers = grid[0].map((cell, index) => cell.trim() || `Column ${index + 1}`);
  const width = headers.length;

  const rows = grid
    .slice(1)
    .map((row) => {
      const padded = row.slice(0, width);
      while (padded.length < width) padded.push("");
      return padded.map((cell) => cell.trim());
    })
    .filter((row) => row.some((cell) => cell !== ""));

  return { headers, rows };
}

/* -------------------------------------------------------------------------- */
/* Column mapping                                                              */
/* -------------------------------------------------------------------------- */

/** `{ [csv header]: field key }`. Headers with no entry are not imported. */
export type ColumnMap = Record<string, string>;

/** Loose comparison for matching a spreadsheet header to a field label. */
function normalizeHeader(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * The abbreviations spreadsheet columns actually use.
 *
 * Prefix matching alone cannot bridge these: `No` is not the start of
 * `Number` — it is the conventional short form of *numero*, and "number"
 * begins "nu". The same goes for `Addr`, `Amt`, `Qty`. There are only a
 * handful that matter, so they are listed rather than guessed at.
 */
const ABBREVIATIONS: Record<string, string> = {
  no: "number",
  nos: "number",
  num: "number",
  addr: "address",
  amt: "amount",
  qty: "quantity",
  nm: "name",
  ph: "phone",
  tel: "phone",
  mob: "mobile",
};

function tokensOf(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((token) => ABBREVIATIONS[token] ?? token);
}

/**
 * Whether a spreadsheet header plausibly means the same as a field label.
 *
 * Matches **word by word**, after expanding known abbreviations and allowing
 * prefixes. `Contact No` aligns with `Contact Number` because `no` expands to
 * `number`; `Cont Number` aligns because `cont` is a prefix of `contact`.
 * Plain substring comparison catches neither — "contactno" is nowhere inside
 * "contactnumber".
 *
 * Only a suggestion: the admin sees every pairing on the mapping screen and
 * corrects anything this got wrong, so leaning generous costs a click and
 * leaning strict costs a manual mapping of every column.
 */
function looselyMatches(header: string, label: string): boolean {
  const a = tokensOf(header);
  const b = tokensOf(label);
  if (a.length === 0 || b.length === 0) return false;

  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  const aligned = short.every(
    (token, index) => long[index].startsWith(token) || token.startsWith(long[index])
  );
  if (aligned) return true;

  // Containment on the squashed forms, so "Address" finds "Full Address".
  const squashedA = a.join("");
  const squashedB = b.join("");
  return (
    squashedA.length > 2 &&
    squashedB.length > 2 &&
    (squashedA.includes(squashedB) || squashedB.includes(squashedA))
  );
}

/**
 * A first guess at the mapping, which the admin then corrects.
 *
 * Deliberately forgiving: `Contact No` matches `Contact Number`, `member_name`
 * matches `Member Name`. Requiring the admin to make a spreadsheet's headers
 * match a field list exactly is what makes importers unusable — a re-export
 * with one renamed column should not mean editing the file by hand.
 *
 * A saved mapping from a previous import of the same folder wins over any
 * guess, so the second import onward is a single click.
 */
export function suggestColumnMap(
  headers: string[],
  fields: DataBankField[],
  saved?: ColumnMap
): ColumnMap {
  const map: ColumnMap = {};
  const byExact = new Map(fields.map((field) => [normalizeHeader(field.label), field.key]));
  const validKeys = new Set(fields.map((field) => field.key));
  const claimed = new Set<string>();

  for (const header of headers) {
    // A remembered choice is a decision the admin already made. Never overrule
    // it with a guess.
    const remembered = saved?.[header];
    if (remembered && validKeys.has(remembered) && !claimed.has(remembered)) {
      map[header] = remembered;
      claimed.add(remembered);
      continue;
    }

    const key = byExact.get(normalizeHeader(header));
    if (key && !claimed.has(key)) {
      map[header] = key;
      claimed.add(key);
      continue;
    }

    // Fall back to a loose match, so "Contact No" finds "Contact Number".
    const partial = fields.find(
      (field) => !claimed.has(field.key) && looselyMatches(header, field.label)
    );
    if (partial) {
      map[header] = partial.key;
      claimed.add(partial.key);
    }
  }

  return map;
}

/* -------------------------------------------------------------------------- */
/* Building rows                                                               */
/* -------------------------------------------------------------------------- */

export interface PreparedRow {
  values: Record<string, string>;
  name: string;
  phone: string;
  phoneKey: string;
}

export interface PreparedImport {
  rows: PreparedRow[];
  /** Rows dropped for having no name, with the sheet line number. */
  missingName: number[];
  /** Rows dropped for having no usable phone number. */
  missingPhone: number[];
  /** Rows whose number repeats a row earlier in the same file. */
  duplicateInFile: number[];
}

/**
 * Turns a parsed sheet plus a mapping into rows ready to write.
 *
 * Rows without a name or a usable phone are **reported, not silently dropped** —
 * an importer that quietly discards 300 of 1,200 rows and says "imported" is
 * how a calling list ends up mysteriously short.
 */
export function prepareImport(
  sheet: ParsedSheet,
  map: ColumnMap,
  fields: DataBankField[],
  roles: FieldRoles
): PreparedImport {
  const validKeys = new Set(fields.map((field) => field.key));
  const columns = sheet.headers
    .map((header, index) => ({ index, key: map[header] }))
    .filter((column) => column.key && validKeys.has(column.key));

  const rows: PreparedRow[] = [];
  const missingName: number[] = [];
  const missingPhone: number[] = [];
  const duplicateInFile: number[] = [];
  const seen = new Set<string>();

  sheet.rows.forEach((cells, index) => {
    // +2: one for the header row, one because humans count from 1.
    const line = index + 2;
    const values: Record<string, string> = {};
    for (const column of columns) values[column.key] = cells[column.index] ?? "";

    const name = (values[roles.name] ?? "").trim();
    const phone = (values[roles.phone] ?? "").trim();
    const key = phoneKey(phone);

    if (!name) {
      missingName.push(line);
      return;
    }
    if (!key) {
      missingPhone.push(line);
      return;
    }
    if (seen.has(key)) {
      duplicateInFile.push(line);
      return;
    }

    seen.add(key);
    rows.push({ values, name, phone, phoneKey: key });
  });

  return { rows, missingName, missingPhone, duplicateInFile };
}

/* -------------------------------------------------------------------------- */
/* Chunking                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Rough JSON size of one row, in bytes.
 *
 * Deliberately an estimate rather than `JSON.stringify(row).length`: this runs
 * once per row on a sheet that can hold 200,000 of them, and the number only
 * has to be right enough to keep a chunk under a limit it already sits well
 * below. The constant per entry covers the quotes, colon and comma; the ×3 on
 * character count is the worst case for UTF-8, since a name in Urdu script
 * costs three bytes per character where the `.length` of the string counts one.
 */
function estimateRowBytes(values: Record<string, string>): number {
  let bytes = 12; // the row object's own braces and the `values` wrapper
  for (const key in values) {
    bytes += key.length + 6 + (values[key]?.length ?? 0) * 3;
  }
  return bytes;
}

/**
 * Splits rows into chunks small enough to both batch and transmit.
 *
 * Two ceilings, and a chunk closes at whichever it reaches first:
 * `maxRows` (Firestore's 500-write batch cap) and `maxBytes` (the Server
 * Action body limit). A 5-column sheet fills 500-row chunks; a 40-column
 * transfer sheet closes chunks early on size, which is exactly the case that
 * used to fail.
 *
 * A single row larger than `maxBytes` is emitted alone rather than dropped or
 * looped over forever — it will fail on its own, visibly, instead of taking a
 * whole import down with it.
 */
export function chunkRowsByPayload<T extends { values: Record<string, string> }>(
  rows: T[],
  maxRows: number = WRITE_BATCH_SIZE,
  maxBytes: number = MAX_CHUNK_BYTES
): T[][] {
  const chunks: T[][] = [];
  let current: T[] = [];
  let bytes = 0;

  for (const row of rows) {
    const size = estimateRowBytes(row.values);
    if (current.length > 0 && (current.length >= maxRows || bytes + size > maxBytes)) {
      chunks.push(current);
      current = [];
      bytes = 0;
    }
    current.push(row);
    bytes += size;
  }

  if (current.length > 0) chunks.push(current);
  return chunks;
}
