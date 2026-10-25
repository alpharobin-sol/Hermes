"use client"

import { useEffect, useRef, useState } from "react"
import { useConnection, useWallet } from "@solana/wallet-adapter-react"
import { VersionedTransaction } from "@solana/web3.js"
import Link from "next/link"
import { AlertCircle, Check, ExternalLink, Info, Loader2, Split } from "lucide-react"

import { cn } from "@/lib/utils"
import { IS_DEVNET, explorerTxUrl } from "@/lib/network"
import type { YieldRoute } from "@/lib/api/yield-api"
import { DepositAPI, type DepositQuote, type RouteQuote } from "@/lib/api/deposit-api"
import { whatCanGoWrong } from "@/lib/route-copy"
import { isDeclined, sendAndWatch, useSlowWallet } from "@/lib/send-transaction"
import { markPortfolioChanged } from "@/lib/portfolio-changed"
import { markStep } from "@/lib/onboarding"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Medallion, formatApy } from "./rate-board"
import { compareRoutes, isTopRated } from "./safety"
import { formatTokenAmount, type Token } from "./tokens"
import { useAlerts } from "./alerts"
import { HORIZONS, HorizonToggle, LiveBadge, estimatedReturn, formatEarned, horizonSuffix, type Horizon, type LiveQuotes } from "./live-quotes"
import { Notice, Row, base64ToBytes } from "./deposit-dialog"
import type { BalanceIssue } from "./deposit-panel"

// TOP RATED SPLIT
// One deposit spread evenly across the two or three highest-scoring top rated routes for the token, in the app's
// order (Safety Score, then APY). Each part is an ordinary deposit: Hermes builds and simulates every one, the wallet
// signs them all in one approval, and the app sends them one after another. Nothing passes through Hermes, and each
// part shows in Portfolio like any deposit, with Withdraw, Reroute and alerts. While in beta the whole split stays
// within one deposit's cap.

export type SplitSize = 2 | 3
const SIZES: SplitSize[] = [2, 3]

const DECIMALS: Record<string, number> = { SOL: 9, USDC: 6, USDT: 6 }

// The routes a split can go into: top rated with an in-app deposit, in the app's default order
export function splitCandidates(routes: YieldRoute[]): YieldRoute[] {
  return routes.filter((route) => route.deposit && isTopRated(route)).sort(compareRoutes("safety"))
}

/**
 * Even parts in the token's smallest unit, the last taking what rounding leaves, so the parts add up to exactly
 * what was typed. Empty when the amount isn't a number.
 */
export function splitAmounts(amount: string, parts: number, token: string): string[] {
  const decimals = DECIMALS[token] ?? 6
  const clean = amount.replace(/,/g, "").trim()
  if (!/^\d*\.?\d*$/.test(clean) || !/\d/.test(clean)) return []
  const [whole, fraction = ""] = clean.split(".")
  const scale = 10 ** decimals
  const units = Number(whole || "0") * scale + Number((fraction + "0".repeat(decimals)).slice(0, decimals) || "0")
  if (!(units > 0) || !Number.isSafeInteger(units)) return []
  const each = Math.floor(units / parts)
  if (each <= 0) return []
  const toUi = (value: number) => {
    const digits = String(value).padStart(decimals + 1, "0")
    const frac = digits.slice(-decimals).replace(/0+$/, "")
    return frac ? `${digits.slice(0, -decimals)}.${frac}` : digits.slice(0, -decimals)
  }
  return Array.from({ length: parts }, (_, i) => toUi(i === parts - 1 ? units - each * (parts - 1) : each))
}

// SOL the split keeps back: each part's own hold-back, added up. The API counts it more closely (a temporary wrapped
// SOL account is closed before the next part opens one), so what the app allows the API always takes.
export function splitReserve(routes: YieldRoute[], fallback: number): number {
  return Math.ceil(routes.reduce((sum, route) => sum + (route.solReserve ?? fallback), 0) * 1e4) / 1e4
}

// The whole split's beta cap: one deposit's, the smallest among its routes
export function splitCap(routes: YieldRoute[]): number | null {
  const caps = routes.map((route) => (route.deposit === "beta" ? route.depositCap : null)).filter((cap): cap is number => cap != null)
  return caps.length > 0 ? Math.min(...caps) : null
}

// What the split leaves over the horizon after costs, part by part and in all. null while a part is pending.
function splitReturn(routes: YieldRoute[], amounts: string[], live: LiveQuotes, horizon: Horizon): number | null {
  let total = 0
  for (let i = 0; i < routes.length; i++) {
    const value = estimatedReturn(routes[i], Number(amounts[i]), live.byRoute[routes[i].id], horizon)
    if (value === null) return null
    total += value
  }
  return total
}

export interface SplitState {
  available: boolean // two or more top rated routes with deposits for this token
  on: boolean
  onChange: (on: boolean) => void
  size: SplitSize
  onSize: (size: SplitSize) => void
  maxSize: number
  routes: YieldRoute[] // the parts' routes, in order
  amounts: string[] // each part's amount, empty before an amount
  live: LiveQuotes // quotes for each part's amount
  horizon: Horizon
  onHorizon: (horizon: Horizon) => void
  cap: number | null // the whole split's beta cap
  overCap: boolean
  reserve: number // SOL kept back for the parts' fees and accounts
}

// The split's toggle: a small chip like a swap app's mode switch. Docs explain it, the card says it in a line.
export function SplitToggle({ split, className }: { split: SplitState; className?: string }) {
  if (!split.available) return null
  return (
    <button
      type="button"
      role="switch"
      aria-checked={split.on}
      aria-label="Split across Top rated"
      title="Spread the deposit evenly across the top rated routes, in one approval"
      onClick={() => split.onChange(!split.on)}
      className={cn(
        "inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border pl-2.5 pr-1.5 text-xs font-medium transition-colors",
        split.on ? "border-foreground bg-secondary text-foreground" : "border-frame text-muted-foreground hover:bg-secondary hover:text-foreground",
        className
      )}
    >
      <Split className="size-3.5" aria-hidden="true" />
      Split
      <span
        aria-hidden="true"
        className={cn(
          "relative ml-0.5 h-[18px] w-[30px] rounded-full border transition-colors",
          split.on ? "border-foreground bg-foreground" : "border-frame bg-background"
        )}
      >
        <span
          className={cn(
            "absolute top-1/2 size-3 -translate-y-1/2 rounded-full transition-all",
            split.on ? "left-[14px] bg-card" : "left-[2px] bg-frame"
          )}
        />
      </span>
    </button>
  )
}

// The split's parts: each route, its score, its share and what it leaves, then the whole. Phones show the horizon
// switch here, since the split takes the place of the route list that carries it.
export function SplitCard({ split, token, showHorizon = false }: { split: SplitState; token: string; showHorizon?: boolean }) {
  const hasAmount = split.amounts.length > 0
  const combined = hasAmount ? splitReturn(split.routes, split.amounts, split.live, split.horizon) : null
  const averageApy = split.routes.reduce((sum, route) => sum + route.apy, 0) / Math.max(1, split.routes.length)
  return (
    <div className="flex flex-col overflow-hidden rounded-[4px] border border-gilt">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-frame bg-accent px-3 py-2.5">
        <span className="flex items-center gap-2.5">
          <span className="label-roman text-foreground">Even split</span>
          {hasAmount && <LiveBadge live={split.live} />}
        </span>
        {split.maxSize > 2 && (
          <div role="group" aria-label="How many routes" className="flex gap-0.5 rounded-[4px] border border-frame p-0.5">
            {SIZES.map((size) => (
              <button
                key={size}
                type="button"
                aria-pressed={split.size === size}
                onClick={() => split.onSize(size)}
                className={cn(
                  "inline-flex h-7 items-center rounded-[2px] px-2.5 text-xs font-medium transition-colors",
                  split.size === size ? "bg-card text-foreground" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {size} routes
              </button>
            ))}
          </div>
        )}
      </div>

      <p className="m-0 flex items-center justify-between gap-2 border-b border-row-line bg-card px-3 py-2 text-[11px] text-muted-foreground">
        <span>Top rated routes only. One approval.</span>
        <Link href="/docs#split" className="inline-flex shrink-0 items-center gap-1 hover:text-foreground">
          <Info className="size-3" aria-hidden="true" />
          How it works
        </Link>
      </p>

      {showHorizon && hasAmount && (
        <div className="flex items-center justify-between gap-2 border-b border-row-line bg-card px-3 py-2">
          <span className="text-[12px] text-muted-foreground">After costs, over</span>
          <HorizonToggle value={split.horizon} onChange={split.onHorizon} compact />
        </div>
      )}

      <ul className="m-0 list-none p-0">
        {split.routes.map((route, i) => {
          const quote = split.live.byRoute[route.id]
          const noQuote = hasAmount && !!quote && !quote.quote
          const earned = hasAmount ? estimatedReturn(route, Number(split.amounts[i]), quote, split.horizon) : null
          return (
            <li key={route.id} className="flex items-center gap-3 border-t border-row-line bg-card px-3 py-2.5 first:border-t-0">
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate font-display text-[18px] font-bold leading-[1.1]">{route.name}</span>
                <span className="truncate text-[11px] text-muted-foreground">
                  Safety {route.safety?.score} · {formatApy(route)} APY
                </span>
              </span>
              <span className="flex shrink-0 flex-col items-end gap-0.5">
                <span className="text-[13px] font-semibold">
                  {hasAmount ? `${formatTokenAmount(Number(split.amounts[i]), token)} ${token}` : `1/${split.routes.length}`}
                </span>
                {hasAmount && (
                  <span className="text-[11px] text-muted-foreground" title={noQuote ? (quote?.error ?? undefined) : undefined}>
                    {noQuote
                      ? "No quote"
                      : earned === null
                        ? "Pending"
                        : `${formatEarned(earned, token)} ${token} ${horizonSuffix(split.horizon)}`}
                  </span>
                )}
              </span>
            </li>
          )
        })}
      </ul>

      <div className="flex items-center justify-between gap-3 border-t border-frame bg-accent px-3 py-2.5">
        <span className="text-[12px] text-muted-foreground">
          {hasAmount ? `In all, after costs` : `${(averageApy * 100).toFixed(2)}% APY on average`}
        </span>
        {hasAmount && (
          <span className="text-[15px] font-semibold text-ink">
            {combined === null ? (
              <span className="text-[13px] font-medium text-muted-foreground">Pending</span>
            ) : (
              <>
                {formatEarned(combined, token)} <span className="text-xs font-medium">{token} {horizonSuffix(split.horizon)}</span>
              </>
            )}
          </span>
        )}
      </div>
    </div>
  )
}

// Under the amount in split mode: the balance and cap as they apply to the whole split
export function SplitMessages({
  split,
  token,
  spendable,
  balanceIssue,
  solShort,
}: {
  split: SplitState
  token: Token
  spendable: number
  balanceIssue: BalanceIssue
  solShort: number | null
}) {
  const parts = split.routes.length
  return (
    <>
      {balanceIssue && (
        <p className="text-xs text-destructive">
          {balanceIssue === "insufficient"
            ? `Insufficient ${token.symbol} balance. You have ${formatTokenAmount(token.balance, token.symbol)} ${token.symbol}.`
            : `Keep ${split.reserve} SOL for the fees and accounts of ${parts} deposits. You can split up to ${formatTokenAmount(spendable, "SOL")} SOL.`}
        </p>
      )}
      {solShort !== null && (
        <p className="text-xs text-warning">
          {parts} first deposits need about {split.reserve} SOL for fees and account rent. You have {formatTokenAmount(solShort, "SOL")} SOL.
        </p>
      )}
      {split.overCap && split.cap != null && (
        <p className="text-xs text-destructive">
          While in beta, a split is limited to {split.cap.toLocaleString()} {token.symbol} in all, like a single deposit.
        </p>
      )}
    </>
  )
}

// The split's main button, like a single deposit's
export function SplitAction({
  split,
  token,
  isConnected,
  numericAmount,
  balanceIssue,
  onConnect,
  onReview,
}: {
  split: SplitState
  token: string
  isConnected: boolean
  numericAmount: number
  balanceIssue: BalanceIssue
  onConnect: () => void
  onReview: () => void
}) {
  const size = "h-[52px] w-full text-[15px]"
  if (!isConnected) {
    return (
      <button type="button" onClick={onConnect} className={cn("btn-teal", size)}>
        Connect wallet to deposit
      </button>
    )
  }
  const unquoted = split.routes.find((route) => {
    const quote = split.live.byRoute[route.id]
    return !!quote && !quote.quote
  })
  const blocked =
    numericAmount <= 0 || split.amounts.length === 0
      ? "Enter an amount"
      : balanceIssue === "insufficient"
        ? "Insufficient balance"
        : balanceIssue === "fee-reserve"
          ? "Keep some SOL for fees"
          : split.overCap
            ? `Up to ${split.cap?.toLocaleString()} ${token} in all`
            : unquoted
              ? `${unquoted.name} can't take its part right now`
              : null
  const beta = split.routes.some((route) => route.deposit === "beta") && !IS_DEVNET
  return (
    <>
      <button type="button" disabled={!!blocked} onClick={onReview} className={cn("btn-teal", size)}>
        {blocked ?? `Review split${beta ? " · beta" : ""}`}
      </button>
      {beta && split.cap != null && (
        <p className="-mt-1.5 text-center text-xs text-muted-foreground">
          Max {split.cap.toLocaleString()} {token} in all while in beta
        </p>
      )}
    </>
  )
}

// ---------- The review and send ----------

type PartStatus = "waiting" | "sending" | "landed" | "failed"

interface PartState {
  status: PartStatus
  signature: string | null
  quote: DepositQuote | null // what Hermes built for this part
  note: string | null // why it didn't land
}

type SplitStatus = "ready" | "building" | "signing" | "sending" | "done" | "partial" | "error"

function errorText(err: unknown): string {
  if (isDeclined(err)) return "You declined in your wallet. Nothing was sent."
  return err instanceof Error && err.message ? err.message : "The split failed. Nothing was sent."
}

export function SplitDialog({
  open,
  onOpenChange,
  token,
  routes: openedRoutes,
  amounts: openedAmounts,
  live,
  onDeposited,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  token: string
  routes: YieldRoute[]
  amounts: string[]
  live: LiveQuotes
  onDeposited?: () => void
}) {
  const { connection } = useConnection()
  const { publicKey, sendTransaction, signAllTransactions } = useWallet()
  const { addHeld } = useAlerts()
  // The parts as they stood when the dialog opened: what the user reviews is what gets built
  const [{ routes, amounts }] = useState(() => ({ routes: openedRoutes, amounts: openedAmounts }))
  const [status, setStatus] = useState<SplitStatus>("ready")
  const [error, setError] = useState<string | null>(null)
  const [parts, setParts] = useState<PartState[]>(() => routes.map(() => ({ status: "waiting", signature: null, quote: null, note: null })))
  const inFlight = useRef<AbortController | null>(null)
  // The parts' live quotes. They stop refreshing while the dialog is open, and fill in if one was still on its way.
  const quotes = routes.map((route) => live.byRoute[route.id])

  // Closing the dialog stops following the parts. Any that land show in Portfolio.
  useEffect(() => {
    if (!open) inFlight.current?.abort()
  }, [open])

  const slow = useSlowWallet(status === "signing")
  const total = amounts.reduce((sum, amount) => sum + Number(amount), 0)

  // The parts as this run sees them, kept beside the state so the end of the run reads them directly
  const current = useRef<PartState[]>(parts)
  const update = (index: number, change: Partial<PartState>) => {
    current.current = current.current.map((part, i) => (i === index ? { ...part, ...change } : part))
    setParts(current.current)
  }

  const handleConfirm = async () => {
    if (!publicKey) return
    inFlight.current?.abort()
    const controller = new AbortController()
    inFlight.current = controller
    // The parts still to go: all of them, or on a retry the ones that didn't land
    const pending = current.current.map((part, i) => (part.status === "landed" ? -1 : i)).filter((i) => i >= 0)
    setError(null)
    for (const i of pending) update(i, { status: "waiting", note: null })

    try {
      setStatus("building")
      const built = await DepositAPI.buildSplit({
        token,
        userPublicKey: publicKey.toBase58(),
        parts: pending.map((i) => ({ routeId: routes[i].id, amount: amounts[i] })),
      })
      if (controller.signal.aborted) return
      const plan = built.parts.map((part, k) => ({
        index: pending[k],
        lastValidBlockHeight: part.lastValidBlockHeight,
        transactions: (part.transactions?.length ? part.transactions : [part.transaction]).map((tx) =>
          VersionedTransaction.deserialize(base64ToBytes(tx))
        ),
      }))
      built.parts.forEach((part, k) => update(pending[k], { quote: part.quote }))

      setStatus("signing")
      // One approval for every part when the wallet can sign them together. Otherwise it asks for each.
      const signed = signAllTransactions ? await signAllTransactions(plan.flatMap((part) => part.transactions)) : null
      if (controller.signal.aborted) return
      setStatus("sending")

      let cursor = 0
      for (const part of plan) {
        update(part.index, { status: "sending" })
        let landed = true
        let note: string | null = null
        for (let t = 0; t < part.transactions.length; t++) {
          const transaction = signed ? signed[cursor + t] : part.transactions[t]
          try {
            let sig: string | null = null
            if (signed) {
              sig = await connection.sendRawTransaction(transaction.serialize())
              update(part.index, { signature: sig })
            }
            const outcome = await sendAndWatch({
              connection,
              sendTransaction: signed ? async () => sig! : sendTransaction,
              transaction,
              user: publicKey,
              lastValidBlockHeight: part.lastValidBlockHeight,
              signal: controller.signal,
              onSigned: (signature) => update(part.index, { signature }),
            })
            if (outcome.kind === "stopped") return
            if (outcome.kind === "declined") {
              landed = false
              note = "You declined this part in your wallet."
            } else if (outcome.kind === "expired") {
              landed = false
              note = "It didn't land in time."
            } else {
              update(part.index, { signature: outcome.signature })
              if (outcome.failed) {
                landed = false
                note = "It failed on-chain."
              }
            }
          } catch (err) {
            // The network refused it before it went out (a check failed, the price moved): nothing left the wallet for it
            landed = false
            note = isDeclined(err) ? "You declined this part in your wallet." : "It was refused before sending."
          }
          if (!landed) break
        }
        cursor += part.transactions.length
        update(part.index, { status: landed ? "landed" : "failed", note })
        if (landed) addHeld(routes[part.index].id)
      }
      if (controller.signal.aborted) return

      const landedNow = plan.some((part) => current.current[part.index].status === "landed")
      if (landedNow) {
        markPortfolioChanged()
        markStep("deposit")
        onDeposited?.()
      }
      setStatus(current.current.every((part) => part.status === "landed") ? "done" : "partial")
    } catch (err) {
      if (controller.signal.aborted) return
      setError(errorText(err))
      setStatus("error")
      for (const i of pending) if (current.current[i].status !== "landed") update(i, { status: "waiting" })
    }
  }

  const busy = status === "building" || status === "signing" || status === "sending"
  const finished = status === "done"
  const landedCount = parts.filter((part) => part.status === "landed").length
  const sendingIndex = parts.findIndex((part) => part.status === "sending")

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[452px] gap-0 rounded-[4px] border-gilt bg-card p-[5px] shadow-[0_24px_64px_rgba(0,0,0,0.45)] sm:max-w-[452px] [&>[data-slot=dialog-close]]:right-5 [&>[data-slot=dialog-close]]:top-5">
        <div className="plaque-inner max-h-[calc(100dvh-4rem)] overflow-y-auto">
          <DialogHeader className="gap-0.5 border-b border-hairline p-[18px] pb-3.5 pr-12 text-left">
            <DialogTitle className="font-display text-[26px] font-bold leading-[1.1]">Split across Top rated</DialogTitle>
            <DialogDescription className="text-[13px] text-muted-foreground">
              {routes.length} routes · even parts · one approval
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 p-[18px]">
            <div className="flex flex-col gap-1 rounded-[2px] border border-border bg-background px-4 py-3.5">
              <span className="label-roman text-[10px]">You deposit</span>
              <span className="text-2xl font-semibold">
                {formatTokenAmount(total, token)} {token}
              </span>
            </div>

            {/* Each part: the route, its share and what lands */}
            <ol className="m-0 list-none overflow-hidden rounded-[2px] border border-gilt p-0">
              {routes.map((route, i) => {
                const part = parts[i]
                const quote = part.quote ?? quotes[i]?.quote ?? null
                return (
                  <li key={route.id} className={cn("flex flex-col gap-1 border-t border-row-line px-3.5 py-3 first:border-t-0", part.status === "landed" ? "bg-ink-surface" : "bg-accent")}>
                    <div className="flex items-center gap-3">
                      <PartIcon status={part.status} />
                      <Medallion route={route} className="size-8 bg-card text-xs" />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate font-display text-[18px] font-bold leading-[1.1]">{route.name}</span>
                        <span className="text-[11px] text-muted-foreground">
                          Safety {route.safety?.score} · {formatApy(route)} APY
                        </span>
                      </span>
                      <span className="flex shrink-0 flex-col items-end">
                        <span className="text-[13px] font-semibold">
                          {formatTokenAmount(Number(amounts[i]), token)} {token}
                        </span>
                        {quote && (
                          <span className="text-[11px] text-muted-foreground">
                            {quote.position ? `in ${quote.position}` : `≈ ${Number(quote.outAmount).toLocaleString(undefined, { maximumFractionDigits: 4 })} ${quote.outputToken.symbol}`}
                          </span>
                        )}
                      </span>
                    </div>
                    {part.note && <p className="m-0 pl-[52px] text-[12px] text-destructive">{part.note} Its {formatTokenAmount(Number(amounts[i]), token)} {token} stays in your wallet.</p>}
                    {part.signature && (
                      <a
                        href={explorerTxUrl(part.signature)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 self-start pl-[52px] text-[11px] text-muted-foreground hover:text-ink"
                      >
                        View on Solscan <ExternalLink className="size-3" />
                      </a>
                    )}
                  </li>
                )
              })}
            </ol>

            {!finished && <SplitHorizons routes={routes} amounts={amounts} quotes={quotes} token={token} />}

            <dl className="m-0 flex flex-col gap-2 text-[13px]">
              <Row label="Approvals">{signAllTransactions ? "One, for every part" : `One per part (${routes.length})`}</Row>
              <Row label="Sent">One after another</Row>
              <Row label="Hermes fee">None</Row>
            </dl>

            {!finished && (
              <Notice tone="plain">
                <span className="font-medium text-foreground">What can go wrong:</span>
                {routes.map((route) => (
                  <span key={route.id} className="mt-1.5 block">
                    <span className="font-medium text-foreground">{route.name}.</span> {whatCanGoWrong(route)}
                  </span>
                ))}
                <span className="mt-1.5 block">Spreading a deposit means one route&apos;s bad day reaches part of it, not all.</span>
              </Notice>
            )}

            {!IS_DEVNET && status === "ready" && (
              <Notice tone="warning">
                Beta: real funds. A split is limited to one deposit&apos;s cap in all for now. Start with a small amount.
              </Notice>
            )}

            {status === "signing" && slow && (
              <Notice tone="plain">
                Waiting for your wallet. Nothing is sent until it signs. If it closed without signing, close this and try again:
                nothing left your wallet.
              </Notice>
            )}
            {status === "error" && error && <Notice tone="error">{error}</Notice>}
            {status === "partial" && (
              <Notice tone="warning">
                {landedCount} of {routes.length} parts landed and show in your Portfolio. The rest stays in your wallet. Try them
                again, or deposit them into one route.
              </Notice>
            )}
            {finished && (
              <Notice tone="success">
                Split confirmed. Each part is earning in its route. Withdraw or Reroute any of them from your Portfolio.
              </Notice>
            )}

            {finished ? (
              <button type="button" onClick={() => onOpenChange(false)} className="btn-frame h-[52px] w-full text-[15px]">
                Done
              </button>
            ) : (
              <button type="button" onClick={handleConfirm} disabled={busy || !publicKey} className="btn-teal h-[52px] w-full text-[15px]">
                {busy && <Loader2 className="size-4 animate-spin" />}
                {status === "building"
                  ? "Building each part..."
                  : status === "signing"
                    ? "Approve in wallet..."
                    : status === "sending"
                      ? `Sending ${sendingIndex + 1 || 1} of ${routes.length}...`
                      : status === "partial"
                        ? "Try the rest again"
                        : status === "error"
                          ? "Try again"
                          : `Confirm split · ${routes.length} deposits`}
              </button>
            )}
            <p className="-mt-1 text-center text-xs leading-relaxed text-muted-foreground">
              Hermes builds each deposit. You sign them in your wallet. Funds never touch Hermes.
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function PartIcon({ status }: { status: PartStatus }) {
  if (status === "landed") return <Check className="size-4 shrink-0 text-ink" strokeWidth={2.5} aria-label="Landed" />
  if (status === "failed") return <AlertCircle className="size-4 shrink-0 text-destructive" aria-label="Didn't land" />
  if (status === "sending") return <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" aria-label="Sending" />
  return <span aria-hidden="true" className="size-4 shrink-0 rounded-full border-2 border-gilt" />
}

// The whole split's three horizons, part by part added up
function SplitHorizons({
  routes,
  amounts,
  quotes,
  token,
}: {
  routes: YieldRoute[]
  amounts: string[]
  quotes: (RouteQuote | undefined)[]
  token: string
}) {
  return (
    <div className="flex flex-col gap-2 rounded-[2px] border border-hairline bg-background px-3.5 py-3">
      <span className="label-roman text-[10px]">In all, after costs, at today&apos;s APY</span>
      <dl className="m-0 grid grid-cols-3 gap-2">
        {HORIZONS.map((h) => {
          let value: number | null = 0
          for (let i = 0; i < routes.length && value !== null; i++) {
            const part = estimatedReturn(routes[i], Number(amounts[i]), quotes[i], h.value)
            value = part === null ? null : value + part
          }
          return (
            <div key={h.value} className="flex flex-col gap-0.5">
              <dt className="text-[11px] text-muted-foreground">{h.long}</dt>
              <dd className={cn("m-0 text-[14px] font-semibold", value !== null && value < 0 && "text-warning")}>
                {value === null ? (
                  <span className="text-muted-foreground">Pending</span>
                ) : (
                  <>
                    {formatEarned(value, token)} <span className="text-[11px] font-medium">{token}</span>
                  </>
                )}
              </dd>
            </div>
          )
        })}
      </dl>
      <p className="m-0 text-[11px] leading-relaxed text-muted-foreground">
        Each part&apos;s entry cost and, for staking tokens, the cost of selling back to SOL at today&apos;s price taken off.
        Rates move.
      </p>
    </div>
  )
}
