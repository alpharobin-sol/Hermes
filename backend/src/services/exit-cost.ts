import { solanaNetwork } from '../config/runtime';
import { depositStatus, RouteConfig, ROUTES, TOKENS } from '../registry/routes';
import { cached, Cached } from './cache';
import { createJupiterClient } from './jupiter';
import type { Rate } from './rates';

/**
 * EXIT COST
 * What leaving a route costs at today's prices, for the site's real yield by time horizon.
 *
 * - Liquid staking leaves by swapping the token back to SOL on Jupiter. Hermes quotes selling EXIT_COST_SAMPLE tokens,
 *   about a beta-sized deposit, and compares the SOL it returns with the tokens' value in their pool, so a discount
 *   and price impact both count. (The Safety Score's exit part sells 10,000 tokens to test depth; that would overstate
 *   the cost of leaving a normal deposit.)
 * - Lending leaves at face value. Kamino's one-time account rent comes back on a full exit, so it is not a cost.
 *
 * Unstaking with the protocol instead would avoid the swap but takes an epoch or more, so Hermes counts the swap:
 * the way out that is open right away.
 */

export const EXIT_COST_SAMPLE = 10;

const HOUR_MS = 60 * 60 * 1000;
const jupiter = createJupiterClient('swap/v1', process.env.JUPITER_API_URL);
const quotes = new Map<string, Cached<number>>(); // SOL a sale of EXIT_COST_SAMPLE tokens returns

function exitQuote(route: RouteConfig): Cached<number> | undefined {
  const receipt = route.receipt;
  if (route.category !== 'liquid-staking' || !receipt || solanaNetwork() !== 'mainnet-beta') return undefined;
  let entry = quotes.get(route.id);
  if (!entry) {
    entry = cached(
      `exit cost quote for ${route.id}`,
      async () => {
        const { data } = await jupiter.get('/quote', {
          params: {
            inputMint: receipt.mint,
            outputMint: TOKENS.SOL.mint,
            amount: (BigInt(EXIT_COST_SAMPLE) * 10n ** BigInt(receipt.decimals)).toString(),
            slippageBps: 50,
          },
        });
        const outSol = Number(data?.outAmount) / 10 ** TOKENS.SOL.decimals;
        if (!(outSol > 0)) throw new Error('no amount in quote');
        return outSol;
      },
      { ttlMs: 30 * 60 * 1000, maxStaleMs: 3 * HOUR_MS, retryAfterMs: 5 * 60 * 1000 }
    );
    quotes.set(route.id, entry);
  }
  return entry;
}

/**
 * Share of a position's value lost leaving the route today: 0 for lending, the swap's loss against pool value for
 * liquid staking (negative when the market pays more than the pool), null while the quote is missing
 */
export function exitCost(route: RouteConfig, rate: Rate): number | null {
  if (route.category === 'lending') return 0;
  const outSol = exitQuote(route)?.peek();
  if (!outSol || !rate.tokenValue) return null;
  return 1 - outSol / (EXIT_COST_SAMPLE * rate.tokenValue);
}

/**
 * Keep the exit quotes warm, one at a time so Jupiter's limit holds
 */
export async function refreshExitCosts(): Promise<void> {
  const network = solanaNetwork();
  for (const route of ROUTES) {
    if (depositStatus(route, network) !== null) await exitQuote(route)?.get();
  }
}
