import Decimal from 'decimal.js';
import { solanaNetwork } from '../config/runtime';
import { depositCap, getRoute, InputToken, RouteConfig, TOKENS } from '../registry/routes';
import depositService, { DepositTransaction } from './deposit';
import { DepositError } from './errors';
import { splitSolReserve } from './sol-reserve';
import { getYieldRoutes, isTopRated, TOP_RATED_MIN_SCORE } from './yields';

/**
 * TOP RATED SPLIT
 * One deposit spread across two or three top rated routes for the same token, each part an ordinary deposit built
 * and simulated by the deposit code. The wallet signs every part in one approval and the app sends them in order, so
 * nothing passes through Hermes. The app splits evenly; this checks what it asks for:
 * - two or three different routes, every one in the token and top rated right now (a Safety Score of 80 or more and
 *   no reserve nearly all borrowed), with an in-app deposit
 * - the whole split within the beta cap of one deposit, so a split never moves more than a single deposit could
 * - for SOL, the parts and their fees and accounts within the wallet's balance, all counted together
 * A retry of the parts that didn't land may ask for one route: it is still checked the same way.
 */

export const SPLIT_MAX_PARTS = 3;

export interface SplitPartRequest {
  routeId: string;
  amount: string | number; // UI units
}

export interface SplitPart extends DepositTransaction {
  routeId: string;
  amount: string;
}

export interface SplitBuild {
  parts: SplitPart[];
  solReserve: number | null; // SOL the split keeps back for fees and the accounts it opens (SOL splits)
}

export async function buildSplit(token: InputToken, parts: SplitPartRequest[], userPublicKey: string): Promise<SplitBuild> {
  const network = solanaNetwork();
  if (parts.length === 0 || parts.length > SPLIT_MAX_PARTS) {
    throw new DepositError(`A split goes into one to ${SPLIT_MAX_PARTS} routes.`, 400);
  }
  const ids = parts.map((part) => part.routeId);
  if (new Set(ids).size !== ids.length) throw new DepositError('Each route can be in a split once.', 400);

  const routes: RouteConfig[] = ids.map((id) => {
    const route = getRoute(id);
    if (!route) throw new DepositError(`Unknown route: ${id}`, 404);
    if (route.token !== token) throw new DepositError(`${route.name} takes ${route.token}, not ${token}.`, 400);
    return route;
  });

  // Top rated right now, from the same live routes the app shows
  const live = await getYieldRoutes(token);
  for (const route of routes) {
    const row = live.find((candidate) => candidate.id === route.id);
    if (!row) throw new DepositError(`${route.name} has no live rate right now, so it can't be part of a split.`, 503);
    if (!row.deposit || !isTopRated(row)) {
      throw new DepositError(
        `${route.name} isn't top rated right now (a Safety Score of ${TOP_RATED_MIN_SCORE} or more), so it can't be part of a split.`,
        422
      );
    }
  }

  // Each part checks its own route and amount (deposits open, at least a unit of the token)
  const amounts = parts.map((part) => new Decimal(part.amount));
  routes.forEach((route, i) => depositService.checkRoute({ routeId: route.id, amount: amounts[i].toFixed() }));

  // The whole split within one deposit's beta cap
  const total = amounts.reduce((sum, amount) => sum.plus(amount), new Decimal(0));
  const caps = routes.map((route) => depositCap(route, network)).filter((cap): cap is number => cap !== null);
  if (caps.length > 0) {
    const cap = Math.min(...caps);
    if (total.gt(cap)) {
      throw new DepositError(`While in beta, a split is limited to ${cap.toLocaleString('en-US')} ${token} in all, like a single deposit.`, 422);
    }
  }

  // SOL: every part, its fees and the accounts it opens, out of the wallet's balance together
  const reserve = token === 'SOL' ? await splitSolReserve(routes) : null;
  if (token === 'SOL') {
    if (reserve === null) throw new DepositError("Can't read the network's account rent right now. Try again shortly.", 503);
    const balance = await depositService.walletSol(userPublicKey);
    if (total.plus(reserve).gt(balance)) {
      const most = Decimal.max(0, balance.minus(reserve)).toDecimalPlaces(6, Decimal.ROUND_DOWN);
      throw new DepositError(
        `Not enough SOL: keep ${reserve} SOL for the fees and accounts of ${routes.length} deposits. You can split up to ${most.toFixed()} SOL.`,
        422
      );
    }
  }

  const decimals = TOKENS[token].decimals;
  const built = await Promise.all(
    routes.map((route, i) =>
      depositService.buildTransaction(
        { routeId: route.id, amount: amounts[i].toDecimalPlaces(decimals, Decimal.ROUND_DOWN).toFixed() },
        userPublicKey,
        { skipSolCheck: true }
      )
    )
  );
  return {
    parts: built.map((part, i) => ({ ...part, routeId: routes[i].id, amount: amounts[i].toDecimalPlaces(decimals, Decimal.ROUND_DOWN).toFixed() })),
    solReserve: reserve,
  };
}
