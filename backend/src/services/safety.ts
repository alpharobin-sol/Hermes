import { solanaNetwork } from '../config/runtime';
import { depositStatus, KAMINO_MAIN_MARKET, ROUTES, RouteConfig, TOKENS } from '../registry/routes';
import { cached, Cached } from './cache';
import { createJupiterClient } from './jupiter';
import { getRate, http, Rate, SOURCE_LABELS } from './rates';
import { depositHistory } from './history';

/**
 * SAFETY SCORE
 * 0 to 100 for each route: four parts worth 25 points each, all from live data.
 * - Size: money in the route now. $10M or less scores 0, $1B or more scores 25.
 * - Track record: how long the protocol has held deposits, from the first day DefiLlama recorded them (a fixed date
 *   in the registry). 4 years or more scores 25.
 * - Outflows: the largest fall in deposits within the last 30 days, counted in the deposit token so price
 *   moves don't count. 10% or less scores 25, 40% or more scores 0.
 * - Exit: how easily money gets out today.
 *   Lending: the share of deposits that can't be withdrawn right now (borrowed, or held back by a withdrawal limit).
 *   90% or less scores 25, 100% scores 0.
 *   Liquid staking: the price impact of selling 10,000 of the token for SOL on Jupiter. 1% or less scores 25, 5% or more 0.
 * It does not measure smart contract or depeg risk. A route with any part missing has no score.
 */

export type SafetyPartKey = 'size' | 'track-record' | 'outflows' | 'exit';

export interface SafetyPart {
  key: SafetyPartKey;
  label: string;
  points: number;
  max: number;
  detail: string; // what was measured, in plain words
  source: string;
}

export interface SafetyScore {
  score: number; // sum of the parts' points, 0 to 100
  parts: SafetyPart[];
}

const PART_MAX = 25;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const OUTFLOW_WINDOW_MS = 30 * DAY_MS;
// Liquid staking exit: how much of the token the price impact check sells
const EXIT_SAMPLE = 10_000;

// Points from 0 at `zero` to PART_MAX at `full`, linear between. `full` can be below `zero`.
function points(value: number, zero: number, full: number): number {
  const share = (value - zero) / (full - zero);
  return Math.round(Math.min(1, Math.max(0, share)) * PART_MAX);
}

function formatUsd(value: number): string {
  if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(value >= 1e8 ? 0 : 1)}M`;
  if (value >= 1e3) return `$${Math.round(value / 1e3)}K`;
  return `$${Math.round(value)}`;
}

function formatPercent(share: number, digits = 0): string {
  return `${(share * 100).toFixed(digits)}%`;
}

function monthYear(ms: number): string {
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

// Largest peak-to-trough fall in a series, as a share of the peak
function largestFall(series: number[]): number {
  let peak = 0;
  let fall = 0;
  for (const value of series) {
    peak = Math.max(peak, value);
    if (peak > 0) fall = Math.max(fall, (peak - value) / peak);
  }
  return fall;
}

// Outflows: the largest fall in deposits within the window, in the deposit token

interface Outflow {
  fall: number; // share of the peak
  days: number; // daily points the window had
  source: string;
}

// SOL price every 3 hours over the window, to count USD deposits in SOL
const solPrices = cached(
  'SOL price history',
  async () => {
    const start = Math.floor((Date.now() - OUTFLOW_WINDOW_MS - DAY_MS) / 1000);
    const response = await http.get('https://coins.llama.fi/chart/coingecko:solana', {
      params: { start, span: 256, period: '3h' },
    });
    const prices: any[] = response.data?.coins?.['coingecko:solana']?.prices ?? [];
    const series = prices
      .map((point) => ({ at: Number(point.timestamp) * 1000, price: Number(point.price) }))
      .filter((point) => Number.isFinite(point.at) && point.price > 0);
    if (series.length === 0) throw new Error('no prices');
    return series;
  },
  { ttlMs: 3 * HOUR_MS, maxStaleMs: DAY_MS }
);

// The price closest in time, if one is within 6 hours
function priceAt(prices: { at: number; price: number }[], at: number): number | undefined {
  let best: { at: number; price: number } | undefined;
  for (const point of prices) {
    if (!best || Math.abs(point.at - at) < Math.abs(best.at - at)) best = point;
  }
  return best && Math.abs(best.at - at) <= 6 * HOUR_MS ? best.price : undefined;
}

// A daily series needs at least two weeks of the window to say anything about it. Sources can have gaps.
const MIN_POINTS = 14;

async function defillamaOutflow(route: RouteConfig): Promise<Outflow> {
  const pool = route.defillamaPool ?? (await getRate(route.source))?.defillamaPool;
  if (!pool) throw new Error('no DefiLlama pool');

  const response = await http.get(`https://yields.llama.fi/chart/${pool}`);
  const since = Date.now() - OUTFLOW_WINDOW_MS;
  const history = (Array.isArray(response.data?.data) ? response.data.data : [])
    .map((point: any) => ({ at: Date.parse(point.timestamp), tvl: Number(point.tvlUsd) }))
    .filter((point: { at: number; tvl: number }) => point.at >= since && point.tvl > 0);

  let series: number[];
  if (route.token === 'SOL') {
    const prices = await solPrices.get();
    if (!prices) throw new Error('no SOL prices');
    series = history
      .map((point: { at: number; tvl: number }) => {
        const price = priceAt(prices, point.at);
        return price ? point.tvl / price : undefined;
      })
      .filter((value: number | undefined): value is number => value !== undefined);
  } else {
    // Stablecoins: USD is the token
    series = history.map((point: { tvl: number }) => point.tvl);
  }

  if (series.length < MIN_POINTS) throw new Error(`only ${series.length} days of history`);
  return { fall: largestFall(series), days: series.length, source: 'DefiLlama' };
}

async function kaminoOutflow(reserve: string): Promise<Outflow> {
  const kaminoApi = process.env.KAMINO_API_URL || 'https://api.kamino.finance';
  const end = new Date();
  const start = new Date(end.getTime() - OUTFLOW_WINDOW_MS);
  const response = await http.get(`${kaminoApi}/kamino-market/${KAMINO_MAIN_MARKET}/reserves/${reserve}/metrics/history`, {
    params: { env: 'mainnet-beta', start: start.toISOString(), end: end.toISOString(), frequency: 'day' },
  });
  // totalSupply is in tokens, so price moves don't count
  const series = (Array.isArray(response.data?.history) ? response.data.history : [])
    .map((point: any) => Number(point?.metrics?.totalSupply))
    .filter((value: number) => Number.isFinite(value) && value > 0);

  if (series.length < MIN_POINTS) throw new Error(`only ${series.length} days of history`);
  return { fall: largestFall(series), days: series.length, source: 'Kamino' };
}

// Hermes's own history, once it covers at least two weeks of the window. Deposits are recorded in the route's
// token, so price moves don't count.
async function hermesOutflow(route: RouteConfig): Promise<Outflow | null> {
  const since = Date.now() - OUTFLOW_WINDOW_MS;
  const points = await depositHistory(route.id, new Date(since));
  if (!points || points.length === 0 || Date.now() - points[0].at < MIN_POINTS * DAY_MS) return null;
  const days = new Set(points.map((point) => Math.floor(point.at / DAY_MS))).size;
  return { fall: largestFall(points.map((point) => point.value)), days, source: 'Hermes history' };
}

const outflowCaches = new Map<string, Cached<Outflow>>();

// Undefined for routes with no deposit history source
function outflows(route: RouteConfig): Cached<Outflow> | undefined {
  const source = route.source;
  if (source.kind === 'jupiter-lend' && !route.defillamaPool) return undefined;

  let entry = outflowCaches.get(route.id);
  if (!entry) {
    const fallback = source.kind === 'kamino' ? () => kaminoOutflow(source.reserve) : () => defillamaOutflow(route);
    const fetcher = async () => (await hermesOutflow(route)) ?? fallback();
    entry = cached(`deposit history for ${route.id}`, fetcher, {
      ttlMs: HOUR_MS,
      maxStaleMs: DAY_MS,
      retryAfterMs: 10 * 60 * 1000,
    });
    outflowCaches.set(route.id, entry);
  }
  return entry;
}

// Exit for liquid staking: price impact of selling EXIT_SAMPLE of the token for SOL on Jupiter

const jupiter = createJupiterClient();
const exitImpacts = new Map<string, Cached<number>>();

function swapExit(route: RouteConfig): Cached<number> | undefined {
  const receipt = route.receipt;
  if (route.category !== 'liquid-staking' || !receipt) return undefined;

  let entry = exitImpacts.get(route.id);
  if (!entry) {
    entry = cached(
      `exit price impact for ${route.id}`,
      async () => {
        const response = await jupiter.get('/quote', {
          params: {
            inputMint: receipt.mint,
            outputMint: TOKENS.SOL.mint,
            amount: (BigInt(EXIT_SAMPLE) * 10n ** BigInt(receipt.decimals)).toString(),
            slippageBps: 50,
          },
        });
        const impact = Math.abs(Number(response.data?.priceImpactPct));
        if (!Number.isFinite(impact)) throw new Error('no price impact in quote');
        return impact;
      },
      { ttlMs: 30 * 60 * 1000, maxStaleMs: 3 * HOUR_MS, retryAfterMs: 5 * 60 * 1000 }
    );
    exitImpacts.set(route.id, entry);
  }
  return entry;
}

function exitPart(route: RouteConfig, rate: Rate): SafetyPart | undefined {
  const base = { key: 'exit' as const, label: 'Exit', max: PART_MAX };

  if (route.category === 'lending') {
    if (rate.utilization !== undefined) {
      const borrowed = Math.min(1, rate.utilization);
      return {
        ...base,
        points: points(borrowed, 1, 0.9),
        detail: `${formatPercent(borrowed)} of the reserve is borrowed. ${formatUsd(rate.tvl * (1 - borrowed))} can be withdrawn now.`,
        source: SOURCE_LABELS[route.source.kind],
      };
    }
    // Sources that report what can leave now rather than what is borrowed (Jupiter Lend)
    if (rate.withdrawable === undefined) return undefined;
    return {
      ...base,
      points: points(1 - rate.withdrawable, 1, 0.9),
      detail: `${formatPercent(rate.withdrawable)} of deposits (${formatUsd(rate.tvl * rate.withdrawable)}) can be withdrawn now. The rest is lent out or held back by ${route.name}'s withdrawal limit.`,
      source: SOURCE_LABELS[route.source.kind],
    };
  }

  const impact = swapExit(route)?.peek();
  if (impact === undefined || !route.receipt) return undefined;
  return {
    ...base,
    points: points(impact, 0.05, 0.01),
    detail: `Selling ${EXIT_SAMPLE.toLocaleString('en-US')} ${route.receipt.symbol} for SOL moves the price ${
      impact < 0.0001 ? 'less than 0.01%' : formatPercent(impact, 2)
    }.`,
    source: 'Jupiter',
  };
}

/**
 * The route's Safety Score from its live rate and the cached history, or null while any part is missing.
 * Never fetches: refreshSafetyInputs keeps the history warm.
 */
export function safetyScore(route: RouteConfig, rate: Rate): SafetyScore | null {
  const trackedSince = Date.parse(route.trackedSince);
  const outflow = outflows(route)?.peek();
  const exit = exitPart(route, rate);
  if (!Number.isFinite(trackedSince) || !outflow || !exit) return null;

  const years = (Date.now() - trackedSince) / (365 * DAY_MS);
  const unit = route.token;

  const parts: SafetyPart[] = [
    {
      key: 'size',
      label: 'Size',
      points: points(Math.log10(Math.max(rate.tvl, 1)), 7, 9),
      max: PART_MAX,
      detail: `${formatUsd(rate.tvl)} deposited.`,
      source: SOURCE_LABELS[route.source.kind],
    },
    {
      key: 'track-record',
      label: 'Track record',
      points: points(years, 0, 4),
      max: PART_MAX,
      detail: `Deposits tracked since ${monthYear(trackedSince)}.`,
      source: "DefiLlama's first record",
    },
    {
      key: 'outflows',
      label: 'Outflows',
      points: points(outflow.fall, 0.4, 0.1),
      max: PART_MAX,
      detail: `${
        outflow.fall < 0.01 ? 'Deposits fell less than 1%' : `Deposits fell at most ${formatPercent(outflow.fall)}`
      } in the last 30 days${outflow.days < 28 ? ` (${outflow.days} days of data)` : ''}, counted in ${unit}.`,
      source: outflow.source,
    },
    exit,
  ];

  return { score: parts.reduce((sum, part) => sum + part.points, 0), parts };
}

let refreshing: Promise<void> | null = null;

/**
 * Fetch the history behind the scores where it is due, so requests never wait on it.
 * Each kind of input runs one fetch at a time.
 * Routes Hermes deposits into go first.
 */
export function refreshSafetyInputs(): Promise<void> {
  if (refreshing) return refreshing;

  const network = solanaNetwork();
  const hasDeposit = (route: RouteConfig) => Number(depositStatus(route, network) !== null);
  const routes = [...ROUTES].sort((a, b) => hasDeposit(b) - hasDeposit(a));

  const inSequence = async <T>(items: T[], fetch: (item: T) => Promise<unknown> | undefined) => {
    for (const item of items) await fetch(item);
  };

  refreshing = Promise.all([
    inSequence(routes, (route) => outflows(route)?.get()),
    inSequence(routes, (route) => swapExit(route)?.get()),
  ])
    .then(() => undefined)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}
