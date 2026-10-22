import {
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import { getStakePoolAccount, updateStakePool, StakePoolInstruction } from '@solana/spl-stake-pool';
import { getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction } from '@solana/spl-token';
import Decimal from 'decimal.js';
import { logger } from '../utils/logger';

/**
 * Direct SOL deposits into SPL stake pools.
 *
 * Stake pools reject deposits until someone runs their once-per-epoch update.
 * - Devnet: nobody cranks the pools, so when a pool is stale we prepend the update instructions.
 *   They don't fit in one transaction, so the result can be several transactions sent in order.
 * - Mainnet: the pool operator cranks it early each epoch. A stale pool is skipped
 *   (allowPoolUpdate: false) and the deposit goes through Jupiter instead.
 */

export interface StakePoolTarget {
  symbol: string;
  pool: string;
  mint: string;
}

export interface StakePoolDepositPlan {
  outAmount: string; // UI units, estimated from the pool's current exchange rate
  transactions: VersionedTransaction[]; // in send order; the last one holds the deposit
  lastValidBlockHeight: number;
  poolUpdateNeeded: boolean;
}

const MAX_TX_BYTES = 1232;
const LAMPORTS_DECIMALS = 9;

// Measured on mainnet (Jito): token account creation plus depositSol uses about 31k compute units
const DEPOSIT_COMPUTE_UNITS = 100_000;
// Priority fee bounds in micro-lamports per compute unit. At 100k units the cap is 0.0001 SOL.
const MIN_PRIORITY_MICRO_LAMPORTS = 20_000;
const MAX_PRIORITY_MICRO_LAMPORTS = 1_000_000;

export interface StakePoolBuildOptions {
  allowPoolUpdate: boolean; // prepend the pool's epoch update when it is stale
  priorityFee: boolean; // add a compute budget and priority fee (mainnet)
}

function toUi(raw: Decimal): string {
  return raw.div(new Decimal(10).pow(LAMPORTS_DECIMALS)).toFixed();
}

/**
 * Estimate pool tokens for a SOL deposit, mirroring the program's math.
 * The referral fee comes back to the user because we pass their own token account as referrer.
 */
function estimatePoolTokens(lamports: Decimal, data: any): Decimal {
  const totalLamports = new Decimal(data.totalLamports.toString());
  const supply = new Decimal(data.poolTokenSupply.toString());
  const tokens = totalLamports.isZero() || supply.isZero()
    ? lamports
    : lamports.mul(supply).div(totalLamports).floor();

  const numerator = new Decimal(data.solDepositFee.numerator.toString());
  const denominator = new Decimal(data.solDepositFee.denominator.toString());
  const fee = denominator.isZero() ? new Decimal(0) : tokens.mul(numerator).div(denominator).ceil();
  const referralFee = fee.mul(data.solReferralFee || 0).div(100).floor();

  return tokens.minus(fee).plus(referralFee);
}

/**
 * Split instructions into as few transactions as fit, keeping their order
 */
function packTransactions(
  instructions: TransactionInstruction[],
  payer: PublicKey,
  recentBlockhash: string
): VersionedTransaction[] {
  const compile = (ixs: TransactionInstruction[]) =>
    new VersionedTransaction(new TransactionMessage({ payerKey: payer, recentBlockhash, instructions: ixs }).compileToV0Message());
  const fits = (ixs: TransactionInstruction[]) => {
    try {
      return compile(ixs).serialize().length <= MAX_TX_BYTES;
    } catch {
      return false; // serialize throws once the message overruns its buffer
    }
  };

  const groups: TransactionInstruction[][] = [];
  let current: TransactionInstruction[] = [];
  for (const ix of instructions) {
    if (current.length > 0 && !fits([...current, ix])) {
      groups.push(current);
      current = [];
    }
    current.push(ix);
  }
  if (current.length > 0) groups.push(current);

  return groups.map(compile);
}

/**
 * Priority fee from what recent transactions touching the pool paid, within fixed bounds
 */
async function priorityFeeMicroLamports(connection: Connection, accounts: PublicKey[]): Promise<number> {
  try {
    const fees = (await connection.getRecentPrioritizationFees({ lockedWritableAccounts: accounts }))
      .map((fee) => fee.prioritizationFee)
      .sort((a, b) => a - b);
    const p75 = fees.length > 0 ? fees[Math.floor(fees.length * 0.75)] : 0;
    return Math.min(Math.max(p75, MIN_PRIORITY_MICRO_LAMPORTS), MAX_PRIORITY_MICRO_LAMPORTS);
  } catch (error) {
    logger.warn('Could not read recent priority fees, using the minimum:', error);
    return MIN_PRIORITY_MICRO_LAMPORTS;
  }
}

export async function quoteStakePoolDeposit(
  connection: Connection,
  target: StakePoolTarget,
  lamports: Decimal
): Promise<{ outAmount: string; poolUpdateNeeded: boolean }> {
  const [pool, { epoch }] = await Promise.all([
    getStakePoolAccount(connection, new PublicKey(target.pool)),
    connection.getEpochInfo(),
  ]);
  const data = pool.account.data;
  return {
    outAmount: toUi(estimatePoolTokens(lamports, data)),
    poolUpdateNeeded: data.lastUpdateEpoch.toNumber() < epoch,
  };
}

export async function buildStakePoolDeposit(
  connection: Connection,
  target: StakePoolTarget,
  lamports: Decimal,
  user: PublicKey,
  options: StakePoolBuildOptions
): Promise<StakePoolDepositPlan> {
  const poolAddress = new PublicKey(target.pool);
  const pool = await getStakePoolAccount(connection, poolAddress);
  const data = pool.account.data;
  if (data.solDepositAuthority) {
    throw new Error(`The ${target.symbol} pool only accepts SOL deposits signed by its deposit authority`);
  }

  const { epoch } = await connection.getEpochInfo();
  const poolUpdateNeeded = data.lastUpdateEpoch.toNumber() < epoch;

  if (poolUpdateNeeded && !options.allowPoolUpdate) {
    throw new Error(`The ${target.symbol} pool has not been updated for this epoch yet`);
  }

  const updateInstructions: TransactionInstruction[] = [];
  if (poolUpdateNeeded) {
    const update = await updateStakePool(connection, pool);
    updateInstructions.push(...update.updateListInstructions, ...update.finalInstructions);
    logger.info(`Stake pool ${target.symbol} is stale (epoch ${data.lastUpdateEpoch.toString()} < ${epoch}), adding ${updateInstructions.length} update instructions`);
  }

  const [withdrawAuthority] = PublicKey.findProgramAddressSync(
    [poolAddress.toBuffer(), Buffer.from('withdraw')],
    pool.account.owner
  );
  const userPoolTokenAccount = getAssociatedTokenAddressSync(data.poolMint, user);

  const budgetInstructions = options.priorityFee
    ? [
        ComputeBudgetProgram.setComputeUnitLimit({ units: DEPOSIT_COMPUTE_UNITS }),
        ComputeBudgetProgram.setComputeUnitPrice({
          microLamports: await priorityFeeMicroLamports(connection, [poolAddress, data.reserveStake, data.poolMint]),
        }),
      ]
    : [];

  const depositInstructions = [
    ...budgetInstructions,
    createAssociatedTokenAccountIdempotentInstruction(user, userPoolTokenAccount, user, data.poolMint),
    StakePoolInstruction.depositSol({
      stakePool: poolAddress,
      withdrawAuthority,
      reserveStake: data.reserveStake,
      fundingAccount: user,
      destinationPoolAccount: userPoolTokenAccount,
      managerFeeAccount: data.managerFeeAccount,
      referralPoolAccount: userPoolTokenAccount,
      poolMint: data.poolMint,
      lamports: lamports.toNumber(),
    }),
  ];

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  const transactions = packTransactions([...updateInstructions, ...depositInstructions], user, blockhash);

  return {
    outAmount: toUi(estimatePoolTokens(lamports, data)),
    transactions,
    lastValidBlockHeight,
    poolUpdateNeeded,
  };
}
