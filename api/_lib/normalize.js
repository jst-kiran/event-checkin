/**
 * Normalization primitives shared by the API, the snapshot generator and the
 * tests.
 *
 * Two independent problems are solved here:
 *
 *   1. Email identity. An attendee who registered as "  John@Example.COM "
 *      must match the person typing "john@example.com" at the desk. Every
 *      lookup, every duplicate check and every unique count in this codebase
 *      goes through normalizeEmail() so there is exactly one notion of "the
 *      same person".
 *
 *   2. Header identity. The Registrations tab is a Google Form export whose
 *      column titles are written by a human ("Email Address", "E-mail",
 *      "Organization / University"). Column *positions* are never assumed;
 *      headers are matched by meaning instead.
 */

/** Longest email we will look at. RFC 5321 caps the whole address at 254. */
export const MAX_EMAIL_LENGTH = 254;

/**
 * Deliberately permissive: this rejects obvious typos and junk without trying
 * to out-guess the mail system on exotic-but-legal addresses. The frozen
 * snapshot, not this pattern, decides who is actually registered.
 */
const EMAIL_PATTERN = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]{2,}$/;

/** "  John@Example.COM " -> "john@example.com" */
export function normalizeEmail(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim().toLowerCase();
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

/** Collapses a cell to a trimmed single-line string. */
export function text(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/\s+/g, ' ').trim();
}

/** "Organization / University " -> "organizationuniversity" */
export function normalizeHeader(header) {
  return String(header ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Canonical field -> header spellings we accept, most specific first.
 *
 * Order matters twice over. Within a field, earlier aliases win, so a sheet
 * carrying both "Email Address" and "Email" resolves to whichever is listed
 * first here. Across fields, a column can only be claimed once, which stops
 * "Organization/University" from also being read as the university column.
 */
const HEADER_ALIASES = {
  timestamp: ['timestamp', 'time', 'datetime', 'date', 'submittedat', 'checkintime'],
  email: ['emailaddress', 'email', 'emailid', 'mailid', 'youremail', 'mail'],
  name: ['fullname', 'name', 'attendeename', 'yourname', 'participantname'],
  organization: [
    'organizationuniversity',
    'organisationuniversity',
    'organization',
    'organisation',
    'university',
    'college',
    'company',
    'institution',
    'institute',
    'org',
  ],
  designation: ['designation', 'jobtitle', 'role', 'title', 'position'],
  phone: [
    'phonenumber',
    'phone',
    'mobilenumber',
    'mobile',
    'whatsappnumber',
    'contactnumber',
    'contact',
  ],
  mealPreference: [
    'mealpreference',
    'meal',
    'foodpreference',
    'food',
    'lunchpreference',
    'dietarypreference',
    'dietaryrequirement',
    'dietary',
    'diet',
  ],
  checkInStatus: ['checkinstatus', 'checkedin', 'entrystatus'],
  lunchStatus: ['lunchstatus', 'claimstatus', 'claimed'],

  // ProjectUploads tab. Listed after the check-in/lunch status fields so a
  // column literally titled "Status" is only claimed here once those more
  // specific spellings have had their chance.
  teamName: ['teamname', 'team'],
  driveLink: ['googledrivelink', 'drivelink', 'driveurl', 'projectlink', 'submissionlink', 'link'],
  submissionStatus: ['submissionstatus', 'status'],

  // Teams tab.
  memberName: ['membername', 'member', 'participantname'],
  memberEmail: ['memberemail'],
  memberOrganization: ['memberorganization', 'memberorg'],
  teamSize: ['teamsize', 'size'],
  ignoredMembers: ['ignoredmembers', 'ignored'],

  // Settings tab: a plain key/value store.
  key: ['key', 'setting', 'name'],
  value: ['value', 'settingvalue'],
};

/**
 * Consulted only when no alias matched exactly, so an unusual header like
 * "Preferred Meal (Veg/Jain)" is still found.
 */
const HEADER_CONTAINS = {
  email: 'email',
  mealPreference: 'meal',
  phone: 'phone',
  timestamp: 'timestamp',
};

/**
 * Maps a header row to zero-based column indexes.
 *
 * @param {Array<*>} headers the first row of a sheet
 * @returns {Object<string, number>} canonical field -> column index; fields
 *   with no matching column are simply absent
 */
export function mapHeaders(headers) {
  const normalized = (headers || []).map(normalizeHeader);
  const map = {};
  const taken = new Set();

  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    outer: for (const alias of aliases) {
      for (let i = 0; i < normalized.length; i++) {
        if (normalized[i] === alias && !taken.has(i)) {
          map[field] = i;
          taken.add(i);
          break outer;
        }
      }
    }
  }

  for (const [field, needle] of Object.entries(HEADER_CONTAINS)) {
    if (map[field] !== undefined) continue;
    for (let i = 0; i < normalized.length; i++) {
      if (!taken.has(i) && normalized[i].includes(needle)) {
        map[field] = i;
        taken.add(i);
        break;
      }
    }
  }

  return map;
}

/** Reads one mapped cell out of a row, tolerating short rows. */
export function cellFor(row, map, field) {
  const index = map[field];
  if (index === undefined) return '';
  return text(row[index]);
}

/**
 * Groups a free-text meal preference into one of the two categories the
 * kitchen actually distinguishes.
 *
 * The form collects prose — "Jain Veg Meal", "Veg Meal" — but the lunch
 * counter only ever needs to know Jain or not. Anything mentioning jain is
 * Jain; everything else, including a blank cell, is Veg. Keeping it to two
 * groups is deliberate: the counts have to sum to the number of claims, and a
 * third "unspecified" slice would be a category nobody can serve.
 *
 * @returns {'jain'|'veg'}
 */
export function mealGroup(meal) {
  return text(meal).toLowerCase().includes('jain') ? 'jain' : 'veg';
}

/** Display label for a meal group. */
export function mealGroupLabel(group) {
  return group === 'jain' ? 'Jain' : 'Veg';
}

/**
 * Identity key for matching a typed name against a checked-in attendee.
 *
 * Used only by the team randomizer's ignore list, where an organizer types
 * names by hand. "  RAHUL   patel " and "Rahul Patel" have to land on the same
 * person, so case, padding and repeated inner spaces are all discarded.
 */
export function normalizeName(name) {
  return text(name).toLowerCase();
}

