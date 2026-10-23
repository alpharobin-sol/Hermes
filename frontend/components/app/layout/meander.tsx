import { useId } from "react"

// Greek key band, drawn as a repeating SVG pattern in the gilt color
export function Meander({ className }: { className?: string }) {
  const id = useId()
  return (
    <svg width="100%" height="14" aria-hidden="true" className={className} style={{ display: "block" }}>
      <defs>
        <pattern id={id} width="20" height="14" patternUnits="userSpaceOnUse">
          <path d="M0 1.5H20M0 12.5H20M3 12.5V4.5H14V10H8V7.5H11" fill="none" stroke="var(--gilt)" strokeWidth="1.25" />
        </pattern>
      </defs>
      <rect width="100%" height="14" fill={`url(#${id})`} />
    </svg>
  )
}

// Rule, diamond, rule: the divider between sections
export function DiamondRule({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" className={className}>
      <div className="flex items-center gap-4">
        <span className="h-px flex-1 bg-frame" />
        <span className="size-2 rotate-45 bg-gilt" />
        <span className="h-px flex-1 bg-frame" />
      </div>
    </div>
  )
}
