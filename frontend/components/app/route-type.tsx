"use client"

import { Info } from "lucide-react"

import { cn } from "@/lib/utils"
import type { YieldRoute } from "@/lib/api/yield-api"
import { CATEGORY_LABELS } from "./rate-board"

// Plain labels for new users: what a route type is, where its yield comes from and how you get out.
// Hidden until the user taps the type, so the card stays clean. What can go wrong has its own line below.

function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "")
  } catch {
    return url
  }
}

function explain(route: YieldRoute): { what: string; yieldFrom: string; out: string } {
  if (route.category === "lending") {
    return {
      what: `You lend your ${route.token} to borrowers through ${route.name}. ${
        route.receipt ? `You get ${route.receipt}, which grows as interest comes in.` : "It sits in your own account there."
      }`,
      yieldFrom: "The interest borrowers pay. It moves up and down as they borrow more or less.",
      out: `Withdraw at ${hostOf(route.website)} whenever the reserve has room.`,
    }
  }
  const receipt = route.receipt ?? "a staking token"
  return {
    what: `You swap SOL for ${receipt}. It stays in your wallet, and each ${receipt} is worth a little more SOL every few days.`,
    yieldFrom: "Solana's staking rewards, paid to the validators the protocol stakes with.",
    out: "Swap back to SOL at the market price any time.",
  }
}

// The route type, as a button that opens the explainer
export function RouteTypeButton({ route, open, onToggle }: { route: YieldRoute; open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-label={`${CATEGORY_LABELS[route.category]}: what it means`}
      className="inline-flex items-center gap-1 underline decoration-dotted underline-offset-2 hover:text-foreground"
    >
      {CATEGORY_LABELS[route.category]}
      <Info className="size-3" aria-hidden="true" />
    </button>
  )
}

export function RouteTypeExplainer({ route, className }: { route: YieldRoute; className?: string }) {
  const { what, yieldFrom, out } = explain(route)
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
