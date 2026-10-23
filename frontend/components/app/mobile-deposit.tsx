"use client"

import { forwardRef, useState } from "react"
import Image from "next/image"
import { Check, ChevronDown } from "lucide-react"

import { cn } from "@/lib/utils"
import { IS_DEVNET } from "@/lib/network"
import type { RiskTier, YieldRoute } from "@/lib/api/yield-api"
import { formatUSD } from "@/lib/helpers/formatters"
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet"
import { CATEGORY_LABELS, Medallion, RISK_LEVELS, borrowedPercent, formatApy } from "./rate-board"
import { AmountMessages, PrimaryAction, QUICK_AMOUNTS, RouteNotes, isOverCap, type BalanceIssue } from "./deposit-panel"
import { formatTokenAmount, type Token } from "./tokens"

interface MobileDepositProps {
  tokens: (Token & { count: number })[]
  token: Token
  onToken: (symbol: string) => void
  amount: string
  onAmount: (value: string) => void
  numericAmount: number
  isConnected: boolean
  balanceKnown: boolean
  spendable: number
  balanceIssue: BalanceIssue
  onQuickAmount: (pct: string) => void
  isQuickActive: (pct: string) => boolean
  routes: YieldRoute[] // for the token, within the risk level, best APY first
  risk: RiskTier
  onRisk: (risk: RiskTier) => void
  route: YieldRoute | null
  onSelectRoute: (id: string) => void
  ratesStatus: "loading" | "error" | "ready"
  updatedLabel: string | null
  onConnect: () => void
  onReview: () => void
}

function riskLabel(route: YieldRoute): string {
  return RISK_LEVELS.find((level) => level.value === route.risk)?.label ?? route.risk
}

// Phones: one card, the way a swap app works. What you deposit, where it goes, one button.
export const MobileDeposit = forwardRef<HTMLElement, MobileDepositProps>(function MobileDeposit(
  {
    tokens,
    token,
    onToken,
    amount,
    onAmount,
    numericAmount,
    isConnected,
    balanceKnown,
    spendable,
    balanceIssue,
    onQuickAmount,
    isQuickActive,
    routes,
    risk,
    onRisk,
    route,
    onSelectRoute,
    ratesStatus,
    updatedLabel,
    onConnect,
    onReview,
  },
  ref
) {
  const [tokenSheet, setTokenSheet] = useState(false)
  const [routeSheet, setRouteSheet] = useState(false)
  const overCap = isOverCap(route, numericAmount)
  const best = route !== null && routes[0]?.id === route.id
  const borrowed = route ? borrowedPercent(route) : null

  return (
    <section ref={ref} aria-label="Deposit" className="plaque min-w-0 basis-full scroll-mt-20 lg:hidden">
      <div className="plaque-inner flex flex-col gap-2.5 p-3">
        {IS_DEVNET && (
          <p className="rounded-[2px] border border-hairline bg-secondary px-3 py-2 text-xs leading-relaxed">
            Devnet: deposits use test SOL. APYs shown are mainnet rates for reference.
          </p>
        )}

        {/* What you deposit */}
        <div className="relative flex flex-col gap-2.5">
          <div className="rounded-[4px] border border-input bg-background px-3.5 py-3 focus-within:border-ink">
            <div className="flex items-center justify-between gap-3">
              <label htmlFor="mobile-amount" className="label-roman">
                You deposit
              </label>
              {isConnected && balanceKnown ? (
                <button type="button" onClick={() => onQuickAmount("Max")} className="text-xs text-muted-foreground">
                  Balance: <span className="font-medium text-foreground">{formatTokenAmount(token.balance, token.symbol)}</span>
                </button>
              ) : (
                <span className="text-xs text-muted-foreground">{isConnected ? "Balance: loading" : "Balance: —"}</span>
              )}
            </div>
            <div className="mt-1.5 flex items-center gap-3">
              <input
                id="mobile-amount"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                placeholder="0"
                value={amount}
                onChange={(e) => onAmount(e.target.value)}
                aria-invalid={!!balanceIssue || overCap}
                className="min-w-0 flex-1 bg-transparent p-0 text-[30px] font-semibold leading-tight text-foreground outline-none"
              />
              <button
                type="button"
                onClick={() => tokens.length > 1 && setTokenSheet(true)}
                aria-label={tokens.length > 1 ? `${token.symbol}. Change token` : token.symbol}
                className="inline-flex h-11 shrink-0 items-center gap-2 rounded-full border border-border bg-card pl-1.5 pr-3 text-[15px] font-semibold"
              >
                <Image src={token.icon} alt="" width={28} height={28} className="size-7" />
                {token.symbol}
                {tokens.length > 1 && <ChevronDown className="size-4 text-muted-foreground" />}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-4 gap-1.5">
            {QUICK_AMOUNTS.map((pct) => (
              <button
                key={pct}
                type="button"
                disabled={!balanceKnown}
                onClick={() => onQuickAmount(pct)}
                className={cn(
                  "h-9 rounded-[2px] border text-[13px] font-medium disabled:text-placeholder",
                  isQuickActive(pct) ? "border-frame bg-secondary text-foreground" : "border-hairline text-muted-foreground"
                )}
              >
                {pct}
              </button>
            ))}
          </div>
          <AmountMessages token={token} spendable={spendable} balanceIssue={balanceIssue} route={route} overCap={overCap} />
        </div>

        {/* Where it goes. The whole box opens the route list. */}
        <button
          type="button"
          onClick={() => routes.length > 0 && setRouteSheet(true)}
          disabled={!route}
          aria-label={route ? `Into ${route.name}, ${formatApy(route)} APY. Change route` : "Route"}
          className="flex w-full flex-col gap-2 rounded-[4px] border border-gilt bg-accent px-3.5 py-3 text-left disabled:cursor-default"
        >
          <span className="flex items-center justify-between">
            <span className="label-roman">Into</span>
            {route && routes.length > 1 && (
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-ink">
                {routes.length} routes
                <ChevronDown className="size-4" />
              </span>
            )}
          </span>
          {route ? (
            <>
              <span className="flex items-center gap-3">
                <Medallion route={route} className="bg-card" />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-display text-[22px] font-bold leading-[1.1]">{route.name}</span>
                    {best && (
                      <span className="rounded-[2px] border border-ink-line bg-ink-surface px-1.5 py-0.5 font-roman text-[9px] font-bold tracking-[0.1em] text-ink">
                        Best APY
                      </span>
                    )}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {CATEGORY_LABELS[route.category]}
                    {route.receipt && ` · get ${route.receipt}`}
                  </span>
                </span>
                {/* APY, and what it earns on the amount typed */}
                <span className="flex shrink-0 flex-col items-end">
                  <span className="font-roman text-[22px] font-bold leading-tight text-ink">{formatApy(route)}</span>
                  <span className="text-xs font-medium text-muted-foreground">
                    {numericAmount > 0 ? (
                      <>
                        <span className="text-foreground">+{formatTokenAmount(numericAmount * route.apy, route.token)}</span> / yr
                      </>
                    ) : (
                      "APY"
                    )}
                  </span>
                </span>
              </span>
            </>
          ) : (
            <span className="text-sm text-muted-foreground">
              {ratesStatus === "loading" ? "Checking live rates..." : ratesStatus === "error" ? "Rates unavailable" : `No ${token.symbol} route at this risk level`}
            </span>
          )}
        </button>

        {/* Where the numbers come from, like a swap app's rate line */}
        {route && (
          <p className="px-0.5 text-[11px] leading-relaxed text-muted-foreground">
            {riskLabel(route)} risk · TVL {formatUSD(route.tvl)}
            {borrowed !== null && ` · ${borrowed}% borrowed`} · rate from {route.source}
            {updatedLabel && `, ${updatedLabel}`}
          </p>
        )}

        {route && <RouteNotes route={route} compact />}

        <PrimaryAction
          route={route}
          ratesStatus={ratesStatus}
          token={token.symbol}
          isConnected={isConnected}
          numericAmount={numericAmount}
          balanceIssue={balanceIssue}
          overCap={overCap}
          onConnect={onConnect}
          onReview={onReview}
        />
        <p className="-mt-0.5 text-center text-xs leading-relaxed text-muted-foreground">
          {route?.deposit === "beta" && !IS_DEVNET && (
            <span className="text-warning">
              Beta, real funds{route.depositCap != null && `, up to ${route.depositCap.toLocaleString()} ${route.token} per deposit`}.{" "}
            </span>
          )}
          You sign in your own wallet.
        </p>
      </div>

      <TokenSheet
        open={tokenSheet}
        onOpenChange={setTokenSheet}
        tokens={tokens}
        selected={token.symbol}
        showBalances={isConnected}
        onPick={(symbol) => {
          onToken(symbol)
          setTokenSheet(false)
        }}
      />
      <RouteSheet
        open={routeSheet}
        onOpenChange={setRouteSheet}
        token={token.symbol}
        routes={routes}
        selectedId={route?.id ?? null}
        amount={numericAmount}
        risk={risk}
        onRisk={onRisk}
        onPick={(id) => {
          onSelectRoute(id)
          setRouteSheet(false)
        }}
      />
    </section>
  )
})

function TokenSheet({
  open,
  onOpenChange,
  tokens,
  selected,
  showBalances,
  onPick,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  tokens: (Token & { count: number })[]
  selected: string
  showBalances: boolean
  onPick: (symbol: string) => void
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <div className="px-4 pb-3 pr-14 pt-3">
          <SheetTitle className="font-display text-[26px] font-bold leading-[1.1]">Choose a token</SheetTitle>
          <SheetDescription className="mt-1 text-[13px] text-muted-foreground">Tokens with at least one route.</SheetDescription>
        </div>
        <div role="radiogroup" aria-label="Token" className="overflow-y-auto border-t border-hairline">
          {tokens.map((t) => (
            <button
              key={t.symbol}
              type="button"
              role="radio"
              aria-checked={t.symbol === selected}
              onClick={() => onPick(t.symbol)}
              className={cn("flex w-full items-center gap-3 border-b border-row-line px-4 py-3.5 text-left", t.symbol === selected && "bg-accent")}
            >
              <Image src={t.icon} alt="" width={36} height={36} className="size-9" />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-[15px] font-semibold">{t.symbol}</span>
                <span className="text-xs text-muted-foreground">
                  {t.name} · {t.count} {t.count === 1 ? "route" : "routes"}
                </span>
              </span>
              {showBalances && <span className="text-sm font-medium">{formatTokenAmount(t.balance, t.symbol)}</span>}
              {t.symbol === selected && <Check className="size-4 text-ink" />}
            </button>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  )
}

function RouteSheet({
  open,
  onOpenChange,
  token,
  routes,
  selectedId,
  amount,
  risk,
  onRisk,
  onPick,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  token: string
  routes: YieldRoute[]
  selectedId: string | null
  amount: number
  risk: RiskTier
  onRisk: (risk: RiskTier) => void
  onPick: (id: string) => void
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <div className="flex flex-col gap-3 px-4 pb-3 pt-3">
          <div className="pr-10">
            <SheetTitle className="font-display text-[26px] font-bold leading-[1.1]">Choose a route</SheetTitle>
            <SheetDescription className="mt-1 text-[13px] text-muted-foreground">
              {token} routes, best APY first.
            </SheetDescription>
          </div>
          <div role="group" aria-label="Risk up to" className="grid grid-cols-3 gap-0.5 rounded-[4px] border border-border p-[3px]">
            {RISK_LEVELS.map((level) => (
              <button
                key={level.value}
                type="button"
                aria-pressed={level.value === risk}
                onClick={() => onRisk(level.value)}
                className={cn(
                  "inline-flex h-9 items-center justify-center gap-2 rounded-[2px] text-[13px] font-medium",
                  level.value === risk ? "bg-secondary text-foreground" : "text-muted-foreground"
                )}
              >
                <span className={cn("size-[7px] rotate-45", level.color)} aria-hidden="true" />
                {level.label}
              </button>
            ))}
          </div>
        </div>
        <div role="radiogroup" aria-label={`${token} routes`} className="overflow-y-auto border-t border-hairline">
          {routes.length === 0 && (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">No {token} routes at {risk} risk. Raise the risk level.</p>
          )}
          {routes.map((r, index) => {
            const selected = r.id === selectedId
            return (
              <button
                key={r.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => onPick(r.id)}
                className={cn("flex w-full items-center gap-3 border-b border-row-line px-4 py-3 text-left", selected && "bg-accent")}
              >
                <Medallion route={r} />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-display text-[20px] font-bold leading-[1.1]">{r.name}</span>
                    {index === 0 && (
                      <span className="rounded-[2px] border border-ink-line bg-ink-surface px-1.5 py-0.5 font-roman text-[9px] font-bold tracking-[0.1em] text-ink">
                        Best APY
                      </span>
                    )}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {CATEGORY_LABELS[r.category]}
                    {r.receipt && ` · ${r.receipt}`} · {riskLabel(r)} risk
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-0.5">
                  <span className={cn("font-roman text-lg font-bold", index === 0 ? "text-ink" : "text-foreground")}>{formatApy(r)}</span>
                  <span className="text-[11px] text-muted-foreground">
                    {amount > 0 ? `+${formatTokenAmount(amount * r.apy, r.token)} / yr` : r.source}
                  </span>
                </span>
              </button>
            )
          })}
        </div>
      </SheetContent>
    </Sheet>
  )
}
