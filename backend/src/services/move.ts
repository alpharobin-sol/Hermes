import Decimal from 'decimal.js';
import { PublicKey } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync, unpackAccount } from '@solana/spl-token';
import { logger } from '../utils/logger';
import { solanaNetwork } from '../config/runtime';
import { depositCap, depositStatus, getRoute, RouteConfig, TokenInfo, TOKENS } from '../registry/routes';
import { connection, getRate, http } from './rates';
import { createJupiterClient } from './jupiter';
import { DepositError } from './errors';
import depositService, { assertUserOnlySigner, DepositQuote, DepositTransaction } from './deposit';
import { buildWithdrawal, quoteWithdrawal, WithdrawQuote } from './withdraw';

/**
 * HERMES REROUTE (moves)
 * Moves a position from one route to another for the same token. Hermes proposes, the wallet signs. Mainnet.
 *
 * - Staking token to staking token: one Jupiter swap from one token to the other, one signature. Checked like a
 *   deposit swap: the user is the only signer, and Jupiter's swap instruction holds what lands to the quote's minimum.
 * - Anything with lending in it: two steps, each built and simulated by the same code as a plain withdrawal and a
 *   plain deposit. The withdrawal first. Once it lands, Hermes reads what it paid into the wallet from the confirmed
 *   transaction and builds the deposit of that amount. If the second step fails, the funds wait in the wallet.
 *
 * The quote counts both ends in the routes' token (SOL for staking tokens, at their value in the pool), so the cost
 * of the move and how long the higher APY takes to make it back are plain.
 */

export interface MoveRequest {
  from: string; // route id of the position
  to: string; // route id to move it into
  amount?: string | number; // in what leaves the position: staking tokens (JitoSOL), or the lent token
  all?: boolean; // the whole position
  userPublicKey: string;
}

export interface MoveQuote {
  from: string;
  to: string;
  kind: 'swap' | 'two-step';
  token: string; // the routes' token, what values are counted in: SOL, USDC or USDT
  inputToken: TokenInfo; // what leaves the position
  inAmount: string;
  outputToken: TokenInfo; // what the new route holds: its staking token, jl token, or the token itself
  outAmount: string; // expected
  minOutAmount: string;
  held: string; // the whole position, in inputToken
  valueIn: string; // what leaves is worth, in `token`
  valueOut: string; // what arrives is worth, in `token`
  cost: string; // valueIn - valueOut, in `token`. At or below zero when the move costs nothing.
  fromApy: number; // decimal
  toApy: number;
  extraPerYear: string; // what the new route earns in a year at today's APYs, minus what the old one would, in `token`
  breakEvenDays: number | null; // days until the extra APY makes back the cost. 0 with no cost, null when it earns less.
  priceImpactPct: number;
  routeLabels: string[];
  rentBackSol: string | null; // a full Kamino exit closes the Kamino account and returns its rent
  available: string | null; // lending: what can leave the old route right now
  firstKaminoDeposit: boolean; // a deposit into Kamino Lend may pay one-time account rent, shown before step 2
}

export interface MoveTransaction {
  quote: MoveQuote;
  step: 1;
  steps: 1 | 2;
  transaction: string; // base64 VersionedTransaction, unsigned
  lastValidBlockHeight: number;
}

export interface MoveFinish extends DepositTransaction {
  received: string; // what step 1 paid into the wallet, in the routes' token
  kept: string | null; // SOL left in the wallet for fees and rent, when the wallet had little else
}

// A move swaps into a new route, so it is held to the deposit's limit on price impact
const MAX_MOVE_IMPACT_PCT = Number(process.env.DEPOSIT_MAX_PRICE_IMPACT_PCT || 1);
// SOL a two-step move leaves in the wallet for fees, and for a Kamino account's one-time rent
const FEE_RESERVE_SOL = 0.01;
const KAMINO_RENT_RESERVE_SOL = 0.03;
// The first step must be recent: finishing a move is not a way to deposit an old withdrawal again
const FINISH_WINDOW_SECONDS = 30 * 60;

const swapApi = createJupiterClient('swap/v1', process.env.JUPITER_API_URL);

const raw = (amount: string | number, decimals: number) => BigInt(new Decimal(amount).mul(new Decimal(10).pow(decimals)).floor().toFixed(0));
const ui = (amount: bigint | string | number, decimals: number) => new Decimal(amount.toString()).div(new Decimal(10).pow(decimals)).toFixed();

function resolve(request: MoveRequest): { from: RouteConfig; to: RouteConfig; user: PublicKey } {
  if (solanaNetwork() !== 'mainnet-beta') throw new DepositError('Rerouting runs on mainnet only.', 422);
  const from = getRoute(request.from);
  const to = getRoute(request.to);
  if (!from || !depositStatus(from, 'mainnet-beta')) throw new DepositError(`Hermes can't reroute a position out of ${request.from}.`, 404);
  if (!to || !depositStatus(to, 'mainnet-beta')) throw new DepositError(`Hermes can't deposit into ${request.to}.`, 404);
  if (from.id === to.id) throw new DepositError('Pick a different route to reroute to.');
  if (from.token !== to.token) throw new DepositError(`${from.name} holds ${from.token} and ${to.name} takes ${to.token}. Rerouting stays in one token.`);
  if (!request.all && !(Number(request.amount) > 0)) throw new DepositError('Enter an amount to reroute.');
  return { from, to, user: new PublicKey(request.userPublicKey) };
}

const isSwap = (from: RouteConfig, to: RouteConfig) => from.category === 'liquid-staking' && to.category === 'liquid-staking';

async function apyOf(route: RouteConfig): Promise<number> {
  const rate = await getRate(route.source);
  if (!rate) throw new DepositError(`${route.name}'s rate is unavailable right now. Try again shortly.`, 503);
  return rate.apy;
}

// SOL per staking token, in its pool: what the token is worth
async function tokenValue(route: RouteConfig): Promise<Decimal> {
  const value = (await getRate(route.source))?.tokenValue;
  if (!value) throw new DepositError(`${route.receipt?.symbol ?? route.name}'s pool value is unavailable right now. Try again shortly.`, 503);
  return new Decimal(value);
}

function checkCap(to: RouteConfig, valueIn: Decimal) {
  const cap = depositCap(to, 'mainnet-beta');
  if (cap !== null && valueIn.gt(cap)) {
    throw new DepositError(`${to.name} is in beta: reroutes into it are limited to ${cap} ${to.token} each for now. Reroute a smaller amount.`, 422);
  }
}

// What the move costs and how long the new APY takes to make it back, both ends counted in the routes' token
function economics(valueIn: Decimal, valueOut: Decimal, fromApy: number, toApy: number) {
  const cost = valueIn.minus(valueOut);
  const extraPerYear = valueOut.mul(toApy).minus(valueIn.mul(fromApy));
  const breakEvenDays = extraPerYear.lte(0) ? null : cost.lte(0) ? 0 : Math.ceil(cost.div(extraPerYear).mul(365).toNumber());
  return { cost: cost.toFixed(9), extraPerYear: extraPerYear.toFixed(9), breakEvenDays };
}

// ---------- Staking token to staking token: one swap ----------

async function quoteSwapMove(from: RouteConfig, to: RouteConfig, request: MoveRequest, user: PublicKey) {
  const input = from.receipt!;
  const output = to.receipt!;
  const account = getAssociatedTokenAddressSync(new PublicKey(input.mint), user, true, TOKEN_PROGRAM_ID);
  const info = await connection.getAccountInfo(account);
  const held = info ? unpackAccount(account, info, TOKEN_PROGRAM_ID).amount : 0n;
  const amount = request.all ? held : raw(request.amount!, input.decimals);
  if (held <= 0n) throw new DepositError(`This wallet holds no ${input.symbol}.`, 422);
  if (amount > held) throw new DepositError(`This wallet holds ${ui(held, input.decimals)} ${input.symbol}.`, 422);

  const [fromValue, toValue, fromApy, toApy] = await Promise.all([tokenValue(from), tokenValue(to), apyOf(from), apyOf(to)]);
  const inAmount = ui(amount, input.decimals);
  const valueIn = new Decimal(inAmount).mul(fromValue);
  checkCap(to, valueIn);

  const { data: rawQuote } = await swapApi.get('/quote', {
    params: { inputMint: input.mint, outputMint: output.mint, amount: amount.toString(), slippageBps: 50 },
  });
  const priceImpactPct = Number(rawQuote.priceImpactPct) * 100;
  if (priceImpactPct > MAX_MOVE_IMPACT_PCT) {
    throw new DepositError(`Price impact is ${priceImpactPct.toFixed(2)}% swapping ${input.symbol} for ${output.symbol}. Try a smaller amount.`, 422);
  }
  const outAmount = ui(rawQuote.outAmount, output.decimals);
  const valueOut = new Decimal(outAmount).mul(toValue);
  const quote: MoveQuote = {
    from: from.id,
    to: to.id,
    kind: 'swap',
    token: from.token,
    inputToken: input,
    inAmount,
    outputToken: output,
    outAmount,
    minOutAmount: ui(rawQuote.otherAmountThreshold, output.decimals),
    held: ui(held, input.decimals),
    valueIn: valueIn.toFixed(9),
    valueOut: valueOut.toFixed(9),
    fromApy,
    toApy,
    ...economics(valueIn, valueOut, fromApy, toApy),
    priceImpactPct,
    routeLabels: (rawQuote.routePlan || []).map((step: any) => step.swapInfo?.label).filter(Boolean),
    rentBackSol: null,
    available: null,
    firstKaminoDeposit: false,
  };
  return { quote, rawQuote };
}

async function buildSwapMove(from: RouteConfig, to: RouteConfig, request: MoveRequest, user: PublicKey): Promise<MoveTransaction> {
  const { quote, rawQuote } = await quoteSwapMove(from, to, request, user);
  const { data } = await swapApi.post('/swap', {
    quoteResponse: rawQuote,
    userPublicKey: user.toBase58(),
    wrapAndUnwrapSol: true,
    dynamicComputeUnitLimit: true,
    prioritizationFeeLamports: { priorityLevelWithMaxLamports: { maxLamports: 1_000_000, priorityLevel: 'high' } },
  });
  if (data.simulationError) {
    logger.warn(`Move swap failed simulation (${from.id} -> ${to.id}): ${JSON.stringify(data.simulationError)}`);
    throw new DepositError(`Swapping ${quote.inputToken.symbol} for ${quote.outputToken.symbol} failed in simulation. Try a smaller amount or try again shortly.`, 422);
  }
  // Many programs take part in a swap, so its instructions can't be allow-listed. The user is the only signer,
  // and Jupiter's swap instruction holds what lands to the quote's minimum on chain.
  assertUserOnlySigner(data.swapTransaction, user.toBase58());
  logger.info(`Built move swap: ${quote.inAmount} ${quote.inputToken.symbol} -> ${quote.outputToken.symbol}`);
  return { quote, step: 1, steps: 1, transaction: data.swapTransaction, lastValidBlockHeight: data.lastValidBlockHeight };
}

// ---------- Two steps: withdraw, then deposit what landed ----------

async function twoStepQuote(from: RouteConfig, to: RouteConfig, exit: WithdrawQuote): Promise<MoveQuote> {
  const [fromApy, toApy] = await Promise.all([apyOf(from), apyOf(to)]);
  // Staking tokens leave at their pool value, lent tokens at face value
  if (from.category === 'liquid-staking' && !exit.value) {
    throw new DepositError(`${exit.inputToken.symbol}'s pool value is unavailable right now. Try again shortly.`, 503);
  }
  const valueIn = new Decimal(from.category === 'liquid-staking' ? exit.value! : exit.inAmount);
  checkCap(to, valueIn);
  // No wallet on this quote: the funds are not in the wallet until step 1 lands, so nothing can be checked yet
  const entry: DepositQuote = await depositService.getQuote({ routeId: to.id, amount: exit.outAmount });
  const valueOut = to.category === 'liquid-staking' ? new Decimal(entry.outAmount).mul(await tokenValue(to)) : new Decimal(entry.inAmount);
  return {
    from: from.id,
    to: to.id,
    kind: 'two-step',
    token: from.token,
    inputToken: exit.inputToken,
    inAmount: exit.inAmount,
    outputToken: entry.outputToken,
    outAmount: entry.outAmount,
    minOutAmount: entry.minOutAmount,
    held: exit.held,
    valueIn: valueIn.toFixed(9),
    valueOut: valueOut.toFixed(9),
    fromApy,
    toApy,
    ...economics(valueIn, valueOut, fromApy, toApy),
    priceImpactPct: Math.max(exit.priceImpactPct, entry.priceImpactPct),
    routeLabels: [...exit.routeLabels, ...entry.routeLabels],
    rentBackSol: exit.rentBackSol,
    available: exit.available,
    firstKaminoDeposit: to.direct?.kind === 'kamino-lend',
  };
}

/**
 * What step 1 paid into the wallet, read from the confirmed transaction, and when it landed. SOL counts the wallet's
 * change with the fee added back and the rent of any account the transaction closed taken out (a Kamino account on a
 * full exit): that rent was never part of the position. Tokens count the wallet's own balance change of that mint.
 */
export async function landed(signature: string, user: PublicKey, token: TokenInfo): Promise<{ amount: Decimal; blockTime: number | null }> {
  // Read raw, so a version 1 transaction (newer wallets and swaps send them) parses like any other
  const { data } = await http.post(connection.rpcEndpoint, {
    jsonrpc: '2.0',
    id: 1,
    method: 'getTransaction',
    params: [signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 1, commitment: 'confirmed' }],
  });
  const tx = data?.result;
  if (!tx?.meta) throw new DepositError('Hermes cannot see step 1 on chain yet. Try again in a few seconds.', 409);
  if (tx.meta.err) throw new DepositError('Step 1 failed on chain, so nothing left the position and there is nothing to deposit.', 422);
  const keys: string[] = (tx.transaction?.message?.accountKeys ?? []).map((key: any) => (typeof key === 'string' ? key : key.pubkey));
  if (keys[0] !== user.toBase58()) throw new DepositError('Step 1 was not signed by this wallet.', 422);
  const blockTime: number | null = tx.blockTime ?? null;
  const owned = (balances: any[] | undefined) => (balances ?? []).filter((b) => b.owner === user.toBase58() && b.mint === token.mint);

  if (token.mint === TOKENS.SOL.mint) {
    const pre: number[] = tx.meta.preBalances ?? [];
    const post: number[] = tx.meta.postBalances ?? [];
    let change = BigInt(post[0]) - BigInt(pre[0]) + BigInt(tx.meta.fee ?? 0);
    for (let i = 1; i < pre.length; i++) if (pre[i] > 0 && post[i] === 0) change -= BigInt(pre[i]);
    if (change <= 0n) {
      throw new DepositError(
        owned(tx.meta.postTokenBalances).length > 0
          ? 'Step 1 paid out wrapped SOL. Unwrap it in your wallet, then deposit it from the app.'
          : 'Step 1 paid no SOL into this wallet.',
        422
      );
    }
    return { amount: new Decimal(ui(change, 9)), blockTime };
  }
  const sum = (balances: any[] | undefined) => owned(balances).reduce((total, b) => total + BigInt(b.uiTokenAmount?.amount ?? 0), 0n);
  const change = sum(tx.meta.postTokenBalances) - sum(tx.meta.preTokenBalances);
  if (change <= 0n) throw new DepositError(`Step 1 paid no ${token.symbol} into this wallet.`, 422);
  return { amount: new Decimal(ui(change, token.decimals)), blockTime };
}

// ---------- Entry points ----------

export async function quoteMove(request: MoveRequest): Promise<MoveQuote> {
  const { from, to, user } = resolve(request);
  if (isSwap(from, to)) return (await quoteSwapMove(from, to, request, user)).quote;
  const exit = await quoteWithdrawal({ routeId: from.id, amount: request.amount, all: request.all, userPublicKey: request.userPublicKey });
  return twoStepQuote(from, to, exit);
}

/**
 * The transaction to sign first: the whole move for a swap, or the withdrawal (step 1 of 2)
 */
export async function buildMove(request: MoveRequest): Promise<MoveTransaction> {
  const { from, to, user } = resolve(request);
  if (isSwap(from, to)) return buildSwapMove(from, to, request, user);
  const exit = await buildWithdrawal({ routeId: from.id, amount: request.amount, all: request.all, userPublicKey: request.userPublicKey });
  const quote = await twoStepQuote(from, to, exit.quote);
  logger.info(`Built move step 1: ${exit.quote.inAmount} ${exit.quote.inputToken.symbol} out of ${from.id}, for ${to.id}`);
  return { quote, step: 1, steps: 2, transaction: exit.transaction, lastValidBlockHeight: exit.lastValidBlockHeight };
}

/**
 * Step 2 of a two-step move: the deposit of what step 1 paid into the wallet. SOL keeps a little back for fees, and
 * for a Kamino account's rent, when the wallet holds little else.
 */
export async function finishMove(request: MoveRequest & { signature: string }): Promise<MoveFinish> {
  const { from, to, user } = resolve(request);
  if (isSwap(from, to)) throw new DepositError('This reroute is a single swap. There is no second step.');
  const token = TOKENS[to.token];
  const { amount: received, blockTime } = await landed(request.signature, user, token);
  if (blockTime && Date.now() / 1000 - blockTime > FINISH_WINDOW_SECONDS) {
    throw new DepositError('Step 1 is more than 30 minutes old. Deposit the funds from the app instead.', 422);
  }

  let amount = received;
  let kept: Decimal | null = null;
  if (token.mint === TOKENS.SOL.mint) {
    const reserve = FEE_RESERVE_SOL + (to.direct?.kind === 'kamino-lend' ? KAMINO_RENT_RESERVE_SOL : 0);
    const spendable = new Decimal(await connection.getBalance(user)).div(1e9).minus(reserve);
    if (spendable.lt(amount)) {
      amount = Decimal.max(0, spendable).toDecimalPlaces(9, Decimal.ROUND_DOWN);
      kept = received.minus(amount);
    }
  }
  if (amount.lte(0)) throw new DepositError(`Not enough SOL left for the network fee. The ${token.symbol} from step 1 is in your wallet.`, 422);

  const deposit = await depositService.buildTransaction({ routeId: to.id, amount: amount.toFixed() }, user.toBase58());
  logger.info(`Built move step 2: ${amount.toFixed()} ${token.symbol} into ${to.id}${kept ? ` (${kept.toFixed()} kept for fees)` : ''}`);
  return { ...deposit, received: received.toFixed(), kept: kept && kept.gt(0) ? kept.toFixed() : null };
}
