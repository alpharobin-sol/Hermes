import Decimal from 'decimal.js';
import { solanaNetwork } from '../config/runtime';
import { depositStatus, InputToken, ROUTES } from '../registry/routes';
import { logger } from '../utils/logger';
import depositService, { DepositError, DepositQuote } from './deposit';
import { getRate } from './rates';

/**
 * LIVE ROUTE QUOTES
 * One amount quoted across a token's routes at once, the way a swap aggregator compares venues. Each quote is the
 * same one the deposit would be built from, plus what the deposit is worth right after, in the token the user put
 * in. The site shows the entry cost and the earnings after it from that.
 * - Liquid staking: tokens received times their SOL value in the pool (the rate source's tokenValue)
 * - Lending: the amount itself. Kamino holds it as a position, Jupiter Lend mints jl tokens at its share rate.
 * Answers are reused for 15 seconds per route and amount, so many viewers don't multiply calls to Jupiter.
 */

export interface RouteQuote {
  routeId: string;
  quote: DepositQuote | null;
  value: string | null; // worth of what lands, in the input token, right after the deposit
  entryCost: number | null; // share of the amount lost on entry (price impact, trading under value). Negative: gained
  error: string | null;
}

const TTL_MS = 15_000;
const TIMEOUT_MS = 12_000; // quotes wait their turn in the Jupiter queue
const MAX_ROUTES = 12;
const cache = new Map<string, { at: number; result: Promise<RouteQuote> }>();

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new DepositError('The quote took too long. It will retry.', 504)), ms)),
  ]);
}

async function quoteRoute(routeId: string, amount: string): Promise<RouteQuote> {
  const route = ROUTES.find((r) => r.id === routeId)!;
  try {
    const quote = await withTimeout(depositService.getQuote({ routeId, amount }), TIMEOUT_MS);
    let value: Decimal | null = null;
    if (route.category === 'lending') {
      value = quote.method === 'direct' ? new Decimal(quote.inAmount) : null;
    } else {
      const tokenValue = (await getRate(route.source))?.tokenValue;
      value = tokenValue ? new Decimal(quote.outAmount).mul(tokenValue) : null;
    }
    const entryCost = value ? new Decimal(1).minus(value.div(quote.inAmount)).toNumber() : null;
    return { routeId, quote, value: value?.toFixed() ?? null, entryCost, error: null };
  } catch (error) {
    if (!(error instanceof DepositError)) logger.info(`Live quote failed for ${routeId}: ${error instanceof Error ? error.message : error}`);
    return {
      routeId,
      quote: null,
      value: null,
      entryCost: null,
      error: error instanceof DepositError ? error.message : 'No quote right now. It will retry.',
    };
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
        entry = { at: now, result: quoteRoute(route.id, amount) };
        cache.set(key, entry);
      }
      return entry.result;
    })
  );
}
