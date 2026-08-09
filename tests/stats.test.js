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

test('claimed lunches split into exactly Jain and Veg', async () => {
  const fake = setup(
    [
      checkInRow('john@example.com'),
      checkInRow('sam@example.com'),
      checkInRow('priya@example.com'),
      checkInRow('riya@example.com'),
    ],
    [
      lunchRow('john@example.com'), // Jain Veg Meal
      lunchRow('sam@example.com'), // Jain Veg Meal
      lunchRow('priya@example.com'), // Veg Meal
      lunchRow('riya@example.com'), // no preference stated -> Veg
    ]
  );

  const stats = await getStats({ sheets: fake.sheets });

  assert.equal(stats.lunchJain, 2);
  assert.equal(stats.lunchVeg, 2);
  // The two groups must always account for every claim — the donut depends on it.
  assert.equal(stats.lunchJain + stats.lunchVeg, stats.lunchClaimed);
});

test('the donut denominator is checked-in attendees, not registrations', async () => {
  const fake = setup(
    [checkInRow('john@example.com'), checkInRow('priya@example.com'), checkInRow('alex@example.com')],
    [lunchRow('john@example.com')]
  );

  const stats = await getStats({ sheets: fake.sheets });

  assert.equal(stats.checkedIn, 3);
  assert.equal(stats.lunchClaimed, 1);
  assert.equal(stats.lunchNotClaimed, 2, 'the other two checked-in attendees');
  assert.equal(stats.lunchClaimed + stats.lunchNotClaimed, stats.checkedIn);
  // Registered is 6 in the fixture; it must not be the denominator here.
  assert.notEqual(stats.lunchNotClaimed, stats.registered - stats.lunchClaimed);
});

test('lunchNotClaimed never goes negative', async () => {
  // A lunch row for somebody with no check-in row — possible if a row is typed
  // straight into the sheet.
  const fake = setup([], [lunchRow('john@example.com'), lunchRow('priya@example.com')]);

  const stats = await getStats({ sheets: fake.sheets });
  assert.equal(stats.checkedIn, 0);
  assert.equal(stats.lunchNotClaimed, 0);
});

test('meal group falls back to the Lunch row when the person is not registered', async () => {
  const walkIn = ['2026-08-20T12:30:00+05:30', 'walkin@example.com', 'Walk In', 'Jain Veg Meal', 'Claimed'];
  const fake = setup([checkInRow('walkin@example.com')], [walkIn]);

  const stats = await getStats({ sheets: fake.sheets });
  assert.equal(stats.lunchJain, 1);
  assert.equal(stats.lunchVeg, 0);
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
