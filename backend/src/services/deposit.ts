import axios, { AxiosInstance } from 'axios';
import axiosRetry from 'axios-retry';
import Decimal from 'decimal.js';
import { Connection, PublicKey } from '@solana/web3.js';
import { logger } from '../utils/logger';
import { solanaNetwork, SolanaNetwork } from '../config/runtime';
import { getRoute, depositStatus, RouteConfig, TokenInfo, TOKENS } from '../registry/routes';
import { buildStakePoolDeposit, quoteStakePoolDeposit, StakePoolTarget } from './stake-pool-deposit';

/**
 * HERMES DEPOSIT ROUTER
 * Builds unsigned deposit transactions for the user's wallet to sign.
 * Hermes never holds funds: it quotes a route, returns the transaction, and the user signs it.
 * Only routes with a deposit status for the current network in the registry can be built.
 *
 * Mainnet: SOL -> liquid staking tokens, routed through the Jupiter swap API.
 * Devnet (SOLANA_NETWORK=devnet): SOL -> stake pools that exist on devnet, deposited directly.
 */

const MAX_PRICE_IMPACT_PCT = Number(process.env.DEPOSIT_MAX_PRICE_IMPACT_PCT || 1);

// SOL kept back on devnet for the token account rent and fees
const DEVNET_FEE_BUFFER_LAMPORTS = 10_000_000;

// Stake pools deployed on devnet at the same addresses as mainnet. Keyed by route id.
const DEVNET_STAKE_POOLS: Record<string, StakePoolTarget> = {
  jito: {
    symbol: 'JitoSOL',
    pool: 'Jito4APyf642JPZPx3hGc6WWJ8zPKtRbRs4P815Awbb',
    mint: 'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn',
  },
};

export interface DepositRequest {
  routeId: string;
  amount: string | number; // UI units, e.g. 1.5 SOL
  slippageBps?: number;
}

export interface DepositQuote {
  network: SolanaNetwork;
  routeId: string;
  method: 'jupiter-swap' | 'stake-pool';
  inputToken: TokenInfo;
  outputToken: TokenInfo;
  inAmount: string; // UI units
  outAmount: string; // UI units, expected
  minOutAmount: string; // UI units, after slippage
  priceImpactPct: number;
  slippageBps: number;
  routeLabels: string[];
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

export class DepositService {
  private client: AxiosInstance;
  private devnetConnection: Connection | null = null;

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
    const route = this.resolveRoute(request.routeId);

    if (solanaNetwork() === 'devnet') {
      const { target, lamports } = this.resolveDevnetDeposit(route, request);
      const outAmount = await quoteStakePoolDeposit(this.getDevnetConnection(), target, lamports);
      return this.devnetQuote(route, target, lamports, outAmount);
    }

    const { quote } = await this.fetchQuote(route, request);
    return quote;
  }

  /**
   * Quote a deposit and build the unsigned transaction for the user's wallet
   */
  async buildTransaction(request: DepositRequest, userPublicKey: string): Promise<DepositTransaction> {
    const route = this.resolveRoute(request.routeId);

    if (solanaNetwork() === 'devnet') {
      return this.buildDevnetTransaction(route, request, userPublicKey);
    }

    const { quote, rawQuote } = await this.fetchQuote(route, request);

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
      throw new DepositError(this.describeSimulationError(simulationError), 422);
    }

    logger.info(`Built deposit transaction: ${quote.inAmount} ${quote.inputToken.symbol} -> ${quote.outputToken.symbol}`);

    return {
      quote,
      transaction: swapTransaction,
      transactions: [swapTransaction],
      lastValidBlockHeight,
      prioritizationFeeLamports,
    };
  }

  private async buildDevnetTransaction(route: RouteConfig, request: DepositRequest, userPublicKey: string): Promise<DepositTransaction> {
    const { target, lamports } = this.resolveDevnetDeposit(route, request);
    const connection = this.getDevnetConnection();
    const user = new PublicKey(userPublicKey);

    const balance = await connection.getBalance(user);
    if (lamports.plus(DEVNET_FEE_BUFFER_LAMPORTS).gt(balance)) {
      throw new DepositError(
        `Insufficient devnet balance: you have ${balance / 1e9} SOL. Keep 0.01 SOL for fees, or get devnet SOL at faucet.solana.com`,
        422
      );
    }

    let plan;
    try {
      plan = await buildStakePoolDeposit(connection, target, lamports, user);
    } catch (error) {
      throw new DepositError(error instanceof Error ? error.message : 'Failed to build stake pool deposit', 422);
    }

    // Later transactions depend on earlier ones landing first, so only the first can be simulated now
    const simulation = await connection.simulateTransaction(plan.transactions[0], { sigVerify: false });
    if (simulation.value.err) {
      const details = JSON.stringify({ err: simulation.value.err, logs: simulation.value.logs?.slice(-4) });
      logger.warn(`Devnet deposit failed simulation (${target.symbol}): ${details}`);
      throw new DepositError(this.describeSimulationError(details), 422);
    }

    const transactions = plan.transactions.map((tx) => Buffer.from(tx.serialize()).toString('base64'));
    logger.info(`Built devnet deposit: ${toUiSol(lamports)} SOL -> ${target.symbol} in ${transactions.length} transaction(s)`);

    return {
      quote: this.devnetQuote(route, target, lamports, plan.outAmount),
      transaction: transactions[transactions.length - 1],
      transactions,
      lastValidBlockHeight: plan.lastValidBlockHeight,
      prioritizationFeeLamports: 0,
    };
  }

  /**
   * The registry route, if Hermes can deposit into it on the current network
   */
  private resolveRoute(routeId: string): RouteConfig {
    const route = getRoute(routeId);
    if (!route) {
      throw new DepositError(`Unknown route: ${routeId}`, 404);
    }
    if (!depositStatus(route, solanaNetwork())) {
      throw new DepositError(`${route.name} deposits are not available in Hermes on ${solanaNetwork()} yet`, 422);
    }
    return route;
  }

  private resolveDevnetDeposit(route: RouteConfig, request: DepositRequest): { target: StakePoolTarget; lamports: Decimal } {
    const target = DEVNET_STAKE_POOLS[route.id];
    if (!target) {
      throw new DepositError(`${route.name} has no devnet deposit route`, 422);
    }
    const lamports = new Decimal(request.amount).mul(1e9).floor();
    if (lamports.lte(0)) {
      throw new DepositError('Amount must be greater than zero');
    }
    return { target, lamports };
  }

  private devnetQuote(route: RouteConfig, target: StakePoolTarget, lamports: Decimal, outAmount: string): DepositQuote {
    return {
      network: 'devnet',
      routeId: route.id,
      method: 'stake-pool',
      inputToken: TOKENS.SOL,
      outputToken: { symbol: target.symbol, mint: target.mint, decimals: 9 },
      inAmount: toUiSol(lamports),
      outAmount,
      // Stake pool deposits mint at the pool's exchange rate, there is no slippage
      minOutAmount: outAmount,
      priceImpactPct: 0,
      slippageBps: 0,
      routeLabels: [`${target.symbol} stake pool (devnet)`],
    };
  }

  private getDevnetConnection(): Connection {
    if (!this.devnetConnection) {
      this.devnetConnection = new Connection(process.env.DEVNET_RPC_URL || 'https://api.devnet.solana.com', 'confirmed');
    }
    return this.devnetConnection;
  }

  private async fetchQuote(route: RouteConfig, request: DepositRequest): Promise<{ quote: DepositQuote; rawQuote: any }> {
    const inputToken: TokenInfo = TOKENS[route.token];
    // Mainnet deposits swap into the route's receipt token, so only token-receipt routes qualify
    const outputToken = route.receipt;
    if (!outputToken) {
      throw new DepositError(`${route.name} deposits are not available in Hermes yet`, 422);
    }

    const amount = new Decimal(request.amount);
    const rawAmount = amount.mul(new Decimal(10).pow(inputToken.decimals)).floor();
    if (rawAmount.lte(0)) {
      throw new DepositError('Amount must be greater than zero');
    }

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
      },
    };
  }

  private describeSimulationError(simulationError: any): string {
    const message = typeof simulationError === 'string' ? simulationError : JSON.stringify(simulationError);
    if (/insufficient|no record of a prior credit/i.test(message)) {
      return 'Insufficient balance for this deposit (remember to leave SOL for fees)';
    }
    return 'Transaction failed simulation. Try a smaller amount or a higher slippage.';
  }
}

function toUiSol(lamports: Decimal): string {
  return lamports.div(1e9).toFixed();
}

export default new DepositService();
