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

/**
 * SOL the route keeps back from a SOL deposit, or needs in the wallet for a USDC or USDT deposit, rounded up to
 * 0.0001 SOL. null while the network's rent can't be read.
 */
export async function solReserve(route: RouteConfig): Promise<number | null> {
  const perByte = await rentPerByte.get();
  if (!perByte) return null;
  const tokenAccount = (TOKEN_ACCOUNT_BYTES + ACCOUNT_OVERHEAD) * perByte;
  const walletMinimum = ACCOUNT_OVERHEAD * perByte; // the least a wallet may hold
  const wrapsSol = route.token === 'SOL';
  let stays = 0; // accounts that stay open after the deposit
  let temporary = 0; // accounts the deposit opens and closes again
  if (route.category === 'liquid-staking') {
    stays = tokenAccount; // the staking token's account
    temporary = tokenAccount; // wrapped SOL, when Jupiter swaps
  } else if (route.direct?.kind === 'jupiter-lend') {
    stays = tokenAccount; // the jl token's account
    temporary = wrapsSol ? tokenAccount : 0;
  } else if (route.direct) {
    stays = (FIRST_DEPOSIT_BYTES[route.direct.kind] ?? 0) * perByte;
    temporary = wrapsSol ? tokenAccount : 0;
  }
  const during = stays + temporary + NETWORK_FEES;
  const after = stays + NETWORK_FEES + walletMinimum;
  return Math.ceil(Math.max(during, after) * 1e4) / 1e4;
}
