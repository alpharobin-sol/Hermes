import axios from 'axios';
import {
  AddressLookupTableAccount,
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import Decimal from 'decimal.js';
import { logger } from '../utils/logger';
import { TokenInfo } from '../registry/routes';
import { depositBudgetInstructions } from './compute-budget';
import { DepositError } from './errors';

/**
 * Deposits into a Kamino Lend reserve (mainnet only).
 *
 * Kamino's transaction API builds the deposit, the same one the Kamino app uses. On a wallet's first deposit
 * it also creates the wallet's Kamino account (user metadata, obligation, rewards account): one-time rent in SOL.
 * The deposit becomes a position in that account, managed and withdrawn at app.kamino.finance.
 *
 * Kamino's transaction asks for 1M compute units and no priority fee. Hermes swaps that for a tighter limit
 * with a priority fee, then simulates the result to check it and to measure the one-time rent.
 */

// Measured on mainnet: a first deposit (account setup plus deposit) uses about 195k compute units
const KAMINO_COMPUTE_UNITS = 300_000;

export interface KaminoDepositPlan {
  transaction: VersionedTransaction;
  lastValidBlockHeight: number;
  setupCostSol: string; // one-time account rent on a first deposit, "0" after that
}

export interface KaminoDepositParams {
  market: string;
  reserve: string;
  token: TokenInfo;
  amount: string; // UI units, e.g. "1.5"
  user: PublicKey;
}

const kaminoApi = axios.create({
  baseURL: process.env.KAMINO_API_URL || 'https://api.kamino.finance',
  timeout: 20000,
});

async function fetchKaminoTransaction({ market, reserve, amount, user }: KaminoDepositParams): Promise<VersionedTransaction> {
  let encoded: string | undefined;
  try {
    const response = await kaminoApi.post('/ktx/klend/deposit', { wallet: user.toBase58(), market, reserve, amount });
    encoded = response.data?.transaction;
  } catch (error) {
    const detail = axios.isAxiosError(error) ? `${error.response?.status ?? ''} ${JSON.stringify(error.response?.data ?? error.message)}` : error;
    logger.warn(`Kamino deposit API failed: ${detail}`);
  }
  if (!encoded) {
    throw new DepositError("Kamino's deposit service is unavailable. Try again shortly.", 503);
  }

  const transaction = VersionedTransaction.deserialize(Buffer.from(encoded, 'base64'));
  // The only signer must be the user's wallet, paying its own fees
  if (transaction.message.header.numRequiredSignatures !== 1 || !transaction.message.staticAccountKeys[0].equals(user)) {
    logger.warn(`Kamino deposit API returned a transaction with unexpected signers for ${user.toBase58()}`);
    throw new DepositError("Kamino's deposit service returned an unexpected transaction. Try again shortly.", 502);
  }
  return transaction;
}

async function loadLookupTables(connection: Connection, transaction: VersionedTransaction): Promise<AddressLookupTableAccount[]> {
  return Promise.all(
    transaction.message.addressTableLookups.map(async (lookup) => {
      const table = (await connection.getAddressLookupTable(lookup.accountKey)).value;
      if (!table) throw new Error(`Lookup table ${lookup.accountKey.toBase58()} not found`);
      return table;
    })
  );
}

function describeKaminoError(err: unknown, logs: string[], token: TokenInfo): string {
  const text = `${JSON.stringify(err)} ${logs.join(' ')}`;
  if (/insufficient lamports|AccountNotFound|no record of a prior credit/i.test(text)) {
    return 'Not enough SOL. Keep SOL for network fees and, on a first Kamino deposit, the one-time account rent.';
  }
  if (/insufficient funds/i.test(text)) {
    return `Insufficient ${token.symbol} balance for this deposit.`;
  }
  if (/DepositLimitExceeded|deposit limit/i.test(text)) {
    return `This Kamino ${token.symbol} reserve has reached its deposit limit. Try a smaller amount or try later.`;
  }
  return 'Kamino rejected this deposit in simulation. Try a smaller amount or try again shortly.';
}

export async function buildKaminoDeposit(connection: Connection, params: KaminoDepositParams): Promise<KaminoDepositPlan> {
  const { reserve, token, amount, user } = params;
  const kaminoTransaction = await fetchKaminoTransaction(params);
  const lookupTables = await loadLookupTables(connection, kaminoTransaction);

  const message = TransactionMessage.decompile(kaminoTransaction.message, { addressLookupTableAccounts: lookupTables });
  const instructions = message.instructions.filter((ix) => !ix.programId.equals(ComputeBudgetProgram.programId));
  const budget = await depositBudgetInstructions(connection, [new PublicKey(reserve)], KAMINO_COMPUTE_UNITS);

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  const transaction = new VersionedTransaction(
    new TransactionMessage({ payerKey: user, recentBlockhash: blockhash, instructions: [...budget, ...instructions] })
      .compileToV0Message(lookupTables)
  );

  // Simulate to check the deposit and to see how much SOL it takes from the wallet
  const [balance, simulation, fee] = await Promise.all([
    connection.getBalance(user),
    connection.simulateTransaction(transaction, {
      sigVerify: false,
      accounts: { encoding: 'base64', addresses: [user.toBase58()] },
    }),
    connection.getFeeForMessage(transaction.message),
  ]);

  if (simulation.value.err) {
    const logs = simulation.value.logs ?? [];
    logger.warn(`Kamino ${token.symbol} deposit failed simulation: ${JSON.stringify(simulation.value.err)} ${logs.slice(-4).join(' | ')}`);
    throw new DepositError(describeKaminoError(simulation.value.err, logs, token), 422);
  }

  // SOL leaving the wallet, minus the network fee and a SOL deposit itself, is the one-time account rent
  const after = simulation.value.accounts?.[0]?.lamports;
  const depositLamports = token.symbol === 'SOL' ? new Decimal(amount).mul(1e9).floor() : new Decimal(0);
  const setupLamports = after == null || fee.value == null
    ? new Decimal(0)
    : Decimal.max(0, new Decimal(balance).minus(after).minus(fee.value).minus(depositLamports));

  return {
    transaction,
    lastValidBlockHeight,
    setupCostSol: setupLamports.div(1e9).toFixed(),
  };
}
