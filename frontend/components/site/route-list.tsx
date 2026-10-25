import Link from "next/link"
import { ChevronRight } from "lucide-react"

import { cn } from "@/lib/utils"
import type { YieldRoute } from "@/lib/api/yield-api"
import { isTopRated } from "@/lib/top-rated"
import { routePath, typeLabel } from "@/lib/route-copy"
import { scoreColor } from "./score-showcase"

export const percent = (apy: number) => `${(apy * 100).toFixed(2)}%`

// Safety first, then APY: the app's default sort
export const bySafety = (a: YieldRoute, b: YieldRoute) => (b.safety?.score ?? -1) - (a.safety?.score ?? -1) || b.apy - a.apy

// Routes as rows that open their own pages: the name, what you hold, the Safety Score and today's APY.
// The best APY among them is teal, and the page's own route is marked.
export function RouteList({ routes, currentId }: { routes: YieldRoute[]; currentId?: string }) {
  const best = Math.max(...routes.map((route) => route.apy))
  return (
    <ul className="m-0 list-none p-0">
      {routes.map((route) => {
        const current = route.id === currentId
        return (
          <li key={route.id} className="border-t border-hairline first:border-t-0">
            <Link
              href={routePath(route)}
              aria-current={current ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-secondary/60 md:px-5",
                current && "bg-ink-surface hover:bg-ink-surface"
              )}
            >
              <span aria-hidden="true" className="medallion size-9 shrink-0 text-sm">
                {route.name.charAt(0)}
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate font-display text-[19px] font-bold leading-tight">{route.name}</span>
                  {current && (
                    <span className="shrink-0 rounded-full border border-ink-line px-2 py-px text-[10px] font-semibold text-ink">This route</span>
                  )}
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {route.receipt ? `${route.receipt} · ` : ""}
                  {typeLabel(route)}
                </span>
              </span>
              <span className="flex shrink-0 flex-col items-end gap-0.5">
                <span className={cn("font-roman text-[16px] font-bold", route.apy === best && "text-ink")}>
                  {percent(route.apy)} <span className="font-sans text-[11px] font-medium text-muted-foreground">APY</span>
                </span>
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  {isTopRated(route) && <span className="diamond" title="Top rated" />}
                  {route.safety ? (
                    <span>
                      Safety <span className={cn("font-semibold", scoreColor(route.safety.score))}>{route.safety.score}</span>
                    </span>
                  ) : (
                    "Not scored"
                  )}
                </span>
              </span>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
