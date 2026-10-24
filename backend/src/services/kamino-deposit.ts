import axios from 'axios';
import {
  AddressLookupTableAccount,
  AddressLookupTableProgram,
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
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

// The Kamino Lend program. Its own instructions, and the token moves it makes inside them, are the deposit.
const KAMINO_LEND_PROGRAM = new PublicKey('KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD');

// Programs a real Kamino deposit uses at the top level: the lending program, account creation (ATA), the user's
// own lookup table (first deposit), wrapped SOL moves (System and Token), and compute budget. Any other program
// in the response means the transaction does more than deposit, so Hermes refuses to have the user sign it.
const KAMINO_ALLOWED_PROGRAMS = new Set(
  [
    KAMINO_LEND_PROGRAM,
    ASSOCIATED_TOKEN_PROGRAM_ID,
    AddressLookupTableProgram.programId,
    SystemProgram.programId,
    TOKEN_PROGRAM_ID,
    ComputeBudgetProgram.programId,
  ].map((id) => id.toBase58())
);

// SPL Token instructions (first data byte) that hand tokens or authority to someone else. A real Kamino deposit
// only syncs or closes the user's own wrapped SOL at the top level; the supply itself is a CPI inside the lending
// program. So any of these at the top level would be moving the user's funds somewhere Hermes did not intend.
const DANGEROUS_TOKEN_IX = new Set([
  3, // Transfer
  4, // Approve
  6, // SetAuthority
  7, // MintTo
  8, // Burn
  12, // TransferChecked
  13, // ApproveChecked
  21, // Burn (Token-2022 variants share the classic indices; kept for safety)
]);

// SOL the deposit may take from the wallet beyond the deposit itself: account rent on a first deposit. Measured
// at 0.024 to 0.03 SOL on mainnet; the bound leaves room and still stops a transaction that drains far more.
const MAX_SETUP_SOL = Number(process.env.KAMINO_MAX_SETUP_SOL || 0.05);

/**
 * Refuse a Kamino transaction that does more than deposit. The API's response is not signed, so Hermes checks it
 * before building: only the programs a deposit uses, no top-level token transfer or approval, and wrapped SOL
 * moves only between the user's own accounts. A compromised response can then at worst fail, never drain.
 */
export function assertKaminoDepositOnly(instructions: TransactionInstruction[], user: PublicKey, token: TokenInfo): void {
  const wsolAccount = getAssociatedTokenAddressSync(NATIVE_MINT, user, true);
  const refuse = (why: string): never => {
    logger.warn(`Kamino deposit for ${user.toBase58()} refused: ${why}`);
    throw new DepositError("Kamino's deposit service returned an unexpected transaction. Try again shortly.", 502);
  };

  for (const ix of instructions) {
    const program = ix.programId.toBase58();
    if (!KAMINO_ALLOWED_PROGRAMS.has(program)) refuse(`unexpected program ${program}`);

    if (ix.programId.equals(TOKEN_PROGRAM_ID)) {
      if (ix.data.length === 0 || DANGEROUS_TOKEN_IX.has(ix.data[0])) refuse(`token instruction ${ix.data[0]}`);
      // Closing the wrapped SOL account must return its rent to the user, not a third party
      if (ix.data[0] === 9 && !ix.keys[1]?.pubkey.equals(user)) refuse('token close to a third party');
    }

    if (ix.programId.equals(SystemProgram.programId)) {
      // Only funding the user's own wrapped SOL account (a Transfer to it) is part of a deposit
      const isTransfer = ix.data.length >= 4 && ix.data.readUInt32LE(0) === 2;
      if (!isTransfer || !ix.keys[1]?.pubkey.equals(wsolAccount)) refuse('unexpected system instruction');
      if (token.symbol !== 'SOL') refuse('system transfer on a non-SOL deposit');
    }
  }
}

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
  // The response is not signed by Kamino, so check it does only a deposit before the user signs it
  assertKaminoDepositOnly(instructions, user, token);
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

  // A deposit only pays account rent beyond the deposit itself. More SOL than that leaving the wallet means the
  // transaction does something else, so Hermes refuses it rather than have the user sign away their SOL.
  if (setupLamports.gt(new Decimal(MAX_SETUP_SOL).mul(1e9))) {
    logger.warn(`Kamino ${token.symbol} deposit would take ${setupLamports.div(1e9).toFixed()} SOL beyond the deposit`);
    throw new DepositError("Kamino's deposit service returned an unexpected transaction. Try again shortly.", 502);
  }

  return {
    transaction,
    lastValidBlockHeight,
    setupCostSol: setupLamports.div(1e9).toFixed(),
  };
}
