// lib/api/withdraw-api.ts

import { getFullUrl } from "./yield-api"
import type { DepositToken } from "./deposit-api"

// What a withdrawal from a position returns. The API reads the wallet's position and the reserve's liquidity.
export interface WithdrawQuote {
  routeId: string
  method: "jupiter-swap" | "direct"
  inputToken: DepositToken // what leaves the position: the staking token, or the lent token
  outputToken: DepositToken // what lands in the wallet
  inAmount: string
  outAmount: string
  minOutAmount: string
  priceImpactPct: number
  slippageBps: number
  routeLabels: string[]
  value: string | null // staking tokens: what they are worth in their pool, in SOL
  held: string // the whole position, in inputToken
  available: string | null // lending: what can leave right now
  position: string | null // lending: "Kamino Lend" or "Jupiter Lend"
  rentBackSol: string | null // a full Kamino exit returns the account's rent
}

export interface WithdrawTransaction {
  quote: WithdrawQuote
  transaction: string // base64, unsigned
  lastValidBlockHeight: number
}

export interface WithdrawParams {
  routeId: string
  amount?: string
  all?: boolean // the whole position
  userPublicKey: string
}

async function post<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(getFullUrl(path), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok || !json?.success) throw new Error(json?.error || "Withdrawal request failed")
  return json.data as T
}

export const WithdrawAPI = {
  quote: (params: WithdrawParams, signal?: AbortSignal) => post<WithdrawQuote>("/api/withdraw/quote", params, signal),
  build: (params: WithdrawParams) => post<WithdrawTransaction>("/api/withdraw/build", params),
}
