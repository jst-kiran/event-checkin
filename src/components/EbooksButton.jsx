import { BookOpen, ExternalLink } from 'lucide-react'
import { EBOOKS_URL } from '../config'

/**
 * The action offered after a successful check-in.
 *
 * Attendees scan their own QR code, so the screen belongs to the person who
 * just checked in — the useful next step is the event's resources, not a reset
 * for somebody else.
 *
 * Until VITE_EBOOKS_URL is set this renders as a disabled notice rather than a
 * link. A button that goes nowhere is worse at an event than one that plainly
 * says the link is not ready.
 */
export default function EbooksButton() {
  if (!EBOOKS_URL) {
    return (
      <div className="w-full min-h-[3.5rem] px-6 flex items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-200 bg-slate-50 text-slate-400 text-sm font-medium">
        <BookOpen className="w-5 h-5" aria-hidden="true" />
        <span>E-books link coming soon</span>
      </div>
    )
  }

  return (
    <a
      href={EBOOKS_URL}
      target="_blank"
      rel="noopener noreferrer"
      className="w-full min-h-[3.5rem] px-6 inline-flex items-center justify-center gap-2 rounded-2xl bg-brand-600 hover:bg-brand-700 active:bg-brand-800 text-white font-semibold text-sm tracking-wide shadow-lift transition-colors"
    >
      <BookOpen className="w-5 h-5" aria-hidden="true" />
      <span>EXPLORE E-BOOKS</span>
      <ExternalLink className="w-4 h-4 opacity-80" aria-hidden="true" />
    </a>
  )
}
