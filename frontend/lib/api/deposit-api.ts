// lib/api/deposit-api.ts

import { getFullUrl } from "./yield-api";
import { SOLANA_NETWORK, type SolanaNetwork } from "../network";

export interface DepositToken {
  symbol: string;
  mint: string;
  decimals: number;
}

// direct: straight into the protocol (Jito's stake pool, Marinade) at its own rate
export type DepositMethod = "jupiter-swap" | "direct";

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
  compared?: { method: DepositMethod; label?: string; outAmount: string }[]; // other paths the API quoted and passed over
  position?: string | null; // lending: where the deposit is held (e.g. "Kamino Lend"), no token reaches the wallet
  setupCostSol?: string | null; // lending: one-time account rent in SOL, known when the quote had a wallet
}

export interface DepositTransaction {
  quote: DepositQuote;
  transaction: string; // base64, unsigned. The deposit itself
  transactions?: string[]; // every transaction to sign and send, in order (stale devnet pools need updates first)
  lastValidBlockHeight: number;
  prioritizationFeeLamports: number;
}

// A Top rated split: one deposit per part, each built and simulated, for one approval in the wallet
export interface SplitPartBuild extends DepositTransaction {
  routeId: string
  amount: string // UI units, what this part deposits
}

export interface SplitBuild {
  parts: SplitPartBuild[]
  solReserve: number | null // SOL the whole split keeps back for fees and the accounts it opens (SOL splits)
}

export interface SplitParams {
  token: string
  userPublicKey: string
  parts: { routeId: string; amount: string }[]
}

export interface DepositParams {
  routeId: string;
  amount: number;
  userPublicKey?: string; // on quotes, lets lending routes check the balance and include one-time rent
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

// One route's live quote for an amount: what lands, what it is worth right after (in the input token), the entry cost
export interface RouteQuote {
  routeId: string;
  quote: DepositQuote | null;
  value: string | null;
  entryCost: number | null; // share of the amount lost on entry. Negative: the deposit is worth more than went in
  error: string | null; // why this route can't quote right now
}

// A Jupiter swap the browser quotes itself (Jupiter limits requests per IP, and the API's IP is shared)
export interface SwapToQuote {
  inputMint: string;
  inputDecimals: number;
  outputMint: string;
  outputSymbol: string;
  outputDecimals: number;
  rawAmount: string;
}

// What the API answers for one route: the direct deposit quote, and a swap to quote in the browser
export interface ServerRouteQuote {
  routeId: string;
  quote: DepositQuote | null;
  swap: SwapToQuote | null;
  tokenValue: number | null; // liquid staking: SOL per token in the pool
  value: string | null;
  entryCost: number | null;
  error: string | null;
}

export class DepositAPI {
  // Every route for a token at once, like a swap aggregator's quotes. Swaps come back for the browser to quote.
  static async quoteRoutes(token: string, amount: number, routeIds: string[], opts?: { signal?: AbortSignal }) {
    return post<ServerRouteQuote[]>("/api/deposit/quotes", { token, amount: String(amount), routeIds }, opts?.signal);
  }

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

  // Every part of a split at once. The API checks each route is top rated and the whole split fits the beta cap and
  // the wallet's SOL.
  static async buildSplit(params: SplitParams) {
    const built = await post<SplitBuild>("/api/deposit/split", params);
    for (const part of built.parts) assertSameNetwork(part.quote.network);
    return built;
  }
}
