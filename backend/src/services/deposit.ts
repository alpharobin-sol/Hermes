import { AxiosInstance } from 'axios';
import Decimal from 'decimal.js';
import { Connection, PublicKey, VersionedTransaction } from '@solana/web3.js';
import { logger } from '../utils/logger';
import { solanaNetwork, SolanaNetwork } from '../config/runtime';
import { getRoute, depositCap, depositStatus, DirectDeposit, RouteConfig, TokenInfo, TOKENS } from '../registry/routes';
import { buildStakePoolDeposit, quoteStakePoolDeposit, StakePoolTarget } from './stake-pool-deposit';
import { buildMarinadeDeposit, quoteMarinadeDeposit } from './marinade-deposit';
import { buildKaminoDeposit, KaminoDepositPlan } from './kamino-deposit';
import { buildJupiterLendDeposit, quoteJupiterLendDeposit } from './jupiter-lend-deposit';
import { buildKaminoVaultDeposit, KaminoVault, KaminoVaultDepositPlan } from './kamino-vault';
import { buildProject0Deposit, Project0Deposit, Project0DepositPlan } from './project0';
import { DepositError } from './errors';
import { createJupiterClient } from './jupiter';
import { solReserve } from './sol-reserve';

/**
 * HERMES DEPOSIT ROUTER
 * Builds unsigned deposit transactions for the user's wallet to sign.
 * Hermes never holds funds: it quotes a route, returns the transaction, and the user signs it.
 * Only routes with a deposit status for the current network in the registry can be built.
 *
 * Mainnet:
 * - SOL -> liquid staking tokens. Routes with a direct deposit (Jito's stake pool, Marinade) quote it
 *   against the Jupiter swap API and build whichever gives more of the token. Other LSTs go through Jupiter.
 * - SOL, USDC, USDT -> Kamino Lend: supplied through Kamino's transaction API, held as a position in the
 *   user's Kamino account rather than a token in the wallet.
 * - USDC -> Kamino vaults (Steakhouse USDC): built by Kamino's transaction API too. The vault's shares are staked in
 *   its farm for the user, so nothing reaches the wallet either.
 * - USDC, USDT -> Project 0 (formerly marginfi): built by Hermes from the program's interface, into the wallet's own
 *   Project 0 account for that token. A position, not a token in the wallet.
 * - SOL, USDC, USDT -> Jupiter Lend Earn: built from Jupiter's deposit instruction, minting a jl token
 *   (jlWSOL, jlUSDC, jlUSDT) into the wallet. Quoted against a Jupiter swap to the same jl token.
 * Devnet (SOLANA_NETWORK=devnet): SOL -> stake pools that exist on devnet, deposited directly.
 */

export type DepositMethod = 'jupiter-swap' | 'direct';

const MAX_PRICE_IMPACT_PCT = Number(process.env.DEPOSIT_MAX_PRICE_IMPACT_PCT || 1);

// A swap must beat a direct deposit by at least this share (0.01%) to be built instead
const DIRECT_TIE_SHARE = 0.0001;

export interface DepositRequest {
  routeId: string;
  amount: string | number; // UI units, e.g. 1.5 SOL
  slippageBps?: number;
  userPublicKey?: string; // optional on quotes: lets lending quotes include one-time account rent
}

export interface DepositQuote {
  network: SolanaNetwork;
  routeId: string;
  method: DepositMethod;
  inputToken: TokenInfo;
  outputToken: TokenInfo;
  inAmount: string; // UI units
  outAmount: string; // UI units, expected
  minOutAmount: string; // UI units, after slippage
  priceImpactPct: number;
  slippageBps: number;
  routeLabels: string[];
  compared: { method: DepositMethod; label: string; outAmount: string }[]; // other paths quoted for this deposit
  position: string | null; // where a lending deposit is held (e.g. "Kamino Lend") when no token reaches the wallet
  setupCostSol: string | null; // one-time account rent in SOL, when known (lending quotes with a wallet)
}

export interface DepositTransaction {
  quote: DepositQuote;
  transaction: string; // base64 VersionedTransaction, unsigned. The deposit itself (last of `transactions`)
  transactions: string[]; // every transaction to sign and send, in order
  lastValidBlockHeight: number;
  prioritizationFeeLamports: number;
}

export { DepositError };

interface Candidate {
  quote: DepositQuote;
  rawQuote?: any; // Jupiter quote, needed to build the swap
}

export class DepositService {
  private client: AxiosInstance;
  private connections: Partial<Record<SolanaNetwork, Connection>> = {};

  constructor() {
    this.client = createJupiterClient('swap/v1', process.env.JUPITER_API_URL);
  }

  /**
   * Quote a deposit without building a transaction. `swap: false` leaves out the Jupiter swap path, for callers
   * that quote the swap themselves (the site's live quotes, from the visitor's browser).
   */
  async getQuote(request: DepositRequest, opts?: { swap?: boolean }): Promise<DepositQuote> {
    const route = this.resolveRoute(request);
    return (await this.bestCandidate(route, request, opts)).quote;
  }

  /**
   * Check a route and amount can be deposited (route known, deposits open, amount within the beta cap)
   */
  checkRoute(request: DepositRequest): RouteConfig {
    return this.resolveRoute(request);
  }

  /**
   * Whether the route has a direct deposit path (not a Jupiter swap) on this network
   */
  hasDirect(route: RouteConfig): boolean {
    return !!route.direct && directAvailable(route.direct, solanaNetwork());
  }

  /**
   * Quote a deposit and build the unsigned transaction for the user's wallet
   */
  async buildTransaction(request: DepositRequest, userPublicKey: string): Promise<DepositTransaction> {
    const route = this.resolveRoute(request);
    if (route.token === 'SOL') await this.checkSolBalance(route, request.amount, new PublicKey(userPublicKey));
    const best = await this.bestCandidate(route, request);

    if (best.quote.method === 'direct') {
      return this.buildDirectTransaction(route, best.quote, userPublicKey);
    }
    return this.buildSwapTransaction(best, userPublicKey);
  }

  /**
   * A SOL deposit leaves the route's hold-back in the wallet: the fees and the accounts the deposit opens
   */
  private async checkSolBalance(route: RouteConfig, amount: string | number, user: PublicKey): Promise<void> {
    const network = solanaNetwork();
    const reserve = await solReserve(route);
    if (reserve === null) throw new DepositError("Can't read the network's account rent right now. Try again shortly.", 503);
    const balance = new Decimal(await this.getConnection(network).getBalance(user)).div(1e9);
    if (new Decimal(amount).plus(reserve).gt(balance)) {
      const most = Decimal.max(0, balance.minus(reserve)).toDecimalPlaces(6, Decimal.ROUND_DOWN);
      const hint = network === 'devnet' ? ' Get devnet SOL at faucet.solana.com.' : '';
      throw new DepositError(
        `Not enough SOL: keep ${reserve} SOL for fees and the accounts this deposit opens. You can deposit up to ${most.toFixed()} SOL.${hint}`,
        422
      );
    }
  }

  /**
   * The registry route, if Hermes can deposit into it on the current network and the amount is allowed
   */
  private resolveRoute(request: DepositRequest): RouteConfig {
    const network = solanaNetwork();
    const route = getRoute(request.routeId);
    if (!route) {
      throw new DepositError(`Unknown route: ${request.routeId}`, 404);
    }
    const status = depositStatus(route, network);
    if (!status) {
      throw new DepositError(`${route.name} deposits are not available in Hermes on ${network} yet`, 422);
    }

    const amount = new Decimal(request.amount);
    if (amount.mul(new Decimal(10).pow(TOKENS[route.token].decimals)).floor().lte(0)) {
      throw new DepositError('Amount is too small');
    }
    const cap = depositCap(route, network);
    if (cap !== null && amount.gt(cap)) {
      throw new DepositError(`${route.name} is in beta: deposits are limited to ${cap} ${route.token} each for now.`, 422);
    }
    return route;
  }

  /**
   * Quote every path the route has on this network and keep the one that returns the most
   */
  private async bestCandidate(route: RouteConfig, request: DepositRequest, opts?: { swap?: boolean }): Promise<Candidate> {
    const network = solanaNetwork();
    const paths: Promise<Candidate>[] = [];

    if (route.direct && directAvailable(route.direct, network)) {
      paths.push(this.quoteDirect(route, request, network));
    }
    // Jupiter has no devnet routes
    if (network === 'mainnet-beta' && route.receipt && opts?.swap !== false) paths.push(this.quoteSwap(route, request));

    if (paths.length === 0) {
      throw new DepositError(`${route.name} has no deposit path on ${network}`, 422);
    }

    const results = await Promise.allSettled(paths);
    const candidates = results
      .filter((result): result is PromiseFulfilledResult<Candidate> => result.status === 'fulfilled')
      .map((result) => result.value);

    if (candidates.length === 0) {
      // Prefer an error written for the user (price impact, stale pool) over a raw one
      const errors = results.map((result) => (result as PromiseRejectedResult).reason);
      throw errors.find((error) => error instanceof DepositError) ?? errors[0];
    }
    for (const result of results) {
      if (result.status === 'rejected') logger.info(`Deposit path skipped for ${route.id}: ${result.reason?.message ?? result.reason}`);
    }

    candidates.sort((a, b) => new Decimal(b.quote.outAmount).cmp(a.quote.outAmount));
    // A direct deposit has no slippage. Keep it when a swap leads by less than DIRECT_TIE_SHARE.
    const direct = candidates.find((candidate) => candidate.quote.method === 'direct');
    if (direct && direct !== candidates[0]) {
      const lead = new Decimal(candidates[0].quote.outAmount).minus(direct.quote.outAmount).div(candidates[0].quote.outAmount);
      if (lead.lt(DIRECT_TIE_SHARE)) candidates.splice(0, 0, ...candidates.splice(candidates.indexOf(direct), 1));
    }
    const [best, ...others] = candidates;
    best.quote.compared = others.map((other) => ({
      method: other.quote.method,
      label: other.quote.method === 'jupiter-swap' ? 'Jupiter' : other.quote.routeLabels[0],
      outAmount: other.quote.outAmount,
    }));
    return best;
  }

  private async quoteDirect(route: RouteConfig, request: DepositRequest, network: SolanaNetwork): Promise<Candidate> {
    const direct = route.direct!;
    const connection = this.getConnection(network);

    if (direct.kind === 'kamino-lend') {
      const token = TOKENS[route.token];
      const amount = toUiAmount(request.amount, token.decimals);
      // With a wallet, build the deposit now: it checks the balance and measures the one-time account rent
      const plan = request.userPublicKey
        ? await this.buildKaminoPlan(route, amount, new PublicKey(request.userPublicKey))
        : null;
      return {
        quote: {
          ...this.positionQuote(route, network, amount),
          setupCostSol: plan?.setupCostSol ?? null,
        },
      };
    }

    if (direct.kind === 'kamino-vault') {
      const amount = toUiAmount(request.amount, TOKENS[route.token].decimals);
      // With a wallet, build the deposit now: it checks the balance and measures the one-time account rent
      const plan = request.userPublicKey
        ? await this.buildVaultPlan(route, amount, new PublicKey(request.userPublicKey))
        : null;
      return { quote: { ...this.positionQuote(route, network, amount), setupCostSol: plan?.setupCostSol ?? null } };
    }

    if (direct.kind === 'project0') {
      const amount = toUiAmount(request.amount, TOKENS[route.token].decimals);
      // With a wallet, build the deposit now: it checks the balance and measures the account's one-time rent
      const plan = request.userPublicKey
        ? await this.buildProject0Plan(route, amount, new PublicKey(request.userPublicKey))
        : null;
      return { quote: { ...this.positionQuote(route, network, amount), setupCostSol: plan?.setupCostSol ?? null } };
    }

    if (direct.kind === 'jupiter-lend') {
      const token = TOKENS[route.token];
      const receipt = route.receipt!;
      const raw = new Decimal(request.amount).mul(new Decimal(10).pow(token.decimals)).floor();
      const shares = await quoteJupiterLendDeposit(token, raw);
      const outAmount = shares.div(new Decimal(10).pow(receipt.decimals)).toFixed();
      return {
        quote: {
          network,
          routeId: route.id,
          method: 'direct',
          inputToken: token,
          outputToken: receipt,
          inAmount: raw.div(new Decimal(10).pow(token.decimals)).toFixed(),
          outAmount,
          // Minted at Jupiter Lend's share rate, there is no slippage
          minOutAmount: outAmount,
          priceImpactPct: 0,
          slippageBps: 0,
          routeLabels: [directLabel(route)],
          compared: [],
          position: null,
          setupCostSol: null,
        },
      };
    }

    const lamports = toLamports(request.amount);
    let outAmount: string;
    if (direct.kind === 'spl-stake-pool') {
      const quote = await quoteStakePoolDeposit(connection, stakePoolTarget(route, direct.pool), lamports);
      // Mainnet pools are updated by their operator early each epoch. Until then, use Jupiter.
      if (quote.poolUpdateNeeded && network === 'mainnet-beta') {
        throw new DepositError(`The ${route.receipt!.symbol} stake pool is between epochs. Try again in a few minutes.`, 503);
      }
      outAmount = quote.outAmount;
    } else {
      outAmount = await quoteMarinadeDeposit(connection, lamports);
    }

    return {
      quote: {
        network,
        routeId: route.id,
        method: 'direct',
        inputToken: TOKENS.SOL,
        outputToken: route.receipt!,
        inAmount: lamports.div(1e9).toFixed(),
        outAmount,
        // Direct deposits mint at the protocol's own rate, there is no slippage
        minOutAmount: outAmount,
        priceImpactPct: 0,
        slippageBps: 0,
        routeLabels: [`${directLabel(route)}${network === 'devnet' ? ' (devnet)' : ''}`],
        compared: [],
        position: null,
        setupCostSol: null,
      },
    };
  }

  // A lending deposit: the amount goes into the protocol as is and stays the same token
  private positionQuote(route: RouteConfig, network: SolanaNetwork, amount: string): DepositQuote {
    const token = TOKENS[route.token];
    return {
      network,
      routeId: route.id,
      method: 'direct',
      inputToken: token,
      outputToken: token,
      inAmount: amount,
      outAmount: amount,
      minOutAmount: amount,
      priceImpactPct: 0,
      slippageBps: 0,
      routeLabels: [directLabel(route)],
      compared: [],
      position: route.name,
      setupCostSol: null,
    };
  }

  private buildKaminoPlan(route: RouteConfig, amount: string, user: PublicKey): Promise<KaminoDepositPlan> {
    const direct = route.direct as Extract<DirectDeposit, { kind: 'kamino-lend' }>;
    return buildKaminoDeposit(this.getConnection('mainnet-beta'), {
      market: direct.market,
      reserve: direct.reserve,
      token: TOKENS[route.token],
      amount,
      user,
    });
  }

  private buildVaultPlan(route: RouteConfig, amount: string, user: PublicKey): Promise<KaminoVaultDepositPlan> {
    const token = TOKENS[route.token];
    const raw = BigInt(new Decimal(amount).mul(new Decimal(10).pow(token.decimals)).floor().toFixed(0));
    return buildKaminoVaultDeposit(this.getConnection('mainnet-beta'), route.direct as KaminoVault, token, raw, user);
  }

  private buildProject0Plan(route: RouteConfig, amount: string, user: PublicKey): Promise<Project0DepositPlan> {
    const token = TOKENS[route.token];
    const raw = BigInt(new Decimal(amount).mul(new Decimal(10).pow(token.decimals)).floor().toFixed(0));
    return buildProject0Deposit(this.getConnection('mainnet-beta'), route.direct as Project0Deposit, token, raw, user);
  }

  private async quoteSwap(route: RouteConfig, request: DepositRequest): Promise<Candidate> {
    const inputToken: TokenInfo = TOKENS[route.token];
    const outputToken = route.receipt!;
    const rawAmount = new Decimal(request.amount).mul(new Decimal(10).pow(inputToken.decimals)).floor();
    const slippageBps = request.slippageBps ?? 50;

    const response = await this.client.get('/quote', {
      params: {
        inputMint: inputToken.mint,
        outputMint: outputToken.mint,
        amount: rawAmount.toFixed(0),
        slippageBps,
      },
    });

    const rawQuote = response.data;
    const toUi = (raw: string, decimals: number) => new Decimal(raw).div(new Decimal(10).pow(decimals)).toFixed();

    // Thin LST pools can cost more on entry than months of yield
    const priceImpactPct = Number(rawQuote.priceImpactPct) * 100;
    if (priceImpactPct > MAX_PRICE_IMPACT_PCT) {
      throw new DepositError(
        `Price impact is ${priceImpactPct.toFixed(2)}% for ${outputToken.symbol}. Try a smaller amount or another route.`,
        422
      );
    }

    return {
      rawQuote,
      quote: {
        network: 'mainnet-beta',
        routeId: route.id,
        method: 'jupiter-swap',
        inputToken,
        outputToken,
        inAmount: toUi(rawQuote.inAmount, inputToken.decimals),
        outAmount: toUi(rawQuote.outAmount, outputToken.decimals),
        minOutAmount: toUi(rawQuote.otherAmountThreshold, outputToken.decimals),
        priceImpactPct,
        slippageBps: rawQuote.slippageBps,
        routeLabels: (rawQuote.routePlan || []).map((step: any) => step.swapInfo?.label).filter(Boolean),
        compared: [],
        position: null,
        setupCostSol: null,
      },
    };
  }

  private async buildSwapTransaction(candidate: Candidate, userPublicKey: string): Promise<DepositTransaction> {
    const { quote, rawQuote } = candidate;
    const response = await this.client.post('/swap', {
      quoteResponse: rawQuote,
      userPublicKey,
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: {
        priorityLevelWithMaxLamports: {
          maxLamports: 1_000_000, // 0.001 SOL cap
          priorityLevel: 'high',
        },
      },
    });

    const { swapTransaction, lastValidBlockHeight, prioritizationFeeLamports, simulationError } = response.data;

    if (simulationError) {
      logger.warn(`Deposit transaction failed simulation (${quote.routeId}): ${JSON.stringify(simulationError)}`);
      throw new DepositError(describeSimulationError(simulationError), 422);
    }

    // The swap routes through many programs, so its instructions can't be allow-listed the way a single-protocol
    // deposit can. What Hermes can check: the user is the only signer, so no co-signer is slipped in, and the
    // amount received is held to the quote's minimum on-chain by Jupiter's own swap instruction.
    assertUserOnlySigner(swapTransaction, userPublicKey);

    logger.info(`Built swap deposit: ${quote.inAmount} ${quote.inputToken.symbol} -> ${quote.outputToken.symbol}`);

    return {
      quote,
      transaction: swapTransaction,
      transactions: [swapTransaction],
      lastValidBlockHeight,
      prioritizationFeeLamports,
    };
  }

  private async buildDirectTransaction(route: RouteConfig, quote: DepositQuote, userPublicKey: string): Promise<DepositTransaction> {
    const direct = route.direct!;
    const network = quote.network;
    const user = new PublicKey(userPublicKey);

    // Kamino's builder checks the balance and simulates itself
    if (direct.kind === 'kamino-lend') {
      const plan = await this.buildKaminoPlan(route, quote.inAmount, user);
      const transaction = Buffer.from(plan.transaction.serialize()).toString('base64');
      logger.info(`Built Kamino Lend deposit: ${quote.inAmount} ${route.token}, one-time rent ${plan.setupCostSol} SOL`);
      return {
        quote: { ...quote, setupCostSol: plan.setupCostSol },
        transaction,
        transactions: [transaction],
        lastValidBlockHeight: plan.lastValidBlockHeight,
        prioritizationFeeLamports: 0,
      };
    }

    // The vault builder checks the transaction and simulates it
    if (direct.kind === 'kamino-vault') {
      const plan = await this.buildVaultPlan(route, quote.inAmount, user);
      const transaction = Buffer.from(plan.transaction.serialize()).toString('base64');
      logger.info(`Built Kamino vault deposit: ${quote.inAmount} ${route.token} into ${route.id}, one-time rent ${plan.setupCostSol} SOL`);
      return {
        quote: { ...quote, setupCostSol: plan.setupCostSol },
        transaction,
        transactions: [transaction],
        lastValidBlockHeight: plan.lastValidBlockHeight,
        prioritizationFeeLamports: 0,
      };
    }

    // The Project 0 builder simulates the deposit itself
    if (direct.kind === 'project0') {
      const plan = await this.buildProject0Plan(route, quote.inAmount, user);
      const transaction = Buffer.from(plan.transaction.serialize()).toString('base64');
      logger.info(`Built Project 0 deposit: ${quote.inAmount} ${route.token}, one-time rent ${plan.setupCostSol} SOL`);
      return {
        quote: { ...quote, setupCostSol: plan.setupCostSol },
        transaction,
        transactions: [transaction],
        lastValidBlockHeight: plan.lastValidBlockHeight,
        prioritizationFeeLamports: 0,
      };
    }

    // Jupiter Lend's builder checks the balance and simulates itself
    if (direct.kind === 'jupiter-lend') {
      const token = TOKENS[route.token];
      const plan = await buildJupiterLendDeposit(this.getConnection('mainnet-beta'), {
        asset: token,
        receipt: route.receipt!,
        amount: new Decimal(quote.inAmount).mul(new Decimal(10).pow(token.decimals)).floor(),
        user,
      });
      const transaction = Buffer.from(plan.transaction.serialize()).toString('base64');
      logger.info(`Built Jupiter Lend deposit: ${quote.inAmount} ${route.token} -> ${plan.outAmount} ${route.receipt!.symbol}`);
      return {
        // The jl tokens the simulation minted
        quote: { ...quote, outAmount: plan.outAmount, minOutAmount: plan.outAmount },
        transaction,
        transactions: [transaction],
        lastValidBlockHeight: plan.lastValidBlockHeight,
        prioritizationFeeLamports: 0,
      };
    }

    // The SOL balance was checked against the route's hold-back before quoting
    const lamports = toLamports(quote.inAmount);
    const connection = this.getConnection(network);

    const plan = direct.kind === 'spl-stake-pool'
      ? await buildStakePoolDeposit(connection, stakePoolTarget(route, direct.pool), lamports, user, {
          allowPoolUpdate: network === 'devnet',
          priorityFee: network === 'mainnet-beta',
        })
      : await buildMarinadeDeposit(connection, lamports, user).then((marinade) => ({
          ...marinade,
          transactions: [marinade.transaction],
        }));

    // Later transactions depend on earlier ones landing first, so only the first can be simulated now
    const simulation = await connection.simulateTransaction(plan.transactions[0], { sigVerify: false });
    if (simulation.value.err) {
      const details = JSON.stringify({ err: simulation.value.err, logs: simulation.value.logs?.slice(-4) });
      logger.warn(`Direct deposit failed simulation (${route.id}, ${network}): ${details}`);
      throw new DepositError(describeSimulationError(details), 422);
    }

    const transactions = plan.transactions.map((tx) => Buffer.from(tx.serialize()).toString('base64'));
    logger.info(`Built direct deposit on ${network}: ${quote.inAmount} SOL -> ${route.receipt!.symbol} in ${transactions.length} transaction(s)`);

    return {
      // The protocol's rate when the transaction was built
      quote: { ...quote, outAmount: plan.outAmount, minOutAmount: plan.outAmount },
      transaction: transactions[transactions.length - 1],
      transactions,
      lastValidBlockHeight: plan.lastValidBlockHeight,
      prioritizationFeeLamports: 0,
    };
  }

  private getConnection(network: SolanaNetwork): Connection {
    if (!this.connections[network]) {
      const url = network === 'devnet'
        ? process.env.DEVNET_RPC_URL || 'https://api.devnet.solana.com'
        : process.env.SOLANA_RPC_URL || 'https://solana-rpc.publicnode.com';
      this.connections[network] = new Connection(url, 'confirmed');
    }
    return this.connections[network]!;
  }
}

function stakePoolTarget(route: RouteConfig, pool: string): StakePoolTarget {
  return { symbol: route.receipt!.symbol, pool, mint: route.receipt!.mint };
}

// SPL stake pools exist on devnet at the same address (Jito). Marinade and lending deposits are mainnet only.
function directAvailable(direct: DirectDeposit, network: SolanaNetwork): boolean {
  return direct.kind === 'spl-stake-pool' || network === 'mainnet-beta';
}

function directLabel(route: RouteConfig): string {
  switch (route.direct?.kind) {
    case 'marinade':
      return 'Marinade liquid staking';
    case 'kamino-lend':
      return 'Kamino Lend main market';
    case 'kamino-vault':
      return route.curator ? `Kamino vault, curated by ${route.curator}` : 'Kamino vault';
    case 'project0':
      return 'Project 0 main pool';
    case 'jupiter-lend':
      return 'Jupiter Lend Earn';
    default:
      return `${route.name} stake pool`;
  }
}

function toLamports(amount: string | number): Decimal {
  return new Decimal(amount).mul(1e9).floor();
}

// A deposit transaction the user signs must need the user's signature and no one else's. The swap provider's
// response is not signed by Hermes, so this check stops a transaction that asks the wallet to authorize a co-signer.
export function assertUserOnlySigner(swapTransaction: string | undefined, userPublicKey: string): void {
  if (!swapTransaction) {
    throw new DepositError('The swap provider is unavailable. Try again shortly.', 503);
  }
  let transaction: VersionedTransaction;
  try {
    transaction = VersionedTransaction.deserialize(Buffer.from(swapTransaction, 'base64'));
  } catch {
    throw new DepositError('The swap provider returned an unreadable transaction. Try again shortly.', 502);
  }
  const user = new PublicKey(userPublicKey);
  if (transaction.message.header.numRequiredSignatures !== 1 || !transaction.message.staticAccountKeys[0].equals(user)) {
    logger.warn(`Jupiter swap for ${userPublicKey} returned a transaction with unexpected signers`);
    throw new DepositError('The swap provider returned an unexpected transaction. Try again shortly.', 502);
  }
}

// The amount cut to the token's decimals, in UI units
function toUiAmount(amount: string | number, decimals: number): string {
  return new Decimal(amount).toDecimalPlaces(decimals, Decimal.ROUND_DOWN).toFixed();
}

function describeSimulationError(simulationError: any): string {
  const message = typeof simulationError === 'string' ? simulationError : JSON.stringify(simulationError);
  if (/insufficient|no record of a prior credit/i.test(message)) {
    return 'Insufficient balance for this deposit (remember to leave SOL for fees)';
  }
  return 'Transaction failed simulation. Try a smaller amount or a higher slippage.';
}

export default new DepositService();
