import axios, { AxiosInstance } from 'axios';
import axiosRetry from 'axios-retry';
import { logger } from '../utils/logger';
import { aprToApy } from '../utils/math';
import coinGeckoService from './coingecko';

/**
 * Jupiter Staked SOL (jupSOL) Yield Data
 */
export interface JupiterYieldData {
  protocol: 'jupiter';
  asset: 'jupSOL';
  apy: number;
  apr: number;
  tvl: number;
  jupsolPrice: number;
  exchangeRate: number;
  metadata: {
    totalStaked: number;
    tokenSupply: number;
    validatorCount: number;
    commission: number;
  };
}

export class JupiterService {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: 'https://stake.jup.ag',
      timeout: 10000,
    });

    axiosRetry(this.client, {
      retries: 3,
      retryDelay: axiosRetry.exponentialDelay,
    });
  }

  /**
   * Fetch Jupiter Staked SOL yield data
   * PRIMARY: Jupiter API | FALLBACK: CoinGecko | REMOVED: Sanctum
   */
  async fetchYieldData(): Promise<JupiterYieldData> {
    try {
      logger.info('Fetching Jupiter jupSOL yield data...');

      // Try Jupiter Stake API first
      const jupiterData = await this.fetchFromJupiterAPI();
      if (jupiterData) {
        // Enhance with CoinGecko TVL (verified reliable)
        const cgData = await coinGeckoService.getLSTData('jupiter');
        if (cgData && cgData.marketCap > 0) {
          jupiterData.tvl = cgData.marketCap;
          jupiterData.jupsolPrice = cgData.price;
          logger.info(`Enhanced jupSOL with CoinGecko: $${(cgData.marketCap / 1e6).toFixed(1)}M`);
        }
        return jupiterData;
      }

      // Fallback to CoinGecko if Jupiter API fails
      return await this.getFallbackData();
    } catch (error) {
      logger.error('Error fetching Jupiter yield data:', error);
      return await this.getFallbackData();
    }
  }

  /**
   * Fetch from Jupiter Stake API
   */
  private async fetchFromJupiterAPI(): Promise<JupiterYieldData | null> {
    try {
      const response = await this.client.get('/api/v1/pool');
      const data = response.data;

      return {
        protocol: 'jupiter',
        asset: 'jupSOL',
        apy: data.apy || aprToApy(0.075),
        apr: data.apr || 0.075,
        tvl: data.totalValueLocked || 0,
        jupsolPrice: data.price || 1,
        exchangeRate: data.exchangeRate || 1,
        metadata: {
          totalStaked: data.totalStaked || 0,
          tokenSupply: data.supply || 0,
          validatorCount: data.validatorCount || 0,
          commission: 0.04,
        },
      };
    } catch (error) {
      logger.warn('Jupiter API unavailable for jupSOL');
      return null;
    }
  }

  // REMOVED: fetchFromSanctum() - Sanctum API is unreliable
  // Now using CoinGecko in getFallbackData() as secondary source

  /**
   * Fallback data when APIs unavailable - tries CoinGecko first
   */
  private async getFallbackData(): Promise<JupiterYieldData> {
    // Try CoinGecko for real market cap data
    try {
      const cgData = await coinGeckoService.getLSTData('jupiter');
      if (cgData && cgData.marketCap > 0) {
        logger.info(`Using CoinGecko for jupSOL fallback: $${(cgData.marketCap / 1e6).toFixed(1)}M`);
        return {
          protocol: 'jupiter',
          asset: 'jupSOL',
          apy: aprToApy(0.075),
          apr: 0.075,
          tvl: cgData.marketCap,
          jupsolPrice: cgData.price,
          exchangeRate: cgData.price / 135,
          metadata: {
            totalStaked: 0,
            tokenSupply: 0,
            validatorCount: 0,
            commission: 0.04,
          },
        };
      }
    } catch (error) {
      logger.warn('CoinGecko also unavailable for jupSOL');
    }

    return {
      protocol: 'jupiter',
      asset: 'jupSOL',
      apy: aprToApy(0.075),
      apr: 0.075,
      tvl: 0,
      jupsolPrice: 1,
      exchangeRate: 1,
      metadata: {
        totalStaked: 0,
        tokenSupply: 0,
        validatorCount: 0,
        commission: 0.04,
      },
    };
  }

  /**
   * Calculate risk score for jupSOL
   */
  calculateRiskScore(data: JupiterYieldData): number {
    let score = 50;

    // TVL score
    if (data.tvl > 1e8) score += 20; // > $100M
    else if (data.tvl > 5e7) score += 15; // > $50M
    else if (data.tvl > 1e7) score += 10; // > $10M

    // Jupiter reputation (major DEX aggregator)
    score += 20;

    // Validator diversity
    if (data.metadata.validatorCount > 50) score += 10;
    else if (data.metadata.validatorCount > 20) score += 5;

    return Math.min(score, 100);
  }

  /**
   * Get fee structure
   */
  getFeeStructure() {
    return {
      depositFee: 0,
      withdrawalFee: 0.001,
      managementFee: 0.04, // 4% commission
    };
  }

  /**
   * Estimate slippage for jupSOL swap
   */
  async estimateSlippage(amount: number): Promise<number> {
    // Jupiter has good routing so slippage should be low
    if (amount < 100) return 0.001; // 0.1%
    if (amount < 1000) return 0.005; // 0.5%
    if (amount < 10000) return 0.015; // 1.5%
    return 0.03; // 3% for large amounts
  }
}

export default new JupiterService();
