"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { RotateCw } from "lucide-react"

import { cn } from "@/lib/utils"
import { getFullUrl, YieldAPI, type YieldRoute } from "@/lib/api/yield-api"
import { isTopRated } from "@/lib/top-rated"
import { takePortfolioChanged } from "@/lib/portfolio-changed"
import { formatTokenAmount } from "./tokens"
import { WithdrawDialog } from "./withdraw-dialog"
import { MoveDialog, moveTargets } from "./move-dialog"

// What the connected wallet holds in each route Hermes lists and what it has earned. The API reads it live from the
// chain, Kamino and Jupiter Lend, and keeps each wallet's answer a minute.

export interface Position {
  routeId: string
  name: string
  category: "liquid-staking" | "lending"
  token: string // what value and earned are counted in
  holding: { amount: number; symbol: string }
  value: number | null
  valueUsd: number | null
  earned: number | null
  earnedUsd: number | null
  earnedNote: string | null
  since: string | null
  apy: number | null
  safety: number | null
  website: string
  source: string
  note: string | null
}

export interface Portfolio {
  address: string
  positions: Position[]
  totalUsd: number | null // null when a value couldn't be priced right now
  earnedUsd: number | null
  prices: Partial<Record<"SOL" | "USDC" | "USDT", number>> // USD
  unavailable: string[]
  history: boolean
  updatedAt: string
}

type State = { status: "idle" | "loading" | "error"; portfolio: Portfolio | null } | { status: "ready"; portfolio: Portfolio }

export function usePortfolio(address: string | null, active: boolean) {
  const [state, setState] = useState<State>({ status: "idle", portfolio: null })
  const [tick, setTick] = useState(0)
  const refresh = useCallback(() => setTick((n) => n + 1), [])

  // A new wallet starts empty, never with the last wallet's positions
  useEffect(() => setState({ status: "idle", portfolio: null }), [address])

  useEffect(() => {
    if (!address || !active) return
    const controller = new AbortController()
    setState((prev) => ({ status: "loading", portfolio: prev.portfolio?.address === address ? prev.portfolio : null }))
    // A refresh (the button, or after a transaction) asks the API to read again, not to repeat its minute-old answer
    const fresh = takePortfolioChanged() || tick > 0
    fetch(getFullUrl(`/api/portfolio/${address}${fresh ? "?fresh=1" : ""}`), { signal: controller.signal, cache: "no-store" })
      .then((res) => res.json())
      .then((json) => {
        if (json?.success && json.portfolio) setState({ status: "ready", portfolio: json.portfolio })
        else setState((prev) => ({ status: "error", portfolio: prev.portfolio }))
      })
      .catch(() => {
        if (!controller.signal.aborted) setState((prev) => ({ status: "error", portfolio: prev.portfolio }))
      })
    return () => controller.abort()
  }, [address, active, tick])

  return { ...state, refresh }
}

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" })

export function formatUsd(value: number): string {
  if (value !== 0 && Math.abs(value) < 0.01) return value < 0 ? "−<$0.01" : "<$0.01"
  return value < 0 ? `−${usd.format(-value)}` : usd.format(value)
}

function signed(value: number, token: string): string {
  return `${value < 0 ? "−" : "+"}${formatTokenAmount(Math.abs(value), token)} ${token}`
}

// Read the positions again once a transaction lands, and once more a few seconds later: the RPC is several nodes, and
// the first read can reach one that hasn't seen the transaction yet
function afterTransaction(refresh: () => void) {
  refresh()
  setTimeout(refresh, 5_000)
}

// Hermes proposes a reroute when a top rated route for the same token pays at least half a point more today
const SUGGEST_GAIN = 0.005

function suggestion(routes: YieldRoute[], position: Position): YieldRoute | null {
  if (position.apy === null) return null
  const best = moveTargets(routes, position)
    .filter(isTopRated)
    .reduce<YieldRoute | null>((top, route) => (!top || route.apy > top.apy ? route : top), null)
  return best && best.apy - position.apy >= SUGGEST_GAIN ? best : null
}

// What the wallet has in Hermes's routes: the total, then one row per position with what it holds and its Safety
// Score, what it's worth and what it has earned
export function PortfolioSection({
  status,
  portfolio,
  onRefresh,
  onWithdrawn,
}: {
  status: State["status"]
  portfolio: Portfolio | null
  onRefresh: () => void
  onWithdrawn?: () => void // after a withdrawal lands, so the wallet's balances refresh too
}) {
  const loading = status === "loading"
  // The position being withdrawn from. Kept while the dialog closes, so it doesn't empty mid-animation.
  const [withdrawing, setWithdrawing] = useState<Position | null>(null)
  const [withdrawOpen, setWithdrawOpen] = useState(false)
  // The position being moved, and the route proposed for it
  const [moving, setMoving] = useState<{ position: Position; to: string | null } | null>(null)
  const [moveOpen, setMoveOpen] = useState(false)
  const positions = portfolio?.positions ?? []
  const missingEarned = positions.some((p) => p.earned === null && !p.earnedNote)

  // Live routes, for moves and their proposals. Loaded once there is something to move.
  const [routes, setRoutes] = useState<YieldRoute[]>([])
  const hasPositions = positions.length > 0
  useEffect(() => {
    if (!hasPositions) return
    const controller = new AbortController()
    YieldAPI.getRoutes(undefined, { signal: controller.signal })
      .then(setRoutes)
      .catch(() => {})
    return () => controller.abort()
  }, [hasPositions])

  const openMove = (position: Position, to: string | null) => {
    setMoving({ position, to })
    setMoveOpen(true)
  }

  return (
    <section aria-label="Earning" className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="label-roman">Earning</h2>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          aria-label="Refresh positions"
          className="grid size-9 place-items-center rounded-[4px] text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-60"
        >
          <RotateCw className={cn("size-4", loading && "animate-spin")} />
        </button>
      </div>

      {portfolio ? (
        <div className="flex flex-col gap-0.5">
          <span className="text-[34px] font-semibold leading-tight text-foreground">
            {portfolio.totalUsd !== null ? formatUsd(portfolio.totalUsd) : "—"}
          </span>
          <span className="text-[13px] text-muted-foreground">
            {portfolio.totalUsd === null ? (
              <>
                Prices didn&apos;t load, so the total is missing.{" "}
                <button type="button" onClick={onRefresh} className="font-medium underline underline-offset-2">
                  Try again
                </button>
              </>
            ) : portfolio.prices.SOL ? (
              `≈ ${formatTokenAmount(portfolio.totalUsd / portfolio.prices.SOL, "SOL")} SOL`
            ) : null}
            {portfolio.earnedUsd !== null && (
              <>
                {portfolio.totalUsd !== null && portfolio.prices.SOL ? " · " : null}
                <span className={portfolio.earnedUsd >= 0 ? "text-success" : "text-warning"}>
                  {portfolio.earnedUsd >= 0 ? "+" : ""}
                  {formatUsd(portfolio.earnedUsd)} earned
                </span>
              </>
            )}
          </span>
        </div>
      ) : status === "error" ? null : (
        <span aria-hidden="true" className="h-10 w-40 animate-pulse rounded-[2px] bg-hairline" />
      )}

      {status === "error" && (
        <p className="text-[13px] text-warning">
          Your positions didn&apos;t load.{" "}
          <button type="button" onClick={onRefresh} className="font-medium underline underline-offset-2">
            Try again
          </button>
        </p>
      )}
      {portfolio && portfolio.unavailable.length > 0 && (
        <p className="text-[13px] text-warning">
          {portfolio.unavailable.join(" and ")} didn&apos;t answer, so some positions may be missing.{" "}
          <button type="button" onClick={onRefresh} className="font-medium underline underline-offset-2">
            Try again
          </button>
        </p>
      )}

      {portfolio && positions.length === 0 && portfolio.unavailable.length === 0 && (
        <p className="rounded-[2px] border border-hairline bg-background px-3 py-4 text-center text-[13px] text-muted-foreground">
          No Hermes routes in this wallet yet.{" "}
          <Link href="/app" className="font-medium text-ink underline underline-offset-2">
            Find a route
          </Link>
        </p>
      )}

      {positions.length > 0 && (
        <ul className="m-0 flex list-none flex-col overflow-hidden rounded-[4px] border border-frame p-0">
          {positions.map((p) => {
            const better = suggestion(routes, p)
            return (
              <li key={p.routeId} className="border-t border-row-line bg-card first:border-t-0">
                <div className="flex items-center gap-3 px-3 pt-2.5">
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="font-display text-[19px] font-bold leading-[1.1]">{p.name}</span>
                    <span className="text-[11px] text-muted-foreground">
                      {formatTokenAmount(p.holding.amount, p.token)} {p.holding.symbol}
                      {p.safety !== null && ` · Safety ${p.safety}`}
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-0.5">
                    <span className="text-[15px] font-semibold">
                      {p.valueUsd !== null ? formatUsd(p.valueUsd) : p.value !== null ? `${formatTokenAmount(p.value, p.token)} ${p.token}` : "—"}
                    </span>
                    {p.earned !== null && (
                      <span className={cn("text-[11px]", p.earned >= 0 ? "text-success" : "text-warning")}>
                        {signed(p.earned, p.token)}
                      </span>
                    )}
                  </span>
                </div>
                {(p.earnedNote || p.note) && (
                  <p className="px-3 pt-1 text-[11px] leading-relaxed text-muted-foreground">{p.note ?? p.earnedNote}</p>
                )}
                {better && p.apy !== null && (
                  <div className="mx-3 mt-2 flex items-center gap-3 rounded-[2px] border border-frame bg-secondary px-3 py-2">
                    <span className="min-w-0 flex-1 text-[12px] leading-snug">
                      <span className="font-semibold">{better.name}</span> pays{" "}
                      <span className="font-semibold text-ink">{(better.apy * 100).toFixed(2)}%</span>,{" "}
                      {((better.apy - p.apy) * 100).toFixed(2)} points more. Top rated, Safety {better.safety?.score}.
                    </span>
                    <button type="button" onClick={() => openMove(p, better.id)} className="btn-frame h-8 shrink-0 px-3 text-[12px]">
                      Reroute
                    </button>
                  </div>
                )}
                <div className="flex items-center gap-2 px-3 pb-2.5 pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setWithdrawing(p)
                      setWithdrawOpen(true)
                    }}
                    className="btn-frame h-9 px-3.5 text-[13px]"
                  >
                    Withdraw
                  </button>
                  {/* With a proposal above, its Reroute button is the one */}
                  {!better && (
                    <button
                      type="button"
                      onClick={() => openMove(p, null)}
                      disabled={routes.length === 0}
                      className="btn-frame h-9 px-3.5 text-[13px]"
                    >
                      Reroute
                    </button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {positions.length > 0 && (
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Live from your wallet, Kamino, Jupiter Lend and Project 0. Earned is what a position is worth now minus what
          you paid in, network fees aside.
          {missingEarned && " Earned for staking tokens, Jupiter Lend and Project 0 is coming soon."}
        </p>
      )}
      {moving && (
        <MoveDialog
          position={moving.position}
          routes={routes}
          initialTo={moving.to}
          open={moveOpen}
          onOpenChange={setMoveOpen}
          onDone={() => {
            afterTransaction(onRefresh)
            onWithdrawn?.()
          }}
        />
      )}
      {withdrawing && (
        <WithdrawDialog
          position={withdrawing}
          open={withdrawOpen}
          onOpenChange={setWithdrawOpen}
          onDone={() => {
            afterTransaction(onRefresh)
            onWithdrawn?.()
          }}
        />
      )}
    </section>
  )
}
