/**
 * The wordmark. Inline SVG rather than an image file so it is part of the first
 * paint — nothing to download, nothing to lay out late, and it stays crisp on
 * whatever screen the desk ends up using.
 */
export default function Brand({ size = 'md' }) {
  const large = size === 'lg'

  return (
    <div className="flex items-center gap-2.5">
      <svg
        viewBox="0 0 64 64"
        className={large ? 'w-11 h-11' : 'w-8 h-8'}
        role="img"
        aria-label="Event Check-In"
      >
        <rect width="64" height="64" rx="16" className="fill-brand-600" />
        <path
          d="M18 33.5 L27.5 43 L46 24"
          fill="none"
          stroke="white"
          strokeWidth="6.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span
        className={`font-bold tracking-tight text-slate-900 ${large ? 'text-xl' : 'text-base'}`}
      >
        Event Check-In
      </span>
    </div>
  )
}
