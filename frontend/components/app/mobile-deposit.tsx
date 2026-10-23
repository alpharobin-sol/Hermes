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
  totalForToken: number
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

// Phones and tablets: one card, the way a swap app works. With an amount typed, every route shows in the card,
// ranked by what it earns, the best marked and the gap shown for the rest.
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
    totalForToken,
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
  const overCap = isOverCap(route, numericAmount)
  const borrowed = route ? borrowedPercent(route) : null
  const showRoutes = numericAmount > 0 && ratesStatus === "ready"

  return (
    <section ref={ref} aria-label="Deposit" className="plaque min-w-0 basis-full scroll-mt-20 lg:hidden">
      <div className="plaque-inner flex flex-col gap-2.5 p-3">
        {IS_DEVNET && (
          <p className="rounded-[2px] border border-hairline bg-secondary px-3 py-2 text-xs leading-relaxed">
            Devnet: deposits use test SOL. APYs shown are mainnet rates for reference.
          </p>
        )}

        {/* What you deposit */}
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

        {showRoutes ? (
          <RouteChoices
            routes={routes}
            totalForToken={totalForToken}
            token={token.symbol}
            amount={numericAmount}
            selectedId={route?.id ?? null}
            onSelect={onSelectRoute}
            risk={risk}
            onRisk={onRisk}
          />
        ) : (
          <BestRoute route={route} routes={routes} token={token.symbol} ratesStatus={ratesStatus} />
        )}

        {/* Where the numbers come from, like a swap app's rate line */}
        {route && (
          <p className="px-0.5 text-[11px] leading-relaxed text-muted-foreground">
            {showRoutes && `${route.name}: `}
            {riskLabel(route)} risk · TVL {formatUSD(route.tvl)}
            {borrowed !== null && ` · ${borrowed}% borrowed`} · from {route.source}
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
    </section>
  )
})

const BEST_TAG =
  "rounded-[2px] border border-ink-line bg-ink-surface px-1.5 py-0.5 font-roman text-[9px] font-bold tracking-[0.1em] text-ink"

// Before an amount: the best route, and a prompt to type one to compare them all
function BestRoute({
  route,
  routes,
  token,
  ratesStatus,
}: {
  route: YieldRoute | null
  routes: YieldRoute[]
  token: string
  ratesStatus: "loading" | "error" | "ready"
}) {
  return (
    <div className="flex flex-col gap-2 rounded-[4px] border border-gilt bg-accent px-3.5 py-3">
      <span className="label-roman">Into</span>
      {route ? (
        <>
          <span className="flex items-center gap-3">
            <Medallion route={route} className="bg-card" />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="font-display text-[22px] font-bold leading-[1.1]">{route.name}</span>
                {routes[0]?.id === route.id && <span className={BEST_TAG}>Best APY</span>}
              </span>
              <span className="text-xs text-muted-foreground">
                {CATEGORY_LABELS[route.category]}
                {route.receipt && ` · get ${route.receipt}`}
              </span>
            </span>
            <span className="flex shrink-0 flex-col items-end">
              <span className="font-roman text-[22px] font-bold leading-tight text-ink">{formatApy(route)}</span>
              <span className="text-[11px] text-muted-foreground">APY</span>
            </span>
          </span>
          {routes.length > 1 && (
            <span className="border-t border-frame pt-2 text-xs text-muted-foreground">
              Type an amount to compare all {routes.length} routes.
            </span>
          )}
        </>
      ) : (
        <span className="text-sm text-muted-foreground">
          {ratesStatus === "loading"
            ? "Checking live rates..."
            : ratesStatus === "error"
              ? "Rates unavailable"
              : `No ${token} route at this risk level`}
        </span>
      )}
    </div>
  )
}

// With an amount: every route, best first, with what each earns and how far behind the best it is
function RouteChoices({
  routes,
  totalForToken,
  token,
  amount,
  selectedId,
  onSelect,
  risk,
  onRisk,
}: {
  routes: YieldRoute[]
  totalForToken: number
  token: string
  amount: number
  selectedId: string | null
  onSelect: (id: string) => void
  risk: RiskTier
  onRisk: (risk: RiskTier) => void
}) {
  const bestYearly = routes.length > 0 ? amount * routes[0].apy : 0
  const hidden = totalForToken - routes.length

  return (
    <div className="flex flex-col overflow-hidden rounded-[4px] border border-gilt">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-frame bg-accent px-3 py-2.5">
        <span className="label-roman text-foreground">
          {routes.length} {routes.length === 1 ? "route" : "routes"}
        </span>
        <div role="group" aria-label="Risk up to" className="flex gap-0.5 rounded-[4px] border border-frame p-0.5">
          {RISK_LEVELS.map((level) => (
            <button
              key={level.value}
              type="button"
              aria-pressed={level.value === risk}
              onClick={() => onRisk(level.value)}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-[2px] px-1.5 text-xs font-medium",
                level.value === risk ? "bg-card text-foreground" : "text-muted-foreground"
              )}
            >
              <span className={cn("size-1.5 rotate-45", level.color)} aria-hidden="true" />
              {level.label}
            </button>
          ))}
        </div>
      </div>

      <div role="radiogroup" aria-label={`${token} routes`}>
        {routes.length === 0 && (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">
            No {token} routes at {risk} risk. Raise the risk level to see {totalForToken} more.
          </p>
        )}
        {routes.map((r, index) => {
          const selected = r.id === selectedId
          const yearly = amount * r.apy
          return (
            <button
              key={r.id}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onSelect(r.id)}
              className={cn(
                "flex w-full items-center gap-3 border-t border-row-line px-3 py-2.5 text-left first:border-t-0",
                selected ? "bg-accent" : "bg-card"
              )}
            >
              <span
                aria-hidden="true"
                className={cn("grid size-[18px] shrink-0 place-items-center rounded-full border-2", selected ? "border-ink" : "border-gilt")}
              >
                {selected && <span className="size-2 rounded-full bg-ink" />}
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className="font-display text-[19px] font-bold leading-[1.1]">{r.name}</span>
                  {index === 0 && <span className={BEST_TAG}>Best</span>}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  {r.receipt ?? CATEGORY_LABELS[r.category]} · {riskLabel(r)} risk
                </span>
              </span>
              <span className="flex shrink-0 flex-col items-end gap-0.5">
                <span className={cn("text-[15px] font-semibold", index === 0 ? "text-ink" : "text-foreground")}>
                  +{formatTokenAmount(yearly, r.token)} <span className="text-xs font-medium">{r.token} / yr</span>
                </span>
                <span className="text-[11px] text-muted-foreground">
                  {formatApy(r)} APY
                  {index > 0 && ` · ${formatTokenAmount(bestYearly - yearly, r.token)} less`}
                </span>
              </span>
            </button>
          )
        })}
        {hidden > 0 && routes.length > 0 && (
          <p className="border-t border-row-line bg-card px-3 py-2 text-[11px] text-muted-foreground">
            {hidden} more above {risk} risk.
          </p>
        )}
      </div>
    </div>
  )
}

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
