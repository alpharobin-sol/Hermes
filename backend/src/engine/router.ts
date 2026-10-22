import { prisma } from '../db/prisma';
import { logger } from '../utils/logger';
import riskEngine from './risk';
import volatilityOracle from './volatilityOracle';
import marinadeService from '../services/marinade';
import jitoService from '../services/jito';
import marginfiService from '../services/marginfi';
import kaminoService from '../services/kamino';
import orcaService from '../services/orca';

export interface RouteOption {
  protocol: string;
  asset: string;
  score: number;
  apy: number;
  tvl: number;
  riskScore: number;
  volatility: number;
  slippage: number;
  fees: {
    deposit: number;
    withdrawal: number;
    performance?: number;
  };
  estimatedReturn: number;
  lockPeriod?: number; // in days
  metadata: any;
}

export interface RoutingResult {
  bestRoute: RouteOption;
  alternativeRoutes: RouteOption[];
  reason: string;
  confidence: number;
  timestamp: Date;
  metrics: {
    totalRoutesEvaluated: number;
    averageAPY: number;
    averageRiskScore: number;
  };
}

export interface RoutingCriteria {
  amount: number;
  asset: string;
  riskProfile: 'conservative' | 'moderate' | 'aggressive';
  minAPY?: number;
  maxRisk?: number;
  preferredProtocols?: string[];
  excludeProtocols?: string[];
  lockPeriodPreference?: number; // max acceptable lock period in days
}

export class RouterEngine {
  /**
   * Find the best route based on criteria
   */
  async findBestRoute(criteria: RoutingCriteria): Promise<RoutingResult> {
    try {
      logger.info('Finding best route with criteria:', criteria);
      
      // Get all available routes
      const routes = await this.getAllRoutes(criteria);
      
      if (routes.length === 0) {
        throw new Error('No routes available for the given criteria');
      }
      
      // Score and rank routes
      const scoredRoutes = await this.scoreRoutes(routes, criteria);
      
      // Filter based on criteria
      const filteredRoutes = this.filterRoutes(scoredRoutes, criteria);
      
      if (filteredRoutes.length === 0) {
        throw new Error('No routes meet the specified criteria');
      }
      
      // Sort by score (descending)
      const sortedRoutes = filteredRoutes.sort((a, b) => b.score - a.score);
      
      const bestRoute = sortedRoutes[0];
      const alternativeRoutes = sortedRoutes.slice(1, 4); // Top 3 alternatives
      
      // Generate explanation
      const reason = this.generateExplanation(bestRoute, criteria);
      
      // Calculate confidence
      const confidence = this.calculateConfidence(bestRoute, sortedRoutes);
      
      // Calculate metrics
      const metrics = {
        totalRoutesEvaluated: routes.length,
        averageAPY: routes.reduce((sum, r) => sum + r.apy, 0) / routes.length,
        averageRiskScore: routes.reduce((sum, r) => sum + r.riskScore, 0) / routes.length,
      };
      
      const result: RoutingResult = {
        bestRoute,
        alternativeRoutes,
        reason,
        confidence,
        timestamp: new Date(),
        metrics,
      };
      
      logger.info('Best route found:', {
        protocol: bestRoute.protocol,
        score: bestRoute.score,
        apy: bestRoute.apy,
      });
      
      return result;
    } catch (error) {
      logger.error('Error finding best route:', error);
      throw error;
    }
  }
  
  /**
   * Get all available routes
   */
  private async getAllRoutes(criteria: RoutingCriteria): Promise<RouteOption[]> {
    const routes: RouteOption[] = [];
    const { asset } = criteria;
    
    try {
      // Fetch yield data for all protocols
      const yieldRecords = await prisma.yieldRecord.findMany({
        where: {
          asset,
          timestamp: {
            gte: new Date(Date.now() - 60 * 60 * 1000), // Last hour
          },
        },
        orderBy: { timestamp: 'desc' },
        distinct: ['protocol'],
      });
      
      for (const record of yieldRecords) {
        try {
          // Get risk assessment
          const riskAssessment = await riskEngine.assessRisk(record.protocol, record.asset);
          
          // Get volatility metrics
          const volatilityMetrics = await volatilityOracle.getLatestMetrics(
            record.protocol,
            record.asset
          );
          
          // Estimate slippage
          const slippage = await this.estimateSlippage(
            record.protocol,
            criteria.amount,
            record.asset
          );
          
          // Get fees
          const fees = await this.getFees(record.protocol);
          
          routes.push({
            protocol: record.protocol,
            asset: record.asset,
            score: 0, // Will be calculated later
            apy: record.apy,
            tvl: record.tvl,
            riskScore: riskAssessment.riskScore,
            volatility: volatilityMetrics?.volatility30d || 0,
            slippage,
            fees,
            estimatedReturn: this.calculateEstimatedReturn(
              criteria.amount,
              record.apy,
              fees,
              slippage
            ),
            lockPeriod: this.getLockPeriod(record.protocol),
            metadata: record.metadata,
          });
        } catch (error) {
          logger.warn(`Error processing route for ${record.protocol}:`, error);
        }
      }
      
      return routes;
    } catch (error) {
      logger.error('Error getting all routes:', error);
      return [];
    }
  }
  
  /**
   * Score routes based on risk-adjusted returns
   */
  private async scoreRoutes(
    routes: RouteOption[],
    criteria: RoutingCriteria
  ): Promise<RouteOption[]> {
    const riskProfileWeights = this.getRiskProfileWeights(criteria.riskProfile);
    
    return routes.map(route => {
      // Normalize factors to 0-100 scale
      const normalizedAPY = Math.min((route.apy / 0.30) * 100, 100); // 30% max
      const normalizedTVL = Math.min(Math.log10(route.tvl / 1e6) * 20 + 50, 100);
      const normalizedRisk = route.riskScore; // Already 0-100
      const normalizedVolatility = Math.max(0, 100 - route.volatility * 200);
      const normalizedSlippage = Math.max(0, 100 - route.slippage * 1000);
      
      // Calculate weighted score
      const score =
        normalizedAPY * riskProfileWeights.apy +
        normalizedTVL * riskProfileWeights.tvl +
        normalizedRisk * riskProfileWeights.risk +
        normalizedVolatility * riskProfileWeights.volatility +
        normalizedSlippage * riskProfileWeights.slippage;
      
      return {
        ...route,
        score,
      };
    });
  }
  
  /**
   * Get risk profile weights
   */
  private getRiskProfileWeights(riskProfile: string): {
    apy: number;
    tvl: number;
    risk: number;
    volatility: number;
    slippage: number;
  } {
    switch (riskProfile) {
      case 'conservative':
        return {
          apy: 0.15,
          tvl: 0.25,
          risk: 0.35,
          volatility: 0.20,
          slippage: 0.05,
        };
      case 'moderate':
        return {
          apy: 0.30,
          tvl: 0.20,
          risk: 0.25,
          volatility: 0.15,
          slippage: 0.10,
        };
      case 'aggressive':
        return {
          apy: 0.50,
          tvl: 0.10,
          risk: 0.15,
          volatility: 0.10,
          slippage: 0.15,
        };
      default:
        return {
          apy: 0.30,
          tvl: 0.20,
          risk: 0.25,
          volatility: 0.15,
          slippage: 0.10,
        };
    }
  }
  
  /**
   * Filter routes based on criteria
   */
  private filterRoutes(
    routes: RouteOption[],
    criteria: RoutingCriteria
  ): RouteOption[] {
    return routes.filter(route => {
      // Min APY filter
      if (criteria.minAPY && route.apy < criteria.minAPY) {
        return false;
      }
      
      // Max risk filter
      if (criteria.maxRisk && route.riskScore < criteria.maxRisk) {
        return false;
      }
      
      // Preferred protocols filter
      if (criteria.preferredProtocols && criteria.preferredProtocols.length > 0) {
        if (!criteria.preferredProtocols.includes(route.protocol)) {
          return false;
        }
      }
      
      // Excluded protocols filter
      if (criteria.excludeProtocols && criteria.excludeProtocols.includes(route.protocol)) {
        return false;
      }
      
      // Lock period filter
      if (
        criteria.lockPeriodPreference &&
        route.lockPeriod &&
        route.lockPeriod > criteria.lockPeriodPreference
      ) {
        return false;
      }
      
      return true;
    });
  }
  
  /**
   * Generate human-readable explanation
   */
  private generateExplanation(route: RouteOption, criteria: RoutingCriteria): string {
    const reasons: string[] = [];
    
    // APY reasoning
    if (route.apy > 0.15) {
      reasons.push(`high APY of ${(route.apy * 100).toFixed(2)}%`);
    }
    
    // Risk reasoning
    if (route.riskScore > 80) {
      reasons.push(`excellent risk score of ${route.riskScore.toFixed(0)}/100`);
    } else if (route.riskScore > 70) {
      reasons.push(`good risk score of ${route.riskScore.toFixed(0)}/100`);
    }
    
    // TVL reasoning
    if (route.tvl > 100000000) {
      reasons.push('deep liquidity');
    }
    
    // Volatility reasoning
    if (route.volatility < 0.1) {
      reasons.push('low volatility');
    }
    
    // Risk profile alignment
    const profileAlignment = this.getRiskProfileAlignment(route, criteria.riskProfile);
    if (profileAlignment) {
      reasons.push(profileAlignment);
    }
    
    if (reasons.length === 0) {
      return `${route.protocol} offers a balanced risk-reward profile for ${criteria.asset}`;
    }
    
    return `${route.protocol} selected for ${reasons.join(', ')}`;
  }
  
  /**
   * Get risk profile alignment explanation
   */
  private getRiskProfileAlignment(route: RouteOption, riskProfile: string): string | null {
    switch (riskProfile) {
      case 'conservative':
        if (route.riskScore > 80 && route.volatility < 0.1) {
          return 'matches conservative risk tolerance';
        }
        break;
      case 'moderate':
        if (route.riskScore > 65 && route.apy > 0.08) {
          return 'balanced risk-return for moderate profile';
        }
        break;
      case 'aggressive':
        if (route.apy > 0.15) {
          return 'maximizes yield for aggressive profile';
        }
        break;
    }
    return null;
  }
  
  /**
   * Calculate confidence score
   */
  private calculateConfidence(bestRoute: RouteOption, allRoutes: RouteOption[]): number {
    if (allRoutes.length < 2) return 1.0;
    
    const secondBestScore = allRoutes[1].score;
    const scoreDifference = bestRoute.score - secondBestScore;
    
    // Confidence based on score margin
    // Larger margin = higher confidence
    const confidence = Math.min(0.5 + (scoreDifference / 100), 1.0);
    
    return confidence;
  }
  
  /**
   * Calculate estimated return
   */
  private calculateEstimatedReturn(
    amount: number,
    apy: number,
    fees: any,
    slippage: number
  ): number {
    // Annual return
    const grossReturn = amount * apy;
    
    // Deduct fees
    const depositFee = amount * (fees.deposit || 0);
    const performanceFee = grossReturn * (fees.performance || 0);
    
    // Deduct slippage
    const slippageCost = amount * slippage;
    
    const netReturn = grossReturn - depositFee - performanceFee - slippageCost;
    
    return netReturn;
  }
  
  /**
   * Estimate slippage for a protocol
   */
  private async estimateSlippage(
    protocol: string,
    amount: number,
    asset: string
  ): Promise<number> {
    try {
      switch (protocol) {
        case 'marinade':
          return await marinadeService.estimateSlippage(amount);
        case 'jito':
          return await jitoService.estimateSlippage(amount);
        case 'marginfi':
          return await marginfiService.estimateSlippage(asset, amount, true);
        case 'kamino':
          // Would need vault address - use default
          return 0.01;
        case 'orca':
          // Would need pool address - use default
          return 0.01;
        default:
          return 0.01;
      }
    } catch (error) {
      logger.warn(`Error estimating slippage for ${protocol}:`, error);
      return 0.01; // Default 1%
    }
  }
  
  /**
   * Get fees for a protocol
   */
  private async getFees(protocol: string): Promise<any> {
    switch (protocol) {
      case 'marinade':
        return marinadeService.getFees();
      case 'jito':
        return jitoService.getFees();
      case 'marginfi':
        return marginfiService.getFees();
      case 'kamino':
        return kaminoService.getFees();
      case 'orca':
        return orcaService.getFees();
      default:
        return { deposit: 0, withdrawal: 0 };
    }
  }
  
  /**
   * Get lock period for a protocol
   */
  private getLockPeriod(protocol: string): number | undefined {
    // Lock periods in days
    const lockPeriods: { [key: string]: number | undefined } = {
      marinade: undefined, // Instant unstaking available
      jito: 3, // ~3 days for unstaking
      marginfi: undefined, // No lock
      kamino: undefined, // No lock
      orca: undefined, // No lock
    };
    
    return lockPeriods[protocol];
  }
  
  /**
   * Simulate a route execution
   */
  async simulateRoute(route: RouteOption, amount: number): Promise<{
    success: boolean;
    estimatedOutput: number;
    estimatedFees: number;
    estimatedSlippage: number;
    warnings: string[];
  }> {
    try {
      logger.info(`Simulating route for ${route.protocol} with amount ${amount}`);
      
      const warnings: string[] = [];
      
      // Check TVL depth
      if (amount > route.tvl * 0.05) {
        warnings.push('Trade size is >5% of TVL - expect higher slippage');
      }
      
      // Estimate fees
      const depositFee = amount * route.fees.deposit;
      const withdrawalFee = amount * route.fees.withdrawal;
      const estimatedFees = depositFee + withdrawalFee;
      
      // Estimate slippage
      const estimatedSlippage = amount * route.slippage;
      
      // Calculate output
      const estimatedOutput = amount - estimatedFees - estimatedSlippage;
      
      return {
        success: true,
        estimatedOutput,
        estimatedFees,
        estimatedSlippage,
        warnings,
      };
    } catch (error) {
      logger.error('Error simulating route:', error);
      return {
        success: false,
        estimatedOutput: 0,
        estimatedFees: 0,
        estimatedSlippage: 0,
        warnings: ['Simulation failed'],
      };
    }
  }
}

export default new RouterEngine();
