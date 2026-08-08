import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { formatDateTime, mealLabel } from '../utils/messages'

/**
 * The check-in log.
 *
 * Filtering happens in the browser over the rows already fetched — the list is
 * a few hundred people, so a round trip per keystroke would be slower and would
 * spend Google read quota to answer a question the page can already answer.
 */
export default function CheckInTable({ checkIns }) {
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return checkIns

    return checkIns.filter((attendee) =>
      [attendee.name, attendee.email, attendee.organization]
        .join(' ')
        .toLowerCase()
        .includes(needle)
    )
  }, [checkIns, query])

  return (
    <div className="bg-white border border-slate-100 rounded-2xl shadow-card overflow-hidden">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-5 sm:px-6 py-4 border-b border-slate-50">
        <h2 className="font-bold text-slate-900">
          Checked-in attendees
          <span className="ml-2 text-xs font-medium text-slate-400">
            {filtered.length === checkIns.length
              ? `${checkIns.length} total`
              : `${filtered.length} of ${checkIns.length}`}
          </span>
        </h2>

        <div className="relative sm:w-64">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400"
            aria-hidden="true"
          />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search name, email, org"
            aria-label="Search checked-in attendees"
            className="w-full pl-9 pr-3 py-2 text-sm rounded-xl border border-slate-200 outline-none focus:border-brand-500"
          />
        </div>
      </div>

      <div className="table-scroll overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead>
            <tr className="text-slate-400 text-xs uppercase tracking-wide bg-slate-50/60">
              <th scope="col" className="px-5 sm:px-6 py-3 font-medium">Name</th>
              <th scope="col" className="px-5 sm:px-6 py-3 font-medium">Email</th>
              <th scope="col" className="px-5 sm:px-6 py-3 font-medium">Organization</th>
              <th scope="col" className="px-5 sm:px-6 py-3 font-medium">Meal</th>
              <th scope="col" className="px-5 sm:px-6 py-3 font-medium">Lunch</th>
              <th scope="col" className="px-5 sm:px-6 py-3 font-medium">Check-in time</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-6 py-12 text-center text-slate-400 text-sm">
                  {checkIns.length === 0
                    ? 'No check-ins yet. Attendees appear here as they arrive.'
                    : 'No attendee matches that search.'}
                </td>
              </tr>
            ) : (
              filtered.map((attendee) => (
                <tr key={attendee.email} className="border-t border-slate-50 hover:bg-slate-50/60">
                  <td className="px-5 sm:px-6 py-3.5 font-medium text-slate-900 whitespace-nowrap">
                    {attendee.name}
                  </td>
                  <td className="px-5 sm:px-6 py-3.5 text-slate-500 whitespace-nowrap">
                    {attendee.email}
                  </td>
                  <td className="px-5 sm:px-6 py-3.5 text-slate-500 max-w-[16rem] truncate">
                    {attendee.organization || '—'}
                  </td>
                  <td className="px-5 sm:px-6 py-3.5 text-slate-500 whitespace-nowrap">
                    {attendee.mealPreference ? mealLabel(attendee.mealPreference) : '—'}
                  </td>
                  <td className="px-5 sm:px-6 py-3.5 whitespace-nowrap">
                    <span
                      className={`inline-block px-2.5 py-1 rounded-full text-xs font-semibold ${
                        attendee.lunchClaimed
                          ? 'bg-blue-50 text-blue-700 border border-blue-100'
                          : 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      {attendee.lunchClaimed ? 'Claimed' : 'Pending'}
                    </span>
                  </td>
                  <td className="px-5 sm:px-6 py-3.5 text-slate-500 whitespace-nowrap">
                    {formatDateTime(attendee.checkedInAt)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
