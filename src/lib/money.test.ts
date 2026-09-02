import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMoney } from './money.ts';
import { toE164Digits, whatsAppUrl, formatPhone } from './phone.ts';

// --- money -------------------------------------------------------------------

test('parseMoney accepts numeric strings from form inputs', () => {
  assert.equal(parseMoney('8500'), 8500);
  assert.equal(parseMoney(8500), 8500);
});

test('parseMoney rounds to two decimal places', () => {
  assert.equal(parseMoney('1000.456'), 1000.46);
});

test('parseMoney rejects anything that is not a number', () => {
  assert.throws(() => parseMoney('abc'), /valid amount/);
  assert.throws(() => parseMoney(''), /valid amount/);
  assert.throws(() => parseMoney(undefined), /valid amount/);
  assert.throws(() => parseMoney(Number.NaN), /valid amount/);
});

test('parseMoney rejects negative amounts', () => {
  assert.throws(() => parseMoney(-1), /negative/);
});

test('parseMoney rejects implausible amounts that would poison the rollups', () => {
  assert.throws(() => parseMoney(1e15), /looks wrong/);
});

test('gross profit is a plain subtraction (BR-19)', () => {
  const received = parseMoney(850000);
  const payable = parseMoney(500000);
  assert.equal(received - payable, 350000);
});

test('a deal can break even or run at a loss', () => {
  assert.equal(parseMoney(5000) - parseMoney(5000), 0);
  assert.equal(parseMoney(4000) - parseMoney(5000), -1000);
});

// --- phone numbers -----------------------------------------------------------

test('a local Pakistani number gains its country code', () => {
  assert.equal(toE164Digits('0300-1234567'), '923001234567');
  assert.equal(toE164Digits('0300 1234567'), '923001234567');
  assert.equal(toE164Digits('03001234567'), '923001234567');
});

test('a number already in international form is left alone', () => {
  assert.equal(toE164Digits('+92 300 1234567'), '923001234567');
  assert.equal(toE164Digits('923001234567'), '923001234567');
});

test('a bare ten-digit local number is treated as Pakistani', () => {
  assert.equal(toE164Digits('3001234567'), '923001234567');
});

test('a landline with an area code normalises correctly', () => {
  assert.equal(toE164Digits('042-35678901'), '924235678901');
});

test('unusable input yields null rather than a broken link', () => {
  assert.equal(toE164Digits(''), null);
  assert.equal(toE164Digits(null), null);
  assert.equal(toE164Digits('not a phone'), null);
});

test('whatsAppUrl produces a routable wa.me link from a local number', () => {
  // The naive strip-non-digits approach produced wa.me/03001234567, which
  // WhatsApp cannot route.
  assert.equal(whatsAppUrl('0300-1234567'), 'https://wa.me/923001234567');
});

test('whatsAppUrl returns null when there is no usable number', () => {
  assert.equal(whatsAppUrl(undefined), null);
});

test('formatPhone renders a readable Pakistani mobile number', () => {
  assert.equal(formatPhone('03001234567'), '+92 300 1234567');
});
