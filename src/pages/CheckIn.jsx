import { useEffect, useRef } from 'react'
import { ScanLine } from 'lucide-react'
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

  // After a reset the operator's next action is always to type an email, so the
  // field takes focus itself — one less tap per attendee, all day.
  useEffect(() => {
    if (isFormVisible) inputRef.current?.focus()
  }, [isFormVisible])

  const result = status ? resultFor(status) : null
  const isDone = status === 'CHECKED_IN' || status === 'ALREADY_CHECKED_IN'

  return (
    <DeskLayout>
      <DeskCard>
        {isFormVisible ? (
          <>
            <h1 className="text-2xl font-bold text-slate-900">Event check-in</h1>
            <p className="text-slate-500 text-sm mt-1.5 mb-6">
              Enter your registered email address to check in.
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
                icon={ScanLine}
                loading={phase === 'loading'}
                loadingLabel="Verifying…"
                disabled={!email.trim()}
              >
                VERIFY &amp; CHECK-IN
              </Button>
            </form>
          </>
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

            {/* A checked-in attendee is finished — the next thing they want is
                the resources, not a reset for somebody else. Everyone scans the
                check-in QR on their own device.

                An unsuccessful attempt is different: a mistyped address has to
                be recoverable, so the error states keep a retry. */}
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
