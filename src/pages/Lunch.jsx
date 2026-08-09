import { useEffect, useRef } from 'react'
import { UtensilsCrossed } from 'lucide-react'
import DeskLayout, { DeskCard } from '../components/DeskLayout'
import Input from '../components/Input'
import Button from '../components/Button'
import StatusPanel from '../components/StatusPanel'
import useVerification from '../hooks/useVerification'
import { api } from '../services/api'
import { resultFor, showsName, mealLabel } from '../utils/messages'

export default function Lunch() {
  const { email, setEmail, phase, status, attendee, inlineError, verify, reset, isFormVisible } =
    useVerification(api.claimLunch)

  const inputRef = useRef(null)

  useEffect(() => {
    if (isFormVisible) inputRef.current?.focus()
  }, [isFormVisible])

  const result = status ? resultFor(status) : null
  const approved = status === 'LUNCH_APPROVED'

  return (
    <DeskLayout>
      <DeskCard>
        {isFormVisible ? (
          <>
            <h1 className="text-2xl font-bold text-slate-900">Lunch claim</h1>
            <p className="text-slate-500 text-sm mt-1.5 mb-6">
              Enter your registered email address to collect your meal.
            </p>

            <form onSubmit={verify} className="flex flex-col gap-5">
              <Input
                ref={inputRef}
                label="Registered email"
                type="email"
                inputMode="email"
                placeholder="you@example.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                error={inlineError}
                disabled={phase === 'loading'}
                maxLength={254}
              />
              <Button
                type="submit"
                icon={UtensilsCrossed}
                loading={phase === 'loading'}
                loadingLabel="Verifying…"
                disabled={!email.trim()}
              >
                CLAIM LUNCH
              </Button>
            </form>
          </>
        ) : (
          <div className="flex flex-col gap-6">
            <StatusPanel
              tone={result.tone}
              title={result.title}
              name={showsName(status) ? attendee?.name : undefined}
              description={result.description}
              extra={
                // The meal preference is the one thing the counter staff needs
                // to read, so it gets its own high-contrast row rather than
                // being buried in the description.
                approved && (
                  <div className="flex items-center justify-between gap-3 px-4 py-3.5 rounded-2xl bg-brand-50 border border-brand-100">
                    <span className="text-xs font-semibold tracking-[0.15em] text-brand-700">
                      PREFERENCE
                    </span>
                    <span className="font-bold text-brand-900 text-right">
                      {mealLabel(attendee?.mealPreference)}
                    </span>
                  </div>
                )
              }
            />
            {/* Same reasoning as check-in: a successful claim is the end of
                this attendee's journey through their own device, so there is no
                reset. A failed one still needs a retry. */}
            {!approved && (
              <Button variant="secondary" onClick={reset}>
                TRY AGAIN
              </Button>
            )}
          </div>
        )}
      </DeskCard>
    </DeskLayout>
  )
}
