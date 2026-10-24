"use client"

import { useState } from "react"

import { cn } from "@/lib/utils"
import type { SafetyDeduction, SafetyPart } from "@/lib/api/yield-api"

export interface ShowcaseRoute {
  id: string
  name: string
  subtitle: string // "JitoSOL · Liquid staking"
  score: number
  parts: SafetyPart[]
  deductions: SafetyDeduction[]
}

export interface ShowcaseOption {
  label: string // "Highest score"
  route: ShowcaseRoute
}

// Low risk from 80, moderate from 60, the same bands the app uses
const scoreColor = (score: number) => (score >= 80 ? "text-success" : score >= 60 ? "text-warning" : "text-destructive")

// A live route's Safety Score, part by part, the way the app's Why panel shows it. The switch flips between the
// highest and lowest scoring routes, so the score is seen doing its job.
export function ScoreShowcase({ options }: { options: ShowcaseOption[] }) {
  const [index, setIndex] = useState(0)
  const route = options[index]?.route ?? options[0].route

  return (
    <div className="flex w-full max-w-[520px] flex-col items-center gap-4">
      {options.length > 1 && (
        <div role="group" aria-label="Route shown" className="flex gap-0.5 rounded-full border border-frame bg-card p-1">
          {options.map((option, i) => (
            <button
              key={option.label}
              type="button"
              aria-pressed={i === index}
              onClick={() => setIndex(i)}
              className={cn(
                "h-9 rounded-full px-4 text-[13px] font-semibold transition-colors",
                i === index ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}

      <div className="plaque w-full shadow-[0_28px_60px_-34px_rgba(43,20,14,0.55)]">
        <div className="plaque-inner">
          <div className="flex items-center gap-3 border-b border-hairline px-4 py-3.5">
            <span aria-hidden="true" className="medallion size-10">
              {route.name.charAt(0)}
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate font-display text-[22px] font-bold leading-[1.1]">{route.name}</span>
              <span className="text-xs text-muted-foreground">{route.subtitle}</span>
            </span>
            <span className="flex items-baseline gap-1">
              <span className={cn("font-roman text-[34px] font-bold leading-none", scoreColor(route.score))}>{route.score}</span>
              <span className="text-xs text-muted-foreground">/ 100</span>
            </span>
          </div>

          <ul className="m-0 flex list-none flex-col gap-3 p-4">
            {route.parts.map((part) => (
              <li key={part.key} className="flex flex-col gap-1">
                <span className="flex items-baseline justify-between gap-3 text-xs">
                  <span className="font-semibold text-foreground">{part.label}</span>
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
              </li>
            ))}
            {route.deductions.map((deduction, i) => (
              <li key={`${deduction.key}-${i}`} className="flex flex-col gap-1">
                <span className="flex items-baseline justify-between gap-3 text-xs">
                  <span className="font-semibold text-foreground">{deduction.label}</span>
                  <span className={deduction.points < 0 ? "font-semibold text-destructive" : "text-muted-foreground"}>
                    {deduction.points < 0 ? `−${-deduction.points}` : "0"}
                  </span>
                </span>
                <span className="text-[11px] leading-relaxed text-muted-foreground">
                  {deduction.detail} Source:{" "}
                  {deduction.link ? (
                    <a href={deduction.link} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
                      {deduction.source}
                    </a>
                  ) : (
                    deduction.source
                  )}
                  .
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <p className="text-center text-xs text-muted-foreground">Live from the Hermes API. Every route in the app opens this under Why.</p>
    </div>
  )
}
