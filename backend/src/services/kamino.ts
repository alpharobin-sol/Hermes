import axios, { AxiosInstance } from 'axios';
import axiosRetry from 'axios-retry';
import { logger } from '../utils/logger';
import { withCache } from '../utils/cache';

export interface KaminoYieldData {
  protocol: string;
  reserve: string; // Reserve address
  asset: string;
  supplyAPY: number; // Deposit/lending APY
  borrowAPY: number; // Borrowing APY
  totalAPY: number; // Same as supplyAPY for consistency
  tvl: number;
  totalSupply: number;
  totalBorrow: number;
  utilizationRate: number;
  metadata: {
    loanToValueRatio: number;
    availableLiquidity: number; // In token units
    // Not exposed by Kamino's metrics API. Left unset rather than guessed.
    liquidationThreshold?: number;
    liquidationBonus?: number;
    depositLimit?: number;
    borrowLimit?: number;
  };
}

// Kamino Lend main market
const MAIN_MARKET = '7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF';

// Reserves Hermes shows, by mint. Kamino's LST reserves pay ~0% supply APY (they are collateral), so they are left out.
const TRACKED_MINTS: Record<string, string> = {
  So11111111111111111111111111111111111111112: 'SOL',
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: 'USDC',
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: 'USDT',
};

export class KaminoService {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: 'https://api.kamino.finance',
      timeout: 15000,
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
   * Fetch live lending rates for the main market's SOL, USDC and USDT reserves.
   * Returns an empty list when Kamino's API is unavailable: no placeholder rates.
   */
  async fetchYieldData(asset?: string): Promise<KaminoYieldData[]> {
    let reserves: KaminoYieldData[];
    try {
      // A failed fetch throws past withCache, so the next request retries instead of caching nothing
      reserves = await withCache('kamino-reserves', async () => {
        logger.info('Fetching Kamino Lend reserve metrics...');
        const response = await this.client.get(`/kamino-market/${MAIN_MARKET}/reserves/metrics`, {
          params: { env: 'mainnet-beta' },
        });

        const rows: any[] = Array.isArray(response.data) ? response.data : [];

        // A market can hold several reserves for one token (e.g. four USDC reserves, three of them empty).
        // Keep the largest per token so an empty reserve's headline APY never shows up.
        const largest = new Map<string, any>();
        for (const row of rows) {
          const asset = TRACKED_MINTS[row.liquidityTokenMint];
          if (!asset) continue;
          const current = largest.get(asset);
          if (!current || Number(row.totalSupplyUsd) > Number(current.totalSupplyUsd)) largest.set(asset, row);
        }
        const results = [...largest.entries()].map(([asset, row]) => this.toYieldData(row, asset));

        logger.info(`Fetched ${results.length} Kamino reserves`);
        return results;
      });
    } catch (error) {
      logger.error('Error fetching Kamino reserve metrics:', error);
      return [];
    }

    return asset ? reserves.filter((r) => r.asset === asset.toUpperCase()) : reserves;
  }

  private toYieldData(row: any, asset: string): KaminoYieldData {
    const supplyAPY = Number(row.supplyApy) || 0;
    const totalSupply = Number(row.totalSupply) || 0;
    const totalBorrow = Number(row.totalBorrow) || 0;
    const supplyUsd = Number(row.totalSupplyUsd) || 0;
    const borrowUsd = Number(row.totalBorrowUsd) || 0;

    return {
      protocol: 'kamino',
      reserve: row.reserve,
      asset,
      supplyAPY,
      borrowAPY: Number(row.borrowApy) || 0,
      totalAPY: supplyAPY,
      tvl: supplyUsd,
      totalSupply,
      totalBorrow,
      utilizationRate: supplyUsd > 0 ? borrowUsd / supplyUsd : 0,
      metadata: {
        loanToValueRatio: Number(row.maxLtv) || 0,
        availableLiquidity: Math.max(totalSupply - totalBorrow, 0),
      },
    };
  }

  /**
   * Calculate risk score for a Kamino reserve (higher is safer)
   */
  calculateRiskScore(data: KaminoYieldData): number {
    // TVL score (higher TVL = lower risk)
    const tvlScore = Math.min(Math.log10(Math.max(data.tvl, 1)) * 5, 35);

    // Utilization score (optimal around 70-80%)
    const optimalUtilization = 0.75;
    const utilizationDiff = Math.abs(data.utilizationRate - optimalUtilization);
    const utilizationScore = Math.max(0, 25 - utilizationDiff * 50);

    // Liquidity score (more available liquidity = easier withdrawals)
    const liquidityRatio = data.totalSupply > 0 ? data.metadata.availableLiquidity / data.totalSupply : 0;
    const liquidityScore = Math.min(liquidityRatio * 30, 20);

    // LTV ratio score (conservative LTV = safer)
    const ltvScore = (1 - data.metadata.loanToValueRatio) * 20;

    return Math.min(tvlScore + utilizationScore + liquidityScore + ltvScore, 100);
  }

  /**
   * Estimate slippage for deposits/withdrawals in lending
   */
  async estimateSlippage(reserveAddress: string, amount: number, isDeposit: boolean = true): Promise<number> {
    try {
      const reserves = await this.fetchYieldData();
      const reserve = reserves.find(r => r.reserve === reserveAddress);

      if (!reserve) return 0.001; // Default 0.1%

      if (isDeposit) {
        // Deposits have minimal slippage in lending
        return 0.0001; // 0.01%
      } else {
        // Withdrawals depend on available liquidity
        const sizeRatio = amount / reserve.metadata.availableLiquidity;

        if (sizeRatio < 0.1) return 0.001; // 0.1% for small withdrawals
        if (sizeRatio < 0.5) return 0.005; // 0.5% for medium withdrawals
        if (sizeRatio < 0.9) return 0.02; // 2% for large withdrawals

        return 0.05; // 5% if exceeding available liquidity
      }
    } catch (error) {
      logger.warn('Error estimating Kamino slippage:', error);
      return 0.001; // Default 0.1%
    }
  }

  /**
   * Get fee structure
   */
  getFees(): {
    depositFee: number;
    withdrawalFee: number;
    performanceFee: number;
    managementFee: number;
  } {
    return {
      depositFee: 0,
      withdrawalFee: 0.001, // 0.1% withdrawal fee
      performanceFee: 0.1, // 10% of profits
      managementFee: 0.01, // 1% annual management fee
    };
  }

  /**
   * Get top reserves by supply APY weighted by how conservative their LTV is
   */
  async getTopReserves(limit: number = 10): Promise<KaminoYieldData[]> {
    const allReserves = await this.fetchYieldData();

    return allReserves
      .map((reserve) => ({
        ...reserve,
        riskAdjustedReturn: reserve.supplyAPY * (1 - reserve.metadata.loanToValueRatio / 2),
      }))
      .sort((a, b) => b.riskAdjustedReturn - a.riskAdjustedReturn)
      .slice(0, limit);
  }
}

export default new KaminoService();
