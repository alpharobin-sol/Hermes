import { DirectDeposit, RouteConfig } from '../registry/routes';

/**
 * SOL HOLD-BACK
 * What a deposit needs in SOL besides the amount, per route: network fees, the token accounts it opens, and the
 * one-time accounts a protocol opens on a first deposit. A SOL deposit can use the rest of the balance. A USDC or USDT
 * deposit needs this much SOL in the wallet.
 *
 * Counted for a first deposit, so it is the most a route needs. Two limits, and the larger one holds:
 * - while the transaction runs: the accounts it opens, including a wrapped SOL account that a swap or a SOL lending
 *   deposit closes again before it ends, and the fees
 * - after it: the accounts that stay open, the fees, and the wallet's own minimum balance, which the network won't let
 *   a wallet go below
 * Measured on 25 Oct with a wallet holding 0.00995 SOL: a Jupiter swap into JSOL went through keeping back 0.005 SOL
 * and failed keeping back 0.004.
 */

const WALLET_MINIMUM = 0.00089088; // rent-exempt minimum of a plain wallet
const TOKEN_ACCOUNT = 0.00203928; // rent of a token account
// The base fee and a priority fee, up to the 0.001 SOL cap Hermes asks Jupiter for, with a little room
const NETWORK_FEES = 0.0012;

// One-time accounts a protocol opens on a first deposit, measured by simulation
const FIRST_DEPOSIT_RENT: Partial<Record<DirectDeposit['kind'], number>> = {
  'kamino-lend': 0.03, // the Kamino account: 0.0241 SOL for SOL, 0.0298 for USDC and USDT
  'kamino-vault': 0.0069, // the shares token account and the farm account: 0.0068
  project0: 0.0124, // the Project 0 account
};

/**
 * SOL the route keeps back from a SOL deposit, or needs in the wallet for a USDC or USDT deposit, rounded up to
 * 0.0001 SOL
 */
export function solReserve(route: RouteConfig): number {
  const wrapsSol = route.token === 'SOL';
  let stays = 0; // accounts that stay open after the deposit
  let temporary = 0; // accounts the deposit opens and closes again
  if (route.category === 'liquid-staking') {
    stays = TOKEN_ACCOUNT; // the staking token's account
    temporary = TOKEN_ACCOUNT; // wrapped SOL, when Jupiter swaps
  } else if (route.direct?.kind === 'jupiter-lend') {
    stays = TOKEN_ACCOUNT; // the jl token's account
    temporary = wrapsSol ? TOKEN_ACCOUNT : 0;
  } else if (route.direct) {
    stays = FIRST_DEPOSIT_RENT[route.direct.kind] ?? 0;
    temporary = wrapsSol ? TOKEN_ACCOUNT : 0;
  }
  const during = stays + temporary + NETWORK_FEES;
  const after = stays + NETWORK_FEES + WALLET_MINIMUM;
  return Math.ceil(Math.max(during, after) * 1e4) / 1e4;
}
