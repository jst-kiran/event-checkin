import { Loader2 } from 'lucide-react'

/**
 * Sized for a real desk: the primary button is a 56px touch target that an
 * operator can hit without looking, and it goes disabled the moment a request
 * starts so a double-tap cannot become two check-ins.
 */
const VARIANTS = {
  primary: 'bg-brand-600 hover:bg-brand-700 active:bg-brand-800 text-white shadow-lift',
  secondary: 'bg-white hover:bg-slate-50 text-slate-700 border border-slate-200',
  ghost: 'bg-transparent hover:bg-slate-100 text-slate-600',
}

export default function Button({
  children,
  variant = 'primary',
  loading = false,
  loadingLabel,
  disabled = false,
  icon: Icon,
  className = '',
  ...props
}) {
  return (
    <button
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-2 w-full min-h-[3.5rem] px-6
        rounded-2xl font-semibold text-sm tracking-wide transition-colors
        disabled:opacity-60 disabled:cursor-not-allowed ${VARIANTS[variant]} ${className}`}
      {...props}
    >
      {loading ? (
        <>
          <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
          <span>{loadingLabel || 'Please wait…'}</span>
        </>
      ) : (
        <>
          {Icon && <Icon className="w-5 h-5" aria-hidden="true" />}
          <span>{children}</span>
        </>
      )}
    </button>
  )
}
