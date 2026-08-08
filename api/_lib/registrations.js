/**
 * The frozen registration dataset.
 *
 * RSVPs close on 15 August 2026, after which the guest list cannot change. So
 * the event-day application does not ask Google who is registered — it reads a
 * snapshot committed to the repository. That buys three things on the day:
 *
 *   - a lookup that is a Map hit rather than a network round trip,
 *   - a check-in desk that keeps working if the Sheets API is degraded,
 *   - no Google read quota spent on data that is known to be immutable.
 *
 * Google Sheets remains the live store for CheckIn and Lunch. Only the guest
 * list is frozen.
 *
 * The snapshot is produced by scripts/generate-registration-snapshot.js, which
 * refuses to emit a file containing duplicate or invalid emails.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeEmail, text, mealKey, mealLabel } from './normalize.js';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Where the snapshot might be, in priority order.
 *
 * The relative walk from this module is the reliable one and works in every
 * environment. process.cwd() is kept as a fallback because a bundler may
 * flatten the layout around the function.
 */
function candidatePaths() {
  return [
    path.resolve(here, '../../data/registrations.json'),
    path.resolve(process.cwd(), 'data/registrations.json'),
  ];
}

export class RegistrationsError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RegistrationsError';
  }
}

// Parsed once per lambda instance. The data is immutable by definition, so a
// warm instance never re-reads it and there is no cache to invalidate.
let snapshot = null;

function parseSnapshot(raw, source) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new RegistrationsError(`${source} is not valid JSON: ${error.message}`);
  }

  // Both shapes are accepted: the metadata envelope this project generates,
  // and a bare array, so a hand-assembled list still loads.
  const rows = Array.isArray(parsed) ? parsed : parsed.attendees;
  if (!Array.isArray(rows)) {
    throw new RegistrationsError(`${source} has no "attendees" array`);
  }

  const byEmail = new Map();
  const attendees = [];

  for (const row of rows) {
    const email = normalizeEmail(row?.email);
    if (!email) continue;

    const attendee = Object.freeze({
      name: text(row.name) || 'Attendee',
      email,
      organization: text(row.organization),
      designation: text(row.designation),
      phone: text(row.phone),
      mealPreference: text(row.mealPreference),
    });

    // The generator guarantees uniqueness; first-wins here is belt and braces
    // so a hand-edited file can never make one person two attendees.
    if (byEmail.has(email)) continue;

    byEmail.set(email, attendee);
    attendees.push(attendee);
  }

  return {
    version: Array.isArray(parsed) ? 'unversioned' : parsed.snapshotVersion || 'unversioned',
    generatedAt: Array.isArray(parsed) ? null : parsed.generatedAt || null,
    source,
    attendees,
    byEmail,
  };
}

function load() {
  if (snapshot) return snapshot;

  // An explicit override is honoured exactly. Falling back to the default file
  // when a named path is missing would hide the misconfiguration and quietly
  // serve a different guest list than the one that was asked for.
  const override = process.env.REGISTRATIONS_PATH;
  if (override) {
    const file = path.resolve(override);
    if (!fs.existsSync(file)) {
      throw new RegistrationsError(`Registration snapshot not found at REGISTRATIONS_PATH: ${file}`);
    }
    snapshot = parseSnapshot(fs.readFileSync(file, 'utf8'), path.basename(file));
    return snapshot;
  }

  const tried = [];
  for (const file of candidatePaths()) {
    tried.push(file);
    if (!fs.existsSync(file)) continue;
    snapshot = parseSnapshot(fs.readFileSync(file, 'utf8'), path.basename(file));
    return snapshot;
  }

  throw new RegistrationsError(`Registration snapshot not found. Looked in: ${tried.join(', ')}`);
}

/**
 * Case-insensitive lookup against the frozen dataset.
 *
 * @param {string} rawEmail as typed by the attendee
 * @returns {Object|null} the frozen record, or null when not registered
 */
export function findRegistrationByEmail(rawEmail) {
  const email = normalizeEmail(rawEmail);
  if (!email) return null;
  return load().byEmail.get(email) || null;
}

/** Every registration, in snapshot order. */
export function getAllRegistrations() {
  return load().attendees;
}

/** Unique registered attendees — the denominator for every dashboard figure. */
export function getRegistrationCount() {
  return load().byEmail.size;
}

/** Non-sensitive provenance for the admin dashboard. */
export function getSnapshotInfo() {
  const data = load();
  return {
    version: data.version,
    generatedAt: data.generatedAt,
    total: data.byEmail.size,
  };
}

/**
 * Meal preference groups derived from the data itself.
 *
 * Categories are never hardcoded: whatever the form actually collected is what
 * the dashboard reports, so an unexpected value shows up as its own row rather
 * than being quietly folded into "Normal".
 *
 * @returns {Map<string, string>} group key -> display label
 */
export function getMealCategories() {
  const categories = new Map();
  for (const attendee of getAllRegistrations()) {
    const key = mealKey(attendee.mealPreference);
    if (!key || categories.has(key)) continue;
    categories.set(key, key === 'jain' ? 'Jain' : mealLabel(attendee.mealPreference));
  }
  return categories;
}

/**
 * The subset of a registration that may cross the network to an attendee's
 * browser. Phone number and designation are held back — the desk screen has no
 * use for them, and a public endpoint should hand out the minimum that makes
 * the UI work.
 */
export function publicAttendee(attendee) {
  if (!attendee) return null;
  return {
    name: attendee.name,
    email: attendee.email,
    mealPreference: attendee.mealPreference,
  };
}

/** Test-only: forces the next lookup to re-read from disk. */
export function __resetSnapshotCache() {
  snapshot = null;
}
