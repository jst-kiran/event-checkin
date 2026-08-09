import { useEffect, useRef } from 'react'
import { ScanLine, Mail } from 'lucide-react'
import DeskLayout, { DeskCard } from '../components/DeskLayout'
import Input from '../components/Input'
import Button from '../components/Button'
import StatusPanel from '../components/StatusPanel'
import EbooksButton from '../components/EbooksButton'
import useVerification from '../hooks/useVerification'
import { api } from '../services/api'
import { resultFor, showsName } from '../utils/messages'

export default function CheckIn() {
  const { email, setEmail, phase, status, attendee, inlineError, verify, reset, isFormVisible } =
    useVerification(api.checkIn)

  const inputRef = useRef(null)

  useEffect(() => {
    if (isFormVisible) inputRef.current?.focus()
  }, [isFormVisible])

  const result = status ? resultFor(status) : null
  const isDone = status === 'CHECKED_IN' || status === 'ALREADY_CHECKED_IN'

  return (
    <DeskLayout
      title="Event Check-in"
      subtitle="Enter your registered email address to verify your registration and check in."
    >
      <DeskCard>
        {isFormVisible ? (
          <div className="flex flex-col items-center text-center">
            {/* Circular Email Icon Container */}
            <div className="w-14 h-14 rounded-full bg-purple-50 border border-purple-100/80 flex items-center justify-center text-purple-600 mb-6 shadow-2xs">
              <Mail className="w-6 h-6 stroke-[1.75]" aria-hidden="true" />
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
                icon={ScanLine}
                loading={phase === 'loading'}
                loadingLabel="Verifying…"
                disabled={!email.trim()}
              >
                VERIFY &amp; CHECK-IN
              </Button>
            </form>
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            <StatusPanel
              tone={result.tone}
              title={result.title}
              name={
                showsName(status) && attendee?.name
                  ? status === 'CHECKED_IN'
                    ? `Welcome, ${attendee.name}!`
                    : attendee.name
                  : undefined
              }
              description={result.description}
            />

            {isDone ? (
              <EbooksButton />
            ) : (
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
