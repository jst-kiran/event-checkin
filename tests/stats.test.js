import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
process.env.REGISTRATIONS_PATH = path.join(here, 'fixtures', 'registrations.json');

const { getStats, getCheckInLog, getCheckedInRoster, getPendingAttendees, __resetReadCache, IGNORED_STATUS } =
  await import('../api/_lib/attendance.js');
const { createFakeSheets, EMPTY_SHEETS } = await import('./helpers/fakeSheets.js');

const checkInRow = (email, name = 'Someone', timestamp = '2026-08-20T09:00:00+05:30') => [
  timestamp,
  email,
  name,
  '',
  '',
  '',
  '',
  'Checked In',
];

const lunchRow = (email, name = 'Someone') => [
  '2026-08-20T12:30:00+05:30',
  email,
  name,
  '',
  'Claimed',
];

function setup(checkIns = [], lunches = []) {
  __resetReadCache();
  return createFakeSheets({
    CheckIn: [EMPTY_SHEETS.CheckIn[0], ...checkIns],
    Lunch: [EMPTY_SHEETS.Lunch[0], ...lunches],
  });
}

test('an event that has not started reports zeroes against the full guest list', async () => {
  const fake = setup();
  const stats = await getStats({ sheets: fake.sheets });

  assert.equal(stats.registered, 6);
  assert.equal(stats.checkedIn, 0);
  assert.equal(stats.lunchClaimed, 0);
  assert.equal(stats.yetToCheckIn, 6);
});

test('counts reflect live check-ins and lunches', async () => {
  const fake = setup(
    [checkInRow('john@example.com'), checkInRow('priya@example.com'), checkInRow('alex@example.com')],
    [lunchRow('john@example.com'), lunchRow('priya@example.com')]
  );

  const stats = await getStats({ sheets: fake.sheets });
  assert.equal(stats.registered, 6);
  assert.equal(stats.checkedIn, 3);
  assert.equal(stats.lunchClaimed, 2);
  assert.equal(stats.yetToCheckIn, 3);
});

test('duplicate rows never inflate a count', async () => {
  const fake = setup(
    [
      checkInRow('john@example.com'),
      checkInRow('JOHN@EXAMPLE.COM'),
      checkInRow('  john@example.com  '),
    ],
    [lunchRow('john@example.com'), lunchRow('John@Example.com')]
  );

  const stats = await getStats({ sheets: fake.sheets });
  assert.equal(stats.checkedIn, 1);
  assert.equal(stats.lunchClaimed, 1);
  assert.equal(stats.yetToCheckIn, 5);
});

test('rows marked as ignored duplicates are not counted', async () => {
  const ignored = checkInRow('priya@example.com');
  ignored[7] = IGNORED_STATUS;

  const fake = setup([checkInRow('john@example.com'), ignored]);
  const stats = await getStats({ sheets: fake.sheets });

  assert.equal(stats.checkedIn, 1);
});

test('a hand-typed row for someone not on the guest list cannot go negative', async () => {
  const fake = setup([
    checkInRow('john@example.com'),
    checkInRow('gatecrasher@example.com'),
    checkInRow('another@example.com'),
  ]);

  const stats = await getStats({ sheets: fake.sheets });
  assert.equal(stats.checkedIn, 3, 'the log shows everyone who checked in');
  // Only registered attendees reduce the outstanding count.
  assert.equal(stats.yetToCheckIn, 5);
  assert.ok(stats.yetToCheckIn >= 0);
});

test('lunch is broken down by the preferences that exist in the data', async () => {
  const fake = setup(
    [
      checkInRow('john@example.com'),
      checkInRow('sam@example.com'),
      checkInRow('priya@example.com'),
      checkInRow('riya@example.com'),
    ],
    [
      lunchRow('john@example.com'), // Jain
      lunchRow('sam@example.com'), // Jain
      lunchRow('priya@example.com'), // Veg Meal
      lunchRow('riya@example.com'), // no preference stated
    ]
  );

  const stats = await getStats({ sheets: fake.sheets });
  const byLabel = Object.fromEntries(stats.lunchByPreference.map((e) => [e.label, e.count]));

  assert.equal(byLabel.Jain, 2);
  assert.equal(byLabel['Veg Meal'], 1);
  assert.equal(byLabel['Not specified'], 1);
  assert.equal(stats.lunchClaimed, 4);
});

test('the check-in log is deduplicated and enriched from the snapshot', async () => {
  const fake = setup(
    [checkInRow('john@example.com', 'typo name'), checkInRow('JOHN@EXAMPLE.COM', 'another typo')],
    [lunchRow('john@example.com')]
  );

  const log = await getCheckInLog({ sheets: fake.sheets });
  assert.equal(log.length, 1);

  const [entry] = log;
  // The snapshot is authoritative, so an edited sheet cell does not win.
  assert.equal(entry.name, 'John Doe');
  assert.equal(entry.organization, 'ABC Corp');
  assert.equal(entry.mealPreference, 'Jain Veg Meal');
  assert.equal(entry.lunchClaimed, true);
  assert.equal(entry.registered, true);
});

test('the check-in log never carries phone numbers off the server', async () => {
  const fake = setup([checkInRow('john@example.com')]);
  const log = await getCheckInLog({ sheets: fake.sheets });

  assert.equal('phone' in log[0], false);
  assert.equal('designation' in log[0], false);
  assert.equal(JSON.stringify(log).includes('9999999999'), false);
});

test('an unregistered check-in is shown but flagged', async () => {
  const fake = setup([checkInRow('stranger@example.com', 'Stranger')]);
  const log = await getCheckInLog({ sheets: fake.sheets });

  assert.equal(log[0].registered, false);
  assert.equal(log[0].name, 'Stranger');
});

test('the team roster is exactly the live check-in list, once each', async () => {
  const fake = setup([
    checkInRow('john@example.com'),
    checkInRow('john@example.com'),
    checkInRow('priya@example.com'),
  ]);

  const roster = await getCheckedInRoster({ sheets: fake.sheets });
  assert.equal(roster.length, 2);
  assert.deepEqual(
    roster.map((p) => p.name).sort(),
    ['John Doe', 'Priya Sharma']
  );
});

test('pending attendees are the registered people not yet through the door', async () => {
  const fake = setup([checkInRow('john@example.com'), checkInRow('priya@example.com')]);
  const pending = await getPendingAttendees({ sheets: fake.sheets });

  assert.equal(pending.length, 4);
  assert.equal(pending.some((a) => a.email === 'john@example.com'), false);
  assert.equal(pending.some((a) => a.email === 'alex@example.com'), true);
});

test('an entirely empty spreadsheet reads as an event that has not started', async () => {
  __resetReadCache();
  const fake = createFakeSheets({ CheckIn: [], Lunch: [] });

  const stats = await getStats({ sheets: fake.sheets });
  assert.equal(stats.checkedIn, 0);
  assert.equal(stats.lunchClaimed, 0);
  assert.deepEqual(await getCheckInLog({ sheets: fake.sheets }), []);
  assert.deepEqual(await getCheckedInRoster({ sheets: fake.sheets }), []);
});
