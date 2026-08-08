import { useEffect, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { LockKeyhole } from 'lucide-react'
import DeskLayout, { DeskCard } from '../components/DeskLayout'
import Input from '../components/Input'
import Button from '../components/Button'
import { api } from '../services/api'

/**
 * Credentials go to /api/admin/login and are checked against environment
 * variables that exist only on the server. Nothing about the admin account —
 * not the email, not a hash, not a hint — is present in this bundle.
 */
export default function AdminLogin() {
  const navigate = useNavigate()
  const location = useLocation()
  const destination = location.state?.from || '/admin'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Skip the form when a valid session cookie is already present, so returning
  // to /admin/login mid-event does not force a pointless re-login.
  useEffect(() => {
    let cancelled = false
    api
      .session()
      .then(() => !cancelled && navigate(destination, { replace: true }))
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [navigate, destination])

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (!email.trim() || !password || loading) return

    setLoading(true)
    setError('')

    try {
      await api.login(email.trim(), password)
      navigate(destination, { replace: true })
    } catch (err) {
      setError(
        err.status === 'INVALID_CREDENTIALS'
          ? 'Invalid email or password.'
          : err.status === 'NOT_CONFIGURED'
            ? 'Admin sign-in is not configured on the server.'
            : err.status === 'RATE_LIMITED'
              ? 'Too many attempts. Please wait a few minutes.'
              : 'Unable to sign in right now. Please try again.'
      )
      // Never leave a password sitting in a field after a failure.
      setPassword('')
      setLoading(false)
    }
  }

  return (
    <DeskLayout>
      <DeskCard>
        <div className="flex items-center gap-3 mb-6">
          <div className="w-11 h-11 rounded-2xl bg-brand-50 flex items-center justify-center">
            <LockKeyhole className="w-5 h-5 text-brand-600" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">Organizer sign-in</h1>
            <p className="text-slate-500 text-sm">Access the event dashboard.</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          <Input
            label="Email"
            type="email"
            inputMode="email"
            autoComplete="username"
            placeholder="organizer@example.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={loading}
            maxLength={254}
            autoFocus
          />
          <Input
            label="Password"
            type="password"
            autoComplete="current-password"
            placeholder="••••••••"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={loading}
            error={error}
            maxLength={512}
          />
          <Button
            type="submit"
            loading={loading}
            loadingLabel="Signing in…"
            disabled={!email.trim() || !password}
          >
            SIGN IN
          </Button>
        </form>
      </DeskCard>
    </DeskLayout>
  )
}
