/**
 * The check-in engine: tab creation, one row per person, race handling and
 * how rows are classified (desk / manual / walk-in). Fictional data only.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { REGISTRATION_ROWS, TEST_SHEET_ID, TEST_TAB } from './fixtures/registration-sheet.js';

process.env.REGISTRATION_SHEET_ID = TEST_SHEET_ID;
process.env.REGISTRATION_SHEET_NAME = TEST_TAB;
delete process.env.CHECKIN_SHEET_NAME;

const { checkIn, getCheckIns, METHOD, CHECKIN_HEADERS, IGNORED_STATUS, __resetCheckInCache } = await import(
  '../api/_lib/checkins.js'
);
const { createFakeSheets } = await import('./helpers/fakeSheets.js');

const TAB = 'CheckIns';
const ASHA = { fullName: 'Asha Verma', enrollmentNumber: 'EN2026001', semester: '3', course: 'B.Tech', specialization: 'Data Science' };

function fresh(extraTabs = {}) {
  __resetCheckInCache();
  return createFakeSheets({ [TEST_SHEET_ID]: { [TEST_TAB]: REGISTRATION_ROWS, ...extraTabs } }, { readOnlyTabs: [TEST_TAB] });
}

test('the first check-in creates the CheckIns tab with headers and highlight rules', async () => {
  const fake = fresh();
  const result = await checkIn({ email: 'Asha.Verma@Example.com', attendee: ASHA, method: METHOD.DESK, by: 'Desk', sheets: fake.sheets });

  assert.equal(result.status, 'CHECKED_IN');
  assert.equal(fake.calls.created.length, 1);
  const { sheetName, layout } = fake.calls.created[0];
  assert.equal(sheetName, TAB);
  assert.deepEqual(layout.headers, CHECKIN_HEADERS);

  // Manual rows amber, walk-ins purple, ignored duplicates grey — by Method/Status column.
  const rules = layout.highlights.map((h) => `${CHECKIN_HEADERS[h.column]}=${h.equals}`);
  assert.deepEqual(rules, ['Status=Duplicate (ignored)', 'Method=Manual', 'Method=Walk-in']);

  const rows = fake.rows(TEST_SHEET_ID, TAB);
  assert.deepEqual(rows[0], CHECKIN_HEADERS);
  assert.equal(rows[1][1], 'asha.verma@example.com');
  assert.equal(rows[1][7], 'Desk');
  assert.equal(rows[1][9], 'Checked In');
});

test('a person is checked in once; the second attempt reports the first time', async () => {
  const fake = fresh();
  const first = await checkIn({ email: 'meera@example.com', attendee: {}, method: METHOD.DESK, by: 'Desk', sheets: fake.sheets });
  const second = await checkIn({ email: 'MEERA@example.com', attendee: {}, method: METHOD.MANUAL, by: 'admin@example.com', sheets: fake.sheets });

  assert.equal(first.status, 'CHECKED_IN');
  assert.equal(second.status, 'ALREADY_CHECKED_IN');
  assert.equal(second.record.checkedInAt, first.record.checkedInAt);
  assert.equal(second.record.method, 'Desk');
  assert.equal(fake.rows(TEST_SHEET_ID, TAB).length, 2);
});

test('simultaneous requests for one person in one instance produce one row', async () => {
  const fake = fresh();
  const results = await Promise.all(
    Array.from({ length: 5 }, () => checkIn({ email: 'neha@example.com', attendee: {}, method: METHOD.DESK, by: 'Desk', sheets: fake.sheets }))
  );
  assert.equal(results.filter((r) => r.status === 'CHECKED_IN').length, 1);
  assert.equal(fake.rows(TEST_SHEET_ID, TAB).length, 2);
});

test('a race with another server instance: the later row marks itself ignored', async () => {
  const fake = fresh({ [TAB]: [CHECKIN_HEADERS] });

  // While our append is in flight, "another instance" appends the same email first.
  fake.beforeNextAppend(async () => {
    fake.rows(TEST_SHEET_ID, TAB).push(['2026-10-12T09:00:00+05:30', 'vikram@example.com', 'Vikram Nair', '', '', '', '', 'Desk', 'Desk', 'Checked In']);
  });

  const result = await checkIn({ email: 'vikram@example.com', attendee: {}, method: METHOD.DESK, by: 'Desk', sheets: fake.sheets });
  assert.equal(result.status, 'ALREADY_CHECKED_IN');

  const rows = fake.rows(TEST_SHEET_ID, TAB);
  assert.equal(rows.length, 3);
  assert.equal(rows[1][9], 'Checked In');
  assert.equal(rows[2][9], IGNORED_STATUS, 'our losing row is marked, not deleted');

  const { byEmail } = await getCheckIns({ sheets: fake.sheets, maxAgeMs: 0 });
  assert.equal(byEmail.size, 1);
});

test('an empty CheckIns tab gets a header row before the first append', async () => {
  const fake = fresh({ [TAB]: [] });
  await checkIn({ email: 'asha.verma@example.com', attendee: ASHA, method: METHOD.DESK, by: 'Desk', sheets: fake.sheets });
  const rows = fake.rows(TEST_SHEET_ID, TAB);
  assert.deepEqual(rows[0], CHECKIN_HEADERS);
  assert.equal(rows.length, 2);
  assert.equal(fake.calls.created.length, 0);
});

test('a CheckIns tab with no email column is refused rather than written into', async () => {
  const fake = fresh({ [TAB]: [['Name', 'Notes'], ['x', 'y']] });
  await assert.rejects(
    checkIn({ email: 'asha.verma@example.com', attendee: ASHA, method: METHOD.DESK, by: 'Desk', sheets: fake.sheets }),
    /no E-mail address column/
  );
  assert.equal(fake.calls.writes.length, 0);
});

test('rows typed into the tab by hand count, and without a method they read as Manual', async () => {
  const fake = fresh({
    [TAB]: [
      ['Timestamp', 'Email', 'Name'],
      ['2026-10-12T09:00:00+05:30', 'Meera@Example.com', 'Meera Iyer'],
      ['', 'someone.new@example.com', 'Walk In Typed'],
    ],
  });
  const { byEmail } = await getCheckIns({ sheets: fake.sheets, maxAgeMs: 0 });
  assert.equal(byEmail.get('meera@example.com').method, 'Manual');
  assert.equal(byEmail.get('someone.new@example.com').method, 'Manual');

  const again = await checkIn({ email: 'meera@example.com', attendee: {}, method: METHOD.DESK, by: 'Desk', sheets: fake.sheets });
  assert.equal(again.status, 'ALREADY_CHECKED_IN');
});

test('method labels are recognised however they are typed', async () => {
  const fake = fresh({
    [TAB]: [
      CHECKIN_HEADERS,
      ['t', 'a@example.com', 'A', '', '', '', '', 'desk', '', 'Checked In'],
      ['t', 'b@example.com', 'B', '', '', '', '', 'WALK IN', '', 'Checked In'],
      ['t', 'c@example.com', 'C', '', '', '', '', 'manual', '', 'Checked In'],
      ['t', 'd@example.com', 'D', '', '', '', '', 'Desk', '', IGNORED_STATUS],
    ],
  });
  const { byEmail } = await getCheckIns({ sheets: fake.sheets, maxAgeMs: 0 });
  assert.equal(byEmail.get('a@example.com').method, 'Desk');
  assert.equal(byEmail.get('b@example.com').method, 'Walk-in');
  assert.equal(byEmail.get('c@example.com').method, 'Manual');
  assert.equal(byEmail.has('d@example.com'), false, 'ignored rows are not check-ins');
});

test('an unknown method is refused', async () => {
  const fake = fresh();
  await assert.rejects(checkIn({ email: 'a@example.com', attendee: {}, method: 'Teleport', by: 'x', sheets: fake.sheets }), /Unknown check-in method/);
});

test('a missing CheckIns tab reads as "no check-ins yet", not an error', async () => {
  const fake = fresh();
  const result = await getCheckIns({ sheets: fake.sheets, maxAgeMs: 0 });
  assert.equal(result.exists, false);
  assert.equal(result.byEmail.size, 0);
  assert.equal(fake.calls.writes.length, 0, 'reading never creates the tab');
});
