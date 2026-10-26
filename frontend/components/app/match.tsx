"use client"

import { useState } from "react"
import Link from "next/link"
import { Info, SlidersHorizontal } from "lucide-react"

import { cn } from "@/lib/utils"
import type { YieldRoute } from "@/lib/api/yield-api"
import { exitTight } from "@/lib/route-copy"
import { isTopRated } from "@/lib/top-rated"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { HORIZONS, estimatedReturn, type Horizon } from "./live-quotes"

// Match: three answers (how much risk, how long, how soon the money may be needed) pick the routes that fit, ranked by
// what each leaves over that time at today's APY once the exit cost is taken off. The shorter the stay, the more a
// costly exit weighs, so a month favours lending and a year favours the highest APY. Answers stay on this device.

export type MatchRisk = "low" | "moderate" | "any"
export type MatchAccess = "any-day" | "can-wait"

export interface MatchPrefs {
  risk: MatchRisk
  horizon: Horizon
  access: MatchAccess
}

// The risk tier's own line: moderate from a Safety Score of 60
const MODERATE_MIN_SCORE = 60

const RISKS: { value: MatchRisk; label: string; short: string; hint: string }[] = [
  { value: "low", label: "Low", short: "Low risk", hint: "Top rated only: Safety 80 or more" },
  { value: "moderate", label: "Moderate", short: "Up to moderate", hint: `Safety ${MODERATE_MIN_SCORE} or more` },
  { value: "any", label: "Any", short: "Any risk", hint: "Every route, scored or not" },
]

const ACCESS: { value: MatchAccess; label: string; hint: string }[] = [
  { value: "any-day", label: "Any day", hint: "Leaves out reserves 95% or more borrowed" },
  { value: "can-wait", label: "It can wait", hint: "Every route, however tight its exit" },
]

const HORIZON_SHORT: Record<Horizon, string> = { "1m": "1 mo", "6m": "6 mo", "1y": "1 yr" }

const KEY = "hermes.match"

export function readMatch(): MatchPrefs | null {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "null")
    if (
      RISKS.some((r) => r.value === saved?.risk) &&
      HORIZONS.some((h) => h.value === saved?.horizon) &&
      ACCESS.some((a) => a.value === saved?.access)
    ) {
      return { risk: saved.risk, horizon: saved.horizon, access: saved.access }
    }
  } catch {
    // Private mode or a bad value: ask again
  }
  return null
}

export function saveMatch(prefs: MatchPrefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs))
  } catch {
    // Private mode: the answers last for this visit
  }
}

export function fitsMatch(route: YieldRoute, prefs: MatchPrefs): boolean {
  if (prefs.access === "any-day" && exitTight(route)) return false
  if (prefs.risk === "low") return isTopRated(route)
  if (prefs.risk === "moderate") return !!route.safety && route.safety.score >= MODERATE_MIN_SCORE && route.risk !== "high"
  return true
}

// What one token leaves over the horizon at today's APY, the exit cost taken off. Null while the exit cost loads.
const matchValue = (route: YieldRoute, horizon: Horizon) => estimatedReturn(route, 1, undefined, horizon)
const scoreOf = (route: YieldRoute) => route.safety?.score ?? -1

// Most left over the horizon first. A route whose exit cost hasn't loaded can't be ranked yet, so it goes last.
// Ties go to the higher Safety Score.
export function compareMatch(horizon: Horizon) {
  return (a: YieldRoute, b: YieldRoute) => {
    const va = matchValue(a, horizon)
    const vb = matchValue(b, horizon)
    if (va === null || vb === null) return (va === null ? 1 : 0) - (vb === null ? 1 : 0) || scoreOf(b) - scoreOf(a)
    return vb - va || scoreOf(b) - scoreOf(a)
  }
}

// "Low risk · 1 yr · Any day"
export function matchSummary(prefs: MatchPrefs): string {
  const risk = RISKS.find((r) => r.value === prefs.risk)!.short
  const access = ACCESS.find((a) => a.value === prefs.access)!.label
  return `${risk} · ${HORIZON_SHORT[prefs.horizon]} · ${access}`
}

export function horizonLong(horizon: Horizon): string {
  return HORIZONS.find((h) => h.value === horizon)!.long
}

// The answers in place of the Top rated toggle while Match sorts the list. Tapping it opens the questions again.
export function MatchChip({ prefs, onChange, compact = false }: { prefs: MatchPrefs; onChange: () => void; compact?: boolean }) {
  return (
    <button
      type="button"
      onClick={onChange}
      aria-label={`Your answers: ${matchSummary(prefs)}. Change`}
      title="Change your answers"
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-[4px] border font-medium text-foreground transition-colors hover:bg-secondary",
        compact ? "h-[38px] border-frame px-2 text-xs" : "h-11 border-border px-3 text-[13px]"
      )}
    >
      <SlidersHorizontal className="size-3.5 text-muted-foreground" aria-hidden="true" />
      {matchSummary(prefs)}
    </button>
  )
}

// One line under the list's header: why the order is what it is
export function MatchNote({ horizon, className }: { horizon: Horizon; className?: string }) {
  return (
    <p className={cn("flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground", className)}>
      <span>Ranked by what&apos;s left after {horizonLong(horizon)}, exit costs taken off.</span>
      <Link href="/docs#match" className="inline-flex items-center gap-1 font-medium text-ink underline-offset-2 hover:underline">
        <Info className="size-3" aria-hidden="true" />
        How it works
      </Link>
    </p>
  )
}

function Question<T extends string>({
  title,
  options,
  value,
  onChange,
  columns,
}: {
  title: string
  options: { value: T; label: string; hint?: string }[]
  value: T
  onChange: (value: T) => void
  columns: number
}) {
  return (
    <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
      <legend className="label-roman mb-2 p-0 text-[10px]">{title}</legend>
      <div role="radiogroup" aria-label={title} className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
        {options.map((option) => {
          const selected = option.value === value
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(option.value)}
              className={cn(
                "flex min-h-11 flex-col items-start gap-0.5 rounded-[4px] border px-3 py-2 text-left transition-colors",
                selected ? "border-foreground bg-secondary" : "border-border bg-background hover:bg-secondary/60"
              )}
            >
              <span className="text-[14px] font-semibold">{option.label}</span>
              {option.hint && <span className="text-[11px] leading-snug text-muted-foreground">{option.hint}</span>}
            </button>
          )
        })}
      </div>
    </fieldset>
  )
}

// The three questions. The button says how many of the token's routes fit, so an answer that leaves none shows before
// the list empties.
export function MatchDialog({
  open,
  onOpenChange,
  initial,
  routes,
  token,
  onSave,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  initial: MatchPrefs
  routes: YieldRoute[] // every route for the token
  token: string
  onSave: (prefs: MatchPrefs) => void
}) {
  const [prefs, setPrefs] = useState(initial)
  const count = routes.filter((route) => fitsMatch(route, prefs)).length

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[452px] gap-0 rounded-[4px] border-gilt bg-card p-[5px] shadow-[0_24px_64px_rgba(0,0,0,0.45)] sm:max-w-[452px] [&>[data-slot=dialog-close]]:right-5 [&>[data-slot=dialog-close]]:top-5">
        <div className="plaque-inner max-h-[calc(100dvh-4rem)] overflow-y-auto">
          <DialogHeader className="gap-0.5 border-b border-hairline p-[18px] pb-3.5 pr-12 text-left">
            <DialogTitle className="font-display text-[26px] font-bold leading-[1.1]">Match routes to you</DialogTitle>
            <DialogDescription className="text-[13px] text-muted-foreground">
              Three questions. Your answers stay on this device.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-5 p-[18px]">
            <Question
              title="How much risk?"
              options={RISKS}
              value={prefs.risk}
              onChange={(risk) => setPrefs({ ...prefs, risk })}
              columns={3}
            />
            <Question
              title="How long will you leave it?"
              options={HORIZONS.map((h) => ({ value: h.value, label: h.long }))}
              value={prefs.horizon}
              onChange={(horizon) => setPrefs({ ...prefs, horizon })}
              columns={3}
            />
            <Question
              title="When might you need it back?"
              options={ACCESS}
              value={prefs.access}
              onChange={(access) => setPrefs({ ...prefs, access })}
              columns={2}
            />

            <p className="m-0 text-xs leading-relaxed text-muted-foreground">
              The routes that fit are ranked by what each leaves after {horizonLong(prefs.horizon)} at today&apos;s APY, the cost of
              getting out taken off. Rates move, so it&apos;s today&apos;s picture, not a promise.
            </p>

            {count === 0 && (
              <p className="m-0 -mb-2 text-center text-[13px] text-warning">No {token} route fits these answers right now.</p>
            )}
            <button type="button" disabled={count === 0} onClick={() => onSave(prefs)} className="btn-teal h-[52px] w-full text-[15px]">
              {count === 0 ? "No match" : `Show ${count} ${token} ${count === 1 ? "match" : "matches"}`}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
