import axios from 'axios';
import axiosRetry from 'axios-retry';
import { logger } from '../utils/logger';
import { cached } from './cache';
import { KAMINO_MAIN_MARKET, RateSource } from '../registry/routes';

/**
 * Live APY and TVL for every route in the registry, from three sources:
 * DefiLlama (liquid staking), Kamino's API (Kamino Lend) and Jupiter's API (Jupiter Lend).
 * When a source is down, routes that depend on it drop out. Hermes never fills the gap with an estimate.
 */

export interface Rate {
  apy: number; // decimal, 0.05 = 5%
  tvl: number; // USD
  utilization?: number; // lending only: share of the supply that is borrowed, 1 = all of it
  withdrawable?: number; // lending only: share of the supply that can be withdrawn right now
  updatedAt: number; // ms timestamp of the fetch
  defillamaPool?: string; // DefiLlama pool id, for its history
}

type RateMap = Map<string, Rate>;

// Shared by the services that read public data APIs
export const http = axios.create({ timeout: 30000 });
axiosRetry(http, {
  retries: 2,
  retryDelay: axiosRetry.exponentialDelay,
  retryCondition: (error) => axiosRetry.isNetworkOrIdempotentRequestError(error) || error.response?.status === 429,
});

/**
 * A rate source cached for 10 minutes. After a failed fetch its last good rates serve for up to an hour,
 * then its routes drop out.
 */
function rateSource(name: string, fetcher: () => Promise<RateMap>) {
  return cached(
    `rates from ${name}`,
    async () => {
      const rates = await fetcher();
      logger.info(`Fetched ${rates.size} rates from ${name}`);
      return rates;
    },
    { ttlMs: 10 * 60 * 1000, maxStaleMs: 60 * 60 * 1000 }
  );
}

// Keyed by `${project}:${symbol}`. The pools list is ~10 MB, only Solana pools are kept.
const defillamaRates = rateSource('DefiLlama', async () => {
  const response = await http.get('https://yields.llama.fi/pools');
  const pools: any[] = Array.isArray(response.data?.data) ? response.data.data : [];
  const rates: RateMap = new Map();
  const now = Date.now();

  for (const pool of pools) {
    if (pool.chain !== 'Solana' || !Number.isFinite(pool.apy)) continue;
    const key = `${pool.project}:${pool.symbol}`;
    const tvl = Number(pool.tvlUsd) || 0;
    // A project can list several pools with one symbol. Keep the largest.
    const current = rates.get(key);
    if (current && current.tvl >= tvl) continue;
    rates.set(key, { apy: pool.apy / 100, tvl, updatedAt: now, defillamaPool: pool.pool });
  }
  return rates;
});

// Keyed by reserve address
const kaminoRates = rateSource('Kamino', async () => {
  const kaminoApi = process.env.KAMINO_API_URL || 'https://api.kamino.finance';
  const response = await http.get(`${kaminoApi}/kamino-market/${KAMINO_MAIN_MARKET}/reserves/metrics`, {
    params: { env: 'mainnet-beta' },
  });
  const reserves: any[] = Array.isArray(response.data) ? response.data : [];
  const rates: RateMap = new Map();
  const now = Date.now();

  for (const reserve of reserves) {
    const apy = Number(reserve.supplyApy);
    const tvl = Number(reserve.totalSupplyUsd) || 0;
    if (!Number.isFinite(apy)) continue;
    const supply = Number(reserve.totalSupply);
    const borrow = Number(reserve.totalBorrow);
    const utilization = supply > 0 && Number.isFinite(borrow) ? borrow / supply : undefined;
    const withdrawable = utilization !== undefined ? Math.max(0, 1 - utilization) : undefined;
    rates.set(reserve.reserve, { apy, tvl, utilization, withdrawable, updatedAt: now });
  }
  return rates;
});

// Keyed by token mint
const jupiterLendRates = rateSource('Jupiter Lend', async () => {
  const response = await http.get(`${process.env.JUPITER_LEND_API_URL || 'https://lite-api.jup.ag/lend/v1'}/earn/tokens`);
  const tokens: any[] = Array.isArray(response.data) ? response.data : [];
  const rates: RateMap = new Map();
  const now = Date.now();

  for (const token of tokens) {
    const rateBps = Number(token.totalRate); // supply rate plus rewards, in basis points
    const decimals = Number(token.asset?.decimals);
    const price = Number(token.asset?.price);
    if (!Number.isFinite(rateBps) || !Number.isFinite(decimals) || !Number.isFinite(price)) continue;
    const tvl = (Number(token.totalAssets) / 10 ** decimals) * price;
    // What can leave right now: limited by the liquidity not lent out and by Jupiter Lend's withdrawal limit
    const supplied = Number(token.liquiditySupplyData?.supply);
    const withdrawableNow = Number(token.liquiditySupplyData?.withdrawable);
    const withdrawable = supplied > 0 && Number.isFinite(withdrawableNow) ? Math.min(1, withdrawableNow / supplied) : undefined;
    rates.set(token.assetAddress, { apy: rateBps / 10_000, tvl, withdrawable, updatedAt: now });
  }
  return rates;
});

export const SOURCE_LABELS: Record<RateSource['kind'], string> = {
  defillama: 'DefiLlama',
  kamino: 'Kamino',
  'jupiter-lend': 'Jupiter Lend',
};

/**
 * Current rate for a route's source, or undefined when the source has none
 */
export async function getRate(source: RateSource): Promise<Rate | undefined> {
  switch (source.kind) {
    case 'defillama':
      return (await defillamaRates.get())?.get(`${source.project}:${source.symbol}`);
    case 'kamino':
      return (await kaminoRates.get())?.get(source.reserve);
    case 'jupiter-lend':
      return (await jupiterLendRates.get())?.get(source.mint);
  }
}

/**
 * Fetch every source now, so requests hit a warm cache
 */
export async function refreshRates(): Promise<void> {
  await Promise.all([defillamaRates.get(true), kaminoRates.get(true), jupiterLendRates.get(true)]);
}
