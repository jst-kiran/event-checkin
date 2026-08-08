import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
process.env.REGISTRATIONS_PATH = path.join(here, 'fixtures', 'registrations.json');

const { checkInAttendee, claimLunch, __resetReadCache, IGNORED_STATUS, CLAIMED_STATUS } =
  await import('../api/_lib/attendance.js');
const { createFakeSheets, EMPTY_SHEETS } = await import('./helpers/fakeSheets.js');
const { SheetsError } = await import('../api/_lib/googleSheets.js');

function checkedInSheet(...emails) {
  return {
    CheckIn: [
      EMPTY_SHEETS.CheckIn[0],
      ...emails.map((email) => [
        '2026-08-20T09:00:00+05:30',
        email,
        'Someone',
        '',
        '',
        '',
        '',
        'Checked In',
      ]),
    ],
    Lunch: [EMPTY_SHEETS.Lunch[0]],
  };
}

function activeRows(fake, tab) {
  return fake.rows(tab).slice(1).filter((row) => !row.includes(IGNORED_STATUS));
}

function setup(initial) {
  __resetReadCache();
  return createFakeSheets(initial);
}

test('a checked-in attendee collects lunch', async () => {
  const fake = setup(checkedInSheet('john@example.com'));
  const result = await claimLunch({ email: 'john@example.com', sheets: fake.sheets });

  assert.equal(result.status, 'LUNCH_APPROVED');
  assert.equal(result.attendee.name, 'John Doe');

  const rows = activeRows(fake, 'Lunch');
  assert.equal(rows.length, 1);

  const [timestamp, email, name, meal, status] = rows[0];
  assert.equal(email, 'john@example.com');
  assert.equal(name, 'John Doe');
  assert.equal(meal, 'Jain Veg Meal');
  assert.equal(status, CLAIMED_STATUS);
  assert.ok(!Number.isNaN(Date.parse(timestamp)));
});

test('the meal preference comes from the frozen registration, not the request', async () => {
  const fake = setup(checkedInSheet('priya@example.com'));

  // Anything extra in the call is ignored — the engine only reads `email`.
  const result = await claimLunch({
    email: 'priya@example.com',
    mealPreference: 'Jain Veg Meal',
    meal: 'Jain',
    sheets: fake.sheets,
  });

  assert.equal(result.status, 'LUNCH_APPROVED');
  assert.equal(result.attendee.mealPreference, 'Veg Meal');
  assert.equal(activeRows(fake, 'Lunch')[0][3], 'Veg Meal');
});

test('lunch requires a check-in first', async () => {
  const fake = setup(checkedInSheet());
  const result = await claimLunch({ email: 'john@example.com', sheets: fake.sheets });

  assert.equal(result.status, 'PLEASE_CHECK_IN_FIRST');
  assert.equal(result.attendee.name, 'John Doe');
  assert.equal(activeRows(fake, 'Lunch').length, 0);
});

test('an unregistered email is refused without touching Google', async () => {
  const fake = setup(checkedInSheet());
  const result = await claimLunch({ email: 'nobody@example.com', sheets: fake.sheets });

  assert.equal(result.status, 'REGISTRATION_NOT_FOUND');
  assert.equal(result.attendee, null);
  assert.equal(fake.calls.get, 0);
});

test('lunch cannot be collected twice', async () => {
  const fake = setup(checkedInSheet('john@example.com'));

  const first = await claimLunch({ email: 'john@example.com', sheets: fake.sheets });
  __resetReadCache();
  const second = await claimLunch({ email: '  JOHN@EXAMPLE.COM ', sheets: fake.sheets });

  assert.equal(first.status, 'LUNCH_APPROVED');
  assert.equal(second.status, 'ALREADY_CLAIMED');
  assert.equal(activeRows(fake, 'Lunch').length, 1);
});

test('two counters serving the same person at once hand out one meal', async () => {
  const fake = setup(checkedInSheet('john@example.com'));

  const [a, b] = await Promise.all([
    claimLunch({ email: 'john@example.com', sheets: fake.sheets }),
    claimLunch({ email: 'JOHN@example.com', sheets: fake.sheets }),
  ]);

  assert.deepEqual([a.status, b.status].sort(), ['ALREADY_CLAIMED', 'LUNCH_APPROVED']);
  assert.equal(activeRows(fake, 'Lunch').length, 1);
});

test('a rival instance claiming first wins the row', async () => {
  const fake = setup(checkedInSheet('john@example.com'));

  fake.beforeNextAppend(async (sheets) => {
    await sheets.appendSheetRow('Lunch', [
      '2026-08-20T12:00:00+05:30',
      'john@example.com',
      'John Doe',
      'Jain Veg Meal',
      'Claimed',
    ]);
  });

  const result = await claimLunch({ email: 'john@example.com', sheets: fake.sheets });

  assert.equal(result.status, 'ALREADY_CLAIMED');
  assert.equal(activeRows(fake, 'Lunch').length, 1);
  assert.equal(fake.rows('Lunch')[2][4], IGNORED_STATUS);
});

test('an ignored check-in row does not count as being checked in', async () => {
  const fake = setup({
    CheckIn: [
      EMPTY_SHEETS.CheckIn[0],
      ['2026-08-20T09:00:00+05:30', 'john@example.com', 'John Doe', '', '', '', '', IGNORED_STATUS],
    ],
    Lunch: [EMPTY_SHEETS.Lunch[0]],
  });

  const result = await claimLunch({ email: 'john@example.com', sheets: fake.sheets });
  assert.equal(result.status, 'PLEASE_CHECK_IN_FIRST');
});

test('an attendee with no stated preference still gets lunch', async () => {
  const fake = setup(checkedInSheet('riya@example.com'));
  const result = await claimLunch({ email: 'riya@example.com', sheets: fake.sheets });

  assert.equal(result.status, 'LUNCH_APPROVED');
  assert.equal(result.attendee.mealPreference, '');
});

test('an empty Lunch tab gets its header row written', async () => {
  const fake = setup({ ...checkedInSheet('john@example.com'), Lunch: [] });

  await claimLunch({ email: 'john@example.com', sheets: fake.sheets });
  assert.deepEqual(fake.rows('Lunch')[0], EMPTY_SHEETS.Lunch[0]);
});

test('a Google outage does not silently approve a meal', async () => {
  const fake = setup(checkedInSheet('john@example.com'));
  fake.failWith(new SheetsError('Google is down', { retryable: true }));

  await assert.rejects(
    () => claimLunch({ email: 'john@example.com', sheets: fake.sheets }),
    (error) => error.name === 'SheetsError'
  );
});

test('check-in then lunch works end to end', async () => {
  const fake = setup(EMPTY_SHEETS);

  const checkIn = await checkInAttendee({ email: 'alex@example.com', sheets: fake.sheets });
  assert.equal(checkIn.status, 'CHECKED_IN');

  __resetReadCache();
  const lunch = await claimLunch({ email: 'ALEX@EXAMPLE.COM', sheets: fake.sheets });
  assert.equal(lunch.status, 'LUNCH_APPROVED');
  assert.equal(activeRows(fake, 'Lunch')[0][1], 'alex@example.com');
});
