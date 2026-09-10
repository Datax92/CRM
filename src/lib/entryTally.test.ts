import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  addTally,
  countByFilter,
  entryTally,
  matchesActivityFilter,
  tallyEntries,
  tallyFor,
  EMPTY_TALLY,
  type CountableEntry,
} from './leadBuckets.ts';

import { karachiDayKey, karachiDayRange, offsetDayKey, withinRange } from './dates.ts';
import { dossierRangeKeys, defaultDossierFilters } from './dossierPeriod.ts';

import { duplicatePhoneMessage, phoneKey } from './dataBank.ts';

/*
 * The activity figures the dossier and Reports both show.
 *
 * The bug these pin down: the dossier answered "Remarks · Today" and
 * "Connected · Today" from the lead's all-time counters, filtering only the
 * lead's last touch to the period. Measured on the live project on
 * 2026-09-09 it read 7 connects on a day 3 were made.
 */

const remark = (over: Partial<CountableEntry> = {}): CountableEntry =>
  ({ leadId: 'L1', uid: 'u1', kind: 'REMARK', connect: false, ...over });
const followUp = (over: Partial<CountableEntry> = {}): CountableEntry =>
  ({ leadId: 'L1', uid: 'u1', kind: 'FOLLOW_UP', connect: false, ...over });

test('a remark is one remark and nothing else', () => {
  assert.deepEqual(entryTally(remark()), {
    remarks: 1, followUps: 0, newConnects: 0, followUpConnects: 0,
  });
});

test('a connected remark is BOTH a remark and a new connect', () => {
  // The owner stated this outright: if the remark connected it belongs in the
  // remark column and in New connects. They are a subset, not a second count.
  assert.deepEqual(entryTally(remark({ connect: true })), {
    remarks: 1, followUps: 0, newConnects: 1, followUpConnects: 0,
  });
});

test('a connected follow-up is both a follow-up and a follow-up connect', () => {
  assert.deepEqual(entryTally(followUp({ connect: true })), {
    remarks: 0, followUps: 1, newConnects: 0, followUpConnects: 1,
  });
});

test('the two connect columns never both count one call', () => {
  for (const entry of [remark({ connect: true }), followUp({ connect: true })]) {
    const tally = entryTally(entry);
    assert.equal(tally.newConnects + tally.followUpConnects, 1);
  }
});

test('an entry written before `kind` existed counts as a follow-up', () => {
  // Which is what all but the first entry on a lead were.
  assert.deepEqual(entryTally({ leadId: 'L1', uid: 'u1', kind: null, connect: true }), {
    remarks: 0, followUps: 1, newConnects: 0, followUpConnects: 1,
  });
});

test('entries fold per person and per lead, and only for the people asked for', () => {
  const entries = [
    remark({ leadId: 'A', connect: true }),
    followUp({ leadId: 'A' }),
    followUp({ leadId: 'B', connect: true }),
    followUp({ leadId: 'C', uid: 'someone-else', connect: true }),
  ];

  const { byUid, byLead } = tallyEntries(entries, new Set(['u1']));

  assert.deepEqual(byUid.get('u1'), {
    remarks: 1, followUps: 2, newConnects: 1, followUpConnects: 1,
  });
  assert.deepEqual(byLead.get('A'), {
    remarks: 1, followUps: 1, newConnects: 1, followUpConnects: 0,
  });
  assert.deepEqual(byLead.get('B'), {
    remarks: 0, followUps: 1, newConnects: 0, followUpConnects: 1,
  });
  // Somebody else's work is not in this dossier at all — not as a zero row.
  assert.equal(byLead.has('C'), false);
  assert.equal(byUid.has('someone-else'), false);
});

test('a lead with entries outside the range is simply absent, never zeroed', () => {
  const { byLead } = tallyEntries([], new Set(['u1']));
  assert.equal(byLead.size, 0);
});

/* -------------------------------------------------------------------------- */
/* The cuts                                                                    */
/* -------------------------------------------------------------------------- */

const lead = { id: 'L1', status: 'CONTACTED', followUpCount: 9, connectCount: 4 };

test('given the period entries, the cuts describe the period and not the record', () => {
  // The lead has 9 entries and 4 connects all-time, and nothing in this period.
  const none = { ...EMPTY_TALLY };
  assert.equal(matchesActivityFilter(lead, 'REMARKED', none), false);
  assert.equal(matchesActivityFilter(lead, 'FOLLOWED_UP', none), false);
  assert.equal(matchesActivityFilter(lead, 'CONNECTED', none), false);

  // This is the regression: the old reading called it connected on the
  // strength of four connects made on other days.
  assert.equal(matchesActivityFilter(lead, 'CONNECTED'), true);
});

test('one connected follow-up in the period lands in exactly the right two cuts', () => {
  const tally = { remarks: 0, followUps: 1, newConnects: 0, followUpConnects: 1 };
  assert.equal(matchesActivityFilter(lead, 'FOLLOWED_UP', tally), true);
  assert.equal(matchesActivityFilter(lead, 'FOLLOWUP_CONNECTS', tally), true);
  assert.equal(matchesActivityFilter(lead, 'CONNECTED', tally), true);
  assert.equal(matchesActivityFilter(lead, 'REMARKED', tally), false);
  assert.equal(matchesActivityFilter(lead, 'NEW_CONNECTS', tally), false);
});

test('a remark and a follow-up on the same lead in one period put it in both', () => {
  // Deliberately unlike the old all-time rule, where a lead moved OUT of
  // Remarks the moment it was followed up. Over one day both things happened.
  const tally = { remarks: 1, followUps: 1, newConnects: 0, followUpConnects: 0 };
  assert.equal(matchesActivityFilter(lead, 'REMARKED', tally), true);
  assert.equal(matchesActivityFilter(lead, 'FOLLOWED_UP', tally), true);
});

test('with no entries to hand, the two connect cuts refuse to guess', () => {
  // `connectCount` says a call was answered at some point, never whether it
  // was the opening one — so there is no honest answer, and false is the one
  // that cannot invent work.
  assert.equal(matchesActivityFilter(lead, 'NEW_CONNECTS'), false);
  assert.equal(matchesActivityFilter(lead, 'FOLLOWUP_CONNECTS'), false);
});

test('the chip counts count leads, and are driven by the same tallies', () => {
  const leads = [
    { id: 'A', status: 'CONTACTED', followUpCount: 3, connectCount: 2 },
    { id: 'B', status: 'CONTACTED', followUpCount: 1, connectCount: 0 },
    { id: 'C', status: 'CONTACTED', followUpCount: 8, connectCount: 5 },
  ];
  const tallies = new Map([
    ['A', { remarks: 0, followUps: 4, newConnects: 0, followUpConnects: 2 }],
    ['B', { remarks: 1, followUps: 0, newConnects: 1, followUpConnects: 0 }],
  ]);

  const counts = countByFilter(leads, undefined, 'admin', tallies);

  // Four follow-ups on one lead is one lead under the chip — the chips count
  // leads and the strip above them counts entries, which is the comparison
  // people were making.
  assert.equal(counts.FOLLOWED_UP, 1);
  assert.equal(counts.REMARKED, 1);
  assert.equal(counts.NEW_CONNECTS, 1);
  assert.equal(counts.FOLLOWUP_CONNECTS, 1);
  assert.equal(counts.CONNECTED, 2);
  // C did work on other days and has five connects on the record. Not today.
  assert.equal(counts.ALL, 3);
});

test('addTally folds without losing a figure', () => {
  const into = { ...EMPTY_TALLY };
  addTally(into, entryTally(remark({ connect: true })));
  addTally(into, entryTally(followUp({ connect: true })));
  addTally(into, entryTally(followUp()));
  assert.deepEqual(into, { remarks: 1, followUps: 2, newConnects: 1, followUpConnects: 1 });
});

/* -------------------------------------------------------------------------- */
/* The calendar                                                                */
/* -------------------------------------------------------------------------- */

test('a picked day is that whole day in Karachi, and no part of the next', () => {
  const range = karachiDayRange('2026-07-07');

  // Midnight Karachi on the 7th is 19:00 UTC on the 6th. An instant just
  // inside it is in; the same wall clock a day later is not.
  assert.equal(withinRange(new Date('2026-07-06T19:00:00.000Z'), range), true);
  assert.equal(withinRange(new Date('2026-07-07T18:59:59.999Z'), range), true);
  assert.equal(withinRange(new Date('2026-07-06T18:59:59.999Z'), range), false);
  // The next midnight belongs to the 8th, not to both days.
  assert.equal(withinRange(new Date('2026-07-07T19:00:00.000Z'), range), false);
});

test('a day that is not a date filters nothing away rather than everything', () => {
  // A picker that has not been used yet must not empty the screen.
  for (const bad of [null, undefined, '', 'yesterday']) {
    const range = karachiDayRange(bad);
    assert.equal(withinRange(new Date('2020-01-01T00:00:00Z'), range), true);
  }
});

/* -------------------------------------------------------------------------- */
/* The duplicate number                                                        */
/* -------------------------------------------------------------------------- */

test('a duplicate names the person who holds the number', () => {
  assert.equal(
    duplicatePhoneMessage('0300 1234567', 'Imran Khan'),
    '0300 1234567 is already in this folder — it belongs to Imran Khan.'
  );
});

test('a handed-over row says so, because it is not on screen to be found', () => {
  assert.match(duplicatePhoneMessage('03001234567', 'Imran Khan', true), /handed to a manager/);
});

test('a nameless row still produces a sentence', () => {
  assert.equal(
    duplicatePhoneMessage(null, ''),
    'That number is already in this folder — it belongs to an unnamed record.'
  );
});

test('the same number written three ways is one duplicate', () => {
  // The check runs on `phoneKey`, so this is what "same number" means to it.
  const key = phoneKey('0300 1234567');
  assert.equal(phoneKey('+92 300 1234567'), key);
  assert.equal(phoneKey('3001234567'), key);
  assert.equal(phoneKey('92-300-1234567'), key);
});

/* -------------------------------------------------------------------------- */
/* Loading is not "nothing"                                                    */
/* -------------------------------------------------------------------------- */

test('while the entries are still loading, an activity cut matches nothing', () => {
  // `null` means "the period's entries are what we want and we do not have
  // them yet". Falling back to the all-time counters here would flash the
  // wrong answer — the very reading being fixed — before settling.
  for (const key of ['REMARKED', 'FOLLOWED_UP', 'NEW_CONNECTS', 'FOLLOWUP_CONNECTS', 'CONNECTED'] as const) {
    assert.equal(matchesActivityFilter(lead, key, null), false);
  }
});

test('`undefined` still means the all-time reading, for callers with no periods', () => {
  assert.equal(matchesActivityFilter(lead, 'FOLLOWED_UP', undefined), true);
  assert.equal(matchesActivityFilter(lead, 'CONNECTED', undefined), true);
});

test('tallyFor keeps the three states apart', () => {
  const map = new Map([['A', { remarks: 2, followUps: 0, newConnects: 0, followUpConnects: 0 }]]);
  assert.equal(tallyFor('A', undefined), undefined);
  assert.equal(tallyFor('A', null), null);
  assert.deepEqual(tallyFor('A', map), { remarks: 2, followUps: 0, newConnects: 0, followUpConnects: 0 });
  // A lead the map does not mention was genuinely untouched in these dates —
  // an empty tally, which is an answer, not an absence.
  assert.deepEqual(tallyFor('B', map), EMPTY_TALLY);
});

/* -------------------------------------------------------------------------- */
/* Day keys and the dossier's date window                                      */
/* -------------------------------------------------------------------------- */

test('stepping a day back and forward is exact across a month boundary', () => {
  assert.equal(offsetDayKey('2026-07-01', -1), '2026-06-30');
  assert.equal(offsetDayKey('2026-06-30', 1), '2026-07-01');
  assert.equal(offsetDayKey('2026-03-01', -1), '2026-02-28');
  assert.equal(offsetDayKey('2026-12-31', 1), '2027-01-01');
});

test('stepping anchors at midday, so no offset can slip a day', () => {
  // The step parses `<day>T12:00+05:00` and adds whole days. Anchoring at
  // midnight would put the arithmetic one hour from a boundary, and any future
  // zone change would start moving days.
  let day = '2026-07-07';
  for (let i = 0; i < 40; i += 1) day = offsetDayKey(day, 1);
  assert.equal(day, '2026-08-16');
  for (let i = 0; i < 40; i += 1) day = offsetDayKey(day, -1);
  assert.equal(day, '2026-07-07');
});

test('a junk day key steps to today rather than to an invalid date', () => {
  assert.match(offsetDayKey('not-a-date', 1), /^\d{4}-\d{2}-\d{2}$/);
});

test('the entry query window for one picked day is that day at both ends', () => {
  // `from` and `to` are the same key, and `loadEntries` matches
  // `dayKey >= from && dayKey <= to` — so exactly one day's entries come back.
  assert.deepEqual(dossierRangeKeys({ period: 'DAY', day: '2026-07-07', cut: 'ALL' }), {
    from: '2026-07-07',
    to: '2026-07-07',
  });
});

test('a picked day with no date falls back to today, never to an empty window', () => {
  const today = karachiDayKey();
  assert.deepEqual(dossierRangeKeys({ period: 'DAY', day: null, cut: 'ALL' }), { from: today, to: today });
  assert.deepEqual(dossierRangeKeys({ period: 'DAY', day: 'garbage', cut: 'ALL' }), { from: today, to: today });
});

test('ALL asks for everything up to today rather than an unbounded query', () => {
  const range = dossierRangeKeys({ period: 'ALL', cut: 'ALL' });
  assert.equal(range.to, karachiDayKey());
  assert.equal(range.from < '2001-01-01', true);
});

test('a dossier opens on today, and reads the clock when it opens', () => {
  // **Not a module-level constant.** One evaluated at import time freezes
  // "today" at whenever the bundle first loaded, so a tab left open overnight
  // opens every dossier on yesterday while the control still says Today.
  const first = defaultDossierFilters();
  assert.equal(first.period, 'DAY');
  assert.equal(first.day, karachiDayKey());
  assert.equal(first.cut, 'ALL');
  // A fresh object each time, so one dossier's edits cannot reach another's.
  assert.notEqual(defaultDossierFilters(), first);
});

test('the day window and the entry window describe the same day', () => {
  // The lead/deal/activity lists filter on a Date range; the entry query
  // filters on a `dayKey` string. They must agree, or the four figures at the
  // top would describe a different day from the list underneath them.
  const filters = { period: 'DAY' as const, day: '2026-07-07', cut: 'ALL' as const };
  const range = karachiDayRange(filters.day);
  const keys = dossierRangeKeys(filters);

  assert.equal(karachiDayKey(range.from as Date), keys.from);
  // `to` is the next midnight and exclusive, so the last instant of the day is
  // in and the first instant of the next is out.
  assert.equal(withinRange(new Date((range.to as Date).getTime() - 1), range), true);
  assert.equal(withinRange(range.to as Date, range), false);
  assert.equal(karachiDayKey(new Date((range.to as Date).getTime() - 1)), keys.to);
});
