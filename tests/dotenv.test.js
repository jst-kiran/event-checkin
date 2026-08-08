/**
 * The local .env parser.
 *
 * This is dev-only tooling, but it earned tests: an earlier version matched the
 * spacing after `=` with \s*, which includes newlines, so an empty value
 * silently swallowed the following line. The symptom was a variable that simply
 * did not exist, several files away from the cause.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDotEnv } from '../dev/loadDotEnv.js';

test('an empty value does not swallow the next line', () => {
  const parsed = parseDotEnv(
    ['GOOGLE_SHEET_ID=', 'ADMIN_EMAIL=organizer@example.com', 'ADMIN_PASSWORD=secret'].join('\n')
  );

  assert.equal(parsed.GOOGLE_SHEET_ID, '');
  assert.equal(parsed.ADMIN_EMAIL, 'organizer@example.com');
  assert.equal(parsed.ADMIN_PASSWORD, 'secret');
});

test('several consecutive empty values all stay empty', () => {
  const parsed = parseDotEnv(
    ['A=', 'B=', 'C=', 'SESSION_SECRET=kept'].join('\n')
  );

  assert.deepEqual(parsed, { A: '', B: '', C: '', SESSION_SECRET: 'kept' });
});

test('comments and blank lines are ignored', () => {
  const parsed = parseDotEnv(
    ['# a comment', '', '  # indented comment', 'KEY=value', '# KEY=not-this'].join('\n')
  );

  assert.deepEqual(parsed, { KEY: 'value' });
});

test('surrounding quotes are stripped', () => {
  const parsed = parseDotEnv(['A="quoted"', "B='single'", 'C=bare'].join('\n'));

  assert.equal(parsed.A, 'quoted');
  assert.equal(parsed.B, 'single');
  assert.equal(parsed.C, 'bare');
});

test('a value containing # or spaces survives inside quotes', () => {
  const parsed = parseDotEnv('PASSWORD="correct horse # battery staple"');
  assert.equal(parsed.PASSWORD, 'correct horse # battery staple');
});

test('a multi-line quoted PEM key is read whole', () => {
  const pem = '-----BEGIN PRIVATE KEY-----\nMIIEvQIB\nAAAA\n-----END PRIVATE KEY-----';
  const parsed = parseDotEnv(`GOOGLE_PRIVATE_KEY="${pem}"\nADMIN_EMAIL=a@b.com`);

  assert.equal(parsed.GOOGLE_PRIVATE_KEY, pem);
  assert.equal(parsed.ADMIN_EMAIL, 'a@b.com');
});

test('a key with escaped newlines is left for the Google client to unescape', () => {
  const parsed = parseDotEnv('GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----"');

  assert.match(parsed.GOOGLE_PRIVATE_KEY, /\\n/);
  assert.equal(parsed.GOOGLE_PRIVATE_KEY.startsWith('-----BEGIN'), true);
});

test('spacing around the equals sign is tolerated', () => {
  const parsed = parseDotEnv(['  A = 1', 'B=2', 'C\t=\t3'].join('\n'));
  assert.deepEqual(parsed, { A: '1', B: '2', C: '3' });
});

test('an equals sign inside a value is preserved', () => {
  const parsed = parseDotEnv('SESSION_SECRET=abc==def');
  assert.equal(parsed.SESSION_SECRET, 'abc==def');
});

test('parsing is repeatable — no leftover regex state', () => {
  const input = 'A=1\nB=2';
  assert.deepEqual(parseDotEnv(input), parseDotEnv(input));
});

test('CRLF line endings are handled', () => {
  const parsed = parseDotEnv('A=\r\nB=value\r\n');
  assert.equal(parsed.A, '');
  assert.equal(parsed.B, 'value');
});
