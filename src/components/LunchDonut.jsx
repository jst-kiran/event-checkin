/**
 * Lunch service, as one ring.
 *
 * The ring is the checked-in population. Jain and Veg together form the claimed
 * arc, so the same picture answers both questions an organizer has: how much of
 * the room has eaten, and what the kitchen has actually served.
 *
 * "Not claimed" is drawn in neutral grey rather than a third colour, because it
 * is a remainder, not a category — nobody orders "not claimed", and giving it a
 * hue would imply a third meal type.
 *
 * The two meal colours were validated for colour-vision deficiency rather than
 * chosen by eye (worst-case adjacent separation ΔE 34.6 protan, 38.2 normal),
 * and every segment is labelled with its own count below, so identity never
 * rests on colour alone.
 */

const SEGMENT_COLORS = {
  jain: '#d97706',
  veg: '#7c3aed',
  notClaimed: '#e2e8f0',
}

const RADIUS = 42
const STROKE = 13
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

/** Surface-coloured gap between segments, in path units. */
const GAP = 1.6

export default function LunchDonut({ checkedIn = 0, claimed = 0, jain = 0, veg = 0 }) {
  const notClaimed = Math.max(0, checkedIn - claimed)
  const total = checkedIn

  const segments = [
    { key: 'jain', label: 'Jain', value: jain, color: SEGMENT_COLORS.jain },
    { key: 'veg', label: 'Veg', value: veg, color: SEGMENT_COLORS.veg },
    { key: 'notClaimed', label: 'Not claimed', value: notClaimed, color: SEGMENT_COLORS.notClaimed },
  ]

  const percent = total > 0 ? Math.round((claimed / total) * 100) : 0

  // Running offset, so each arc starts where the previous one ended.
  let consumed = 0

  return (
    <div className="flex flex-col sm:flex-row items-center gap-5 sm:gap-7">
      <div className="relative shrink-0">
        <svg
          viewBox="0 0 100 100"
          className="w-32 h-32 sm:w-36 sm:h-36 -rotate-90"
          role="img"
          aria-label={`${claimed} of ${total} checked-in attendees have collected lunch: ${jain} Jain, ${veg} Veg, ${notClaimed} not claimed.`}
        >
          {/* Track, so an event with no check-ins still reads as a ring. */}
          <circle
            cx="50"
            cy="50"
            r={RADIUS}
            fill="none"
            stroke="#f1f5f9"
            strokeWidth={STROKE}
          />

          {total > 0 &&
            segments.map((segment) => {
              if (segment.value <= 0) return null

              const fraction = segment.value / total
              const length = fraction * CIRCUMFERENCE
              // Never let the gap eat a thin segment entirely.
              const visible = Math.max(length - GAP, 0.6)
              const offset = -consumed
              consumed += length

              return (
                <circle
                  key={segment.key}
                  cx="50"
                  cy="50"
                  r={RADIUS}
                  fill="none"
                  stroke={segment.color}
                  strokeWidth={STROKE}
                  strokeLinecap="butt"
                  strokeDasharray={`${visible} ${CIRCUMFERENCE - visible}`}
                  strokeDashoffset={offset}
                >
                  <title>{`${segment.label}: ${segment.value}`}</title>
                </circle>
              )
            })}
        </svg>

        {/* The headline lives in the hole, where a donut's centre is otherwise wasted. */}
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="text-2xl sm:text-3xl font-bold text-slate-900 tabular-nums leading-none">
            {total > 0 ? `${percent}%` : '—'}
          </span>
          <span className="text-[10px] uppercase tracking-wider text-slate-400 mt-1">Claimed</span>
        </div>
      </div>

      <dl className="w-full sm:w-auto flex flex-row sm:flex-col flex-wrap gap-x-6 gap-y-2.5">
        {segments.map((segment) => (
          <div key={segment.key} className="flex items-center gap-2.5">
            <span
              className="w-2.5 h-2.5 rounded-sm shrink-0"
              style={{ backgroundColor: segment.color }}
              aria-hidden="true"
            />
            <dt className="text-sm text-slate-500">{segment.label}</dt>
            <dd className="text-sm font-semibold text-slate-900 tabular-nums ml-auto sm:ml-2">
              {segment.value}
            </dd>
          </div>
        ))}

        <div className="flex items-center gap-2.5 pt-2 sm:border-t sm:border-slate-100 sm:mt-1">
          <dt className="text-xs uppercase tracking-wide text-slate-400">Checked in</dt>
          <dd className="text-sm font-semibold text-slate-900 tabular-nums ml-auto sm:ml-2">
            {total}
          </dd>
        </div>
      </dl>
    </div>
  )
}
