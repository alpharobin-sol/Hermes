import Link from "next/link"
import { ArrowUpRight } from "lucide-react"

import { cn } from "@/lib/utils"

// The landing page's one way into the app, with a small arrow like Gloam's "Open app ↗"
export function LaunchApp({ className }: { className?: string }) {
  return (
    <Link href="/app" className={cn("btn-teal whitespace-nowrap", className)}>
      Launch app
      <ArrowUpRight className="size-4" aria-hidden="true" />
    </Link>
  )
}
