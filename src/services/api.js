/**
 * The browser's entire backend surface.
 *
 * Every call is same-origin to /api. There is no Google endpoint, no key, no
 * spreadsheet ID and no credential anywhere in this bundle — the serverless
 * functions hold all of it, and this file only knows their paths.
 */

/**
 * Carries the machine-readable `status` from the API so callers can branch on
 * meaning instead of on a message string.
 */
export class ApiError extends Error {
  constructor(httpStatus, payload) {
    super(payload?.message || payload?.status || 'Request failed')
    this.name = 'ApiError'
    this.httpStatus = httpStatus
    this.status = payload?.status || 'SERVICE_UNAVAILABLE'
    this.payload = payload || {}
  }
}

/** Slow enough for a cold lambda plus a Google round trip, short enough that a
 *  wedged request does not hold up the queue at the desk. */
const TIMEOUT_MS = 25000

async function request(path, { method = 'GET', body } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  let response
  try {
    response = await fetch(path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      credentials: 'same-origin', // carries the HttpOnly admin session cookie
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    })
  } catch (error) {
    // Offline, DNS failure, blocked request, timeout — all resolve to one safe
    // status rather than a raw browser error on a screen at the desk.
    throw new ApiError(0, {
      status: error.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK_ERROR',
    })
  } finally {
    clearTimeout(timer)
  }

  let payload = null
  try {
    payload = await response.json()
  } catch {
    payload = null // A non-JSON body is a platform error page, not a result.
  }

  if (!response.ok) throw new ApiError(response.status, payload)
  return payload
}

export const api = {
  /** Desk: verify a registration and check the person in. */
  verify: (email) => request('/api/verify', { method: 'POST', body: { email } }),

  login: (email, password) =>
    request('/api/admin/login', { method: 'POST', body: { email, password } }),
  logout: () => request('/api/admin/logout', { method: 'POST' }),
  session: () => request('/api/admin/session'),

  /** Every registration with check-in status, plus walk-ins and sheet health. */
  attendees: () => request('/api/admin/attendees'),
  /** Manually check in someone who is in the registration sheet. */
  manualCheckIn: (email) =>
    request('/api/admin/attendees', { method: 'POST', body: { action: 'check-in', email } }),
  /** Check in someone who is not in the registration sheet. */
  addWalkIn: (details) =>
    request('/api/admin/attendees', { method: 'POST', body: { action: 'walk-in', ...details } }),
}
