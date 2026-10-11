/**
 * Normalization primitives shared by the API, the registration-sheet check
 * script and the tests.
 *
 * Two independent problems are solved here:
 *
 *   1. Email identity. An attendee who registered as "  John@Example.COM "
 *      must match the person typing "john@example.com" at the desk. Every
 *      lookup and every duplicate check goes through normalizeEmail() so there
 *      is exactly one notion of "the same person".
 *
 *   2. Header identity. The registration tab is a Google Form export whose
 *      column titles are written by a human and often carry stray spaces,
 *      non-breaking spaces or different capitalization ("Enrollment Number ").
 *      normalizeHeader() reduces a title to its letters and digits so those
 *      differences never matter. Column *positions* are never assumed.
 */

/** Longest email we will look at. RFC 5321 caps the whole address at 254. */
export const MAX_EMAIL_LENGTH = 254;

/**
 * Deliberately permissive: this rejects obvious typos and junk without trying
 * to out-guess the mail system on exotic-but-legal addresses. The registration
 * sheet, not this pattern, decides who is actually registered.
 */
const EMAIL_PATTERN = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]{2,}$/;

/**
 * Invisible characters that survive copy-paste from chat apps and spreadsheets
 * but are not whitespace to String.prototype.trim(): zero-width space/joiners,
 * word joiner, and a stray byte-order mark.
 */
const INVISIBLE = /[​-‍⁠﻿]/g;

/** "  John@Example.COM " -> "john@example.com" */
export function normalizeEmail(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(INVISIBLE, '').trim().toLowerCase();
}

/** True when `email` is already normalized and plausibly deliverable. */
export function isValidEmail(email) {
  return (
    typeof email === 'string' &&
    email.length > 0 &&
    email.length <= MAX_EMAIL_LENGTH &&
    EMAIL_PATTERN.test(email)
  );
}

/**
 * Collapses a cell to a trimmed single-line string. JavaScript's \s already
 * covers non-breaking and other Unicode spaces.
 */
export function text(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(INVISIBLE, '').replace(/\s+/g, ' ').trim();
}

/** "E-mail address " -> "emailaddress", "Enrollment Number " -> "enrollmentnumber" */
export function normalizeHeader(header) {
  return String(header ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}
