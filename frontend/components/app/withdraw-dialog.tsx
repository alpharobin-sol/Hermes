"use client"

import { useEffect, useRef, useState } from "react"
import { useConnection, useWallet } from "@solana/wallet-adapter-react"
import { VersionedTransaction } from "@solana/web3.js"
import { ArrowDown, ExternalLink, Loader2 } from "lucide-react"

import { cn } from "@/lib/utils"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { WithdrawAPI, type WithdrawQuote } from "@/lib/api/withdraw-api"
import { formatPercent } from "@/lib/helpers/formatters"
import { explorerTxUrl } from "@/lib/network"
import { Notice, Row, base64ToBytes } from "./deposit-dialog"
import type { Position } from "./portfolio"
import { isDeclined, sendAndWatch, useSlowWallet } from "@/lib/send-transaction"

// Withdraw from a position in the wallet, the way a deposit works in reverse: Hermes builds the transaction and the
// wallet signs it. Staking tokens swap back to SOL on Jupiter. Kamino Lend and Jupiter Lend pay the token back.

type Status = "idle" | "quoting" | "ready" | "signing" | "confirming" | "success" | "unconfirmed" | "error"

const DEBOUNCE_MS = 400

function amountText(value: string | number, digits = 6): string {
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: digits })
}

function errorText(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  if (isDeclined(err)) return "You declined in your wallet. Nothing was sent."
  return message || "Withdrawal failed"
}

export function WithdrawDialog({
  position,
  open,
  onOpenChange,
  onDone,
}: {
  position: Position
  open: boolean
  onOpenChange: (open: boolean) => void
  onDone: () => void
}) {
  const { connection } = useConnection()
  const { publicKey, sendTransaction } = useWallet()
  const lending = position.category === "lending"
  const unit = lending ? position.token : position.holding.symbol
  const heldStart = lending ? (position.value ?? 0) : position.holding.amount

  const [amount, setAmount] = useState("")
  const [all, setAll] = useState(false)
  const [status, setStatus] = useState<Status>("idle")
  const [quote, setQuote] = useState<WithdrawQuote | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [signature, setSignature] = useState<string | null>(null)
  // The withdrawal in flight, stopped when the dialog closes
  const inFlight = useRef<AbortController | null>(null)
  const slow = useSlowWallet(status === "signing")
  useEffect(() => {
    if (!open) inFlight.current?.abort()
  }, [open])

  // A fresh start every time the dialog opens
  useEffect(() => {
    if (!open) return
    setAmount("")
    setAll(false)
    setStatus("idle")
    setQuote(null)
    setError(null)
    setSignature(null)
  }, [open])

  const wallet = publicKey?.toBase58()
  const wanted = all || Number(amount) > 0

  // Quote as the amount changes, a moment after typing stops
  useEffect(() => {
    if (!open || !wallet || !wanted || status === "signing" || status === "confirming" || status === "success") return
    const controller = new AbortController()
    setStatus("quoting")
    setError(null)
    const timer = setTimeout(() => {
      WithdrawAPI.quote({ routeId: position.routeId, amount: all ? undefined : amount, all, userPublicKey: wallet }, controller.signal)
        .then((q) => {
          setQuote(q)
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
  }, [open, wallet, amount, all, position.routeId])

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

  const handleWithdraw = async () => {
    if (!publicKey) return
    inFlight.current?.abort()
    const controller = new AbortController()
    inFlight.current = controller
    try {
      setStatus("signing")
      setError(null)
      const built = await WithdrawAPI.build({
        routeId: position.routeId,
        amount: all ? undefined : amount,
        all,
        userPublicKey: publicKey.toBase58(),
      })
      if (controller.signal.aborted) return
      setQuote(built.quote)
      // The wallet signs and sends it. Hermes follows the wallet's answer and the chain, whichever comes first.
      const outcome = await sendAndWatch({
        connection,
        sendTransaction,
        transaction: VersionedTransaction.deserialize(base64ToBytes(built.transaction)),
        user: publicKey,
        lastValidBlockHeight: built.lastValidBlockHeight,
        signal: controller.signal,
        onSigned: (sig) => {
          setSignature(sig)
          setStatus("confirming")
        },
      })
      if (outcome.kind === "stopped") return
      if (outcome.kind === "declined") throw new Error("You declined in your wallet. Nothing was sent.")
      if (outcome.kind === "expired") {
        throw new Error(`Your wallet didn't send the withdrawal, so nothing left your position.${outcome.reason ? ` ${outcome.reason}.` : ""} Try again.`)
      }
      setSignature(outcome.signature)
      if (outcome.failed) throw new Error("The withdrawal failed on-chain. Nothing left your position.")
      setStatus("success")
      onDone()
    } catch (err) {
      if (controller.signal.aborted) return
      setError(errorText(err))
      setStatus("error")
    }
  }

  const busy = status === "signing" || status === "confirming"
  const exitCost = quote?.value && Number(quote.value) > 0 ? 1 - Number(quote.outAmount) / Number(quote.value) : null
  const limited = quote?.available !== null && quote?.available !== undefined && Number(quote.available) < held

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[452px] gap-0 rounded-[4px] border-gilt bg-card p-[5px] shadow-[0_24px_64px_rgba(0,0,0,0.45)] sm:max-w-[452px] [&>[data-slot=dialog-close]]:right-5 [&>[data-slot=dialog-close]]:top-5">
        <div className="plaque-inner max-h-[calc(100dvh-4rem)] overflow-y-auto">
          <DialogHeader className="flex-row items-start gap-3 border-b border-hairline p-[18px] pb-3.5 pr-12 text-left">
            <span aria-hidden="true" className="medallion size-11 text-[17px]">
              {position.name.charAt(0)}
            </span>
            <div className="flex min-w-0 flex-col gap-0.5">
              <DialogTitle className="font-display text-[26px] font-bold leading-[1.1]">Withdraw from {position.name}</DialogTitle>
              <DialogDescription className="text-[13px] text-muted-foreground">
                {lending
                  ? `${amountText(held, 6)} ${position.token} in ${position.name}`
                  : `${amountText(held, 6)} ${position.holding.symbol} in your wallet`}
              </DialogDescription>
            </div>
          </DialogHeader>

          <div className="flex flex-col gap-4 p-[18px]">
            <div className="relative flex flex-col gap-1.5">
              <div className="flex flex-col gap-1.5 rounded-[2px] border border-border bg-background px-4 py-3.5 focus-within:border-ink">
                <div className="flex items-center justify-between gap-3">
                  <label htmlFor="withdraw-amount" className="label-roman text-[10px]">
                    You withdraw
                  </label>
                  <button
                    type="button"
                    onClick={useMax}
                    disabled={busy || status === "success"}
                    className="text-xs font-medium text-ink underline underline-offset-2 disabled:opacity-50"
                  >
                    Max
                  </button>
                </div>
                <div className="flex items-center gap-3">
                  <input
                    id="withdraw-amount"
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder="0"
                    value={amount}
                    onChange={(e) => onAmount(e.target.value)}
                    disabled={busy || status === "success"}
                    className="min-w-0 flex-1 bg-transparent p-0 text-2xl font-semibold text-foreground outline-none"
                  />
                  <span className="shrink-0 text-[15px] font-semibold">{unit}</span>
                </div>
              </div>
              <div className="flex flex-col gap-1 rounded-[2px] border border-gilt bg-accent px-4 py-3.5">
                <span className="label-roman text-[10px]">You get</span>
                {quote ? (
                  <span className="text-2xl font-semibold text-ink">
                    {quote.method === "jupiter-swap" ? "≈ " : ""}
                    {amountText(quote.outAmount)} {quote.outputToken.symbol}
                  </span>
                ) : status === "quoting" ? (
                  <span className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="size-3.5 animate-spin" /> Fetching quote...
                  </span>
                ) : (
                  <span className="text-sm text-muted-foreground">—</span>
                )}
              </div>
              <span
                aria-hidden="true"
                className="absolute left-1/2 top-1/2 -ml-[15px] -mt-[15px] grid size-[30px] rotate-45 place-items-center border border-gilt bg-card"
              >
                <ArrowDown className="size-[13px] -rotate-45 text-muted-foreground" strokeWidth={2.25} />
              </span>
            </div>

            {quote && (
              <dl className="m-0 flex flex-col gap-2 text-[13px]">
                {/* Where the quote came from, the way Titan names the venue that won */}
                <Row label="Quote">
                  {quote.method === "jupiter-swap"
                    ? `Jupiter${quote.routeLabels.length > 0 ? ` via ${quote.routeLabels.join(" → ")}` : ""}`
                    : quote.position}
                </Row>
                {quote.method === "jupiter-swap" ? (
                  <>
                    {quote.value && <Row label="Worth in the pool">{amountText(quote.value)} SOL</Row>}
                    {exitCost !== null && (
                      <Row label="Exit cost" className={cn(exitCost > 0.005 && "text-warning")}>
                        {exitCost <= 0 ? "None" : formatPercent(exitCost * 100)}
                      </Row>
                    )}
                    <Row label="Minimum received">
                      {amountText(quote.minOutAmount)} {quote.outputToken.symbol}
                    </Row>
                    <Row label="Price impact" className={cn(quote.priceImpactPct > 0.5 && "text-warning")}>
                      {quote.priceImpactPct < 0.01 ? "<0.01%" : formatPercent(quote.priceImpactPct)}
                    </Row>
                  </>
                ) : (
                  <>
                    {/* Only when it holds the withdrawal back: most of the reserve is lent out */}
                    {quote.available !== null && limited && (
                      <Row label="Can leave right now" className="text-warning">
                        {amountText(quote.available, 2)} {quote.outputToken.symbol}
                      </Row>
                    )}
                  </>
                )}
                {quote.rentBackSol && <Row label="Account rent back">{amountText(quote.rentBackSol)} SOL</Row>}
              </dl>
            )}

            {status !== "success" && (
              <Notice tone="warning">Beta: in-app withdrawals are new and move real funds. Start with a small amount.</Notice>
            )}
            {status === "signing" && slow && (
              <Notice tone="plain">
                Waiting for your wallet. If you approved it, the withdrawal shows here as soon as it lands. You can close
                this: Portfolio updates when it lands.
              </Notice>
            )}
            {status === "error" && error && <Notice tone="error">{error}</Notice>}
            {status === "success" && quote && (
              <Notice tone="success">
                Withdrawal confirmed. {amountText(quote.outAmount)} {quote.outputToken.symbol} is in your wallet
                {quote.rentBackSol ? `, plus ${amountText(quote.rentBackSol)} SOL of account rent back.` : "."}
              </Notice>
            )}
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
            ) : (
              <button
                type="button"
                onClick={handleWithdraw}
                // A failed build keeps its quote, so it can be tried again. A failed quote leaves none.
                disabled={!quote || busy || status === "quoting" || !publicKey}
                className="btn-teal h-[52px] w-full text-[15px]"
              >
                {busy && <Loader2 className="size-4 animate-spin" />}
                {status === "signing"
                  ? "Approve in wallet..."
                  : status === "confirming"
                    ? "Confirming..."
                    : status === "error"
                      ? "Try again"
                      : "Withdraw"}
              </button>
            )}
            <p className="-mt-1 text-center text-xs leading-relaxed text-muted-foreground">
              Hermes builds the transaction. You sign it in your wallet. Funds never touch Hermes.
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
