import { useCallback, useEffect, useState } from 'react'
import {
  Users,
  CheckCircle2,
  Clock,
  UtensilsCrossed,
  RefreshCw,
  AlertTriangle,
} from 'lucide-react'
import AdminLayout from '../components/AdminLayout'
import StatCard from '../components/StatCard'
import CheckInTable from '../components/CheckInTable'
import { api } from '../services/api'

const EMPTY_STATS = {
  registered: 0,
  checkedIn: 0,
  lunchClaimed: 0,
  yetToCheckIn: 0,
  lunchByPreference: [],
}

export default function AdminDashboard() {
  const [stats, setStats] = useState(EMPTY_STATS)
  const [checkIns, setCheckIns] = useState([])
  const [snapshot, setSnapshot] = useState(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [updatedAt, setUpdatedAt] = useState(null)

  const load = useCallback(async () => {
    setRefreshing(true)
    try {
      const [statsResult, checkInsResult] = await Promise.all([api.stats(), api.checkIns()])
      setStats(statsResult.stats)
      setSnapshot(statsResult.snapshot)
      setCheckIns(checkInsResult.checkIns)
      setUpdatedAt(new Date())
      setError('')
    } catch {
      setError('Could not load live data from Google Sheets. Try refreshing.')
    } finally {
      setRefreshing(false)
      setLoading(false)
    }
  }, [])

  // Loaded once on open, then only when asked. Nothing polls in the background:
  // an unattended dashboard would otherwise burn the Sheets read quota that the
  // check-in desk depends on.
  useEffect(() => {
    load()
  }, [load])

  const percent = (part) =>
    stats.registered ? `${Math.round((part / stats.registered) * 100)}% of registered` : '—'

  return (
    <AdminLayout
      title="Dashboard"
      actions={
        <>
          {updatedAt && (
            <span className="text-xs text-slate-400">
              Updated {updatedAt.toLocaleTimeString(undefined, { timeStyle: 'short' })}
            </span>
          )}
          <button
            onClick={load}
            disabled={refreshing}
            className="inline-flex items-center gap-2 bg-brand-600 hover:bg-brand-700 text-white font-medium text-sm px-4 py-2 rounded-xl transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} aria-hidden="true" />
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </>
      }
    >
      {error && (
        <div className="mb-5 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <p className="text-slate-500 text-sm">Loading live data…</p>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <StatCard
              icon={Users}
              label="Registered"
              value={stats.registered}
              sublabel={
                snapshot?.version && snapshot.version !== 'placeholder'
                  ? `Snapshot ${snapshot.version}`
                  : 'Snapshot not generated'
              }
              accent="brand"
            />
            <StatCard
              icon={CheckCircle2}
              label="Checked in"
              value={stats.checkedIn}
              sublabel={percent(stats.checkedIn)}
              accent="emerald"
            />
            <StatCard
              icon={Clock}
              label="Yet to check in"
              value={stats.yetToCheckIn}
              sublabel={percent(stats.yetToCheckIn)}
              accent="amber"
            />
            <StatCard
              icon={UtensilsCrossed}
              label="Lunch claimed"
              value={stats.lunchClaimed}
              sublabel={percent(stats.lunchClaimed)}
              accent="blue"
            />
          </div>

          <div className="bg-white border border-slate-100 rounded-2xl shadow-card p-5 mb-6">
            <h2 className="font-bold text-slate-900 mb-4">Lunch claimed by preference</h2>

            {stats.lunchByPreference.length === 0 ? (
              <p className="text-sm text-slate-400">No lunch claims yet.</p>
            ) : (
              <div className="flex flex-wrap gap-x-10 gap-y-4">
                {/* Categories come from the registration data, so an unexpected
                    preference shows up here instead of being folded away. */}
                {stats.lunchByPreference.map((entry) => (
                  <div key={entry.label}>
                    <p className="text-xs uppercase tracking-wide text-slate-400 font-medium">
                      {entry.label}
                    </p>
                    <p className="text-2xl font-bold text-slate-900 mt-0.5 tabular-nums">
                      {entry.count}
                    </p>
                  </div>
                ))}
                <div className="border-l border-slate-100 pl-10">
                  <p className="text-xs uppercase tracking-wide text-slate-400 font-medium">
                    Total claimed
                  </p>
                  <p className="text-2xl font-bold text-brand-700 mt-0.5 tabular-nums">
                    {stats.lunchClaimed}
                  </p>
                </div>
              </div>
            )}
          </div>

          <CheckInTable checkIns={checkIns} />
        </>
      )}
    </AdminLayout>
  )
}
