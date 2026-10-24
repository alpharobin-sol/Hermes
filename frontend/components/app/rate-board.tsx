"use client"

import Image from "next/image"
import { AlertCircle, RotateCw } from "lucide-react"

import { cn } from "@/lib/utils"
import type { RiskTier, YieldRoute } from "@/lib/api/yield-api"
import { formatUSD } from "@/lib/helpers/formatters"
import { formatTokenAmount } from "./tokens"
import { LiveBadge, bestQuoteRoute, estimatedYear, quoteLine, type LiveQuotes } from "./live-quotes"
import type { RouteQuote } from "@/lib/api/deposit-api"
import {
  TOP_ROUTES,
  SafetyCell,
  SortToggle,
  ViewToggle,
  bestApyRoute,
  listedRoutes,
  safetyText,
  showAllLabel,
  type SortBy,
  type View,
} from "./safety"

export const RISK_LEVELS: { value: RiskTier; label: string; color: string; text: string }[] = [
  { value: "low", label: "Low", color: "bg-success", text: "text-success" },
  { value: "moderate", label: "Moderate", color: "bg-warning", text: "text-warning" },
  { value: "high", label: "High", color: "bg-destructive", text: "text-destructive" },
]

export const CATEGORY_LABELS: Record<YieldRoute["category"], string> = {
  "liquid-staking": "Liquid staking",
  lending: "Lending",
}

// Above this share borrowed, a lending reserve may not have liquidity for withdrawals
export const HIGH_UTILIZATION = 0.95

export function borrowedPercent(route: YieldRoute): number | null {
  return typeof route.utilization === "number" ? Math.min(100, Math.round(route.utilization * 100)) : null
}

// Lending sources that report what can leave right now instead of what is borrowed (Jupiter Lend)
export function withdrawablePercent(route: YieldRoute): number | null {
  return typeof route.utilization !== "number" && typeof route.withdrawable === "number"
    ? Math.round(route.withdrawable * 100)
    : null
}

// Little can be withdrawn right now: 95% or more of the reserve is borrowed or held back
export function exitTight(route: YieldRoute): boolean {
  if (typeof route.utilization === "number") return route.utilization >= HIGH_UTILIZATION
  return typeof route.withdrawable === "number" && route.withdrawable <= 1 - HIGH_UTILIZATION
}

export function formatApy(route: YieldRoute): string {
  return `${(route.apy * 100).toFixed(2)}%`
}

// The route's first letter in a round medallion, like the marks on the Hermes banner
export function Medallion({ route, className }: { route: YieldRoute; className?: string }) {
  return (
    <span aria-hidden="true" className={cn("medallion", className)}>
      {route.name.charAt(0)}
    </span>
  )
}

// 1024 to 1279px leaves out est. yearly: the deposit panel shows it for the selected route
const GRID =
  "lg:grid lg:grid-cols-[minmax(0,1fr)_104px_80px_100px_20px] lg:gap-4 xl:grid-cols-[minmax(0,1fr)_104px_120px_80px_100px_20px]"

interface RateBoardProps {
  live: LiveQuotes
  tokens: { symbol: string; icon: string; count: number }[]
  token: string
  onToken: (symbol: string) => void
  view: View
  onView: (view: View) => void
  expanded: boolean // all routes in the view, not just the top three
  onExpandedChange: (expanded: boolean) => void
  sortBy: SortBy
  onSort: (sort: SortBy) => void
  routes: YieldRoute[] // for the token, in the view, in sortBy order
  totalForToken: number
  selectedId: string | null
  onSelect: (id: string) => void
  amount: number
  loading: boolean
  error: string | null
  onRetry: () => void
  className?: string
}

export function RateBoard({
  live,
  tokens,
  token,
  onToken,
  view,
  onView,
  expanded,
  onExpandedChange,
  sortBy,
  onSort,
  routes,
  totalForToken,
  selectedId,
  onSelect,
  amount,
  loading,
  error,
  onRetry,
  className,
}: RateBoardProps) {
  const hidden = totalForToken - routes.length
  // The best quote for the amount once quotes are in, the best APY until then
  const quoted = amount > 0 ? bestQuoteRoute(routes, amount, live) : null
  const best = quoted ?? bestApyRoute(routes)
  const listed = listedRoutes(routes, expanded, selectedId, quoted?.id)

  return (
    <div className={cn("plaque min-w-0 flex-[999_1_600px]", className)}>
      <div className="plaque-inner overflow-hidden">
        {/* Token, sort and view */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline px-3 py-3 md:px-[18px] md:py-3.5">
          {/* Phones pick the token in the deposit card, so the board shows a title there */}
          <h2 className="font-roman text-[13px] font-bold tracking-[0.14em] lg:hidden">
            {loading || error ? `${token} routes` : `Compare ${totalForToken} ${token} ${totalForToken === 1 ? "route" : "routes"}`}
          </h2>
          <div role="group" aria-label="Token" className="hidden flex-wrap gap-1.5 lg:flex">
            {tokens.map((t) => {
              const active = t.symbol === token
              return (
                <button
                  key={t.symbol}
                  type="button"
                  aria-pressed={active}
                  onClick={() => onToken(t.symbol)}
                  className={cn(
                    "inline-flex h-11 items-center gap-2.5 rounded-full border pl-2 pr-3.5 text-sm font-semibold transition-colors",
                    active
                      ? "border-frame bg-secondary text-foreground"
                      : "border-transparent text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
                  )}
                >
                  <Image src={t.icon} alt="" width={26} height={26} className="size-[26px]" />
                  {t.symbol}
                  <span className="text-[11px] font-medium text-muted-foreground">{t.count}</span>
                </button>
              )
            })}
          </div>

          <div className="flex w-full flex-wrap items-center justify-between gap-3 sm:w-auto">
            {amount > 0 && <LiveBadge live={live} />}
            <span className="flex items-center gap-2">
              <span className="label-roman whitespace-nowrap text-xs">Sort</span>
              <SortToggle value={sortBy} onChange={onSort} />
            </span>
            <ViewToggle value={view} onChange={onView} />
          </div>
        </div>

        {/* Column heads */}
        <div aria-hidden="true" className={cn("hidden px-[18px] py-3 label-roman", GRID)}>
          <span>Route</span>
          <span>APY</span>
          <span className="hidden xl:block">Est. yearly</span>
          <span>TVL</span>
          <span>Safety</span>
          <span />
        </div>

        {loading ? (
          <div aria-label={`Checking live ${token} rates`} aria-busy="true">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-3 border-t border-row-line px-3 py-3.5 md:px-[18px]">
                <span className="size-10 shrink-0 animate-pulse rounded-full bg-secondary" />
                <span className="h-4 w-40 animate-pulse rounded-[2px] bg-secondary" />
                <span className="ml-auto h-5 w-16 animate-pulse rounded-[2px] bg-secondary" />
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="flex items-start gap-3 border-t border-row-line p-5 md:p-8">
            <AlertCircle className="mt-0.5 size-5 shrink-0 text-destructive" />
            <div className="min-w-0">
              <p className="font-semibold text-destructive">Could not load live rates</p>
              <p className="mt-1 text-sm text-muted-foreground">{error}</p>
              <button type="button" onClick={onRetry} className="btn-frame mt-4 h-11 px-4 text-sm">
                <RotateCw className="size-4" />
                Try again
              </button>
            </div>
          </div>
        ) : routes.length === 0 ? (
          <p className="border-t border-row-line px-5 py-8 text-center text-sm text-muted-foreground">
            {totalForToken === 0 ? (
              `No ${token} routes in Hermes right now.`
            ) : (
              <>
                No {token} route is top rated right now.{" "}
                <button type="button" onClick={() => onView("all")} className="font-medium text-ink underline underline-offset-2">
                  {showAllLabel(totalForToken, token)}
                </button>
              </>
            )}
          </p>
        ) : (
          <div role="radiogroup" aria-label={`${token} routes`}>
            {listed.map((route) => (
              <RouteRow
                key={route.id}
                route={route}
                best={route === best}
                bestLabel={quoted ? "Best quote" : "Best APY"}
                quote={live.byRoute[route.id]}
                quoting={live.status === "loading"}
                selected={route.id === selectedId}
                amount={amount}
                onSelect={() => onSelect(route.id)}
              />
            ))}
            {routes.length > TOP_ROUTES && (
              <button
                type="button"
                onClick={() => onExpandedChange(!expanded)}
                aria-expanded={expanded}
                className="flex w-full items-center justify-center border-t border-row-line px-3 py-3 text-sm font-medium text-ink hover:bg-plate"
              >
                {expanded ? `Show top ${TOP_ROUTES}` : `Show all ${routes.length} routes`}
              </button>
            )}
            {hidden > 0 && (
              <p className="border-t border-row-line px-3 py-3 text-xs text-muted-foreground md:px-[18px]">
                {hidden} more {hidden === 1 ? "route isn't" : "routes aren't"} top rated.{" "}
                <button type="button" onClick={() => onView("all")} className="font-medium text-ink underline underline-offset-2">
                  Switch to All routes
                </button>
              </p>
            )}
          </div>
        )}

      </div>
    </div>
  )
}

function RouteRow({
  route,
  best,
  bestLabel,
  quote,
  quoting,
  selected,
  amount,
  onSelect,
}: {
  route: YieldRoute
  best: boolean
  bestLabel: string
  quote?: RouteQuote
  quoting: boolean
  selected: boolean
  amount: number
  onSelect: () => void
}) {
  // What the route leaves after a year once the entry cost is taken off, from its live quote
  const yearly = estimatedYear(route, amount, quote)
  const line = amount > 0 ? quoteLine(route, quote) : null
  const borrowed = borrowedPercent(route)
  const withdrawable = withdrawablePercent(route)

  return (
    <div className={cn("border-t border-row-line transition-colors", selected ? "bg-accent" : "hover:bg-plate")}>
      <button
        type="button"
        role="radio"
        aria-checked={selected}
        onClick={onSelect}
        className={cn("flex w-full items-center gap-3 px-3 py-3 text-left md:items-center md:px-[18px]", GRID)}
      >
        {/* Route */}
        <span className="flex min-w-0 flex-1 items-center gap-3">
          <Medallion route={route} />
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="flex flex-wrap items-center gap-2">
              <span className="font-display text-[21px] font-bold leading-[1.1]">{route.name}</span>
              {best && (
                <span className="rounded-[2px] border border-ink-line bg-ink-surface px-[7px] py-0.5 font-roman text-[10px] font-bold tracking-[0.1em] text-ink">
                  {bestLabel}
                </span>
              )}
            </span>
            <span className="text-xs text-muted-foreground">
              {CATEGORY_LABELS[route.category]}
              {route.receipt && ` · get ${route.receipt}`}
              {borrowed !== null && (
                <span className={cn(route.utilization! >= HIGH_UTILIZATION && "font-medium text-warning")}>
                  {` · ${borrowed}% borrowed`}
                </span>
              )}
              {withdrawable !== null && (
                <span className={cn(exitTight(route) && "font-medium text-warning")}>{` · ${withdrawable}% withdrawable now`}</span>
              )}
              <span className="lg:hidden">{` · ${safetyText(route)}`}</span>
            </span>
            {line ? (
              <span className={cn("text-[11px]", quote?.quote ? "text-foreground" : "text-warning")}>{line}</span>
            ) : (
              amount > 0 &&
              route.deposit &&
              quoting && <span aria-hidden="true" className="mt-0.5 h-3 w-40 animate-pulse rounded-[2px] bg-hairline" />
            )}
          </span>
        </span>

        {/* APY and its source */}
        <span className="flex shrink-0 flex-col items-end gap-0.5 lg:items-start">
          <span className={cn("font-roman text-lg font-bold lg:text-[21px]", best ? "text-ink" : "text-foreground")}>
            {formatApy(route)}
          </span>
          <span className="hidden text-[11px] text-muted-foreground lg:block">{route.source}</span>
        </span>

        {/* Returns at today's APY, in the deposit token */}
        <span className="hidden flex-col gap-0.5 xl:flex">
          <span className="text-sm font-medium">
            {amount > 0 ? `${yearly < 0 ? "−" : "+"}${formatTokenAmount(Math.abs(yearly), route.token)} ${route.token}` : "—"}
          </span>
          {amount > 0 && <span className="text-[11px] text-muted-foreground">{formatTokenAmount(yearly / 12, route.token)} / mo</span>}
        </span>

        <span className="hidden text-sm font-medium lg:block">{formatUSD(route.tvl)}</span>

        <span className="hidden lg:flex">
          <SafetyCell route={route} />
        </span>

        <span
          aria-hidden="true"
          className={cn(
            "hidden size-[18px] place-items-center rounded-full border-2 lg:grid",
            selected ? "border-ink" : "border-gilt"
          )}
        >
          {selected && <span className="size-2 rounded-full bg-ink" />}
        </span>
      </button>

    </div>
  )
}
