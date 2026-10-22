import axios, { AxiosInstance } from 'axios';
import axiosRetry from 'axios-retry';
import { logger } from '../utils/logger';
import { aprToApy } from '../utils/math';
import coinGeckoService from './coingecko';

/**
 * Binance Staked SOL (BNSOL) Yield Data
 */
export interface BinanceYieldData {
  protocol: 'binance';
  asset: 'BNSOL';
  apy: number;
  apr: number;
  tvl: number;
  bnsolPrice: number;
  exchangeRate: number;
  metadata: {
    totalStaked: number;
    tokenSupply: number;
    stakingFee: number;
    unstakingFee: number;
  };
}

export class BinanceService {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: 'https://api.binance.com',
      timeout: 10000,
    });

    axiosRetry(this.client, {
      retries: 3,
      retryDelay: axiosRetry.exponentialDelay,
    });
  }

  /**
   * Fetch Binance Staked SOL yield data
   * PRIMARY: CoinGecko (reliable) | REMOVED: Sanctum (unreliable)
   */
  async fetchYieldData(): Promise<BinanceYieldData> {
    try {
      logger.info('Fetching Binance BNSOL yield data...');

      // Use CoinGecko as PRIMARY source (verified reliable)
      const cgData = await coinGeckoService.getLSTData('binance');
      if (cgData && cgData.marketCap > 0) {
        logger.info(`BNSOL data from CoinGecko: $${(cgData.marketCap / 1e6).toFixed(1)}M TVL`);
        return {
          protocol: 'binance',
          asset: 'BNSOL',
          apy: aprToApy(0.073), // 7.3% estimated staking APY
          apr: 0.073,
          tvl: cgData.marketCap,
          bnsolPrice: cgData.price,
          exchangeRate: cgData.price / 135, // Approximate SOL price
          metadata: {
            totalStaked: cgData.marketCap,
            tokenSupply: 0,
            stakingFee: 0,
            unstakingFee: 0,
          },
        };
      }

      // Fallback if CoinGecko also fails
      return await this.getFallbackData();
    } catch (error) {
      logger.error('Error fetching Binance yield data:', error);
      return await this.getFallbackData();
    }
  }

  // REMOVED: fetchFromSanctum() - Sanctum API is unreliable
  // Now using CoinGecko as primary source (more stable)

  /**
   * Fallback data when APIs unavailable - tries CoinGecko first
   */
  private async getFallbackData(): Promise<BinanceYieldData> {
    // Try CoinGecko for real market cap data
    try {
      const cgData = await coinGeckoService.getLSTData('binance');
      if (cgData && cgData.marketCap > 0) {
        logger.info(`Using CoinGecko for BNSOL fallback: $${(cgData.marketCap / 1e6).toFixed(1)}M`);
        return {
          protocol: 'binance',
          asset: 'BNSOL',
          apy: aprToApy(0.073),
          apr: 0.073,
          tvl: cgData.marketCap,
          bnsolPrice: cgData.price,
          exchangeRate: cgData.price / 135, // Rough SOL price estimate
          metadata: {
            totalStaked: 0,
            tokenSupply: 0,
            stakingFee: 0,
            unstakingFee: 0,
          },
        };
      }
    } catch (error) {
      logger.warn('CoinGecko also unavailable for BNSOL');
    }

    // Final fallback with reasonable estimate (Binance is major CEX)
    logger.warn('Using fallback estimate for BNSOL: $1.08B');
    return {
      protocol: 'binance',
      asset: 'BNSOL',
      apy: aprToApy(0.073),
      apr: 0.073,
      tvl: 1080000000, // ~$1.08B estimate (last known good value)
      bnsolPrice: 138,
      exchangeRate: 1.02,
      metadata: {
        totalStaked: 1080000000,
        tokenSupply: 0,
        stakingFee: 0,
        unstakingFee: 0,
      },
    };
  }

  /**
   * Calculate risk score for BNSOL
   */
  calculateRiskScore(data: BinanceYieldData): number {
    let score = 50;

    // TVL score (Binance is large exchange)
    if (data.tvl > 5e8) score += 25; // > $500M
    else if (data.tvl > 1e8) score += 20; // > $100M
    else if (data.tvl > 5e7) score += 15; // > $50M

    // Exchange reputation (Binance is major CEX)
    score += 15;

    // Liquidity (CEX backing)
    score += 10;

    return Math.min(score, 100);
  }

  /**
   * Get fee structure
   */
  getFeeStructure() {
    return {
      depositFee: 0,
      withdrawalFee: 0,
      managementFee: 0.05, // 5% commission estimate
    };
  }

  /**
   * Estimate slippage for BNSOL swap
   */
  async estimateSlippage(amount: number): Promise<number> {
    // BNSOL has good liquidity due to Binance backing
    if (amount < 100) return 0.001; // 0.1%
    if (amount < 1000) return 0.003; // 0.3%
    if (amount < 10000) return 0.01; // 1%
    return 0.02; // 2% for large amounts
  }
}

export default new BinanceService();
