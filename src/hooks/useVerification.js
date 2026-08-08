import { useCallback, useRef, useState } from 'react'

/**
 * The shared state machine behind /checkin and /lunch.
 *
 * Both screens do exactly the same thing — take an email, call one endpoint,
 * land on a terminal status — so the difference between them is a function
 * reference and some wording, not a second implementation.
 *
 * @param {(email: string) => Promise<Object>} submit the api.* call to run
 */

// Mirrors the server's check so an obvious typo costs no round trip at a busy
// desk. The frozen snapshot, not this pattern, decides who is registered.
const EMAIL_PATTERN = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]{2,}$/

export default function useVerification(submit) {
  const [email, setEmailState] = useState('')
  const [phase, setPhase] = useState('idle') // idle | loading | done
  const [status, setStatus] = useState(null)
  const [attendee, setAttendee] = useState(null)
  const [inlineError, setInlineError] = useState('')

  // Guards the one failure mode that actually matters here: a second submit
  // slipping through before React has re-rendered the disabled button, which
  // would put two identical requests in flight from one device.
  const busy = useRef(false)

  const verify = useCallback(
    async (event) => {
      if (event) event.preventDefault()
      if (busy.current) return

      const value = email.trim()
      if (!value) return

      if (!EMAIL_PATTERN.test(value)) {
        setInlineError('Please enter a valid email address.')
        return
      }

      busy.current = true
      setInlineError('')
      setPhase('loading')

      try {
        const data = await submit(value)
        setStatus(data.status)
        setAttendee(data.attendee || null)
      } catch (error) {
        // ApiError carries a safe status; anything else is a bug on our side
        // and still resolves to a message rather than a stack trace.
        setStatus(error.status || 'SERVICE_UNAVAILABLE')
        setAttendee(error.payload?.attendee || null)
      } finally {
        busy.current = false
        setPhase('done')
      }
    },
    [email, submit]
  )

  const reset = useCallback(() => {
    setEmailState('')
    setPhase('idle')
    setStatus(null)
    setAttendee(null)
    setInlineError('')
  }, [])

  const setEmail = useCallback((value) => {
    setEmailState(value)
    setInlineError((current) => (current ? '' : current))
  }, [])

  return {
    email,
    setEmail,
    phase,
    status,
    attendee,
    inlineError,
    verify,
    reset,
    isFormVisible: phase !== 'done',
  }
}
