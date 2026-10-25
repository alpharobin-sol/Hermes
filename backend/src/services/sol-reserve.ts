import { DirectDeposit, RouteConfig } from '../registry/routes';
import { cached } from './cache';
import { connection } from './rates';

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
 * Simulated on 25 Oct from a wallet holding 0.0098 SOL: a Jupiter swap into JSOL went through keeping back 0.003 SOL
 * and failed at 0.00296, short of its second token account. The fees here add room for Jupiter's priority fee cap.
 */

// Rent is set by the network and has changed before (5,080 lamports a byte on 25 Oct 2026, down from 6,960), so it is
// read from the chain. An account pays for its data and 128 bytes more.
const ACCOUNT_OVERHEAD = 128;
const TOKEN_ACCOUNT_BYTES = 165;
const rentPerByte = cached(
  'rent per byte',
  async () => (await connection.getMinimumBalanceForRentExemption(0)) / ACCOUNT_OVERHEAD / 1e9,
  { ttlMs: 60 * 60 * 1000, maxStaleMs: 7 * 24 * 60 * 60 * 1000 }
);

// The base fee and a priority fee, up to the 0.001 SOL cap Hermes asks Jupiter for, with a little room
const NETWORK_FEES = 0.0012;

// Accounts a protocol opens on a first deposit, in bytes with each account's 128, measured by simulation on 25 Oct
const FIRST_DEPOSIT_BYTES: Partial<Record<DirectDeposit['kind'], number>> = {
  'kamino-lend': 5864, // the Kamino account: 0.0298 SOL for USDC and USDT, 0.0241 for SOL
  'kamino-vault': 1341, // the shares token account and the farm account: 0.0068 SOL
  project0: 2440, // the Project 0 account: 0.0124 SOL
};

// What one first deposit opens, in SOL: accounts that stay open after it, and accounts it opens and closes again
function accounts(route: RouteConfig, perByte: number): { stays: number; temporary: number } {
  const tokenAccount = (TOKEN_ACCOUNT_BYTES + ACCOUNT_OVERHEAD) * perByte;
  const wrapsSol = route.token === 'SOL';
  if (route.category === 'liquid-staking') {
    // the staking token's account, and wrapped SOL when Jupiter swaps
    return { stays: tokenAccount, temporary: tokenAccount };
  }
  if (route.direct?.kind === 'jupiter-lend') {
    // the jl token's account
    return { stays: tokenAccount, temporary: wrapsSol ? tokenAccount : 0 };
  }
  if (route.direct) {
    return { stays: (FIRST_DEPOSIT_BYTES[route.direct.kind] ?? 0) * perByte, temporary: wrapsSol ? tokenAccount : 0 };
  }
  return { stays: 0, temporary: 0 };
}

const roundUp = (sol: number) => Math.ceil(sol * 1e4) / 1e4;

/**
 * SOL the route keeps back from a SOL deposit, or needs in the wallet for a USDC or USDT deposit, rounded up to
 * 0.0001 SOL. null while the network's rent can't be read.
 */
export async function solReserve(route: RouteConfig): Promise<number | null> {
  const perByte = await rentPerByte.get();
  if (!perByte) return null;
  const walletMinimum = ACCOUNT_OVERHEAD * perByte; // the least a wallet may hold
  const { stays, temporary } = accounts(route, perByte);
  const during = stays + temporary + NETWORK_FEES;
  const after = stays + NETWORK_FEES + walletMinimum;
  return roundUp(Math.max(during, after));
}

/**
 * The same for a split: deposits sent one after another, so the accounts each opens for good add up, while a
 * temporary account (wrapped SOL) is closed before the next part opens its own. Each part pays its own fees.
 */
export async function splitSolReserve(routes: RouteConfig[]): Promise<number | null> {
  const perByte = await rentPerByte.get();
  if (!perByte) return null;
  const walletMinimum = ACCOUNT_OVERHEAD * perByte;
  const each = routes.map((route) => accounts(route, perByte));
  const stays = each.reduce((sum, part) => sum + part.stays, 0);
  const temporary = Math.max(0, ...each.map((part) => part.temporary));
  const fees = NETWORK_FEES * routes.length;
  return roundUp(Math.max(stays + temporary + fees, stays + fees + walletMinimum));
}
