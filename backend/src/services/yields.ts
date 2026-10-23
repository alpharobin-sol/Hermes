import { logger } from '../utils/logger';
import { solanaNetwork } from '../config/runtime';
import { ROUTES, Category, DepositStatus, InputToken, depositCap, depositStatus } from '../registry/routes';
import { getRate, refreshRates, SOURCE_LABELS } from './rates';
import { refreshSafetyInputs, safetyScore, SafetyScore } from './safety';
import { recordSnapshots, Snapshot } from './history';

export type RiskTier = 'low' | 'moderate' | 'high';

export interface YieldRoute {
  id: string;
  protocol: string;
  name: string;
  category: Category;
  token: InputToken; // what the user deposits
  receipt: string | null; // token the user receives, e.g. JitoSOL
  apy: number; // decimal
  tvl: number; // USD
  risk: RiskTier; // band of the Safety Score, or from TVL while the route has no score
  safety: SafetyScore | null; // null while any part of the score is missing
  website: string;
  source: string; // where apy and tvl come from
  updatedAt: string;
  utilization: number | null; // lending only: share of the supply that is borrowed, 1 = all of it
  withdrawable: number | null; // lending only: share of the supply that can be withdrawn right now
  deposit: DepositStatus | null; // in-app deposit on the network the API runs on
  depositCap: number | null; // largest single deposit while in beta on mainnet, in `token`
}

// A lending reserve this borrowed or held back may not have liquidity for withdrawals
const HIGH_UTILIZATION = 0.95;

/**
 * Risk tier: low at a Safety Score of 80 or more, moderate from 60, high below.
 * Without a score it comes from TVL: low at $100M or more, moderate from $10M, high below.
 * A lending reserve with 95% or more borrowed or held back is at least moderate, since withdrawals may have to wait.
 * It does not measure contract or depeg risk.
 */
export function riskTier(tvl: number, locked?: number, score?: number): RiskTier {
  const tier: RiskTier =
    score !== undefined
      ? score >= 80 ? 'low' : score >= 60 ? 'moderate' : 'high'
      : tvl >= 100_000_000 ? 'low' : tvl >= 10_000_000 ? 'moderate' : 'high';
  if (tier === 'low' && locked !== undefined && locked >= HIGH_UTILIZATION) return 'moderate';
  return tier;
}

// How long a request waits for Safety Score history that is still loading, e.g. just after a restart
const SAFETY_WAIT_MS = 12_000;

// View-only routes (no in-app deposit on this network) stay in the registry and keep their live
// rates, but the site leaves them out until each one gets an in-app deposit. Set to true to show them.
const SHOW_VIEW_ONLY_ROUTES = process.env.SHOW_VIEW_ONLY_ROUTES === 'true';

/**
 * Registry routes that have a live rate, highest APY first.
 * Only routes Hermes can deposit into, unless includeViewOnly or SHOW_VIEW_ONLY_ROUTES is set.
 */
export async function getYieldRoutes(
  token?: InputToken,
  includeViewOnly: boolean = SHOW_VIEW_ONLY_ROUTES
): Promise<YieldRoute[]> {
  const network = solanaNetwork();
  const routes = ROUTES.filter(
    (route) => (!token || route.token === token) && (includeViewOnly || depositStatus(route, network) !== null)
  );

  const rates = await Promise.all(routes.map((route) => getRate(route.source)));

  // Scores come from cached history. If some are missing, give the refresh a moment to fill them.
  if (routes.some((route, i) => rates[i] && !safetyScore(route, rates[i]))) {
    await Promise.race([refreshSafetyInputs(), new Promise((resolve) => setTimeout(resolve, SAFETY_WAIT_MS))]);
  }

  const rows = routes.map((route, i): YieldRoute | null => {
    const rate = rates[i];
    // No rate, no row
    if (!rate) return null;
    const safety = safetyScore(route, rate);
    // Share of deposits that can't leave right now: borrowed (Kamino) or not withdrawable (Jupiter Lend)
    const locked = rate.utilization ?? (rate.withdrawable !== undefined ? 1 - rate.withdrawable : undefined);

    return {
      id: route.id,
      protocol: route.protocol,
      name: route.name,
      category: route.category,
      token: route.token,
      receipt: route.receipt?.symbol ?? null,
      apy: rate.apy,
      tvl: rate.tvl,
      risk: riskTier(rate.tvl, locked, safety?.score),
      safety,
      website: route.website,
      source: rate.source ?? SOURCE_LABELS[route.source.kind],
      updatedAt: new Date(rate.updatedAt).toISOString(),
      utilization: rate.utilization ?? null,
      withdrawable: rate.withdrawable ?? null,
      deposit: depositStatus(route, network),
      depositCap: depositCap(route, network),
    };
  });

  return rows.filter((row): row is YieldRoute => row !== null).sort((a, b) => b.apy - a.apy);
}

// Every route's current rate, for Hermes's own history
async function collectSnapshots(): Promise<Snapshot[]> {
  const rows = await Promise.all(
    ROUTES.map(async (route): Promise<Snapshot | null> => {
      const rate = await getRate(route.source);
      if (!rate) return null;
      return {
        routeId: route.id,
        apy: rate.apy,
        tvlUsd: rate.tvl,
        deposits: rate.deposits,
        tokenValue: rate.tokenValue,
        withdrawable: rate.withdrawable,
        safetyScore: safetyScore(route, rate)?.score,
      };
    })
  );
  return rows.filter((row): row is Snapshot => row !== null);
}

/**
 * Keep the rate and Safety Score caches warm so user requests never wait on a cold fetch,
 * and record history every 10 minutes when DATABASE_URL is set
 */
export function startRateRefresh(intervalMs: number = 60 * 1000): NodeJS.Timeout {
  // Safety Score history goes after the rates: DefiLlama deposit history needs each route's pool id
  const refresh = () =>
    refreshRates()
      // Snapshots after the score inputs, so each one carries the route's Safety Score
      .then(() => refreshSafetyInputs())
      .then(() => recordSnapshots(collectSnapshots))
      .catch((error) => logger.error('Rate refresh failed:', error));
  refresh();
  return setInterval(refresh, intervalMs);
}
