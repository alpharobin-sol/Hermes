import { useEffect, useState } from "react"
import type { Connection, PublicKey, VersionedTransaction } from "@solana/web3.js"

// Send a transaction through the wallet and follow it to the chain, without depending on the wallet's answer.
//
// On phones the wallet can send a transaction and its answer never reach the page: Chrome on Android talks to
// Phantom through Mobile Wallet Adapter, and the connection back drops while the page sits behind the wallet. So
// Hermes asks the wallet and also watches the chain: the wallet's newest transactions, matched by this
// transaction's blockhash. Whichever answers first settles it. A transaction that hasn't landed once its blockhash
// expires never can, so that is the end of the wait.

export type SendOutcome =
  | { kind: "landed"; signature: string; failed: boolean } // on chain; failed: the program refused it, nothing moved
  | { kind: "declined" } // the wallet said no: nothing was sent
  | { kind: "expired"; reason: string | null } // nothing landed, and now nothing can: nothing moved. reason: the wallet's error
  | { kind: "stopped" } // the dialog closed before an answer

interface SendOptions {
  connection: Connection
  sendTransaction: (transaction: VersionedTransaction, connection: Connection) => Promise<string>
  transaction: VersionedTransaction
  user: PublicKey
  lastValidBlockHeight: number
  signal?: AbortSignal
  onSigned?: (signature: string) => void // the wallet answered, or the chain showed it
}

const POLL_MS = 2_500
// After this long without the wallet's answer, a dialog says what it is waiting for
const SLOW_WALLET_MS = 20_000

// True once the wallet has kept the user waiting a while
export function useSlowWallet(waiting: boolean): boolean {
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    setSlow(false)
    if (!waiting) return
    const timer = setTimeout(() => setSlow(true), SLOW_WALLET_MS)
    return () => clearTimeout(timer)
  }, [waiting])
  return slow
}

// The wallet said no, as opposed to losing its connection to the page
export function isDeclined(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err ?? "")
  const code = (err as { code?: unknown; error?: { code?: unknown } } | null)?.error?.code ?? (err as { code?: unknown } | null)?.code
  return code === 4001 || /user rejected|rejected the request|declined|not signed|denied/i.test(message)
}

// Wait, but wake as soon as the page is back in view (the user returning from the wallet), the wallet answers, or
// the wait is stopped
function pause(ms: number, signal: AbortSignal | undefined, onWake: (wake: () => void) => void): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer)
      document.removeEventListener("visibilitychange", onVisible)
      signal?.removeEventListener("abort", done)
      resolve()
    }
    onWake(done)
    const onVisible = () => {
      if (document.visibilityState === "visible") done()
    }
    const timer = setTimeout(done, ms)
    document.addEventListener("visibilitychange", onVisible)
    signal?.addEventListener("abort", done)
  })
}

// A transaction's blockhash, read raw so a version 1 transaction (some wallets send them) reads like any other
async function blockhashOf(connection: Connection, signature: string): Promise<string | null> {
  const response = await fetch(connection.rpcEndpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getTransaction",
      params: [signature, { encoding: "json", maxSupportedTransactionVersion: 1, commitment: "confirmed" }],
    }),
  })
  const data = await response.json()
  return data?.result?.transaction?.message?.recentBlockhash ?? null
}

export async function sendAndWatch({
  connection,
  sendTransaction,
  transaction,
  user,
  lastValidBlockHeight,
  signal,
  onSigned,
}: SendOptions): Promise<SendOutcome> {
  const blockhash = transaction.message.recentBlockhash
  // The wallet opens first: a phone opens it only right after the tap
  const startedAt = Date.now()
  let walletSignature: string | null = null
  let walletError: unknown = null
  // An answer that arrives mid-round skips the next pause. One that arrives during a pause ends it.
  let answered = false
  let wake = () => {}
  sendTransaction(transaction, connection).then(
    (signature) => {
      walletSignature = signature
      onSigned?.(signature)
      answered = true
      wake()
    },
    (err) => {
      walletError = err
      answered = true
      wake()
    }
  )

  const checked = new Set<string>()
  const statusOf = async (signature: string) =>
    (await connection.getSignatureStatuses([signature], { searchTransactionHistory: true })).value[0]

  while (!signal?.aborted) {
    if (walletError && isDeclined(walletError)) return { kind: "declined" }
    try {
      // The wallet answered: follow its signature
      if (walletSignature) {
        const status = await statusOf(walletSignature)
        if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") {
          return { kind: "landed", signature: walletSignature, failed: status.err !== null }
        }
      } else {
        // No answer: look for it among the wallet's transactions since the tap (a minute's room for clocks)
        const recent = await connection.getSignaturesForAddress(user, { limit: 10 }, "confirmed")
        for (const entry of recent) {
          if (checked.has(entry.signature)) continue
          checked.add(entry.signature)
          if (entry.blockTime && entry.blockTime * 1000 < startedAt - 60_000) continue
          if ((await blockhashOf(connection, entry.signature)) === blockhash) {
            onSigned?.(entry.signature)
            return { kind: "landed", signature: entry.signature, failed: entry.err !== null }
          }
        }
      }
      // Past the blockhash's life: a last look for the wallet's signature, then nothing more can land
      if ((await connection.getBlockHeight("confirmed")) > lastValidBlockHeight) {
        if (walletSignature) {
          const status = await statusOf(walletSignature)
          if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") {
            return { kind: "landed", signature: walletSignature, failed: status.err !== null }
          }
        }
        return { kind: "expired", reason: walletError instanceof Error ? walletError.message : walletError ? String(walletError) : null }
      }
    } catch (err) {
      // A failed read is not an answer. Try again on the next round.
      console.warn("Could not check the transaction yet", err)
    }
    if (answered) {
      answered = false
      continue
    }
    await pause(POLL_MS, signal, (done) => {
      wake = done
    })
  }
  return { kind: "stopped" }
}
