"use client"

import { ChevronDown } from "lucide-react"

import { cn } from "@/lib/utils"
import type { YieldRoute } from "@/lib/api/yield-api"
import { RISK_LEVELS } from "./rate-board"

export type SortBy = "safety" | "apy"

export const SORT_OPTIONS: { value: SortBy; label: string }[] = [
  { value: "safety", label: "Safety" },
  { value: "apy", label: "APY" },
]

// Unscored routes sort last
const scoreOf = (route: YieldRoute) => route.safety?.score ?? -1

export function compareRoutes(sortBy: SortBy) {
  return (a: YieldRoute, b: YieldRoute) => (sortBy === "safety" ? scoreOf(b) - scoreOf(a) || b.apy - a.apy : b.apy - a.apy)
}

// The highest APY among the routes shown: the one "Best APY" marks, wherever the sort puts it
export function bestApyRoute(routes: YieldRoute[]): YieldRoute | null {
  return routes.reduce<YieldRoute | null>((best, route) => (!best || route.apy > best.apy ? route : best), null)
}

function riskLevel(route: YieldRoute) {
  return RISK_LEVELS.find((level) => level.value === route.risk) ?? RISK_LEVELS[2]
}

// "Safety 92", or "Not scored" while part of the score's data is missing
export function safetyText(route: YieldRoute): string {
  return route.safety ? `Safety ${route.safety.score}` : "Not scored"
}

// Board column: the score in the risk level's color, with the level under it
export function SafetyCell({ route }: { route: YieldRoute }) {
  const level = riskLevel(route)
  return (
    <span className="flex flex-col gap-0.5" title="Safety Score: size, track record, 30-day outflows and exit">
      <span className={cn("font-roman text-lg font-bold leading-none", route.safety ? level.text : "text-muted-foreground")}>
        {route.safety ? route.safety.score : "—"}
      </span>
      <span className="text-[11px] text-muted-foreground">{level.label} risk</span>
    </span>
  )
}

// Sort toggle for route lists
export function SortToggle({ value, onChange, compact = false }: { value: SortBy; onChange: (sort: SortBy) => void; compact?: boolean }) {
  return (
    <div role="group" aria-label="Sort by" className={cn("flex gap-0.5 rounded-[4px] border p-0.5", compact ? "border-frame" : "border-border p-[3px]")}>
      {SORT_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
          className={cn(
            "inline-flex items-center rounded-[2px] font-medium transition-colors",
            compact ? "h-8 px-2 text-xs" : "h-9 px-2.5 text-[13px] md:px-3",
            option.value === value
              ? compact
                ? "bg-card text-foreground"
                : "bg-secondary text-foreground"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

// What each part of the selected route's score measured, with its points and source. Closed by default.
export function SafetyBreakdown({ route, className }: { route: YieldRoute; className?: string }) {
  const level = riskLevel(route)

  if (!route.safety) {
    return (
      <p className={cn("text-xs leading-relaxed text-muted-foreground", className)}>
        Not scored right now: some of the data behind the Safety Score is unavailable. The risk level comes from TVL.
      </p>
    )
  }

  return (
    <details className={cn("group rounded-[2px] border border-hairline bg-card", className)}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3.5 py-2.5 [&::-webkit-details-marker]:hidden">
        <span className="flex items-baseline gap-2">
          <span className="label-roman text-[10px]">Safety Score</span>
          <span className={cn("font-roman text-[17px] font-bold", level.text)}>{route.safety.score}</span>
          <span className="whitespace-nowrap text-xs text-muted-foreground">/ 100</span>
        </span>
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          Why
          <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" />
        </span>
      </summary>
      <div className="flex flex-col gap-3 border-t border-hairline px-3.5 py-3">
        {route.safety.parts.map((part) => (
          <div key={part.key} className="flex flex-col gap-1">
            <span className="flex items-baseline justify-between gap-3 text-xs">
              <span className="font-medium text-foreground">{part.label}</span>
              <span className="text-muted-foreground">
                {part.points}/{part.max}
              </span>
            </span>
            <span className="h-1 rounded-[1px] bg-hairline" aria-hidden="true">
              <span className="block h-1 rounded-[1px] bg-foreground/60" style={{ width: `${(part.points / part.max) * 100}%` }} />
            </span>
            <span className="text-[11px] leading-relaxed text-muted-foreground">
              {part.detail} Source: {part.source}.
            </span>
          </div>
        ))}
        <p className="text-[11px] leading-relaxed text-muted-foreground">Not covered: smart contract bugs and depegs.</p>
      </div>
    </details>
  )
}
