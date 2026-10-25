"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useConnection, useWallet } from "@solana/wallet-adapter-react"
import { VersionedTransaction } from "@solana/web3.js"
import { ExternalLink, Loader2 } from "lucide-react"

import { cn } from "@/lib/utils"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { MoveAPI, type MoveFinish, type MoveQuote } from "@/lib/api/move-api"
import type { YieldRoute } from "@/lib/api/yield-api"
import { isTopRated } from "@/lib/top-rated"
import { formatPercent } from "@/lib/helpers/formatters"
import { explorerTxUrl } from "@/lib/network"
import { Notice, Row, base64ToBytes } from "./deposit-dialog"
import { formatTokenAmount } from "./tokens"
import type { Position } from "./portfolio"
import { isDeclined, sendAndWatch, useSlowWallet } from "@/lib/send-transaction"

// Reroute: move a position into another route for the same token. Hermes proposes, the wallet signs. A staking token to a
// staking token is one Jupiter swap. Anything with lending in it is two steps: the withdrawal, then the deposit of
// what landed, each signed in the wallet. If step 2 fails, the funds wait in the wallet.

type Status =
  | "idle"
  | "quoting"
  | "ready"
  | "signing" // step 1, or the only step
  | "confirming"
  | "finishing" // building step 2 from what step 1 paid
  | "step2-ready" // step 2 carries a one-time rent: shown before it is signed
  | "step2-signing"
  | "step2-confirming"
  | "step2-error"
  | "success"
  | "unconfirmed"
  | "error"

const DEBOUNCE_MS = 400

function amountText(value: string | number, digits = 6): string {
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: digits })
}

function errorText(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  if (isDeclined(err)) return "You declined in your wallet. Nothing was sent."
  return message || "Reroute failed"
}

const apyText = (apy: number) => `${(apy * 100).toFixed(2)}%`

// A position's size as typed in the amount box: cut, never rounded up, to the token's decimals
const amountInput = (value: number, decimals: number) => {
  const factor = 10 ** decimals
  return String(Math.floor(value * factor) / factor)
}

// Routes a position can move into: the same token, deposits open, top rated first, then by APY
export function moveTargets(routes: YieldRoute[], position: Position): YieldRoute[] {
  return routes
    .filter((route) => route.token === position.token && route.deposit && route.id !== position.routeId)
    .sort((a, b) => Number(isTopRated(b)) - Number(isTopRated(a)) || b.apy - a.apy)
}

export function MoveDialog({
  position,
  routes,
  initialTo,
  open,
  onOpenChange,
  onDone,
}: {
  position: Position
  routes: YieldRoute[]
  initialTo: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onDone: () => void
}) {
  const { connection } = useConnection()
  const { publicKey, sendTransaction, signAllTransactions } = useWallet()
  const lending = position.category === "lending"
  const unit = lending ? position.token : position.holding.symbol
  const heldStart = lending ? (position.value ?? 0) : position.holding.amount
  const decimals = position.token === "SOL" ? 9 : 6

  const targets = useMemo(() => moveTargets(routes, position), [routes, position])
  const topRated = targets.filter(isTopRated)

  const [to, setTo] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)
  const [amount, setAmount] = useState("")
  const [all, setAll] = useState(true)
  const [status, setStatus] = useState<Status>("idle")
  const [quote, setQuote] = useState<MoveQuote | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [signature, setSignature] = useState<string | null>(null)
  // The reroute step in flight, stopped when the dialog closes
  const inFlight = useRef<AbortController | null>(null)
  const follow = () => {
    inFlight.current?.abort()
    inFlight.current = new AbortController()
    return inFlight.current.signal
  }
  useEffect(() => {
    if (!open) inFlight.current?.abort()
  }, [open])
  const [step1, setStep1] = useState<string | null>(null) // step 1's signature, once it is confirmed
  const [finish, setFinish] = useState<MoveFinish | null>(null)

  // A fresh start every time the dialog opens: the whole position, into the proposed route
  useEffect(() => {
    if (!open) return
    const start = initialTo ?? targets[0]?.id ?? null
    setTo(start)
    setShowAll(!!start && !topRated.some((route) => route.id === start))
    setAmount(amountInput(heldStart, decimals))
    setAll(true)
    setStatus("idle")
    setQuote(null)
    setError(null)
    setSignature(null)
    setStep1(null)
    setFinish(null)
    // targets are read once per opening
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const wallet = publicKey?.toBase58()
  const wanted = all || Number(amount) > 0
  const locked = !["idle", "quoting", "ready", "error"].includes(status)
  const target = targets.find((route) => route.id === to) ?? null

  // Quote as the target or amount changes, a moment after typing stops
  useEffect(() => {
    if (!open || !wallet || !to || !wanted || locked) return
    const controller = new AbortController()
    setStatus("quoting")
    setError(null)
    const timer = setTimeout(() => {
      MoveAPI.quote({ from: position.routeId, to, amount: all ? undefined : amount, all, userPublicKey: wallet }, controller.signal)
        .then((q) => {
          setQuote(q)
          // The whole position, as the API counts it
          if (all && q.inAmount !== amount) setAmount(q.inAmount)
          setStatus("ready")
        })
        .catch((err) => {
          if (err?.name === "AbortError") return
          setQuote(null)
          setError(errorText(err))
          setStatus("error")
        })
    }, DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
    // status is left out on purpose: a quote should not re-run when it finishes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, wallet, to, amount, all, position.routeId])

  const held = quote ? Number(quote.held) : heldStart
  const onAmount = (value: string) => {
    if (!/^\d*\.?\d*$/.test(value)) return
    setAmount(value)
    setAll(false)
    if (!value) {
      setQuote(null)
      setStatus("idle")
    }
  }
  const useMax = () => {
    setAmount(String(held))
    setAll(true)
  }

  // Send one built transaction through the wallet and follow it to the chain, from the wallet's answer or the chain,
  // whichever comes first. Null when the dialog closed first.
  const sendAndConfirm = async (
    encoded: string,
    lastValidBlockHeight: number,
    confirmingStatus: Status,
    signal: AbortSignal
  ): Promise<string | null> => {
    if (!publicKey) return null
    const outcome = await sendAndWatch({
      connection,
      sendTransaction,
      transaction: VersionedTransaction.deserialize(base64ToBytes(encoded)),
      user: publicKey,
      lastValidBlockHeight,
      signal,
      onSigned: (sig) => {
        setSignature(sig)
        setStatus(confirmingStatus)
      },
    })
    if (outcome.kind === "stopped") return null
    if (outcome.kind === "declined") throw new Error("You declined in your wallet. Nothing was sent.")
    if (outcome.kind === "expired") {
      throw new Error(`Your wallet didn't send it, so nothing moved.${outcome.reason ? ` ${outcome.reason}.` : ""} Try again.`)
    }
    setSignature(outcome.signature)
    if (outcome.failed) throw new Error("failed on-chain")
    return outcome.signature
  }

  // Step 2: build the deposit of what step 1 paid in, then sign it, unless it carries a one-time rent to show first
  const runStep2 = async (step1Signature: string, signNow: boolean) => {
    if (!publicKey || !to) return
    const signal = follow()
    try {
      let built = finish
      if (!built) {
        setStatus("finishing")
        built = await MoveAPI.finish({
          from: position.routeId,
          to,
          amount: all ? undefined : amount,
          all,
          userPublicKey: publicKey.toBase58(),
          signature: step1Signature,
        })
        if (signal.aborted) return
        setFinish(built)
        if (Number(built.quote.setupCostSol) > 0 && !signNow) {
          setStatus("step2-ready")
          return
        }
      }
      setStatus("step2-signing")
      const encoded = built.transactions?.length ? built.transactions : [built.transaction]
      const transactions = encoded.map((tx) => VersionedTransaction.deserialize(base64ToBytes(tx)))
      // More than one transaction (a stake pool update first) is signed up front and sent in order
      const signed = transactions.length > 1 && signAllTransactions ? await signAllTransactions(transactions) : null
      for (let i = 0; i < transactions.length; i++) {
        if (!signed) {
          let sig: string | null
          try {
            sig = await sendAndConfirm(encoded[i], built.lastValidBlockHeight, "step2-confirming", signal)
          } catch (err) {
            if (err instanceof Error && err.message === "failed on-chain") throw new Error("Step 2 failed on-chain. Nothing was deposited.")
            throw err
          }
          if (!sig) return
          continue
        }
        const sig = await connection.sendRawTransaction(signed[i].serialize())
        setSignature(sig)
        setStatus("step2-confirming")
        let result
        try {
          result = await connection.confirmTransaction(
            { signature: sig, blockhash: transactions[i].message.recentBlockhash, lastValidBlockHeight: built.lastValidBlockHeight },
            "confirmed"
          )
        } catch (confirmErr) {
          console.warn("Could not confirm move step 2", confirmErr)
          // Sent but not checked. Never offer a retry here: it could deposit twice.
          setStatus("unconfirmed")
          onDone()
          return
        }
        if (result.value.err) throw new Error("Step 2 failed on-chain. Nothing was deposited.")
      }
      if (signal.aborted) return
      setStatus("success")
      onDone()
    } catch (err) {
      if (signal.aborted) return
      // A failed build or a rejected signature starts step 2 over with a fresh transaction
      setFinish(null)
      setError(errorText(err))
      setStatus("step2-error")
    }
  }

  const handleMove = async () => {
    if (!publicKey || !to) return
    const signal = follow()
    try {
      setStatus("signing")
      setError(null)
      const built = await MoveAPI.build({ from: position.routeId, to, amount: all ? undefined : amount, all, userPublicKey: publicKey.toBase58() })
      if (signal.aborted) return
      setQuote(built.quote)
      let sig: string | null
      try {
        sig = await sendAndConfirm(built.transaction, built.lastValidBlockHeight, "confirming", signal)
      } catch (err) {
        if (err instanceof Error && err.message === "failed on-chain") {
          throw new Error(built.steps === 1 ? "The swap failed on-chain. Nothing was rerouted." : "The withdrawal failed on-chain. Nothing left your position.")
        }
        throw err
      }
      // The dialog closed while it was in flight
      if (!sig) return
      if (built.steps === 1) {
        setStatus("success")
        onDone()
        return
      }
      setStep1(sig)
      onDone()
      await runStep2(sig, false)
    } catch (err) {
      if (signal.aborted) return
      setError(errorText(err))
      setStatus("error")
    }
  }

  const busy = ["signing", "confirming", "finishing", "step2-signing", "step2-confirming"].includes(status)
  const slow = useSlowWallet(status === "signing" || status === "step2-signing")
  const cost = quote ? Number(quote.cost) : 0
  const costShare = quote && Number(quote.valueIn) > 0 ? cost / Number(quote.valueIn) : 0
  const extra = quote ? Number(quote.extraPerYear) : 0
  const limited = quote?.available !== null && quote?.available !== undefined && Number(quote.available) < held
  const lowerScore = target?.safety && position.safety !== null && target.safety.score < position.safety
  const shown = showAll ? targets : topRated.length > 0 ? topRated : targets
  const doneText =
    quote && target
      ? quote.kind === "swap"
        ? `Reroute confirmed. About ${amountText(quote.outAmount)} ${quote.outputToken.symbol} is in your wallet.`
        : `Reroute confirmed. ${amountText(finish?.quote.inAmount ?? quote.inAmount)} ${quote.token} went into ${target.name}.`
      : "Reroute confirmed."

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[452px] gap-0 rounded-[4px] border-gilt bg-card p-[5px] shadow-[0_24px_64px_rgba(0,0,0,0.45)] sm:max-w-[452px] [&>[data-slot=dialog-close]]:right-5 [&>[data-slot=dialog-close]]:top-5">
        <div className="plaque-inner max-h-[calc(100dvh-4rem)] overflow-y-auto">
          <DialogHeader className="flex-row items-start gap-3 border-b border-hairline p-[18px] pb-3.5 pr-12 text-left">
            <span aria-hidden="true" className="medallion size-11 text-[17px]">
              {position.name.charAt(0)}
            </span>
            <div className="flex min-w-0 flex-col gap-0.5">
              <DialogTitle className="font-display text-[26px] font-bold leading-[1.1]">Reroute from {position.name}</DialogTitle>
              <DialogDescription className="text-[13px] text-muted-foreground">
                {amountText(held, 6)} {unit} {lending ? `in ${position.name}` : "in your wallet"}
                {position.apy !== null && ` · ${apyText(position.apy)} APY`}
              </DialogDescription>
            </div>
          </DialogHeader>

          <div className="flex flex-col gap-4 p-[18px]">
            {targets.length === 0 ? (
              <Notice tone="plain">No other {position.token} route takes deposits in Hermes right now.</Notice>
            ) : (
              <div className="flex flex-col gap-1.5">
                <span className="label-roman text-[10px]">Reroute to</span>
                <div role="radiogroup" aria-label="Route to reroute to" className="flex flex-col gap-1">
                  {shown.map((route) => {
                    const selected = route.id === to
                    return (
                      <button
                        key={route.id}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        disabled={locked}
                        onClick={() => setTo(route.id)}
                        className={cn(
                          "flex items-center gap-2.5 rounded-[2px] border px-3 py-2 text-left transition-colors disabled:opacity-60",
                          selected ? "border-ink-line bg-accent" : "border-hairline hover:bg-secondary"
                        )}
                      >
                        <span aria-hidden="true" className="medallion size-8 text-xs">
                          {route.name.charAt(0)}
                        </span>
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate font-display text-[17px] font-bold leading-tight">{route.name}</span>
                          <span className="text-[11px] text-muted-foreground">
                            {route.safety ? `Safety ${route.safety.score}` : "Not scored"}
                            {isTopRated(route) && " · Top rated"}
                          </span>
                        </span>
                        <span className={cn("font-roman text-[15px] font-bold", selected && "text-ink")}>{apyText(route.apy)}</span>
                      </button>
                    )
                  })}
                </div>
                {topRated.length > 0 && topRated.length < targets.length && (
                  <button
                    type="button"
                    onClick={() => setShowAll((value) => !value)}
                    disabled={locked}
                    className="self-start text-xs font-medium text-ink underline underline-offset-2 disabled:opacity-50"
                  >
                    {showAll ? "Top rated only" : `Show all ${targets.length} routes`}
                  </button>
                )}
              </div>
            )}

            <div className="flex flex-col gap-1.5 rounded-[2px] border border-border bg-background px-4 py-3.5 focus-within:border-ink">
              <div className="flex items-center justify-between gap-3">
                <label htmlFor="move-amount" className="label-roman text-[10px]">
                  Amount
                </label>
                <button
                  type="button"
                  onClick={useMax}
                  disabled={locked}
                  className="text-xs font-medium text-ink underline underline-offset-2 disabled:opacity-50"
                >
                  Max
                </button>
              </div>
              <div className="flex items-center gap-3">
                <input
                  id="move-amount"
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="0"
                  value={amount}
                  onChange={(e) => onAmount(e.target.value)}
                  disabled={locked}
                  className="min-w-0 flex-1 bg-transparent p-0 text-2xl font-semibold text-foreground outline-none"
                />
                <span className="shrink-0 text-[15px] font-semibold">{unit}</span>
              </div>
            </div>

            {quote ? (
              <dl className="m-0 flex flex-col gap-2 text-[13px]">
                <Row label="You get">
                  {quote.kind === "swap" || quote.outputToken.symbol !== quote.token ? "≈ " : ""}
                  {amountText(quote.outAmount)} {quote.outputToken.symbol}
                  {target && quote.outputToken.symbol === quote.token && ` in ${target.name}`}
                </Row>
                <Row label="APY">
                  {apyText(quote.fromApy)} → <span className={cn(quote.toApy > quote.fromApy && "text-ink")}>{apyText(quote.toApy)}</span>
                </Row>
                <Row label="Cost to reroute" className={cn(costShare > 0.005 && "text-warning")}>
                  {cost <= 0 ? "None" : `${formatPercent(costShare * 100)} (${formatTokenAmount(cost, quote.token)} ${quote.token})`}
                </Row>
                <Row label="A year at today's rates" className={cn(extra < 0 && "text-warning")}>
                  {extra >= 0 ? "+" : "−"}
                  {formatTokenAmount(Math.abs(extra), quote.token)} {quote.token} {extra >= 0 ? "more" : "less"}
                </Row>
                {quote.breakEvenDays !== null && quote.breakEvenDays > 0 && (
                  <Row label="Makes the cost back in">About {quote.breakEvenDays} days</Row>
                )}
                <Row label="Steps">{quote.kind === "swap" ? "One swap, one signature" : "Withdraw, then deposit: two signatures"}</Row>
                {limited && quote.available !== null && (
                  <Row label="Can leave right now" className="text-warning">
                    {amountText(quote.available, 2)} {quote.inputToken.symbol}
                  </Row>
                )}
                {quote.rentBackSol && <Row label="Account rent back">{amountText(quote.rentBackSol)} SOL</Row>}
              </dl>
            ) : status === "quoting" ? (
              <span className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" /> Fetching quote...
              </span>
            ) : null}

            {lowerScore && target?.safety && status !== "success" && (
              <Notice tone="plain">
                {target.name} scores {target.safety.score}, lower than {position.name}&apos;s {position.safety}.
              </Notice>
            )}
            {quote?.firstKaminoDeposit && !finish && status !== "success" && (
              <Notice tone="plain">
                A first Kamino deposit pays one-time account rent (about 0.03 SOL). Hermes shows it before you sign step 2.
              </Notice>
            )}
            {status !== "success" && status !== "step2-ready" && (
              <Notice tone="warning">Beta: rerouting is new and moves real funds. Start with a small amount.</Notice>
            )}

            {step1 && status !== "success" && (
              <Notice tone="success">
                Step 1 of 2 confirmed. {finish ? `${amountText(finish.received)} ${quote?.token ?? position.token}` : `The ${position.token}`} is
                in your wallet.
                {finish?.kept && ` ${amountText(finish.kept)} SOL stays there for fees.`}
              </Notice>
            )}
            {status === "step2-ready" && finish && (
              <Notice tone="plain">
                Step 2 deposits {amountText(finish.quote.inAmount)} {finish.quote.inputToken.symbol} into {target?.name}. A first
                deposit pays {amountText(finish.quote.setupCostSol ?? 0)} SOL of one-time account rent.
              </Notice>
            )}
            {(status === "signing" || status === "step2-signing") && slow && (
              <Notice tone="plain">
                Waiting for your wallet. If you approved it, it shows here as soon as it lands. You can close this:
                Portfolio updates when it lands.
              </Notice>
            )}
            {status === "error" && error && <Notice tone="error">{error}</Notice>}
            {status === "step2-error" && (
              <Notice tone="error">
                Step 2 didn&apos;t go through: {error} The {position.token} from step 1 is safe in your wallet. Try step 2 again,
                or deposit it from the app.
              </Notice>
            )}
            {status === "success" && <Notice tone="success">{doneText}</Notice>}
            {status === "unconfirmed" && (
              <Notice tone="warning">Transaction sent, but Hermes could not confirm it yet. Check Solscan before trying again.</Notice>
            )}
            {signature && (
              <a
                href={explorerTxUrl(signature)}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-1 text-xs text-muted-foreground hover:text-ink"
              >
                View on Solscan <ExternalLink className="size-3" />
              </a>
            )}

            {status === "success" || status === "unconfirmed" ? (
              <button type="button" onClick={() => onOpenChange(false)} className="btn-frame h-[52px] w-full text-[15px]">
                Done
              </button>
            ) : status === "step2-ready" || status === "step2-error" ? (
              <button type="button" onClick={() => step1 && runStep2(step1, true)} className="btn-teal h-[52px] w-full text-[15px]">
                {status === "step2-ready" ? "Sign step 2" : "Try step 2 again"}
              </button>
            ) : (
              <button
                type="button"
                onClick={handleMove}
                // A failed build keeps its quote, so it can be tried again. A failed quote leaves none.
                disabled={!quote || busy || status === "quoting" || !publicKey || !to}
                className="btn-teal h-[52px] w-full text-[15px]"
              >
                {busy && <Loader2 className="size-4 animate-spin" />}
                {status === "signing"
                  ? "Approve in wallet..."
                  : status === "confirming"
                    ? quote?.kind === "two-step"
                      ? "Confirming step 1..."
                      : "Confirming..."
                    : status === "finishing"
                      ? "Building step 2..."
                      : status === "step2-signing"
                        ? "Approve step 2 in wallet..."
                        : status === "step2-confirming"
                          ? "Confirming step 2..."
                          : status === "error"
                            ? "Try again"
                            : target
                              ? `Reroute to ${target.name}`
                              : "Reroute"}
              </button>
            )}
            <p className="-mt-1 text-center text-xs leading-relaxed text-muted-foreground">
              Hermes builds each transaction. You sign it in your wallet. Funds never touch Hermes.
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
