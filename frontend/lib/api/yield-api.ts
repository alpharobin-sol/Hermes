// lib/api/yield-api.ts

import { getRiskStats } from "../helpers/risk";

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

const getHeaders = (): HeadersInit => {
  const accessToken = "TOKEN";
  const headers: HeadersInit = { "Content-Type": "application/json" };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  return headers;
};

// ————————————————————————
// FULL YIELD ITEM (used by both endpoints)
// ————————————————————————
export interface YieldItem {
  protocol: string;
  asset?: string;
  apy: number;
  apr?: number;
  tvl: number;
  riskScore: number;
  score?: number;
  timestamp?: string;
  realAPY?: number;
  baseAPY?: number;
  slippage?: number;
  gasCost?: number;
  protocolFees?: number;

  //
  estimatedYearlyReturn?: number;
  estimatedMonthlyReturn?: number;
  estimatedReturn?: number;

  effectivenessScore?: number;
  volatility?: number;
  // fees?: any;
  fees?:
    | string
    | {
        depositFee?: number;
        withdrawalFee?: number;
        performanceFee?: number;
        managementFee?: number;
        [key: string]: any;
      };

  metadata?: any;

  // RISK REQUIED
  risk: "low" | "moderate" | "high";
  riskColor: string;
  riskBg?: string;

  users: string;
  avgDeposit: string;
  lockPeriod: string;

  audited: boolean;
  dailyReturn: number;
  weeklyReturn: number;
  monthlyReturn: number;
  yearlyReturn: number;
}

// ————————————————————————
// BEST ROUTE RESPONSE
// ————————————————————————
export interface BestRouteResponse {
  success?: boolean;
  data: {
    bestRoute: YieldItem & { reason?: string };
    alternativeRoutes: YieldItem[];
    reason?: string;
    confidence?: number;
    timestamp?: string;
    metrics?: {
      totalRoutesEvaluated: number;
      averageAPY: number;
      averageRiskScore: number;
    };
  };
}

export class YieldAPI {
  // Add this helper inside YieldAPI class or in a utils file
  private static normalizeYieldItem(item: any): YieldItem {
    const rawScore = Number(item.riskScore ?? 0);
    const riskScore = isNaN(rawScore) ? 0 : Math.round(rawScore);
    const riskStats = getRiskStats(riskScore);

    return {
      protocol: item.protocol ?? "Unknown",
      asset: item.asset ?? null,
      apy: item.apy ?? 0,
      apr: item.apr ?? null,
      tvl: item.tvl ?? 0,

      // valueable normalized YieldItem
      riskScore,
      risk: riskStats.level,
      riskColor: riskStats.colorClass, // ← send color to frontend
      riskBg: riskStats.bgClass,

      score: item.score ?? null,
      timestamp: item.timestamp ?? null,
      realAPY: item.realAPY ?? null,
      baseAPY: item.baseAPY ?? null,
      slippage: item.slippage ?? null,
      gasCost: item.gasCost ?? null,
      protocolFees: item.protocolFees ?? null,

      estimatedYearlyReturn: item.estimatedYearlyReturn ?? null,
      estimatedMonthlyReturn: item.estimatedMonthlyReturn ?? null,
      estimatedReturn: item.estimatedReturn ?? null,

      effectivenessScore: item.effectivenessScore ?? null,
      volatility: item.volatility ?? null,
      fees: item.fees ?? null, // will be null if missing

      metadata: item.metadata ?? null,

      users: item.users ?? "—",
      avgDeposit: item.avgDeposit ?? "—",
      lockPeriod: item.lockPeriod ?? "Flexible",

      audited: item.audited ?? false,

      // These you probably calculate client-side now
      dailyReturn: item.dailyReturn ?? 0,
      weeklyReturn: item.weeklyReturn ?? 0,
      monthlyReturn: item.monthlyReturn ?? 0,
      yearlyReturn: item.yearlyReturn ?? 0,
    } as YieldItem;
  }

  static async getAllYields(
    params: {
      asset?: string;
      amount?: number;
      limit?: number;
    } = {},
    opts?: { signal?: AbortSignal }
  ) {
    const query = new URLSearchParams();
    if (params.asset) query.append("asset", params.asset);
    if (params.amount) query.append("amount", String(params.amount));
    if (params.limit) query.append("limit", String(params.limit));

    const url = getFullUrl(`/api/yields${query.toString() ? `?${query}` : ""}`);
    const res = await fetch(url, { headers: getHeaders(), cache: "no-cache", signal: opts?.signal });

    if (!res.ok) throw new Error("Failed to fetch yields");

    const json = await res.json();
    const list = json?.data ?? json?.yields ?? json ?? [];

    const items = Array.isArray(list) ? list : [];
    return items.map((item) => this.normalizeYieldItem(item)) as YieldItem[];
  }

  static async getBestRoute(params: {
    asset: string;
    amount: number;
    riskProfile: "low" | "moderate" | "high";
  }, opts?: { signal?: AbortSignal }) {
    const query = new URLSearchParams({
      asset: params.asset,
      amount: String(params.amount),
      riskProfile: params.riskProfile,
    });

    const url = getFullUrl(`/api/yields/best?${query}`);
    const res = await fetch(url, { headers: getHeaders(), cache: "no-cache", signal: opts?.signal });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error || "Failed to fetch best route");
    }

    const json = await res.json();
    const payload = json?.data ?? json; // ← supports both formats

    return {
      data: {
        bestRoute: this.normalizeYieldItem(payload.bestRoute),
        alternativeRoutes: Array.isArray(payload.alternativeRoutes)
          ? payload.alternativeRoutes.map((r: any) =>
              this.normalizeYieldItem(r)
            )
          : [],
        reason: payload.reason ?? null,
        confidence: payload.confidence ?? null,
        timestamp: payload.timestamp ?? null,
        metrics: payload.metrics ?? null,
      },
    } as BestRouteResponse;
  }
}
