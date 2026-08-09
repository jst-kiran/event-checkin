import { ShieldCheck, Calendar, MapPin } from 'lucide-react'
import Brand from './Brand'

// Read optional event info from VITE_ variables if configured (otherwise cleanly omitted)
const EVENT_DATE = (import.meta.env.VITE_EVENT_DATE || '').trim()
const EVENT_LOCATION = (import.meta.env.VITE_EVENT_LOCATION || '').trim()

/**
 * The unified frame matching the reference design for attendee-facing screens.
 */
export default function DeskLayout({ title, subtitle, children }) {
  return (
    <div className="relative min-h-[100dvh] bg-gradient-to-b from-[#f9f8fe] via-[#f5f3ff] to-[#faf8ff] flex flex-col items-center px-4 py-8 sm:py-12 overflow-x-hidden">
      {/* Decorative Top-Left Dot Grid */}
      <svg
        className="absolute top-6 left-6 w-32 h-32 text-purple-300/40 pointer-events-none select-none z-0"
        fill="currentColor"
        viewBox="0 0 100 100"
        aria-hidden="true"
      >
        <pattern id="dot-grid" x="0" y="0" width="16" height="16" patternUnits="userSpaceOnUse">
          <circle cx="3" cy="3" r="1.5" />
        </pattern>
        <rect width="100" height="100" fill="url(#dot-grid)" />
      </svg>

      {/* Decorative Top-Right Circuit Line Traces */}
      <svg
        className="absolute top-4 right-4 w-48 h-48 text-purple-400/30 pointer-events-none select-none z-0"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        viewBox="0 0 200 200"
        aria-hidden="true"
      >
        <path d="M 50 0 L 50 40 L 90 80 L 160 80 L 200 120" />
        <path d="M 100 0 L 100 20 L 140 60 L 200 60" />
        <path d="M 150 0 L 150 30 L 180 60" />
        <circle cx="90" cy="80" r="3" fill="currentColor" />
        <circle cx="160" cy="80" r="3" fill="currentColor" />
        <circle cx="140" cy="60" r="3" fill="currentColor" />
      </svg>

      {/* Decorative Background Wavy Flowing Lines */}
      <svg
        className="absolute bottom-0 left-0 right-0 w-full h-64 text-purple-300/25 pointer-events-none select-none z-0"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
        viewBox="0 0 1200 300"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <path d="M 0 250 C 300 150, 600 300, 1200 180" />
        <path d="M 0 220 C 350 180, 650 260, 1200 210" />
        <path d="M 0 280 C 250 200, 700 280, 1200 150" />
      </svg>

      {/* Content Area */}
      <div className="relative z-10 w-full max-w-md flex flex-col items-center">
        {/* Brand Header */}
        <header className="flex flex-col items-center text-center">
          <Brand size="xl" showText={true} className="mb-4" />

          {/* Page Heading & Underline */}
          {title && (
            <h1 className="text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight text-center">
              {title}
            </h1>
          )}
          {title && <div className="w-10 h-0.5 bg-purple-400 rounded-full mx-auto my-3"></div>}
          {subtitle && (
            <p className="text-slate-500 text-sm font-normal max-w-xs mx-auto text-center leading-relaxed">
              {subtitle}
            </p>
          )}
        </header>

        {/* Form Card */}
        <main className="w-full my-6">{children}</main>

        {/* Security Message */}
        <div className="flex items-center justify-center gap-1.5 text-xs text-slate-500 font-medium mb-6">
          <ShieldCheck className="w-4 h-4 text-purple-600 shrink-0" aria-hidden="true" />
          <span>Your verification is secure and private.</span>
        </div>

        {/* Date & Location Pill (Only if configured in project) */}
        {(EVENT_DATE || EVENT_LOCATION) && (
          <div className="w-full rounded-2xl border border-purple-100 bg-white/80 backdrop-blur-sm px-6 py-3.5 flex items-center justify-center gap-6 text-xs font-semibold text-slate-700 shadow-sm mb-6">
            {EVENT_DATE && (
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-purple-500" aria-hidden="true" />
                <span>{EVENT_DATE}</span>
              </div>
            )}
            {EVENT_DATE && EVENT_LOCATION && <div className="h-4 w-px bg-purple-200"></div>}
            {EVENT_LOCATION && (
              <div className="flex items-center gap-2">
                <MapPin className="w-4 h-4 text-purple-500" aria-hidden="true" />
                <span>{EVENT_LOCATION}</span>
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <footer className="flex items-center justify-center gap-3 text-xs text-slate-400 font-medium mt-2">
          <span className="w-6 h-[1px] bg-purple-200"></span>
          <span>
            Powered by <strong className="text-purple-600 font-semibold">Tableau Community</strong>
          </span>
          <span className="w-6 h-[1px] bg-purple-200"></span>
        </footer>
      </div>
    </div>
  )
}

/** The white card every desk screen sits in. */
export function DeskCard({ children }) {
  return (
    <div className="w-full bg-white rounded-3xl sm:rounded-[28px] border border-purple-100/80 shadow-xl shadow-purple-900/5 p-6 sm:p-8">
      {children}
    </div>
  )
}
