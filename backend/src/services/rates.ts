import axios from 'axios';
import axiosRetry from 'axios-retry';
import { Connection, PublicKey } from '@solana/web3.js';
import { StakePoolLayout } from '@solana/spl-stake-pool';
import { logger } from '../utils/logger';
import { cached } from './cache';
import { KAMINO_MAIN_MARKET, RateSource, ROUTES, TOKENS } from '../registry/routes';

/**
 * Live APY and TVL for every route in the registry, read from the chain or the protocol itself:
 * - Stake pool LSTs: each pool's own account on chain, priced in USD with Jupiter's SOL price
 * - mSOL: Marinade's API. Kamino Lend: Kamino's API. Jupiter Lend: Jupiter's API.
 * - INF only: DefiLlama, until a live source exists (Sanctum's APY API returns 0)
 * Fast sources refresh every minute. When a source is down, routes that depend on it drop out.
 * Hermes never fills the gap with an estimate.
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

const MINUTE_MS = 60 * 1000;

/**
 * A rate source cached for ttlMs. After a failed fetch its last good rates serve for up to maxStaleMs,
 * then its routes drop out.
 */
function rateSource(name: string, fetcher: () => Promise<RateMap>, ttlMs = MINUTE_MS, maxStaleMs = 15 * MINUTE_MS) {
  return cached(
    `rates from ${name}`,
    async () => {
      const rates = await fetcher();
      logger.debug(`Fetched ${rates.size} rates from ${name}`);
      return rates;
    },
    { ttlMs, maxStaleMs }
  );
}

const connection = new Connection(process.env.SOLANA_RPC_URL || 'https://solana-rpc.publicnode.com', 'confirmed');

// SOL in USD from Jupiter's price API
export const solPrice = cached(
  'SOL price from Jupiter',
  async () => {
    const response = await http.get(process.env.JUPITER_PRICE_API_URL || 'https://lite-api.jup.ag/price/v3', {
      params: { ids: TOKENS.SOL.mint },
    });
    const price = Number(response.data?.[TOKENS.SOL.mint]?.usdPrice);
    if (!(price > 0)) throw new Error('no SOL price');
    return price;
  },
  { ttlMs: MINUTE_MS, maxStaleMs: 15 * MINUTE_MS }
);

const YEAR_SECONDS = 365.25 * 24 * 60 * 60;

// Keyed by stake pool address. APY compounds the pool's own record of this epoch's SOL per token against
// last epoch's. Epoch length is measured from recent slots, not assumed. TVL is the SOL the pool holds.
const stakePoolRates = rateSource('stake pools on chain', async () => {
  const pools = [...new Set(ROUTES.flatMap((route) => (route.source.kind === 'stake-pool' ? [route.source.pool] : [])))];
  const [accounts, epochInfo, samples, price] = await Promise.all([
    connection.getMultipleAccountsInfo(pools.map((pool) => new PublicKey(pool))),
    connection.getEpochInfo(),
    connection.getRecentPerformanceSamples(60),
    solPrice.get(),
  ]);
  if (!price) throw new Error('no SOL price');

  const slots = samples.reduce((sum, sample) => sum + sample.numSlots, 0);
  const seconds = samples.reduce((sum, sample) => sum + sample.samplePeriodSecs, 0);
  if (slots <= 0 || seconds <= 0) throw new Error('no slot timing');
  const epochsPerYear = YEAR_SECONDS / ((epochInfo.slotsInEpoch * seconds) / slots);

  const rates: RateMap = new Map();
  const now = Date.now();
  accounts.forEach((account, i) => {
    if (!account) return;
    const pool = StakePoolLayout.decode(account.data);
    const lamports = Number(pool.totalLamports.toString());
    const current = lamports / Number(pool.poolTokenSupply.toString());
    const previous = Number(pool.lastEpochTotalLamports.toString()) / Number(pool.lastEpochPoolTokenSupply.toString());
    if (!(current > 0) || !(previous > 0) || !Number.isFinite(current) || !Number.isFinite(previous)) return;
    rates.set(pools[i], { apy: Math.pow(current / previous, epochsPerYear) - 1, tvl: (lamports / 1e9) * price, updatedAt: now });
  });
  return rates;
});

// Keyed "marinade": mSOL's 7-day APY and the SOL staked through mSOL, from Marinade's API
const marinadeRates = rateSource(
  'Marinade',
  async () => {
    const base = process.env.MARINADE_API_URL || 'https://api.marinade.finance';
    const [apy, tlv] = await Promise.all([http.get(`${base}/msol/apy/7d`), http.get(`${base}/tlv`)]);
    const value = Number(apy.data?.value);
    const tvl = Number(tlv.data?.staked_usd);
    if (!Number.isFinite(value) || !(tvl > 0)) throw new Error('unexpected Marinade response');
    return new Map([['marinade', { apy: value, tvl, updatedAt: Date.now() }]]);
  },
  5 * MINUTE_MS
);

// Keyed by `${project}:${symbol}`. The pools list is ~10 MB, only Solana pools are kept. Only INF uses it.
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
}, 10 * MINUTE_MS, 60 * MINUTE_MS);

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
  'stake-pool': 'On-chain',
  marinade: 'Marinade',
  defillama: 'DefiLlama',
  kamino: 'Kamino',
  'jupiter-lend': 'Jupiter Lend',
};

/**
 * Current rate for a route's source, or undefined when the source has none
 */
export async function getRate(source: RateSource): Promise<Rate | undefined> {
  switch (source.kind) {
    case 'stake-pool':
      return (await stakePoolRates.get())?.get(source.pool);
    case 'marinade':
      return (await marinadeRates.get())?.get('marinade');
    case 'defillama':
      return (await defillamaRates.get())?.get(`${source.project}:${source.symbol}`);
    case 'kamino':
      return (await kaminoRates.get())?.get(source.reserve);
    case 'jupiter-lend':
      return (await jupiterLendRates.get())?.get(source.mint);
  }
}

/**
 * Fetch every source whose cache is due, so requests hit a warm cache
 */
export async function refreshRates(): Promise<void> {
  await Promise.all([stakePoolRates, marinadeRates, defillamaRates, kaminoRates, jupiterLendRates].map((source) => source.get()));
}
