import { PublicKey } from '@solana/web3.js';
import { StakePoolLayout, ValidatorListLayout } from '@solana/spl-stake-pool';
import { solanaNetwork } from '../config/runtime';
import { depositStatus, KAMINO_MAIN_MARKET, ROUTES, RouteConfig, TOKENS } from '../registry/routes';
import { cached, Cached } from './cache';
import { createJupiterClient } from './jupiter';
import { connection, getRate, http, Rate, SOURCE_LABELS } from './rates';
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
 *   Liquid staking: what selling 10,000 of the token for SOL on Jupiter returns, against the token's SOL value in its
 *   pool. That takes in both a depeg (the market price under the pool value) and price impact. 1% or less below the
 *   pool value scores 25, 5% or more 0.
 * Then deductions, shown with the parts:
 * - Validator spread (liquid staking): the largest validator's share of the stake, from the stake pool's validator list
 *   on chain (Marinade's through its SDK). 10% or less takes nothing, 50% or more takes 10 points.
 * - Incidents: hacks in DefiLlama's list under the protocol's or its team's names (the registry's `incidents`).
 *   In the last year: 25 points if the money was not returned, 5 if it was. One to three years ago: 5 if not returned.
 *   Older incidents are not shown.
 * The score never goes below 0. It does not measure smart contract risk or a sudden depeg. A route with any part
 * missing has no score.
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

// Points taken off the parts' sum. 0 when the check found nothing to take off, so the line still shows.
export interface SafetyDeduction {
  key: 'validator-spread' | 'incident';
  label: string;
  points: number; // 0 or less
  detail: string;
  source: string;
  link?: string;
}

export interface SafetyScore {
  score: number; // the parts' points less the deductions, 0 to 100
  parts: SafetyPart[];
  deductions: SafetyDeduction[];
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

// Exit for liquid staking: a Jupiter quote for selling EXIT_SAMPLE of the token for SOL

interface ExitQuote {
  outSol: number; // SOL the sale returns
  impact: number; // share the sale moves the price
}

const jupiter = createJupiterClient();
const exitQuotes = new Map<string, Cached<ExitQuote>>();

function swapExit(route: RouteConfig): Cached<ExitQuote> | undefined {
  const receipt = route.receipt;
  if (route.category !== 'liquid-staking' || !receipt) return undefined;

  let entry = exitQuotes.get(route.id);
  if (!entry) {
    entry = cached(
      `exit quote for ${route.id}`,
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
        const outSol = Number(response.data?.outAmount) / 10 ** TOKENS.SOL.decimals;
        if (!Number.isFinite(impact) || !(outSol > 0)) throw new Error('no amount or price impact in quote');
        return { outSol, impact };
      },
      { ttlMs: 30 * 60 * 1000, maxStaleMs: 3 * HOUR_MS, retryAfterMs: 5 * 60 * 1000 }
    );
    exitQuotes.set(route.id, entry);
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

  const quote = swapExit(route)?.peek();
  if (!quote || !route.receipt) return undefined;
  const sale = `Selling ${EXIT_SAMPLE.toLocaleString('en-US')} ${route.receipt.symbol} for SOL`;
  const small = (share: number) => (share < 0.0001 ? 'less than 0.01%' : formatPercent(share, 2));

  // Without the token's pool value, price impact alone
  if (!rate.tokenValue) {
    return { ...base, points: points(quote.impact, 0.05, 0.01), detail: `${sale} moves the price ${small(quote.impact)}.`, source: 'Jupiter' };
  }

  // Against the pool value, so a depeg counts as well as price impact. (Jupiter's price impact is measured from its
  // own reference price, so the loss isn't split into the two.)
  const loss = 1 - quote.outSol / (EXIT_SAMPLE * rate.tokenValue);
  const pool = route.source.kind === 'marinade' ? "Marinade's pool" : route.source.kind === 'infinity' ? 'the Infinity pool' : 'its stake pool';
  return {
    ...base,
    points: points(Math.max(0, loss), 0.05, 0.01),
    detail: `${sale} returns ${loss <= 0 ? 'at least its value' : `${small(loss)} less than its value`} in ${pool}.`,
    source: route.source.kind === 'marinade' ? "Jupiter, Marinade's API" : 'Jupiter, on chain',
  };
}

// Validator spread for liquid staking: how many validators hold the pool's stake and the largest one's share.
// Read from the stake pool's validator list on chain, or Marinade's validator records through its SDK.

interface Spread {
  validators: number;
  largest: number; // share of the stake with the largest validator
}

const spreads = new Map<string, Cached<Spread>>();

function spreadOf(stakes: number[]): Spread {
  const held = stakes.filter((stake) => stake > 0);
  const total = held.reduce((sum, stake) => sum + stake, 0);
  if (total <= 0) throw new Error('no validator stake');
  return { validators: held.length, largest: Math.max(...held) / total };
}

async function marinadeSpread(): Promise<Spread> {
  const { Marinade, MarinadeConfig } = await import('@marinade.finance/marinade-ts-sdk');
  const state = await new Marinade(new MarinadeConfig({ connection })).getMarinadeState();
  const { validatorRecords } = await state.getValidatorRecords();
  return spreadOf(validatorRecords.map((record) => Number(record.activeBalance.toString())));
}

function validatorSpread(route: RouteConfig): Cached<Spread> | undefined {
  const source = route.source;
  if (route.category !== 'liquid-staking' || (source.kind !== 'stake-pool' && source.kind !== 'marinade')) return undefined;

  let entry = spreads.get(route.id);
  if (!entry) {
    entry = cached(
      `validator spread for ${route.id}`,
      async () => {
        if (source.kind === 'marinade') return marinadeSpread();
        const poolAccount = await connection.getAccountInfo(new PublicKey(source.pool));
        if (!poolAccount) throw new Error('stake pool account not found');
        const pool = StakePoolLayout.decode(poolAccount.data);
        const listAccount = await connection.getAccountInfo(pool.validatorList);
        if (!listAccount) throw new Error('validator list not found');
        const list = ValidatorListLayout.decode(listAccount.data) as {
          validators: { activeStakeLamports: unknown; transientStakeLamports: unknown }[];
        };
        return spreadOf(list.validators.map((v) => Number(v.activeStakeLamports) + Number(v.transientStakeLamports)));
      },
      { ttlMs: 6 * HOUR_MS, maxStaleMs: 2 * DAY_MS, retryAfterMs: 15 * 60 * 1000 }
    );
    spreads.set(route.id, entry);
  }
  return entry;
}

const SPREAD_MAX_DEDUCTION = 10;

function spreadDeduction(route: RouteConfig): SafetyDeduction | undefined {
  const spread = validatorSpread(route)?.peek();
  if (!spread) return undefined;
  // The largest validator holding 10% or less takes nothing, 50% or more takes the full 10
  const share = Math.min(1, Math.max(0, (spread.largest - 0.1) / 0.4));
  return {
    key: 'validator-spread',
    label: 'Validator spread',
    points: -Math.round(share * SPREAD_MAX_DEDUCTION),
    detail:
      spread.validators === 1
        ? 'All the stake sits with one validator. If it goes down, rewards pause until it is back.'
        : `${spread.validators} validators hold the stake. The largest holds ${formatPercent(spread.largest)}.`,
    source: route.source.kind === 'marinade' ? "Marinade's validator records" : 'the stake pool on chain',
  };
}

// Incidents: DefiLlama's hacks list, matched by the names in the registry

interface Hack {
  name: string;
  date: number; // unix seconds
  amount: number | null;
  returnedFunds: number | null;
  technique: string | null;
  source: string | null;
}

const hacks = cached<Hack[]>(
  'DefiLlama hacks',
  async () => {
    const response = await http.get('https://api.llama.fi/hacks');
    if (!Array.isArray(response.data)) throw new Error('unexpected hacks response');
    return response.data;
  },
  { ttlMs: 6 * HOUR_MS, maxStaleMs: 7 * DAY_MS, retryAfterMs: 15 * 60 * 1000 }
);

const YEAR_MS = 365 * DAY_MS;

function incidentDeductions(route: RouteConfig): SafetyDeduction[] {
  const list = hacks.peek();
  if (!list) return [];
  const names = new Set(route.incidents.map((name) => name.toLowerCase()));
  return list
    .filter((hack) => names.has(String(hack.name).toLowerCase()) && Date.now() - hack.date * 1000 < 3 * YEAR_MS)
    .sort((a, b) => b.date - a.date)
    .map((hack) => {
      const age = Date.now() - hack.date * 1000;
      const returned = !!hack.amount && (hack.returnedFunds ?? 0) >= hack.amount * 0.9;
      const points = age < YEAR_MS ? (returned ? -5 : -25) : returned ? 0 : -5;
      const team = hack.name.toLowerCase() === route.name.toLowerCase() ? '' : ` (${route.name}'s team)`;
      const taken = hack.amount ? `${formatUsd(hack.amount)} taken` : 'Funds taken';
      const how = hack.technique ? ` through ${hack.technique.toLowerCase()}` : '';
      return {
        key: 'incident' as const,
        label: 'Incident',
        points,
        detail: `${hack.name}${team}, ${monthYear(hack.date * 1000)}: ${taken}${how}. ${returned ? 'Users were paid back.' : 'Not returned.'}`,
        source: "DefiLlama's hacks list",
        link: hack.source || 'https://defillama.com/hacks',
      };
    });
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

  const deductions = [spreadDeduction(route), ...incidentDeductions(route)].filter(
    (deduction): deduction is SafetyDeduction => !!deduction
  );
  const total = [...parts, ...deductions].reduce((sum, item) => sum + item.points, 0);
  return { score: Math.max(0, total), parts, deductions };
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
    inSequence(routes, (route) => validatorSpread(route)?.get()),
    hacks.get(),
  ])
    .then(() => undefined)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}
