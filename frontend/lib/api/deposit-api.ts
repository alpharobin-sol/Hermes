// lib/api/deposit-api.ts

import { getFullUrl } from "./yield-api";
import { SOLANA_NETWORK, type SolanaNetwork } from "../network";

export interface DepositToken {
  symbol: string;
  mint: string;
  decimals: number;
}

export type DepositMethod = "jupiter-swap" | "stake-pool";

export interface DepositQuote {
  network: SolanaNetwork;
  routeId: string;
  method: DepositMethod;
  inputToken: DepositToken;
  outputToken: DepositToken;
  inAmount: string;
  outAmount: string;
  minOutAmount: string;
  priceImpactPct: number;
  slippageBps: number;
  routeLabels: string[];
  compared?: { method: DepositMethod; outAmount: string }[]; // other paths the API quoted and passed over
}

export interface DepositTransaction {
  quote: DepositQuote;
  transaction: string; // base64, unsigned. The deposit itself
  transactions?: string[]; // every transaction to sign and send, in order (stale devnet pools need updates first)
  lastValidBlockHeight: number;
  prioritizationFeeLamports: number;
}

export interface DepositParams {
  routeId: string;
  amount: number;
  slippageBps?: number;
}

async function post<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(getFullUrl(path), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json?.success) {
    throw new Error(json?.error || "Deposit request failed");
  }
  return json.data as T;
}

// A mismatch would build transactions for a chain the app does not send to
function assertSameNetwork(network: SolanaNetwork) {
  if (network !== SOLANA_NETWORK) {
    throw new Error(`The Hermes API is on ${network} but this app is on ${SOLANA_NETWORK}. Set SOLANA_NETWORK on the API to match.`);
  }
}

export class DepositAPI {
  static async getQuote(params: DepositParams, opts?: { signal?: AbortSignal }) {
    const quote = await post<DepositQuote>("/api/deposit/quote", { ...params, amount: String(params.amount) }, opts?.signal);
    assertSameNetwork(quote.network);
    return quote;
  }

  static async buildTransaction(params: DepositParams & { userPublicKey: string }) {
    const built = await post<DepositTransaction>("/api/deposit/build", { ...params, amount: String(params.amount) });
    assertSameNetwork(built.quote.network);
    return built;
  }
}
