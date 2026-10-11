import { useEffect, useRef } from 'react'
import { ScanLine, Mail, RotateCcw } from 'lucide-react'
import DeskLayout, { DeskCard } from '../components/DeskLayout'
import Input from '../components/Input'
import Button from '../components/Button'
import StatusPanel from '../components/StatusPanel'
import useVerification from '../hooks/useVerification'
import { api } from '../services/api'
import { resultFor, ATTENDEE_FIELDS, checkInLine } from '../utils/messages'

/**
 * The check-in desk — served at / and /checkin.
 *
 * An organizer enters an attendee's email: if it is in the registration sheet,
 * the details are shown and the person is checked in (once — a second scan
 * says when they were checked in). The registration sheet itself is only read.
 */
export default function CheckIn() {
  const { email, setEmail, phase, status, attendee, checkIn, inlineError, verify, reset, isFormVisible } =
    useVerification(api.verify)

  const inputRef = useRef(null)

  // Focus on first load and again every time "Verify another attendee" brings
  // the form back, so the next email can be typed straight away.
  useEffect(() => {
    if (isFormVisible) inputRef.current?.focus()
  }, [isFormVisible])

  const result = status ? resultFor(status) : null
  const isVerified = status === 'REGISTRATION_VERIFIED' && attendee

  return (
    <DeskLayout
      title="Registration Verification"
      subtitle="Enter the attendee's registered email address to verify their registration and check them in."
    >
      <DeskCard>
        {isFormVisible ? (
          <div className="flex flex-col items-center text-center">
            {/* Circular Email Icon Container */}
            <div className="w-14 h-14 rounded-full bg-purple-50 border border-purple-100/80 flex items-center justify-center text-purple-600 mb-6 shadow-2xs">
              <Mail className="w-6 h-6 stroke-[1.75]" aria-hidden="true" />
            </div>

            <form onSubmit={verify} className="w-full flex flex-col gap-5" noValidate>
              <Input
                ref={inputRef}
                label="REGISTERED EMAIL"
                type="email"
                inputMode="email"
                icon={Mail}
                placeholder="you@example.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                error={inlineError}
                disabled={phase === 'loading'}
                maxLength={254}
              />
              <Button
                type="submit"
                icon={ScanLine}
                loading={phase === 'loading'}
                loadingLabel="Verifying…"
                disabled={!email.trim()}
              >
                VERIFY &amp; CHECK IN
              </Button>
            </form>
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            <StatusPanel
              tone={isVerified && checkIn?.status === 'ALREADY_CHECKED_IN' ? 'info' : result.tone}
              title={result.title}
              description={isVerified ? checkInLine(checkIn) : result.description}
              joined={result.joined}
            />

            {isVerified && (
              <dl className="w-full rounded-2xl border border-purple-100 bg-purple-50/30 divide-y divide-purple-100/80 text-left">
                {ATTENDEE_FIELDS.map(({ key, label }) => (
                  <div key={key} className="px-4 py-3 flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
                    <dt className="text-[11px] font-bold tracking-[0.15em] text-slate-500 uppercase shrink-0">
                      {label}
                    </dt>
                    <dd
                      className={`text-sm sm:text-right break-words ${
                        attendee[key] ? 'font-semibold text-slate-900' : 'italic text-slate-400'
                      }`}
                    >
                      {attendee[key] || 'Not provided'}
                    </dd>
                  </div>
                ))}
              </dl>
            )}

            <Button variant="secondary" icon={RotateCcw} onClick={reset}>
              VERIFY ANOTHER ATTENDEE
            </Button>
          </div>
        )}
      </DeskCard>
    </DeskLayout>
  )
}
