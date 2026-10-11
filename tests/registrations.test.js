/**
 * The registration data layer: parsing the sheet, matching emails, handling
 * duplicates and bad data, and the read-only cache.
 *
 * All data here is the fictional fixture — see tests/fixtures/registration-sheet.js.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRegistrationIndex,
  lookupRegistration,
  loadRegistrationIndex,
  publicAttendee,
  parseSpreadsheetId,
  readRegistrationSource,
  cacheTtlMs,
  RegistrationsError,
  __resetRegistrationCache,
} from '../api/_lib/registrations.js';
import { SheetsError } from '../api/_lib/googleSheets.js';
import { createFakeSheets } from './helpers/fakeSheets.js';
import {
  REGISTRATION_ROWS,
  HEADER_ROW,
  TEST_SHEET_ID,
  TEST_TAB,
  FIXTURE_PHONES,
} from './fixtures/registration-sheet.js';

function withEnv(vars, run) {
  const saved = {};
  for (const [key, value] of Object.entries(vars)) {
    saved[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  const restore = () => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
  try {
    const result = run();
    if (result && typeof result.then === 'function') return result.finally(restore);
    restore();
    return result;
  } catch (error) {
    restore();
    throw error;
  }
}

const SOURCE = { REGISTRATION_SHEET_ID: TEST_SHEET_ID, REGISTRATION_SHEET_NAME: TEST_TAB };

function fixtureSheets(rows = REGISTRATION_ROWS) {
  return createFakeSheets({ [TEST_SHEET_ID]: { [TEST_TAB]: rows } });
}

/* ==========================================================================
 * Parsing and matching
 * ========================================================================== */

test('headers with trailing spaces, non-breaking spaces and odd capitalization are mapped', () => {
  const { columns } = buildRegistrationIndex(REGISTRATION_ROWS);
  assert.equal(columns.fullName.index, 1);
  assert.equal(columns.email.index, 2);
  assert.equal(columns.enrollmentNumber.index, 3);
  assert.equal(columns.semester.index, 4);
  assert.equal(columns.course.index, 5);
  assert.equal(columns.specialization.index, 6);
  assert.equal(columns.phone.index, 7);
  assert.equal(columns.timestamp.index, 0);
});

test('column order does not matter', () => {
  const order = [2, 0, 7, 1, 6, 3, 5, 4];
  const shuffled = REGISTRATION_ROWS.map((row) => order.map((i) => row[i]));
  const { byEmail } = buildRegistrationIndex(shuffled);
  assert.equal(byEmail.get('asha.verma@example.com').attendee.enrollmentNumber, 'EN2026001');
});

test('a registered email returns exactly the five display fields', () => {
  const { byEmail } = buildRegistrationIndex(REGISTRATION_ROWS);
  assert.deepEqual(publicAttendee(byEmail.get('asha.verma@example.com').attendee), {
    fullName: 'Asha Verma',
    enrollmentNumber: 'EN2026001',
    semester: '3',
    course: 'B.Tech',
    specialization: 'Data Science',
  });
});

test('lookup ignores case, surrounding spaces and non-breaking spaces', async () => {
  const fake = fixtureSheets();
  await withEnv(SOURCE, async () => {
    __resetRegistrationCache();
    for (const input of [
      'asha.verma@example.com',
      'ASHA.VERMA@EXAMPLE.COM',
      '  Asha.Verma@Example.com  ',
      ' asha.verma@example.com\t',
    ]) {
      const result = await lookupRegistration(input, { sheets: fake.sheets });
      assert.equal(result.status, 'FOUND', `failed for ${JSON.stringify(input)}`);
      assert.equal(result.attendee.fullName, 'Asha Verma');
    }
    // Emails stored padded or with a non-breaking space in the sheet match too.
    assert.equal((await lookupRegistration('rohan.mehta@example.org', { sheets: fake.sheets })).status, 'FOUND');
    assert.equal((await lookupRegistration('vikram@example.com', { sheets: fake.sheets })).status, 'FOUND');
  });
});

test('an unregistered or near-miss email is NOT_FOUND', async () => {
  const fake = fixtureSheets();
  await withEnv(SOURCE, async () => {
    __resetRegistrationCache();
    for (const input of ['nobody@example.com', 'asha.verma@example.co', 'asha.verma@example.com.evil.test', '']) {
      const result = await lookupRegistration(input, { sheets: fake.sheets });
      assert.equal(result.status, 'NOT_FOUND', `should not match ${JSON.stringify(input)}`);
      assert.equal(result.attendee, undefined);
    }
  });
});

test('a ragged row (trailing cells omitted by Google) still verifies, blanks reported', () => {
  const { byEmail, report } = buildRegistrationIndex(REGISTRATION_ROWS);
  const meera = byEmail.get('meera@example.com').attendee;
  assert.equal(meera.course, 'MCA');
  assert.equal(meera.specialization, '');
  assert.deepEqual(report.incomplete, [{ rowNumber: 4, fields: ['Specialization'] }]);
});

test('rows with a missing or malformed email are rejected and reported by row number', () => {
  const { report, byEmail } = buildRegistrationIndex(REGISTRATION_ROWS);
  assert.deepEqual(report.rejected, [
    { rowNumber: 5, reason: 'invalid email format' },
    { rowNumber: 6, reason: 'missing email' },
  ]);
  assert.equal(byEmail.has('not-an-email'), false);
});

test('blank rows are skipped, not counted as registrations', () => {
  const { report } = buildRegistrationIndex(REGISTRATION_ROWS);
  assert.equal(report.blankRows, 1);
  assert.equal(report.dataRows, 11);
});

test('an identical repeat submission collapses to one registration', () => {
  const { byEmail, report } = buildRegistrationIndex(REGISTRATION_ROWS);
  assert.deepEqual(report.repeatSubmissions, [{ rowNumbers: [3, 7] }]);
  assert.equal(byEmail.get('rohan.mehta@example.org').attendee.fullName, 'Rohan Mehta');
});

test('same person with reworded details: no row is picked, every value is shown', () => {
  const { byEmail, report } = buildRegistrationIndex(REGISTRATION_ROWS);
  const neha = byEmail.get('neha@example.com');
  assert.equal(neha.conflict, undefined);
  assert.equal(neha.attendee.fullName, 'Neha Kapoor');
  assert.equal(neha.attendee.enrollmentNumber, 'EN2026008');
  assert.equal(neha.attendee.course, 'ECE / Btech ECE');
  assert.equal(neha.attendee.specialization, 'Cloud computing / Google cloud');
  assert.deepEqual(report.combinedVariants, [
    { rowNumbers: [8, 9], differingFields: ['Course', 'Specialization'] },
  ]);
});

test('one email used by two different people is a conflict and returns no details', async () => {
  const { byEmail, report } = buildRegistrationIndex(REGISTRATION_ROWS);
  assert.equal(byEmail.get('shared@example.com').conflict, true);
  assert.equal(byEmail.get('shared@example.com').attendee, undefined);
  assert.deepEqual(report.conflicts, [
    { rowNumbers: [10, 11], differingFields: ['Full Name', 'Enrollment Number', 'Semester'] },
  ]);

  const fake = fixtureSheets();
  await withEnv(SOURCE, async () => {
    __resetRegistrationCache();
    const result = await lookupRegistration('SHARED@example.com', { sheets: fake.sheets });
    assert.deepEqual(result, { status: 'DUPLICATE_CONFLICT' });
  });
});

test('the report counts records and never contains names, emails or phone numbers', () => {
  const { report } = buildRegistrationIndex(REGISTRATION_ROWS);
  assert.equal(report.uniqueEmails, 6);
  assert.equal(report.verifiableRegistrations, 5);

  const serialized = JSON.stringify(report);
  assert.equal(serialized.includes('@'), false);
  for (const name of ['Asha', 'Rohan', 'Meera', 'Neha', 'Arjun', 'Divya', 'Vikram']) {
    assert.equal(serialized.includes(name), false, `report leaked ${name}`);
  }
  for (const phone of FIXTURE_PHONES) assert.equal(serialized.includes(phone), false);
});

test('phone numbers are never stored in a record', () => {
  const { byEmail } = buildRegistrationIndex(REGISTRATION_ROWS);
  for (const entry of byEmail.values()) {
    if (!entry.attendee) continue;
    assert.deepEqual(Object.keys(entry.attendee).sort(), [
      'course',
      'enrollmentNumber',
      'fullName',
      'semester',
      'specialization',
    ]);
    for (const phone of FIXTURE_PHONES) {
      assert.equal(Object.values(entry.attendee).includes(phone), false);
    }
  }
});

test('publicAttendee copies only the five display fields', () => {
  const leaky = { fullName: 'A', enrollmentNumber: 'B', semester: 'C', course: 'D', specialization: 'E', phone: '9', email: 'x@y.z' };
  assert.deepEqual(Object.keys(publicAttendee(leaky)).sort(), [
    'course',
    'enrollmentNumber',
    'fullName',
    'semester',
    'specialization',
  ]);
  assert.equal(publicAttendee(null), null);
});

/* ==========================================================================
 * Malformed data must fail loudly, never as "not found"
 * ========================================================================== */

function assertMalformed(rows, pattern) {
  assert.throws(
    () => buildRegistrationIndex(rows),
    (error) => {
      assert.ok(error instanceof RegistrationsError);
      assert.equal(error.code, 'MALFORMED_DATA');
      if (pattern) assert.match(error.message, pattern);
      return true;
    }
  );
}

test('an empty tab is malformed', () => {
  assertMalformed([], /empty/);
  assertMalformed(null, /empty/);
});

test('a missing required column is malformed and named', () => {
  const withoutEmail = REGISTRATION_ROWS.map((row) => row.filter((_, i) => i !== 2));
  assertMalformed(withoutEmail, /E-mail address/);

  const withoutCourse = REGISTRATION_ROWS.map((row) => row.filter((_, i) => i !== 5));
  assertMalformed(withoutCourse, /Course/);
});

test('two columns that both look like the email column are refused, not guessed', () => {
  const rows = REGISTRATION_ROWS.map((row, i) => [...row, i === 0 ? 'Email Address' : 'someone@example.com']);
  assertMalformed(rows, /Ambiguous/);
});

test('a header row with no data is malformed (wrong tab), not an empty guest list', () => {
  assertMalformed([HEADER_ROW], /No valid registrations/);
});

test('a tab where most emails are invalid is refused', () => {
  const rows = [HEADER_ROW, ...Array.from({ length: 5 }, (_, i) => ['', `Person ${i}`, `bad-${i}`, 'EN', '1', 'B.Tech', 'X', ''])];
  rows.push(['', 'Valid', 'valid@example.com', 'EN', '1', 'B.Tech', 'X', '']);
  assertMalformed(rows, /refusing/);
});

/* ==========================================================================
 * Configuration
 * ========================================================================== */

test('the source must be configured explicitly — there is no default sheet or tab', () => {
  withEnv({ REGISTRATION_SHEET_ID: undefined, REGISTRATION_SHEET_NAME: undefined, GOOGLE_SHEET_ID: 'old-event-sheet-id-should-never-be-used' }, () => {
    assert.throws(readRegistrationSource, (error) => {
      assert.equal(error.code, 'NOT_CONFIGURED');
      assert.match(error.message, /REGISTRATION_SHEET_ID/);
      assert.match(error.message, /REGISTRATION_SHEET_NAME/);
      return true;
    });
  });
});

test('the sheet ID can be pasted as a full Google Sheets URL', () => {
  const url = `https://docs.google.com/spreadsheets/d/${TEST_SHEET_ID}/edit?usp=sharing`;
  assert.equal(parseSpreadsheetId(url), TEST_SHEET_ID);
  assert.equal(parseSpreadsheetId(`  ${TEST_SHEET_ID}\n`), TEST_SHEET_ID);
  assert.equal(parseSpreadsheetId('not a sheet'), '');
  assert.equal(parseSpreadsheetId(''), '');

  withEnv({ REGISTRATION_SHEET_ID: url, REGISTRATION_SHEET_NAME: ` ${TEST_TAB} ` }, () => {
    assert.deepEqual(readRegistrationSource(), { spreadsheetId: TEST_SHEET_ID, sheetName: TEST_TAB });
  });
  withEnv({ REGISTRATION_SHEET_ID: 'nope', REGISTRATION_SHEET_NAME: TEST_TAB }, () => {
    assert.throws(readRegistrationSource, /not a spreadsheet ID/);
  });
});

test('cache TTL defaults to 60 s and ignores nonsense values', () => {
  withEnv({ REGISTRATION_CACHE_SECONDS: undefined }, () => assert.equal(cacheTtlMs(), 60_000));
  withEnv({ REGISTRATION_CACHE_SECONDS: '15' }, () => assert.equal(cacheTtlMs(), 15_000));
  withEnv({ REGISTRATION_CACHE_SECONDS: '0' }, () => assert.equal(cacheTtlMs(), 0));
  withEnv({ REGISTRATION_CACHE_SECONDS: '-5' }, () => assert.equal(cacheTtlMs(), 60_000));
  withEnv({ REGISTRATION_CACHE_SECONDS: 'abc' }, () => assert.equal(cacheTtlMs(), 60_000));
  withEnv({ REGISTRATION_CACHE_SECONDS: '100000' }, () => assert.equal(cacheTtlMs(), 60_000));
});

/* ==========================================================================
 * Loading and caching
 * ========================================================================== */

test('only the configured spreadsheet and tab are read', async () => {
  const fake = fixtureSheets();
  await withEnv(SOURCE, async () => {
    __resetRegistrationCache();
    await loadRegistrationIndex({ sheets: fake.sheets });
    assert.deepEqual(fake.calls.requests, [{ spreadsheetId: TEST_SHEET_ID, sheetName: TEST_TAB }]);
  });
});

test('reads are cached for the TTL, and concurrent lookups share one read', async () => {
  const fake = fixtureSheets();
  await withEnv({ ...SOURCE, REGISTRATION_CACHE_SECONDS: '60' }, async () => {
    __resetRegistrationCache();
    await Promise.all(
      Array.from({ length: 10 }, () => lookupRegistration('asha.verma@example.com', { sheets: fake.sheets }))
    );
    await lookupRegistration('meera@example.com', { sheets: fake.sheets });
    assert.equal(fake.calls.get, 1);
  });
});

test('a registration added to the sheet is picked up once the cache expires', async () => {
  const fake = fixtureSheets();
  await withEnv({ ...SOURCE, REGISTRATION_CACHE_SECONDS: '0' }, async () => {
    __resetRegistrationCache();
    assert.equal((await lookupRegistration('late@example.com', { sheets: fake.sheets })).status, 'NOT_FOUND');

    fake.setRows(TEST_SHEET_ID, TEST_TAB, [
      ...REGISTRATION_ROWS,
      ['11/10/2026 09:00:00', 'Late Joiner', 'late@example.com', 'EN2026099', '1', 'B.Tech', 'Core', '9000000099'],
    ]);
    assert.equal((await lookupRegistration('late@example.com', { sheets: fake.sheets })).status, 'FOUND');
  });
});

test('a failed refresh throws — it is never cached and never answered from stale data', async () => {
  const fake = fixtureSheets();
  await withEnv({ ...SOURCE, REGISTRATION_CACHE_SECONDS: '0' }, async () => {
    __resetRegistrationCache();
    assert.equal((await lookupRegistration('asha.verma@example.com', { sheets: fake.sheets })).status, 'FOUND');

    fake.failWith(new SheetsError('Could not reach Google', { retryable: true }));
    await assert.rejects(lookupRegistration('asha.verma@example.com', { sheets: fake.sheets }), SheetsError);
    await assert.rejects(lookupRegistration('nobody@example.com', { sheets: fake.sheets }), SheetsError);

    fake.failWith(null);
    assert.equal((await lookupRegistration('asha.verma@example.com', { sheets: fake.sheets })).status, 'FOUND');
  });
});

test('a malformed sheet throws on lookup instead of reporting NOT_FOUND', async () => {
  const fake = fixtureSheets([HEADER_ROW.slice(0, 2)]);
  await withEnv(SOURCE, async () => {
    __resetRegistrationCache();
    await assert.rejects(lookupRegistration('asha.verma@example.com', { sheets: fake.sheets }), RegistrationsError);
  });
});

test('a wrong tab name or a sheet the account cannot see throws', async () => {
  const fake = fixtureSheets();
  await withEnv({ REGISTRATION_SHEET_ID: TEST_SHEET_ID, REGISTRATION_SHEET_NAME: 'Sheet1' }, async () => {
    __resetRegistrationCache();
    await assert.rejects(lookupRegistration('asha.verma@example.com', { sheets: fake.sheets }), /HTTP 400/);
  });
  await withEnv({ REGISTRATION_SHEET_ID: '1SomeOtherSpreadsheetIdThatIsNotShared00', REGISTRATION_SHEET_NAME: TEST_TAB }, async () => {
    __resetRegistrationCache();
    await assert.rejects(lookupRegistration('asha.verma@example.com', { sheets: fake.sheets }), /HTTP 404/);
  });
});

test('changing the configured source invalidates the cache', async () => {
  const otherId = '1AnotherFakeSheetIdForCacheKeyTesting0000';
  const fake = createFakeSheets({
    [TEST_SHEET_ID]: { [TEST_TAB]: REGISTRATION_ROWS },
    [otherId]: { [TEST_TAB]: [HEADER_ROW, ['', 'Only Person', 'only@example.com', 'EN1', '1', 'B.Tech', 'X', '']] },
  });
  await withEnv({ ...SOURCE, REGISTRATION_CACHE_SECONDS: '600' }, async () => {
    __resetRegistrationCache();
    assert.equal((await lookupRegistration('only@example.com', { sheets: fake.sheets })).status, 'NOT_FOUND');
  });
  await withEnv({ REGISTRATION_SHEET_ID: otherId, REGISTRATION_SHEET_NAME: TEST_TAB, REGISTRATION_CACHE_SECONDS: '600' }, async () => {
    assert.equal((await lookupRegistration('only@example.com', { sheets: fake.sheets })).status, 'FOUND');
  });
});
