import { BookOpen, ExternalLink } from 'lucide-react'
import { EBOOKS_URL } from '../config'

export default function EbooksButton() {
  if (!EBOOKS_URL) {
    return (
      <div className="w-full min-h-[3.5rem] px-6 flex items-center justify-center gap-2 rounded-2xl border border-dashed border-purple-200 bg-purple-50/50 text-purple-400 text-sm font-medium">
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
      className="w-full min-h-[3.5rem] px-6 inline-flex items-center justify-center gap-2.5 rounded-2xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 active:from-purple-800 active:to-indigo-800 text-white font-bold text-sm tracking-wider uppercase shadow-lg shadow-purple-600/25 transition-all"
    >
      <BookOpen className="w-5 h-5" aria-hidden="true" />
      <span>EXPLORE E-BOOKS</span>
      <ExternalLink className="w-4 h-4 opacity-80" aria-hidden="true" />
    </a>
  )
}
