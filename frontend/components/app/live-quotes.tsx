"use client"

import { useEffect, useRef, useState } from "react"

import { cn } from "@/lib/utils"
import type { YieldRoute } from "@/lib/api/yield-api"
import { formatTokenAmount } from "./tokens"
import { DepositAPI, type DepositQuote, type RouteQuote, type ServerRouteQuote, type SwapToQuote } from "@/lib/api/deposit-api"

// Live quotes: type an amount and every route quotes it at once, the way a swap aggregator compares venues.
// The API quotes the direct deposits (Jito's stake pool, Marinade, Kamino Lend, Jupiter Lend) and hands back
// the Jupiter swaps, which this browser quotes itself: Jupiter limits requests per IP, and the API's IP is shared.
// Each route keeps whichever path gives more of the token, the way the deposit does. Quotes refresh every 15
// seconds while the page is in view. The best one is the route that leaves the most over the chosen horizon (a month,
// six months or a year) at today's APY, once the entry cost (price impact, trading under value) and the exit cost
// (selling back to SOL at today's price) are taken off. The shorter the horizon, the more those costs weigh.

const REFRESH_MS = 15_000
const DEBOUNCE_MS = 400
const JUPITER_QUOTE = "https://lite-api.jup.ag/swap/v1/quote"
// Jupiter allows about 5 quotes per IP every few seconds, so swaps go one at a time, a little apart
const SWAP_CONCURRENCY = 1
const SWAP_GAP_MS = 150
const MAX_RESET_WAIT_MS = 3000
// Same rules as the deposit: no swap over 1% price impact, and a direct deposit unless a swap gives 0.01% more
const MAX_PRICE_IMPACT_PCT = 1
const DIRECT_TIE_SHARE = 0.0001
const RETRY_LATER = "No quote right now. It will retry."

async function jupiterQuote(routeId: string, swap: SwapToQuote, inputSymbol: string, signal: AbortSignal): Promise<DepositQuote> {
  const params = new URLSearchParams({
    inputMint: swap.inputMint,
    outputMint: swap.outputMint,
    amount: swap.rawAmount,
    slippageBps: "50",
  })
  let res = await fetch(`${JUPITER_QUOTE}?${params}`, { signal })
  // Over the limit: wait for Jupiter's reset (at most 3 seconds) and try once more
  if (res.status === 429) {
    const reset = Number(res.headers.get("x-ratelimit-reset")) * 1000
    const wait = Number.isFinite(reset) && reset > Date.now() ? Math.min(MAX_RESET_WAIT_MS, reset - Date.now()) : 1500
    await new Promise((resolve) => setTimeout(resolve, wait))
    res = await fetch(`${JUPITER_QUOTE}?${params}`, { signal })
  }
  const json = await res.json().catch(() => ({}))
  if (!res.ok || !json?.outAmount) throw new Error(RETRY_LATER)
  const ui = (raw: string, decimals: number) => String(Number(raw) / 10 ** decimals)
  return {
    network: "mainnet-beta",
    routeId,
    method: "jupiter-swap",
    inputToken: { symbol: inputSymbol, mint: swap.inputMint, decimals: swap.inputDecimals },
    outputToken: { symbol: swap.outputSymbol, mint: swap.outputMint, decimals: swap.outputDecimals },
    inAmount: ui(json.inAmount, swap.inputDecimals),
    outAmount: ui(json.outAmount, swap.outputDecimals),
    minOutAmount: ui(json.otherAmountThreshold, swap.outputDecimals),
    priceImpactPct: Number(json.priceImpactPct) * 100,
    slippageBps: json.slippageBps ?? 50,
    routeLabels: (json.routePlan || []).map((step: any) => step.swapInfo?.label).filter(Boolean),
    compared: [],
    position: null,
  }
}

// The route's quote: the API's direct deposit, this browser's Jupiter swap, or the better of the two
async function settle(server: ServerRouteQuote, inputSymbol: string, signal: AbortSignal): Promise<RouteQuote> {
  const base = { routeId: server.routeId, quote: null, value: null, entryCost: null }
  if (server.error) return { ...base, error: server.error }

  let swap: DepositQuote | null = null
  let swapError: string | null = null
  // Lending has a direct deposit at its share rate. A swap to the receipt token only routes through it.
  if (server.swap && !(server.quote && !server.tokenValue)) {
    try {
      swap = await jupiterQuote(server.routeId, server.swap, inputSymbol, signal)
      if (swap.priceImpactPct > MAX_PRICE_IMPACT_PCT) {
        swapError = `Price impact is ${swap.priceImpactPct.toFixed(2)}% for ${swap.outputToken.symbol}. Try a smaller amount or another route.`
        swap = null
      }
    } catch (error) {
      if (signal.aborted) throw error
      swapError = RETRY_LATER
    }
  }

  const direct = server.quote
  let chosen = direct ?? swap
  if (direct && swap) {
    const lead = (Number(swap.outAmount) - Number(direct.outAmount)) / Number(swap.outAmount)
    chosen = lead >= DIRECT_TIE_SHARE ? swap : direct
  }
  if (!chosen) return { ...base, error: swapError ?? RETRY_LATER }

  // Worth right after: tokens times their pool value, or for lending the amount (scaled when a swap gives more)
  const amountIn = Number(chosen.inAmount)
  let value: number | null = null
  if (server.tokenValue) value = Number(chosen.outAmount) * server.tokenValue
  else if (chosen === direct) value = Number(server.value ?? chosen.inAmount)
  else if (direct) value = (amountIn * Number(chosen.outAmount)) / Number(direct.outAmount)
  return {
    routeId: server.routeId,
    quote: chosen,
    value: value === null ? null : String(value),
    entryCost: value === null ? null : 1 - value / amountIn,
    error: null,
  }
}

export interface LiveQuotes {
  byRoute: Record<string, RouteQuote>
  status: "idle" | "loading" | "ready"
  nextAt: number | null // when the next refresh runs
}

const IDLE: LiveQuotes = { byRoute: {}, status: "idle", nextAt: null }

export function useLiveQuotes(token: string, amount: number, routeIds: string[], paused: boolean): LiveQuotes {
  const [state, setState] = useState<LiveQuotes>(IDLE)
  const pausedRef = useRef(paused)
  const lastAmountKey = useRef("")
  useEffect(() => {
    pausedRef.current = paused
  }, [paused])

  const amountKey = `${token}:${amount}`
  const idsKey = routeIds.join(",")

  useEffect(() => {
    if (!(amount > 0) || !idsKey) {
      lastAmountKey.current = ""
      setState(IDLE)
      return
    }
    // A new amount or token makes the old quotes wrong. A new set of routes keeps the ones it has.
    const fresh = lastAmountKey.current !== amountKey
    lastAmountKey.current = amountKey
    setState((prev) => ({ byRoute: fresh ? {} : prev.byRoute, status: "loading", nextAt: null }))

    let cancelled = false
    let timer: ReturnType<typeof setTimeout>
    const controller = new AbortController()
    const run = async () => {
      if (cancelled) return
      // Paused while the deposit dialog is open or the tab is hidden: check again shortly
      if (pausedRef.current || document.hidden) {
        timer = setTimeout(run, 2000)
        return
      }
      setState((prev) => ({ ...prev, status: "loading" }))
      try {
        const server = await DepositAPI.quoteRoutes(token, amount, idsKey.split(","), { signal: controller.signal })
        if (cancelled) return
        // Rows fill in as each quote lands. A refused refresh keeps the last good quote for this amount.
        const apply = (quote: RouteQuote) =>
          setState((prev) => {
            const old = prev.byRoute[quote.routeId]
            const keep = quote.error === RETRY_LATER && old?.quote
            return { ...prev, byRoute: { ...prev.byRoute, [quote.routeId]: keep ? old : quote } }
          })
        const queue = [...server]
        await Promise.all(
          Array.from({ length: SWAP_CONCURRENCY }, async () => {
            for (let next = queue.shift(); next; next = queue.shift()) {
              const quote = await settle(next, token, controller.signal)
              if (cancelled) return
              apply(quote)
              if (next.swap) await new Promise((resolve) => setTimeout(resolve, SWAP_GAP_MS))
            }
          })
        )
        if (cancelled) return
        setState((prev) => ({ ...prev, status: "ready", nextAt: Date.now() + REFRESH_MS }))
      } catch {
        if (cancelled) return
        // Keep what was there and try again on the next tick
        setState((prev) => ({ ...prev, status: Object.keys(prev.byRoute).length ? "ready" : "idle", nextAt: Date.now() + REFRESH_MS }))
      }
      timer = setTimeout(run, REFRESH_MS)
    }
    timer = setTimeout(run, DEBOUNCE_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
      controller.abort()
    }
  }, [amountKey, idsKey, token, amount])

  return state
}

// How long the money stays in: what the rows and the best quote count over
export type Horizon = "1m" | "6m" | "1y"

export const HORIZONS: { value: Horizon; label: string; long: string; years: number }[] = [
  { value: "1m", label: "1M", long: "1 month", years: 1 / 12 },
  { value: "6m", label: "6M", long: "6 months", years: 0.5 },
  { value: "1y", label: "1Y", long: "1 year", years: 1 },
]

const horizonYears = (horizon: Horizon) => HORIZONS.find((h) => h.value === horizon)!.years

// After the figure on a row: "/ yr", "in 6 mo", "in 1 mo"
export function horizonSuffix(horizon: Horizon): string {
  return horizon === "1y" ? "/ yr" : horizon === "6m" ? "in 6 mo" : "in 1 mo"
}

/**
 * What the route leaves over the horizon at today's APY: what the deposit is worth right after entry (the live
 * quote's entry cost taken off), grown at the APY, less the exit cost of selling back at today's price. Without a
 * quote, the APY and exit cost alone. Rates move, so it is today's picture, not a promise.
 */
export function estimatedReturn(route: YieldRoute, amount: number, quote: RouteQuote | undefined, horizon: Horizon): number {
  const entered = quote?.value ? Number(quote.value) : amount
  const grown = entered * (1 + route.apy) ** horizonYears(horizon)
  // A missing exit cost (its quote still loading) counts as none, and the dialog says so
  return grown * (1 - (route.exitCost ?? 0)) - amount
}

// A signed amount earned. Too small for the token's usual decimals (a month on a small deposit), it keeps two
// significant digits instead of reading +0.0000.
export function formatEarned(value: number, token: string): string {
  const abs = Math.abs(value)
  const tiny = abs >= 1e-6 && abs < (token === "SOL" ? 0.0001 : 0.01)
  return `${value < 0 ? "−" : "+"}${tiny ? abs.toPrecision(2) : formatTokenAmount(abs, token)}`
}

// The route among `routes` whose quote leaves the most over the horizon, when any have quotes
export function bestQuoteRoute(routes: YieldRoute[], amount: number, live: LiveQuotes, horizon: Horizon): YieldRoute | null {
  let best: YieldRoute | null = null
  let bestValue = -Infinity
  for (const route of routes) {
    const quote = live.byRoute[route.id]
    if (!quote?.quote) continue
    const value = estimatedReturn(route, amount, quote, horizon)
    if (value > bestValue) {
      best = route
      bestValue = value
    }
  }
  return best
}

// How long the money stays in. Entry and exit costs weigh more the shorter it is.
export function HorizonToggle({ value, onChange, compact = false }: { value: Horizon; onChange: (horizon: Horizon) => void; compact?: boolean }) {
  return (
    <div role="group" aria-label="How long" className={cn("flex gap-0.5 rounded-[4px] border p-0.5", compact ? "border-frame" : "border-border p-[3px]")}>
      {HORIZONS.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          aria-label={option.long}
          title={`What each route leaves after ${option.long}, entry and exit costs taken off`}
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

// A deposit's three horizons side by side, for the deposit dialog
export function HorizonSummary({ route, amount, quote }: { route: YieldRoute; amount: number; quote?: RouteQuote }) {
  return (
    <div className="flex flex-col gap-2 rounded-[2px] border border-hairline bg-background px-3.5 py-3">
      <span className="label-roman text-[10px]">After costs, at today&apos;s APY</span>
      <dl className="m-0 grid grid-cols-3 gap-2">
        {HORIZONS.map((h) => {
          const value = estimatedReturn(route, amount, quote, h.value)
          return (
            <div key={h.value} className="flex flex-col gap-0.5">
              <dt className="text-[11px] text-muted-foreground">{h.long}</dt>
              <dd className={cn("m-0 text-[14px] font-semibold", value < 0 && "text-warning")}>
                {formatEarned(value, route.token)} <span className="text-[11px] font-medium">{route.token}</span>
              </dd>
            </div>
          )
        })}
      </dl>
      <p className="m-0 text-[11px] leading-relaxed text-muted-foreground">
        {route.category !== "liquid-staking"
          ? "Lending enters and leaves at face value. Rates move."
          : typeof route.exitCost === "number"
            ? `Entry cost and the cost of selling ${route.receipt ?? "the token"} back to SOL at today's price taken off. Rates move.`
            : `Entry cost taken off. The cost of selling ${route.receipt ?? "the token"} back to SOL isn't available right now, so it isn't. Rates move.`}
      </p>
    </div>
  )
}


// The pulsing dot and countdown over the quotes, like a swap app's live indicator
export function LiveBadge({ live, className }: { live: LiveQuotes; className?: string }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  const loading = live.status === "loading"
  const seconds = live.nextAt ? Math.max(0, Math.ceil((live.nextAt - now) / 1000)) : null
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground", className)} aria-live="polite">
      <span className="relative flex size-2" aria-hidden="true">
        {loading && <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-75" />}
        <span className="relative inline-flex size-2 rounded-full bg-success" />
      </span>
      {loading ? "Fetching quotes" : seconds !== null ? `Live · ${seconds}s` : "Live"}
    </span>
  )
}
