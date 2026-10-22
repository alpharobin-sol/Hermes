import axios, { AxiosInstance } from 'axios';
import axiosRetry from 'axios-retry';
import { logger } from '../utils/logger';
import { aprToApy } from '../utils/math';
import marginfiService from './marginfi';
import kaminoService from './kamino';
import { withCache } from '../utils/cache';

/**
 * Stablecoin Yield Data Structure
 */
export interface StablecoinYieldData {
  protocol: string;
  protocolType: 'lending' | 'amm' | 'perp';
  asset: string; // 'USDC', 'USDT', 'USDC-USDT', etc.
  category: string; // 'stablecoin-lending', 'stable-lp', 'stable-perp'
  apy: number;
  apr: number;
  baseAPY: number; // Base yield without incentives
  rewardAPY: number; // Incentive/emission APY
  tvl: number;
  volume24h?: number;
  utilizationRate?: number; // For lending
  fundingRate?: number; // For perps
  
  // Risk metrics
  riskScore: number;
  liquidityDepth: number;
  
  metadata: {
    protocol: string;
    pool?: string;
    market?: string;
    collateralFactor?: number;
    fees?: {
      deposit?: number;
      withdrawal?: number;
      swap?: number;
    };
    emissions?: {
      token: string;
      dailyRate: number;
      apr: number;
    }[];
  };
}

/**
 * Comprehensive Stablecoin Yield Aggregator
 * Covers: Lending (Kamino, MarginFi), AMMs (Orca, Raydium, Meteora), Perps (Drift, Zeta, GooseFX)
 */
export class StablecoinService {
  private client: AxiosInstance;

  constructor() {

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

    logger.info('Initialized Stablecoin Service');
  }

  /**
   * Fetch all stablecoin yields across protocols
   * Cached for 5 minutes to improve performance
   */
  async fetchAllStablecoinYields(): Promise<StablecoinYieldData[]> {
    return withCache(
      'stablecoin-yields-all',
      async () => {
        logger.info('Fetching all stablecoin yields...');
        
        const results = await Promise.allSettled([
          // Lending protocols
          this.fetchKaminoLending(),
          this.fetchMarginFiLending(),
          
          // AMM protocols
          this.fetchOrcaStablePools(),
          this.fetchRaydiumStablePools(),
          this.fetchMeteoraStablePools(),
          
          // Perp protocols
          this.fetchDriftFundingRates(),
          this.fetchZetaFundingRates(),
          this.fetchGooseFXFundingRates(),
        ]);

        const allYields: StablecoinYieldData[] = [];
        
        for (const result of results) {
          if (result.status === 'fulfilled' && result.value) {
            allYields.push(...result.value);
          } else if (result.status === 'rejected') {
            logger.warn('Failed to fetch some stablecoin yields:', result.reason);
          }
        }

        // Deduplicate by protocol + asset combination
        const seen = new Set<string>();
        const uniqueYields = allYields.filter(y => {
          const key = `${y.protocol}-${y.asset}`;
          if (seen.has(key)) {
            return false; // Skip duplicate
          }
          seen.add(key);
          return true;
        });

        logger.info(`Fetched ${allYields.length} yields, ${uniqueYields.length} unique stablecoin opportunities`);
        return uniqueYields.sort((a, b) => b.apy - a.apy);
      },
      5 * 60 * 1000 // 5 minutes cache
    );
  }

  /**
   * LENDING: Kamino Finance
   * Fetch USDC/USDT lending yields from Kamino vaults
   */
  private async fetchKaminoLending(): Promise<StablecoinYieldData[]> {
    // Same live reserve data the Kamino service serves. Empty when Kamino's API is down: no estimates.
    const reserves = await kaminoService.fetchYieldData();

    return reserves
      .filter((reserve) => reserve.asset === 'USDC' || reserve.asset === 'USDT')
      .map((reserve): StablecoinYieldData => ({
        protocol: 'kamino',
        protocolType: 'lending',
        asset: reserve.asset,
        category: 'stablecoin-lending',
        apy: reserve.supplyAPY,
        apr: reserve.supplyAPY, // Kamino reports APY; close enough at these rates
        baseAPY: reserve.supplyAPY,
        rewardAPY: 0,
        tvl: reserve.tvl,
        utilizationRate: reserve.utilizationRate,
        riskScore: this.calculateRiskScore('kamino', reserve.tvl, 'lending'),
        liquidityDepth: reserve.tvl * (1 - reserve.utilizationRate),
        metadata: {
          protocol: 'Kamino Finance',
          pool: reserve.reserve,
          fees: {
            deposit: 0,
            withdrawal: 0,
          },
        },
      }));
  }

  /**
   * LENDING: MarginFi
   * Fetch USDC/USDT lending yields
   */
  private async fetchMarginFiLending(): Promise<StablecoinYieldData[]> {
    try {
      logger.info('Fetching MarginFi stablecoin lending yields...');
      
      const yields: StablecoinYieldData[] = [];
      
      // Fetch USDC
      try {
        const usdcData = await marginfiService.fetchYieldData('USDC');
        yields.push({
          protocol: 'marginfi',
          protocolType: 'lending',
          asset: 'USDC',
          category: 'stablecoin-lending',
          apy: aprToApy(usdcData.supplyAPY),
          apr: usdcData.supplyAPY,
          baseAPY: usdcData.supplyAPY,
          rewardAPY: 0,
          tvl: usdcData.tvl,
          utilizationRate: usdcData.utilizationRate,
          riskScore: this.calculateRiskScore('marginfi', usdcData.tvl, 'lending'),
          liquidityDepth: usdcData.metadata.availableLiquidity,
          metadata: {
            protocol: 'MarginFi',
            collateralFactor: usdcData.metadata.collateralFactor,
            fees: {
              deposit: 0,
              withdrawal: 0,
            },
          },
        });
      } catch (error) {
        logger.warn('Could not fetch MarginFi USDC data');
      }

      // Fetch USDT (if available)
      try {
        const usdtData = await marginfiService.fetchYieldData('USDT');
        yields.push({
          protocol: 'marginfi',
          protocolType: 'lending',
          asset: 'USDT',
          category: 'stablecoin-lending',
          apy: aprToApy(usdtData.supplyAPY),
          apr: usdtData.supplyAPY,
          baseAPY: usdtData.supplyAPY,
          rewardAPY: 0,
          tvl: usdtData.tvl,
          utilizationRate: usdtData.utilizationRate,
          riskScore: this.calculateRiskScore('marginfi', usdtData.tvl, 'lending'),
          liquidityDepth: usdtData.metadata.availableLiquidity,
          metadata: {
            protocol: 'MarginFi',
            collateralFactor: usdtData.metadata.collateralFactor,
            fees: {
              deposit: 0,
              withdrawal: 0,
            },
          },
        });
      } catch (error) {
        logger.warn('Could not fetch MarginFi USDT data');
      }

      logger.info(`Found ${yields.length} MarginFi stablecoin markets`);
      return yields;
    } catch (error) {
      logger.error('Error fetching MarginFi stablecoin yields:', error);
      return [];
    }
  }

  /**
   * AMM: Orca Whirlpools
   * Fetch stable LP pool yields (USDC-USDT, etc.)
   */
  private async fetchOrcaStablePools(): Promise<StablecoinYieldData[]> {
    try {
      logger.info('Fetching Orca stable pool yields...');
      
      const response = await this.client.get('https://api.orca.so/v1/whirlpool/list');
      const pools = response.data;

      const stablePools = pools.filter((pool: any) => {
        const symbolA = pool.tokenA?.symbol?.toLowerCase() || '';
        const symbolB = pool.tokenB?.symbol?.toLowerCase() || '';
        const isStableA = symbolA.includes('usdc') || symbolA.includes('usdt') || symbolA.includes('usd');
        const isStableB = symbolB.includes('usdc') || symbolB.includes('usdt') || symbolB.includes('usd');
        return isStableA && isStableB;
      });

      const yields: StablecoinYieldData[] = [];

      // Sort by TVL and limit to top 20 pools to improve performance
      const topPools = stablePools
        .sort((a: any, b: any) => (parseFloat(b.tvl || 0) - parseFloat(a.tvl || 0)))
        .slice(0, 20);

      for (const pool of topPools) {
        let feeAPR = parseFloat(pool.apr?.fees || 0);
        let rewardAPR = parseFloat(pool.apr?.rewards || 0);
        // Check if values are percentages (> 1) and convert to decimal
        if (feeAPR > 1) feeAPR = feeAPR / 100;
        if (rewardAPR > 1) rewardAPR = rewardAPR / 100;
        const totalAPY = aprToApy(feeAPR + rewardAPR);

        yields.push({
          protocol: 'orca',
          protocolType: 'amm',
          asset: `${pool.tokenA.symbol}-${pool.tokenB.symbol}`,
          category: 'stable-lp',
          apy: totalAPY,
          apr: feeAPR + rewardAPR,
          baseAPY: aprToApy(feeAPR),
          rewardAPY: aprToApy(rewardAPR),
          tvl: parseFloat(pool.tvl || 0),
          volume24h: parseFloat(pool.volume24h || 0),
          riskScore: this.calculateRiskScore('orca', parseFloat(pool.tvl || 0), 'amm'),
          liquidityDepth: parseFloat(pool.tvl || 0),
          metadata: {
            protocol: 'Orca Whirlpools',
            pool: pool.address,
            fees: {
              swap: pool.feeRate || 0.0001, // 0.01% default
            },
          },
        });
      }

      logger.info(`Found ${yields.length} Orca stable pools`);
      return yields;
    } catch (error) {
      logger.error('Error fetching Orca stable pools:', error);
      // Fallback: USDC-USDT pool estimate (Orca is a major Solana DEX)
      return [{
        protocol: 'orca',
        protocolType: 'amm',
        asset: 'USDC-USDT',
        category: 'stable-lp',
        apy: 0.05, // 5% estimate
        apr: 0.049,
        baseAPY: 0.05,
        rewardAPY: 0,
        tvl: 150000000, // ~$150M estimate for major Orca stable pool
        riskScore: 80,
        liquidityDepth: 150000000,
        metadata: {
          protocol: 'Orca Whirlpools',
          fees: { swap: 0.0001 },
        },
      }];
    }
  }

  /**
   * AMM: Raydium CLMM
   * Fetch Raydium concentrated liquidity stable pools
   */
  private async fetchRaydiumStablePools(): Promise<StablecoinYieldData[]> {
    try {
      logger.info('Fetching Raydium CLMM stable pool yields...');
      
      // Ask for USDC/USDT CLMM pools only. The old v2 endpoint returned every Raydium pool
      // (~225 MB of JSON), which needed close to 1 GB of memory to parse.
      const response = await this.client.get('https://api-v3.raydium.io/pools/info/mint', {
        params: {
          mint1: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
          mint2: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
          poolType: 'concentrated',
          poolSortField: 'liquidity',
          sortType: 'desc',
          pageSize: 20,
          page: 1,
        },
      });
      const topPools = response.data?.data?.data || [];

      const yields: StablecoinYieldData[] = [];

      for (const pool of topPools) {
        // v3 reports APRs in percent, and rewardApr as one entry per reward token
        const feeAPR = parseFloat(pool.day?.feeApr || pool.week?.feeApr || 0) / 100;
        const rewardAPR = (Array.isArray(pool.day?.rewardApr) ? pool.day.rewardApr : [])
          .reduce((sum: number, apr: number) => sum + (Number(apr) || 0), 0) / 100;
        const totalAPY = aprToApy(feeAPR + rewardAPR);

        yields.push({
          protocol: 'raydium',
          protocolType: 'amm',
          asset: `${pool.mintA.symbol}-${pool.mintB.symbol}`,
          category: 'stable-lp',
          apy: totalAPY,
          apr: feeAPR + rewardAPR,
          baseAPY: aprToApy(feeAPR),
          rewardAPY: aprToApy(rewardAPR),
          tvl: parseFloat(pool.tvl || 0),
          volume24h: parseFloat(pool.day?.volume || 0),
          riskScore: this.calculateRiskScore('raydium', parseFloat(pool.tvl || 0), 'amm'),
          liquidityDepth: parseFloat(pool.tvl || 0),
          metadata: {
            protocol: 'Raydium CLMM',
            pool: pool.id,
            fees: {
              swap: pool.feeRate || 0.0001,
            },
          },
        });
      }

      logger.info(`Found ${yields.length} Raydium stable pools`);
      return yields;
    } catch (error) {
      logger.error('Error fetching Raydium stable pools:', error);
      return [];
    }
  }

  /**
   * AMM: Meteora
   * Fetch Meteora stable pools (DLMM - Dynamic Liquidity Market Maker)
   */
  private async fetchMeteoraStablePools(): Promise<StablecoinYieldData[]> {
    try {
      logger.info('Fetching Meteora stable pool yields...');
      
      const response = await this.client.get('https://dlmm-api.meteora.ag/pair/all');
      const pools = response.data;

      const stablePools = pools.filter((pool: any) => {
        const name = pool.name?.toLowerCase() || '';
        return (name.includes('usdc') || name.includes('usdt')) && 
               (name.includes('usdc-usdt') || name.includes('usdt-usdc'));
      });

      const yields: StablecoinYieldData[] = [];

      // Sort by liquidity and limit to top 20 pools
      const topPools = stablePools
        .sort((a: any, b: any) => (parseFloat(b.liquidity || 0) - parseFloat(a.liquidity || 0)))
        .slice(0, 20);

      for (const pool of topPools) {
        const feeAPR = parseFloat(pool.fee_apr || pool.fees_24h || 0);
        // Meteora returns APR as percentage (8 = 8%), convert to decimal
        const feeAPRDecimal = feeAPR / 100;
        const totalAPY = aprToApy(feeAPRDecimal);

        yields.push({
          protocol: 'meteora',
          protocolType: 'amm',
          asset: pool.name || 'USDC-USDT',
          category: 'stable-lp',
          apy: totalAPY,
          apr: feeAPRDecimal,
          baseAPY: totalAPY,
          rewardAPY: 0,
          tvl: parseFloat(pool.liquidity || 0) || (parseFloat(pool.reserve_x_amount || 0) + parseFloat(pool.reserve_y_amount || 0)),
          volume24h: parseFloat(pool.trade_volume_24h || 0),
          riskScore: this.calculateRiskScore('meteora', parseFloat(pool.liquidity || 0), 'amm'),
          liquidityDepth: parseFloat(pool.liquidity || 0),
          metadata: {
            protocol: 'Meteora DLMM',
            pool: pool.address,
            fees: {
              swap: pool.base_fee_percentage || 0.0001,
            },
          },
        });
      }

      logger.info(`Found ${yields.length} Meteora stable pools`);
      return yields;
    } catch (error) {
      logger.error('Error fetching Meteora stable pools:', error);
      return [];
    }
  }

  /**
   * PERPS: Drift Protocol
   * Fetch stable funding rates for USDC perps
   */
  private async fetchDriftFundingRates(): Promise<StablecoinYieldData[]> {
    try {
      logger.info('Fetching Drift funding rates...');
      
      // Updated Drift API endpoint
      const response = await this.client.get('https://mainnet-beta.api.drift.trade/perpMarkets');
      const markets = response.data.perpMarkets || response.data || [];

      const yields: StablecoinYieldData[] = [];

      // Focus on major markets for stable funding arbitrage
      const stableMarkets = ['SOL-PERP', 'BTC-PERP', 'ETH-PERP'];

      for (const market of markets) {
        if (!stableMarkets.includes(market.symbol)) continue;

        const fundingRate = market.fundingRate || 0; // Hourly rate
        const annualizedRate = fundingRate * 24 * 365;

        // Only include if funding rate is meaningful
        if (Math.abs(annualizedRate) > 0.01) {
          yields.push({
            protocol: 'drift',
            protocolType: 'perp',
            asset: market.symbol,
            category: 'stable-perp',
            apy: Math.abs(annualizedRate),
            apr: Math.abs(annualizedRate),
            baseAPY: Math.abs(annualizedRate),
            rewardAPY: 0,
            tvl: market.openInterest || 0,
            volume24h: market.volume24h || 0,
            fundingRate: fundingRate,
            riskScore: this.calculateRiskScore('drift', market.openInterest, 'perp'),
            liquidityDepth: market.openInterest || 0,
            metadata: {
              protocol: 'Drift Protocol',
              market: market.marketIndex,
            },
          });
        }
      }

      logger.info(`Found ${yields.length} Drift funding opportunities`);
      return yields;
    } catch (error) {
      logger.error('Error fetching Drift funding rates:', error);
      return [];
    }
  }

  /**
   * PERPS: Zeta Markets
   * Fetch funding rates from Zeta
   */
  private async fetchZetaFundingRates(): Promise<StablecoinYieldData[]> {
    try {
      logger.info('Fetching Zeta funding rates...');
      
      // Zeta Markets API (Updated endpoint)
      // Note: Zeta API may be behind authentication, skip if fails
      const response = await this.client.get('https://api.zeta.markets/v2/markets', { timeout: 5000 });
      const markets = response.data.markets || response.data || [];

      const yields: StablecoinYieldData[] = [];

      for (const market of markets) {
        if (market.kind !== 'perp') continue;

        const fundingRate = market.fundingRate || 0;
        const annualizedRate = fundingRate * 24 * 365;

        if (Math.abs(annualizedRate) > 0.01) {
          yields.push({
            protocol: 'zeta',
            protocolType: 'perp',
            asset: market.symbol,
            category: 'stable-perp',
            apy: Math.abs(annualizedRate),
            apr: Math.abs(annualizedRate),
            baseAPY: Math.abs(annualizedRate),
            rewardAPY: 0,
            tvl: market.openInterest || 0,
            volume24h: market.volume24h || 0,
            fundingRate: fundingRate,
            riskScore: this.calculateRiskScore('zeta', market.openInterest, 'perp'),
            liquidityDepth: market.openInterest || 0,
            metadata: {
              protocol: 'Zeta Markets',
              market: market.address,
            },
          });
        }
      }

      logger.info(`Found ${yields.length} Zeta funding opportunities`);
      return yields;
    } catch (error) {
      logger.error('Error fetching Zeta funding rates:', error);
      return [];
    }
  }

  /**
   * PERPS: GooseFX
   * Fetch funding rates from GooseFX
   */
  private async fetchGooseFXFundingRates(): Promise<StablecoinYieldData[]> {
    try {
      logger.info('Fetching GooseFX funding rates...');
      
      // GooseFX API (Updated endpoint)
      // Note: GooseFX may have migrated - graceful fallback
      const response = await this.client.get('https://api.goosefx.io/ssl-perps/markets', { timeout: 5000 });
      const markets = response.data.markets || response.data || [];

      const yields: StablecoinYieldData[] = [];

      for (const market of markets) {
        const fundingRate = market.fundingRate || 0;
        const annualizedRate = fundingRate * 24 * 365;

        if (Math.abs(annualizedRate) > 0.01) {
          yields.push({
            protocol: 'goosefx',
            protocolType: 'perp',
            asset: market.symbol || market.name,
            category: 'stable-perp',
            apy: Math.abs(annualizedRate),
            apr: Math.abs(annualizedRate),
            baseAPY: Math.abs(annualizedRate),
            rewardAPY: 0,
            tvl: market.openInterest || 0,
            volume24h: market.volume24h || 0,
            fundingRate: fundingRate,
            riskScore: this.calculateRiskScore('goosefx', market.openInterest, 'perp'),
            liquidityDepth: market.openInterest || 0,
            metadata: {
              protocol: 'GooseFX',
              market: market.marketId,
            },
          });
        }
      }

      logger.info(`Found ${yields.length} GooseFX funding opportunities`);
      return yields;
    } catch (error) {
      logger.error('Error fetching GooseFX funding rates:', error);
      return [];
    }
  }

  /**
   * Calculate risk score for stablecoin yields
   */
  private calculateRiskScore(protocol: string, tvl: number, type: 'lending' | 'amm' | 'perp'): number {
    let score = 50;

    // Protocol reputation
    const reputationScores: Record<string, number> = {
      kamino: 20,
      marginfi: 20,
      orca: 20,
      raydium: 18,
      meteora: 15,
      drift: 18,
      zeta: 15,
      goosefx: 12,
    };
    score += reputationScores[protocol] || 10;

    // TVL/Liquidity score
    if (tvl > 1e8) score += 20; // > $100M
    else if (tvl > 5e7) score += 15; // > $50M
    else if (tvl > 1e7) score += 10; // > $10M
    else if (tvl > 1e6) score += 5; // > $1M

    // Type-specific adjustments
    if (type === 'lending') score += 10; // Lending generally safer
    else if (type === 'amm') score += 5; // Stable LPs are low IL
    else if (type === 'perp') score -= 10; // Perps carry more risk

    return Math.min(Math.max(score, 0), 100);
  }

  /**
   * Get top stablecoin yields by APY
   */
  async getTopYields(limit: number = 10): Promise<StablecoinYieldData[]> {
    const allYields = await this.fetchAllStablecoinYields();
    return allYields.slice(0, limit);
  }

  /**
   * Get stablecoin yields by category
   */
  async getYieldsByCategory(category: 'stablecoin-lending' | 'stable-lp' | 'stable-perp'): Promise<StablecoinYieldData[]> {
    const allYields = await this.fetchAllStablecoinYields();
    return allYields.filter(y => y.category === category);
  }

  /**
   * Get stablecoin yields by protocol
   */
  async getYieldsByProtocol(protocol: string): Promise<StablecoinYieldData[]> {
    const allYields = await this.fetchAllStablecoinYields();
    return allYields.filter(y => y.protocol === protocol);
  }

  /**
   * Compare stablecoin yields across protocols
   */
  async compareProtocols(protocols: string[]): Promise<{
    comparison: StablecoinYieldData[];
    bestAPY: string;
    bestRisk: string;
    bestTVL: string;
  }> {
    const allYields = await this.fetchAllStablecoinYields();
    const filtered = allYields.filter(y => protocols.includes(y.protocol));

    const bestAPY = filtered.reduce((best, current) => 
      current.apy > best.apy ? current : best
    );

    const bestRisk = filtered.reduce((best, current) => 
      current.riskScore > best.riskScore ? current : best
    );

    const bestTVL = filtered.reduce((best, current) => 
      current.tvl > best.tvl ? current : best
    );

    return {
      comparison: filtered,
      bestAPY: `${bestAPY.protocol} - ${bestAPY.asset} (${(bestAPY.apy * 100).toFixed(2)}%)`,
      bestRisk: `${bestRisk.protocol} - ${bestRisk.asset} (Risk: ${bestRisk.riskScore})`,
      bestTVL: `${bestTVL.protocol} - ${bestTVL.asset} ($${(bestTVL.tvl / 1e6).toFixed(1)}M)`,
    };
  }
}

export default new StablecoinService();
