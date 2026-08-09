/**
 * The India AI + Tableau User Group mark.
 *
 * The asset is a square PNG on a white background with generous internal
 * padding. Two consequences are handled here rather than by editing the file:
 *
 *   - mix-blend-multiply drops the white ground against the near-white page, so
 *     the mark sits on the background instead of inside a visible white square.
 *   - the negative vertical margins claw back the artwork's own padding, which
 *     would otherwise read as an oversized gap above and below the logo.
 *
 * The wordmark is part of the image, so no text is set alongside it.
 */

const SIZES = {
  sm: 'w-20 -my-2',
  md: 'w-28 -my-3',
  lg: 'w-36 -my-4',
  xl: 'w-36 sm:w-40 -my-4',
}

export default function Brand({ size = 'md', showText = false, className = '' }) {
  return (
    <div className={`flex flex-col items-center justify-center ${className}`}>
      <img
        src="/logo.png"
        alt="India AI + Tableau User Group"
        width="498"
        height="498"
        className={`${SIZES[size] || SIZES.md} h-auto object-contain mix-blend-multiply`}
      />
      {showText && (
        <div className="text-center mt-1">
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">India AI + Tableau</h2>
          <div className="flex items-center justify-center gap-2 mt-1">
            <span className="w-6 h-[1.5px] bg-purple-300 rounded-full"></span>
            <span className="text-xs font-semibold tracking-wider text-slate-600">User Group</span>
            <span className="w-6 h-[1.5px] bg-purple-300 rounded-full"></span>
          </div>
        </div>
      )}
    </div>
  )
}
