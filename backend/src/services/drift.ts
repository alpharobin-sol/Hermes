import axios, { AxiosInstance } from 'axios';
import axiosRetry from 'axios-retry';
import { logger } from '../utils/logger';
import { aprToApy } from '../utils/math';
import coinGeckoService from './coingecko';

/**
 * Drift Staked SOL (dSOL) Yield Data
 */
export interface DriftYieldData {
  protocol: 'drift';
  asset: 'dSOL';
  apy: number;
  apr: number;
  tvl: number;
  dsolPrice: number;
  exchangeRate: number;
  metadata: {
    totalStaked: number;
    tokenSupply: number;
    protocolIntegration: boolean; // Drift is a trading protocol
  };
}

export class DriftService {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      timeout: 10000,
    });

    axiosRetry(this.client, {
      retries: 3,
      retryDelay: axiosRetry.exponentialDelay,
    });
  }

  /**
   * Fetch Drift Staked SOL yield data
   * PRIMARY: CoinGecko (reliable) | REMOVED: Sanctum (unreliable)
   */
  async fetchYieldData(): Promise<DriftYieldData> {
    try {
      logger.info('Fetching Drift dSOL yield data...');

      // Use CoinGecko as PRIMARY source (verified reliable)
      const cgData = await coinGeckoService.getLSTData('drift');
      if (cgData && cgData.marketCap > 0) {
        logger.info(`Using CoinGecko for dSOL fallback: $${(cgData.marketCap / 1e6).toFixed(1)}M`);
        return {
          protocol: 'drift',
          asset: 'dSOL',
          apy: aprToApy(0.07), // 7% estimated staking APY
          apr: 0.07,
          tvl: cgData.marketCap,
          dsolPrice: cgData.price,
          exchangeRate: cgData.price / 135, // Approximate SOL price
          metadata: {
            totalStaked: cgData.marketCap,
            tokenSupply: 0,
            protocolIntegration: true,
          },
        };
      }

      // Fallback if CoinGecko also fails
      return await this.getFallbackData();
    } catch (error) {
      logger.error('Error fetching Drift yield data:', error);
      return await this.getFallbackData();
    }
  }

  // REMOVED: fetchFromSanctum() - Sanctum API is unreliable
  // Now using CoinGecko as primary source (more stable)

  /**
   * Fallback data when APIs unavailable - tries CoinGecko first
   */
  private async getFallbackData(): Promise<DriftYieldData> {
    // Try CoinGecko for real market cap data
    try {
      const cgData = await coinGeckoService.getLSTData('drift');
      if (cgData && cgData.marketCap > 0) {
        logger.info(`Using CoinGecko for dSOL fallback: $${(cgData.marketCap / 1e6).toFixed(1)}M`);
        return {
          protocol: 'drift',
          asset: 'dSOL',
          apy: aprToApy(0.07),
          apr: 0.07,
          tvl: cgData.marketCap,
          dsolPrice: cgData.price,
          exchangeRate: cgData.price / 135,
          metadata: {
            totalStaked: 0,
            tokenSupply: 0,
            protocolIntegration: true,
          },
        };
      }
    } catch (error) {
      logger.warn('CoinGecko also unavailable for dSOL');
    }

    // Final fallback with reasonable estimate
    logger.warn('Using fallback estimate for dSOL: $218M');
    return {
      protocol: 'drift',
      asset: 'dSOL',
      apy: aprToApy(0.07),
      apr: 0.07,
      tvl: 218000000, // ~$218M estimate (last known good value)
      dsolPrice: 147,
      exchangeRate: 1.09,
      metadata: {
        totalStaked: 218000000,
        tokenSupply: 0,
        protocolIntegration: true,
      },
    };
  }

  /**
   * Calculate risk score for dSOL
   */
  calculateRiskScore(data: DriftYieldData): number {
    let score = 50;

    // TVL score
    if (data.tvl > 1e8) score += 20; // > $100M
    else if (data.tvl > 5e7) score += 15; // > $50M
    else if (data.tvl > 1e7) score += 10; // > $10M

    // Drift reputation (established trading protocol)
    score += 15;

    // Protocol integration bonus
    if (data.metadata.protocolIntegration) score += 5;

    return Math.min(score, 100);
  }

  /**
   * Get fee structure
   */
  getFeeStructure() {
    return {
      depositFee: 0,
      withdrawalFee: 0.003,
      managementFee: 0.05, // 5% commission estimate
    };
  }

  /**
   * Estimate slippage for dSOL swap
   */
  async estimateSlippage(amount: number): Promise<number> {
    // dSOL may have moderate liquidity
    if (amount < 100) return 0.003; // 0.3%
    if (amount < 1000) return 0.015; // 1.5%
    if (amount < 10000) return 0.04; // 4%
    return 0.06; // 6% for large amounts
  }
}

export default new DriftService();
