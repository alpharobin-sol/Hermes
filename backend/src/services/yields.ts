import { logger } from '../utils/logger';
import { solanaNetwork } from '../config/runtime';
import { ROUTES, Category, DepositStatus, InputToken, depositCap, depositStatus } from '../registry/routes';
import { getRate, refreshRates, SOURCE_LABELS } from './rates';

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
  risk: RiskTier;
  website: string;
  source: string; // where apy and tvl come from
  updatedAt: string;
  utilization: number | null; // lending only: share of the supply that is borrowed, 1 = all of it
  deposit: DepositStatus | null; // in-app deposit on the network the API runs on
  depositCap: number | null; // largest single deposit while in beta on mainnet, in `token`
}

// A lending reserve this borrowed may not have liquidity for withdrawals
const HIGH_UTILIZATION = 0.95;

/**
 * Risk tier from TVL: how much money already sits in the route. A lending reserve that is 95% or
 * more borrowed is at least moderate, since withdrawals may have to wait.
 * It does not measure contract or depeg risk.
 */
export function riskTier(tvl: number, utilization?: number): RiskTier {
  const byTvl: RiskTier = tvl >= 100_000_000 ? 'low' : tvl >= 10_000_000 ? 'moderate' : 'high';
  if (byTvl === 'low' && utilization !== undefined && utilization >= HIGH_UTILIZATION) return 'moderate';
  return byTvl;
}

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

  const rows = await Promise.all(
    routes.map(async (route): Promise<YieldRoute | null> => {
      const rate = await getRate(route.source);
      // No rate, no row
      if (!rate) return null;

      return {
        id: route.id,
        protocol: route.protocol,
        name: route.name,
        category: route.category,
        token: route.token,
        receipt: route.receipt?.symbol ?? null,
        apy: rate.apy,
        tvl: rate.tvl,
        risk: riskTier(rate.tvl, rate.utilization),
        website: route.website,
        source: SOURCE_LABELS[route.source.kind],
        updatedAt: new Date(rate.updatedAt).toISOString(),
        utilization: rate.utilization ?? null,
        deposit: depositStatus(route, network),
        depositCap: depositCap(route, network),
      };
    })
  );

  return rows.filter((row): row is YieldRoute => row !== null).sort((a, b) => b.apy - a.apy);
}

/**
 * Keep the rate caches warm so user requests never wait on a cold fetch
 */
export function startRateRefresh(intervalMs: number = 5 * 60 * 1000): NodeJS.Timeout {
  const refresh = () => refreshRates().catch((error) => logger.error('Rate refresh failed:', error));
  refresh();
  return setInterval(refresh, intervalMs);
}
