import axios from 'axios';
import axiosRetry from 'axios-retry';
import { logger } from '../utils/logger';
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
  updatedAt: number; // ms timestamp of the fetch
}

type RateMap = Map<string, Rate>;

const CACHE_TTL_MS = 10 * 60 * 1000;
// After a failed fetch, wait this long before trying the source again
const RETRY_AFTER_MS = 60 * 1000;
// After a failed fetch the last good rates keep serving, but never older than this
const MAX_STALE_MS = 60 * 60 * 1000;

const http = axios.create({ timeout: 30000 });
axiosRetry(http, {
  retries: 2,
  retryDelay: axiosRetry.exponentialDelay,
  retryCondition: (error) => axiosRetry.isNetworkOrIdempotentRequestError(error) || error.response?.status === 429,
});

type SourceGetter = (force?: boolean) => Promise<RateMap>;

/**
 * Wraps a fetcher with a TTL cache, one request in flight at a time, a stale fallback,
 * and a pause after failures so a down source does not slow every request
 */
function cachedSource(name: string, fetcher: () => Promise<RateMap>): SourceGetter {
  let last: { rates: RateMap; fetchedAt: number } | null = null;
  let failedAt = 0;
  let inflight: Promise<RateMap> | null = null;

  const fallback = (): RateMap => (last && Date.now() - last.fetchedAt < MAX_STALE_MS ? last.rates : new Map());

  return (force = false) => {
    if (inflight) return inflight;
    if (!force && last && Date.now() - last.fetchedAt < CACHE_TTL_MS) return Promise.resolve(last.rates);
    if (!force && Date.now() - failedAt < RETRY_AFTER_MS) return Promise.resolve(fallback());

    inflight = fetcher()
      .then((rates) => {
        last = { rates, fetchedAt: Date.now() };
        logger.info(`Fetched ${rates.size} rates from ${name}`);
        return rates;
      })
      .catch((error) => {
        failedAt = Date.now();
        logger.warn(`Failed to fetch rates from ${name}: ${error instanceof Error ? error.message : error}`);
        return fallback();
      })
      .finally(() => {
        inflight = null;
      });
    return inflight;
  };
}

// Keyed by `${project}:${symbol}`. The pools list is ~10 MB, only Solana pools are kept.
const defillamaRates = cachedSource('DefiLlama', async () => {
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
    rates.set(key, { apy: pool.apy / 100, tvl, updatedAt: now });
  }
  return rates;
});

// Keyed by reserve address
const kaminoRates = cachedSource('Kamino', async () => {
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
    rates.set(reserve.reserve, { apy, tvl, utilization, updatedAt: now });
  }
  return rates;
});

// Keyed by token mint
const jupiterLendRates = cachedSource('Jupiter Lend', async () => {
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
    rates.set(token.assetAddress, { apy: rateBps / 10_000, tvl, updatedAt: now });
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
      return (await defillamaRates()).get(`${source.project}:${source.symbol}`);
    case 'kamino':
      return (await kaminoRates()).get(source.reserve);
    case 'jupiter-lend':
      return (await jupiterLendRates()).get(source.mint);
  }
}

/**
 * Fetch every source now, so requests hit a warm cache
 */
export async function refreshRates(): Promise<void> {
  await Promise.all([defillamaRates(true), kaminoRates(true), jupiterLendRates(true)]);
}
