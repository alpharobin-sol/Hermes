"use client"

import { useEffect, useState } from "react"
import { useConnection, useWallet } from "@solana/wallet-adapter-react"
import { VersionedTransaction } from "@solana/web3.js"
import { AlertCircle, ArrowDown, CheckCircle2, ExternalLink, Loader2 } from "lucide-react"

import { cn } from "@/lib/utils"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DepositAPI, type DepositQuote } from "@/lib/api/deposit-api"
import type { YieldRoute } from "@/lib/api/yield-api"
import { formatPercent } from "@/lib/helpers/formatters"
import { IS_DEVNET, explorerTxUrl } from "@/lib/network"

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

  // Fresh quote every time the dialog opens
  useEffect(() => {
    if (!open) return

    const controller = new AbortController()
    setStatus("quoting")
    setQuote(null)
    setError(null)
    setSignature(null)
    setProgress(null)

    DepositAPI.getQuote({ routeId: route.id, amount }, { signal: controller.signal })
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
  }, [open, route.id, amount])

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

  return (
    <Dialog open={open} onOpenChange={(next) => !isBusy && onOpenChange(next)}>
      <DialogContent className="border-border/50 bg-card p-0 gap-0 max-w-sm">
        <DialogHeader className="border-b border-border/50 p-4">
          <DialogTitle className="font-mono text-sm uppercase tracking-wider text-foreground">
            Deposit into {route.name}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Hermes builds the transaction. You sign it in your wallet. Funds never touch Hermes.
          </DialogDescription>
        </DialogHeader>

        <div className="p-4 space-y-4">
          {/* You pay */}
          <div className="border border-border/50 bg-secondary/30 p-3">
            <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">You deposit</div>
            <div className="font-mono text-lg text-foreground">
              {formatTokenAmount(amount)} {route.token}
            </div>
          </div>

          <div className="flex justify-center -my-2">
            <ArrowDown className="w-4 h-4 text-muted-foreground" />
          </div>

          {/* You receive */}
          <div className="border border-border/50 bg-secondary/30 p-3">
            <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">You receive</div>
            {quote ? (
              <div className="font-mono text-lg text-primary">
                ~{formatTokenAmount(quote.outAmount)} {quote.outputToken.symbol}
              </div>
            ) : status === "quoting" ? (
              <div className="flex items-center gap-2 font-mono text-sm text-muted-foreground">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Fetching quote...
              </div>
            ) : (
              <div className="font-mono text-sm text-muted-foreground">—</div>
            )}
          </div>

          {/* Quote details */}
          {quote && (
            <div className="space-y-1.5 font-mono text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">APY</span>
                <span className="text-foreground">{formatPercent(route.apy * 100)}</span>
              </div>
              {quote.method === "jupiter-swap" ? (
                <>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Minimum received</span>
                    <span className="text-foreground">
                      {formatTokenAmount(quote.minOutAmount)} {quote.outputToken.symbol}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Price impact</span>
                    <span className={cn(quote.priceImpactPct > 0.5 ? "text-warning" : "text-foreground")}>
                      {quote.priceImpactPct < 0.01 ? "<0.01%" : formatPercent(quote.priceImpactPct)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Slippage</span>
                    <span className="text-foreground">{formatPercent(quote.slippageBps / 100)}</span>
                  </div>
                </>
              ) : (
                // Direct deposits mint at the protocol's rate. It can shift slightly if an epoch update runs first.
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">Rate</span>
                  <span className="text-foreground text-right">{route.name} rate, no slippage</span>
                </div>
              )}
              {quote.routeLabels.length > 0 && (
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">Route</span>
                  <span className="text-foreground text-right">
                    {quote.method === "jupiter-swap" ? "Jupiter via " : ""}
                    {quote.routeLabels.join(" → ")}
                  </span>
                </div>
              )}
              {/* The paths Hermes quoted and passed over, so the choice can be checked */}
              {quote.compared?.map((other) => (
                <div key={other.method} className="flex justify-between gap-4">
                  <span className="text-muted-foreground">Also checked</span>
                  <span className="text-muted-foreground text-right">
                    {formatTokenAmount(other.outAmount)} {quote.outputToken.symbol} via{" "}
                    {other.label ?? (other.method === "jupiter-swap" ? "Jupiter" : route.name)}
                  </span>
                </div>
              ))}
            </div>
          )}

          {!IS_DEVNET && route.deposit === "beta" && status !== "success" && status !== "error" && (
            <p className="text-[11px] leading-relaxed text-warning">
              Beta: this deposit route is new in Hermes and uses real funds.
              {typeof route.depositCap === "number" && ` Deposits are limited to ${route.depositCap} ${route.token} each for now.`} Start
              with a small amount.
            </p>
          )}

          {IS_DEVNET && status !== "success" && (
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Devnet: uses test SOL only. If your wallet warns about this transaction, switch it to Devnet (Phantom:
              Settings → Developer Settings → Testnet Mode).
            </p>
          )}

          {/* Status */}
          {status === "error" && error && (
            <div className="flex items-start gap-2 border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {status === "success" && (
            <div className="flex items-start gap-2 border border-primary/30 bg-primary/5 p-3 text-xs text-primary">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>Deposit confirmed. Your {quote?.outputToken.symbol} is in your wallet and earning yield.</span>
            </div>
          )}

          {status === "unconfirmed" && (
            <div className="flex items-start gap-2 border border-warning/30 bg-warning/5 p-3 text-xs text-warning">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>Transaction sent, but Hermes could not confirm it yet. Check Solscan before depositing again.</span>
            </div>
          )}

          {signature && (
            <a
              href={explorerTxUrl(signature)}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-1 font-mono text-[11px] text-muted-foreground hover:text-primary"
            >
              View on Solscan <ExternalLink className="w-3 h-3" />
            </a>
          )}

          {/* Action */}
          {status === "success" || status === "unconfirmed" ? (
            <button
              onClick={() => onOpenChange(false)}
              className="w-full py-2.5 font-mono text-xs font-medium border border-border/50 text-foreground hover:border-primary/50 hover:text-primary transition-all"
            >
              Done
            </button>
          ) : (
            <button
              onClick={handleConfirm}
              disabled={!quote || isBusy || !publicKey}
              className="w-full flex items-center justify-center gap-2 py-2.5 font-mono text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {(status === "signing" || status === "confirming") && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
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
        </div>
      </DialogContent>
    </Dialog>
  )
}
