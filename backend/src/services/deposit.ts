import axios, { AxiosInstance } from 'axios';
import axiosRetry from 'axios-retry';
import Decimal from 'decimal.js';
import { Connection, PublicKey } from '@solana/web3.js';
import { logger } from '../utils/logger';
import { solanaNetwork, SolanaNetwork } from '../config/runtime';
import lstService from './lst';
import { buildStakePoolDeposit, quoteStakePoolDeposit, StakePoolTarget } from './stake-pool-deposit';

/**
 * HERMES DEPOSIT ROUTER
 * Builds unsigned deposit transactions for the user's wallet to sign.
 * Hermes never holds funds: it quotes a route, returns the transaction, and the user signs it.
 *
 * Mainnet: SOL -> liquid staking tokens, routed through the Jupiter swap API.
 * Devnet (SOLANA_NETWORK=devnet): SOL -> stake pools that exist on devnet, deposited directly.
 * Lending and LP routes are not executable yet and should be opened in the protocol's own app.
 */

export const SOL_MINT = 'So11111111111111111111111111111111111111112';

const MAX_PRICE_IMPACT_PCT = Number(process.env.DEPOSIT_MAX_PRICE_IMPACT_PCT || 1);

// SOL kept back on devnet for the token account rent and fees
const DEVNET_FEE_BUFFER_LAMPORTS = 10_000_000;

interface TokenInfo {
  symbol: string;
  mint: string;
  decimals: number;
}

// Tokens a user can deposit from
const INPUT_TOKENS: Record<string, TokenInfo> = {
  SOL: { symbol: 'SOL', mint: SOL_MINT, decimals: 9 },
  USDC: { symbol: 'USDC', mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', decimals: 6 },
  USDT: { symbol: 'USDT', mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', decimals: 6 },
};

// LSTs served by dedicated services (marinade.ts, jito.ts, ...). Keyed by the protocol name the yield APIs return.
const DEDICATED_LSTS: Record<string, TokenInfo> = {
  marinade: { symbol: 'mSOL', mint: 'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So', decimals: 9 },
  jito: { symbol: 'JitoSOL', mint: 'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn', decimals: 9 },
  binance: { symbol: 'BNSOL', mint: 'BNso1VUJnh4zcfpZa6986Ea66P6TCp59hvtNJ8b1X85', decimals: 9 },
  jupiter: { symbol: 'jupSOL', mint: 'jupSoLaHXQiZZTSfEWMTRRgpnyFm8f6sZdosWBjx93v', decimals: 9 },
  drift: { symbol: 'dSOL', mint: 'Dso1bDeDjCQxTrWHqUUi63oBvV7Mdm6WaobLbQ7gnPQ', decimals: 9 },
  helius: { symbol: 'hSOL', mint: 'he1iusmfkpAdwvxLNGV8Y1iSbj4rUy6yMhEA3fotn9A', decimals: 9 },
};

// Stake pools deployed on devnet at the same addresses as mainnet. Keyed by protocol name.
const DEVNET_STAKE_POOLS: Record<string, StakePoolTarget> = {
  jito: {
    symbol: 'JitoSOL',
    pool: 'Jito4APyf642JPZPx3hGc6WWJ8zPKtRbRs4P815Awbb',
    mint: 'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn',
  },
};

export interface DepositRequest {
  protocol: string;
  inputToken: string;
  amount: string | number; // UI units, e.g. 1.5 SOL
  slippageBps?: number;
}

export interface DepositQuote {
  network: SolanaNetwork;
  protocol: string;
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
   * Protocols that can be deposited into from the given input token
   */
  getSupportedProtocols(inputToken: string): { protocol: string; outputToken: string }[] {
    if (inputToken.toUpperCase() !== 'SOL') return [];

    if (solanaNetwork() === 'devnet') {
      return Object.entries(DEVNET_STAKE_POOLS).map(([protocol, target]) => ({ protocol, outputToken: target.symbol }));
    }

    return Object.entries(this.getLSTTargets()).map(([protocol, token]) => ({
      protocol,
      outputToken: token.symbol,
    }));
  }

  /**
   * Quote a deposit without building a transaction
   */
  async getQuote(request: DepositRequest): Promise<DepositQuote> {
    if (solanaNetwork() === 'devnet') {
      const { target, lamports } = this.resolveDevnetDeposit(request);
      const outAmount = await quoteStakePoolDeposit(this.getDevnetConnection(), target, lamports);
      return this.devnetQuote(request, target, lamports, outAmount);
    }

    const { quote } = await this.fetchQuote(request);
    return quote;
  }

  /**
   * Quote a deposit and build the unsigned transaction for the user's wallet
   */
  async buildTransaction(request: DepositRequest, userPublicKey: string): Promise<DepositTransaction> {
    if (solanaNetwork() === 'devnet') {
      return this.buildDevnetTransaction(request, userPublicKey);
    }

    const { quote, rawQuote } = await this.fetchQuote(request);

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
      logger.warn(`Deposit transaction failed simulation (${quote.protocol}): ${JSON.stringify(simulationError)}`);
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

  private async buildDevnetTransaction(request: DepositRequest, userPublicKey: string): Promise<DepositTransaction> {
    const { target, lamports } = this.resolveDevnetDeposit(request);
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
      quote: this.devnetQuote(request, target, lamports, plan.outAmount),
      transaction: transactions[transactions.length - 1],
      transactions,
      lastValidBlockHeight: plan.lastValidBlockHeight,
      prioritizationFeeLamports: 0,
    };
  }

  private resolveDevnetDeposit(request: DepositRequest): { target: StakePoolTarget; lamports: Decimal } {
    if (request.inputToken.toUpperCase() !== 'SOL') {
      throw new DepositError(`Only SOL deposits are supported on devnet`, 422);
    }
    const target = DEVNET_STAKE_POOLS[request.protocol.toLowerCase()];
    if (!target) {
      throw new DepositError(`${request.protocol} has no devnet deposit route`, 422);
    }
    const lamports = new Decimal(request.amount).mul(1e9).floor();
    if (lamports.lte(0)) {
      throw new DepositError('Amount must be greater than zero');
    }
    return { target, lamports };
  }

  private devnetQuote(request: DepositRequest, target: StakePoolTarget, lamports: Decimal, outAmount: string): DepositQuote {
    return {
      network: 'devnet',
      protocol: request.protocol.toLowerCase(),
      method: 'stake-pool',
      inputToken: INPUT_TOKENS.SOL,
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

  private async fetchQuote(request: DepositRequest): Promise<{ quote: DepositQuote; rawQuote: any }> {
    const inputToken = INPUT_TOKENS[request.inputToken.toUpperCase()];
    if (!inputToken) {
      throw new DepositError(`Unsupported input token: ${request.inputToken}`);
    }

    const protocol = request.protocol.toLowerCase();
    const outputToken = inputToken.symbol === 'SOL' ? this.getLSTTargets()[protocol] : undefined;
    if (!outputToken) {
      throw new DepositError(`Deposits from ${inputToken.symbol} into ${request.protocol} are not supported yet`, 422);
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
        protocol,
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

  /**
   * Dedicated LSTs plus the generic LST registry, keyed by protocol name
   */
  private getLSTTargets(): Record<string, TokenInfo> {
    const targets: Record<string, TokenInfo> = { ...DEDICATED_LSTS };

    for (const symbol of lstService.getSupportedLSTs()) {
      const provider = lstService.getLSTProvider(symbol);
      if (provider && !targets[provider.name]) {
        targets[provider.name] = { symbol: provider.symbol, mint: provider.mintAddress, decimals: 9 };
      }
    }

    return targets;
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
