import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

// Must be set before attendance.js pulls in the registration service, which
// caches the snapshot on first read.
process.env.REGISTRATIONS_PATH = path.join(here, 'fixtures', 'registrations.json');

const { checkInAttendee, __resetReadCache, IGNORED_STATUS, CHECKED_IN_STATUS } = await import(
  '../api/_lib/attendance.js'
);
const { createFakeSheets, EMPTY_SHEETS } = await import('./helpers/fakeSheets.js');
const { SheetsError } = await import('../api/_lib/googleSheets.js');

/** Header row plus one row per attendee actually recorded. */
function activeRows(fake, tab = 'CheckIn') {
  return fake.rows(tab).slice(1).filter((row) => !row.includes(IGNORED_STATUS));
}

function setup(initial = EMPTY_SHEETS) {
  __resetReadCache();
  return createFakeSheets(initial);
}

test('a registered attendee is checked in and recorded', async () => {
  const fake = setup();
  const result = await checkInAttendee({ email: 'john@example.com', sheets: fake.sheets });

  assert.equal(result.status, 'CHECKED_IN');
  assert.equal(result.attendee.name, 'John Doe');

  const rows = activeRows(fake);
  assert.equal(rows.length, 1);

  const [timestamp, email, name, organization, designation, phone, meal, status] = rows[0];
  assert.equal(email, 'john@example.com');
  assert.equal(name, 'John Doe');
  assert.equal(organization, 'ABC Corp');
  assert.equal(designation, 'Developer');
  assert.equal(phone, '9999999999');
  assert.equal(meal, 'Jain Veg Meal');
  assert.equal(status, CHECKED_IN_STATUS);
  assert.ok(!Number.isNaN(Date.parse(timestamp)), `timestamp "${timestamp}" should parse`);
});

test('check-in is case- and whitespace-insensitive, and normalizes what it stores', async () => {
  const fake = setup();
  const result = await checkInAttendee({ email: '  JOHN@Example.COM  ', sheets: fake.sheets });

  assert.equal(result.status, 'CHECKED_IN');
  // The sheet must hold the canonical address, or the next lookup misses it.
  assert.equal(activeRows(fake)[0][1], 'john@example.com');
});

test('an unregistered email is refused without touching Google', async () => {
  const fake = setup();
  const result = await checkInAttendee({ email: 'nobody@example.com', sheets: fake.sheets });

  assert.equal(result.status, 'REGISTRATION_NOT_FOUND');
  assert.equal(result.attendee, null);
  // The frozen snapshot answers first, so a wrong address costs no API quota.
  assert.equal(fake.calls.get, 0);
  assert.equal(fake.calls.append, 0);
});

test('a second check-in is reported, not recorded twice', async () => {
  const fake = setup();

  const first = await checkInAttendee({ email: 'john@example.com', sheets: fake.sheets });
  __resetReadCache();
  const second = await checkInAttendee({ email: 'JOHN@example.com', sheets: fake.sheets });

  assert.equal(first.status, 'CHECKED_IN');
  assert.equal(second.status, 'ALREADY_CHECKED_IN');
  assert.equal(second.attendee.name, 'John Doe');
  assert.equal(activeRows(fake).length, 1);
});

test('a pre-existing row from a previous session is respected', async () => {
  const fake = setup({
    CheckIn: [
      EMPTY_SHEETS.CheckIn[0],
      ['2026-08-20T09:00:00+05:30', 'john@example.com', 'John Doe', '', '', '', '', 'Checked In'],
    ],
  });

  const result = await checkInAttendee({ email: 'john@example.com', sheets: fake.sheets });
  assert.equal(result.status, 'ALREADY_CHECKED_IN');
  assert.equal(fake.calls.append, 0);
});

test('two devices submitting at the same moment produce one check-in', async () => {
  const fake = setup();

  // Fired without awaiting in between: this is the double-tap / two-operator
  // case, and the per-email lock is what has to catch it.
  const [a, b] = await Promise.all([
    checkInAttendee({ email: 'john@example.com', sheets: fake.sheets }),
    checkInAttendee({ email: 'JOHN@EXAMPLE.COM', sheets: fake.sheets }),
  ]);

  const outcomes = [a.status, b.status].sort();
  assert.deepEqual(outcomes, ['ALREADY_CHECKED_IN', 'CHECKED_IN']);
  assert.equal(activeRows(fake).length, 1);
  assert.equal(fake.calls.append, 1, 'the second request must not append at all');
});

test('ten simultaneous submissions still produce one check-in', async () => {
  const fake = setup();

  const results = await Promise.all(
    Array.from({ length: 10 }, () =>
      checkInAttendee({ email: 'john@example.com', sheets: fake.sheets })
    )
  );

  assert.equal(results.filter((r) => r.status === 'CHECKED_IN').length, 1);
  assert.equal(results.filter((r) => r.status === 'ALREADY_CHECKED_IN').length, 9);
  assert.equal(activeRows(fake).length, 1);
});

test('different attendees at the same moment all get in', async () => {
  const fake = setup();
  const emails = ['john@example.com', 'priya@example.com', 'alex@example.com', 'sam@example.com'];

  const results = await Promise.all(
    emails.map((email) => checkInAttendee({ email, sheets: fake.sheets }))
  );

  assert.ok(results.every((r) => r.status === 'CHECKED_IN'));
  assert.equal(activeRows(fake).length, 4);
  // The lock is per email, so four different people are not serialized.
  assert.equal(new Set(activeRows(fake).map((row) => row[1])).size, 4);
});

test('a row appended by another instance mid-request loses to the earlier row', async () => {
  const fake = setup();

  // Simulates a second lambda instance: it appends between our read and our
  // append, so its row lands first and ours is the duplicate.
  fake.beforeNextAppend(async (sheets) => {
    await sheets.appendSheetRow('CheckIn', [
      '2026-08-20T10:00:00+05:30',
      'john@example.com',
      'John Doe',
      'ABC Corp',
      'Developer',
      '9999999999',
      'Jain Veg Meal',
      'Checked In',
    ]);
  });

  const result = await checkInAttendee({ email: 'john@example.com', sheets: fake.sheets });

  // The attendee is told the truth, and the sheet ends up with one live row.
  assert.equal(result.status, 'ALREADY_CHECKED_IN');
  assert.equal(activeRows(fake).length, 1);

  const all = fake.rows('CheckIn').slice(1);
  assert.equal(all.length, 2, 'the losing row is marked, never deleted');
  assert.equal(all[1][7], IGNORED_STATUS);
});

test('the winning row survives when the rival appends after us', async () => {
  const fake = setup();
  const first = await checkInAttendee({ email: 'priya@example.com', sheets: fake.sheets });
  assert.equal(first.status, 'CHECKED_IN');

  // A stray row added afterwards by hand must not unseat the real check-in.
  await fake.sheets.appendSheetRow('CheckIn', [
    '2026-08-20T11:00:00+05:30',
    'priya@example.com',
    'Priya Sharma',
    '',
    '',
    '',
    '',
    'Checked In',
  ]);
  __resetReadCache();

  const again = await checkInAttendee({ email: 'priya@example.com', sheets: fake.sheets });
  assert.equal(again.status, 'ALREADY_CHECKED_IN');
});

test('an ignored duplicate does not block a genuine later check-in', async () => {
  const fake = setup({
    CheckIn: [
      EMPTY_SHEETS.CheckIn[0],
      ['2026-08-20T09:00:00+05:30', 'dana@example.com', 'Dana Cruz', '', '', '', '', IGNORED_STATUS],
    ],
  });

  const result = await checkInAttendee({ email: 'dana@example.com', sheets: fake.sheets });
  assert.equal(result.status, 'CHECKED_IN');
  assert.equal(activeRows(fake).length, 1);
});

test('an empty tab gets its header row written before the first append', async () => {
  const fake = setup({ CheckIn: [] });

  const result = await checkInAttendee({ email: 'john@example.com', sheets: fake.sheets });
  assert.equal(result.status, 'CHECKED_IN');

  const rows = fake.rows('CheckIn');
  assert.deepEqual(rows[0], EMPTY_SHEETS.CheckIn[0]);
  assert.equal(rows[1][1], 'john@example.com');
});

test('columns are located by header, not by position', async () => {
  // Same data, deliberately reordered and re-spelled by an organizer.
  const fake = setup({
    CheckIn: [['Email Address', 'Check-in Status', 'Full Name', 'Meal', 'Timestamp']],
  });

  await checkInAttendee({ email: 'john@example.com', sheets: fake.sheets });
  const row = fake.rows('CheckIn')[1];

  assert.equal(row[0], 'john@example.com');
  assert.equal(row[1], CHECKED_IN_STATUS);
  assert.equal(row[2], 'John Doe');
  assert.equal(row[3], 'Jain Veg Meal');
  assert.ok(!Number.isNaN(Date.parse(row[4])));
});

test('a tab with no email column is refused rather than filled with garbage', async () => {
  const fake = setup({ CheckIn: [['Some Column', 'Another Column']] });

  await assert.rejects(
    () => checkInAttendee({ email: 'john@example.com', sheets: fake.sheets }),
    /no recognizable Email column/i
  );
  assert.equal(fake.calls.append, 0);
});

test('a Google outage surfaces as a retryable error, not a false check-in', async () => {
  const fake = setup();
  fake.failWith(new SheetsError('Google is down', { retryable: true }));

  await assert.rejects(
    () => checkInAttendee({ email: 'john@example.com', sheets: fake.sheets }),
    (error) => error.name === 'SheetsError' && error.retryable === true
  );
});

test('a failed append leaves the lock usable for the next attempt', async () => {
  const fake = setup();
  fake.failWith(new SheetsError('transient'), { only: 'append', times: 1 });

  await assert.rejects(() => checkInAttendee({ email: 'john@example.com', sheets: fake.sheets }));

  // A rejected request must not wedge the queue for that email forever.
  fake.clearFailure();
  __resetReadCache();
  const retry = await checkInAttendee({ email: 'john@example.com', sheets: fake.sheets });
  assert.equal(retry.status, 'CHECKED_IN');
});

test('rows with a blank email are ignored when scanning the sheet', async () => {
  const fake = setup({
    CheckIn: [EMPTY_SHEETS.CheckIn[0], [], ['2026-08-20T09:00:00+05:30', '', '', '', '', '', '', '']],
  });

  const result = await checkInAttendee({ email: 'john@example.com', sheets: fake.sheets });
  assert.equal(result.status, 'CHECKED_IN');
});
