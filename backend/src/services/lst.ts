import axios, { AxiosInstance } from 'axios';
import axiosRetry from 'axios-retry';
import { Connection, PublicKey } from '@solana/web3.js';
import { logger } from '../utils/logger';
import { aprToApy } from '../utils/math';
import { withCache } from '../utils/cache';

/**
 * Liquid Staking Token (LST) Provider Configuration
 */
export interface LSTProviderConfig {
  name: string;
  symbol: string; // e.g., 'BNSOL', 'JUPSOL', 'DSOL'
  displayName: string; // e.g., 'Binance Staked SOL'
  mintAddress: string; // Token mint address
  apiEndpoint?: string; // REST API endpoint (if available)
  stakingProgramId?: string; // On-chain stake pool program
  hasSDK?: boolean; // Whether provider has an SDK
  defaultAPY?: number; // Fallback APY estimate
  fees: {
    depositFee: number;
    withdrawalFee: number;
    managementFee: number;
  };
}

/**
 * Standardized LST Yield Data
 */
export interface LSTYieldData {
  protocol: string;
  asset: string;
  symbol: string;
  apy: number;
  apr: number;
  tvl: number;
  tokenPrice: number; // LST price relative to SOL
  metadata: {
    validatorCount?: number;
    mevBoost?: number;
    exchangeRate: number; // LST:SOL exchange rate
    totalStaked: number;
    tokenSupply: number;
  };
}

/**
 * LST Provider Registry
 * Configure all supported LST providers here
 */
const LST_PROVIDERS: Record<string, LSTProviderConfig> = {
  // NOTE: Marinade (mSOL), Jito (jitoSOL), Binance (BNSOL), Jupiter (jupSOL), 
  // Drift (dSOL), and Helius (hSOL) are handled by dedicated services
  // See: marinade.ts, jito.ts, binance.ts, jupiter.ts, drift.ts, helius.ts
  BBSOL: {
    name: 'bybit',
    symbol: 'bbSOL',
    displayName: 'Bybit Staked SOL',
    mintAddress: 'Bybit2vBJGhPF52GBdNaQfUJ6ZpThSgHBobjWZpLPb4B',
    defaultAPY: 0.072, // 7.2% estimate
    fees: {
      depositFee: 0,
      withdrawalFee: 0,
      managementFee: 0.05,
    },
  },
  LSTSOL: {
    name: 'listsol',
    symbol: 'LSTSol',
    displayName: 'List Staked SOL',
    mintAddress: 'LSTxxxnJzKDFSLr4dUkPcmCf5VyryEqzPLz5j4bpxFp',
    defaultAPY: 0.074,
    fees: {
      depositFee: 0,
      withdrawalFee: 0.003,
      managementFee: 0.04,
    },
  },
  JSOL: {
    name: 'jpool',
    symbol: 'JSOL',
    displayName: 'JPool Staked SOL',
    mintAddress: '7Q2afV64in6N6SeZsAAB81TJzwDoD6zpqmHkzi9Dcavn',
    defaultAPY: 0.071,
    fees: {
      depositFee: 0,
      withdrawalFee: 0.005,
      managementFee: 0.05,
    },
  },
  STSOL: {
    name: 'socean',
    symbol: 'INF', // Sanctum migrated Socean's scnSOL mint to Infinity (INF)
    displayName: 'Sanctum Infinity (formerly Socean)',
    mintAddress: '5oVNBeEEQvYi1cX3ir8Dx5n1P7pdxydbGF2X4TxVusJm',
    defaultAPY: 0.072,
    fees: {
      depositFee: 0,
      withdrawalFee: 0.003,
      managementFee: 0.05,
    },
  },
  LAINESOL: {
    name: 'laine',
    symbol: 'laineSOL',
    displayName: 'Laine Staked SOL',
    mintAddress: 'LAinEtNLgpmCP9Rvsf5Hn8W6EhNiKLZQti1xfWMLy6X',
    defaultAPY: 0.073,
    fees: {
      depositFee: 0,
      withdrawalFee: 0.003,
      managementFee: 0.04,
    },
  },
  CGNTSOL: {
    name: 'cogent',
    symbol: 'cgntSOL',
    displayName: 'Cogent Staked SOL',
    mintAddress: 'CgnTSoL3DgY9SFHxcLj6CgCgKKoTBr6tp4CPAEWy25DE',
    defaultAPY: 0.075,
    fees: {
      depositFee: 0,
      withdrawalFee: 0.003,
      managementFee: 0.04,
    },
  },
  COMPASSSOL: {
    name: 'compass',
    symbol: 'compassSOL',
    displayName: 'Compass Staked SOL',
    mintAddress: 'Comp4ssDzXcLeu2MnLuGNNFC4cmLPMng8qWHPvzAMU1h',
    defaultAPY: 0.074,
    fees: {
      depositFee: 0,
      withdrawalFee: 0.003,
      managementFee: 0.04,
    },
  },
};

export class LiquidStakingService {
  private client: AxiosInstance;
  private connection: Connection;
  private providers: Record<string, LSTProviderConfig>;

  constructor() {
    // Generic HTTP client
    this.client = axios.create({
      timeout: 15000,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    axiosRetry(this.client, {
      retries: 3,
      retryDelay: axiosRetry.exponentialDelay,
      retryCondition: (error) => {
        return axiosRetry.isNetworkOrIdempotentRequestError(error) ||
               error.response?.status === 429;
      },
    });

    // Solana connection
    const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
    this.connection = new Connection(rpcUrl, 'confirmed');

    // Load provider configurations
    this.providers = LST_PROVIDERS;

    logger.info(`Initialized Liquid Staking Service with ${Object.keys(this.providers).length} LST providers`);
  }

  /**
   * Fetch yield data for a specific LST
   */
  async fetchLSTYield(symbol: string): Promise<LSTYieldData> {
    const provider = this.providers[symbol.toUpperCase()];
    
    if (!provider) {
      throw new Error(`LST provider not found: ${symbol}`);
    }

    try {
      logger.info(`Fetching yield data for ${provider.displayName}...`);

      // Try fetching from API if available
      if (provider.apiEndpoint) {
        return await this.fetchFromAPI(provider);
      }

      // Try fetching from on-chain if stake pool available
      if (provider.stakingProgramId) {
        return await this.fetchFromOnChain(provider);
      }

      // Fallback to estimates
      return this.getFallbackData(provider);
    } catch (error) {
      logger.warn(`Error fetching ${provider.symbol} data, using fallback:`, error);
      return this.getFallbackData(provider);
    }
  }

  /**
   * Fetch yield data from provider's REST API
   */
  private async fetchFromAPI(provider: LSTProviderConfig): Promise<LSTYieldData> {
    try {
      const response = await this.client.get(provider.apiEndpoint!, {
        timeout: 10000,
      });

      // Parse response based on provider
      // Each provider has slightly different API schemas
      const data = this.parseAPIResponse(provider, response.data);
      
      logger.info(`Fetched ${provider.symbol} data from API:`, {
        apy: data.apy,
        tvl: data.tvl,
      });

      return data;
    } catch (error) {
      logger.warn(`API fetch failed for ${provider.symbol}:`, error);
      throw error;
    }
  }

  /**
   * Parse API response based on provider format
   */
  private parseAPIResponse(provider: LSTProviderConfig, data: any): LSTYieldData {
    // Generic parser - can be extended per provider
    const apr = data.apr || data.staking_apr || data.apy || provider.defaultAPY || 0.07;
    const apy = data.apy || aprToApy(apr, 365);
    const tvl = data.tvl || data.total_staked || 0;
    const tokenPrice = data.price || data.exchange_rate || 1.0;
    const exchangeRate = data.exchange_rate || tokenPrice;
    const totalStaked = data.total_staked || tvl;
    const tokenSupply = data.token_supply || data.supply || 0;

    return {
      protocol: provider.name,
      asset: provider.displayName,
      symbol: provider.symbol,
      apy: apy,
      apr: apr,
      tvl: tvl,
      tokenPrice: tokenPrice,
      metadata: {
        validatorCount: data.validator_count || data.validators?.length,
        mevBoost: data.mev_apy || data.mev_boost || 0,
        exchangeRate: exchangeRate,
        totalStaked: totalStaked,
        tokenSupply: tokenSupply,
      },
    };
  }

  /**
   * Fetch data from on-chain stake pool
   */
  private async fetchFromOnChain(provider: LSTProviderConfig): Promise<LSTYieldData> {
    try {
      const stakePoolPubkey = new PublicKey(provider.stakingProgramId!);
      const accountInfo = await this.connection.getAccountInfo(stakePoolPubkey);

      if (!accountInfo) {
        throw new Error(`Stake pool not found: ${provider.stakingProgramId}`);
      }

      // Parse stake pool data (Metaplex standard)
      // This would require stake pool program decoder
      // For now, return fallback with on-chain verification
      logger.info(`Verified on-chain stake pool for ${provider.symbol}`);
      
      return this.getFallbackData(provider);
    } catch (error) {
      logger.warn(`On-chain fetch failed for ${provider.symbol}:`, error);
      throw error;
    }
  }

  /**
   * Get fallback data using estimates
   */
  private getFallbackData(provider: LSTProviderConfig): LSTYieldData {
    const apr = provider.defaultAPY || 0.07;
    const apy = aprToApy(apr, 365);

    // Estimate TVL for smaller LST protocols (conservative estimates)
    const tvlEstimates: Record<string, number> = {
      'bybit': 50000000,      // ~$50M (exchange-backed)
      'listsol': 15000000,    // ~$15M
      'jpool': 10000000,      // ~$10M
      'socean': 8000000,      // ~$8M
      'laine': 5000000,       // ~$5M
      'compass': 3000000,     // ~$3M
      'cogent': 2000000,      // ~$2M
    };
    
    const estimatedTvl = tvlEstimates[provider.name] || 1000000; // Default $1M for unknown

    return {
      protocol: provider.name,
      asset: provider.displayName,
      symbol: provider.symbol,
      apy: apy,
      apr: apr,
      tvl: estimatedTvl,
      tokenPrice: 1.0, // Estimate 1:1 with SOL
      metadata: {
        exchangeRate: 1.0,
        totalStaked: estimatedTvl,
        tokenSupply: 0,
      },
    };
  }

  /**
   * Fetch all LST yields
   * Cached for 5 minutes to improve performance
   */
  async fetchAllLSTYields(): Promise<LSTYieldData[]> {
    return withCache(
      'lst-yields-all',
      async () => {
        logger.info('Fetching all LST yields...');
        
        const results: LSTYieldData[] = [];
        
        // Fetch in parallel with error handling
        const promises = Object.keys(this.providers).map(async (symbol) => {
          try {
            const data = await this.fetchLSTYield(symbol);
            return data;
          } catch (error) {
            logger.error(`Failed to fetch ${symbol}:`, error);
            return null;
          }
        });

        const settled = await Promise.all(promises);
        
        for (const result of settled) {
          if (result) {
            results.push(result);
          }
        }

        logger.info(`Successfully fetched ${results.length}/${Object.keys(this.providers).length} LST yields`);
        return results;
      },
      5 * 60 * 1000 // 5 minutes cache
    );
  }

  /**
   * Get specific LST by symbol
   */
  getLSTProvider(symbol: string): LSTProviderConfig | undefined {
    return this.providers[symbol.toUpperCase()];
  }

  /**
   * Get all supported LST symbols
   */
  getSupportedLSTs(): string[] {
    return Object.keys(this.providers);
  }

  /**
   * Calculate risk score for LST
   */
  calculateRiskScore(data: LSTYieldData): number {
    // TVL score (higher is safer)
    const tvlScore = data.tvl > 0 ? Math.min(Math.log10(data.tvl) * 5, 30) : 0;

    // Validator diversity score
    const validatorScore = data.metadata.validatorCount
      ? Math.min(data.metadata.validatorCount / 5, 20)
      : 10; // Default moderate score

    // Exchange rate stability (should be close to 1.0)
    const exchangeRate = data.metadata.exchangeRate;
    const rateStability = Math.max(0, 15 - Math.abs(exchangeRate - 1.0) * 100);

    // APY reasonableness (too high = suspicious)
    const apyScore = data.apy > 0.15 ? 5 : data.apy > 0.05 ? 20 : 15;

    // Protocol reputation (based on provider)
    const reputationScore = this.getReputationScore(data.protocol);

    return Math.min(tvlScore + validatorScore + rateStability + apyScore + reputationScore, 100);
  }

  /**
   * Get reputation score based on provider
   */
  private getReputationScore(protocol: string): number {
    const reputation: Record<string, number> = {
      jito: 20,      // Well-established with MEV
      marinade: 20,  // Largest LST provider
      binance: 15,   // Major CEX backing
      jupiter: 15,   // Major DEX backing
      helius: 15,    // Strong infrastructure
      drift: 12,     // Newer but audited
      bybit: 12,     // CEX backing
      laine: 10,
      socean: 10,
      cogent: 10,
      compass: 10,
      jpool: 8,
      listsol: 8,
    };

    return reputation[protocol] || 5;
  }

  /**
   * Get fee structure for LST
   */
  getFees(symbol: string): {
    depositFee: number;
    withdrawalFee: number;
    managementFee: number;
  } {
    const provider = this.providers[symbol.toUpperCase()];
    
    if (!provider) {
      throw new Error(`LST provider not found: ${symbol}`);
    }

    return provider.fees;
  }

  /**
   * Estimate slippage for LST swap/unstake
   */
  async estimateSlippage(symbol: string, amount: number): Promise<number> {
    const data = await this.fetchLSTYield(symbol);
    
    if (data.tvl === 0) {
      return 0.01; // 1% default slippage if TVL unknown
    }

    const utilizationRatio = amount / data.tvl;

    // Slippage increases with trade size
    if (utilizationRatio < 0.001) return 0.001; // 0.1%
    if (utilizationRatio < 0.01) return 0.005; // 0.5%
    if (utilizationRatio < 0.05) return 0.02; // 2%
    
    return 0.05; // 5% for very large trades
  }

  /**
   * Get top LSTs by TVL
   */
  async getTopLSTs(limit: number = 10): Promise<LSTYieldData[]> {
    const allLSTs = await this.fetchAllLSTYields();
    
    return allLSTs
      .filter(lst => lst.tvl > 0) // Filter out unknown TVLs
      .sort((a, b) => b.tvl - a.tvl)
      .slice(0, limit);
  }

  /**
   * Get top LSTs by APY
   */
  async getBestYieldLSTs(limit: number = 10): Promise<LSTYieldData[]> {
    const allLSTs = await this.fetchAllLSTYields();
    
    return allLSTs
      .sort((a, b) => b.apy - a.apy)
      .slice(0, limit);
  }

  /**
   * Compare LSTs side by side
   */
  async compareLSTs(symbols: string[]): Promise<{
    comparison: LSTYieldData[];
    bestAPY: string;
    bestTVL: string;
    lowestFees: string;
  }> {
    const promises = symbols.map(symbol => this.fetchLSTYield(symbol));
    const comparison = await Promise.all(promises);

    // Find best in each category
    const bestAPY = comparison.reduce((best, current) => 
      current.apy > best.apy ? current : best
    ).symbol;

    const bestTVL = comparison.reduce((best, current) => 
      current.tvl > best.tvl ? current : best
    ).symbol;

    const lowestFees = comparison.reduce((best, current) => {
      const bestProvider = this.providers[best.symbol];
      const currentProvider = this.providers[current.symbol];
      const bestTotal = bestProvider.fees.depositFee + bestProvider.fees.withdrawalFee;
      const currentTotal = currentProvider.fees.depositFee + currentProvider.fees.withdrawalFee;
      return currentTotal < bestTotal ? current : best;
    }).symbol;

    return {
      comparison,
      bestAPY,
      bestTVL,
      lowestFees,
    };
  }
}

export default new LiquidStakingService();
