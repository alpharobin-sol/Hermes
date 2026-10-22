import axios, { AxiosInstance } from 'axios';
import axiosRetry from 'axios-retry';
import Decimal from 'decimal.js';
import { logger } from '../utils/logger';
import lstService from './lst';

/**
 * HERMES DEPOSIT ROUTER
 * Builds unsigned deposit transactions for the user's wallet to sign.
 * Hermes never holds funds: it quotes a route, returns the transaction, and the user signs it.
 *
 * Supported today: SOL -> liquid staking tokens, routed through the Jupiter swap API.
 * Lending and LP routes are not executable yet and should be opened in the protocol's own app.
 */

export const SOL_MINT = 'So11111111111111111111111111111111111111112';

const MAX_PRICE_IMPACT_PCT = Number(process.env.DEPOSIT_MAX_PRICE_IMPACT_PCT || 1);

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

export interface DepositRequest {
  protocol: string;
  inputToken: string;
  amount: string | number; // UI units, e.g. 1.5 SOL
  slippageBps?: number;
}

export interface DepositQuote {
  protocol: string;
  method: 'jupiter-swap';
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
  transaction: string; // base64 VersionedTransaction, unsigned
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

    return Object.entries(this.getLSTTargets()).map(([protocol, token]) => ({
      protocol,
      outputToken: token.symbol,
    }));
  }

  /**
   * Quote a deposit without building a transaction
   */
  async getQuote(request: DepositRequest): Promise<DepositQuote> {
    const { quote } = await this.fetchQuote(request);
    return quote;
  }

  /**
   * Quote a deposit and build the unsigned transaction for the user's wallet
   */
  async buildTransaction(request: DepositRequest, userPublicKey: string): Promise<DepositTransaction> {
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
      lastValidBlockHeight,
      prioritizationFeeLamports,
    };
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

export default new DepositService();
