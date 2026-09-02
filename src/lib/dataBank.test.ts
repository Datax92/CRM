import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseCsv,
  toSheet,
  phoneKey,
  samePhone,
  fieldKeyFor,
  suggestColumnMap,
  prepareImport,
  chunkRowsByPayload,
  estimateImportCost,
  IMPORT_KEYS_PER_LOOKUP,
  WRITE_BATCH_SIZE,
  type DataBankField,
} from './dataBank.ts';

/* -------------------------------------------------------------------------- */
/* CSV                                                                         */
/* -------------------------------------------------------------------------- */

test('csv: a plain grid', () => {
  assert.deepEqual(parseCsv('a,b\n1,2'), [
    ['a', 'b'],
    ['1', '2'],
  ]);
});

test('csv: a quoted field may contain a comma', () => {
  assert.deepEqual(parseCsv('name,address\nAli,"House 4, Street 7"'), [
    ['name', 'address'],
    ['Ali', 'House 4, Street 7'],
  ]);
});

test('csv: a quoted field may contain a newline', () => {
  assert.deepEqual(parseCsv('name,note\nAli,"line one\nline two"'), [
    ['name', 'note'],
    ['Ali', 'line one\nline two'],
  ]);
});

test('csv: "" inside quotes is one literal quote', () => {
  assert.deepEqual(parseCsv('a\n"say ""hi"""'), [['a'], ['say "hi"']]);
});

test('csv: CRLF is one row break, not two', () => {
  assert.deepEqual(parseCsv('a,b\r\n1,2\r\n'), [
    ['a', 'b'],
    ['1', '2'],
  ]);
});

test("csv: Excel's UTF-8 BOM does not poison the first header", () => {
  // Without stripping it, the first column reads "﻿Member Name" and never
  // matches anything on the mapping screen.
  const [headers] = parseCsv('﻿Member Name,Contact\nAli,0300');
  assert.equal(headers[0], 'Member Name');
});

test('csv: a trailing newline does not add an empty row', () => {
  assert.equal(parseCsv('a\n1\n').length, 2);
});

test('csv: a file with no trailing newline keeps its last row', () => {
  assert.deepEqual(parseCsv('a,b\n1,2')[1], ['1', '2']);
});

test('csv: empty cells survive as empty strings, not dropped columns', () => {
  assert.deepEqual(parseCsv('a,b,c\n1,,3')[1], ['1', '', '3']);
});

/* -------------------------------------------------------------------------- */
/* Sheet shaping                                                               */
/* -------------------------------------------------------------------------- */

test('sheet: a blank header becomes a positional name', () => {
  const { headers } = toSheet(parseCsv('Name,,City\nAli,x,Lahore'));
  assert.deepEqual(headers, ['Name', 'Column 2', 'City']);
});

test('sheet: short rows are padded to the header width', () => {
  const { rows } = toSheet(parseCsv('a,b,c\n1,2'));
  assert.deepEqual(rows[0], ['1', '2', '']);
});

test('sheet: entirely empty rows are dropped', () => {
  // Spreadsheets are full of these and they must not become empty records.
  const { rows } = toSheet(parseCsv('a,b\n1,2\n,\n3,4'));
  assert.equal(rows.length, 2);
});

/* -------------------------------------------------------------------------- */
/* Phone keys                                                                  */
/* -------------------------------------------------------------------------- */

test('phone: the same line written six ways reduces to one key', () => {
  const forms = [
    '0300 1234567',
    '+92 300 1234567',
    '92-300-1234567',
    '(0300) 123-4567',
    '03001234567',
    // Excel eats the leading zero when it treats the column as a number.
    '3001234567',
  ];
  const keys = new Set(forms.map(phoneKey));
  assert.equal(keys.size, 1, `expected one key, got ${[...keys].join(', ')}`);
  assert.equal(phoneKey(forms[0]), '3001234567');
});

test('phone: two different numbers do not collide', () => {
  assert.notEqual(phoneKey('03001234567'), phoneKey('03007654321'));
});

test('phone: junk yields an empty key, and an empty key never matches', () => {
  assert.equal(phoneKey('n/a'), '');
  assert.equal(phoneKey(''), '');
  assert.equal(phoneKey(null), '');
  // Two rows with no number are not duplicates of each other.
  assert.equal(samePhone('', ''), false);
  assert.equal(samePhone('n/a', 'none'), false);
});

test('phone: samePhone matches across formats', () => {
  assert.equal(samePhone('0300 1234567', '+923001234567'), true);
});

/* -------------------------------------------------------------------------- */
/* Field keys                                                                  */
/* -------------------------------------------------------------------------- */

test('field keys are readable and slugged from the label', () => {
  assert.equal(fieldKeyFor('Member Name', []), 'member_name');
  assert.equal(fieldKeyFor('Form #', []), 'form');
});

test('field keys never collide', () => {
  assert.equal(fieldKeyFor('Member Name', ['member_name']), 'member_name_2');
});

test('a label with no usable characters still yields a key', () => {
  assert.equal(fieldKeyFor('###', []), 'field');
});

/* -------------------------------------------------------------------------- */
/* Column mapping                                                              */
/* -------------------------------------------------------------------------- */

const CSC_FIELDS: DataBankField[] = [
  { key: 'member_name', label: 'Member Name' },
  { key: 'contact_number', label: 'Contact Number' },
  { key: 'address', label: 'Address' },
  { key: 'form_number', label: 'Form Number' },
];

test('mapping: exact headers match', () => {
  const map = suggestColumnMap(['Member Name', 'Contact Number'], CSC_FIELDS);
  assert.equal(map['Member Name'], 'member_name');
  assert.equal(map['Contact Number'], 'contact_number');
});

test('mapping: case and punctuation do not matter', () => {
  const map = suggestColumnMap(['member_name', 'ADDRESS'], CSC_FIELDS);
  assert.equal(map['member_name'], 'member_name');
  assert.equal(map['ADDRESS'], 'address');
});

test('mapping: a shortened header still finds its field', () => {
  // The whole point of mapping rather than exact-name matching: next month's
  // export says "Contact No" and the import must not fall over.
  const map = suggestColumnMap(['Contact No'], CSC_FIELDS);
  assert.equal(map['Contact No'], 'contact_number');
});

test('mapping: a genuine truncation matches by prefix', () => {
  const map = suggestColumnMap(['Cont Number', 'Addr'], CSC_FIELDS);
  assert.equal(map['Cont Number'], 'contact_number');
  assert.equal(map['Addr'], 'address');
});

test('mapping: "Name" is not confused with "Number"', () => {
  // Both start with "n"; a sloppy prefix rule would collapse them.
  const map = suggestColumnMap(['Name'], CSC_FIELDS);
  assert.notEqual(map['Name'], 'contact_number');
  assert.notEqual(map['Name'], 'form_number');
});

test('mapping: an unrecognised header maps to nothing rather than guessing wildly', () => {
  const map = suggestColumnMap(['Zodiac Sign'], CSC_FIELDS);
  assert.equal(map['Zodiac Sign'], undefined);
});

test('mapping: one field is never claimed by two headers', () => {
  const map = suggestColumnMap(['Contact Number', 'Contact No'], CSC_FIELDS);
  const claimed = Object.values(map);
  assert.equal(new Set(claimed).size, claimed.length);
});

test('mapping: a saved choice beats a guess', () => {
  // The admin corrected this last time. Never overrule that.
  const map = suggestColumnMap(['Contact Number'], CSC_FIELDS, { 'Contact Number': 'form_number' });
  assert.equal(map['Contact Number'], 'form_number');
});

test('mapping: a saved choice pointing at a deleted field is ignored', () => {
  const map = suggestColumnMap(['Member Name'], CSC_FIELDS, { 'Member Name': 'gone_field' });
  assert.equal(map['Member Name'], 'member_name');
});

/* -------------------------------------------------------------------------- */
/* Preparing an import                                                         */
/* -------------------------------------------------------------------------- */

const ROLES = { name: 'member_name', phone: 'contact_number' };

function sheetOf(csv: string) {
  return toSheet(parseCsv(csv));
}

test('import: a clean sheet maps every row', () => {
  const sheet = sheetOf(
    'Member Name,Contact Number,Address\nAli Raza,03001234567,Lahore\nSara Khan,03007654321,Karachi'
  );
  const map = suggestColumnMap(sheet.headers, CSC_FIELDS);
  const result = prepareImport(sheet, map, CSC_FIELDS, ROLES);

  assert.equal(result.rows.length, 2);
  assert.equal(result.rows[0].name, 'Ali Raza');
  assert.equal(result.rows[0].values.address, 'Lahore');
  assert.equal(result.rows[0].phoneKey, '3001234567');
});

test('import: a row with no name is reported by line number, not silently dropped', () => {
  const sheet = sheetOf('Member Name,Contact Number\n,03001234567\nSara,03007654321');
  const map = suggestColumnMap(sheet.headers, CSC_FIELDS);
  const result = prepareImport(sheet, map, CSC_FIELDS, ROLES);

  assert.equal(result.rows.length, 1);
  // Line 2 of the file: the header is line 1.
  assert.deepEqual(result.missingName, [2]);
});

test('import: a row with an unusable phone is reported', () => {
  const sheet = sheetOf('Member Name,Contact Number\nAli,n/a\nSara,03007654321');
  const map = suggestColumnMap(sheet.headers, CSC_FIELDS);
  const result = prepareImport(sheet, map, CSC_FIELDS, ROLES);

  assert.equal(result.rows.length, 1);
  assert.deepEqual(result.missingPhone, [2]);
});

test('import: the same number twice in one file imports once', () => {
  const sheet = sheetOf(
    'Member Name,Contact Number\nAli,03001234567\nAli Raza,+92 300 1234567\nSara,03007654321'
  );
  const map = suggestColumnMap(sheet.headers, CSC_FIELDS);
  const result = prepareImport(sheet, map, CSC_FIELDS, ROLES);

  assert.equal(result.rows.length, 2);
  assert.deepEqual(result.duplicateInFile, [3]);
});

test('import: an unmapped column is not written into the record', () => {
  const sheet = sheetOf('Member Name,Contact Number,Zodiac\nAli,03001234567,Leo');
  const map = suggestColumnMap(sheet.headers, CSC_FIELDS);
  const result = prepareImport(sheet, map, CSC_FIELDS, ROLES);

  assert.deepEqual(Object.keys(result.rows[0].values).sort(), ['contact_number', 'member_name']);
});

test('import: the reported lines add up to the sheet', () => {
  // Whatever happens, every row of the file is accounted for exactly once —
  // this is what stops an import quietly losing records.
  const sheet = sheetOf(
    'Member Name,Contact Number\nAli,03001234567\n,03009999999\nSara,junk\nAli2,+923001234567\nZara,03005556666'
  );
  const map = suggestColumnMap(sheet.headers, CSC_FIELDS);
  const result = prepareImport(sheet, map, CSC_FIELDS, ROLES);

  const accounted =
    result.rows.length +
    result.missingName.length +
    result.missingPhone.length +
    result.duplicateInFile.length;
  assert.equal(accounted, sheet.rows.length);
});

/* -------------------------------------------------------------------------- */
/* Chunking                                                                    */
/* -------------------------------------------------------------------------- */

/** A row with `columns` short fields, so size is predictable. */
function row(columns: number, valueLength = 10) {
  const values: Record<string, string> = {};
  for (let i = 0; i < columns; i += 1) values[`f${i}`] = 'x'.repeat(valueLength);
  return { values };
}

test('chunking: a narrow sheet fills whole batches', () => {
  const chunks = chunkRowsByPayload(Array.from({ length: 1200 }, () => row(3)));
  assert.deepEqual(chunks.map((c) => c.length), [500, 500, 200]);
});

test('chunking: every row survives, in order, exactly once', () => {
  const rows = Array.from({ length: 977 }, (_, i) => ({ values: { id: String(i) } }));
  const flat = chunkRowsByPayload(rows).flat();
  assert.equal(flat.length, rows.length);
  assert.deepEqual(flat.map((r) => r.values.id), rows.map((r) => r.values.id));
});

test('chunking: a wide sheet closes chunks on size, not on the row cap', () => {
  // 40 columns of 400 characters is roughly 48 KB a row, so a 1 MB ceiling is
  // reached long before 500 rows. This is the shape that used to blow the
  // Server Action body limit mid-import.
  const chunks = chunkRowsByPayload(Array.from({ length: 200 }, () => row(40, 400)));
  assert.ok(chunks.length > 1, 'a wide sheet must split into more than one chunk');
  assert.ok(
    chunks.every((chunk) => chunk.length < WRITE_BATCH_SIZE),
    'chunks should be closed by size well before the 500-row cap'
  );
});

test('chunking: no chunk exceeds the byte ceiling once it holds more than one row', () => {
  const maxBytes = 5_000;
  const chunks = chunkRowsByPayload(
    Array.from({ length: 60 }, () => row(4, 100)),
    WRITE_BATCH_SIZE,
    maxBytes
  );
  for (const chunk of chunks) {
    if (chunk.length === 1) continue;
    assert.ok(
      JSON.stringify(chunk).length <= maxBytes,
      `a ${chunk.length}-row chunk serialised to ${JSON.stringify(chunk).length} bytes`
    );
  }
});

test('chunking: a single oversized row is emitted alone rather than dropped', () => {
  const huge = { values: { blob: 'y'.repeat(50_000) } };
  const chunks = chunkRowsByPayload([row(2), huge, row(2)], WRITE_BATCH_SIZE, 1_000);
  assert.equal(chunks.flat().length, 3, 'nothing may be silently discarded');
  assert.ok(chunks.some((chunk) => chunk.length === 1 && chunk[0] === huge));
});

test('chunking: an empty sheet produces no chunks', () => {
  assert.deepEqual(chunkRowsByPayload([]), []);
});

/* -------------------------------------------------------------------------- */
/* Import cost                                                                 */
/* -------------------------------------------------------------------------- */

test('cost: one row is one write — that floor is the whole point', () => {
  // If this ever drifts, the modal starts under-reporting the only number that
  // decides whether an import fits inside a day.
  for (const rows of [1, 500, 5_000, 40_000]) {
    const { writes } = estimateImportCost(rows);
    assert.ok(writes >= rows, `${rows} rows reported as ${writes} writes`);
  }
});

test('cost: the folder counter adds exactly one write per chunk', () => {
  assert.equal(estimateImportCost(500).writes, 501);
  assert.equal(estimateImportCost(501).writes, 503, 'two chunks, two counter updates');
  assert.equal(estimateImportCost(40_000).writes, 40_000 + 80);
});

test('cost: the duplicate check is a few reads per chunk, not one per row', () => {
  const perChunk = WRITE_BATCH_SIZE / IMPORT_KEYS_PER_LOOKUP;
  const { reads } = estimateImportCost(40_000);
  assert.equal(reads, 80 * Math.ceil(perChunk));
  assert.ok(reads < 40_000 * 0.05, 'reads must stay a rounding error beside the writes');
});

test('cost: a 40k import is cents, not dollars, on Blaze', () => {
  const { usd } = estimateImportCost(40_000);
  assert.ok(usd > 0.05 && usd < 0.1, `expected ~$0.07, got $${usd.toFixed(4)}`);
});

test('cost: nothing to import costs nothing', () => {
  assert.deepEqual(estimateImportCost(0), { writes: 0, reads: 0, usd: 0 });
  assert.deepEqual(estimateImportCost(-5), { writes: 0, reads: 0, usd: 0 });
});
