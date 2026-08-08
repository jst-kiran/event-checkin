/**
 * Every status the API can return, mapped to what a person actually reads.
 *
 * Centralizing this is what guarantees no raw error text ever reaches a screen
 * at the desk: an unrecognized status falls through to FALLBACK, so even a bug
 * on our side surfaces as a sentence an operator can act on.
 */

const FALLBACK = {
  tone: 'error',
  title: 'SOMETHING WENT WRONG',
  description: 'Unable to verify right now. Please try again.',
}

const RESULTS = {
  CHECKED_IN: {
    tone: 'success',
    title: 'ENTRY APPROVED',
    description: 'Checked in successfully. Enjoy the event!',
  },
  ALREADY_CHECKED_IN: {
    tone: 'info',
    title: 'ALREADY CHECKED IN',
    description: 'This email was already checked in.',
  },
  LUNCH_APPROVED: {
    tone: 'success',
    title: 'LUNCH APPROVED',
    description: 'Enjoy your meal!',
  },
  ALREADY_CLAIMED: {
    tone: 'info',
    title: 'ALREADY CLAIMED',
    description: 'Lunch has already been collected for this email.',
  },
  PLEASE_CHECK_IN_FIRST: {
    tone: 'error',
    title: 'CHECK IN FIRST',
    description: 'Please check in at the entry desk before collecting lunch.',
  },
  REGISTRATION_NOT_FOUND: {
    tone: 'error',
    title: 'REGISTRATION NOT FOUND',
    description: 'Please check your registered email, or ask an organizer for help.',
  },
  INVALID_EMAIL: {
    tone: 'error',
    title: 'INVALID EMAIL',
    description: 'Please enter a valid email address.',
  },
  RATE_LIMITED: {
    tone: 'error',
    title: 'TOO MANY ATTEMPTS',
    description: 'Please wait a moment and try again.',
  },
  NETWORK_ERROR: {
    tone: 'error',
    title: 'CONNECTION LOST',
    description: 'Check your internet connection and try again.',
  },
  TIMEOUT: {
    tone: 'error',
    title: 'TAKING TOO LONG',
    description: 'The server did not respond in time. Please try again.',
  },
  SERVICE_UNAVAILABLE: {
    tone: 'error',
    title: 'TEMPORARILY UNAVAILABLE',
    description: 'Unable to verify right now. Please try again in a moment.',
  },
  INVALID_REQUEST: FALLBACK,
  INTERNAL_ERROR: FALLBACK,
}

export function resultFor(status) {
  return RESULTS[status] || FALLBACK
}

/** Statuses where the API returns an attendee and showing the name helps. */
export function showsName(status) {
  return (
    status === 'CHECKED_IN' ||
    status === 'ALREADY_CHECKED_IN' ||
    status === 'LUNCH_APPROVED' ||
    status === 'ALREADY_CLAIMED' ||
    status === 'PLEASE_CHECK_IN_FIRST'
  )
}

/** "jain veg meal" -> "Jain Veg Meal" */
export function mealLabel(meal) {
  const value = String(meal || '').trim()
  if (!value) return 'NOT SPECIFIED'
  return value.replace(/\b[a-z]/g, (c) => c.toUpperCase())
}

/** Renders the offset-ISO timestamps the API writes, in the viewer's locale. */
export function formatDateTime(value) {
  if (!value) return '—'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime())
    ? String(value)
    : parsed.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}
