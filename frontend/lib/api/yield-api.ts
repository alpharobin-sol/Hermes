// lib/api/yield-api.ts

import { SOLANA_NETWORK, type SolanaNetwork } from "../network";

const API_BASE_URL =
  (globalThis as any).__APP_API_BASE_URL ??
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  "http://localhost:3000";

export function getFullUrl(path: string): string {
  if (
    typeof window !== "undefined" &&
    API_BASE_URL.includes(window.location.origin)
  ) {
    return path.startsWith("/") ? path : `/${path}`;
  }
  const base = API_BASE_URL.endsWith("/")
    ? API_BASE_URL.slice(0, -1)
    : API_BASE_URL;
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${base}${p}`;
}

export type RiskTier = "low" | "moderate" | "high";

// live: passed every integration check, including a real deposit. beta: built and simulated, not yet proven with real funds.
export type DepositStatus = "live" | "beta";

// One part of the Safety Score, worth up to `max` points
export interface SafetyPart {
  key: "size" | "track-record" | "outflows" | "exit";
  label: string;
  points: number;
  max: number;
  detail: string; // what was measured, in plain words
  source: string;
}

// 0 to 100 from live data: size, track record, 30-day outflows and exit. Not contract or depeg risk.
export interface SafetyScore {
  score: number;
  parts: SafetyPart[];
}

// One route from GET /api/yields
export interface YieldRoute {
  id: string;
  protocol: string;
  name: string;
  category: "liquid-staking" | "lending";
  token: string; // what the user deposits
  receipt: string | null; // token the user receives, e.g. JitoSOL
  apy: number; // decimal
  tvl: number; // USD
  risk: RiskTier; // band of the Safety Score (from TVL when unscored); lending reserves 95% or more borrowed are at least moderate
  safety?: SafetyScore | null; // null while any part of the score is missing
  website: string;
  source: string; // where apy and tvl come from
  updatedAt: string;
  utilization?: number | null; // lending only: share of the supply that is borrowed, 1 = all of it
  deposit: DepositStatus | null; // null: view only, deposit in the protocol's app
  depositCap: number | null; // largest single deposit while in beta on mainnet, in `token`
}

export class YieldAPI {
  // Routes for one deposit token, or for every token when `token` is left out
  static async getRoutes(token?: string, opts?: { signal?: AbortSignal }): Promise<YieldRoute[]> {
    const query = token ? `?token=${encodeURIComponent(token)}` : "";
    const res = await fetch(getFullUrl(`/api/yields${query}`), {
      cache: "no-cache",
      signal: opts?.signal,
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json?.success) throw new Error(json?.error || "Failed to fetch yields");

    // Rows without an id come from an older API version and cannot be deposited into or linked
    const routes: YieldRoute[] = (Array.isArray(json.data) ? json.data : []).filter(
      (route: any) => typeof route?.id === "string" && typeof route?.name === "string"
    );

    // Deposits built for another network would fail or land on the wrong chain, so show those routes as view only
    const network: SolanaNetwork = json.network ?? "mainnet-beta";
    if (network !== SOLANA_NETWORK) {
      console.warn(`Hermes API network (${network}) does not match the app (${SOLANA_NETWORK}). In-app deposits are off.`);
      return routes.map((route) => ({ ...route, deposit: null }));
    }
    return routes;
  }
}
