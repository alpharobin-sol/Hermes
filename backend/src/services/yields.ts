import { logger } from '../utils/logger';
import { solanaNetwork } from '../config/runtime';
import { ROUTES, Category, DepositStatus, InputToken, depositStatus } from '../registry/routes';
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
  deposit: DepositStatus | null; // in-app deposit on the network the API runs on
}

/**
 * Risk tier from TVL alone: how much money already sits in the route.
 * It does not measure contract, depeg or liquidity risk.
 */
export function riskTier(tvl: number): RiskTier {
  if (tvl >= 100_000_000) return 'low';
  if (tvl >= 10_000_000) return 'moderate';
  return 'high';
}

/**
 * Every registry route that has a live rate, highest APY first
 */
export async function getYieldRoutes(token?: InputToken): Promise<YieldRoute[]> {
  const network = solanaNetwork();
  const routes = ROUTES.filter((route) => !token || route.token === token);

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
        risk: riskTier(rate.tvl),
        website: route.website,
        source: SOURCE_LABELS[route.source.kind],
        updatedAt: new Date(rate.updatedAt).toISOString(),
        deposit: depositStatus(route, network),
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
