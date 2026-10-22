import { ComputeBudgetProgram, Connection, PublicKey, TransactionInstruction } from '@solana/web3.js';
import { logger } from '../utils/logger';

/**
 * Compute budget and priority fee for direct deposits on mainnet, so they land without delay
 */

// Measured on mainnet, including token account creation: Jito depositSol about 31k, Marinade deposit about 47k
const DEPOSIT_COMPUTE_UNITS = 100_000;
// Priority fee bounds in micro-lamports per compute unit. At 100k units the cap is 0.0001 SOL.
const MIN_PRIORITY_MICRO_LAMPORTS = 20_000;
const MAX_PRIORITY_MICRO_LAMPORTS = 1_000_000;

/**
 * Priority fee from what recent transactions touching these accounts paid, within fixed bounds
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

/**
 * Compute unit limit and price instructions, to go first in a deposit transaction
 */
export async function depositBudgetInstructions(
  connection: Connection,
  writableAccounts: PublicKey[]
): Promise<TransactionInstruction[]> {
  return [
    ComputeBudgetProgram.setComputeUnitLimit({ units: DEPOSIT_COMPUTE_UNITS }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: await priorityFeeMicroLamports(connection, writableAccounts) }),
  ];
}
