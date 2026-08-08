import Brand from './Brand'

/**
 * The frame for the two attendee-facing screens.
 *
 * min-h with a centred card rather than a fixed height: the result state is
 * taller than the form, and on a short phone the page still has to scroll
 * instead of clipping the button an attendee needs to press.
 */
export default function DeskLayout({ children }) {
  return (
    <div className="min-h-[100dvh] bg-slate-50 flex flex-col items-center px-4 py-8 sm:py-12">
      <header className="mb-6 sm:mb-8">
        <Brand size="lg" />
      </header>

      <main className="w-full max-w-md flex-1 flex flex-col justify-center">{children}</main>

      <footer className="mt-8 text-xs text-slate-400 text-center">
        Verification is processed securely on the server
      </footer>
    </div>
  )
}

/** The white card every desk screen sits in. */
export function DeskCard({ children }) {
  return (
    <div className="w-full bg-white rounded-3xl shadow-card border border-slate-100 p-6 sm:p-8">
      {children}
    </div>
  )
}
