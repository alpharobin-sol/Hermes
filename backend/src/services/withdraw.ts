import axios from 'axios';
import Decimal from 'decimal.js';
import {
  ComputeBudgetProgram,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import {
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createCloseAccountInstruction,
  getAssociatedTokenAddressSync,
  unpackAccount,
} from '@solana/spl-token';
import { logger } from '../utils/logger';
import { solanaNetwork } from '../config/runtime';
import { depositStatus, getRoute, KAMINO_MAIN_MARKET, RouteConfig, TokenInfo, TOKENS } from '../registry/routes';
import { connection, getRate } from './rates';
import { createJupiterClient } from './jupiter';
import { DepositError } from './errors';
import { assertUserOnlySigner } from './deposit';
import { assertKaminoOnly, loadLookupTables } from './kamino-deposit';
import { JUPITER_LEND_PROGRAM, tokenAmount } from './jupiter-lend-deposit';
import { depositBudgetInstructions } from './compute-budget';
import { kaminoDeposit, kaminoVaultShares } from './portfolio';
import { KaminoVault, kaminoVaultTransaction } from './kamino-vault';
import { closeInstruction, Project0Deposit, project0Position, withdrawInstruction } from './project0';

/**
 * HERMES WITHDRAWALS
 * Builds unsigned withdrawal transactions for positions in Hermes's routes, for the user's wallet to sign. Mainnet.
 *
 * - Liquid staking: swap the token back to SOL on Jupiter at the market price. The quote carries what the tokens
 *   are worth in their pool, so the exit cost is plain. Checked like a deposit swap: the user is the only signer,
 *   and Jupiter's swap instruction holds the SOL received to the quote's minimum.
 * - Kamino Lend: Kamino's transaction API builds it, the one the Kamino app uses, from the wallet's main Kamino
 *   account. Checked like a Kamino deposit (only the programs it uses, no top-level token transfer, wrapped SOL only
 *   between the user's own accounts), then simulated: SOL must not leave the wallet beyond fees.
 * - Jupiter Lend: Jupiter's withdraw instruction, or for the whole position its redeem instruction (every jl token,
 *   no dust). Jupiter Lend's program only and the user the only signer, like the deposit.
 * - Kamino vaults: Kamino's transaction API unstakes the shares and redeems them for the token. Checked like the
 *   vault's deposit: this vault, this farm, the shares asked for, and the user's own token accounts only.
 * - Project 0: Hermes builds the withdrawal from the program's interface, out of the wallet's own Project 0 account
 *   for that token. The whole position also closes the account, which returns its rent.
 *
 * Lending withdrawals are limited by what the reserve can pay out right now, so the quote says how much that is.
 * Every withdrawal is simulated before the user signs it, and what lands is read from the simulation.
 */

export interface WithdrawRequest {
  routeId: string;
  amount?: string | number; // liquid staking: tokens to sell (JitoSOL). Lending: the route's token to take out.
  all?: boolean; // the whole position
  userPublicKey: string;
}

export interface WithdrawQuote {
  routeId: string;
  method: 'jupiter-swap' | 'direct';
  inputToken: TokenInfo; // what leaves the position: the staking token, or the lent token
  outputToken: TokenInfo; // what lands in the wallet
  inAmount: string; // UI units
  outAmount: string; // UI units, expected
  minOutAmount: string; // UI units, the least that lands
  priceImpactPct: number;
  slippageBps: number;
  routeLabels: string[];
  value: string | null; // staking tokens: what they are worth in their pool, in SOL, so the exit cost shows
  held: string; // the whole position, in inputToken
  available: string | null; // lending: what the reserve can pay out right now, in the route's token
  position: string | null; // lending: "Kamino Lend", "Jupiter Lend", "Project 0" or the vault's name
  rentBackSol: string | null; // a full Kamino or Project 0 exit closes the account and returns its rent, in SOL
}

export interface WithdrawTransaction {
  quote: WithdrawQuote;
  transaction: string; // base64 VersionedTransaction, unsigned
  lastValidBlockHeight: number;
}

const MAX_EXIT_IMPACT_PCT = Number(process.env.WITHDRAW_MAX_PRICE_IMPACT_PCT || 3);
// SOL a withdrawal may take beyond the network fee: a token account for what lands (about 0.002 SOL)
const MAX_SETUP_SOL = 0.01;
// Measured by simulation: a Kamino withdrawal with reserve and account refreshes uses about 150k compute units
const KAMINO_WITHDRAW_UNITS = 400_000;
const JUPITER_LEND_WITHDRAW_UNITS = 200_000;
// Measured by simulation: a Project 0 withdrawal with its health check, or a full one with the account's close
const PROJECT0_WITHDRAW_UNITS = 200_000;

const swapApi = createJupiterClient('swap/v1', process.env.JUPITER_API_URL);
const lendApi = createJupiterClient('lend/v1', process.env.JUPITER_LEND_API_URL);
const kaminoApi = axios.create({ baseURL: process.env.KAMINO_API_URL || 'https://api.kamino.finance', timeout: 20000 });

const raw = (amount: string | number, decimals: number) => BigInt(new Decimal(amount).mul(new Decimal(10).pow(decimals)).floor().toFixed(0));
const ui = (amount: bigint | string | number, decimals: number) => new Decimal(amount.toString()).div(new Decimal(10).pow(decimals)).toFixed();
const host = (url: string) => new URL(url).host.replace(/^www\./, '');

function resolve(request: WithdrawRequest): { route: RouteConfig; user: PublicKey } {
  if (solanaNetwork() !== 'mainnet-beta') throw new DepositError('Withdrawals run on mainnet only.', 422);
  const route = getRoute(request.routeId);
  if (!route || !depositStatus(route, 'mainnet-beta')) throw new DepositError(`Hermes can't withdraw from ${request.routeId}.`, 404);
  if (!request.all && !(Number(request.amount) > 0)) throw new DepositError('Enter an amount to withdraw.');
  return { route, user: new PublicKey(request.userPublicKey) };
}

async function tokenBalance(account: PublicKey): Promise<bigint> {
  const info = await connection.getAccountInfo(account);
  return info ? unpackAccount(account, info, TOKEN_PROGRAM_ID).amount : 0n;
}

// ---------- Liquid staking: swap back to SOL ----------

async function quoteStaked(route: RouteConfig, request: WithdrawRequest, user: PublicKey) {
  const receipt = route.receipt!;
  const sol = TOKENS.SOL;
  const held = await tokenBalance(getAssociatedTokenAddressSync(new PublicKey(receipt.mint), user, true, TOKEN_PROGRAM_ID));
  const amount = request.all ? held : raw(request.amount!, receipt.decimals);
  if (held <= 0n) throw new DepositError(`This wallet holds no ${receipt.symbol}.`, 422);
  if (amount > held) throw new DepositError(`This wallet holds ${ui(held, receipt.decimals)} ${receipt.symbol}.`, 422);

  const { data: rawQuote } = await swapApi.get('/quote', {
    params: { inputMint: receipt.mint, outputMint: sol.mint, amount: amount.toString(), slippageBps: 50 },
  });
  const priceImpactPct = Number(rawQuote.priceImpactPct) * 100;
  if (priceImpactPct > MAX_EXIT_IMPACT_PCT) {
    throw new DepositError(
      `Price impact is ${priceImpactPct.toFixed(2)}% selling ${receipt.symbol}. Try a smaller amount, or unstake at ${host(route.website)}.`,
      422
    );
  }
  const tokenValue = (await getRate(route.source))?.tokenValue;
  const inAmount = ui(amount, receipt.decimals);
  const quote: WithdrawQuote = {
    routeId: route.id,
    method: 'jupiter-swap',
    inputToken: receipt,
    outputToken: sol,
    inAmount,
    outAmount: ui(rawQuote.outAmount, sol.decimals),
    minOutAmount: ui(rawQuote.otherAmountThreshold, sol.decimals),
    priceImpactPct,
    slippageBps: rawQuote.slippageBps,
    routeLabels: (rawQuote.routePlan || []).map((step: any) => step.swapInfo?.label).filter(Boolean),
    value: tokenValue ? new Decimal(inAmount).mul(tokenValue).toFixed(9) : null,
    held: ui(held, receipt.decimals),
    available: null,
    position: null,
    rentBackSol: null,
  };
  return { quote, rawQuote };
}

async function buildStaked(route: RouteConfig, request: WithdrawRequest, user: PublicKey): Promise<WithdrawTransaction> {
  const { quote, rawQuote } = await quoteStaked(route, request, user);
  const { data } = await swapApi.post('/swap', {
    quoteResponse: rawQuote,
    userPublicKey: user.toBase58(),
    wrapAndUnwrapSol: true,
    dynamicComputeUnitLimit: true,
    prioritizationFeeLamports: { priorityLevelWithMaxLamports: { maxLamports: 1_000_000, priorityLevel: 'high' } },
  });
  if (data.simulationError) {
    logger.warn(`Withdrawal swap failed simulation (${route.id}): ${JSON.stringify(data.simulationError)}`);
    throw new DepositError(`Selling ${quote.inputToken.symbol} failed in simulation. Try a smaller amount or try again shortly.`, 422);
  }
  // Many programs take part in a swap, so its instructions can't be allow-listed. The user is the only signer,
  // and Jupiter's swap instruction holds the SOL received to the quote's minimum on chain.
  assertUserOnlySigner(data.swapTransaction, user.toBase58());
  logger.info(`Built withdrawal swap: ${quote.inAmount} ${quote.inputToken.symbol} -> SOL`);
  return { quote, transaction: data.swapTransaction, lastValidBlockHeight: data.lastValidBlockHeight };
}

// ---------- Lending ----------

// What the reserve can pay out right now, in the route's token, from its live rate
async function availableNow(route: RouteConfig): Promise<number | null> {
  const rate = await getRate(route.source);
  if (rate?.deposits === undefined) return null;
  if (rate.utilization !== undefined) return rate.deposits * Math.max(0, 1 - rate.utilization);
  if (rate.withdrawable !== undefined) return rate.deposits * rate.withdrawable;
  return null;
}

function lendingQuote(route: RouteConfig, amount: string, held: string, available: number | null, label: string): WithdrawQuote {
  const token = TOKENS[route.token];
  return {
    routeId: route.id,
    method: 'direct',
    inputToken: token,
    outputToken: token,
    inAmount: amount,
    outAmount: amount,
    minOutAmount: amount,
    priceImpactPct: 0,
    slippageBps: 0,
    routeLabels: [label],
    value: null,
    held,
    available: available === null ? null : new Decimal(available).toDecimalPlaces(token.decimals, Decimal.ROUND_DOWN).toFixed(),
    position: label,
    rentBackSol: null,
  };
}

function checkAmount(route: RouteConfig, amount: Decimal, held: Decimal, available: number | null, label: string) {
  const token = TOKENS[route.token];
  if (held.lte(0)) throw new DepositError(`This wallet has no ${token.symbol} in ${label}.`, 422);
  if (amount.gt(held)) throw new DepositError(`This wallet has ${held.toFixed()} ${token.symbol} in ${label}.`, 422);
  if (available !== null && amount.gt(available)) {
    throw new DepositError(
      `Only ${new Decimal(available).toDecimalPlaces(token.decimals, Decimal.ROUND_DOWN).toFixed()} ${token.symbol} can leave ${label} right now: the rest is lent out. Try a smaller amount or try later.`,
      422
    );
  }
}

/**
 * Simulate a withdrawal, then read what lands in the wallet and the SOL it costs beyond the network fee.
 * SOL lands as SOL, unless `wrapped`: then it lands as wrapped SOL in the wallet's own wrapped SOL account.
 */
async function simulateWithdrawal(
  transaction: VersionedTransaction,
  user: PublicKey,
  token: TokenInfo,
  describe: (logs: string[]) => string,
  wrapped = false
) {
  const isSol = token.mint === TOKENS.SOL.mint && !wrapped;
  const tokenAccount = getAssociatedTokenAddressSync(new PublicKey(token.mint), user, true);
  const [lamportsBefore, tokenBefore, simulation, fee] = await Promise.all([
    connection.getBalance(user),
    isSol ? Promise.resolve(0n) : tokenBalance(tokenAccount),
    connection.simulateTransaction(transaction, {
      sigVerify: false,
      accounts: { encoding: 'base64', addresses: isSol ? [user.toBase58()] : [user.toBase58(), tokenAccount.toBase58()] },
    }),
    connection.getFeeForMessage(transaction.message),
  ]);
  if (simulation.value.err) {
    const logs = simulation.value.logs ?? [];
    logger.warn(`${token.symbol} withdrawal failed simulation: ${JSON.stringify(simulation.value.err)} ${logs.slice(-4).join(' | ')}`);
    throw new DepositError(describe(logs), 422);
  }
  const lamportsAfter = simulation.value.accounts?.[0]?.lamports;
  if (lamportsAfter == null || fee.value == null) throw new DepositError('The withdrawal could not be checked. Try again shortly.', 503);
  const solChange = BigInt(lamportsAfter) - BigInt(lamportsBefore) + BigInt(fee.value);
  const tokenAfter = isSol ? 0n : tokenAmount(Buffer.from(simulation.value.accounts?.[1]?.data?.[0] ?? '', 'base64'));
  const received = isSol ? solChange : tokenAfter - tokenBefore;
  // Beyond the fee, SOL may only go to a token account for what lands. More than that is not a withdrawal.
  const solCost = isSol ? 0n : -solChange;
  if (received <= 0n || solCost > BigInt(MAX_SETUP_SOL * 1e9)) {
    logger.warn(`${token.symbol} withdrawal for ${user.toBase58()} refused: received ${received}, SOL cost ${solCost}`);
    throw new DepositError('The withdrawal service returned an unexpected transaction. Try again shortly.', 502);
  }
  // Network fee aside: what lands in `token`, and the wallet's SOL change (a closed account's rent shows here)
  return { received: new Decimal(ui(received, token.decimals)), solChange: new Decimal(ui(solChange, 9)) };
}

async function quoteKamino(route: RouteConfig, request: WithdrawRequest, user: PublicKey) {
  const token = TOKENS[route.token];
  if (route.source.kind !== 'kamino') throw new Error('not a Kamino route');
  const [{ amount: heldNumber }, available] = await Promise.all([kaminoDeposit(user.toBase58(), route.source.reserve), availableNow(route)]);
  const held = new Decimal(heldNumber).toDecimalPlaces(token.decimals, Decimal.ROUND_DOWN);
  const amount = request.all ? held : new Decimal(request.amount!).toDecimalPlaces(token.decimals, Decimal.ROUND_DOWN);
  checkAmount(route, amount, held, available, 'Kamino Lend');
  return lendingQuote(route, amount.toFixed(), held.toFixed(), available, 'Kamino Lend');
}

function describeKaminoWithdrawal(logs: string[], token: TokenInfo, amount: string): string {
  const text = logs.join(' ');
  if (/insufficient lamports|no record of a prior credit/i.test(text)) return 'Not enough SOL for the network fee.';
  // Loans in the same Kamino account hold part of the deposit as collateral. Kamino logs how much value can leave.
  const limit = text.match(/max_withdraw_value=([\d.]+) withdraw_value=([\d.]+)/);
  if (/WithdrawTooLarge/.test(text) && limit && Number(limit[2]) > 0) {
    const most = new Decimal(amount).mul(Number(limit[1])).div(Number(limit[2])).toDecimalPlaces(token.decimals, Decimal.ROUND_DOWN);
    return `Your Kamino loans hold part of this deposit as collateral. You can withdraw up to about ${most.toFixed()} ${token.symbol} now, or repay at app.kamino.finance first.`;
  }
  if (/NetValueRemainingTooSmall|WorseLTV|Unhealthy|LiquidationThreshold|BorrowLimit|LTV/i.test(text)) {
    return 'This withdrawal would leave your Kamino loans under-covered. Repay at app.kamino.finance first.';
  }
  if (/InsufficientLiquidity|liquidity/i.test(text)) {
    return `Kamino's ${token.symbol} reserve can't pay this out right now: it is lent out. Try a smaller amount or try later.`;
  }
  return 'Kamino rejected this withdrawal in simulation. Try a smaller amount or try again shortly.';
}

async function buildKamino(route: RouteConfig, request: WithdrawRequest, user: PublicKey): Promise<WithdrawTransaction> {
  const quote = await quoteKamino(route, request, user);
  const token = TOKENS[route.token];
  if (route.source.kind !== 'kamino') throw new Error('not a Kamino route');
  const reserve = route.source.reserve;

  // The whole position asks for a little more than Kamino's hourly exchange rate shows: Kamino caps a request at
  // the deposit, so nothing is left behind from interest earned since
  const amount = request.all
    ? new Decimal(quote.held).mul(1.001).toDecimalPlaces(token.decimals, Decimal.ROUND_DOWN).toFixed()
    : quote.inAmount;
  let encoded: string | undefined;
  try {
    const { data } = await kaminoApi.post('/ktx/klend/withdraw', { wallet: user.toBase58(), market: KAMINO_MAIN_MARKET, reserve, amount });
    encoded = data?.transaction;
  } catch (error) {
    const detail = axios.isAxiosError(error) ? `${error.response?.status ?? ''} ${JSON.stringify(error.response?.data ?? error.message)}` : error;
    logger.warn(`Kamino withdraw API failed: ${detail}`);
  }
  if (!encoded) throw new DepositError("Kamino's withdrawal service is unavailable. Try again shortly.", 503);

  const kaminoTransaction = VersionedTransaction.deserialize(Buffer.from(encoded, 'base64'));
  if (kaminoTransaction.message.header.numRequiredSignatures !== 1 || !kaminoTransaction.message.staticAccountKeys[0].equals(user)) {
    logger.warn(`Kamino withdraw API returned a transaction with unexpected signers for ${user.toBase58()}`);
    throw new DepositError("Kamino's withdrawal service returned an unexpected transaction. Try again shortly.", 502);
  }
  const lookupTables = await loadLookupTables(connection, kaminoTransaction);
  const message = TransactionMessage.decompile(kaminoTransaction.message, { addressLookupTableAccounts: lookupTables });
  const instructions = message.instructions.filter((ix) => !ix.programId.equals(ComputeBudgetProgram.programId));
  assertKaminoOnly(instructions, user, token, 'withdrawal');

  const budget = await depositBudgetInstructions(connection, [new PublicKey(reserve)], KAMINO_WITHDRAW_UNITS);
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  const transaction = new VersionedTransaction(
    new TransactionMessage({ payerKey: user, recentBlockhash: blockhash, instructions: [...budget, ...instructions] }).compileToV0Message(lookupTables)
  );
  const { received, solChange } = await simulateWithdrawal(transaction, user, token, (logs) => describeKaminoWithdrawal(logs, token, amount));
  // Emptying the account closes it, which returns the rent paid on the first deposit. Shown apart from the withdrawal.
  const isSol = token.mint === TOKENS.SOL.mint;
  const rentBack = !request.all ? new Decimal(0) : Decimal.max(0, isSol ? received.minus(quote.held) : solChange);
  const withdrawn = isSol ? received.minus(rentBack) : received;
  logger.info(`Built Kamino withdrawal: ${withdrawn.toFixed()} ${token.symbol}${rentBack.gt(0) ? `, ${rentBack.toFixed()} SOL rent back` : ''}`);
  return {
    quote: {
      ...quote,
      outAmount: withdrawn.toFixed(),
      minOutAmount: withdrawn.toFixed(),
      rentBackSol: rentBack.gt(0.00001) ? rentBack.toFixed() : null,
    },
    transaction: Buffer.from(transaction.serialize()).toString('base64'),
    lastValidBlockHeight,
  };
}

// The wallet's shares in the vault and what one share is worth, in the route's token
async function vaultPosition(route: RouteConfig, user: PublicKey) {
  const vault = route.direct as KaminoVault;
  const [shares, rate] = await Promise.all([kaminoVaultShares(user.toBase58()), getRate(route.source)]);
  if (!rate?.tokenValue) throw new DepositError(`${route.name}'s share value is unavailable right now. Try again shortly.`, 503);
  // Kamino reports staked shares with more decimals than the shares token has
  const held = new Decimal(shares.get(vault.vault) ?? 0).toDecimalPlaces(vault.shares.decimals, Decimal.ROUND_DOWN);
  return { vault, shares: held, perShare: new Decimal(rate.tokenValue) };
}

async function quoteVault(route: RouteConfig, request: WithdrawRequest, user: PublicKey) {
  const token = TOKENS[route.token];
  const [position, available] = await Promise.all([vaultPosition(route, user), availableNow(route)]);
  const held = position.shares.mul(position.perShare).toDecimalPlaces(token.decimals, Decimal.ROUND_DOWN);
  const amount = request.all ? held : new Decimal(request.amount!).toDecimalPlaces(token.decimals, Decimal.ROUND_DOWN);
  checkAmount(route, amount, held, available, route.name);
  return { quote: lendingQuote(route, amount.toFixed(), held.toFixed(), available, route.name), position };
}

async function buildVault(route: RouteConfig, request: WithdrawRequest, user: PublicKey): Promise<WithdrawTransaction> {
  const { quote, position } = await quoteVault(route, request, user);
  const token = TOKENS[route.token];
  // Kamino redeems shares. The whole position is every share, part of it the shares the amount is worth.
  const shares = request.all
    ? position.shares
    : Decimal.min(position.shares, new Decimal(quote.inAmount).div(position.perShare).toDecimalPlaces(position.vault.shares.decimals, Decimal.ROUND_DOWN));
  const { transaction, lastValidBlockHeight } = await kaminoVaultTransaction(
    connection,
    position.vault,
    token,
    user,
    'withdrawal',
    shares.toFixed(),
    raw(shares.toFixed(), position.vault.shares.decimals),
    shares.eq(position.shares)
  );
  const { received } = await simulateWithdrawal(transaction, user, token, (logs) =>
    /insufficient lamports|no record of a prior credit/i.test(logs.join(' '))
      ? 'Not enough SOL for the network fee.'
      : `${route.name} can't pay this out right now: its reserves are lent out. Try a smaller amount or try later.`
  );
  logger.info(`Built Kamino vault withdrawal: ${shares.toFixed()} shares of ${route.id} for ${received.toFixed()} ${token.symbol}`);
  return {
    quote: { ...quote, outAmount: received.toFixed(), minOutAmount: received.toFixed() },
    transaction: Buffer.from(transaction.serialize()).toString('base64'),
    lastValidBlockHeight,
  };
}

async function quoteProject0(route: RouteConfig, request: WithdrawRequest, user: PublicKey) {
  const token = TOKENS[route.token];
  const direct = route.direct as Project0Deposit;
  const [{ bank, position }, available] = await Promise.all([project0Position(connection, direct, token, user), availableNow(route)]);
  if (position.borrows) throw new DepositError('This wallet borrows from the Project 0 account Hermes uses. Manage it at app.0.xyz.', 422);
  const held = new Decimal(ui(position.amount.toFixed(0), token.decimals));
  const amount = request.all ? held : new Decimal(request.amount!).toDecimalPlaces(token.decimals, Decimal.ROUND_DOWN);
  checkAmount(route, amount, held, available, 'Project 0');
  return { quote: lendingQuote(route, amount.toFixed(), held.toFixed(), available, 'Project 0'), bank, position };
}

async function buildProject0(route: RouteConfig, request: WithdrawRequest, user: PublicKey): Promise<WithdrawTransaction> {
  const { quote, bank, position } = await quoteProject0(route, request, user);
  const token = TOKENS[route.token];
  const direct = route.direct as Project0Deposit;
  const all = request.all || new Decimal(quote.inAmount).gte(quote.held);
  const destination = getAssociatedTokenAddressSync(new PublicKey(token.mint), user, true);
  const instructions = [
    createAssociatedTokenAccountIdempotentInstruction(user, destination, user, new PublicKey(token.mint)),
    withdrawInstruction(direct, bank, position.account, user, destination, all ? null : raw(quote.inAmount, token.decimals)),
    // An emptied account closes, so its rent comes back. One that holds something else stays open.
    ...(all && !position.others ? [closeInstruction(position.account, user)] : []),
  ];
  const budget = await depositBudgetInstructions(connection, [new PublicKey(direct.bank)], PROJECT0_WITHDRAW_UNITS);
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  const transaction = new VersionedTransaction(
    new TransactionMessage({ payerKey: user, recentBlockhash: blockhash, instructions: [...budget, ...instructions] }).compileToV0Message()
  );
  const { received, solChange } = await simulateWithdrawal(transaction, user, token, (logs) =>
    /insufficient lamports|no record of a prior credit/i.test(logs.join(' '))
      ? 'Not enough SOL for the network fee.'
      : `Project 0's ${token.symbol} bank can't pay this out right now: it is lent out. Try a smaller amount or try later.`
  );
  const rentBack = all && !position.others ? Decimal.max(0, solChange) : new Decimal(0);
  logger.info(`Built Project 0 withdrawal: ${received.toFixed()} ${token.symbol}${rentBack.gt(0) ? `, ${rentBack.toFixed()} SOL rent back` : ''}`);
  return {
    quote: { ...quote, outAmount: received.toFixed(), minOutAmount: received.toFixed(), rentBackSol: rentBack.gt(0.00001) ? rentBack.toFixed() : null },
    transaction: Buffer.from(transaction.serialize()).toString('base64'),
    lastValidBlockHeight,
  };
}

async function jupiterLendPosition(route: RouteConfig, user: PublicKey) {
  const { data } = await lendApi.get('/earn/positions', { params: { users: user.toBase58() } });
  const position = (Array.isArray(data) ? data : []).find((p: any) => p.token?.address === route.receipt!.mint);
  return { shares: BigInt(position?.shares ?? 0), underlying: BigInt(position?.underlyingAssets ?? 0) };
}

async function quoteJupiterLend(route: RouteConfig, request: WithdrawRequest, user: PublicKey) {
  const token = TOKENS[route.token];
  const [position, available] = await Promise.all([jupiterLendPosition(route, user), availableNow(route)]);
  const held = new Decimal(ui(position.underlying, token.decimals));
  const amount = request.all ? held : new Decimal(request.amount!).toDecimalPlaces(token.decimals, Decimal.ROUND_DOWN);
  checkAmount(route, amount, held, available, 'Jupiter Lend');
  return { quote: lendingQuote(route, amount.toFixed(), held.toFixed(), available, 'Jupiter Lend'), position };
}

async function fetchJupiterLendInstructions(path: string, body: object, user: PublicKey): Promise<TransactionInstruction[]> {
  let rawInstructions: any[] | undefined;
  try {
    const { data } = await lendApi.post(path, body);
    rawInstructions = data?.instructions;
  } catch (error) {
    const detail = axios.isAxiosError(error) ? `${error.response?.status ?? ''} ${JSON.stringify(error.response?.data ?? error.message)}` : error;
    logger.warn(`Jupiter Lend withdraw API failed: ${detail}`);
  }
  if (!Array.isArray(rawInstructions) || rawInstructions.length === 0) {
    throw new DepositError("Jupiter Lend's withdrawal service is unavailable. Try again shortly.", 503);
  }
  return rawInstructions.map((ix) => {
    const programId = new PublicKey(ix.programId);
    const keys = (ix.accounts ?? []).map((account: any) => ({
      pubkey: new PublicKey(account.pubkey),
      isSigner: Boolean(account.isSigner),
      isWritable: Boolean(account.isWritable),
    }));
    // Only the Jupiter Lend program, and no signer but the user's wallet
    if (!programId.equals(JUPITER_LEND_PROGRAM) || keys.some((key: { pubkey: PublicKey; isSigner: boolean }) => key.isSigner && !key.pubkey.equals(user))) {
      logger.warn(`Jupiter Lend withdraw API returned an unexpected instruction for ${user.toBase58()}: ${programId.toBase58()}`);
      throw new DepositError("Jupiter Lend's withdrawal service returned an unexpected transaction. Try again shortly.", 502);
    }
    return new TransactionInstruction({ programId, keys, data: Buffer.from(ix.data ?? '', 'base64') });
  });
}

async function buildJupiterLend(route: RouteConfig, request: WithdrawRequest, user: PublicKey): Promise<WithdrawTransaction> {
  const { quote, position } = await quoteJupiterLend(route, request, user);
  const token = TOKENS[route.token];
  const isSol = token.mint === NATIVE_MINT.toBase58();
  const assetAccount = getAssociatedTokenAddressSync(new PublicKey(token.mint), user, true);
  const receiptAccount = getAssociatedTokenAddressSync(new PublicKey(route.receipt!.mint), user, true);

  // The whole position redeems every jl token, so no dust is left. Part of it withdraws an amount of the token.
  const [withdrawal, assetInfo] = await Promise.all([
    request.all
      ? fetchJupiterLendInstructions('/earn/redeem-instructions', { asset: token.mint, signer: user.toBase58(), shares: position.shares.toString() }, user)
      : fetchJupiterLendInstructions('/earn/withdraw-instructions', { asset: token.mint, signer: user.toBase58(), amount: raw(quote.inAmount, token.decimals).toString() }, user),
    connection.getAccountInfo(assetAccount),
  ]);
  // It must burn from and pay into the wallet's own token accounts
  const touched = withdrawal.flatMap((ix) => ix.keys.map((key) => key.pubkey));
  if (!touched.some((key) => key.equals(assetAccount)) || !touched.some((key) => key.equals(receiptAccount))) {
    logger.warn(`Jupiter Lend withdrawal for ${user.toBase58()} does not use the wallet's token accounts`);
    throw new DepositError("Jupiter Lend's withdrawal service returned an unexpected transaction. Try again shortly.", 502);
  }

  const setup = [createAssociatedTokenAccountIdempotentInstruction(user, assetAccount, user, new PublicKey(token.mint))];
  // SOL lands as wrapped SOL. A wrapped SOL account made here is closed after, so SOL arrives as SOL.
  const cleanup = isSol && !assetInfo ? [createCloseAccountInstruction(assetAccount, user, user)] : [];
  const budget = await depositBudgetInstructions(connection, [receiptAccount], JUPITER_LEND_WITHDRAW_UNITS);
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  const transaction = new VersionedTransaction(
    new TransactionMessage({ payerKey: user, recentBlockhash: blockhash, instructions: [...budget, ...setup, ...withdrawal, ...cleanup] }).compileToV0Message()
  );
  // A wrapped SOL account the wallet already had stays open, so SOL lands in it as wrapped SOL
  const { received } = await simulateWithdrawal(
    transaction,
    user,
    token,
    (logs) =>
      /insufficient lamports|no record of a prior credit/i.test(logs.join(' '))
        ? 'Not enough SOL for the network fee.'
        : `Jupiter Lend can't pay this out right now. Try a smaller amount or try later.`,
    isSol && !!assetInfo
  );
  logger.info(`Built Jupiter Lend withdrawal: ${quote.inAmount} ${token.symbol}${request.all ? ' (all)' : ''}`);
  return {
    quote: { ...quote, outAmount: received.toFixed(), minOutAmount: received.toFixed() },
    transaction: Buffer.from(transaction.serialize()).toString('base64'),
    lastValidBlockHeight,
  };
}

// ---------- Entry points ----------

export async function quoteWithdrawal(request: WithdrawRequest): Promise<WithdrawQuote> {
  const { route, user } = resolve(request);
  if (route.category === 'liquid-staking') return (await quoteStaked(route, request, user)).quote;
  if (route.source.kind === 'kamino') return quoteKamino(route, request, user);
  if (route.source.kind === 'kamino-vault') return (await quoteVault(route, request, user)).quote;
  if (route.source.kind === 'project0') return (await quoteProject0(route, request, user)).quote;
  if (route.source.kind === 'jupiter-lend') return (await quoteJupiterLend(route, request, user)).quote;
  throw new DepositError(`Hermes can't withdraw from ${route.name} yet.`, 422);
}

export async function buildWithdrawal(request: WithdrawRequest): Promise<WithdrawTransaction> {
  const { route, user } = resolve(request);
  if (route.category === 'liquid-staking') return buildStaked(route, request, user);
  if (route.source.kind === 'kamino') return buildKamino(route, request, user);
  if (route.source.kind === 'kamino-vault') return buildVault(route, request, user);
  if (route.source.kind === 'project0') return buildProject0(route, request, user);
  if (route.source.kind === 'jupiter-lend') return buildJupiterLend(route, request, user);
  throw new DepositError(`Hermes can't withdraw from ${route.name} yet.`, 422);
}
