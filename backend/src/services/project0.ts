import Decimal from 'decimal.js';
import {
  Connection,
  PublicKey,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync, unpackAccount } from '@solana/spl-token';
import { logger } from '../utils/logger';
import { DirectDeposit, TokenInfo } from '../registry/routes';
import { depositBudgetInstructions } from './compute-budget';
import { DepositError } from './errors';
import { tokenAmount } from './jupiter-lend-deposit';

/**
 * Project 0 (formerly marginfi) lending banks, mainnet only.
 *
 * Hermes builds the instructions itself from the program's interface (IDL 0.1.12): no SDK and no third-party API.
 * Project 0's own API refuses outside callers, so rates are read from each bank's account on chain.
 *
 * Each deposit goes into the wallet's own Project 0 account for that token: a PDA of the wallet at a fixed index that
 * Hermes opens on the first deposit (about 0.0124 SOL of rent). A Hermes account only ever holds that one deposit, so
 * a withdrawal never touches other balances or loans, and a full withdrawal closes the account and returns its rent.
 * The position shows in Project 0's app too, where it can be managed as well.
 */

export const PROJECT0_PROGRAM = new PublicKey('MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA');

export type Project0Deposit = Extract<DirectDeposit, { kind: 'project0' }>;

// Bank account layout (byte offsets, discriminator included)
const BANK_SIZE = 3912;
const BANK_MINT = 8;
const BANK_DECIMALS = 40;
const BANK_GROUP = 41;
const BANK_ASSET_SHARE_VALUE = 80;
const BANK_LIABILITY_SHARE_VALUE = 96;
const BANK_LIQUIDITY_VAULT = 112;
const BANK_TOTAL_LIABILITY_SHARES = 256;
const BANK_TOTAL_ASSET_SHARES = 272;
const BANK_OPERATIONAL_STATE = 608;
const BANK_ORACLE_KEYS = 610;
const BANK_LENDING_RATE = 1380; // the cache's spot lending APR, a u32 where u32::MAX is 1000%
const BANK_ORACLE_PRICE = 1408; // the cache's last oracle price in USD, and when it was read
const BANK_ORACLE_PRICE_AT = 1424;
const OPERATIONAL = 1;

// Account layout: its 16 balances start at byte 72, 104 bytes each
const ACCOUNT_SIZE = 2312;
const ACCOUNT_AUTHORITY = 40;
const BALANCES = 72;
const BALANCE_SIZE = 104;
const BALANCE_COUNT = 16;
const BALANCE_BANK = 1;
const BALANCE_ASSET_SHARES = 40;
const BALANCE_LIABILITY_SHARES = 56;

const DISCRIMINATORS = {
  initializePda: [87, 177, 91, 80, 218, 119, 245, 31],
  deposit: [171, 94, 235, 103, 82, 64, 212, 140],
  withdraw: [36, 72, 74, 19, 210, 210, 192, 192],
  close: [186, 221, 93, 34, 50, 97, 194, 241],
};

// Measured on mainnet: opening the account and depositing uses about 57k compute units
const PROJECT0_COMPUTE_UNITS = 150_000;
// SOL a first deposit may take for the account's rent. Measured at 0.0124 SOL.
const MAX_SETUP_SOL = 0.02;

// A signed 128-bit fixed point number with 48 fractional bits (I80F48)
function i80f48(data: Buffer, offset: number): Decimal {
  let raw = data.readBigUInt64LE(offset) + (data.readBigUInt64LE(offset + 8) << 64n);
  if (raw >= 1n << 127n) raw -= 1n << 128n;
  return new Decimal(raw.toString()).div(new Decimal(2).pow(48));
}

export interface Project0Bank {
  mint: string;
  decimals: number;
  deposits: Decimal; // in the token, UI units
  borrowed: Decimal;
  lendingApr: number; // what lenders earn, decimal
  operational: boolean; // takes deposits
  vault: PublicKey;
  oracle: PublicKey;
  assetShareValue: Decimal; // base units of the token per share
  price: number; // USD, the oracle price the bank last used
  priceAt: number; // ms
}

/**
 * Read a bank account. Refuses one that isn't Project 0's or isn't in the group, so a layout change fails loudly.
 */
export function readBank(owner: PublicKey, data: Buffer, group: string): Project0Bank {
  if (!owner.equals(PROJECT0_PROGRAM) || data.length !== BANK_SIZE) throw new Error('not a Project 0 bank');
  if (new PublicKey(data.subarray(BANK_GROUP, BANK_GROUP + 32)).toBase58() !== group) throw new Error('bank is in another group');
  const decimals = data[BANK_DECIMALS];
  const unit = new Decimal(10).pow(decimals);
  const assetShareValue = i80f48(data, BANK_ASSET_SHARE_VALUE);
  return {
    mint: new PublicKey(data.subarray(BANK_MINT, BANK_MINT + 32)).toBase58(),
    decimals,
    deposits: i80f48(data, BANK_TOTAL_ASSET_SHARES).mul(assetShareValue).div(unit),
    borrowed: i80f48(data, BANK_TOTAL_LIABILITY_SHARES).mul(i80f48(data, BANK_LIABILITY_SHARE_VALUE)).div(unit),
    lendingApr: (data.readUInt32LE(BANK_LENDING_RATE) / 0xffffffff) * 10,
    operational: data[BANK_OPERATIONAL_STATE] === OPERATIONAL,
    vault: new PublicKey(data.subarray(BANK_LIQUIDITY_VAULT, BANK_LIQUIDITY_VAULT + 32)),
    oracle: new PublicKey(data.subarray(BANK_ORACLE_KEYS, BANK_ORACLE_KEYS + 32)),
    assetShareValue,
    price: i80f48(data, BANK_ORACLE_PRICE).toNumber(),
    priceAt: Number(data.readBigInt64LE(BANK_ORACLE_PRICE_AT)) * 1000,
  };
}

/**
 * The wallet's Hermes account for this route: a PDA of the group, the wallet and the route's account index
 */
export function project0Account(route: Project0Deposit, user: PublicKey): PublicKey {
  const index = Buffer.alloc(2);
  index.writeUInt16LE(route.accountIndex);
  const thirdParty = Buffer.alloc(2); // none
  return PublicKey.findProgramAddressSync(
    [Buffer.from('marginfi_account'), new PublicKey(route.group).toBuffer(), user.toBuffer(), index, thirdParty],
    PROJECT0_PROGRAM
  )[0];
}

export interface Project0Position {
  account: PublicKey;
  exists: boolean;
  amount: Decimal; // the deposit now, in the token's base units
  borrows: boolean; // the account owes something (opened elsewhere and borrowed against): Hermes won't touch it
  others: boolean; // the account holds another balance too
}

/**
 * What the wallet's Hermes account holds in the route's bank, from the account and the bank's share value
 */
export function readPosition(account: PublicKey, info: { owner: PublicKey; data: Buffer } | null, route: Project0Deposit, bank: Project0Bank, user: PublicKey): Project0Position {
  const empty = { account, exists: false, amount: new Decimal(0), borrows: false, others: false };
  if (!info) return empty;
  const { data } = info;
  if (!info.owner.equals(PROJECT0_PROGRAM) || data.length !== ACCOUNT_SIZE) throw new Error('not a Project 0 account');
  if (!new PublicKey(data.subarray(ACCOUNT_AUTHORITY, ACCOUNT_AUTHORITY + 32)).equals(user)) throw new Error('Project 0 account of another wallet');
  let shares = new Decimal(0);
  let borrows = false;
  let others = false;
  for (let i = 0; i < BALANCE_COUNT; i++) {
    const at = BALANCES + i * BALANCE_SIZE;
    if (data[at] === 0) continue;
    if (i80f48(data, at + BALANCE_LIABILITY_SHARES).gt(0)) borrows = true;
    if (new PublicKey(data.subarray(at + BALANCE_BANK, at + BALANCE_BANK + 32)).toBase58() === route.bank) shares = shares.plus(i80f48(data, at + BALANCE_ASSET_SHARES));
    else others = true;
  }
  return { ...empty, exists: true, amount: shares.mul(bank.assetShareValue).floor(), borrows, others };
}

function u16(value: number): Buffer {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value);
  return buffer;
}

function u64(value: bigint): Buffer {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(value);
  return buffer;
}

const readOnly = (pubkey: PublicKey) => ({ pubkey, isSigner: false, isWritable: false });
const writable = (pubkey: PublicKey) => ({ pubkey, isSigner: false, isWritable: true });

function initializeInstruction(route: Project0Deposit, account: PublicKey, user: PublicKey): TransactionInstruction {
  return new TransactionInstruction({
    programId: PROJECT0_PROGRAM,
    // account_index, then third_party_id: None
    data: Buffer.concat([Buffer.from(DISCRIMINATORS.initializePda), u16(route.accountIndex), Buffer.from([0])]),
    keys: [
      readOnly(new PublicKey(route.group)),
      writable(account),
      { pubkey: user, isSigner: true, isWritable: false },
      { pubkey: user, isSigner: true, isWritable: true }, // fee payer
      readOnly(SYSVAR_INSTRUCTIONS_PUBKEY),
      readOnly(SystemProgram.programId),
    ],
  });
}

function depositInstruction(route: Project0Deposit, bank: Project0Bank, account: PublicKey, user: PublicKey, source: PublicKey, raw: bigint) {
  return new TransactionInstruction({
    programId: PROJECT0_PROGRAM,
    // amount, then deposit_up_to_limit: None
    data: Buffer.concat([Buffer.from(DISCRIMINATORS.deposit), u64(raw), Buffer.from([0])]),
    keys: [
      readOnly(new PublicKey(route.group)),
      writable(account),
      { pubkey: user, isSigner: true, isWritable: false },
      writable(new PublicKey(route.bank)),
      writable(source),
      writable(bank.vault),
      readOnly(TOKEN_PROGRAM_ID),
    ],
  });
}

/**
 * Withdraw `raw` base units, or everything (`raw` null). Part of a deposit runs the program's health check, which
 * needs the bank and its oracle. Everything leaves no balance to check.
 */
export function withdrawInstruction(route: Project0Deposit, bank: Project0Bank, account: PublicKey, user: PublicKey, destination: PublicKey, raw: bigint | null) {
  const bankKey = new PublicKey(route.bank);
  const [vaultAuthority] = PublicKey.findProgramAddressSync([Buffer.from('liquidity_vault_auth'), bankKey.toBuffer()], PROJECT0_PROGRAM);
  return new TransactionInstruction({
    programId: PROJECT0_PROGRAM,
    // amount, then withdraw_all: Some(true) for everything, None otherwise
    data: Buffer.concat([Buffer.from(DISCRIMINATORS.withdraw), u64(raw ?? 0n), raw === null ? Buffer.from([1, 1]) : Buffer.from([0])]),
    keys: [
      readOnly(new PublicKey(route.group)),
      writable(account),
      { pubkey: user, isSigner: true, isWritable: false },
      writable(bankKey),
      writable(destination),
      readOnly(vaultAuthority),
      writable(bank.vault),
      readOnly(TOKEN_PROGRAM_ID),
      ...(raw === null ? [] : [readOnly(bankKey), readOnly(bank.oracle)]),
    ],
  });
}

/**
 * Close the wallet's emptied Hermes account, its rent back to the wallet
 */
export function closeInstruction(account: PublicKey, user: PublicKey): TransactionInstruction {
  const [feePool] = PublicKey.findProgramAddressSync([Buffer.from('rebalance_fee_pool'), account.toBuffer()], PROJECT0_PROGRAM);
  return new TransactionInstruction({
    programId: PROJECT0_PROGRAM,
    data: Buffer.from(DISCRIMINATORS.close),
    keys: [writable(account), { pubkey: user, isSigner: true, isWritable: false }, { pubkey: user, isSigner: true, isWritable: true }, readOnly(feePool)],
  });
}

/**
 * The bank and the wallet's position in it, read together
 */
export async function project0Position(connection: Connection, route: Project0Deposit, token: TokenInfo, user: PublicKey) {
  const account = project0Account(route, user);
  const [bankInfo, accountInfo] = await connection.getMultipleAccountsInfo([new PublicKey(route.bank), account]);
  if (!bankInfo) throw new DepositError("Project 0's bank is unavailable right now. Try again shortly.", 503);
  const bank = readBank(bankInfo.owner, bankInfo.data, route.group);
  if (bank.mint !== token.mint) throw new Error(`Project 0 bank ${route.bank} is not ${token.symbol}`);
  return { bank, position: readPosition(account, accountInfo, route, bank, user) };
}

function describeDepositError(logs: string[], token: TokenInfo): string {
  const text = logs.join(' ');
  if (/insufficient lamports|no record of a prior credit/i.test(text)) {
    return 'Not enough SOL. Keep SOL for network fees and, on a first deposit, about 0.0124 SOL of account rent.';
  }
  if (/insufficient funds/i.test(text)) return `Insufficient ${token.symbol} balance for this deposit.`;
  if (/BankAssetCapacityExceeded|DepositLimit|capacity/i.test(text)) return `Project 0's ${token.symbol} bank is full. Try a smaller amount or try later.`;
  return 'Project 0 rejected this deposit in simulation. Try a smaller amount or try again shortly.';
}

export interface Project0DepositPlan {
  transaction: VersionedTransaction;
  lastValidBlockHeight: number;
  setupCostSol: string; // the account's rent on a first deposit, "0" after that
}

/**
 * A deposit of `raw` base units into the route's bank, through the wallet's Hermes account, simulated before it is
 * returned: exactly the deposit leaves the wallet, and SOL only for the account's rent
 */
export async function buildProject0Deposit(connection: Connection, route: Project0Deposit, token: TokenInfo, raw: bigint, user: PublicKey): Promise<Project0DepositPlan> {
  const { bank, position } = await project0Position(connection, route, token, user);
  if (!bank.operational) throw new DepositError(`Project 0's ${token.symbol} bank is not taking deposits right now.`, 422);
  if (position.borrows) {
    throw new DepositError('This wallet borrows from the Project 0 account Hermes uses. Manage it at app.0.xyz.', 422);
  }

  const source = getAssociatedTokenAddressSync(new PublicKey(token.mint), user, true);
  const instructions = [
    ...(position.exists ? [] : [initializeInstruction(route, position.account, user)]),
    depositInstruction(route, bank, position.account, user, source, raw),
  ];
  const budget = await depositBudgetInstructions(connection, [new PublicKey(route.bank)], PROJECT0_COMPUTE_UNITS);
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  const transaction = new VersionedTransaction(
    new TransactionMessage({ payerKey: user, recentBlockhash: blockhash, instructions: [...budget, ...instructions] }).compileToV0Message()
  );

  const [lamportsBefore, sourceInfo, simulation, fee] = await Promise.all([
    connection.getBalance(user),
    connection.getAccountInfo(source),
    connection.simulateTransaction(transaction, {
      sigVerify: false,
      accounts: { encoding: 'base64', addresses: [user.toBase58(), source.toBase58()] },
    }),
    connection.getFeeForMessage(transaction.message),
  ]);
  if (!sourceInfo) throw new DepositError(`This wallet has no ${token.symbol}.`, 422);
  if (simulation.value.err) {
    const logs = simulation.value.logs ?? [];
    logger.warn(`Project 0 ${token.symbol} deposit failed simulation: ${JSON.stringify(simulation.value.err)} ${logs.slice(-4).join(' | ')}`);
    throw new DepositError(describeDepositError(logs, token), 422);
  }
  const lamportsAfter = simulation.value.accounts?.[0]?.lamports;
  if (lamportsAfter == null || fee.value == null) throw new DepositError('The deposit could not be checked. Try again shortly.', 503);
  const out = unpackAccount(source, sourceInfo).amount - tokenAmount(Buffer.from(simulation.value.accounts?.[1]?.data?.[0] ?? '', 'base64'));
  const setupLamports = BigInt(lamportsBefore) - BigInt(lamportsAfter) - BigInt(fee.value);
  if (out !== raw || setupLamports > BigInt(Math.round(MAX_SETUP_SOL * 1e9))) {
    logger.warn(`Project 0 deposit for ${user.toBase58()} refused: ${out} ${token.symbol} out for ${raw}, ${setupLamports} lamports`);
    throw new DepositError('The deposit could not be checked. Try again shortly.', 502);
  }
  return {
    transaction,
    lastValidBlockHeight,
    setupCostSol: new Decimal((setupLamports > 0n ? setupLamports : 0n).toString()).div(1e9).toFixed(),
  };
}
