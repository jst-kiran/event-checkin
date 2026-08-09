import { Loader2 } from 'lucide-react'

/**
 * Button component styled according to the reference design CTA.
 */
const VARIANTS = {
  primary:
    'bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 active:from-purple-800 active:to-indigo-800 text-white font-bold text-sm tracking-wider uppercase shadow-lg shadow-purple-600/25',
  secondary:
    'bg-white hover:bg-purple-50/60 active:bg-purple-100 text-purple-700 border border-purple-200 font-bold text-sm tracking-wider uppercase shadow-xs',
  ghost: 'bg-transparent hover:bg-purple-50 text-purple-700 font-semibold text-sm',
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
      className={`inline-flex items-center justify-center gap-2.5 w-full min-h-[3.5rem] px-6
        rounded-2xl transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none ${VARIANTS[variant]} ${className}`}
      {...props}
    >
      {loading ? (
        <>
          <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
          <span>{loadingLabel || 'Please wait…'}</span>
        </>
      ) : (
        <>
          {Icon && <Icon className="w-5 h-5 shrink-0" aria-hidden="true" />}
          <span>{children}</span>
        </>
      )}
    </button>
  )
}
