import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEmail, isValidEmail, normalizeHeader, text } from '../api/_lib/normalize.js';

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

test('text flattens whitespace a form export leaves behind', () => {
  assert.equal(text('  John   Doe \n'), 'John Doe');
  assert.equal(text(null), '');
  assert.equal(text(42), '42');
});

test('normalizeEmail strips non-breaking and invisible characters from copy-paste', () => {
  for (const input of [
    '\u00A0john@example.com\u00A0',
    '\u200Bjohn@example.com',
    'john@example.com\uFEFF',
    '\u2060 JOHN@example.com \u200D',
  ]) {
    assert.equal(normalizeEmail(input), 'john@example.com', `failed for ${JSON.stringify(input)}`);
  }
});

test('normalizeHeader matches the registration headers however they are spaced or cased', () => {
  assert.equal(normalizeHeader('Enrollment Number '), 'enrollmentnumber');
  assert.equal(normalizeHeader('Enrollment\u00A0Number'), 'enrollmentnumber');
  assert.equal(normalizeHeader('  ENROLLMENT number\t'), 'enrollmentnumber');
  assert.equal(normalizeHeader('E-mail address'), 'emailaddress');
  assert.equal(normalizeHeader('E-Mail\u00A0Address '), 'emailaddress');
  assert.equal(normalizeHeader('Full Name'), 'fullname');
  assert.equal(normalizeHeader(null), '');
});

test('text collapses non-breaking spaces inside a value', () => {
  assert.equal(text('Data\u00A0\u00A0Science '), 'Data Science');
  assert.equal(text('\u200BAIML'), 'AIML');
});
