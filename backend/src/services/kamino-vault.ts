import axios from 'axios';
import Decimal from 'decimal.js';
import {
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync, unpackAccount } from '@solana/spl-token';
import { logger } from '../utils/logger';
import { DirectDeposit, TokenInfo, TOKENS } from '../registry/routes';
import { depositBudgetInstructions } from './compute-budget';
import { DepositError } from './errors';
import { loadLookupTables } from './kamino-deposit';
import { tokenAmount } from './jupiter-lend-deposit';

/**
 * Deposits into and withdrawals from a Kamino lending vault (mainnet only).
 *
 * A vault spreads its deposits across several Kamino Lend reserves that its curator picks. Kamino's transaction API
 * builds both, the same ones the Kamino app uses. A deposit mints vault shares and stakes them in the vault's farm,
 * so nothing stays in the wallet. A withdrawal unstakes the shares and redeems them for the token.
 *
 * The API's response is not signed by Kamino, so Hermes checks it before the user signs: only the vault, farms,
 * token account and compute budget programs; every vault instruction for this vault and this amount; every farm
 * instruction for this vault's farm; token accounts only for the user. A full withdrawal may ask for every share and
 * close the emptied shares account, its rent back to the user. Then it simulates the transaction: no more of the
 * token may leave the wallet than the deposit, and SOL only for account rent.
 */

export const KAMINO_VAULT_PROGRAM = new PublicKey('KvauGMspG5k6rtzrqqn7WNn3oZdyKqLKwK2XWQ8FLjd');
const KAMINO_FARMS_PROGRAM = new PublicKey('FarmsPZpWu9i7Kky8tPN37rs2TpmMrAZrC7S7vJa91Hr');

const ALLOWED_PROGRAMS = new Set(
  [KAMINO_VAULT_PROGRAM, KAMINO_FARMS_PROGRAM, ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, ComputeBudgetProgram.programId].map((id) =>
    id.toBase58()
  )
);
// A vault instruction's amount when it redeems every share the user holds
const ALL_SHARES = 2n ** 64n - 1n;
const CLOSE_ACCOUNT = 9;

// Measured on mainnet: a first deposit (token account, deposit, farm account, stake) uses about 253k compute units,
// a withdrawal of staked shares about 262k
export const KAMINO_VAULT_COMPUTE_UNITS = 400_000;

// SOL a first deposit may take for rent: the shares token account and the farm account. Measured at 0.0068 SOL.
const MAX_SETUP_SOL = 0.02;

export type KaminoVault = Extract<DirectDeposit, { kind: 'kamino-vault' }>;

const kaminoApi = axios.create({ baseURL: process.env.KAMINO_API_URL || 'https://api.kamino.finance', timeout: 20000 });

/**
 * Refuse a vault transaction that does more than deposit into or withdraw from this vault. `raw` is the deposit in
 * the token's base units, or the shares a withdrawal redeems. `all`: the withdrawal is every share the user holds.
 */
function assertVaultOnly(
  instructions: TransactionInstruction[],
  user: PublicKey,
  vault: KaminoVault,
  token: TokenInfo,
  raw: bigint,
  action: 'deposit' | 'withdrawal',
  all: boolean
) {
  const refuse = (why: string): never => {
    logger.warn(`Kamino vault ${action} for ${user.toBase58()} refused: ${why}`);
    throw new DepositError(`Kamino's ${action} service returned an unexpected transaction. Try again shortly.`, 502);
  };
  const mints = new Set([token.mint, vault.shares.mint]);
  const sharesAccount = getAssociatedTokenAddressSync(new PublicKey(vault.shares.mint), user, true);
  let vaultInstructions = 0;

  for (const ix of instructions) {
    const program = ix.programId.toBase58();
    if (!ALLOWED_PROGRAMS.has(program)) refuse(`unexpected program ${program}`);
    if (ix.programId.equals(KAMINO_VAULT_PROGRAM)) {
      // The vault's state is the second account of each of its instructions, the amount follows the discriminator
      if (ix.keys[1]?.pubkey.toBase58() !== vault.vault) refuse('another vault');
      const amount = ix.data.length >= 16 ? ix.data.readBigUInt64LE(8) : null;
      if (amount !== raw && !(all && action === 'withdrawal' && amount === ALL_SHARES)) refuse('another amount');
      vaultInstructions += 1;
    }
    // The token program only closes the emptied shares account after a full withdrawal, its rent back to the user
    if (ix.programId.equals(TOKEN_PROGRAM_ID)) {
      const isClose = ix.data.length === 1 && ix.data[0] === CLOSE_ACCOUNT;
      if (!all || !isClose || !ix.keys[0]?.pubkey.equals(sharesAccount) || !ix.keys[1]?.pubkey.equals(user) || !ix.keys[2]?.pubkey.equals(user)) {
        refuse(`token instruction ${ix.data[0]}`);
      }
    }
    if (ix.programId.equals(KAMINO_FARMS_PROGRAM) && !ix.keys.some((key) => key.pubkey.toBase58() === vault.farm)) refuse('another farm');
    // Creating a token account: only the user's own, for the token or the vault's shares
    if (ix.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID) && (!ix.keys[2]?.pubkey.equals(user) || !mints.has(ix.keys[3]?.pubkey.toBase58() ?? ''))) {
      refuse('token account for someone else');
    }
  }
  if (vaultInstructions !== 1) refuse(`${vaultInstructions} vault instructions`);
}

/**
 * Kamino's transaction for this vault, checked, with a tighter compute limit and a priority fee
 */
export async function kaminoVaultTransaction(
  connection: Connection,
  vault: KaminoVault,
  token: TokenInfo,
  user: PublicKey,
  action: 'deposit' | 'withdrawal',
  amount: string, // deposit: the token, UI units. Withdrawal: shares, UI units.
  raw: bigint, // the same amount in base units
  all = false // a withdrawal of every share the user holds
): Promise<{ transaction: VersionedTransaction; lastValidBlockHeight: number }> {
  if (token.mint === TOKENS.SOL.mint) throw new DepositError('Hermes lists Kamino vaults for USDC and USDT only.', 422);
  let encoded: string | undefined;
  try {
    const { data } = await kaminoApi.post(`/ktx/kvault/${action === 'deposit' ? 'deposit' : 'withdraw'}`, {
      wallet: user.toBase58(),
      kvault: vault.vault,
      amount,
    });
    encoded = data?.transaction;
  } catch (error) {
    const detail = axios.isAxiosError(error) ? `${error.response?.status ?? ''} ${JSON.stringify(error.response?.data ?? error.message)}` : error;
    logger.warn(`Kamino vault ${action} API failed: ${detail}`);
  }
  if (!encoded) throw new DepositError(`Kamino's ${action} service is unavailable. Try again shortly.`, 503);

  const kaminoTransaction = VersionedTransaction.deserialize(Buffer.from(encoded, 'base64'));
  // The only signer must be the user's wallet, paying its own fees
  if (kaminoTransaction.message.header.numRequiredSignatures !== 1 || !kaminoTransaction.message.staticAccountKeys[0].equals(user)) {
    logger.warn(`Kamino vault ${action} API returned a transaction with unexpected signers for ${user.toBase58()}`);
    throw new DepositError(`Kamino's ${action} service returned an unexpected transaction. Try again shortly.`, 502);
  }
  const lookupTables = await loadLookupTables(connection, kaminoTransaction);
  const message = TransactionMessage.decompile(kaminoTransaction.message, { addressLookupTableAccounts: lookupTables });
  const instructions = message.instructions.filter((ix) => !ix.programId.equals(ComputeBudgetProgram.programId));
  assertVaultOnly(instructions, user, vault, token, raw, action, all);

  const budget = await depositBudgetInstructions(connection, [new PublicKey(vault.vault)], KAMINO_VAULT_COMPUTE_UNITS);
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  const transaction = new VersionedTransaction(
    new TransactionMessage({ payerKey: user, recentBlockhash: blockhash, instructions: [...budget, ...instructions] }).compileToV0Message(lookupTables)
  );
  return { transaction, lastValidBlockHeight };
}

function describeDepositError(logs: string[], token: TokenInfo): string {
  const text = logs.join(' ');
  if (/insufficient lamports|no record of a prior credit/i.test(text)) {
    return 'Not enough SOL. Keep SOL for network fees and, on a first deposit, about 0.007 SOL of account rent.';
  }
  if (/insufficient funds/i.test(text)) return `Insufficient ${token.symbol} balance for this deposit.`;
  if (/DepositAmountBelowMinimum/.test(text)) return `This is below the vault's minimum deposit. Try 1 ${token.symbol} or more.`;
  // Kamino's error names, not its logs: every vault log line mentions its cap
  if (/Error Code: \w*(Cap|Limit)\w*/i.test(text)) return 'The vault is not taking this deposit right now. Try a smaller amount or try later.';
  return 'Kamino rejected this deposit in simulation. Try a smaller amount or try again shortly.';
}

export interface KaminoVaultDepositPlan {
  transaction: VersionedTransaction;
  lastValidBlockHeight: number;
  setupCostSol: string; // one-time rent on a first deposit, "0" after that
}

/**
 * A deposit of `raw` base units of the token into the vault, checked and simulated
 */
export async function buildKaminoVaultDeposit(connection: Connection, vault: KaminoVault, token: TokenInfo, raw: bigint, user: PublicKey): Promise<KaminoVaultDepositPlan> {
  const amount = new Decimal(raw.toString()).div(new Decimal(10).pow(token.decimals)).toFixed();
  const { transaction, lastValidBlockHeight } = await kaminoVaultTransaction(connection, vault, token, user, 'deposit', amount, raw);

  const tokenAccount = getAssociatedTokenAddressSync(new PublicKey(token.mint), user, true);
  const [lamportsBefore, tokenInfo, simulation, fee] = await Promise.all([
    connection.getBalance(user),
    connection.getAccountInfo(tokenAccount),
    connection.simulateTransaction(transaction, {
      sigVerify: false,
      accounts: { encoding: 'base64', addresses: [user.toBase58(), tokenAccount.toBase58()] },
    }),
    connection.getFeeForMessage(transaction.message),
  ]);
  if (!tokenInfo) throw new DepositError(`This wallet has no ${token.symbol}.`, 422);
  if (simulation.value.err) {
    const logs = simulation.value.logs ?? [];
    logger.warn(`Kamino vault ${token.symbol} deposit failed simulation: ${JSON.stringify(simulation.value.err)} ${logs.slice(-4).join(' | ')}`);
    throw new DepositError(describeDepositError(logs, token), 422);
  }

  const lamportsAfter = simulation.value.accounts?.[0]?.lamports;
  if (lamportsAfter == null || fee.value == null) throw new DepositError('The deposit could not be checked. Try again shortly.', 503);
  const tokenBefore = unpackAccount(tokenAccount, tokenInfo).amount;
  const tokenAfter = tokenAmount(Buffer.from(simulation.value.accounts?.[1]?.data?.[0] ?? '', 'base64'));
  const setupLamports = BigInt(lamportsBefore) - BigInt(lamportsAfter) - BigInt(fee.value);
  // No more than the deposit, and SOL only for rent. Anything more is not this deposit.
  const out = tokenBefore - tokenAfter;
  if (out <= 0n || out > raw || setupLamports > BigInt(Math.round(MAX_SETUP_SOL * 1e9))) {
    logger.warn(`Kamino vault deposit for ${user.toBase58()} refused: ${out} ${token.symbol} out for ${raw}, ${setupLamports} lamports`);
    throw new DepositError("Kamino's deposit service returned an unexpected transaction. Try again shortly.", 502);
  }
  return {
    transaction,
    lastValidBlockHeight,
    setupCostSol: new Decimal((setupLamports > 0n ? setupLamports : 0n).toString()).div(1e9).toFixed(),
  };
}
