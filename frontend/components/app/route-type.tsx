"use client"

import { Info } from "lucide-react"

import { cn } from "@/lib/utils"
import type { YieldRoute } from "@/lib/api/yield-api"
import { explainRoute, typeLabel } from "@/lib/route-copy"

// Plain labels for new users: what a route type is, where its yield comes from and how you get out.
// Hidden until the user taps the type, so the card stays clean. What can go wrong has its own line below.

// The route type, as a button that opens the explainer
export function RouteTypeButton({ route, open, onToggle }: { route: YieldRoute; open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-label={`${typeLabel(route)}: what it means`}
      className="inline-flex items-center gap-1 underline decoration-dotted underline-offset-2 hover:text-foreground"
    >
      {typeLabel(route)}
      <Info className="size-3" aria-hidden="true" />
    </button>
  )
}

export function RouteTypeExplainer({ route, className }: { route: YieldRoute; className?: string }) {
  const { what, yieldFrom, out } = explainRoute(route)
  const rows = [
    ["What it is", what],
    ["Yield from", yieldFrom],
    ["Getting out", out],
  ]
  return (
    <dl className={cn("m-0 flex flex-col gap-2 rounded-[2px] border border-hairline bg-card px-3 py-2.5 text-xs leading-relaxed", className)}>
      {rows.map(([term, text]) => (
        <div key={term} className="flex flex-col gap-0.5">
          <dt className="label-roman text-[10px]">{term}</dt>
          <dd className="m-0 text-foreground">{text}</dd>
        </div>
      ))}
    </dl>
  )
}
