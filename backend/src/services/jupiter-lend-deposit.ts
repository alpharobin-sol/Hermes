import axios from 'axios';
import Decimal from 'decimal.js';
import {
  Connection,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import {
  NATIVE_MINT,
  createAssociatedTokenAccountIdempotentInstruction,
  createCloseAccountInstruction,
  createSyncNativeInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import { logger } from '../utils/logger';
import { TokenInfo } from '../registry/routes';
import { cached } from './cache';
import { depositBudgetInstructions } from './compute-budget';
import { DepositError } from './errors';
import { createJupiterClient } from './jupiter';

/**
 * Deposits into Jupiter Lend Earn (mainnet only).
 *
 * Jupiter's Lend API returns the deposit instruction. It expects the wallet's token accounts to exist already,
 * so Hermes adds them: the jl token account the deposit mints into and, for SOL, a wrapped SOL account that
 * it closes again after the deposit. Hermes accepts only instructions for the Jupiter Lend program signed by
 * the user alone, then simulates the transaction to check it and to read the jl tokens it mints.
 */

export const JUPITER_LEND_PROGRAM = new PublicKey('jup3YeL8QhtSx1e253b2FDvsMNC87fDrgQZivbrndc9');
// Measured on mainnet: a first deposit (token accounts plus deposit) uses 62k to 78k compute units
const JUPITER_LEND_COMPUTE_UNITS = 150_000;
// SOL kept back for the token account rent and fees
const FEE_BUFFER_LAMPORTS = 10_000_000;

const lendApi = createJupiterClient('lend/v1', process.env.JUPITER_LEND_API_URL);

// Asset mint -> asset units to shares, scaled by the asset's decimals. Quotes read it, so keep it fresh.
const shareRates = cached(
  'Jupiter Lend share rates',
  async () => {
    const response = await lendApi.get('/earn/tokens');
    const tokens: any[] = Array.isArray(response.data) ? response.data : [];
    const rates = new Map<string, Decimal>();
    for (const token of tokens) {
      const toShares = Number(token.convertToShares);
      if (token.assetAddress && Number.isFinite(toShares) && toShares > 0) rates.set(token.assetAddress, new Decimal(toShares));
    }
    return rates;
  },
  { ttlMs: 60 * 1000, maxStaleMs: 5 * 60 * 1000 }
);

/**
 * jl tokens a deposit mints, in the jl token's base units, at the current share rate
 */
export async function quoteJupiterLendDeposit(asset: TokenInfo, amount: Decimal): Promise<Decimal> {
  const toShares = (await shareRates.get())?.get(asset.mint);
  if (!toShares) throw new DepositError('Jupiter Lend rates are unavailable. Try again shortly.', 503);
  return amount.mul(toShares).div(new Decimal(10).pow(asset.decimals)).floor();
}

export interface JupiterLendDepositPlan {
  transaction: VersionedTransaction;
  lastValidBlockHeight: number;
  outAmount: string; // jl tokens minted in simulation, UI units
}

export interface JupiterLendDepositParams {
  asset: TokenInfo; // what the user deposits
  receipt: TokenInfo; // the jl token minted
  amount: Decimal; // in the asset's base units
  user: PublicKey;
}

async function fetchDepositInstructions({ asset, amount, user }: JupiterLendDepositParams): Promise<TransactionInstruction[]> {
  let raw: any[] | undefined;
  try {
    const response = await lendApi.post('/earn/deposit-instructions', {
      asset: asset.mint,
      signer: user.toBase58(),
      amount: amount.toFixed(0),
    });
    raw = response.data?.instructions;
  } catch (error) {
    const detail = axios.isAxiosError(error) ? `${error.response?.status ?? ''} ${JSON.stringify(error.response?.data ?? error.message)}` : error;
    logger.warn(`Jupiter Lend deposit API failed: ${detail}`);
  }
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new DepositError("Jupiter Lend's deposit service is unavailable. Try again shortly.", 503);
  }

  return raw.map((ix) => {
    const programId = new PublicKey(ix.programId);
    const keys = (ix.accounts ?? []).map((account: any) => ({
      pubkey: new PublicKey(account.pubkey),
      isSigner: Boolean(account.isSigner),
      isWritable: Boolean(account.isWritable),
    }));
    // Only the Jupiter Lend program, and no signer but the user's wallet
    if (!programId.equals(JUPITER_LEND_PROGRAM) || keys.some((key: { pubkey: PublicKey; isSigner: boolean }) => key.isSigner && !key.pubkey.equals(user))) {
      logger.warn(`Jupiter Lend deposit API returned an unexpected instruction for ${user.toBase58()}: ${programId.toBase58()}`);
      throw new DepositError("Jupiter Lend's deposit service returned an unexpected transaction. Try again shortly.", 502);
    }
    return new TransactionInstruction({ programId, keys, data: Buffer.from(ix.data ?? '', 'base64') });
  });
}

function describeJupiterLendError(err: unknown, logs: string[], asset: TokenInfo): string {
  const text = `${JSON.stringify(err)} ${logs.join(' ')}`;
  if (/insufficient lamports|no record of a prior credit/i.test(text)) {
    return 'Not enough SOL. Keep SOL for network fees and the one-time token account rent.';
  }
  if (/insufficient funds/i.test(text)) {
    return `Insufficient ${asset.symbol} balance for this deposit.`;
  }
  return 'Jupiter Lend rejected this deposit in simulation. Try a smaller amount or try again shortly.';
}

// The token amount held in a token account, from its raw data
export function tokenAmount(data: Buffer | null | undefined): bigint {
  return data && data.length >= 72 ? data.readBigUInt64LE(64) : 0n;
}

export async function buildJupiterLendDeposit(connection: Connection, params: JupiterLendDepositParams): Promise<JupiterLendDepositPlan> {
  const { asset, receipt, amount, user } = params;
  const isSol = asset.mint === NATIVE_MINT.toBase58();
  const assetAccount = getAssociatedTokenAddressSync(new PublicKey(asset.mint), user, true);
  const receiptAccount = getAssociatedTokenAddressSync(new PublicKey(receipt.mint), user, true);

  const [depositInstructions, balance, assetInfo, receiptInfo] = await Promise.all([
    fetchDepositInstructions(params),
    connection.getBalance(user),
    connection.getAccountInfo(assetAccount),
    connection.getAccountInfo(receiptAccount),
  ]);

  // The deposit must draw from and mint into the wallet's own token accounts, the ones set up below
  const touched = depositInstructions.flatMap((ix) => ix.keys.map((key) => key.pubkey));
  if (!touched.some((key) => key.equals(assetAccount)) || !touched.some((key) => key.equals(receiptAccount))) {
    logger.warn(`Jupiter Lend deposit for ${user.toBase58()} does not use the wallet's token accounts`);
    throw new DepositError("Jupiter Lend's deposit service returned an unexpected transaction. Try again shortly.", 502);
  }

  if (isSol) {
    if (amount.plus(FEE_BUFFER_LAMPORTS).gt(balance)) {
      throw new DepositError(`Insufficient balance: you have ${balance / 1e9} SOL. Keep 0.01 SOL for fees.`, 422);
    }
  } else if (new Decimal(tokenAmount(assetInfo?.data).toString()).lt(amount)) {
    throw new DepositError(`Insufficient ${asset.symbol} balance for this deposit.`, 422);
  }

  const setup: TransactionInstruction[] = [
    createAssociatedTokenAccountIdempotentInstruction(user, receiptAccount, user, new PublicKey(receipt.mint)),
  ];
  const cleanup: TransactionInstruction[] = [];
  if (isSol) {
    // Wrap the SOL to deposit. A wrapped SOL account created here is closed again, returning its rent.
    setup.push(
      createAssociatedTokenAccountIdempotentInstruction(user, assetAccount, user, NATIVE_MINT),
      SystemProgram.transfer({ fromPubkey: user, toPubkey: assetAccount, lamports: BigInt(amount.toFixed(0)) }),
      createSyncNativeInstruction(assetAccount)
    );
    if (!assetInfo) cleanup.push(createCloseAccountInstruction(assetAccount, user, user));
  }

  const budget = await depositBudgetInstructions(connection, [receiptAccount], JUPITER_LEND_COMPUTE_UNITS);
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  const transaction = new VersionedTransaction(
    new TransactionMessage({
      payerKey: user,
      recentBlockhash: blockhash,
      instructions: [...budget, ...setup, ...depositInstructions, ...cleanup],
    }).compileToV0Message()
  );

  // Simulate to check the deposit and to read the jl tokens it mints
  const simulation = await connection.simulateTransaction(transaction, {
    sigVerify: false,
    accounts: { encoding: 'base64', addresses: [receiptAccount.toBase58()] },
  });
  if (simulation.value.err) {
    const logs = simulation.value.logs ?? [];
    logger.warn(`Jupiter Lend ${asset.symbol} deposit failed simulation: ${JSON.stringify(simulation.value.err)} ${logs.slice(-4).join(' | ')}`);
    throw new DepositError(describeJupiterLendError(simulation.value.err, logs, asset), 422);
  }

  const after = simulation.value.accounts?.[0];
  const minted = after ? tokenAmount(Buffer.from(after.data[0], 'base64')) - tokenAmount(receiptInfo?.data) : 0n;
  if (minted <= 0n) {
    logger.warn(`Jupiter Lend ${asset.symbol} deposit minted no ${receipt.symbol} in simulation`);
    throw new DepositError('Jupiter Lend rejected this deposit in simulation. Try a smaller amount or try again shortly.', 422);
  }

  return {
    transaction,
    lastValidBlockHeight,
    outAmount: new Decimal(minted.toString()).div(new Decimal(10).pow(receipt.decimals)).toFixed(),
  };
}
