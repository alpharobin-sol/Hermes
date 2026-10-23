"use client"

import Image from "next/image"
import { AlertTriangle, ExternalLink } from "lucide-react"

import { cn } from "@/lib/utils"
import { IS_DEVNET } from "@/lib/network"
import type { YieldRoute } from "@/lib/api/yield-api"
import { formatUSD } from "@/lib/helpers/formatters"
import { SOL_FEE_RESERVE } from "@/hooks/use-token-balances"
import { CATEGORY_LABELS, HIGH_UTILIZATION, Medallion, borrowedPercent, formatApy } from "./rate-board"
import { formatTokenAmount, type Token } from "./tokens"

// Why the connected wallet can't cover the amount: more than it holds, or into the SOL kept for fees
export type BalanceIssue = "insufficient" | "fee-reserve" | null

export const QUICK_AMOUNTS = ["25%", "50%", "75%", "Max"]

interface DepositPanelProps {
  token: Token
  amount: string
  onAmount: (value: string) => void
  numericAmount: number
  isConnected: boolean
  balanceKnown: boolean
  spendable: number
  balanceIssue: BalanceIssue
  onQuickAmount: (pct: string) => void
  isQuickActive: (pct: string) => boolean
  route: YieldRoute | null
  ratesStatus: "loading" | "error" | "ready"
  onConnect: () => void
  onReview: () => void
  className?: string
}

export function DepositPanel({
  token,
  amount,
  onAmount,
  numericAmount,
  isConnected,
  balanceKnown,
  spendable,
  balanceIssue,
  onQuickAmount,
  isQuickActive,
  route,
  ratesStatus,
  onConnect,
  onReview,
  className,
}: DepositPanelProps) {
  const yearly = route ? numericAmount * route.apy : 0
  const borrowed = route ? borrowedPercent(route) : null
  const overCap = isOverCap(route, numericAmount)

  return (
    <aside aria-label="Deposit" className={cn("plaque min-w-0 flex-[1_1_320px]", className)}>
      <div className="plaque-inner flex flex-col gap-5 p-4 md:p-[22px]">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="font-roman text-base font-bold tracking-[0.16em]">Deposit</h2>
          {isConnected && balanceKnown ? (
            <button
              type="button"
              onClick={() => onQuickAmount("Max")}
              title="Use the most you can deposit"
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Balance: <span className="font-medium text-foreground">{formatTokenAmount(token.balance, token.symbol)}</span>{" "}
              {token.symbol}
            </button>
          ) : (
            <span className="text-xs text-muted-foreground">
              {isConnected ? "Balance: loading" : "Balance: connect a wallet"}
            </span>
          )}
        </div>

        {IS_DEVNET && (
          <p className="rounded-[2px] border border-hairline bg-secondary px-3 py-2 text-xs leading-relaxed">
            Devnet: deposits use test SOL (get some at faucet.solana.com). APYs shown are mainnet rates for reference.
          </p>
        )}

        <div className="flex flex-col gap-2.5">
          <label htmlFor="deposit-amount" className="label-roman">
            Amount
          </label>
          <div className="flex items-center gap-3 rounded-[4px] border border-input bg-background py-2.5 pl-4 pr-2.5 focus-within:border-ink">
            <input
              id="deposit-amount"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              placeholder="0.00"
              value={amount}
              onChange={(e) => onAmount(e.target.value)}
              aria-invalid={!!balanceIssue || overCap}
              className="min-w-0 flex-1 bg-transparent p-0 text-[28px] font-semibold text-foreground outline-none md:text-[30px]"
            />
            <span className="inline-flex h-10 shrink-0 items-center gap-2 rounded-full border border-border bg-card pl-1.5 pr-3 text-sm font-semibold">
              <Image src={token.icon} alt="" width={26} height={26} className="size-[26px]" />
              {token.symbol}
            </span>
          </div>
          <div className="flex gap-1.5">
            {QUICK_AMOUNTS.map((pct) => (
              <button
                key={pct}
                type="button"
                disabled={!balanceKnown}
                title={balanceKnown ? undefined : "Connect a wallet to use your balance"}
                onClick={() => onQuickAmount(pct)}
                className={cn(
                  "h-8 flex-1 rounded-[2px] border text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:text-placeholder",
                  isQuickActive(pct)
                    ? "border-frame bg-secondary text-foreground"
                    : "border-hairline text-muted-foreground enabled:hover:bg-secondary enabled:hover:text-foreground"
                )}
              >
                {pct}
              </button>
            ))}
          </div>
          <AmountMessages token={token} spendable={spendable} balanceIssue={balanceIssue} route={route} overCap={overCap} />
        </div>

        {route && (
          <div className="flex flex-col gap-4 rounded-[2px] border border-frame bg-accent p-4">
            <div className="flex items-center gap-3">
              <Medallion route={route} className="bg-card" />
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="font-display text-[22px] font-bold leading-[1.1]">{route.name}</span>
                <span className="text-xs text-muted-foreground">
                  {CATEGORY_LABELS[route.category]}
                  {route.receipt && ` · get ${route.receipt}`}
                </span>
              </span>
            </div>
            <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-3.5">
              <div className="flex flex-col gap-1">
                <dt className="label-roman text-[10px]">APY</dt>
                <dd className="m-0 font-roman text-[22px] font-bold text-ink">{formatApy(route)}</dd>
              </div>
              <div className="flex flex-col gap-1">
                <dt className="label-roman text-[10px]">Est. yearly</dt>
                <dd className="m-0 pt-1 text-[15px] font-medium">
                  {numericAmount > 0 ? `${formatTokenAmount(yearly, route.token)} ${route.token}` : "—"}
                </dd>
              </div>
              <div className="flex flex-col gap-1">
                <dt className="label-roman text-[10px]">TVL</dt>
                <dd className="m-0 text-[15px] font-medium">{formatUSD(route.tvl)}</dd>
              </div>
              {borrowed !== null ? (
                <div className="flex flex-col gap-1" title="Share of the reserve that is borrowed">
                  <dt className="label-roman text-[10px]">Borrowed</dt>
                  <dd className={cn("m-0 text-[15px] font-medium", route.utilization! >= HIGH_UTILIZATION && "text-warning")}>
                    {borrowed}%
                  </dd>
                </div>
              ) : (
                <div className="flex flex-col gap-1">
                  <dt className="label-roman text-[10px]">Est. monthly</dt>
                  <dd className="m-0 text-[15px] font-medium">
                    {numericAmount > 0 ? `${formatTokenAmount(yearly / 12, route.token)} ${route.token}` : "—"}
                  </dd>
                </div>
              )}
            </dl>
            <p className="-mt-1 text-[11px] text-muted-foreground">Rate and TVL from {route.source}.</p>
          </div>
        )}

        {route && <RouteNotes route={route} />}

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
        <p className="-mt-1.5 text-center text-xs leading-relaxed text-muted-foreground">
          Hermes builds the transaction. You sign it in your wallet. Funds never touch Hermes.
        </p>
      </div>
    </aside>
  )
}

// Over the beta limit for one deposit into this route
export function isOverCap(route: YieldRoute | null, amount: number): boolean {
  return !!route?.deposit && route.depositCap != null && amount > route.depositCap
}

export function AmountMessages({
  token,
  spendable,
  balanceIssue,
  route,
  overCap,
}: {
  token: Token
  spendable: number
  balanceIssue: BalanceIssue
  route: YieldRoute | null
  overCap: boolean
}) {
  return (
    <>
      {balanceIssue && (
        <p className="text-xs text-destructive">
          {balanceIssue === "insufficient"
            ? `Insufficient ${token.symbol} balance. You have ${formatTokenAmount(token.balance, token.symbol)} ${token.symbol}.`
            : `Keep ${SOL_FEE_RESERVE} SOL for network fees. You can deposit up to ${formatTokenAmount(spendable, "SOL")} SOL.`}
        </p>
      )}
      {overCap && route?.depositCap != null && (
        <p className="text-xs text-destructive">
          While in beta, {route.name} deposits are limited to {route.depositCap.toLocaleString()} {route.token} each.
        </p>
      )}
    </>
  )
}

function Note({ children, tone = "warning" }: { children: React.ReactNode; tone?: "warning" | "muted" }) {
  return (
    <p className={cn("flex items-start gap-2.5 text-[13px] leading-relaxed", tone === "warning" ? "text-warning" : "text-muted-foreground")}>
      {tone === "warning" ? <AlertTriangle className="mt-0.5 size-4 shrink-0" /> : <span className="w-4 shrink-0" />}
      <span>{children}</span>
    </p>
  )
}

// compact: the phone card says beta in its fine print, and the dialog shows any rent before signing
export function RouteNotes({ route, compact = false }: { route: YieldRoute; compact?: boolean }) {
  const borrowed = borrowedPercent(route)
  return (
    <div className="flex flex-col gap-2 empty:hidden">
      {!compact && route.deposit === "beta" && !IS_DEVNET && (
        <Note>
          Beta route with real funds.
          {route.depositCap != null && ` Up to ${route.depositCap.toLocaleString()} ${route.token} per deposit.`} Start small.
        </Note>
      )}
      {!compact && route.deposit && route.category === "lending" && (
        <Note tone="muted">
          Your first {route.name} deposit pays one-time account rent in SOL. You see the exact amount before you sign.
        </Note>
      )}
      {borrowed !== null && route.utilization! >= HIGH_UTILIZATION && (
        <Note>
          {borrowed}% of this {route.token} reserve is borrowed. Withdrawals may have to wait until borrowers repay or new
          deposits arrive.
        </Note>
      )}
      {!route.deposit && !IS_DEVNET && (
        <Note tone="muted">Hermes does not deposit into {route.name} yet. You can deposit in its own app.</Note>
      )}
    </div>
  )
}

export function PrimaryAction({
  route,
  ratesStatus,
  token,
  isConnected,
  numericAmount,
  balanceIssue,
  overCap,
  onConnect,
  onReview,
}: {
  route: YieldRoute | null
  ratesStatus: "loading" | "error" | "ready"
  token: string
  isConnected: boolean
  numericAmount: number
  balanceIssue: BalanceIssue
  overCap: boolean
  onConnect: () => void
  onReview: () => void
}) {
  const size = "h-[52px] w-full text-[15px]"

  if (!route) {
    return (
      <button type="button" disabled className={cn("btn-teal", size)}>
        {ratesStatus === "loading" ? "Checking live rates" : ratesStatus === "error" ? "Rates unavailable" : "Pick a route"}
      </button>
    )
  }

  // View-only routes deposit in the protocol's own app. Those apps run on mainnet, so devnet has nothing to open.
  if (!route.deposit) {
    if (IS_DEVNET) {
      return (
        <button type="button" disabled title="This route has no devnet deployment" className={cn("btn-frame", size)}>
          Mainnet only
        </button>
      )
    }
    return (
      <a href={route.website} target="_blank" rel="noopener noreferrer" title={`Opens ${route.name} in a new tab`} className={cn("btn-frame", size)}>
        Open {route.name}
        <ExternalLink className="size-4" />
      </a>
    )
  }

  if (!isConnected) {
    return (
      <button type="button" onClick={onConnect} className={cn("btn-teal", size)}>
        Connect wallet to deposit
      </button>
    )
  }

  const blocked =
    numericAmount <= 0
      ? "Enter an amount"
      : balanceIssue === "insufficient"
        ? "Insufficient balance"
        : balanceIssue === "fee-reserve"
          ? "Keep some SOL for fees"
          : overCap
            ? `Up to ${route.depositCap?.toLocaleString()} ${token} per deposit`
            : null

  return (
    <button type="button" disabled={!!blocked} onClick={onReview} className={cn("btn-teal", size)}>
      {blocked ?? `Review deposit${route.deposit === "beta" && !IS_DEVNET ? " · beta" : ""}`}
    </button>
  )
}
