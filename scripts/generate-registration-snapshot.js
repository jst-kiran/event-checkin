#!/usr/bin/env node
/**
 * Builds data/registrations.json — the frozen guest list the event runs on.
 *
 *   node scripts/generate-registration-snapshot.js
 *   node scripts/generate-registration-snapshot.js --from export.csv
 *   node scripts/generate-registration-snapshot.js --dry-run
 *
 * Run this ONCE, after registrations close on 15 August 2026, review the output,
 * then commit the file. It is the only moment the Registrations tab is read.
 *
 * ---------------------------------------------------------------------------
 * WHY IT REFUSES RATHER THAN REPAIRS
 * ---------------------------------------------------------------------------
 * Every validation failure here stops the run. That is deliberate. If two rows
 * share an email, this script cannot know which one is the real attendee — and
 * quietly picking the first would hide the problem until someone is turned away
 * at the door on the day. A human resolving it in the spreadsheet, before
 * deployment, is the cheap moment to get it right. The whole point of freezing
 * the data is that nobody has to make that call under pressure at the desk.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getSheetValues, SHEET_NAMES, isConfigured } from '../api/_lib/googleSheets.js';
import {
  mapHeaders,
  cellFor,
  normalizeEmail,
  isValidEmail,
  normalizeHeader,
  text,
} from '../api/_lib/normalize.js';
import loadDotEnv from '../dev/loadDotEnv.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// This script runs as bare Node rather than through Vite, so nothing else
// populates process.env from .env — without this, the Google credentials are
// invisible here even when they are set correctly. Resolved from projectRoot
// rather than cwd so it works whichever directory you invoke it from.
loadDotEnv(projectRoot);

const OUTPUT_FILE = path.join(projectRoot, 'data', 'registrations.json');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const fromIndex = args.indexOf('--from');
const csvFile = fromIndex >= 0 ? args[fromIndex + 1] : null;

/**
 * --email-column "Email"
 *
 * Names the column that is authoritative for identity, by its exact header.
 *
 * A Google Form with "collect email addresses" enabled produces two email
 * columns: the address Google took from the respondent's account, and whatever
 * the form itself asked for. They frequently disagree, and only one of them is
 * the address the attendee will type at the desk.
 *
 * Header matching cannot make that call — both spellings are legitimately
 * "the email column". So it is an explicit decision, recorded in the command
 * that generates the snapshot and printed in the output for review. The
 * deployed application never sees this; by then the choice is baked into the
 * frozen dataset.
 *
 * The npm script supplies this project's answer (`--email-column Email`), so
 * plain `npm run snapshot` always makes the same choice. lastIndexOf, not
 * indexOf, so passing the flag again on the command line overrides that default
 * rather than being silently ignored behind it.
 */
const emailColumnIndex = args.lastIndexOf('--email-column');
const emailColumn = emailColumnIndex >= 0 ? args[emailColumnIndex + 1] : null;

/* ==========================================================================
 * INPUT
 * ========================================================================== */

/**
 * Minimal RFC 4180 CSV reader.
 *
 * The escape rule that matters: inside quotes, "" is a literal quote, and
 * commas and newlines are data. A naive split(',') mangles exactly the fields
 * this file is full of — "Acme, Inc." and multi-line addresses.
 */
function parseCsv(raw) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < raw.length; i++) {
    const char = raw[i];

    if (quoted) {
      if (char !== '"') {
        field += char;
      } else if (raw[i + 1] === '"') {
        field += '"';
        i++;
      } else {
        quoted = false;
      }
      continue;
    }

    if (char === '"') quoted = true;
    else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      field = '';
    } else field += char;
  }

  if (field.length || row.length) {
    row.push(field.replace(/\r$/, ''));
    rows.push(row);
  }

  return rows.filter((r) => r.some((cell) => text(cell) !== ''));
}

async function loadRows() {
  if (csvFile) {
    const file = path.resolve(csvFile);
    if (!fs.existsSync(file)) exit(`CSV file not found: ${file}`);
    console.log(`Reading ${file}`);
    // Strip a UTF-8 BOM, which Excel adds and which would corrupt the first header.
    return parseCsv(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
  }

  if (!isConfigured()) {
    exit(
      'Google credentials are not configured.\n\n' +
        'Either set GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY and GOOGLE_SHEET_ID\n' +
        'in .env, or export the Registrations tab and pass it with --from export.csv'
    );
  }

  console.log(`Reading the "${SHEET_NAMES.registrations}" tab from Google Sheets…`);
  return getSheetValues(SHEET_NAMES.registrations);
}

/* ==========================================================================
 * VALIDATION
 * ========================================================================== */

function exit(message) {
  console.error(`\nERROR: ${message}\n`);
  process.exit(1);
}

function validate(rows) {
  if (!rows.length) exit('The Registrations sheet is empty.');

  const headers = rows[0].map(text);
  const map = mapHeaders(headers);

  // An explicit --email-column overrides whatever header matching picked.
  if (emailColumn) {
    const wanted = normalizeHeader(emailColumn);
    const index = headers.findIndex((header) => normalizeHeader(header) === wanted);

    if (index === -1) {
      exit(
        `--email-column "${emailColumn}" does not match any header.\n` +
          `Headers seen: ${headers.join(', ')}`
      );
    }
    map.email = index;
  }

  console.log(`\nHeader row: ${headers.join(' | ')}`);
  console.log('Resolved columns:');
  for (const field of ['name', 'email', 'organization', 'designation', 'phone', 'mealPreference']) {
    const index = map[field];
    console.log(
      `  ${field.padEnd(15)} ${index === undefined ? '— not found —' : `"${headers[index]}"`}` +
        (field === 'email' && emailColumn ? '   <- set explicitly by --email-column' : '')
    );
  }

  // Without these two, nobody can be identified or greeted.
  if (map.email === undefined) {
    exit(
      'No email column found.\n' +
        `Headers seen: ${headers.join(', ')}\n` +
        'Rename the column to "Email" or "Email Address".'
    );
  }
  if (map.name === undefined) {
    console.warn('\nWARNING: no name column found — attendees will be greeted generically.');
  }

  const attendees = [];
  const seen = new Map(); // normalized email -> { rowNumber, attendee }
  const problems = {
    missingEmail: [],
    invalidEmail: [],
    missingName: [],
    duplicates: [],
    merged: [],
  };

  for (let i = 1; i < rows.length; i++) {
    const rowNumber = i + 1; // 1-based, as shown in the spreadsheet
    const row = rows[i];
    const email = normalizeEmail(cellFor(row, map, 'email'));

    if (!email) {
      problems.missingEmail.push(rowNumber);
      continue;
    }
    if (!isValidEmail(email)) {
      problems.invalidEmail.push(`row ${rowNumber}: ${email}`);
      continue;
    }

    const name = cellFor(row, map, 'name');
    const attendee = {
      name: name || 'Attendee',
      email,
      organization: cellFor(row, map, 'organization'),
      designation: cellFor(row, map, 'designation'),
      phone: cellFor(row, map, 'phone'),
      mealPreference: cellFor(row, map, 'mealPreference'),
    };

    if (seen.has(email)) {
      const first = seen.get(email);
      const differing = conflictingFields(first.attendee, attendee);

      if (differing.length === 0) {
        // The same person submitted the form twice. Both rows produce an
        // identical record, so there is no question of which one is "real" and
        // nothing is lost by keeping the first.
        problems.merged.push(`${email} (rows ${first.rowNumber} and ${rowNumber})`);
      } else {
        // Same address, different people — the dangerous case, and the reason
        // this check exists. One address cannot identify two attendees: only
        // one of them could ever check in or collect a meal.
        problems.duplicates.push({ email, differing, first, second: { rowNumber, attendee } });
      }
      continue;
    }

    seen.set(email, { rowNumber, attendee });
    if (!name) problems.missingName.push(`row ${rowNumber}: ${email}`);
    attendees.push(attendee);
  }

  return { attendees, problems, totalRows: rows.length - 1 };
}

/** Identity fields that must agree before two rows can be treated as one person. */
const IDENTITY_FIELDS = ['name', 'organization', 'designation', 'phone', 'mealPreference'];

/** @returns {string[]} the fields on which two records genuinely disagree */
function conflictingFields(a, b) {
  const same = (value) => text(value).toLowerCase();
  return IDENTITY_FIELDS.filter((field) => same(a[field]) !== same(b[field]));
}

function report({ attendees, problems, totalRows }) {
  console.log(`\nRead ${totalRows} data rows → ${attendees.length} valid registrations.`);

  // Surfaced so an unexpected value ("Vegan", a typo) is noticed now rather
  // than at the lunch counter.
  const meals = new Map();
  for (const attendee of attendees) {
    const key = attendee.mealPreference || '(not specified)';
    meals.set(key, (meals.get(key) || 0) + 1);
  }
  console.log('\nMeal preferences found:');
  for (const [label, count] of [...meals].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(count).padStart(4)}  ${label}`);
  }

  if (problems.missingName.length) {
    console.warn(`\nWARNING: ${problems.missingName.length} row(s) have no name:`);
    for (const item of problems.missingName.slice(0, 10)) console.warn(`  ${item}`);
    if (problems.missingName.length > 10) console.warn(`  … and ${problems.missingName.length - 10} more`);
  }

  if (problems.missingEmail.length) {
    console.warn(`\nWARNING: ${problems.missingEmail.length} row(s) have no email and were skipped:`);
    console.warn(`  rows ${problems.missingEmail.slice(0, 20).join(', ')}`);
  }

  if (problems.merged.length) {
    console.warn(
      `\nWARNING: ${problems.merged.length} repeat submission(s) collapsed into one registration.`
    );
    console.warn('Every field matched, so the later row added nothing:');
    for (const item of problems.merged) console.warn(`  ${item}`);
  }

  // --- Fatal from here down -------------------------------------------------

  if (problems.invalidEmail.length) {
    exit(
      `${problems.invalidEmail.length} malformed email address(es):\n\n` +
        problems.invalidEmail.map((item) => `  ${item}`).join('\n') +
        '\n\nFix these in the Registrations sheet, then run this script again.'
    );
  }

  if (problems.duplicates.length) {
    // Show exactly which fields disagree. "Same email, different name" is
    // almost always one person registering a friend, and seeing the two names
    // side by side makes that obvious immediately.
    const detail = problems.duplicates
      .map(({ email, differing, first, second }) => {
        const lines = [`  ${email}`, `    rows ${first.rowNumber} and ${second.rowNumber} differ on: ${differing.join(', ')}`];
        for (const field of differing) {
          lines.push(`      row ${first.rowNumber}  ${field}: "${first.attendee[field]}"`);
          lines.push(`      row ${second.rowNumber}  ${field}: "${second.attendee[field]}"`);
        }
        return lines.join('\n');
      })
      .join('\n\n');

    exit(
      `Conflicting registration email(s) found:\n\n` +
        detail +
        '\n\nThese rows share one email address but describe different people, so only\n' +
        'one of them could ever check in or collect a meal. Give each person their\n' +
        'own address in the Registrations sheet, then run this script again.'
    );
  }

  if (!attendees.length) exit('No valid registrations found — refusing to write an empty snapshot.');
}

/* ==========================================================================
 * OUTPUT
 * ========================================================================== */

function write(attendees) {
  const now = new Date();
  const snapshot = {
    snapshotVersion: now.toISOString().slice(0, 10),
    generatedAt: now.toISOString(),
    totalRegistrations: attendees.length,
    attendees,
  };

  if (dryRun) {
    console.log('\n--dry-run: nothing written.');
    console.log(`Would write ${attendees.length} registrations to ${OUTPUT_FILE}`);
    return;
  }

  if (fs.existsSync(OUTPUT_FILE)) {
    // Overwriting the live guest list mid-event is the one genuinely dangerous
    // thing this script can do, so the previous file is always kept.
    const backup = `${OUTPUT_FILE}.${now.toISOString().replace(/[:.]/g, '-')}.bak`;
    fs.copyFileSync(OUTPUT_FILE, backup);
    console.log(`\nExisting snapshot backed up to ${path.basename(backup)}`);
  }

  fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');

  console.log(`\nWrote ${attendees.length} registrations to data/registrations.json`);
  console.log(`Snapshot version: ${snapshot.snapshotVersion}`);
  console.log('\nNext: review the file, commit it, then deploy.');
}

/* ==========================================================================
 * MAIN
 * ========================================================================== */

try {
  const rows = await loadRows();
  const result = validate(rows);
  report(result);
  write(result.attendees);
} catch (error) {
  // Credentials must not end up in a terminal log or a CI transcript.
  exit(error?.message || String(error));
}
