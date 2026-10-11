#!/usr/bin/env node
/**
 * Checks the registration sheet exactly the way the deployed app reads it.
 *
 *   npm run check:registrations
 *
 * Uses the same service account, the same REGISTRATION_SHEET_ID /
 * REGISTRATION_SHEET_NAME and the same parser as /api/verify, so a clean run
 * here means the deployment will be able to read and validate the sheet.
 *
 * It is strictly read-only — it writes nothing to the spreadsheet and nothing
 * to disk — and the report it prints contains row numbers and counts only:
 * no names, no email addresses, no phone numbers.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import loadDotEnv from '../dev/loadDotEnv.js';
import { googleSheets } from '../api/_lib/googleSheets.js';
import { readRegistrationSource, buildRegistrationIndex, COLUMNS } from '../api/_lib/registrations.js';

// Bare Node does not read .env by itself; resolve it from the project root so
// the script works from any directory.
loadDotEnv(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));

function rows(list, format) {
  return list.length ? list.map((item) => `    - ${format(item)}`).join('\n') : '    (none)';
}

try {
  const source = readRegistrationSource();
  console.log(`Spreadsheet ID : ${source.spreadsheetId}`);
  console.log(`Worksheet (tab): ${source.sheetName}`);
  console.log('Reading with the service account (read-only scope)…\n');

  const values = await googleSheets.getSheetValues(source.spreadsheetId, source.sheetName);
  const { columns, report } = buildRegistrationIndex(values);

  console.log('Columns:');
  for (const [field, spec] of Object.entries(COLUMNS)) {
    const found = columns[field];
    console.log(
      `  ${spec.label.padEnd(18)} ${found ? `column ${found.index + 1} ("${found.header}")` : '— not found —'}` +
        (field === 'phone' ? '   (never read or returned)' : '')
    );
  }

  console.log(`\nData rows                       : ${report.dataRows}`);
  console.log(`Blank rows skipped              : ${report.blankRows}`);
  console.log(`Rejected rows                   : ${report.rejected.length}`);
  console.log(rows(report.rejected, (r) => `row ${r.rowNumber}: ${r.reason}`));
  console.log(`Unique email addresses          : ${report.uniqueEmails}`);
  console.log(`Repeat submissions (identical)  : ${report.repeatSubmissions.length}`);
  console.log(rows(report.repeatSubmissions, (r) => `rows ${r.rowNumbers.join(', ')}`));
  console.log(`Same person, details combined   : ${report.combinedVariants.length}`);
  console.log(rows(report.combinedVariants, (r) => `rows ${r.rowNumbers.join(', ')} differ on ${r.differingFields.join(', ')}`));
  console.log(`Conflicting duplicates (blocked): ${report.conflicts.length}`);
  console.log(rows(report.conflicts, (r) => `rows ${r.rowNumbers.join(', ')} differ on ${r.differingFields.join(', ')}`));
  console.log(`Rows with blank details         : ${report.incomplete.length}`);
  console.log(rows(report.incomplete, (r) => `row ${r.rowNumber}: ${r.fields.join(', ')}`));
  console.log(`\nVerifiable registrations        : ${report.verifiableRegistrations}`);
  console.log('\nOK — the app can read and validate this sheet.');
} catch (error) {
  // Credentials must not end up in a terminal log or a CI transcript; these
  // messages name variables and HTTP statuses, never their values.
  console.error(`\nERROR: ${error?.message || error}\n`);
  if (error?.httpStatus === 403) {
    console.error('Share the spreadsheet with GOOGLE_SERVICE_ACCOUNT_EMAIL as a Viewer, then run this again.\n');
  }
  process.exit(1);
}
