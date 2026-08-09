import { ExternalLink, FolderOpen } from 'lucide-react'
import { formatDateTime } from '../utils/messages'

/**
 * Project submissions from the ProjectUploads sheet.
 *
 * Read-only for now — the submission form does not exist yet, so this is the
 * receiving end waiting for it. Rows appear here on the next dashboard refresh
 * after a team submits.
 */
export default function ProjectUploads({ submissions = [] }) {
  return (
    <div className="bg-white border border-slate-100 rounded-2xl shadow-card overflow-hidden">
      <div className="flex items-center justify-between px-5 sm:px-6 py-4 border-b border-slate-50">
        <h2 className="font-bold text-slate-900">
          Project uploads
          <span className="ml-2 text-xs font-medium text-slate-400">
            {submissions.length} {submissions.length === 1 ? 'submission' : 'submissions'}
          </span>
        </h2>
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
