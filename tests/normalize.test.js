import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeEmail,
  isValidEmail,
  normalizeHeader,
  mapHeaders,
  cellFor,
  mealKey,
  mealLabel,
  text,
} from '../api/_lib/normalize.js';

test('normalizeEmail collapses the ways one address gets typed', () => {
  const expected = 'john@example.com';
  for (const input of [
    'john@example.com',
    'JOHN@EXAMPLE.COM',
    '  john@example.com  ',
    '\tJohn@Example.Com\n',
  ]) {
    assert.equal(normalizeEmail(input), expected, `failed for ${JSON.stringify(input)}`);
  }
});

test('normalizeEmail survives values a spreadsheet can produce', () => {
  assert.equal(normalizeEmail(null), '');
  assert.equal(normalizeEmail(undefined), '');
  assert.equal(normalizeEmail(''), '');
  assert.equal(normalizeEmail(12345), '12345');
  assert.equal(normalizeEmail({}), '[object object]');
});

test('isValidEmail accepts real addresses', () => {
  for (const email of [
    'john@example.com',
    'first.last@sub.domain.co.in',
    'user+tag@example.org',
    "o'brien@example.com",
    'user_name-123@example-domain.com',
  ]) {
    assert.equal(isValidEmail(email), true, `should accept ${email}`);
  }
});

test('isValidEmail rejects the typos a desk actually sees', () => {
  for (const email of [
    '',
    'john',
    'john@',
    '@example.com',
    'john@example',
    'john @example.com',
    'john@exam ple.com',
    'john@example.c',
    'a@b.co,c@d.co',
    'a@b.co;c@d.co',
    null,
    undefined,
    12345,
  ]) {
    assert.equal(isValidEmail(email), false, `should reject ${JSON.stringify(email)}`);
  }
});

test('isValidEmail rejects an address past the RFC length cap', () => {
  assert.equal(isValidEmail(`${'a'.repeat(250)}@example.com`), false);
});

test('normalizeHeader ignores case, spacing and punctuation', () => {
  for (const header of ['Email Address', 'email address', '  EMAIL  ADDRESS ', 'E-mail_Address']) {
    assert.equal(normalizeHeader(header), 'emailaddress', `failed for ${JSON.stringify(header)}`);
  }
});

test('mapHeaders resolves a Google Form export', () => {
  const map = mapHeaders([
    'Timestamp',
    'Name',
    'Email Address',
    'Organization/University',
    'Designation',
    'Phone Number',
    'Meal Preference',
  ]);

  assert.equal(map.timestamp, 0);
  assert.equal(map.name, 1);
  assert.equal(map.email, 2);
  assert.equal(map.organization, 3);
  assert.equal(map.designation, 4);
  assert.equal(map.phone, 5);
  assert.equal(map.mealPreference, 6);
});

test('mapHeaders is order-independent', () => {
  const map = mapHeaders(['Meal Preference', 'E-mail', 'Full Name']);
  assert.equal(map.mealPreference, 0);
  assert.equal(map.email, 1);
  assert.equal(map.name, 2);
});

test('mapHeaders prefers the more specific spelling when both are present', () => {
  // "Email Address" is listed ahead of "Email", so it wins the email slot and
  // the plain "Email" column is left unclaimed rather than double-mapped.
  const map = mapHeaders(['Email', 'Email Address']);
  assert.equal(map.email, 1);
});

test('mapHeaders never assigns one column to two fields', () => {
  const map = mapHeaders(['Organization/University', 'Email']);
  const used = Object.values(map);
  assert.equal(new Set(used).size, used.length);
});

test('mapHeaders falls back to a substring match for unusual headers', () => {
  const map = mapHeaders(['Your Work Email', 'Preferred Meal (Veg/Jain)']);
  assert.equal(map.email, 0);
  assert.equal(map.mealPreference, 1);
});

test('mapHeaders reports missing columns as absent, not as zero', () => {
  const map = mapHeaders(['Email']);
  assert.equal(map.email, 0);
  assert.equal(map.name, undefined);
  // The distinction matters: `map.name || 0` would silently read column A.
  assert.ok(!('name' in map));
});

test('mapHeaders copes with an empty or ragged header row', () => {
  assert.deepEqual(mapHeaders([]), {});
  assert.deepEqual(mapHeaders(undefined), {});
  assert.equal(mapHeaders(['', null, 'Email']).email, 2);
});

test('cellFor tolerates rows shorter than the header row', () => {
  const map = mapHeaders(['Email', 'Name', 'Organization']);
  // Google omits trailing empty cells, so this is the normal case, not an edge.
  assert.equal(cellFor(['a@b.com'], map, 'email'), 'a@b.com');
  assert.equal(cellFor(['a@b.com'], map, 'organization'), '');
  assert.equal(cellFor([], map, 'email'), '');
});

test('text flattens whitespace a form export leaves behind', () => {
  assert.equal(text('  John   Doe \n'), 'John Doe');
  assert.equal(text(null), '');
  assert.equal(text(42), '42');
});

test('mealKey groups every spelling of Jain together', () => {
  for (const meal of ['Jain', 'jain veg meal', 'JAIN MEAL', ' Jain Veg ']) {
    assert.equal(mealKey(meal), 'jain', `failed for ${meal}`);
  }
});

test('mealKey keeps other preferences distinct instead of inventing categories', () => {
  assert.equal(mealKey('Veg Meal'), 'veg meal');
  assert.equal(mealKey('Non-Veg'), 'non-veg');
  assert.equal(mealKey('Vegan'), 'vegan');
  assert.equal(mealKey(''), '');
  assert.equal(mealKey(null), '');
});

test('mealLabel title-cases for display', () => {
  assert.equal(mealLabel('jain veg meal'), 'Jain Veg Meal');
  assert.equal(mealLabel('  VEG  '), 'VEG');
  assert.equal(mealLabel(''), '');
});
