import { useId } from 'react'

// The brand mark: a barber pole on the green square. Fixed colors: they never change with the theme.
const GREEN = '#1E4D3A'
const CREAM = '#F4EDDF'
const RED = '#B23A2C'
const BRASS = '#C8963E'

/** The pole alone, in a 24 × 64 box: red and cream stripes between brass caps. */
export function Pole({ x, y, width, height }: { x?: number; y?: number; width?: number; height?: number }) {
  const stripe = `${useId()}stripe`
  return (
    <svg x={x} y={y} width={width} height={height} viewBox="0 0 24 64" aria-hidden="true" focusable="false">
      <defs>
        <pattern id={stripe} width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(-40)">
          <rect width="10" height="10" fill={CREAM} />
          <rect width="5" height="10" fill={RED} />
        </pattern>
      </defs>
      <rect x="5" y="5" width="14" height="54" rx="7" fill={`url(#${stripe})`} />
      <rect x="5" y="5" width="14" height="54" rx="7" fill="none" stroke="#1F1A14" strokeOpacity=".25" />
      <rect x="2" y="0" width="20" height="8" rx="4" fill={BRASS} />
      <rect x="2" y="56" width="20" height="8" rx="4" fill={BRASS} />
    </svg>
  )
}

export function Mark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <rect width="64" height="64" rx="15" fill={GREEN} />
      <rect x="3.5" y="3.5" width="57" height="57" rx="12" fill="none" stroke={CREAM} strokeOpacity=".6" strokeWidth="1.5" />
      <Pole x={20} y={9} width={24} height={46} />
    </svg>
  )
}
