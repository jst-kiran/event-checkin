import { forwardRef, useId, useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'

/**
 * The input component matching the reference design.
 * Supports an optional left icon (e.g. Mail) and right eye toggle for passwords.
 */
const Input = forwardRef(function Input(
  { label, error, type = 'text', icon: LeftIcon, className = '', ...props },
  ref
) {
  const id = useId()
  const errorId = `${id}-error`
  const [showPassword, setShowPassword] = useState(false)

  const isPassword = type === 'password'
  const inputType = isPassword ? (showPassword ? 'text' : 'password') : type

  return (
    <div className="w-full">
      {label && (
        <label
          htmlFor={id}
          className="block text-[11px] font-bold tracking-[0.15em] text-slate-500 mb-2 uppercase"
        >
          {label}
        </label>
      )}
      <div className="relative">
        {LeftIcon && (
          <LeftIcon
            className="w-5 h-5 text-purple-400 absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none z-10"
            aria-hidden="true"
          />
        )}
        <input
          id={id}
          ref={ref}
          type={inputType}
          autoComplete={isPassword ? 'current-password' : props.autoComplete || 'email'}
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck="false"
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={error ? errorId : undefined}
          className={`w-full min-h-[3.5rem] ${LeftIcon ? 'pl-11' : 'px-4'} ${
            isPassword ? 'pr-12' : 'pr-4'
          } rounded-2xl bg-purple-50/30 border border-purple-100 text-slate-900
            placeholder:text-slate-400 outline-none transition-all
            focus:border-purple-500 focus:bg-white focus:ring-4 focus:ring-purple-500/10
            disabled:bg-slate-50 disabled:text-slate-500
            ${error ? 'border-red-300 focus:border-red-500 focus:ring-red-500/10' : ''}
            ${className}`}
          {...props}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setShowPassword((prev) => !prev)}
            className="absolute right-3.5 top-1/2 -translate-y-1/2 p-1.5 text-purple-400 hover:text-purple-600 focus:text-purple-700 rounded-lg outline-none transition-colors z-10"
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            tabIndex={-1}
          >
            {showPassword ? (
              <EyeOff className="w-5 h-5" aria-hidden="true" />
            ) : (
              <Eye className="w-5 h-5" aria-hidden="true" />
            )}
          </button>
        )}
      </div>
      {error && (
        <p id={errorId} role="alert" className="mt-2 text-sm text-red-600 font-medium">
          {error}
        </p>
      )}
    </div>
  )
})

export default Input
