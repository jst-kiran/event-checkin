import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Users,
  CheckCircle2,
  Clock,
  UserPlus,
  RefreshCw,
  AlertTriangle,
  Search,
  X,
  Info,
} from 'lucide-react'
import AdminLayout from '../components/AdminLayout'
import StatCard from '../components/StatCard'
import { api } from '../services/api'

/** Re-read live data this often while the tab is visible. */
const REFRESH_INTERVAL_MS = 15_000

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'checked', label: 'Checked in' },
  { id: 'pending', label: 'Not checked in' },
  { id: 'manual', label: 'Manual' },
  { id: 'walkin', label: 'Walk-ins' },
]

/** How a row is highlighted. Desk check-ins and pending rows stay plain. */
function kindOf(row) {
  if (row.walkIn) return 'walkin'
  if (row.checkedIn && row.method !== 'Desk') return 'manual'
  return row.checkedIn ? 'desk' : 'pending'
}

const ROW_STYLE = {
  walkin: 'bg-violet-50 hover:bg-violet-100/70',
  manual: 'bg-amber-50 hover:bg-amber-100/70',
  desk: 'hover:bg-slate-50/70',
  pending: 'hover:bg-slate-50/70',
}

const ROW_ACCENT = {
  walkin: 'border-l-4 border-l-violet-400',
  manual: 'border-l-4 border-l-amber-400',
  desk: 'border-l-4 border-l-transparent',
  pending: 'border-l-4 border-l-transparent',
}

const METHOD_BADGE = {
  Desk: 'bg-slate-100 text-slate-600',
  Manual: 'bg-amber-100 text-amber-800',
  'Walk-in': 'bg-violet-100 text-violet-800',
}

function formatDateTime(value) {
  if (!value) return '—'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime())
    ? String(value)
    : parsed.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
}

function errorText(error, fallback) {
  return error?.payload?.message || fallback
}

export default function AdminDashboard() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [updatedAt, setUpdatedAt] = useState(null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [confirming, setConfirming] = useState(null) // email awaiting confirmation
  const [busyEmail, setBusyEmail] = useState(null)
  const [notice, setNotice] = useState(null) // { tone, text }
  const [showWalkIn, setShowWalkIn] = useState(false)

  // A slow response must never overlap the next tick and stack up requests.
  const inFlight = useRef(false)

  const load = useCallback(async () => {
    if (inFlight.current) return
    inFlight.current = true
    setRefreshing(true)
    try {
      const result = await api.attendees()
      setData(result)
      setUpdatedAt(new Date())
      setLoadError('')
    } catch (error) {
      // Keep the last good data on screen; the banner says it may be stale.
      setLoadError(errorText(error, 'Could not load live data from Google Sheets. Retrying automatically.'))
    } finally {
      inFlight.current = false
      setRefreshing(false)
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    let timer = null
    const start = () => {
      if (timer) clearInterval(timer)
      timer = setInterval(load, REFRESH_INTERVAL_MS)
    }
    const stop = () => {
      if (timer) clearInterval(timer)
      timer = null
    }
    // A dashboard left on a background tab should not keep spending sheet reads.
    const onVisibility = () => {
      if (document.hidden) stop()
      else {
        load()
        start()
      }
    }
    if (!document.hidden) start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [load])

  const rows = useMemo(() => (data ? [...data.attendees, ...data.walkIns] : []), [data])

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return rows.filter((row) => {
      const kind = kindOf(row)
      if (filter === 'checked' && !row.checkedIn) return false
      if (filter === 'pending' && row.checkedIn) return false
      if (filter === 'manual' && kind !== 'manual') return false
      if (filter === 'walkin' && kind !== 'walkin') return false
      if (!needle) return true
      return [row.fullName, row.email, row.enrollmentNumber, row.course, row.specialization]
        .join(' ')
        .toLowerCase()
        .includes(needle)
    })
  }, [rows, query, filter])

  const manualCheckIn = async (row) => {
    setBusyEmail(row.email)
    setNotice(null)
    try {
      const result = await api.manualCheckIn(row.email)
      const name = result.attendee.fullName || row.email
      setNotice(
        result.status === 'CHECKED_IN'
          ? { tone: 'success', text: `${name} checked in manually at ${formatDateTime(result.attendee.checkedInAt)}.` }
          : { tone: 'info', text: `${name} was already checked in at ${formatDateTime(result.attendee.checkedInAt)}.` }
      )
      await load()
    } catch (error) {
      setNotice({ tone: 'error', text: errorText(error, 'Could not check in. Please try again.') })
    } finally {
      setBusyEmail(null)
      setConfirming(null)
    }
  }

  const summary = data?.summary
  const sheet = data?.sheet
  const percent = (part) =>
    summary?.totalRegistrations ? `${Math.round((part / summary.totalRegistrations) * 100)}% of registered` : '—'

  return (
    <AdminLayout
      title="Dashboard"
      actions={
        <>
          {updatedAt && (
            <span className="text-xs text-slate-400 tabular-nums">
              Updated {updatedAt.toLocaleTimeString(undefined, { timeStyle: 'medium' })}
            </span>
          )}
          <button
            onClick={() => setShowWalkIn((open) => !open)}
            className="inline-flex items-center gap-2 bg-white border border-violet-200 hover:bg-violet-50 text-violet-700 font-medium text-sm px-4 py-2 rounded-xl transition-colors"
          >
            <UserPlus className="w-4 h-4" aria-hidden="true" />
            Add walk-in
          </button>
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
      {loadError && <Banner tone="warning">{loadError}</Banner>}
      {notice && (
        <Banner tone={notice.tone} onClose={() => setNotice(null)}>
          {notice.text}
        </Banner>
      )}

      {showWalkIn && (
        <WalkInForm
          onClose={() => setShowWalkIn(false)}
          onDone={async (message) => {
            setNotice(message)
            setShowWalkIn(false)
            await load()
          }}
        />
      )}

      {loading ? (
        <p className="text-slate-500 text-sm">Loading live data…</p>
      ) : !data ? null : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
            <StatCard
              icon={Users}
              label="Total registrations"
              value={summary.totalRegistrations}
              sublabel={`From "${sheet.registrationTab}"`}
              accent="brand"
            />
            <StatCard
              icon={CheckCircle2}
              label="Checked in"
              value={summary.checkedIn}
              sublabel={`${summary.deskCheckIns} desk · ${summary.manualCheckIns} manual`}
              accent="emerald"
            />
            <StatCard
              icon={Clock}
              label="Not checked in"
              value={summary.notCheckedIn}
              sublabel={percent(summary.notCheckedIn)}
              accent="amber"
            />
            <StatCard
              icon={UserPlus}
              label="Walk-ins"
              value={summary.walkIns}
              sublabel={`${summary.totalPresent} present in total`}
              accent="blue"
            />
          </div>

          <SheetHealth sheet={sheet} />

          <div className="bg-white border border-slate-100 rounded-2xl shadow-card overflow-hidden">
            <div className="flex flex-col gap-3 px-5 sm:px-6 py-4 border-b border-slate-50">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                <h2 className="font-bold text-slate-900">
                  Attendees
                  <span className="ml-2 text-xs font-medium text-slate-400">
                    {visible.length === rows.length ? `${rows.length} total` : `${visible.length} of ${rows.length}`}
                  </span>
                </h2>
                <div className="relative lg:w-72">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" aria-hidden="true" />
                  <input
                    type="search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search name, email, enrollment"
                    aria-label="Search attendees"
                    className="w-full pl-9 pr-3 py-2 text-sm rounded-xl border border-slate-200 outline-none focus:border-brand-500"
                  />
                </div>
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter attendees">
                  {FILTERS.map(({ id, label }) => (
                    <button
                      key={id}
                      onClick={() => setFilter(id)}
                      aria-pressed={filter === id}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                        filter === id ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-4 text-xs text-slate-500" aria-label="Highlight legend">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded-sm bg-amber-100 border-l-4 border-l-amber-400" aria-hidden="true" />
                    Manual check-in
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded-sm bg-violet-100 border-l-4 border-l-violet-400" aria-hidden="true" />
                    Walk-in
                  </span>
                </div>
              </div>
            </div>

            <div className="table-scroll overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead>
                  <tr className="text-slate-400 text-xs uppercase tracking-wide bg-slate-50/60">
                    {['Row', 'Attendee', 'Enrollment no.', 'Sem', 'Course / specialization', 'Status', 'Checked in at'].map(
                      (heading, i) => (
                        <th key={i} scope="col" className="px-4 py-3 font-medium whitespace-nowrap">
                          {heading}
                        </th>
                      )
                    )}
                  </tr>
                </thead>
                <tbody>
                  {visible.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-6 py-12 text-center text-slate-400 text-sm">
                        {rows.length === 0 ? 'No registrations found.' : 'No attendee matches this search or filter.'}
                      </td>
                    </tr>
                  ) : (
                    visible.map((row) => {
                      const kind = kindOf(row)
                      return (
                        <tr
                          key={(row.walkIn ? 'w:' : 'r:') + row.email}
                          data-kind={kind}
                          className={`border-t border-slate-100 ${ROW_STYLE[kind]}`}
                        >
                          <td className={`px-4 py-3 text-slate-400 tabular-nums whitespace-nowrap ${ROW_ACCENT[kind]}`}>
                            {row.walkIn ? '—' : row.rowNumbers.join(', ')}
                          </td>
                          <td className="px-4 py-3 min-w-[12rem]">
                            <div className="font-medium text-slate-900">
                              {row.conflict ? (
                                <span className="whitespace-nowrap px-2 py-0.5 rounded-full text-[11px] font-semibold bg-red-50 text-red-700 border border-red-100">
                                  Conflicting rows — check sheet
                                </span>
                              ) : (
                                row.fullName || <span className="text-slate-400 italic font-normal">Not provided</span>
                              )}
                            </div>
                            <div className="text-xs text-slate-500 break-all">{row.email}</div>
                          </td>
                          <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{row.enrollmentNumber || '—'}</td>
                          <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{row.semester || '—'}</td>
                          <td className="px-4 py-3 text-slate-600 max-w-[14rem]">
                            <div className="truncate" title={row.course}>{row.course || '—'}</div>
                            {row.specialization && (
                              <div className="text-xs text-slate-500 truncate" title={row.specialization}>
                                {row.specialization}
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            {row.checkedIn ? (
                              <span className="inline-flex items-center gap-1.5">
                                <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-100">
                                  Checked in
                                </span>
                                <span
                                  className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                                    METHOD_BADGE[row.walkIn ? 'Walk-in' : row.method] || METHOD_BADGE.Manual
                                  }`}
                                  title={row.checkedInBy ? `By ${row.checkedInBy}` : undefined}
                                >
                                  {row.walkIn ? 'Walk-in' : row.method}
                                </span>
                              </span>
                            ) : (
                              <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-500">
                                Not checked in
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-slate-500 whitespace-nowrap tabular-nums">
                            {row.checkedIn ? (
                              formatDateTime(row.checkedInAt)
                            ) : confirming === row.email ? (
                              <span className="inline-flex items-center gap-1.5">
                                <button
                                  onClick={() => manualCheckIn(row)}
                                  disabled={busyEmail === row.email}
                                  className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-500 hover:bg-amber-600 text-white disabled:opacity-50"
                                >
                                  {busyEmail === row.email ? 'Saving…' : 'Confirm'}
                                </button>
                                <button
                                  onClick={() => setConfirming(null)}
                                  disabled={busyEmail === row.email}
                                  className="px-2 py-1.5 rounded-lg text-xs font-semibold text-slate-500 hover:bg-slate-100"
                                >
                                  Cancel
                                </button>
                              </span>
                            ) : (
                              <button
                                onClick={() => setConfirming(row.email)}
                                disabled={Boolean(busyEmail)}
                                className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-brand-200 text-brand-700 hover:bg-brand-50 disabled:opacity-50"
                              >
                                Check in
                              </button>
                            )}
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </AdminLayout>
  )
}

function Banner({ tone = 'info', children, onClose }) {
  const styles = {
    success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    info: 'border-blue-200 bg-blue-50 text-blue-800',
    warning: 'border-amber-200 bg-amber-50 text-amber-800',
    error: 'border-red-200 bg-red-50 text-red-800',
  }
  const Icon = tone === 'success' ? CheckCircle2 : tone === 'info' ? Info : AlertTriangle
  return (
    <div role="status" className={`mb-5 flex items-start gap-2 rounded-xl border px-4 py-3 text-sm ${styles[tone] || styles.info}`}>
      <Icon className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
      <span className="flex-1">{children}</span>
      {onClose && (
        <button onClick={onClose} className="shrink-0 opacity-60 hover:opacity-100" aria-label="Dismiss">
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  )
}

/** Problems in the registration sheet that the desk cannot fix on its own. */
function SheetHealth({ sheet }) {
  const notes = []
  if (sheet.conflicts.length) {
    notes.push(
      `${sheet.conflicts.length} email(s) are used by rows describing different people ` +
        `(rows ${sheet.conflicts.map((c) => c.rowNumbers.join('/')).join('; ')}). The desk will ask them to see an organizer.`
    )
  }
  if (!sheet.checkInTabExists) {
    notes.push(`No check-ins yet. The "${sheet.checkInTab}" tab will be created in the spreadsheet on the first check-in.`)
  }
  if (!notes.length) return null
  return (
    <div className="mb-5 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600 flex flex-col gap-1.5">
      {notes.map((note) => (
        <p key={note} className="flex items-start gap-2">
          <Info className="w-4 h-4 mt-0.5 shrink-0 text-slate-400" aria-hidden="true" />
          <span>{note}</span>
        </p>
      ))}
    </div>
  )
}

const WALK_IN_FIELDS = [
  { key: 'fullName', label: 'Full name', required: true },
  { key: 'email', label: 'Email', required: true, type: 'email' },
  { key: 'enrollmentNumber', label: 'Enrollment number' },
  { key: 'semester', label: 'Semester' },
  { key: 'course', label: 'Course' },
  { key: 'specialization', label: 'Specialization' },
]

function WalkInForm({ onClose, onDone }) {
  const [values, setValues] = useState({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const submit = async (event) => {
    event.preventDefault()
    if (saving) return
    if (!values.fullName?.trim() || !values.email?.trim()) {
      setError('Full name and email are required.')
      return
    }
    setSaving(true)
    setError('')
    try {
      const result = await api.addWalkIn(values)
      const name = result.attendee.fullName || result.attendee.email
      await onDone(
        result.status === 'CHECKED_IN'
          ? { tone: 'success', text: `${name} added as a walk-in and checked in at ${formatDateTime(result.attendee.checkedInAt)}.` }
          : { tone: 'info', text: `${name} was already checked in at ${formatDateTime(result.attendee.checkedInAt)}.` }
      )
    } catch (err) {
      setError(errorText(err, 'Could not add the walk-in. Please try again.'))
      setSaving(false)
    }
  }

  return (
    <form
      onSubmit={submit}
      noValidate
      className="mb-5 bg-violet-50/60 border border-violet-200 rounded-2xl p-5"
      aria-label="Add walk-in"
    >
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h2 className="font-bold text-slate-900">Add a walk-in</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            For someone who is not in the registration sheet. They are checked in immediately and highlighted as a walk-in.
          </p>
        </div>
        <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600" aria-label="Close">
          <X className="w-5 h-5" />
        </button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {WALK_IN_FIELDS.map(({ key, label, required, type }) => (
          <label key={key} className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
            <span>
              {label}
              {required && <span className="text-red-500"> *</span>}
            </span>
            <input
              type={type || 'text'}
              value={values[key] || ''}
              onChange={(event) => setValues((current) => ({ ...current, [key]: event.target.value }))}
              maxLength={key === 'email' ? 254 : 120}
              disabled={saving}
              className="px-3 py-2 text-sm font-normal rounded-xl border border-slate-200 bg-white outline-none focus:border-brand-500"
            />
          </label>
        ))}
      </div>
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-600 font-medium">
          {error}
        </p>
      )}
      <div className="mt-4 flex gap-2">
        <button
          type="submit"
          disabled={saving}
          className="inline-flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white font-semibold text-sm px-4 py-2 rounded-xl disabled:opacity-50"
        >
          <UserPlus className="w-4 h-4" aria-hidden="true" />
          {saving ? 'Saving…' : 'Check in walk-in'}
        </button>
        <button type="button" onClick={onClose} disabled={saving} className="px-4 py-2 text-sm font-medium text-slate-500 hover:text-slate-700">
          Cancel
        </button>
      </div>
    </form>
  )
}
