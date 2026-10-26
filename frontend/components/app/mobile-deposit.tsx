"use client"

import { forwardRef, useState } from "react"
import Image from "next/image"
import { Check, ChevronDown } from "lucide-react"

import { cn } from "@/lib/utils"
import { IS_DEVNET } from "@/lib/network"
import type { YieldRoute } from "@/lib/api/yield-api"
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet"
import { Medallion, formatApy } from "./rate-board"
import { AmountMessages, PrimaryAction, QUICK_AMOUNTS, RouteNotes, isOverCap, type BalanceIssue } from "./deposit-panel"
import { formatTokenAmount, type Token } from "./tokens"
import {
  TOP_ROUTES,
  SafetyBreakdown,
  SortToggle,
  ViewToggle,
  bestApyRoute,
  listedRoutes,
  safetyText,
  showAllLabel,
  type SortBy,
  type View,
} from "./safety"
import { RouteAlertToggle } from "./alerts"
import { RouteTypeButton, RouteTypeExplainer } from "./route-type"
import { HorizonToggle, LiveBadge, bestQuoteRoute, estimatedReturn, formatEarned, horizonSuffix, type Horizon, type LiveQuotes } from "./live-quotes"
import { SplitAction, SplitCard, SplitMessages, type SplitState } from "./split"
import { MatchChip, type MatchPrefs } from "./match"

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
  solShort: number | null // the wallet's SOL, when a USDC or USDT deposit needs more for fees and rent
  onQuickAmount: (pct: string) => void
  isQuickActive: (pct: string) => boolean
  routes: YieldRoute[] // for the token, in the view, in sortBy order
  totalForToken: number
  view: View
  onView: (view: View) => void
  expanded: boolean // all routes in the view, not just the top three
  onExpandedChange: (expanded: boolean) => void
  sortBy: SortBy
  onSort: (sort: SortBy) => void
  match: MatchPrefs | null // the answers while Match sorts the list, in place of the view
  onChangeMatch: () => void
  route: YieldRoute | null
  onSelectRoute: (id: string) => void
  ratesStatus: "loading" | "error" | "ready"
  onConnect: () => void
  onReview: () => void
  live: LiveQuotes
  horizon: Horizon // what the figures count over once an amount is typed
  onHorizon: (horizon: Horizon) => void
  split?: SplitState // the Top rated split, when the token has two or more top rated routes
}

// Phones and tablets: one card, the way a swap app works. With an amount typed, every route shows in the card,
// by Safety Score or by what it earns, with its score and what it earns in a year. The rest is in the Why panel.
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
    solShort,
    onQuickAmount,
    isQuickActive,
    routes,
    totalForToken,
    view,
    onView,
    expanded,
    onExpandedChange,
    sortBy,
    onSort,
    match,
    onChangeMatch,
    route,
    onSelectRoute,
    ratesStatus,
    onConnect,
    onReview,
    live,
    horizon,
    onHorizon,
    split,
  },
  ref
) {
  const [tokenSheet, setTokenSheet] = useState(false)
  const splitting = !!split?.on
  const overCap = splitting ? split!.overCap : isOverCap(route, numericAmount)
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
        {splitting ? (
          <SplitMessages split={split!} token={token} spendable={spendable} balanceIssue={balanceIssue} solShort={solShort} />
        ) : (
          <AmountMessages token={token} spendable={spendable} balanceIssue={balanceIssue} solShort={solShort} route={route} overCap={overCap} />
        )}

        {splitting ? (
          <SplitCard split={split!} token={token.symbol} showHorizon />
        ) : showRoutes ? (
          <RouteChoices
            live={live}
            routes={routes}
            totalForToken={totalForToken}
            token={token.symbol}
            amount={numericAmount}
            selectedId={route?.id ?? null}
            onSelect={onSelectRoute}
            view={view}
            onView={onView}
            expanded={expanded}
            onExpandedChange={onExpandedChange}
            sortBy={sortBy}
            onSort={onSort}
            match={match}
            onChangeMatch={onChangeMatch}
            horizon={horizon}
            onHorizon={onHorizon}
          />
        ) : (
          <BestRoute
            route={route}
            routes={routes}
            totalForToken={totalForToken}
            token={token.symbol}
            ratesStatus={ratesStatus}
            onView={onView}
            match={match}
            onChangeMatch={onChangeMatch}
          />
        )}

        {route && !splitting && <SafetyBreakdown route={route} />}

        {route?.deposit && !splitting && <RouteAlertToggle route={route} />}

        {route && !splitting && <RouteNotes route={route} />}

        {splitting ? (
          <SplitAction
            split={split!}
            token={token.symbol}
            isConnected={isConnected}
            numericAmount={numericAmount}
            balanceIssue={balanceIssue}
            onConnect={onConnect}
            onReview={onReview}
          />
        ) : (
          <>
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
            {/* The toolbar's Mainnet beta pill already says real funds. Only the cap needs saying here. */}
            {route?.deposit === "beta" && !IS_DEVNET && route.depositCap != null && (
              <p className="-mt-0.5 text-center text-xs text-muted-foreground">
                Max {route.depositCap.toLocaleString()} {route.token} per deposit
              </p>
            )}
          </>
        )}
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
  totalForToken,
  token,
  ratesStatus,
  onView,
  match,
  onChangeMatch,
}: {
  route: YieldRoute | null
  routes: YieldRoute[]
  totalForToken: number
  token: string
  ratesStatus: "loading" | "error" | "ready"
  onView: (view: View) => void
  match: MatchPrefs | null
  onChangeMatch: () => void
}) {
  const [explainType, setExplainType] = useState(false)
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
                {match
                  ? routes[0]?.id === route.id && <span className={BEST_TAG}>Best match</span>
                  : bestApyRoute(routes)?.id === route.id && <span className={BEST_TAG}>Best APY</span>}
              </span>
              <span className="text-xs text-muted-foreground">
                <RouteTypeButton route={route} open={explainType} onToggle={() => setExplainType((open) => !open)} />
                {route.receipt && ` · get ${route.receipt}`}
              </span>
            </span>
            <span className="flex shrink-0 flex-col items-end">
              <span className="font-roman text-[22px] font-bold leading-tight text-ink">{formatApy(route)}</span>
              <span className="text-[11px] text-muted-foreground">APY</span>
            </span>
          </span>
          {explainType && <RouteTypeExplainer route={route} />}
          {routes.length > 1 && (
            <span className="border-t border-frame pt-2 text-xs text-muted-foreground">
              Type an amount to compare all {routes.length} routes.
            </span>
          )}
        </>
      ) : (
        <span className="text-sm text-muted-foreground">
          {ratesStatus === "loading" ? (
            "Checking live rates..."
          ) : ratesStatus === "error" ? (
            "Rates unavailable"
          ) : match ? (
            <>
              No {token} route fits your answers right now.{" "}
              <button type="button" onClick={onChangeMatch} className="font-medium text-ink underline underline-offset-2">
                Change answers
              </button>
            </>
          ) : (
            <>
              No {token} route is top rated right now.{" "}
              <button type="button" onClick={() => onView("all")} className="font-medium text-ink underline underline-offset-2">
                {showAllLabel(totalForToken, token)}
              </button>
            </>
          )}
        </span>
      )}
    </div>
  )
}

// With an amount: every route in sortBy order with its Safety Score and what it leaves over the horizon once entry
// and exit costs are taken off. What lands, the entry cost and the APY show in the dialog before signing.
function RouteChoices({
  live,
  routes,
  totalForToken,
  token,
  amount,
  selectedId,
  onSelect,
  view,
  onView,
  expanded,
  onExpandedChange,
  sortBy,
  onSort,
  match,
  onChangeMatch,
  horizon,
  onHorizon,
}: {
  routes: YieldRoute[]
  totalForToken: number
  token: string
  amount: number
  selectedId: string | null
  onSelect: (id: string) => void
  view: View
  onView: (view: View) => void
  expanded: boolean
  onExpandedChange: (expanded: boolean) => void
  sortBy: SortBy
  onSort: (sort: SortBy) => void
  match: MatchPrefs | null
  onChangeMatch: () => void
  live: LiveQuotes
  horizon: Horizon
  onHorizon: (horizon: Horizon) => void
}) {
  // The best quote once quotes are in. Until then the best APY, or under Match the top match.
  const quoted = bestQuoteRoute(routes, amount, live, horizon)
  const best = quoted ?? (match ? (routes[0] ?? null) : bestApyRoute(routes))
  const listed = listedRoutes(routes, expanded, selectedId, quoted?.id)
  const hidden = totalForToken - routes.length

  return (
    <div className="flex flex-col overflow-hidden rounded-[4px] border border-gilt">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-frame bg-accent px-3 py-2.5">
        <span className="flex items-center gap-2.5">
          <span className="label-roman text-foreground">
            {routes.length} {routes.length === 1 ? "route" : "routes"}
          </span>
          <LiveBadge live={live} />
        </span>
        <SortToggle value={sortBy} onChange={onSort} compact />
        {match ? <MatchChip prefs={match} onChange={onChangeMatch} compact /> : <ViewToggle value={view} onChange={onView} compact />}
      </div>
      <div className="flex items-center justify-between gap-2 border-b border-row-line bg-card px-3 py-2">
        <span className="text-[12px] text-muted-foreground">{match ? "Ranked after costs, over" : "After costs, over"}</span>
        <HorizonToggle value={horizon} onChange={onHorizon} compact />
      </div>

      <div role="radiogroup" aria-label={`${token} routes`} data-tour="routes">
        {routes.length === 0 && (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">
            {match ? (
              <>
                No {token} route fits your answers right now.{" "}
                <button type="button" onClick={onChangeMatch} className="font-medium text-ink underline underline-offset-2">
                  Change answers
                </button>
              </>
            ) : (
              <>
                No {token} route is top rated right now.{" "}
                <button type="button" onClick={() => onView("all")} className="font-medium text-ink underline underline-offset-2">
                  {showAllLabel(totalForToken, token)}
                </button>
              </>
            )}
          </p>
        )}
        {listed.map((r) => {
          const selected = r.id === selectedId
          const isBest = r === best
          const quote = live.byRoute[r.id]
          const earned = estimatedReturn(r, amount, quote, horizon)
          // A route that can't take this amount right now (over a cap, price impact) says so instead of a figure
          const noQuote = !!quote && !quote.quote
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
                  {isBest && <span className={BEST_TAG}>{quoted ? "Best quote" : match ? "Best match" : "Best APY"}</span>}
                </span>
                <span className="text-[11px] text-muted-foreground">{safetyText(r)}</span>
              </span>
              {noQuote ? (
                <span className="shrink-0 text-[13px] text-muted-foreground" title={quote.error ?? undefined}>
                  No quote
                </span>
              ) : earned === null ? (
                <span className="shrink-0 text-[13px] text-muted-foreground" title="Working out the exit cost">
                  Pending
                </span>
              ) : (
                <span className={cn("shrink-0 text-[15px] font-semibold", isBest ? "text-ink" : "text-foreground")}>
                  {formatEarned(earned, r.token)}{" "}
                  <span className="text-xs font-medium">
                    {r.token} {horizonSuffix(horizon)}
                  </span>
                </span>
              )}
            </button>
          )
        })}
        {routes.length > TOP_ROUTES && (
          <button
            type="button"
            onClick={() => onExpandedChange(!expanded)}
            aria-expanded={expanded}
            className="flex w-full items-center justify-center border-t border-row-line bg-card px-3 py-2.5 text-[13px] font-medium text-ink"
          >
            {expanded ? `Show top ${TOP_ROUTES}` : `Show all ${routes.length} routes`}
          </button>
        )}
        {hidden > 0 && routes.length > 0 && (
          <p className="border-t border-row-line bg-card px-3 py-2 text-[11px] text-muted-foreground">
            {match ? (
              <>
                {hidden} more don&apos;t fit your answers.{" "}
                <button type="button" onClick={onChangeMatch} className="font-medium text-ink underline underline-offset-2">
                  Change answers
                </button>
              </>
            ) : (
              <>
                {hidden} more aren&apos;t top rated.{" "}
                <button type="button" onClick={() => onView("all")} className="font-medium text-ink underline underline-offset-2">
                  Switch to All routes
                </button>
              </>
            )}
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
