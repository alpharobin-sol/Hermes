import axios from 'axios';
import axiosRetry from 'axios-retry';
import { Connection, PublicKey } from '@solana/web3.js';
import { StakePoolLayout } from '@solana/spl-stake-pool';
import { logger } from '../utils/logger';
import { cached } from './cache';
import { KAMINO_MAIN_MARKET, PROJECT0_GROUP, RateSource, ROUTES, SANCTUM_EPOCHS, TOKENS } from '../registry/routes';
import { EpochValue, recentEpochValues, recordEpochValues, tokenValueNear } from './history';
import { jupiterBase, jupiterHeaders } from './jupiter';
import { readBank } from './project0';

/**
 * Live APY and TVL for every route in the registry, read from the chain or the protocol itself:
 * - Stake pool LSTs: each pool's own account on chain, priced in USD with Jupiter's SOL price
 * - INF: Sanctum Infinity's pool account on chain. Its APY comes from Hermes's own history of INF's SOL value,
 *   and from DefiLlama only until that history is a day old (Sanctum's APY API returns 0).
 * - mSOL: Marinade's API. Kamino Lend: Kamino's API. Jupiter Lend: Jupiter's API.
 * - Kamino vaults: Kamino's API for where the vault lends, and each reserve's free liquidity on chain.
 * - Project 0: each bank's own account on chain (its API refuses outside callers).
 * Fast sources refresh every minute. When a source is down, routes that depend on it drop out.
 * Hermes never fills the gap with an estimate.
 */

export interface Rate {
  apy: number; // decimal, 0.05 = 5%
  tvl: number; // USD
  utilization?: number; // lending only: share of the supply that is borrowed, 1 = all of it
  withdrawable?: number; // lending only: share of the supply that can be withdrawn right now
  deposits?: number; // in the route's token (SOL for LSTs), for Hermes's own history
  tokenValue?: number; // LSTs: SOL per token. Vaults: tokens per share. The value APY compounds on.
  source?: string; // where the APY came from, when not the source's usual label
  apyWindow?: string; // how far back an APY measured from past values looks: "the last epoch", "the last 10 epochs", "14 days"
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

export const connection = new Connection(process.env.SOLANA_RPC_URL || 'https://solana-rpc.publicnode.com', 'confirmed');

// SOL in USD from Jupiter's price API
export const solPrice = cached(
  'SOL price from Jupiter',
  async () => {
    const response = await http.get(process.env.JUPITER_PRICE_API_URL || jupiterBase('price/v3'), {
      params: { ids: TOKENS.SOL.mint },
      headers: process.env.JUPITER_PRICE_API_URL ? undefined : jupiterHeaders(),
    });
    const price = Number(response.data?.[TOKENS.SOL.mint]?.usdPrice);
    if (!(price > 0)) throw new Error('no SOL price');
    return price;
  },
  { ttlMs: MINUTE_MS, maxStaleMs: 15 * MINUTE_MS }
);

// USD prices of the tokens routes take (SOL, USDC, USDT), from Jupiter's price API. For portfolio totals.
export const tokenPrices = cached(
  'token prices from Jupiter',
  async () => {
    const symbols = Object.keys(TOKENS) as (keyof typeof TOKENS)[];
    const response = await http.get(process.env.JUPITER_PRICE_API_URL || jupiterBase('price/v3'), {
      params: { ids: symbols.map((symbol) => TOKENS[symbol].mint).join(',') },
      headers: process.env.JUPITER_PRICE_API_URL ? undefined : jupiterHeaders(),
    });
    const prices = new Map<string, number>();
    for (const symbol of symbols) {
      const price = Number(response.data?.[TOKENS[symbol].mint]?.usdPrice);
      if (price > 0) prices.set(symbol, price);
    }
    return prices;
  },
  { ttlMs: MINUTE_MS, maxStaleMs: 15 * MINUTE_MS }
);

const YEAR_SECONDS = 365.25 * 24 * 60 * 60;

// How long an epoch takes, measured from recent slots rather than assumed
const epochTiming = cached(
  'epoch timing',
  async () => {
    const [epochInfo, samples] = await Promise.all([connection.getEpochInfo(), connection.getRecentPerformanceSamples(60)]);
    const slots = samples.reduce((sum, sample) => sum + sample.numSlots, 0);
    const seconds = samples.reduce((sum, sample) => sum + sample.samplePeriodSecs, 0);
    if (slots <= 0 || seconds <= 0) throw new Error('no slot timing');
    const epochSeconds = (epochInfo.slotsInEpoch * seconds) / slots;
    return { epochSeconds, epochsPerYear: YEAR_SECONDS / epochSeconds };
  },
  { ttlMs: MINUTE_MS, maxStaleMs: 60 * MINUTE_MS }
);

const windowLabel = (epochs: number) => (epochs === 1 ? 'the last epoch' : `the last ${epochs} epochs`);

// Stake pools whose protocol's app shows APY over several epochs, and how many
const POOL_EPOCHS = new Map(
  ROUTES.flatMap((route) => (route.source.kind === 'stake-pool' && route.source.epochs ? [[route.source.pool, route.source.epochs]] : []))
);
// Hermes's record of each pool's SOL per token by epoch, read every 10 minutes: values change once an epoch
const poolEpochHistory = cached('stake pool epochs', () => recentEpochValues(Math.max(SANCTUM_EPOCHS, ...POOL_EPOCHS.values())), {
  ttlMs: 10 * MINUTE_MS,
  maxStaleMs: 6 * 60 * MINUTE_MS,
});
const recordedEpochs = new Set<string>();

// Keyed by stake pool address. APY compounds the pool's own record of SOL per token at its latest update against an
// earlier epoch's: the last epoch's (kept on the pool account), or for pools whose app shows several epochs, the
// oldest within that many that Hermes has recorded. TVL is the SOL the pool holds.
const stakePoolRates = rateSource('stake pools on chain', async () => {
  const pools = [...new Set(ROUTES.flatMap((route) => (route.source.kind === 'stake-pool' ? [route.source.pool] : [])))];
  const [accounts, timing, price, history] = await Promise.all([
    connection.getMultipleAccountsInfo(pools.map((pool) => new PublicKey(pool))),
    epochTiming.get(),
    solPrice.get(),
    POOL_EPOCHS.size > 0 ? poolEpochHistory.get() : Promise.resolve(null),
  ]);
  if (!price) throw new Error('no SOL price');
  if (!timing) throw new Error('no epoch timing');

  const rates: RateMap = new Map();
  const toRecord: EpochValue[] = [];
  const now = Date.now();
  accounts.forEach((account, i) => {
    if (!account) return;
    const pool = StakePoolLayout.decode(account.data);
    const lamports = Number(pool.totalLamports.toString());
    const current = lamports / Number(pool.poolTokenSupply.toString());
    const previous = Number(pool.lastEpochTotalLamports.toString()) / Number(pool.lastEpochPoolTokenSupply.toString());
    if (!(current > 0) || !(previous > 0) || !Number.isFinite(current) || !Number.isFinite(previous)) return;
    // The pool's last update set `current` for this epoch and kept the one before it as `previous`
    const epoch = Number(pool.lastUpdateEpoch.toString());
    for (const row of [
      { pool: pools[i], epoch, value: current },
      { pool: pools[i], epoch: epoch - 1, value: previous },
    ]) {
      if (!recordedEpochs.has(`${row.pool}:${row.epoch}`)) toRecord.push(row);
    }

    let from = { epoch: epoch - 1, value: previous };
    const window = POOL_EPOCHS.get(pools[i]) ?? 1;
    const recorded = history?.get(pools[i]);
    for (let past = epoch - window; past < epoch - 1 && recorded; past++) {
      const value = recorded.get(past);
      if (value && value > 0) {
        from = { epoch: past, value };
        break;
      }
    }
    const epochs = epoch - from.epoch;
    rates.set(pools[i], {
      apy: Math.pow(current / from.value, timing.epochsPerYear / epochs) - 1,
      apyWindow: windowLabel(epochs),
      tvl: (lamports / 1e9) * price,
      deposits: lamports / 1e9,
      tokenValue: current,
      updatedAt: now,
    });
  });

  // Kept in the background: a failed write is tried again on the next read
  if (toRecord.length > 0) {
    void recordEpochValues(toRecord).then((ok) => {
      if (ok) for (const row of toRecord) recordedEpochs.add(`${row.pool}:${row.epoch}`);
    });
  }
  return rates;
});

// Marinade's liquid staking program, whose rolling APY Marinade's app shows for mSOL
const MARINADE_LIQUID_PROGRAM = 'MarBmsSgKXdrN1egZf5sqe1TMai9K1rChYNDJgjq7aD';
const FOURTEEN_DAYS_S = 14 * 24 * 60 * 60;

// Keyed "marinade": mSOL's APY and the SOL staked through mSOL. Marinade's app shows mSOL's APY over 14 days ("APY (14D
// avg)"): the latest point of its rolling APY, taken about once a day. Hermes reads that same point, so the two match.
// Marinade's API gives mSOL's SOL value now, and its own 14-day APY if the rolling one can't be read.
const marinadeRates = rateSource(
  'Marinade',
  async () => {
    const base = process.env.MARINADE_API_URL || 'https://api.marinade.finance';
    const apyBase = process.env.MARINADE_APY_URL || 'https://apy.marinade.finance';
    const to = Math.floor(Date.now() / 1000);
    const [apy, tlv, rolling] = await Promise.all([
      http.get(`${base}/msol/apy/14d`),
      http.get(`${base}/tlv`),
      http
        .get(`${apyBase}/v1/rolling-apy/liquid-pool-token/${MARINADE_LIQUID_PROGRAM}`, {
          params: { window: FOURTEEN_DAYS_S, from: to - 3 * 24 * 60 * 60, to },
        })
        .catch(() => null),
    ]);
    const values: unknown[] = Array.isArray(rolling?.data?.values) ? rolling!.data.values : [];
    const latest = Number(values[values.length - 1]);
    const value = Number.isFinite(latest) && latest > 0 && latest < 1 ? latest : Number(apy.data?.value);
    const tvl = Number(tlv.data?.staked_usd);
    if (!Number.isFinite(value) || !(tvl > 0)) throw new Error('unexpected Marinade response');
    const deposits = Number(tlv.data?.staked_sol);
    const tokenValue = Number(apy.data?.end_price);
    return new Map([
      [
        'marinade',
        {
          apy: value,
          apyWindow: '14 days',
          tvl,
          deposits: deposits > 0 ? deposits : undefined,
          tokenValue: tokenValue > 0 ? tokenValue : undefined,
          updatedAt: Date.now(),
        },
      ],
    ]);
  },
  5 * MINUTE_MS
);

const INFINITY_PROGRAM = new PublicKey('5ocnV1qiCgaQR8Jb8xWnVbApfaygJ8tNoZfgPwsgx9kx');
const [INFINITY_STATE] = PublicKey.findProgramAddressSync([Buffer.from('state')], INFINITY_PROGRAM);
// Pool state layout: total SOL value (u64) first, the INF mint at byte 144
const INFINITY_MINT_OFFSET = 144;
const DAY_MS = 24 * 60 * MINUTE_MS;
const INFINITY_ROUTE = ROUTES.find((route) => route.source.kind === 'infinity');

// INF's SOL value 10 epochs ago, the window Sanctum's app shows, from Hermes's history: the oldest reading while history
// is shorter, at least a day old. Checked every 30 minutes.
const infinityPastValue = cached(
  'INF value history',
  async () => {
    const timing = await epochTiming.get();
    if (!INFINITY_ROUTE || !timing) return null;
    const target = new Date(Date.now() - SANCTUM_EPOCHS * timing.epochSeconds * 1000);
    return tokenValueNear(INFINITY_ROUTE.id, target, new Date(Date.now() - DAY_MS));
  },
  { ttlMs: 30 * MINUTE_MS, maxStaleMs: 6 * 60 * MINUTE_MS }
);

// Keyed "infinity". TVL is the SOL value Sanctum Infinity's pool records on chain. APY compounds INF's SOL value
// against Hermes's own reading from 10 epochs ago (Sanctum's window), or its oldest while history is shorter. Until that
// history is a day old, DefiLlama's APY stands in.
const infinityRates = rateSource('Sanctum Infinity on chain', async () => {
  const [state, price] = await Promise.all([connection.getAccountInfo(INFINITY_STATE), solPrice.get()]);
  if (!state || state.data.length < INFINITY_MINT_OFFSET + 32) throw new Error('no Infinity pool state');
  if (!price) throw new Error('no SOL price');
  // Supply from the mint account itself (u64 at byte 36, decimals at byte 44): public RPCs refuse getTokenSupply
  const mint = await connection.getAccountInfo(new PublicKey(state.data.subarray(INFINITY_MINT_OFFSET, INFINITY_MINT_OFFSET + 32)));
  if (!mint || mint.data.length < 45) throw new Error('no INF mint');
  const supply = Number(mint.data.readBigUInt64LE(36)) / 10 ** mint.data[44];
  const solValue = Number(state.data.readBigUInt64LE(0)) / 1e9;
  if (!(solValue > 0) || !(supply > 0)) throw new Error('empty Infinity pool');
  const tokenValue = solValue / supply;

  const [past, timing] = await Promise.all([infinityPastValue.get(), epochTiming.get()]);
  let apy: number | undefined;
  let source: string | undefined;
  let apyWindow: string | undefined;
  if (past && past.value > 0 && Date.now() - past.at >= DAY_MS) {
    apy = Math.pow(tokenValue / past.value, (365.25 * DAY_MS) / (Date.now() - past.at)) - 1;
    const epochs = timing ? Math.round((Date.now() - past.at) / 1000 / timing.epochSeconds) : 0;
    apyWindow = epochs >= 1 ? windowLabel(epochs) : `${Math.round((Date.now() - past.at) / DAY_MS)} days`;
  } else {
    apy = (await defillamaRates.get())?.get('sanctum-infinity:INF')?.apy;
    source = 'DefiLlama';
  }
  if (apy === undefined || !Number.isFinite(apy)) return new Map();
  return new Map([['infinity', { apy, apyWindow, tvl: solValue * price, deposits: solValue, tokenValue, source, updatedAt: Date.now() }]]);
});

// Keyed by `${project}:${symbol}`. The pools list is ~10 MB, only Solana pools are kept. Only INF's APY uses it, until Hermes has a day of history.
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
    rates.set(reserve.reserve, { apy, tvl, utilization, withdrawable, deposits: supply > 0 ? supply : undefined, updatedAt: now });
  }
  return rates;
});

const KAMINO_LEND_PROGRAM_ID = new PublicKey('KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD');
// Kamino Lend reserve account: the liquidity mint at byte 128, the liquidity it can pay out right now (u64) at byte 224
const RESERVE_MINT_OFFSET = 128;
const RESERVE_AVAILABLE_OFFSET = 224;

interface VaultReserve {
  reserve: string;
  market: string;
  supplied: number; // tokens the vault has lent to the reserve
  suppliedUsd: number;
}

// Supply APY of each reserve in a Kamino Lend market
async function marketSupplyApys(kaminoApi: string, market: string): Promise<Map<string, number>> {
  const { data } = await http.get(`${kaminoApi}/kamino-market/${market}/reserves/metrics`, { params: { env: 'mainnet-beta' } });
  return new Map((Array.isArray(data) ? data : []).map((reserve: any): [string, number] => [String(reserve.reserve), Number(reserve.supplyApy)]));
}

async function kaminoVaultRate(vault: string): Promise<Rate> {
  const kaminoApi = process.env.KAMINO_API_URL || 'https://api.kamino.finance';
  const [{ data: allocation }, { data: info }] = await Promise.all([
    http.get(`${kaminoApi}/kvaults/vaults/${vault}/allocations`),
    http.get(`${kaminoApi}/kvaults/vaults/${vault}`),
  ]);
  const state = info?.state;
  const decimals = Number(state?.tokenMintDecimals);
  const shareDecimals = Number(state?.sharesMintDecimals);
  const performanceFee = Number(state?.performanceFeeBps) / 10_000;
  const managementFee = Number(state?.managementFeeBps) / 10_000;
  const idle = Number(allocation?.unallocated?.tokenAmount);
  const idleUsd = Number(allocation?.unallocated?.usd);
  const reserves: VaultReserve[] = (Array.isArray(allocation?.allocations) ? allocation.allocations : [])
    .map((a: any) => ({
      reserve: String(a.reserve),
      market: String(a.market),
      supplied: Number(a.suppliedTokenAmount),
      suppliedUsd: Number(a.suppliedUsd),
    }))
    .filter((r: VaultReserve) => r.supplied > 0);
  const numbers = [decimals, shareDecimals, performanceFee, managementFee, idle, idleUsd, ...reserves.map((r) => r.suppliedUsd)];
  if (!state?.tokenMint || reserves.length === 0 || numbers.some((n) => !Number.isFinite(n))) throw new Error(`unexpected Kamino vault response for ${vault}`);

  // Each reserve's rate from its market, the way Kamino Lend's routes read theirs. The allocations answer carries
  // rates too, but at times repeats one reserve's rate for all of them.
  const markets = await Promise.all([...new Set(reserves.map((r) => r.market))].map((market) => marketSupplyApys(kaminoApi, market)));
  const supplyApy = (reserve: string): number => {
    const apy = markets.map((market) => market.get(reserve)).find((value) => value !== undefined);
    if (apy === undefined || !Number.isFinite(apy)) throw new Error(`no rate for vault reserve ${reserve}`);
    return apy;
  };

  // What each reserve can pay out right now, on chain. Free RPCs cap a multiple-account read at 10.
  const keys = reserves.map((r) => new PublicKey(r.reserve));
  const accounts = [];
  for (let i = 0; i < keys.length; i += 10) accounts.push(...(await connection.getMultipleAccountsInfo(keys.slice(i, i + 10))));
  let withdrawable = idle;
  accounts.forEach((account, i) => {
    if (!account?.owner.equals(KAMINO_LEND_PROGRAM_ID) || account.data.length < RESERVE_AVAILABLE_OFFSET + 8) throw new Error('vault reserve not found');
    const mint = new PublicKey(account.data.subarray(RESERVE_MINT_OFFSET, RESERVE_MINT_OFFSET + 32));
    if (mint.toBase58() !== state.tokenMint) throw new Error('unexpected reserve layout');
    const available = Number(account.data.readBigUInt64LE(RESERVE_AVAILABLE_OFFSET)) / 10 ** decimals;
    withdrawable += Math.min(reserves[i].supplied, available);
  });

  const deposits = idle + reserves.reduce((sum, r) => sum + r.supplied, 0);
  // Each reserve's supply APY by its share of the vault, unlent tokens earning nothing, as continuous rates, after the
  // vault's fees: how Kamino computes its vault APY. Kamino's own figure lags by up to an hour, so Hermes works it out.
  const rate = reserves.reduce((sum, r) => sum + (r.supplied / deposits) * Math.log1p(supplyApy(r.reserve)), 0);
  // What one share is worth: the vault's tokens less fees it owes, over the shares issued
  const pendingFees = Number(state.pendingFees) / 10 ** decimals;
  const shares = Number(state.sharesIssued) / 10 ** shareDecimals;
  const tokenValue = shares > 0 && Number.isFinite(pendingFees) ? (deposits - pendingFees) / shares : undefined;
  return {
    apy: Math.expm1(rate * (1 - performanceFee) - managementFee),
    tvl: idleUsd + reserves.reduce((sum, r) => sum + r.suppliedUsd, 0),
    withdrawable: deposits > 0 ? Math.min(1, withdrawable / deposits) : undefined,
    deposits,
    tokenValue: tokenValue && tokenValue > 0 ? tokenValue : undefined,
    updatedAt: Date.now(),
  };
}

// Keyed by vault address. TVL and deposits are what the vault has lent out plus what it holds unlent. Withdrawable
// is what it holds unlent, plus from each reserve the smaller of what the vault lent there and what the reserve can
// pay out right now.
const kaminoVaultRates = rateSource('Kamino vaults', async () => {
  const vaults = [...new Set(ROUTES.flatMap((route) => (route.source.kind === 'kamino-vault' ? [route.source.vault] : [])))];
  return new Map(await Promise.all(vaults.map(async (vault) => [vault, await kaminoVaultRate(vault)] as const)));
});

// Keyed by bank address. Each Project 0 bank's account on chain: deposits and borrows from its shares, the lending APR
// the bank cached at its last update (what lenders earn at today's borrowing), and the oracle price it last used for
// TVL. Jupiter's price stands in when the bank hasn't read its oracle for a day.
const project0Rates = rateSource('Project 0 on chain', async () => {
  const routes = ROUTES.filter((route) => route.source.kind === 'project0');
  const banks = routes.map((route) => (route.source.kind === 'project0' ? route.source.bank : ''));
  const infos = await connection.getMultipleAccountsInfo(banks.map((bank) => new PublicKey(bank)));
  const rates: RateMap = new Map();
  const now = Date.now();
  for (const [i, info] of infos.entries()) {
    const route = routes[i];
    if (!info) continue;
    const bank = readBank(info.owner, info.data, PROJECT0_GROUP);
    if (bank.mint !== TOKENS[route.token].mint || !bank.deposits.gt(0)) continue;
    const price = bank.price > 0 && now - bank.priceAt < DAY_MS ? bank.price : (await tokenPrices.get())?.get(route.token);
    if (!price) continue;
    const deposits = bank.deposits.toNumber();
    const utilization = Math.min(1, bank.borrowed.div(bank.deposits).toNumber());
    rates.set(banks[i], {
      // The APR compounds as interest accrues into the share value
      apy: Math.expm1(bank.lendingApr),
      tvl: deposits * price,
      utilization,
      withdrawable: Math.max(0, 1 - utilization),
      deposits,
      updatedAt: now,
    });
  }
  return rates;
});

// Keyed by token mint
const jupiterLendRates = rateSource('Jupiter Lend', async () => {
  const response = await http.get(`${process.env.JUPITER_LEND_API_URL || jupiterBase('lend/v1')}/earn/tokens`, {
    headers: process.env.JUPITER_LEND_API_URL ? undefined : jupiterHeaders(),
  });
  const tokens: any[] = Array.isArray(response.data) ? response.data : [];
  const rates: RateMap = new Map();
  const now = Date.now();

  for (const token of tokens) {
    // Supply rate plus rewards, as an APR in basis points. Jupiter's app compounds it into the APY it shows (5.26% shows
    // as 5.4%), and so does Hermes.
    const rateBps = Number(token.totalRate);
    const decimals = Number(token.asset?.decimals);
    const price = Number(token.asset?.price);
    if (!Number.isFinite(rateBps) || !Number.isFinite(decimals) || !Number.isFinite(price)) continue;
    const tvl = (Number(token.totalAssets) / 10 ** decimals) * price;
    // What can leave right now: limited by the liquidity not lent out and by Jupiter Lend's withdrawal limit
    const supplied = Number(token.liquiditySupplyData?.supply);
    const withdrawableNow = Number(token.liquiditySupplyData?.withdrawable);
    const withdrawable = supplied > 0 && Number.isFinite(withdrawableNow) ? Math.min(1, withdrawableNow / supplied) : undefined;
    const deposits = Number(token.totalAssets) / 10 ** decimals;
    rates.set(token.assetAddress, { apy: Math.expm1(rateBps / 10_000), tvl, withdrawable, deposits, updatedAt: now });
  }
  return rates;
});

export const SOURCE_LABELS: Record<RateSource['kind'], string> = {
  'stake-pool': 'On-chain',
  infinity: 'On-chain',
  marinade: 'Marinade',
  defillama: 'DefiLlama',
  kamino: 'Kamino',
  'kamino-vault': 'Kamino',
  project0: 'On-chain',
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
    case 'infinity':
      return (await infinityRates.get())?.get('infinity');
    case 'defillama':
      return (await defillamaRates.get())?.get(`${source.project}:${source.symbol}`);
    case 'kamino':
      return (await kaminoRates.get())?.get(source.reserve);
    case 'kamino-vault':
      return (await kaminoVaultRates.get())?.get(source.vault);
    case 'project0':
      return (await project0Rates.get())?.get(source.bank);
    case 'jupiter-lend':
      return (await jupiterLendRates.get())?.get(source.mint);
  }
}

/**
 * Fetch every source whose cache is due, so requests hit a warm cache
 */
export async function refreshRates(): Promise<void> {
  await Promise.all([stakePoolRates, infinityRates, marinadeRates, kaminoRates, kaminoVaultRates, project0Rates, jupiterLendRates].map((source) => source.get()));
}
