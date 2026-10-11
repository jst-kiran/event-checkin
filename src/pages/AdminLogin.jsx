import { useEffect, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { LockKeyhole, Mail } from 'lucide-react'
import DeskLayout, { DeskCard } from '../components/DeskLayout'
import Input from '../components/Input'
import Button from '../components/Button'
import { api } from '../services/api'

export default function AdminLogin() {
  const navigate = useNavigate()
  const location = useLocation()
  const destination = location.state?.from || '/admin'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

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
      setPassword('')
      setLoading(false)
    }
  }

  return (
    <DeskLayout title="Organizer Sign-in" subtitle="Sign in to see registrations and check-ins.">
      <DeskCard>
        <div className="flex flex-col items-center text-center">
          <div className="w-14 h-14 rounded-full bg-purple-50 border border-purple-100/80 flex items-center justify-center text-purple-600 mb-6 shadow-2xs">
            <LockKeyhole className="w-6 h-6 stroke-[1.75]" aria-hidden="true" />
          </div>

          <form onSubmit={handleSubmit} className="w-full flex flex-col gap-5">
            <Input
              label="Email"
              type="email"
              inputMode="email"
              icon={Mail}
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
        </div>
      </DeskCard>
    </DeskLayout>
  )
}
