import { forwardRef, useId } from 'react'

/**
 * The email field is the only thing an attendee ever types, so it gets the
 * autofill and keyboard hints that make it a single tap on a phone —
 * inputMode="email", no autocorrect, no auto-capitalization.
 *
 * forwardRef is what lets the desk screens re-focus this field after each
 * attendee without reaching into the DOM by id.
 */
const Input = forwardRef(function Input({ label, error, className = '', ...props }, ref) {
  const id = useId()
  const errorId = `${id}-error`

  return (
    <div className="w-full">
      {label && (
        <label
          htmlFor={id}
          className="block text-[11px] font-semibold tracking-[0.15em] text-slate-500 mb-2"
        >
          {label.toUpperCase()}
        </label>
      )}
      <input
        id={id}
        ref={ref}
        autoComplete="email"
        autoCorrect="off"
        autoCapitalize="none"
        spellCheck="false"
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={error ? errorId : undefined}
        className={`w-full min-h-[3.5rem] px-4 rounded-2xl bg-white border text-slate-900
          placeholder:text-slate-400 outline-none transition-colors
          disabled:bg-slate-50 disabled:text-slate-500
          ${error ? 'border-red-300 focus:border-red-500' : 'border-slate-200 focus:border-brand-500'}
          ${className}`}
        {...props}
      />
      {error && (
        <p id={errorId} role="alert" className="mt-2 text-sm text-red-600">
          {error}
        </p>
      )}
    </div>
  )
})

export default Input
