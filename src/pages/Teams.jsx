import { useState } from 'react'
import { Shuffle, Users, AlertTriangle } from 'lucide-react'
import AdminLayout from '../components/AdminLayout'
import { api } from '../services/api'

/**
 * The draw runs on the server against the live check-in list, so a dashboard
 * left open for an hour still divides the people who are actually in the room.
 *
 * Results are intentionally not saved anywhere: teams are scratch data, and
 * "randomize again" is supposed to give a different, equally valid answer.
 */
export default function Teams() {
  const [count, setCount] = useState('5')
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const generate = async () => {
    if (loading) return
    setLoading(true)
    setError('')

    try {
      setResult(await api.teams(Number(count)))
    } catch (err) {
      setError(
        err.status === 'INVALID_REQUEST'
          ? 'Enter a whole number of teams between 1 and 100.'
          : 'Could not load checked-in attendees. Please try again.'
      )
      setResult(null)
    } finally {
      setLoading(false)
    }
  }

  const teams = result?.teams ?? []
  const hasTeams = teams.length > 0
  const noAttendees = result && result.totalAttendees === 0

  return (
    <AdminLayout title="Team randomizer">
      <div className="bg-white border border-slate-100 rounded-2xl shadow-card p-5 mb-6">
        <p className="text-sm text-slate-500 mb-4">
          Randomly divides everyone who has checked in. Attendees who have not checked in are
          excluded, and each person appears in exactly one team.
        </p>

        <div className="flex flex-col sm:flex-row sm:items-end gap-3">
          <div className="sm:w-40">
            <label
              htmlFor="team-count"
              className="block text-[11px] font-semibold tracking-[0.15em] text-slate-500 mb-2"
            >
              NUMBER OF TEAMS
            </label>
            <input
              id="team-count"
              type="number"
              min="1"
              max="100"
              value={count}
              onChange={(event) => setCount(event.target.value)}
              className="w-full px-4 py-2.5 rounded-xl bg-white border border-slate-200 text-slate-900 outline-none focus:border-brand-500"
            />
          </div>

          <button
            onClick={generate}
            disabled={loading}
            className="inline-flex items-center justify-center gap-2 bg-brand-600 hover:bg-brand-700 text-white font-semibold text-sm px-5 py-2.5 rounded-xl transition-colors disabled:opacity-60"
          >
            <Shuffle className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
            {loading ? 'Generating…' : hasTeams ? 'RANDOMIZE AGAIN' : 'GENERATE TEAMS'}
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-5 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      {noAttendees && (
        <div className="bg-white border border-slate-100 rounded-2xl shadow-card px-5 py-12 text-center">
          <Users className="w-8 h-8 text-slate-300 mx-auto mb-3" aria-hidden="true" />
          <p className="text-slate-500 text-sm">
            No one has checked in yet. Teams can be generated once attendees start arriving.
          </p>
        </div>
      )}

      {hasTeams && (
        <>
          <p className="text-sm text-slate-500 mb-4">
            {result.totalAttendees} checked-in{' '}
            {result.totalAttendees === 1 ? 'attendee' : 'attendees'} across {result.teamCount}{' '}
            {result.teamCount === 1 ? 'team' : 'teams'}
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {teams.map((team, index) => (
              <div
                key={index}
                className="bg-white border border-slate-100 rounded-2xl shadow-card overflow-hidden"
              >
                <div className="flex items-center justify-between px-5 py-3 border-b border-slate-50 bg-brand-50/60">
                  <h2 className="font-bold text-brand-700 text-sm tracking-wide">
                    TEAM {index + 1}
                  </h2>
                  <span className="text-xs text-slate-400 font-medium">{team.length}</span>
                </div>
                <ul className="px-5 py-2 divide-y divide-slate-50">
                  {team.map((member) => (
                    <li key={member.email} className="py-2.5">
                      <p className="text-sm font-medium text-slate-900">{member.name}</p>
                      {member.organization && (
                        <p className="text-xs text-slate-400 truncate">{member.organization}</p>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </>
      )}
    </AdminLayout>
  )
}
