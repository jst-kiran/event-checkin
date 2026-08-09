import { useCallback, useEffect, useRef, useState } from 'react'
import { FolderUp, ExternalLink, RefreshCw, AlertTriangle, Search, FileText } from 'lucide-react'
import AdminLayout from '../components/AdminLayout'
import StatCard from '../components/StatCard'
import { api } from '../services/api'
import { ADMIN_REFRESH_INTERVAL_MS } from '../config'
import { formatDateTime } from '../utils/messages'

export default function Projects() {
  const [submissions, setSubmissions] = useState([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [updatedAt, setUpdatedAt] = useState(null)

  const inFlight = useRef(false)

  const load = useCallback(async () => {
    if (inFlight.current) return
    inFlight.current = true
    setRefreshing(true)

    try {
      const projectsResult = await api.projects()
      setSubmissions(projectsResult.submissions || [])
      setUpdatedAt(new Date())
      setError('')
    } catch {
      setError('Could not load project uploads from Google Sheets. Retrying automatically.')
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
      timer = setInterval(load, ADMIN_REFRESH_INTERVAL_MS)
    }

    const stop = () => {
      if (timer) clearInterval(timer)
      timer = null
    }

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

  const filtered = submissions.filter((item) => {
    const query = search.trim().toLowerCase()
    if (!query) return true
    return (
      item.teamName.toLowerCase().includes(query) ||
      (item.status && item.status.toLowerCase().includes(query))
    )
  })

  return (
    <AdminLayout
      title="Project Uploads"
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
        <p className="text-slate-500 text-sm">Loading project uploads…</p>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
            <StatCard
              icon={FolderUp}
              label="Total Submissions"
              value={submissions.length}
              sublabel="Project uploads recorded in sheet"
              accent="brand"
            />
            <StatCard
              icon={FileText}
              label="Filtered Submissions"
              value={filtered.length}
              sublabel={search.trim() ? `Matching "${search.trim()}"` : 'All team submissions'}
              accent="emerald"
            />
          </div>

          <div className="bg-white border border-slate-100 rounded-2xl shadow-card overflow-hidden">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-5 sm:px-6 py-4 border-b border-slate-50">
              <h2 className="font-bold text-slate-900">
                Submitted Projects
                <span className="ml-2 text-xs font-medium text-slate-400">
                  {filtered.length} {filtered.length === 1 ? 'project' : 'projects'}
                </span>
              </h2>

              <div className="relative w-full sm:w-64">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
                <input
                  type="text"
                  placeholder="Search team or status..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-1.5 rounded-xl border border-slate-200 text-xs text-slate-900 placeholder:text-slate-400 outline-none focus:border-brand-500"
                />
              </div>
            </div>

            {filtered.length === 0 ? (
              <div className="px-6 py-12 text-center">
                <FolderUp className="w-10 h-10 text-slate-300 mx-auto mb-3" aria-hidden="true" />
                <p className="text-slate-500 font-medium text-sm">
                  {submissions.length === 0
                    ? 'No project submissions yet.'
                    : 'No project submissions match your search.'}
                </p>
                <p className="text-xs text-slate-400 mt-1">
                  {submissions.length === 0
                    ? 'When teams submit project drive links, they will appear here live.'
                    : 'Try searching with a different term.'}
                </p>
              </div>
            ) : (
              <div className="table-scroll overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead>
                    <tr className="text-slate-400 text-xs uppercase tracking-wide bg-slate-50/60">
                      <th scope="col" className="px-5 sm:px-6 py-3 font-medium">Team Name</th>
                      <th scope="col" className="px-5 sm:px-6 py-3 font-medium">Drive Link</th>
                      <th scope="col" className="px-5 sm:px-6 py-3 font-medium">Submitted At</th>
                      <th scope="col" className="px-5 sm:px-6 py-3 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((submission, index) => (
                      <tr
                        key={`${submission.teamName}-${submission.submittedAt}-${index}`}
                        className="border-t border-slate-50 hover:bg-slate-50/60 transition-colors"
                      >
                        <td className="px-5 sm:px-6 py-4 font-semibold text-slate-900">
                          {submission.teamName}
                        </td>
                        <td className="px-5 sm:px-6 py-4">
                          {submission.driveLink ? (
                            <a
                              href={submission.driveLink}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 bg-brand-50 hover:bg-brand-100 text-brand-700 font-medium text-xs px-3 py-1.5 rounded-xl border border-brand-200/60 transition-colors"
                            >
                              <span>View project</span>
                              <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                            </a>
                          ) : (
                            <span className="text-slate-400 text-xs font-medium">No link provided</span>
                          )}
                        </td>
                        <td className="px-5 sm:px-6 py-4 text-slate-500 whitespace-nowrap text-xs">
                          {formatDateTime(submission.submittedAt)}
                        </td>
                        <td className="px-5 sm:px-6 py-4 whitespace-nowrap">
                          <span className="inline-block px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-100">
                            {submission.status || 'Submitted'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </AdminLayout>
  )
}
