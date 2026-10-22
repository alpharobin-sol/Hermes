// lib/api/deposit-api.ts

import { getFullUrl } from "./yield-api";
import { SOLANA_NETWORK, type SolanaNetwork } from "../network";

export interface DepositToken {
  symbol: string;
  mint: string;
  decimals: number;
}

export interface DepositQuote {
  network?: SolanaNetwork; // missing on backends older than devnet support, which were mainnet-only
  protocol: string;
  method: "jupiter-swap" | "stake-pool";
  inputToken: DepositToken;
  outputToken: DepositToken;
  inAmount: string;
  outAmount: string;
  minOutAmount: string;
  priceImpactPct: number;
  slippageBps: number;
  routeLabels: string[];
}

export interface DepositTransaction {
  quote: DepositQuote;
  transaction: string; // base64, unsigned. The deposit itself
  transactions?: string[]; // every transaction to sign and send, in order (stale devnet pools need updates first)
  lastValidBlockHeight: number;
  prioritizationFeeLamports: number;
}

export interface DepositParams {
  protocol: string;
  inputToken: string;
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
function assertSameNetwork(network: SolanaNetwork | undefined) {
  const backendNetwork = network ?? "mainnet-beta";
  if (backendNetwork !== SOLANA_NETWORK) {
    throw new Error(`The Hermes API is on ${backendNetwork} but this app is on ${SOLANA_NETWORK}. Set SOLANA_NETWORK on the API to match.`);
  }
}

export class DepositAPI {
  // Protocols Hermes can deposit into directly from the given token
  static async getSupportedProtocols(inputToken: string, opts?: { signal?: AbortSignal }): Promise<string[]> {
    const res = await fetch(getFullUrl(`/api/deposit/supported?inputToken=${encodeURIComponent(inputToken)}`), {
      signal: opts?.signal,
    });
    if (!res.ok) throw new Error("Failed to load supported deposit routes");

    const json = await res.json();
    if ((json?.network ?? "mainnet-beta") !== SOLANA_NETWORK) {
      console.warn(`Hermes API network (${json?.network ?? "mainnet-beta"}) does not match the app (${SOLANA_NETWORK}). In-app deposits are off.`);
      return [];
    }
    const list: { protocol: string }[] = Array.isArray(json?.data) ? json.data : [];
    return list.map((item) => item.protocol.toLowerCase());
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
}
