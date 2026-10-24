import { cn } from "@/lib/utils"

// A small olive dot with a slow ring: the number next to it is live
export function LiveDot({ className }: { className?: string }) {
  return (
    <span aria-hidden="true" className={cn("relative flex size-2", className)}>
      <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-50 [animation-duration:2s] motion-reduce:hidden" />
      <span className="relative inline-flex size-2 rounded-full bg-success" />
    </span>
  )
}
