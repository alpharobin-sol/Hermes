import Decimal from 'decimal.js';
import { solanaNetwork } from '../config/runtime';
import { depositStatus, InputToken, ROUTES, RouteConfig, TOKENS } from '../registry/routes';
import { logger } from '../utils/logger';
import depositService, { DepositError, DepositQuote } from './deposit';
import { getRate } from './rates';

/**
 * LIVE ROUTE QUOTES
 * One amount quoted across a token's routes at once, the way a swap aggregator compares venues.
 *
 * Jupiter limits requests per IP, and Render's IP is shared with other apps, so a burst of swap quotes from the API
 * gets refused. The API quotes what doesn't need Jupiter's swap API (Jito's stake pool, Marinade, Kamino Lend,
 * Jupiter Lend's share rate) and hands back a swap to quote for routes that go through Jupiter, which the
 * visitor's browser quotes itself, on its own IP's allowance. The site keeps whichever gives more of the token,
 * the way the deposit does.
 *
 * Each answer carries the token's SOL value in its pool (liquid staking), so the site can show what the deposit
 * is worth right after, the entry cost, and the earnings after it. Lending is worth the amount itself.
 * Answers are reused for 15 seconds per route and amount.
 */

export interface SwapToQuote {
  inputMint: string;
  inputDecimals: number;
  outputMint: string;
  outputSymbol: string;
  outputDecimals: number;
  rawAmount: string; // input in base units
}

export interface RouteQuote {
  routeId: string;
  quote: DepositQuote | null; // the direct deposit, when the route has one
  swap: SwapToQuote | null; // a Jupiter swap for the browser to quote
  tokenValue: number | null; // liquid staking: SOL per token in the pool
  value: string | null; // worth of the direct quote's output, in the input token
  entryCost: number | null; // the direct quote's entry cost. Negative: the deposit is worth more than went in
  error: string | null; // why this route can't be deposited into for this amount
}

const TTL_MS = 15_000;
const TIMEOUT_MS = 10_000;
const MAX_ROUTES = 12;
const cache = new Map<string, { at: number; result: Promise<RouteQuote> }>();

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new DepositError('The quote took too long. It will retry.', 504)), ms)),
  ]);
}

function swapToQuote(route: RouteConfig, amount: string): SwapToQuote | null {
  if (solanaNetwork() !== 'mainnet-beta' || !route.receipt) return null;
  const input = TOKENS[route.token];
  return {
    inputMint: input.mint,
    inputDecimals: input.decimals,
    outputMint: route.receipt.mint,
    outputSymbol: route.receipt.symbol,
    outputDecimals: route.receipt.decimals,
    rawAmount: new Decimal(amount).mul(new Decimal(10).pow(input.decimals)).floor().toFixed(0),
  };
}

async function quoteRoute(route: RouteConfig, amount: string): Promise<RouteQuote> {
  const empty = { routeId: route.id, quote: null, swap: null, tokenValue: null, value: null, entryCost: null };
  try {
    // Unknown route, deposits off or over the beta cap: no quote at all
    depositService.checkRoute({ routeId: route.id, amount });

    const tokenValue = route.category === 'liquid-staking' ? (await getRate(route.source))?.tokenValue ?? null : null;
    const swap = swapToQuote(route, amount);

    let quote: DepositQuote | null = null;
    let directError: unknown = null;
    if (depositService.hasDirect(route)) {
      try {
        quote = await withTimeout(depositService.getQuote({ routeId: route.id, amount }, { swap: false }), TIMEOUT_MS);
      } catch (error) {
        directError = error;
      }
    }
    // Neither path: the direct quote's error is the route's
    if (!quote && !swap) throw directError ?? new DepositError('No deposit path right now.');

    let value: Decimal | null = null;
    if (quote) {
      if (route.category === 'lending') value = new Decimal(quote.inAmount);
      else if (tokenValue) value = new Decimal(quote.outAmount).mul(tokenValue);
    }
    const entryCost = value && quote ? new Decimal(1).minus(value.div(quote.inAmount)).toNumber() : null;
    return { ...empty, quote, swap, tokenValue, value: value?.toFixed() ?? null, entryCost, error: null };
  } catch (error) {
    if (!(error instanceof DepositError)) logger.info(`Live quote failed for ${route.id}: ${error instanceof Error ? error.message : error}`);
    return { ...empty, error: error instanceof DepositError ? error.message : 'No quote right now. It will retry.' };
  }
}

/**
 * Quote `amount` of `token` on each of the token's routes Hermes deposits into, or on `routeIds` among them
 */
export async function quoteRoutes(token: InputToken, amount: string, routeIds?: string[]): Promise<RouteQuote[]> {
  const network = solanaNetwork();
  const wanted = routeIds ? new Set(routeIds) : null;
  const routes = ROUTES.filter(
    (route) => route.token === token && depositStatus(route, network) !== null && (!wanted || wanted.has(route.id))
  ).slice(0, MAX_ROUTES);

  const now = Date.now();
  for (const [key, entry] of cache) if (now - entry.at > TTL_MS) cache.delete(key);

  return Promise.all(
    routes.map((route) => {
      const key = `${route.id}:${amount}`;
      let entry = cache.get(key);
      if (!entry) {
        entry = { at: now, result: quoteRoute(route, amount) };
        cache.set(key, entry);
      }
      return entry.result;
    })
  );
}
