"use client"

import { useEffect, useState } from "react"
import { useConnection, useWallet } from "@solana/wallet-adapter-react"
import { VersionedTransaction } from "@solana/web3.js"
import { AlertCircle, AlertTriangle, ArrowDown, Check, CheckCircle2, ExternalLink, Loader2 } from "lucide-react"

import { cn } from "@/lib/utils"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DepositAPI, type DepositQuote } from "@/lib/api/deposit-api"
import type { YieldRoute } from "@/lib/api/yield-api"
import { formatPercent } from "@/lib/helpers/formatters"
import { IS_DEVNET, explorerTxUrl } from "@/lib/network"
import { CATEGORY_LABELS, HIGH_UTILIZATION, Medallion, formatApy } from "./rate-board"

type DepositStatus = "quoting" | "ready" | "signing" | "confirming" | "success" | "unconfirmed" | "error"

interface DepositDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  route: YieldRoute
  amount: number
  onDeposited?: () => void
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

// LST amounts need more precision than the 2 decimals formatNumber gives
function formatTokenAmount(value: string | number): string {
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: 6 })
}

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

function getErrorMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  if (/user rejected|rejected the request/i.test(message)) return "You rejected the transaction in your wallet."
  return message || "Deposit failed"
}

export function DepositDialog({
  open,
  onOpenChange,
  route,
  amount,
  onDeposited,
}: DepositDialogProps) {
  const { connection } = useConnection()
  const { publicKey, sendTransaction, signAllTransactions } = useWallet()

  const [status, setStatus] = useState<DepositStatus>("quoting")
  const [quote, setQuote] = useState<DepositQuote | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [signature, setSignature] = useState<string | null>(null)
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null)

  const wallet = publicKey?.toBase58()

  // Fresh quote every time the dialog opens. With a wallet, lending quotes include one-time account rent.
  useEffect(() => {
    if (!open) return

    const controller = new AbortController()
    setStatus("quoting")
    setQuote(null)
    setError(null)
    setSignature(null)
    setProgress(null)

    DepositAPI.getQuote({ routeId: route.id, amount, userPublicKey: wallet }, { signal: controller.signal })
      .then((q) => {
        setQuote(q)
        setStatus("ready")
      })
      .catch((err) => {
        if (err?.name === "AbortError") return
        setError(getErrorMessage(err))
        setStatus("error")
      })

    return () => controller.abort()
  }, [open, route.id, amount, wallet])

  const handleConfirm = async () => {
    if (!publicKey) return

    try {
      setStatus("signing")
      setError(null)

      const built = await DepositAPI.buildTransaction({
        routeId: route.id,
        amount,
        userPublicKey: publicKey.toBase58(),
      })
      setQuote(built.quote)

      const transactions = (built.transactions?.length ? built.transactions : [built.transaction]).map((tx) =>
        VersionedTransaction.deserialize(base64ToBytes(tx))
      )

      let signed: VersionedTransaction[] | null = null
      if (IS_DEVNET || transactions.length > 1) {
        // Sign everything up front, then send through the app's own connection. That keeps multi-step
        // deposits in order and lands devnet transactions on devnet whatever network the wallet is set to.
        if (!signAllTransactions) throw new Error("Your wallet can't sign this deposit. Try Phantom, Solflare or Backpack.")
        signed = await signAllTransactions(transactions)
      }

      for (let i = 0; i < transactions.length; i++) {
        const isDeposit = i === transactions.length - 1
        if (transactions.length > 1) setProgress({ current: i + 1, total: transactions.length })

        const sig = signed
          ? await connection.sendRawTransaction(signed[i].serialize())
          : await sendTransaction(transactions[i], connection)
        setSignature(sig)
        setStatus("confirming")

        let result
        try {
          result = await connection.confirmTransaction(
            {
              signature: sig,
              blockhash: transactions[i].message.recentBlockhash,
              lastValidBlockHeight: built.lastValidBlockHeight,
            },
            "confirmed"
          )
        } catch (confirmErr) {
          console.warn("Could not confirm transaction", confirmErr)
          if (!isDeposit) {
            // Only a pool update was in flight, the deposit itself was never sent
            throw new Error("A pool update step could not be confirmed. Your SOL was not deposited. Try again.")
          }
          // The deposit was sent but we could not check it. Never offer a retry here: it could deposit twice.
          setStatus("unconfirmed")
          onDeposited?.()
          return
        }
        if (result.value.err) {
          throw new Error(
            isDeposit
              ? "Transaction failed on-chain. Your funds were not moved."
              : "A pool update step failed on-chain. Your SOL was not deposited."
          )
        }
      }

      setStatus("success")
      onDeposited?.()
    } catch (err) {
      setError(getErrorMessage(err))
      setStatus("error")
    }
  }

  const isBusy = status === "quoting" || status === "signing" || status === "confirming"

  // The path Hermes built, and the ones it quoted and passed over, so the choice can be checked
  const pickedLabel = quote
    ? quote.method === "jupiter-swap"
      ? `Jupiter${quote.routeLabels.length > 0 ? ` via ${quote.routeLabels.join(" → ")}` : ""}`
      : quote.routeLabels.length > 0
        ? quote.routeLabels.join(" → ")
        : `${route.name}, direct`
    : ""
  const compared = quote?.compared ?? []

  return (
    <Dialog open={open} onOpenChange={(next) => !isBusy && onOpenChange(next)}>
      <DialogContent className="max-w-[452px] gap-0 rounded-[4px] border-gilt bg-card p-[5px] shadow-[0_24px_64px_rgba(0,0,0,0.45)] sm:max-w-[452px] [&>[data-slot=dialog-close]]:right-5 [&>[data-slot=dialog-close]]:top-5">
        <div className="plaque-inner max-h-[calc(100dvh-4rem)] overflow-y-auto">
          <DialogHeader className="flex-row items-start gap-3 border-b border-hairline p-[18px] pb-3.5 pr-12 text-left">
            <Medallion route={route} className="size-11 text-[17px]" />
            <div className="flex min-w-0 flex-col gap-0.5">
              <DialogTitle className="font-display text-[26px] font-bold leading-[1.1]">Deposit into {route.name}</DialogTitle>
              <DialogDescription className="text-[13px] text-muted-foreground">
                {CATEGORY_LABELS[route.category]}
                {route.receipt && ` · get ${route.receipt}`} · {formatApy(route)} APY
              </DialogDescription>
            </div>
          </DialogHeader>

          <div className="flex flex-col gap-4 p-[18px]">
            {/* You deposit, you receive */}
            <div className="relative flex flex-col gap-1.5">
              <div className="flex flex-col gap-1 rounded-[2px] border border-border bg-background px-4 py-3.5">
                <span className="label-roman text-[10px]">You deposit</span>
                <span className="text-2xl font-semibold">
                  {formatTokenAmount(amount)} {route.token}
                </span>
              </div>
              <div className="flex flex-col gap-1 rounded-[2px] border border-gilt bg-accent px-4 py-3.5">
                <span className="label-roman text-[10px]">You receive</span>
                {quote?.position ? (
                  <>
                    <span className="text-2xl font-semibold text-ink">
                      {formatTokenAmount(quote.outAmount)} {quote.outputToken.symbol} in {quote.position}
                    </span>
                    <span className="text-xs leading-relaxed text-muted-foreground">
                      A position in your own {quote.position} account, not a token in your wallet. Manage or withdraw it at{" "}
                      {hostOf(route.website)}.
                    </span>
                  </>
                ) : quote ? (
                  <>
                    <span className="text-2xl font-semibold text-ink">
                      ≈ {formatTokenAmount(quote.outAmount)} {quote.outputToken.symbol}
                    </span>
                    {route.category === "liquid-staking" && (
                      <span className="text-xs text-muted-foreground">Sits in your own wallet and earns staking yield.</span>
                    )}
                  </>
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

            {/* Paths Hermes compared */}
            {quote && compared.length > 0 && (
              <div className="flex flex-col gap-2">
                <p className="label-roman">Hermes checked {compared.length + 1} paths</p>
                <div className="overflow-hidden rounded-[2px] border border-border">
                  <div className="flex items-center gap-2.5 bg-ink-surface px-3.5 py-2.5">
                    <Check className="size-4 shrink-0 text-ink" strokeWidth={2.25} />
                    <span className="min-w-0 flex-1 text-[13px] font-medium">{pickedLabel}</span>
                    <span className="text-[13px] font-semibold text-ink">{formatTokenAmount(quote.outAmount)}</span>
                  </div>
                  {compared.map((other) => (
                    <div key={other.method} className="flex items-center gap-2.5 border-t border-border px-3.5 py-2.5">
                      <span className="w-4 shrink-0" aria-hidden="true" />
                      <span className="min-w-0 flex-1 text-[13px] text-muted-foreground">
                        {other.label ?? (other.method === "jupiter-swap" ? "Jupiter" : route.name)}
                      </span>
                      <span className="text-[13px] text-muted-foreground">{formatTokenAmount(other.outAmount)}</span>
                    </div>
                  ))}
                </div>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Hermes builds the path that gives you more {quote.outputToken.symbol}.
                </p>
              </div>
            )}

            {/* Quote details */}
            {quote && (
              <dl className="m-0 flex flex-col gap-2 text-[13px]">
                {quote.method === "jupiter-swap" ? (
                  <>
                    <Row label="Minimum received">
                      {formatTokenAmount(quote.minOutAmount)} {quote.outputToken.symbol}
                    </Row>
                    <Row label="Price impact" className={cn(quote.priceImpactPct > 0.5 && "text-warning")}>
                      {quote.priceImpactPct < 0.01 ? "<0.01%" : formatPercent(quote.priceImpactPct)}
                    </Row>
                    <Row label="Slippage">{formatPercent(quote.slippageBps / 100)}</Row>
                  </>
                ) : quote.position ? (
                  <>
                    <Row label="Rate">Variable, set by borrowing demand</Row>
                    {quote.setupCostSol && Number(quote.setupCostSol) > 0 && (
                      <Row label="Account setup" className="text-warning">
                        {formatTokenAmount(quote.setupCostSol)} SOL one-time rent
                      </Row>
                    )}
                  </>
                ) : (
                  // Direct deposits mint at the protocol's rate. It can shift slightly if an epoch update runs first.
                  <Row label="Rate">{route.name} rate, no slippage</Row>
                )}
                {compared.length === 0 && quote.routeLabels.length > 0 && <Row label="Route">{pickedLabel}</Row>}
                {route.safety && <Row label="Safety Score">{route.safety.score}/100</Row>}
                <Row label="Hermes fee">None</Row>
              </dl>
            )}

            {typeof route.utilization === "number" && route.utilization >= HIGH_UTILIZATION && status !== "success" && (
              <Notice tone="warning">
                {Math.min(100, Math.round(route.utilization * 100))}% of this {route.token} reserve is borrowed. Withdrawals
                may have to wait until borrowers repay or new deposits arrive.
              </Notice>
            )}

            {!IS_DEVNET && route.deposit === "beta" && status !== "success" && status !== "error" && (
              <Notice tone="warning">
                Beta: this deposit route is new in Hermes and uses real funds.
                {typeof route.depositCap === "number" &&
                  ` Deposits are limited to ${route.depositCap.toLocaleString()} ${route.token} each for now.`}{" "}
                Start with a small amount.
              </Notice>
            )}

            {IS_DEVNET && status !== "success" && (
              <Notice tone="plain">
                Devnet: uses test SOL only. If your wallet warns about this transaction, switch it to Devnet (Phantom:
                Settings → Developer Settings → Testnet Mode).
              </Notice>
            )}

            {/* Status */}
            {status === "error" && error && <Notice tone="error">{error}</Notice>}

            {status === "success" && (
              <Notice tone="success">
                {quote?.position
                  ? `Deposit confirmed. Your ${quote.outputToken.symbol} is supplied to ${quote.position} and earning yield. Manage or withdraw it at ${hostOf(route.website)}.`
                  : `Deposit confirmed. Your ${quote?.outputToken.symbol} is in your wallet and earning yield.`}
              </Notice>
            )}

            {status === "unconfirmed" && (
              <Notice tone="warning">
                Transaction sent, but Hermes could not confirm it yet. Check Solscan before depositing again.
              </Notice>
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

            {/* Action */}
            {status === "success" || status === "unconfirmed" ? (
              <button type="button" onClick={() => onOpenChange(false)} className="btn-frame h-[52px] w-full text-[15px]">
                Done
              </button>
            ) : (
              <button
                type="button"
                onClick={handleConfirm}
                disabled={!quote || isBusy || !publicKey}
                className="btn-teal h-[52px] w-full text-[15px]"
              >
                {(status === "signing" || status === "confirming") && <Loader2 className="size-4 animate-spin" />}
                {status === "signing"
                  ? "Approve in wallet..."
                  : status === "confirming"
                    ? progress
                      ? `Sending ${progress.current} of ${progress.total}...`
                      : "Confirming..."
                    : status === "error" && quote
                      ? "Try again"
                      : "Confirm deposit"}
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

function Row({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn("m-0 text-right font-medium", className)}>{children}</dd>
    </div>
  )
}

const NOTICE_TONES = {
  warning: "border-warning-line bg-warning-surface text-warning",
  error: "border-destructive-line bg-destructive-surface text-destructive",
  success: "border-ink-line bg-ink-surface text-ink",
  plain: "border-frame bg-secondary text-foreground",
}

function Notice({ tone, children }: { tone: keyof typeof NOTICE_TONES; children: React.ReactNode }) {
  const Icon = tone === "success" ? CheckCircle2 : tone === "error" ? AlertCircle : AlertTriangle
  return (
    <div className={cn("flex items-start gap-2.5 rounded-[2px] border px-3.5 py-3 text-[13px] leading-relaxed", NOTICE_TONES[tone])}>
      <Icon className="mt-0.5 size-4 shrink-0" />
      <span>{children}</span>
    </div>
  )
}
