import axios, { AxiosInstance } from 'axios';
import axiosRetry from 'axios-retry';
import Decimal from 'decimal.js';
import { Connection, PublicKey } from '@solana/web3.js';
import { logger } from '../utils/logger';
import { solanaNetwork, SolanaNetwork } from '../config/runtime';
import { getRoute, depositCap, depositStatus, RouteConfig, TokenInfo, TOKENS } from '../registry/routes';
import { buildStakePoolDeposit, quoteStakePoolDeposit, StakePoolTarget } from './stake-pool-deposit';

/**
 * HERMES DEPOSIT ROUTER
 * Builds unsigned deposit transactions for the user's wallet to sign.
 * Hermes never holds funds: it quotes a route, returns the transaction, and the user signs it.
 * Only routes with a deposit status for the current network in the registry can be built.
 *
 * Mainnet: SOL -> liquid staking tokens. Routes with a stake pool quote it against the Jupiter
 * swap API and build whichever gives more of the token. Other routes go through Jupiter.
 * Devnet (SOLANA_NETWORK=devnet): SOL -> stake pools that exist on devnet, deposited directly.
 */

export type DepositMethod = 'jupiter-swap' | 'stake-pool';

const MAX_PRICE_IMPACT_PCT = Number(process.env.DEPOSIT_MAX_PRICE_IMPACT_PCT || 1);

// SOL kept back for the token account rent and fees
const FEE_BUFFER_LAMPORTS = 10_000_000;

export interface DepositRequest {
  routeId: string;
  amount: string | number; // UI units, e.g. 1.5 SOL
  slippageBps?: number;
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
  compared: { method: DepositMethod; outAmount: string }[]; // other paths quoted for this deposit
}

export interface DepositTransaction {
  quote: DepositQuote;
  transaction: string; // base64 VersionedTransaction, unsigned. The deposit itself (last of `transactions`)
  transactions: string[]; // every transaction to sign and send, in order
  lastValidBlockHeight: number;
  prioritizationFeeLamports: number;
}

export class DepositError extends Error {
  constructor(message: string, public readonly status: number = 400) {
    super(message);
  }
}

interface Candidate {
  quote: DepositQuote;
  rawQuote?: any; // Jupiter quote, needed to build the swap
}

export class DepositService {
  private client: AxiosInstance;
  private connections: Partial<Record<SolanaNetwork, Connection>> = {};

  constructor() {
    const apiKey = process.env.JUPITER_API_KEY;

    this.client = axios.create({
      baseURL: process.env.JUPITER_API_URL || 'https://lite-api.jup.ag/swap/v1',
      timeout: 15000,
      headers: apiKey ? { 'x-api-key': apiKey } : undefined,
    });

    axiosRetry(this.client, {
      retries: 3,
      retryDelay: axiosRetry.exponentialDelay,
      retryCondition: (error) => {
        return axiosRetry.isNetworkOrIdempotentRequestError(error) ||
               error.response?.status === 429;
      },
    });
  }

  /**
   * Quote a deposit without building a transaction
   */
  async getQuote(request: DepositRequest): Promise<DepositQuote> {
    const route = this.resolveRoute(request);
    return (await this.bestCandidate(route, request)).quote;
  }

  /**
   * Quote a deposit and build the unsigned transaction for the user's wallet
   */
  async buildTransaction(request: DepositRequest, userPublicKey: string): Promise<DepositTransaction> {
    const route = this.resolveRoute(request);
    const best = await this.bestCandidate(route, request);

    if (best.quote.method === 'stake-pool') {
      return this.buildStakePoolTransaction(route, best.quote, userPublicKey);
    }
    return this.buildSwapTransaction(best, userPublicKey);
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
  private async bestCandidate(route: RouteConfig, request: DepositRequest): Promise<Candidate> {
    const network = solanaNetwork();
    const paths: Promise<Candidate>[] = [];

    if (route.stakePool && route.receipt) paths.push(this.quoteStakePool(route, request, network));
    // Jupiter has no devnet routes
    if (network === 'mainnet-beta' && route.receipt) paths.push(this.quoteSwap(route, request));

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
    const [best, ...others] = candidates;
    best.quote.compared = others.map((other) => ({ method: other.quote.method, outAmount: other.quote.outAmount }));
    return best;
  }

  private async quoteStakePool(route: RouteConfig, request: DepositRequest, network: SolanaNetwork): Promise<Candidate> {
    const target = stakePoolTarget(route);
    const lamports = toLamports(request.amount);
    const { outAmount, poolUpdateNeeded } = await quoteStakePoolDeposit(this.getConnection(network), target, lamports);

    // Mainnet pools are updated by their operator early each epoch. Until then, use Jupiter.
    if (poolUpdateNeeded && network === 'mainnet-beta') {
      throw new DepositError(`The ${target.symbol} stake pool is between epochs. Try again in a few minutes.`, 503);
    }

    return {
      quote: {
        network,
        routeId: route.id,
        method: 'stake-pool',
        inputToken: TOKENS.SOL,
        outputToken: route.receipt!,
        inAmount: lamports.div(1e9).toFixed(),
        outAmount,
        // Stake pool deposits mint at the pool's exchange rate, there is no slippage
        minOutAmount: outAmount,
        priceImpactPct: 0,
        slippageBps: 0,
        routeLabels: [`${route.name} stake pool${network === 'devnet' ? ' (devnet)' : ''}`],
        compared: [],
      },
    };
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

    logger.info(`Built swap deposit: ${quote.inAmount} ${quote.inputToken.symbol} -> ${quote.outputToken.symbol}`);

    return {
      quote,
      transaction: swapTransaction,
      transactions: [swapTransaction],
      lastValidBlockHeight,
      prioritizationFeeLamports,
    };
  }

  private async buildStakePoolTransaction(route: RouteConfig, quote: DepositQuote, userPublicKey: string): Promise<DepositTransaction> {
    const network = quote.network;
    const target = stakePoolTarget(route);
    const lamports = toLamports(quote.inAmount);
    const connection = this.getConnection(network);
    const user = new PublicKey(userPublicKey);

    const balance = await connection.getBalance(user);
    if (lamports.plus(FEE_BUFFER_LAMPORTS).gt(balance)) {
      const hint = network === 'devnet' ? ', or get devnet SOL at faucet.solana.com' : '';
      throw new DepositError(`Insufficient balance: you have ${balance / 1e9} SOL. Keep 0.01 SOL for fees${hint}.`, 422);
    }

    let plan;
    try {
      plan = await buildStakePoolDeposit(connection, target, lamports, user, {
        allowPoolUpdate: network === 'devnet',
        priorityFee: network === 'mainnet-beta',
      });
    } catch (error) {
      throw new DepositError(error instanceof Error ? error.message : 'Failed to build stake pool deposit', 422);
    }

    // Later transactions depend on earlier ones landing first, so only the first can be simulated now
    const simulation = await connection.simulateTransaction(plan.transactions[0], { sigVerify: false });
    if (simulation.value.err) {
      const details = JSON.stringify({ err: simulation.value.err, logs: simulation.value.logs?.slice(-4) });
      logger.warn(`Stake pool deposit failed simulation (${target.symbol}, ${network}): ${details}`);
      throw new DepositError(describeSimulationError(details), 422);
    }

    const transactions = plan.transactions.map((tx) => Buffer.from(tx.serialize()).toString('base64'));
    logger.info(`Built stake pool deposit on ${network}: ${quote.inAmount} SOL -> ${target.symbol} in ${transactions.length} transaction(s)`);

    return {
      // The pool's rate when the transaction was built
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

function stakePoolTarget(route: RouteConfig): StakePoolTarget {
  return { symbol: route.receipt!.symbol, pool: route.stakePool!, mint: route.receipt!.mint };
}

function toLamports(amount: string | number): Decimal {
  return new Decimal(amount).mul(1e9).floor();
}

function describeSimulationError(simulationError: any): string {
  const message = typeof simulationError === 'string' ? simulationError : JSON.stringify(simulationError);
  if (/insufficient|no record of a prior credit/i.test(message)) {
    return 'Insufficient balance for this deposit (remember to leave SOL for fees)';
  }
  return 'Transaction failed simulation. Try a smaller amount or a higher slippage.';
}

export default new DepositService();
