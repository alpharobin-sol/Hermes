import axios, { AxiosInstance } from 'axios';
import axiosRetry from 'axios-retry';
import Decimal from 'decimal.js';
import { Connection, PublicKey } from '@solana/web3.js';
import { logger } from '../utils/logger';
import { solanaNetwork, SolanaNetwork } from '../config/runtime';
import { getRoute, depositCap, depositStatus, DirectDeposit, RouteConfig, TokenInfo, TOKENS } from '../registry/routes';
import { buildStakePoolDeposit, quoteStakePoolDeposit, StakePoolTarget } from './stake-pool-deposit';
import { buildMarinadeDeposit, quoteMarinadeDeposit } from './marinade-deposit';
import { DepositError } from './errors';

/**
 * HERMES DEPOSIT ROUTER
 * Builds unsigned deposit transactions for the user's wallet to sign.
 * Hermes never holds funds: it quotes a route, returns the transaction, and the user signs it.
 * Only routes with a deposit status for the current network in the registry can be built.
 *
 * Mainnet: SOL -> liquid staking tokens. Routes with a direct deposit (Jito's stake pool, Marinade)
 * quote it against the Jupiter swap API and build whichever gives more of the token.
 * Other routes go through Jupiter.
 * Devnet (SOLANA_NETWORK=devnet): SOL -> stake pools that exist on devnet, deposited directly.
 */

export type DepositMethod = 'jupiter-swap' | 'direct';

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
  compared: { method: DepositMethod; label: string; outAmount: string }[]; // other paths quoted for this deposit
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

    if (best.quote.method === 'direct') {
      return this.buildDirectTransaction(route, best.quote, userPublicKey);
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

    if (route.direct && route.receipt && directAvailable(route.direct, network)) {
      paths.push(this.quoteDirect(route, request, network));
    }
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
    best.quote.compared = others.map((other) => ({
      method: other.quote.method,
      label: other.quote.method === 'jupiter-swap' ? 'Jupiter' : other.quote.routeLabels[0],
      outAmount: other.quote.outAmount,
    }));
    return best;
  }

  private async quoteDirect(route: RouteConfig, request: DepositRequest, network: SolanaNetwork): Promise<Candidate> {
    const direct = route.direct!;
    const lamports = toLamports(request.amount);
    const connection = this.getConnection(network);

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

  private async buildDirectTransaction(route: RouteConfig, quote: DepositQuote, userPublicKey: string): Promise<DepositTransaction> {
    const direct = route.direct!;
    const network = quote.network;
    const lamports = toLamports(quote.inAmount);
    const connection = this.getConnection(network);
    const user = new PublicKey(userPublicKey);

    const balance = await connection.getBalance(user);
    if (lamports.plus(FEE_BUFFER_LAMPORTS).gt(balance)) {
      const hint = network === 'devnet' ? ', or get devnet SOL at faucet.solana.com' : '';
      throw new DepositError(`Insufficient balance: you have ${balance / 1e9} SOL. Keep 0.01 SOL for fees${hint}.`, 422);
    }

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

// SPL stake pools exist on devnet at the same address (Jito). Marinade's deposit is mainnet only.
function directAvailable(direct: DirectDeposit, network: SolanaNetwork): boolean {
  return direct.kind === 'spl-stake-pool' || network === 'mainnet-beta';
}

function directLabel(route: RouteConfig): string {
  return route.direct?.kind === 'marinade' ? 'Marinade liquid staking' : `${route.name} stake pool`;
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
