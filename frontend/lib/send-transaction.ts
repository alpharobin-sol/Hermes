import { useEffect, useState } from "react"
import { ComputeBudgetProgram, type Connection, type PublicKey, type VersionedTransaction } from "@solana/web3.js"

// Send a transaction through the wallet and follow it to the chain, without depending on the wallet's answer.
//
// On phones the wallet can send a transaction and its answer never reach the page: Chrome on Android talks to the
// wallet (Solflare, Phantom or any other) through Mobile Wallet Adapter or the wallet's own link, and the connection
// back can drop while the page sits behind the wallet. So Hermes asks the wallet and also watches the chain: the
// wallet's newest transactions, matched to this one by its blockhash or, since a wallet may refresh the blockhash and
// add its own checks, by carrying every one of its instructions. Whichever answers first settles it. A transaction
// that hasn't landed once its blockhash expires never can, so that is the end of the wait.

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
// Blocks a blockhash stays valid. A wallet that refreshes the blockhash when it signs gets this many more.
const BLOCKHASH_LIFE = 150
// A block height this far from the transaction's own is the RPC's mistake, not the chain's. Then time decides.
const PLAUSIBLE_BLOCKS = 10_000
const FALLBACK_MS = 4 * 60_000
// 150 blocks take at least a minute, so nothing Hermes built can expire sooner. Whatever the RPC says, the wait lasts
// at least this long.
const MIN_WAIT_MS = 60_000

// The chain's block height. Read through getEpochInfo: publicnode (Oct 2026) answers getBlockHeight with the slot,
// about 22 million higher, which made every transaction look long expired.
async function blockHeight(connection: Connection): Promise<number> {
  return (await connection.getEpochInfo("confirmed")).blockHeight ?? Number.NaN
}
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

// Codes wallets use when the user says no: 4001 (browser wallets), -3 (Mobile Wallet Adapter: not signed), and Mobile
// Wallet Adapter's cancelled association (the wallet was closed before it opened the request)
const DECLINED_CODES = new Set<unknown>([4001, -3, "ERROR_ASSOCIATION_CANCELLED"])

// The wallet said no, as opposed to losing its connection to the page. Wallet adapters wrap the wallet's own error,
// sometimes twice, so the whole chain is read.
export function isDeclined(err: unknown): boolean {
  let current = err as { code?: unknown; message?: unknown; error?: unknown; cause?: unknown } | null | undefined
  for (let depth = 0; current && depth < 4; depth++) {
    if (DECLINED_CODES.has(current.code)) return true
    const message = typeof current === "string" ? current : typeof current.message === "string" ? current.message : ""
    if (/reject|declin|denied|not signed|cancell?ed by (the )?user|user cancell?ed/i.test(message)) return true
    current = (current.error ?? current.cause) as typeof current
  }
  return false
}

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"

// Base58, the way the RPC writes instruction data
function base58(bytes: Uint8Array): string {
  const digits: number[] = []
  for (const byte of bytes) {
    let carry = byte
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] * 256
      digits[j] = carry % 58
      carry = Math.floor(carry / 58)
    }
    while (carry > 0) {
      digits.push(carry % 58)
      carry = Math.floor(carry / 58)
    }
  }
  let zeros = 0
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++
  return "1".repeat(zeros) + digits.reverse().map((digit) => BASE58[digit]).join("")
}

// Each instruction as its program and data, leaving out compute budget, which a wallet may change
function fingerprint(programs: string[], instructions: { programIdIndex: number; data: string }[]): string[] {
  const budget = ComputeBudgetProgram.programId.toBase58()
  return instructions.map((ix) => `${programs[ix.programIdIndex]}:${ix.data}`).filter((entry) => !entry.startsWith(`${budget}:`))
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

// Whether a landed transaction is this one: the same blockhash, or every one of its instructions. Read raw, so a
// version 1 transaction (some wallets send them) reads like any other. null: not readable yet. A public RPC is
// several nodes, and the one asked may not have the transaction another just listed.
async function isThisTransaction(connection: Connection, signature: string, transaction: VersionedTransaction): Promise<boolean | null> {
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
  const message = (await response.json())?.result?.transaction?.message
  if (!message) return null
  if (message.recentBlockhash === transaction.message.recentBlockhash) return true
  const ours = fingerprint(
    transaction.message.staticAccountKeys.map((key) => key.toBase58()),
    transaction.message.compiledInstructions.map((ix) => ({ programIdIndex: ix.programIdIndex, data: base58(ix.data) }))
  )
  const landed = new Set(fingerprint(message.accountKeys ?? [], message.instructions ?? []))
  return ours.length > 0 && ours.every((entry) => landed.has(entry))
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
  // The wallet opens first: a phone opens it only right after the tap
  const started = Date.now()
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

  // The chain's slot as the wallet opens. The transaction can't land before it, whatever the phone's clock says.
  const startSlot = connection.getSlot("confirmed").catch(() => null)
  // Hermes's blockhash, and one more lifetime in case the wallet refreshed it
  const deadline = lastValidBlockHeight + BLOCKHASH_LIFE
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
        // No answer: look for it among the wallet's transactions since the wallet opened
        const since = await startSlot
        const recent = await connection.getSignaturesForAddress(user, { limit: 10 }, "confirmed")
        for (const entry of recent) {
          if (checked.has(entry.signature)) continue
          if (since !== null && entry.slot < since - 10) continue
          const match = await isThisTransaction(connection, entry.signature, transaction)
          if (match) {
            onSigned?.(entry.signature)
            return { kind: "landed", signature: entry.signature, failed: entry.err !== null }
          }
          // Only a completed read rules a transaction out. One that failed or wasn't there yet is read again next round.
          if (match === false) checked.add(entry.signature)
        }
      }
      // Past the deadline: a last look for the wallet's signature, then nothing more can land. A height reading that
      // makes no sense next to the transaction's own falls back to time, so a bad RPC can't end the wait early.
      const waited = Date.now() - started
      const height = await blockHeight(connection)
      const past =
        waited > MIN_WAIT_MS && (Math.abs(height - lastValidBlockHeight) < PLAUSIBLE_BLOCKS ? height > deadline : waited > FALLBACK_MS)
      if (past) {
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
