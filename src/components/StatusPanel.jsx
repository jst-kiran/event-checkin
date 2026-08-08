import { CheckCircle2, XCircle, Info } from 'lucide-react'

/**
 * The result screen.
 *
 * Colour is never the only signal — each tone gets its own icon and its own
 * wording, so the outcome is unmistakable to someone reading it upside down
 * across a desk, on a washed-out phone screen, or with colour-blindness.
 */
const TONES = {
  success: {
    icon: CheckCircle2,
    ring: 'bg-emerald-50 border-emerald-200',
    iconColor: 'text-emerald-600',
    titleColor: 'text-emerald-700',
  },
  info: {
    icon: Info,
    ring: 'bg-blue-50 border-blue-200',
    iconColor: 'text-blue-600',
    titleColor: 'text-blue-700',
  },
  error: {
    icon: XCircle,
    ring: 'bg-red-50 border-red-200',
    iconColor: 'text-red-600',
    titleColor: 'text-red-700',
  },
}

export default function StatusPanel({ tone = 'success', title, name, description, extra }) {
  const style = TONES[tone] || TONES.error
  const Icon = style.icon

  return (
    <div
      className="w-full flex flex-col items-center text-center gap-4"
      // Announced to a screen reader the moment the result replaces the form.
      role="status"
      aria-live="polite"
    >
      <div
        className={`w-20 h-20 rounded-full flex items-center justify-center border ${style.ring}`}
      >
        <Icon className={`w-10 h-10 ${style.iconColor}`} strokeWidth={2} aria-hidden="true" />
      </div>

      <div className="w-full">
        <p className={`text-sm font-bold tracking-[0.15em] ${style.titleColor}`}>{title}</p>
        {name && (
          <p className="text-2xl sm:text-3xl font-bold text-slate-900 mt-2 break-words">{name}</p>
        )}
        {description && (
          <p className="text-slate-500 mt-2 text-sm leading-relaxed max-w-xs mx-auto">
            {description}
          </p>
        )}
      </div>

      {extra && <div className="w-full">{extra}</div>}
    </div>
  )
}
