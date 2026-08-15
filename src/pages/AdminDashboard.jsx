import { useCallback, useEffect, useRef, useState } from 'react'
import { Users, CheckCircle2, Clock, RefreshCw, AlertTriangle } from 'lucide-react'
import AdminLayout from '../components/AdminLayout'
import StatCard from '../components/StatCard'
import CheckInTable from '../components/CheckInTable'
import LunchDonut from '../components/LunchDonut'
import ProjectUploads from '../components/ProjectUploads'
import { api } from '../services/api'
import { ADMIN_REFRESH_INTERVAL_MS } from '../config'

const EMPTY_STATS = {
  registered: 0,
  checkedIn: 0,
  lunchClaimed: 0,
  lunchNotClaimed: 0,
  yetToCheckIn: 0,
  lunchJain: 0,
  lunchVeg: 0,
}

const EMPTY_PROJECT_SETTINGS = { deadline: null, deadlineLocal: '', isClosed: false }

export default function AdminDashboard() {
  const [stats, setStats] = useState(EMPTY_STATS)
  const [checkIns, setCheckIns] = useState([])
  const [submissions, setSubmissions] = useState([])
  const [projectSettings, setProjectSettings] = useState(EMPTY_PROJECT_SETTINGS)
  const [savingDeadline, setSavingDeadline] = useState(false)
  const [deadlineError, setDeadlineError] = useState('')
  const [snapshot, setSnapshot] = useState(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [updatedAt, setUpdatedAt] = useState(null)

  // Guards against a slow request overlapping the next tick. Without it, a
  // response that takes longer than the interval would stack up requests and
  // burn Google read quota the check-in desk needs.
  const inFlight = useRef(false)

  const load = useCallback(async () => {
    if (inFlight.current) return
    inFlight.current = true
    setRefreshing(true)

    try {
      // Issued together on purpose: the server caches sheet reads for a few
      // seconds, so whichever of these lands first warms the tabs for the
      // others and the whole cycle costs one read per sheet.
      const [statsResult, checkInsResult, projectsResult, projectSettingsResult] = await Promise.all([
        api.stats(),
        api.checkIns(),
        api.projects(),
        api.getProjectSettings(),
      ])

      setStats(statsResult.stats)
      setSnapshot(statsResult.snapshot)
      setCheckIns(checkInsResult.checkIns)
      setSubmissions(projectsResult.submissions)
      setProjectSettings({
        deadline: projectSettingsResult.deadline,
        deadlineLocal: projectSettingsResult.deadlineLocal,
        isClosed: projectSettingsResult.isClosed,
      })
      setUpdatedAt(new Date())
      setError('')
    } catch {
      // The previous figures stay on screen rather than blanking the dashboard
      // over one failed poll; the banner says they may be stale.
      setError('Could not load live data from Google Sheets. Retrying automatically.')
    } finally {
      inFlight.current = false
      setRefreshing(false)
      setLoading(false)
    }
  }, [])

  const saveDeadline = useCallback(async (deadlineLocal) => {
    setSavingDeadline(true)
    setDeadlineError('')
    try {
      const result = await api.setProjectSettings(deadlineLocal)
      setProjectSettings({
        deadline: result.deadline,
        deadlineLocal: result.deadlineLocal,
        isClosed: result.isClosed,
      })
    } catch (err) {
      setDeadlineError(err.message || 'Could not save the deadline. Please try again.')
    } finally {
      setSavingDeadline(false)
    }
  }, [])

  useEffect(() => {
    load()

    let timer = null

    const start = () => {
      // Cleared first, so this can never install a second timer alongside one
      // that is already running.
      if (timer) clearInterval(timer)
      timer = setInterval(load, ADMIN_REFRESH_INTERVAL_MS)
    }

    const stop = () => {
      if (timer) clearInterval(timer)
      timer = null
    }

    // A dashboard left open on a background tab should not keep spending sheet
    // reads. Polling resumes, with an immediate refresh, when it comes back.
    const onVisibilityChange = () => {
      if (document.hidden) {
        stop()
      } else {
        load()
        start()
      }
    }

    if (!document.hidden) start()
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [load])

  const percent = (part) =>
    stats.registered ? `${Math.round((part / stats.registered) * 100)}% of registered` : '—'

  return (
    <AdminLayout
      title="Dashboard"
      actions={
        <>
          {updatedAt && (
            <span className="text-xs text-slate-400 tabular-nums">
              Last updated {updatedAt.toLocaleTimeString(undefined, { timeStyle: 'medium' })}
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
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
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
          </div>

          <div className="bg-white border border-slate-100 rounded-2xl shadow-card p-5 mb-6">
            <h2 className="font-bold text-slate-900 mb-4">Lunch</h2>
            <LunchDonut
              checkedIn={stats.checkedIn}
              claimed={stats.lunchClaimed}
              jain={stats.lunchJain}
              veg={stats.lunchVeg}
            />
          </div>

          <div className="mb-6">
            <ProjectUploads
              submissions={submissions}
              deadline={projectSettings.deadline}
              deadlineLocal={projectSettings.deadlineLocal}
              isClosed={projectSettings.isClosed}
              onSaveDeadline={saveDeadline}
              savingDeadline={savingDeadline}
              deadlineError={deadlineError}
            />
          </div>

          <CheckInTable checkIns={checkIns} />
        </>
      )}
    </AdminLayout>
  )
}
