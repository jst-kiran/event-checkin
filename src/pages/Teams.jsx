import { useEffect, useState } from 'react'
import { Shuffle, Users, AlertTriangle, Info, ShieldAlert, Save, CheckCircle2 } from 'lucide-react'
import AdminLayout from '../components/AdminLayout'
import { api } from '../services/api'

export default function Teams() {
  const [size, setSize] = useState('5')
  const [ignoreText, setIgnoreText] = useState('')

  const [savedResult, setSavedResult] = useState(null)
  const [previewResult, setPreviewResult] = useState(null)

  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [initialLoading, setInitialLoading] = useState(true)
  const [saveNotification, setSaveNotification] = useState(false)

  const [error, setError] = useState('')
  const [unmatched, setUnmatched] = useState([])
  const [ambiguous, setAmbiguous] = useState([])

  const isPreview = Boolean(previewResult)
  const activeResult = isPreview ? previewResult : savedResult

  const loadCurrentTeams = async () => {
    try {
      const data = await api.teams()
      if (data && data.hasTeams) {
        setSavedResult(data)
        if (data.teamSize) setSize(String(data.teamSize))
      } else {
        setSavedResult(null)
      }
    } catch {
      // Non-fatal if no teams exist yet
    } finally {
      setInitialLoading(false)
    }
  }

  useEffect(() => {
    loadCurrentTeams()
  }, [])

  const ignoreNames = ignoreText
    .split(/[,\n]/)
    .map((name) => name.trim())
    .filter(Boolean)

  const generate = async () => {
    if (loading || saving) return
    setLoading(true)
    setError('')
    setUnmatched([])
    setAmbiguous([])

    try {
      const data = await api.teams(Number(size), ignoreNames)
      setPreviewResult(data)
    } catch (err) {
      if (err.payload?.unmatched?.length || err.payload?.ambiguous?.length) {
        setUnmatched(err.payload.unmatched || [])
        setAmbiguous(err.payload.ambiguous || [])
      } else {
        setError(
          err.status === 'INVALID_REQUEST'
            ? err.payload?.message || 'Check the values and try again.'
            : 'Could not generate team preview. Please try again.'
        )
      }
    } finally {
      setLoading(false)
    }
  }

  const handleSaveTeams = async () => {
    if (!isPreview || !previewResult || saving) return

    setSaving(true)
    setError('')

    try {
      const payload = {
        teams: previewResult.teams,
        teamSize: previewResult.teamSize,
        totalAttendees: previewResult.totalAttendees,
        checkedInCount: previewResult.checkedInCount,
        ignoredCount: previewResult.ignoredCount,
        ignored: previewResult.ignored,
      }

      const savedData = await api.saveTeams(payload)
      setSavedResult(savedData)
      setPreviewResult(null)
      setSaveNotification(true)
      setTimeout(() => setSaveNotification(false), 4000)
    } catch {
      setError('Could not save teams to Google Sheets. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const teams = activeResult?.teams ?? []
  const hasTeams = teams.length > 0
  const noAttendees = activeResult && activeResult.totalAttendees === 0 && !hasTeams

  return (
    <AdminLayout title="Team randomizer">
      <div className="bg-white border border-slate-100 rounded-2xl shadow-card p-5 mb-6">

        {/* Status Indicator Banner */}
        {isPreview ? (
          <div className="mb-5 flex items-center justify-between gap-3 px-4 py-2.5 rounded-xl bg-amber-50 border border-amber-200/80 text-amber-900 text-xs">
            <div className="flex items-center gap-2 font-bold uppercase tracking-wider">
              <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
              <span>UNSAVED PREVIEW</span>
            </div>
            <span className="text-amber-800 font-medium">
              Click "SAVE TEAMS" to publish as official teams for Project Upload.
            </span>
          </div>
        ) : savedResult?.hasTeams ? (
          <div className="mb-5 flex items-center justify-between gap-3 px-4 py-2.5 rounded-xl bg-emerald-50 border border-emerald-200/80 text-emerald-900 text-xs">
            <div className="flex items-center gap-2 font-bold uppercase tracking-wider">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" aria-hidden="true" />
              <span>TEAMS SAVED &amp; OFFICIAL</span>
            </div>
            {savedResult.timestamp && (
              <span className="text-emerald-700 font-medium text-[11px]">
                Saved at {savedResult.timestamp}
              </span>
            )}
          </div>
        ) : null}

        {saveNotification && (
          <div className="mb-5 flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 text-white font-semibold text-xs animate-fade-in">
            <CheckCircle2 className="w-4 h-4" />
            <span>Teams successfully saved to Google Sheets and published for Project Upload!</span>
          </div>
        )}

        <p className="text-sm text-slate-500 mb-5">
          Randomly divides everyone who has checked in. Randomization creates an unsaved preview. Click "SAVE TEAMS" to update the official single source of truth used by Project Upload.
        </p>

        <div className="grid grid-cols-1 lg:grid-cols-[10rem_1fr_auto] gap-4 lg:items-start">
          <div>
            <label
              htmlFor="team-size"
              className="block text-[11px] font-semibold tracking-[0.15em] text-slate-500 mb-2 uppercase"
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
              className="block text-[11px] font-semibold tracking-[0.15em] text-slate-500 mb-2 uppercase"
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
              Separate names with commas. Applies to this draw — ignored members will not be placed on any team.
            </p>
          </div>

          <div className="lg:pt-[1.85rem] flex flex-col sm:flex-row gap-2">
            <button
              onClick={generate}
              disabled={loading || saving}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-brand-600 hover:bg-brand-700 text-white font-semibold text-sm px-5 py-2.5 rounded-xl transition-colors disabled:opacity-60"
            >
              <Shuffle className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
              {loading ? 'Generating…' : hasTeams ? 'RANDOMIZE AGAIN' : 'GENERATE TEAMS'}
            </button>

            <button
              onClick={handleSaveTeams}
              disabled={!isPreview || saving || loading}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-sm px-5 py-2.5 rounded-xl transition-colors disabled:opacity-40 disabled:cursor-not-allowed shadow-xs"
              title={isPreview ? 'Save these teams to Google Sheets' : 'No unsaved preview changes'}
            >
              <Save className={`w-4 h-4 ${saving ? 'animate-spin' : ''}`} aria-hidden="true" />
              {saving ? 'Saving…' : 'SAVE TEAMS'}
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

      {initialLoading && (
        <p className="text-slate-500 text-sm py-6 text-center">Loading official saved teams…</p>
      )}

      {!initialLoading && noAttendees && (
        <div className="bg-white border border-slate-100 rounded-2xl shadow-card px-5 py-12 text-center">
          <Users className="w-8 h-8 text-slate-300 mx-auto mb-3" aria-hidden="true" />
          <p className="text-slate-500 text-sm">
            {activeResult?.checkedInCount > 0
              ? 'Everyone who has checked in is on the ignore list.'
              : 'No official teams saved yet. Click "Generate Teams" to create a preview and "Save Teams" to publish.'}
          </p>
        </div>
      )}

      {!initialLoading && hasTeams && (
        <>
          {/* Team Summary Bar */}
          <div className="mb-6 grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-white border border-slate-100 rounded-xl p-3.5 shadow-sm flex flex-col">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                Eligible Members
              </span>
              <span className="text-xl font-extrabold text-slate-900 mt-1">
                {activeResult.totalAttendees}
              </span>
            </div>

            <div className="bg-white border border-slate-100 rounded-xl p-3.5 shadow-sm flex flex-col">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                Total Teams
              </span>
              <span className="text-xl font-extrabold text-brand-600 mt-1">
                {activeResult.teamCount}
              </span>
            </div>

            <div className="bg-white border border-slate-100 rounded-xl p-3.5 shadow-sm flex flex-col">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                Target Team Size
              </span>
              <span className="text-xl font-extrabold text-slate-900 mt-1">
                {activeResult.teamSize || size}
              </span>
            </div>

            <div className="bg-white border border-slate-100 rounded-xl p-3.5 shadow-sm flex flex-col">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                Ignored Members
              </span>
              <span className="text-xl font-extrabold text-amber-600 mt-1">
                {activeResult.ignoredCount || 0}
              </span>
            </div>
          </div>

          {/* Explicit Ignored Members Section */}
          {activeResult.ignored && activeResult.ignored.length > 0 && (
            <div className="mb-6 bg-amber-50/60 border border-amber-100 rounded-2xl p-4">
              <div className="flex items-center gap-2 mb-2 text-amber-800 font-bold text-xs uppercase tracking-wider">
                <ShieldAlert className="w-4 h-4 text-amber-600" aria-hidden="true" />
                <span>IGNORED MEMBERS ({activeResult.ignored.length})</span>
              </div>
              <ul className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 text-xs text-slate-700 font-medium">
                {activeResult.ignored.map((item, idx) => (
                  <li key={idx} className="flex items-center gap-2 px-3 py-1.5 bg-white/80 rounded-xl border border-amber-200/60">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
                    <span className="font-semibold text-slate-900">{item.name || item.email}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Teams Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {teams.map((team, tIdx) => (
              <div
                key={team.name}
                className="bg-white border border-slate-100 rounded-2xl shadow-card overflow-hidden"
              >
                <div className="flex items-center justify-between gap-2 px-5 py-3 border-b border-slate-50 bg-brand-50/60">
                  <div>
                    <span className="text-[10px] font-bold text-brand-500 tracking-wider uppercase block">
                      TEAM {tIdx + 1}
                    </span>
                    <h2 className="font-bold text-slate-900 text-sm">{team.name}</h2>
                  </div>
                  <span className="text-xs bg-white px-2.5 py-1 rounded-full text-brand-700 font-bold border border-brand-200/60 shrink-0">
                    {team.members.length} {team.members.length === 1 ? 'member' : 'members'}
                  </span>
                </div>
                <ul className="px-5 py-2 divide-y divide-slate-50">
                  {team.members.map((member, mIdx) => (
                    <li key={member.email || mIdx} className="py-2.5 flex items-center gap-3">
                      <span className="text-xs font-extrabold text-purple-600 bg-purple-50 w-6 h-6 rounded-full flex items-center justify-center shrink-0">
                        {mIdx + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-slate-900 truncate">
                          {member.name}
                        </p>
                        {member.organization && (
                          <p className="text-xs text-slate-400 truncate">{member.organization}</p>
                        )}
                      </div>
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
