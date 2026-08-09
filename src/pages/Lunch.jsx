import { useEffect, useRef } from 'react'
import { UtensilsCrossed, Mail } from 'lucide-react'
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
    <DeskLayout
      title="Lunch Claim"
      subtitle="Enter your registered email address to collect your meal."
    >
      <DeskCard>
        {isFormVisible ? (
          <div className="flex flex-col items-center text-center">
            {/* Circular Utensils Icon Container */}
            <div className="w-14 h-14 rounded-full bg-purple-50 border border-purple-100/80 flex items-center justify-center text-purple-600 mb-6 shadow-2xs">
              <UtensilsCrossed className="w-6 h-6 stroke-[1.75]" aria-hidden="true" />
            </div>

            <form onSubmit={verify} className="w-full flex flex-col gap-5">
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
                icon={UtensilsCrossed}
                loading={phase === 'loading'}
                loadingLabel="Verifying…"
                disabled={!email.trim()}
              >
                CLAIM LUNCH
              </Button>
            </form>
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            <StatusPanel
              tone={result.tone}
              title={result.title}
              name={showsName(status) ? attendee?.name : undefined}
              description={result.description}
              extra={
                approved && (
                  <div className="flex items-center justify-between gap-3 px-4 py-3.5 rounded-2xl bg-purple-50 border border-purple-100/80">
                    <span className="text-xs font-bold tracking-[0.15em] text-purple-700 uppercase">
                      PREFERENCE
                    </span>
                    <span className="font-bold text-purple-900 text-right">
                      {mealLabel(attendee?.mealPreference)}
                    </span>
                  </div>
                )
              }
            />
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
