import { useEffect, useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { api } from '../services/api'

/**
 * Asks the server whether this browser holds a valid session cookie.
 *
 * This decides what to *render*, not what to *permit*. Nothing in the client
 * grants access: a tampered build could force the dashboard shell to paint, and
 * it would sit there empty, because every /api/admin/* route verifies the
 * signed cookie for itself before returning a single row.
 *
 * Because the check runs on mount, a hard refresh of /admin re-verifies against
 * the server rather than trusting anything the page kept in memory.
 */
export default function ProtectedRoute({ children }) {
  const location = useLocation()
  const [state, setState] = useState('checking')

  useEffect(() => {
    let cancelled = false

    api
      .session()
      .then(() => !cancelled && setState('authenticated'))
      .catch(() => !cancelled && setState('unauthenticated'))

    return () => {
      cancelled = true
    }
  }, [])

  if (state === 'checking') {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="flex items-center gap-2 text-slate-500">
          <Loader2 className="w-5 h-5 animate-spin text-brand-600" aria-hidden="true" />
          <span className="text-sm font-medium">Checking session…</span>
        </div>
      </div>
    )
  }

  if (state === 'unauthenticated') {
    // `from` sends the organizer back where they were aiming after login.
    return <Navigate to="/admin/login" replace state={{ from: location.pathname }} />
  }

  return children
}
