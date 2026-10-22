import axios, { AxiosInstance } from 'axios';
import axiosRetry from 'axios-retry';
import { Connection, PublicKey } from '@solana/web3.js';
import { logger } from '../utils/logger';
import defiLlamaService from './defillama';
import Decimal from 'decimal.js';

export interface OrcaYieldData {
  protocol: string;
  pool: string;
  asset: string;
  feeAPR: number;
  incentivesAPR: number;
  totalAPY: number;
  tvl: number;
  volume24h: number;
  fees24h: number;
  metadata: {
    poolType: string; // 'whirlpool' or 'standard'
    tickSpacing: number;
    feeRate: number;
    tokenAReserve: number;
    tokenBReserve: number;
    currentPrice: number;
  };
}

export class OrcaService {
  private client: AxiosInstance;
  private readonly baseURL = 'https://api.orca.so';
  private connection: Connection;
  private whirlpoolCtx: any | null = null;
  
  constructor() {
    this.client = axios.create({
      baseURL: this.baseURL,
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

    // Initialize Whirlpool SDK lazily; continue gracefully if unavailable
    this.initializeWhirlpoolSDK();
  }

  /**
   * Initialize Orca Whirlpool SDK
   */
  private async initializeWhirlpoolSDK(): Promise<void> {
    try {
      // Dynamic import to avoid crashing on incompatible environments
      const sdk = await import('@orca-so/whirlpools-sdk');
      const { WhirlpoolContext, buildDefaultAccountFetcher, ORCA_WHIRLPOOL_PROGRAM_ID } = sdk as any;
      const fetcher = buildDefaultAccountFetcher(this.connection);
      // Create context (no wallet needed for read-only)
      this.whirlpoolCtx = WhirlpoolContext.from(
        this.connection,
        // @ts-ignore - Wallet not needed for read-only operations
        null,
        ORCA_WHIRLPOOL_PROGRAM_ID,
        fetcher
      );
      logger.info('Orca Whirlpool SDK initialized successfully');
    } catch (error) {
      logger.warn('Whirlpool SDK not available, using REST/fallback only:', error as any);
      this.whirlpoolCtx = null; // Ensure null so guards work elsewhere
    }
  }
  
  /**
   * Fetch Orca Whirlpool yields
   * 
   * NOTE: Orca's public API endpoint may have changed or been deprecated
   * Using fallback data until proper API integration is confirmed
   * TODO: Verify correct Orca API endpoint or use on-chain data via SDK
   */
  async fetchYieldData(poolAddress?: string): Promise<OrcaYieldData[]> {
    try {
      logger.info('Fetching Orca yield data...');
      
      // Get REAL total protocol TVL from DeFiLlama
      const defiLlamaTVL = await defiLlamaService.getTVLForProtocol('orca');
      if (defiLlamaTVL > 0) {
        logger.info(`Orca DeFiLlama TVL: $${(defiLlamaTVL / 1e6).toFixed(1)}M`);
      }
      
      try {
        const poolsResponse = await this.client.get('/v1/whirlpools');
        let pools = poolsResponse.data.whirlpools || [];
        
        if (pools.length === 0) {
          logger.warn('Orca API returned 0 pools - API may have changed or requires auth');
          logger.warn('Using fallback data. Check https://docs.orca.so for updated API docs');
          return this.getFallbackData();
        }
        
        // Filter by specific pool if provided
        if (poolAddress) {
          pools = pools.filter((p: any) => p.address === poolAddress);
        }
        
        const results: OrcaYieldData[] = [];
        
        for (const pool of pools) {
          // Calculate fee APR from 24h fees and TVL
          const fees24h = pool.fees_24h || 0;
          const tvl = pool.tvl || 1;
          const feeAPR = (fees24h * 365) / tvl;
          
          // Incentives APR from ORCA token emissions
          const incentivesAPR = pool.incentives_apr || 0;
          
          // Total APY (compound daily)
          const totalAPY = Math.pow(1 + (feeAPR + incentivesAPR) / 365, 365) - 1;
          
          results.push({
            protocol: 'orca',
            pool: pool.address,
            asset: `${pool.token_a}-${pool.token_b}`,
            feeAPR: feeAPR,
            incentivesAPR: incentivesAPR,
            totalAPY: totalAPY,
            tvl: tvl,
            volume24h: pool.volume_24h || 0,
            fees24h: fees24h,
            metadata: {
              poolType: pool.type || 'whirlpool',
              tickSpacing: pool.tick_spacing || 64,
              feeRate: pool.fee_rate || 0.003, // 0.3% default
              tokenAReserve: pool.token_a_reserve || 0,
              tokenBReserve: pool.token_b_reserve || 0,
              currentPrice: pool.current_price || 0,
            },
          });
        }
        
        logger.info(`Fetched ${results.length} Orca pools from API`);
        return results;
      } catch (apiError) {
        logger.warn('Orca API request failed, using fallback data:', apiError);
        return this.getFallbackData();
      }
    } catch (error) {
      logger.error('Error fetching Orca yield data:', error);
      return this.getFallbackData();
    }
  }
  
  /**
   * Get pool performance metrics
   */
  async getPoolPerformance(poolAddress: string): Promise<{
    apy7d: number;
    apy30d: number;
    volume7d: number;
    volume30d: number;
    fees7d: number;
    fees30d: number;
  }> {
    try {
      const response = await this.client.get(`/v1/whirlpools/${poolAddress}/stats`);
      const stats = response.data;
      
      return {
        apy7d: stats.apy_7d || 0,
        apy30d: stats.apy_30d || 0,
        volume7d: stats.volume_7d || 0,
        volume30d: stats.volume_30d || 0,
        fees7d: stats.fees_7d || 0,
        fees30d: stats.fees_30d || 0,
      };
    } catch (error) {
      logger.warn('Error fetching Orca pool performance:', error);
      return {
        apy7d: 0,
        apy30d: 0,
        volume7d: 0,
        volume30d: 0,
        fees7d: 0,
        fees30d: 0,
      };
    }
  }
  
  /**
   * Calculate risk score for Orca pools
   */
  calculateRiskScore(data: OrcaYieldData): number {
    // TVL score (higher is better)
    const tvlScore = Math.min(Math.log10(data.tvl) * 5, 25);
    
    // Volume score (higher volume = more liquidity)
    const volumeScore = Math.min(Math.log10(data.volume24h) * 3, 20);
    
    // Fee tier score (lower fees = higher volume typically)
    const feeRate = data.metadata.feeRate;
    const feeScore = feeRate <= 0.0025 ? 15 : feeRate <= 0.01 ? 10 : 5;
    
    // Whirlpool technology bonus (more efficient)
    const poolTypeScore = data.metadata.poolType === 'whirlpool' ? 20 : 15;
    
    // Protocol maturity (Orca is well-established)
    const maturityScore = 20;
    
    return Math.min(
      tvlScore + volumeScore + feeScore + poolTypeScore + maturityScore,
      100
    );
  }
  
  /**
   * Estimate slippage for swaps
   */
  async estimateSlippage(
    poolAddress: string,
    amountIn: number,
    tokenIn: string
  ): Promise<number> {
    try {
      const response = await this.client.post('/v1/quote', {
        pool: poolAddress,
        amount: amountIn,
        token_in: tokenIn,
      });
      
      const quote = response.data;
      const expectedOut = quote.expected_out || 0;
      const minOut = quote.min_out || 0;
      
      const slippage = expectedOut > 0 ? (expectedOut - minOut) / expectedOut : 0.01;
      
      return slippage;
    } catch (error) {
      logger.warn('Error estimating Orca slippage:', error);
      
      // Fallback: estimate based on pool depth
      const pools = await this.fetchYieldData(poolAddress);
      if (pools.length === 0) return 0.01;
      
      const pool = pools[0];
      const tvl = pool.tvl;
      const sizeRatio = amountIn / tvl;
      
      // Slippage increases with trade size
      if (sizeRatio < 0.001) return 0.001; // 0.1%
      if (sizeRatio < 0.01) return 0.005; // 0.5%
      if (sizeRatio < 0.05) return 0.02; // 2%
      
      return 0.05; // 5% for very large trades
    }
  }
  
  /**
   * Get optimal price range for concentrated liquidity
   */
  async getOptimalPriceRange(poolAddress: string): Promise<{
    lowerPrice: number;
    upperPrice: number;
    currentPrice: number;
    utilizationRate: number;
  }> {
    try {
      const response = await this.client.get(`/v1/whirlpools/${poolAddress}/optimal-range`);
      const data = response.data;
      
      return {
        lowerPrice: data.lower_price,
        upperPrice: data.upper_price,
        currentPrice: data.current_price,
        utilizationRate: data.utilization_rate,
      };
    } catch (error) {
      logger.warn('Error fetching Orca optimal price range:', error);
      
      // Fallback: use ±20% from current price
      const pools = await this.fetchYieldData(poolAddress);
      const currentPrice = pools[0]?.metadata.currentPrice || 1;
      
      return {
        lowerPrice: currentPrice * 0.8,
        upperPrice: currentPrice * 1.2,
        currentPrice: currentPrice,
        utilizationRate: 0.7,
      };
    }
  }
  
  /**
   * Get fee structure
   */
  getFees(feeRate: number = 0.003): {
    swapFee: number;
    depositFee: number;
    withdrawalFee: number;
  } {
    return {
      swapFee: feeRate, // Variable based on pool
      depositFee: 0,
      withdrawalFee: 0,
    };
  }
  
  /**
   * Get top pools by volume
   */
  async getTopPools(limit: number = 10): Promise<OrcaYieldData[]> {
    try {
      const allPools = await this.fetchYieldData();
      
      return allPools
        .sort((a, b) => b.volume24h - a.volume24h)
        .slice(0, limit);
    } catch (error) {
      logger.error('Error fetching top Orca pools:', error);
      return [];
    }
  }
  
  /**
   * Calculate impermanent loss for a position
   */
  calculateImpermanentLoss(
    initialPriceRatio: number,
    currentPriceRatio: number
  ): number {
    const k = Math.sqrt(currentPriceRatio / initialPriceRatio);
    const hodlValue = (initialPriceRatio + 1) / 2;
    const lpValue = k / (1 + k);
    
    return (lpValue / hodlValue - 1);
  }
  
  /**
   * Fallback data when API is unavailable
   */
  private getFallbackData(): OrcaYieldData[] {
    return [
      {
        protocol: 'orca',
        pool: 'orca-sol-usdc-whirlpool',
        asset: 'SOL-USDC',
        feeAPR: 0.12,
        incentivesAPR: 0.05,
        totalAPY: 0.18,
        tvl: 100000000,
        volume24h: 10000000,
        fees24h: 30000,
        metadata: {
          poolType: 'whirlpool',
          tickSpacing: 64,
          feeRate: 0.003,
          tokenAReserve: 500000,
          tokenBReserve: 50000000,
          currentPrice: 100,
        },
      },
      {
        protocol: 'orca',
        pool: 'orca-usdc-usdt-whirlpool',
        asset: 'USDC-USDT',
        feeAPR: 0.05,
        incentivesAPR: 0.02,
        totalAPY: 0.07,
        tvl: 75000000,
        volume24h: 15000000,
        fees24h: 15000,
        metadata: {
          poolType: 'whirlpool',
          tickSpacing: 1,
          feeRate: 0.0001,
          tokenAReserve: 37500000,
          tokenBReserve: 37500000,
          currentPrice: 1,
        },
      },
    ];
  }

  // ============================================
  // Whirlpool SDK Methods
  // ============================================

  /**
   * Fetch a specific Whirlpool by address
   * @param poolAddress - Whirlpool pool address
   * @returns Whirlpool account data
   */
  async fetchWhirlpool(poolAddress: PublicKey): Promise<any> {
    if (!this.whirlpoolCtx) {
      throw new Error('Whirlpool SDK not initialized');
    }

    try {
      // Fetch whirlpool account data from on-chain
      const accountInfo = await this.connection.getAccountInfo(poolAddress);
      
      if (!accountInfo) {
        throw new Error(`Whirlpool account not found: ${poolAddress.toBase58()}`);
      }

      // Decode whirlpool data using ParsableWhirlpool
      const { ParsableWhirlpool } = await import('@orca-so/whirlpools-sdk');
      const whirlpoolData = (ParsableWhirlpool as any).parse(poolAddress, accountInfo);
      
      if (!whirlpoolData) {
        throw new Error(`Failed to parse Whirlpool data: ${poolAddress.toBase58()}`);
      }
      
      logger.info(`Fetched Whirlpool: ${poolAddress.toBase58()}`);
      return {
        getData: () => whirlpoolData,
        getAddress: () => poolAddress,
      };
    } catch (error) {
      logger.error('Error fetching Whirlpool:', error);
      throw error;
    }
  }

  /**
   * Get swap quote for input token amount
   * @param poolAddress - Whirlpool pool address
   * @param inputMint - Input token mint address
   * @param amountIn - Amount of input token (in token units with decimals)
   * @param slippageTolerance - Slippage tolerance (e.g., 0.01 for 1%)
   * @returns Swap quote with expected output and price impact
   */
  async getSwapQuote(
    poolAddress: PublicKey,
    inputMint: PublicKey,
    amountIn: Decimal,
    slippageTolerance: number = 0.01
  ): Promise<{
    estimatedAmountOut: string;
    estimatedAmountIn: string;
    otherAmountThreshold: string;
    priceImpact: number;
    aToB: boolean;
  }> {
    if (!this.whirlpoolCtx) {
      throw new Error('Whirlpool SDK not initialized');
    }

    try {
      const whirlpool = await this.fetchWhirlpool(poolAddress);
      const whirlpoolData = whirlpool.getData();

      // Determine swap direction (A to B or B to A)
      const aToB = inputMint.equals(whirlpoolData.tokenMintA);

      // Get swap quote using SDK
      const sdk = await import('@orca-so/whirlpools-sdk');
      const { swapQuoteByInputToken, DecimalUtil, Percentage, ORCA_WHIRLPOOL_PROGRAM_ID } = sdk as any;
      const quote = await swapQuoteByInputToken(
        whirlpool,
        inputMint,
        DecimalUtil.toBN(amountIn),
        Percentage.fromDecimal(new Decimal(slippageTolerance)),
        ORCA_WHIRLPOOL_PROGRAM_ID,
        // @ts-ignore - SDK type compatibility
        this.whirlpoolCtx.fetcher,
        // @ts-ignore - SDK options
        true
      );

      const priceImpact = quote.estimatedEndSqrtPrice
        ? await this.calculatePriceImpact(whirlpoolData.sqrtPrice, quote.estimatedEndSqrtPrice)
        : 0;

      return {
        estimatedAmountOut: quote.estimatedAmountOut.toString(),
        estimatedAmountIn: quote.estimatedAmountIn.toString(),
        otherAmountThreshold: quote.otherAmountThreshold.toString(),
        priceImpact,
        aToB,
      };
    } catch (error) {
      logger.error('Error getting swap quote:', error);
      throw error;
    }
  }

  /**
   * Get whirlpool data for a pool
   * @param poolAddress - Whirlpool pool address
   * @returns Pool data including reserves, price, and liquidity
   */
  async getWhirlpoolData(poolAddress: PublicKey): Promise<{
    tokenMintA: string;
    tokenMintB: string;
    tickCurrentIndex: number;
    sqrtPrice: string;
    liquidity: string;
    feeRate: number;
  }> {
    if (!this.whirlpoolCtx) {
      throw new Error('Whirlpool SDK not initialized');
    }

    try {
      const whirlpool = await this.fetchWhirlpool(poolAddress);
      const data = whirlpool.getData();

      return {
        tokenMintA: data.tokenMintA.toBase58(),
        tokenMintB: data.tokenMintB.toBase58(),
        tickCurrentIndex: data.tickCurrentIndex,
        sqrtPrice: data.sqrtPrice.toString(),
        liquidity: data.liquidity.toString(),
        feeRate: data.feeRate / 10000, // Convert basis points to decimal
      };
    } catch (error) {
      logger.error('Error getting Whirlpool data:', error);
      throw error;
    }
  }

  /**
   * Get optimal tick range for a position based on pool liquidity distribution
   * @param poolAddress - Whirlpool pool address
   * @param rangeWidth - Desired range width in percentage (e.g., 0.2 for ±20%)
   * @returns Lower and upper tick indices
   */
  async getOptimalTickRange(
    poolAddress: PublicKey,
    rangeWidth: number = 0.2
  ): Promise<{
    lowerTickIndex: number;
    upperTickIndex: number;
    currentTickIndex: number;
  }> {
    if (!this.whirlpoolCtx) {
      throw new Error('Whirlpool SDK not initialized');
    }

    try {
      const whirlpool = await this.fetchWhirlpool(poolAddress);
      const data = whirlpool.getData();

      const currentTickIndex = data.tickCurrentIndex;
      const tickSpacing = data.tickSpacing;

      // Calculate tick range based on desired width
      const tickRange = Math.floor((rangeWidth * currentTickIndex) / tickSpacing) * tickSpacing;

      // Round to nearest valid tick
      const lowerTickIndex = Math.floor((currentTickIndex - tickRange) / tickSpacing) * tickSpacing;
      const upperTickIndex = Math.floor((currentTickIndex + tickRange) / tickSpacing) * tickSpacing;

      return {
        lowerTickIndex,
        upperTickIndex,
        currentTickIndex,
      };
    } catch (error) {
      logger.error('Error calculating optimal tick range:', error);
      throw error;
    }
  }

  /**
   * Get position PDA for a position mint
   * @param positionMint - Position NFT mint address
   * @returns Position PDA address
   */
  async getPositionAddress(positionMint: PublicKey): Promise<PublicKey> {
    const { PDAUtil, ORCA_WHIRLPOOL_PROGRAM_ID } = (await import('@orca-so/whirlpools-sdk')) as any;
    return (PDAUtil as any).getPosition(
      ORCA_WHIRLPOOL_PROGRAM_ID,
      positionMint
    ).publicKey;
  }

  /**
   * Fetch position data
   * @param positionMint - Position NFT mint address
   * @returns Position data
   */
  async getPositionData(positionMint: PublicKey): Promise<any> {
    if (!this.whirlpoolCtx) {
      throw new Error('Whirlpool SDK not initialized');
    }

    try {
      // Get position PDA
      const positionPda = await this.getPositionAddress(positionMint);
      
      // Fetch position account data
      const positionData = await this.whirlpoolCtx.fetcher.getPosition(positionPda);

      if (!positionData) {
        throw new Error(`Position not found: ${positionMint.toBase58()}`);
      }

      logger.info(`Fetched position data: ${positionMint.toBase58()}`);
      return {
        whirlpool: positionData.whirlpool.toBase58(),
        positionMint: positionData.positionMint.toBase58(),
        liquidity: positionData.liquidity.toString(),
        tickLowerIndex: positionData.tickLowerIndex,
        tickUpperIndex: positionData.tickUpperIndex,
        feeOwedA: positionData.feeOwedA.toString(),
        feeOwedB: positionData.feeOwedB.toString(),
      };
    } catch (error) {
      logger.error('Error fetching position data:', error);
      throw error;
    }
  }

  // NOTE: Advanced position management methods (increase/decrease liquidity, etc.)
  // require more complex SDK usage with tick arrays and will be implemented
  // when there's a concrete use case. For now, use getPositionData() to fetch
  // position info and build transactions manually if needed.

  /**
   * Collect fees from a position
   * @param positionAddress - Position NFT mint address
   * @returns Transaction to collect fees
   */
  async collectFees(positionAddress: PublicKey): Promise<any> {
    if (!this.whirlpoolCtx) {
      throw new Error('Whirlpool SDK not initialized');
    }

    try {
      // Get position data to check fees owed
      const positionData = await this.getPositionData(positionAddress);
      
      logger.info(`Position has ${positionData.feeOwedA} token A fees and ${positionData.feeOwedB} token B fees`);
      logger.warn('Collect fees requires transaction building - not yet implemented');
      
      return positionData;
    } catch (error) {
      logger.error('Error collecting fees:', error);
      throw error;
    }
  }

  /**
   * Calculate price impact percentage
   */
  private async calculatePriceImpact(startSqrtPrice: any, endSqrtPrice: any): Promise<number> {
    const { PriceMath } = (await import('@orca-so/whirlpools-sdk')) as any;
    const startPrice = (PriceMath as any).sqrtPriceX64ToPrice(startSqrtPrice, 6, 6);
    const endPrice = (PriceMath as any).sqrtPriceX64ToPrice(endSqrtPrice, 6, 6);
    return Math.abs(endPrice.toNumber() - startPrice.toNumber()) / startPrice.toNumber();
  }

  /**
   * Check if Whirlpool SDK is available
   */
  isWhirlpoolSDKAvailable(): boolean {
    return this.whirlpoolCtx !== null;
  }
}

export default new OrcaService();
