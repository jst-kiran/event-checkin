/**
 * Front-end configuration.
 *
 * Everything here is public by definition — it ships inside the JavaScript
 * bundle. No secret may ever be added to this file or read from a VITE_
 * variable; the Google credentials, admin password and session secret stay in
 * the serverless functions and are never exposed here.
 */

/**
 * The event's e-books / resources link, shown after a successful check-in.
 *
 * Set VITE_EBOOKS_URL in .env locally and in Vercel for production. Until a
 * real URL is supplied the button renders in a disabled state rather than
 * linking somewhere broken — a dead link at an event desk is worse than an
 * honest "coming soon".
 */
const RAW_EBOOKS_URL = (import.meta.env.VITE_EBOOKS_URL || '').trim()

/** Guards against the placeholder being deployed as if it were a real link. */
function isUsableUrl(value) {
  if (!value || value.includes('TO_BE_PROVIDED')) return false
  return /^https?:\/\//i.test(value)
}

export const EBOOKS_URL = isUsableUrl(RAW_EBOOKS_URL) ? RAW_EBOOKS_URL : ''
