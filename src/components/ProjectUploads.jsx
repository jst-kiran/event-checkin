import { useEffect, useState } from 'react'
import { ExternalLink, FolderOpen, Clock } from 'lucide-react'
import { formatDateTime } from '../utils/messages'

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

/**
 * Formats the stored offset-ISO deadline ("2026-08-20T18:30:00+05:30") by
 * reading its digits directly rather than through Date/toLocaleString.
 *
 * The deadline is always IST by construction (api/_lib/settings.js), so the
 * wall-clock digits already written into the string *are* the IST time — no
 * timezone conversion is needed, and none is risked here. Using the viewer's
 * local timezone (as formatDateTime does elsewhere) would show a traveling
 * admin the wrong hour right next to a label that says "IST".
 */
function formatIst(deadline) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(deadline || '')
  if (!match) return ''
  const [, year, month, day, hour, minute] = match
  const hourNum = Number(hour)
  const hour12 = ((hourNum + 11) % 12) + 1
  const ampm = hourNum >= 12 ? 'pm' : 'am'
  return `${Number(day)} ${MONTHS[Number(month) - 1]} ${year}, ${hour12}:${minute} ${ampm}`
}

/**
 * Project submissions from the ProjectUploads sheet, plus the admin's control
 * over the submission deadline.
 *
 * The deadline is always IST: the input below is a plain
 * `datetime-local` field with no timezone attached, and the server treats
 * whatever is typed there as India Standard Time (see api/_lib/settings.js).
 */
export default function ProjectUploads({
  submissions = [],
  deadlineLocal = '',
  deadline = null,
  isClosed = false,
  onSaveDeadline,
  savingDeadline = false,
  deadlineError = '',
}) {
  const [draft, setDraft] = useState(deadlineLocal)

  // Follows the server value on load/refresh, but not while the admin is
  // mid-edit — a poll landing between keystrokes should not undo them.
  useEffect(() => {
    setDraft(deadlineLocal)
  }, [deadlineLocal])

  const dirty = draft !== (deadlineLocal || '')

  return (
    <div className="bg-white border border-slate-100 rounded-2xl shadow-card overflow-hidden">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-5 sm:px-6 py-4 border-b border-slate-50">
        <h2 className="font-bold text-slate-900">
          Project uploads
          <span className="ml-2 text-xs font-medium text-slate-400">
            {submissions.length} {submissions.length === 1 ? 'submission' : 'submissions'}
          </span>
        </h2>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <label htmlFor="submission-deadline" className="sr-only">
              Submission deadline (IST)
            </label>
            <input
              id="submission-deadline"
              type="datetime-local"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              disabled={savingDeadline}
              className="min-h-[2.5rem] px-3 rounded-xl bg-purple-50/30 border border-purple-100 text-sm text-slate-900 outline-none focus:border-purple-500 focus:bg-white focus:ring-4 focus:ring-purple-500/10 disabled:opacity-50"
            />
            <button
              type="button"
              onClick={() => onSaveDeadline?.(draft)}
              disabled={savingDeadline || !dirty}
              className="inline-flex items-center gap-1.5 px-3 min-h-[2.5rem] rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-xs font-bold uppercase tracking-wide transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {savingDeadline ? 'Saving…' : 'Save'}
            </button>
            {deadlineLocal && (
              <button
                type="button"
                onClick={() => onSaveDeadline?.('')}
                disabled={savingDeadline}
                className="px-3 min-h-[2.5rem] rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50 text-xs font-semibold uppercase tracking-wide transition-colors disabled:opacity-40"
              >
                Clear
              </button>
            )}
          </div>
          <p className="flex items-center gap-1.5 text-xs text-slate-400">
            <Clock className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            {deadline ? (
              <span>
                Submissions {isClosed ? 'closed' : 'close'} {formatIst(deadline)} IST
                {isClosed && <span className="ml-1.5 font-semibold text-red-500">— closed</span>}
              </span>
            ) : (
              <span>No deadline set — submissions stay open</span>
            )}
          </p>
          {deadlineError && <p className="text-xs text-red-600 font-medium">{deadlineError}</p>}
        </div>
      </div>

      {submissions.length === 0 ? (
        <div className="px-6 py-12 text-center">
          <FolderOpen className="w-8 h-8 text-slate-300 mx-auto mb-3" aria-hidden="true" />
          <p className="text-slate-400 text-sm">No project submissions yet.</p>
        </div>
      ) : (
        <div className="table-scroll overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead>
              <tr className="text-slate-400 text-xs uppercase tracking-wide bg-slate-50/60">
                <th scope="col" className="px-5 sm:px-6 py-3 font-medium">Team name</th>
                <th scope="col" className="px-5 sm:px-6 py-3 font-medium">Drive link</th>
                <th scope="col" className="px-5 sm:px-6 py-3 font-medium">Submitted at</th>
                <th scope="col" className="px-5 sm:px-6 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {submissions.map((submission, index) => (
                <tr
                  key={`${submission.teamName}-${submission.submittedAt}-${index}`}
                  className="border-t border-slate-50 hover:bg-slate-50/60"
                >
                  <td className="px-5 sm:px-6 py-3.5 font-medium text-slate-900">
                    {submission.teamName}
                  </td>
                  <td className="px-5 sm:px-6 py-3.5">
                    {submission.driveLink ? (
                      <a
                        href={submission.driveLink}
                        target="_blank"
                        // noopener/noreferrer: the link is typed by a team into
                        // a spreadsheet, so it is untrusted by definition.
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-brand-700 hover:text-brand-800 hover:underline font-medium"
                      >
                        View project
                        <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                      </a>
                    ) : (
                      <span className="text-slate-400">No link</span>
                    )}
                  </td>
                  <td className="px-5 sm:px-6 py-3.5 text-slate-500 whitespace-nowrap">
                    {formatDateTime(submission.submittedAt)}
                  </td>
                  <td className="px-5 sm:px-6 py-3.5 whitespace-nowrap">
                    <span className="inline-block px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-100">
                      {submission.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
