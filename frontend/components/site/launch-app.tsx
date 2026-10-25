import Link from "next/link"
import { ArrowUpRight } from "lucide-react"

import { cn } from "@/lib/utils"

// The landing page's one way into the app, with a small arrow like Gloam's "Open app ↗".
// A route page opens the app on its route (/app?route=jito).
export function LaunchApp({ className, href = "/app" }: { className?: string; href?: string }) {
  return (
    <Link href={href} className={cn("btn-teal whitespace-nowrap", className)}>
      Launch app
      <ArrowUpRight className="size-4" aria-hidden="true" />
    </Link>
  )
}
