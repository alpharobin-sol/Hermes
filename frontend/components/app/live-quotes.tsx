"use client"

import { useEffect, useRef, useState } from "react"

import { cn } from "@/lib/utils"
import type { YieldRoute } from "@/lib/api/yield-api"
import { DepositAPI, type RouteQuote } from "@/lib/api/deposit-api"
import { formatTokenAmount } from "./tokens"

// Live quotes: type an amount and every route quotes it at once, the way a swap aggregator compares venues.
// Quotes refresh every 15 seconds while the page is in view. The best one is the route that leaves the most
// after a year at today's APY, once the entry cost (price impact, trading under value) is taken off.

const REFRESH_MS = 15_000
const DEBOUNCE_MS = 400

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
        const quotes = await DepositAPI.quoteRoutes(token, amount, idsKey.split(","), { signal: controller.signal })
        if (cancelled) return
        setState((prev) => ({
          byRoute: { ...prev.byRoute, ...Object.fromEntries(quotes.map((quote) => [quote.routeId, quote])) },
          status: "ready",
          nextAt: Date.now() + REFRESH_MS,
        }))
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

// What the route leaves after a year at today's APY, entry cost taken off. Without a quote, the APY alone.
export function estimatedYear(route: YieldRoute, amount: number, quote?: RouteQuote): number {
  const value = quote?.value ? Number(quote.value) : amount
  return value * (1 + route.apy) - amount
}

// The route among `routes` whose quote leaves the most after a year, when any have quotes
export function bestQuoteRoute(routes: YieldRoute[], amount: number, live: LiveQuotes): YieldRoute | null {
  let best: YieldRoute | null = null
  let bestValue = -Infinity
  for (const route of routes) {
    const quote = live.byRoute[route.id]
    if (!quote?.quote) continue
    const year = estimatedYear(route, amount, quote)
    if (year > bestValue) {
      best = route
      bestValue = year
    }
  }
  return best
}

// "You get 0.7653 JitoSOL", the entry cost when it is worth saying, or why the route can't quote
export function quoteLine(route: YieldRoute, quote?: RouteQuote): string | null {
  if (!quote) return null
  if (!quote.quote) return quote.error
  const q = quote.quote
  const got = q.position
    ? `Held in your ${q.position} account`
    : `You get ${formatTokenAmount(Number(q.outAmount), route.token === "SOL" ? "SOL" : q.outputToken.symbol)} ${q.outputToken.symbol}`
  const cost = quote.entryCost
  if (cost === null || Math.abs(cost) < 0.0001) return got
  return cost > 0 ? `${got} · ${(cost * 100).toFixed(2)}% entry cost` : `${got} · ${(-cost * 100).toFixed(2)}% under value`
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
