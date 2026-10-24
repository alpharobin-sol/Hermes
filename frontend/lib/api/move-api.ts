// lib/api/move-api.ts

import { getFullUrl } from "./yield-api"
import type { DepositToken, DepositTransaction } from "./deposit-api"

// Moving a position into another route for the same token. A staking token to a staking token is one swap. Anything
// with lending in it is two steps: the withdrawal, then the deposit of what landed.
export interface MoveQuote {
  from: string
  to: string
  kind: "swap" | "two-step"
  token: string // the routes' token, what values are counted in
  inputToken: DepositToken // what leaves the position
  inAmount: string
  outputToken: DepositToken // what the new route holds
  outAmount: string
  minOutAmount: string
  held: string // the whole position, in inputToken
  valueIn: string // in `token`
  valueOut: string // in `token`
  cost: string // valueIn - valueOut, in `token`. At or below zero: the move costs nothing
  fromApy: number
  toApy: number
  extraPerYear: string // in `token`, at today's APYs. Negative: the new route earns less
  breakEvenDays: number | null // 0: no cost to make back. null: the new route earns less
  priceImpactPct: number
  routeLabels: string[]
  rentBackSol: string | null // a full Kamino exit returns the account's rent
  available: string | null // lending: what can leave the old route right now
  firstKaminoDeposit: boolean // step 2 into Kamino Lend may pay one-time account rent
}

export interface MoveTransaction {
  quote: MoveQuote
  step: 1
  steps: 1 | 2
  transaction: string // base64, unsigned
  lastValidBlockHeight: number
}

export interface MoveFinish extends DepositTransaction {
  received: string // what step 1 paid into the wallet
  kept: string | null // SOL left in the wallet for fees and rent
}

export interface MoveParams {
  from: string
  to: string
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
  if (!res.ok || !json?.success) throw new Error(json?.error || "Move request failed")
  return json.data as T
}

export const MoveAPI = {
  quote: (params: MoveParams, signal?: AbortSignal) => post<MoveQuote>("/api/move/quote", params, signal),
  build: (params: MoveParams) => post<MoveTransaction>("/api/move/build", params),
  // Step 2 of a two-step move: the deposit of what the confirmed step 1 paid into the wallet
  finish: (params: MoveParams & { signature: string }) => post<MoveFinish>("/api/move/finish", params),
}
