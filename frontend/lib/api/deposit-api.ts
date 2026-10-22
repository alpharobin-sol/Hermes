// lib/api/deposit-api.ts

import { getFullUrl } from "./yield-api";

export interface DepositToken {
  symbol: string;
  mint: string;
  decimals: number;
}

export interface DepositQuote {
  protocol: string;
  method: "jupiter-swap";
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
  transaction: string; // base64, unsigned
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

export class DepositAPI {
  // Protocols Hermes can deposit into directly from the given token
  static async getSupportedProtocols(inputToken: string, opts?: { signal?: AbortSignal }): Promise<string[]> {
    const res = await fetch(getFullUrl(`/api/deposit/supported?inputToken=${encodeURIComponent(inputToken)}`), {
      signal: opts?.signal,
    });
    if (!res.ok) throw new Error("Failed to load supported deposit routes");

    const json = await res.json();
    const list: { protocol: string }[] = Array.isArray(json?.data) ? json.data : [];
    return list.map((item) => item.protocol.toLowerCase());
  }

  static getQuote(params: DepositParams, opts?: { signal?: AbortSignal }) {
    return post<DepositQuote>("/api/deposit/quote", { ...params, amount: String(params.amount) }, opts?.signal);
  }

  static buildTransaction(params: DepositParams & { userPublicKey: string }) {
    return post<DepositTransaction>("/api/deposit/build", { ...params, amount: String(params.amount) });
  }
}
