"use client"

import Image from "next/image"
import { AlertCircle, RotateCw } from "lucide-react"

import { cn } from "@/lib/utils"
import type { RiskTier, YieldRoute } from "@/lib/api/yield-api"
import { formatUSD } from "@/lib/helpers/formatters"
import { formatTokenAmount } from "./tokens"

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

const GRID = "md:grid md:grid-cols-[minmax(0,1fr)_104px_120px_80px_100px_20px] md:gap-4"

interface RateBoardProps {
  tokens: { symbol: string; icon: string; count: number }[]
  token: string
  onToken: (symbol: string) => void
  risk: RiskTier
  onRisk: (risk: RiskTier) => void
  routes: YieldRoute[] // for the token, within the risk level, best APY first
  totalForToken: number
  selectedId: string | null
  onSelect: (id: string) => void
  amount: number
  loading: boolean
  error: string | null
  onRetry: () => void
  sources: string
  updatedLabel: string | null
}

export function RateBoard({
  tokens,
  token,
  onToken,
  risk,
  onRisk,
  routes,
  totalForToken,
  selectedId,
  onSelect,
  amount,
  loading,
  error,
  onRetry,
  sources,
  updatedLabel,
}: RateBoardProps) {
  const hidden = totalForToken - routes.length

  return (
    <div className="plaque min-w-0 flex-[999_1_640px]">
      <div className="plaque-inner overflow-hidden">
        {/* Token and risk */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline px-3 py-3 md:px-[18px] md:py-3.5">
          {/* Phone: tokens share one row, risk takes the next */}
          <div
            role="group"
            aria-label="Token"
            className="grid w-full gap-1.5 sm:flex sm:w-auto sm:flex-wrap"
            style={{ gridTemplateColumns: `repeat(${Math.max(tokens.length, 1)}, minmax(0, 1fr))` }}
          >
            {tokens.map((t) => {
              const active = t.symbol === token
              return (
                <button
                  key={t.symbol}
                  type="button"
                  aria-pressed={active}
                  onClick={() => onToken(t.symbol)}
                  className={cn(
                    "inline-flex h-11 items-center justify-center gap-2 rounded-full border pl-2 pr-3 text-sm font-semibold transition-colors sm:justify-start sm:gap-2.5 sm:pr-3.5",
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

          <div className="flex w-full items-center justify-between gap-3 sm:w-auto">
            <span id="risk-label" className="label-roman whitespace-nowrap text-xs">
              Risk up to
            </span>
            <div role="group" aria-labelledby="risk-label" className="flex gap-0.5 rounded-[4px] border border-border p-[3px]">
              {RISK_LEVELS.map((level) => {
                const active = level.value === risk
                return (
                  <button
                    key={level.value}
                    type="button"
                    aria-pressed={active}
                    onClick={() => onRisk(level.value)}
                    className={cn(
                      "inline-flex h-9 items-center gap-2 rounded-[2px] px-2.5 text-[13px] font-medium transition-colors md:px-3",
                      active ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <span className={cn("size-[7px] rotate-45", level.color)} aria-hidden="true" />
                    {level.label}
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        {/* Column heads */}
        <div aria-hidden="true" className={cn("hidden px-[18px] py-3 label-roman", GRID)}>
          <span>Route</span>
          <span>APY</span>
          <span>Est. yearly</span>
          <span>TVL</span>
          <span>Risk</span>
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
            {totalForToken === 0
              ? `No ${token} routes in Hermes right now.`
              : `No ${token} routes at ${risk} risk. Raise the risk level to see ${totalForToken} more.`}
          </p>
        ) : (
          <div role="radiogroup" aria-label={`${token} routes`}>
            {routes.map((route, index) => (
              <RouteRow
                key={route.id}
                route={route}
                best={index === 0}
                selected={route.id === selectedId}
                amount={amount}
                onSelect={() => onSelect(route.id)}
              />
            ))}
            {hidden > 0 && (
              <p className="border-t border-row-line px-3 py-3 text-xs text-muted-foreground md:px-[18px]">
                {hidden} more {hidden === 1 ? "route" : "routes"} above {risk} risk. Raise the risk level to see{" "}
                {hidden === 1 ? "it" : "them"}.
              </p>
            )}
          </div>
        )}

        <p className="border-t border-hairline bg-plate px-3 py-3 text-xs leading-relaxed text-muted-foreground md:px-[18px]">
          {sources ? `Rates from ${sources}${updatedLabel ? `, updated ${updatedLabel}` : ""}. ` : ""}
          Returns assume today&apos;s APY holds and are not guaranteed. Risk reflects TVL, and for lending how much of
          the reserve is borrowed. It does not cover contract or depeg risk.
        </p>
      </div>
    </div>
  )
}

function RiskBars({ risk }: { risk: RiskTier }) {
  const activeIndex = RISK_LEVELS.findIndex((level) => level.value === risk)
  const level = RISK_LEVELS[activeIndex]
  return (
    <span className="flex flex-col gap-1.5" title="Risk tier from TVL, and for lending the borrowed share">
      <span className="flex gap-[3px]" aria-hidden="true">
        {RISK_LEVELS.map((segment, index) => (
          <span key={segment.value} className={cn("h-1.5 w-4 rounded-[1px]", index <= activeIndex ? level.color : "bg-hairline")} />
        ))}
      </span>
      <span className={cn("text-xs font-medium", level.text)}>{level.label}</span>
    </span>
  )
}

function RouteRow({
  route,
  best,
  selected,
  amount,
  onSelect,
}: {
  route: YieldRoute
  best: boolean
  selected: boolean
  amount: number
  onSelect: () => void
}) {
  const yearly = amount * route.apy
  const borrowed = borrowedPercent(route)
  const riskLabel = RISK_LEVELS.find((level) => level.value === route.risk)?.label ?? route.risk

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
                  Best APY
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
              <span className="md:hidden">{` · ${riskLabel} risk`}</span>
            </span>
          </span>
        </span>

        {/* APY and its source */}
        <span className="flex shrink-0 flex-col items-end gap-0.5 md:items-start">
          <span className={cn("font-roman text-lg font-bold md:text-[21px]", best ? "text-ink" : "text-foreground")}>
            {formatApy(route)}
          </span>
          <span className="hidden text-[11px] text-muted-foreground md:block">{route.source}</span>
        </span>

        {/* Returns at today's APY, in the deposit token */}
        <span className="hidden flex-col gap-0.5 md:flex">
          <span className="text-sm font-medium">{amount > 0 ? `+${formatTokenAmount(yearly, route.token)} ${route.token}` : "—"}</span>
          {amount > 0 && <span className="text-[11px] text-muted-foreground">{formatTokenAmount(yearly / 12, route.token)} / mo</span>}
        </span>

        <span className="hidden text-sm font-medium md:block">{formatUSD(route.tvl)}</span>

        <span className="hidden md:flex">
          <RiskBars risk={route.risk} />
        </span>

        <span
          aria-hidden="true"
          className={cn(
            "hidden size-[18px] place-items-center rounded-full border-2 md:grid",
            selected ? "border-ink" : "border-gilt"
          )}
        >
          {selected && <span className="size-2 rounded-full bg-ink" />}
        </span>
      </button>

      {/* Phone: the selected route opens its details under the row */}
      {selected && (
        <dl className="grid grid-cols-2 gap-3 border-t border-border px-3 pb-3.5 pt-2.5 md:hidden">
          <Detail label="Est. yearly" value={amount > 0 ? `+${formatTokenAmount(yearly, route.token)} ${route.token}` : "—"} />
          <Detail label="TVL" value={formatUSD(route.tvl)} />
          {borrowed !== null && <Detail label="Borrowed" value={`${borrowed}%`} />}
          <Detail label="Source" value={route.source} />
        </dl>
      )}
    </div>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="label-roman text-[10px]">{label}</dt>
      <dd className="m-0 text-sm font-medium">{value}</dd>
    </div>
  )
}
