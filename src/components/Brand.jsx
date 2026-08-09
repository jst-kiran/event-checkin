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
  sm: 'w-24 -my-2',
  md: 'w-32 -my-3',
  lg: 'w-44 sm:w-52 -my-5 sm:-my-6',
}

export default function Brand({ size = 'md', className = '' }) {
  return (
    <div className={`flex items-center justify-center ${className}`}>
      <img
        src="/logo.png"
        alt="India AI + Tableau User Group"
        width="498"
        height="498"
        className={`${SIZES[size] || SIZES.md} h-auto object-contain mix-blend-multiply`}
      />
    </div>
  )
}
