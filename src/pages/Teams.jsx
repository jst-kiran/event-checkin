import { useState } from 'react'
import { Shuffle, Users, AlertTriangle, Info } from 'lucide-react'
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
  const [size, setSize] = useState('5')
  const [ignoreText, setIgnoreText] = useState('')
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [unmatched, setUnmatched] = useState([])
  const [ambiguous, setAmbiguous] = useState([])

  const ignoreNames = ignoreText
    .split(/[,\n]/)
    .map((name) => name.trim())
    .filter(Boolean)

  const generate = async () => {
    if (loading) return
    setLoading(true)
    setError('')
    setUnmatched([])
    setAmbiguous([])

    try {
      setResult(await api.teams(Number(size), ignoreNames))
    } catch (err) {
      // A name that could not be resolved stops the draw entirely — a typo must
      // never silently include somebody the organizer meant to leave out.
      if (err.payload?.unmatched?.length || err.payload?.ambiguous?.length) {
        setUnmatched(err.payload.unmatched || [])
        setAmbiguous(err.payload.ambiguous || [])
      } else {
        setError(
          err.status === 'INVALID_REQUEST'
            ? err.payload?.message || 'Check the values and try again.'
            : 'Could not load checked-in attendees. Please try again.'
        )
      }
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
        <p className="text-sm text-slate-500 mb-5">
          Randomly divides everyone who has checked in. The number of teams is worked out from the
          team size — you do not need to calculate it.
        </p>

        <div className="grid grid-cols-1 lg:grid-cols-[10rem_1fr_auto] gap-4 lg:items-start">
          <div>
            <label
              htmlFor="team-size"
              className="block text-[11px] font-semibold tracking-[0.15em] text-slate-500 mb-2"
            >
              MEMBERS PER TEAM
            </label>
            <input
              id="team-size"
              type="number"
              min="1"
              max="100"
              value={size}
              onChange={(event) => setSize(event.target.value)}
              className="w-full px-4 py-2.5 rounded-xl bg-white border border-slate-200 text-slate-900 outline-none focus:border-brand-500"
            />
          </div>

          <div>
            <label
              htmlFor="team-ignore"
              className="block text-[11px] font-semibold tracking-[0.15em] text-slate-500 mb-2"
            >
              MEMBERS TO IGNORE <span className="text-slate-400">(OPTIONAL)</span>
            </label>
            <input
              id="team-ignore"
              type="text"
              value={ignoreText}
              onChange={(event) => setIgnoreText(event.target.value)}
              placeholder="Priya Sharma, Alex Chen"
              className="w-full px-4 py-2.5 rounded-xl bg-white border border-slate-200 text-slate-900 placeholder:text-slate-300 outline-none focus:border-brand-500"
            />
            <p className="mt-1.5 text-xs text-slate-400">
              Separate names with commas. Applies to this draw only — nothing is saved, and their
              check-in is untouched.
            </p>
          </div>

          <div className="lg:pt-[1.85rem]">
            <button
              onClick={generate}
              disabled={loading}
              className="w-full lg:w-auto inline-flex items-center justify-center gap-2 bg-brand-600 hover:bg-brand-700 text-white font-semibold text-sm px-5 py-2.5 rounded-xl transition-colors disabled:opacity-60"
            >
              <Shuffle className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
              {loading ? 'Generating…' : hasTeams ? 'RANDOMIZE AGAIN' : 'GENERATE TEAMS'}
            </button>
          </div>
        </div>
      </div>

      {unmatched.length > 0 && (
        <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
            <div>
              <p className="font-semibold mb-1">No teams generated — some names did not match.</p>
              <ul className="space-y-0.5">
                {unmatched.map((name) => (
                  <li key={name}>Member not found: <strong>{name}</strong></li>
                ))}
              </ul>
              <p className="mt-2 text-amber-700">
                They may not have checked in yet, or the spelling differs from their registration.
              </p>
            </div>
          </div>
        </div>
      )}

      {ambiguous.length > 0 && (
        <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
            <div className="min-w-0">
              <p className="font-semibold mb-1">
                No teams generated — more than one attendee matches.
              </p>
              {ambiguous.map((entry) => (
                <div key={entry.name} className="mb-2 last:mb-0">
                  <p>
                    <strong>{entry.name}</strong> matches {entry.candidates.length} people:
                  </p>
                  <ul className="mt-1 space-y-0.5 text-amber-700">
                    {entry.candidates.map((candidate) => (
                      <li key={candidate.email} className="truncate">
                        {candidate.name} — {candidate.email}
                        {candidate.organization ? ` · ${candidate.organization}` : ''}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

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
            {result.checkedInCount > 0
              ? 'Everyone who has checked in is on the ignore list.'
              : 'No one has checked in yet. Teams can be generated once attendees start arriving.'}
          </p>
        </div>
      )}

      {hasTeams && (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-500">
            <span>
              {result.totalAttendees} {result.totalAttendees === 1 ? 'attendee' : 'attendees'} across{' '}
              {result.teamCount} {result.teamCount === 1 ? 'team' : 'teams'}
            </span>
            {result.ignoredCount > 0 && (
              <span className="inline-flex items-center gap-1.5 text-slate-400">
                <Info className="w-3.5 h-3.5" aria-hidden="true" />
                {result.ignoredCount} excluded from this draw
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {teams.map((team) => (
              <div
                key={team.name}
                className="bg-white border border-slate-100 rounded-2xl shadow-card overflow-hidden"
              >
                <div className="flex items-center justify-between gap-2 px-5 py-3 border-b border-slate-50 bg-brand-50/60">
                  <h2 className="font-bold text-brand-700 text-sm">{team.name}</h2>
                  <span className="text-xs text-slate-400 font-medium shrink-0">
                    {team.members.length}
                  </span>
                </div>
                <ul className="px-5 py-2 divide-y divide-slate-50">
                  {team.members.map((member) => (
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
