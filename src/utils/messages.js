/**
 * Every status the API can return, mapped to what a person actually reads.
 *
 * Centralizing this is what guarantees no raw error text ever reaches a screen
 * at the desk: an unrecognized status falls through to FALLBACK, so even a bug
 * on our side surfaces as a sentence an operator can act on.
 *
 * `joined: true` renders the title and description as one sentence
 * ("Title — description"), which is how the not-found message must read.
 */

const FALLBACK = {
  tone: 'error',
  title: 'Something Went Wrong',
  description: 'Unable to verify right now. Please try again.',
}

const DATA_UNAVAILABLE = {
  tone: 'error',
  title: 'Verification Unavailable',
  description:
    'Registration data could not be loaded right now. Please try again in a moment or contact the event organizers.',
}

const RESULTS = {
  REGISTRATION_VERIFIED: {
    tone: 'success',
    title: 'Registration Verified',
  },
  REGISTRATION_NOT_FOUND: {
    tone: 'error',
    title: 'Registration Not Found',
    description: 'Please check the email address or contact the event organizers.',
    joined: true,
  },
  DUPLICATE_REGISTRATION: {
    tone: 'info',
    title: 'Multiple Registrations Found',
    description:
      'This email appears on more than one registration with different details. Please contact the event organizers.',
  },
  CHECK_IN_UNAVAILABLE: {
    tone: 'error',
    title: 'Check-in Not Saved',
    description: 'The registration was found, but the check-in could not be saved. Please try again.',
  },
  INVALID_EMAIL: {
    tone: 'error',
    title: 'Invalid Email',
    description: 'Please enter a valid email address.',
  },
  EMAIL_REQUIRED: {
    tone: 'error',
    title: 'Email Required',
    description: 'Please enter an email address.',
  },
  RATE_LIMITED: {
    tone: 'error',
    title: 'Too Many Attempts',
    description: 'Please wait a moment and try again.',
  },
  NETWORK_ERROR: {
    tone: 'error',
    title: 'Connection Lost',
    description: 'Check your internet connection and try again.',
  },
  TIMEOUT: {
    tone: 'error',
    title: 'Taking Too Long',
    description: 'The server did not respond in time. Please try again.',
  },
  // A failed data source is never presented as "not registered".
  REGISTRATION_DATA_UNAVAILABLE: DATA_UNAVAILABLE,
  SERVICE_UNAVAILABLE: DATA_UNAVAILABLE,
  INVALID_REQUEST: FALLBACK,
  INTERNAL_ERROR: FALLBACK,
}

export function resultFor(status) {
  return RESULTS[status] || FALLBACK
}

/** The attendee fields shown after a successful match, in order. */
export const ATTENDEE_FIELDS = [
  { key: 'fullName', label: 'Full Name' },
  { key: 'enrollmentNumber', label: 'Enrollment Number' },
  { key: 'semester', label: 'Semester' },
  { key: 'course', label: 'Course' },
  { key: 'specialization', label: 'Specialization' },
]

/** "Checked in at 5:42 PM" / "Already checked in at 5:12 PM (manual)". */
export function checkInLine(checkIn) {
  if (!checkIn) return ''
  const parsed = new Date(checkIn.checkedInAt)
  const when = Number.isNaN(parsed.getTime())
    ? ''
    : ` at ${parsed.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`
  if (checkIn.status === 'CHECKED_IN') return `Checked in${when}.`
  const how = checkIn.method && checkIn.method !== 'Desk' ? ` (${checkIn.method.toLowerCase()})` : ''
  return `Already checked in${when}${how}.`
}
