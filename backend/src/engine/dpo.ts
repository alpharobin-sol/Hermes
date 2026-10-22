import { prisma } from '../db/prisma';
import { logger } from '../utils/logger';
import routerEngine, { RoutingCriteria } from './router';
import riskEngine from './risk';

export interface DPOAction {
  action: 'rebalance' | 'allocate' | 'exit' | 'chase_yield' | 'reduce_exposure';
  fromProtocol?: string;
  toProtocol?: string;
  amount?: number;
  percentage?: number;
  reason: string;
  confidence: number;
  urgency: 'low' | 'medium' | 'high' | 'critical';
}

export interface PortfolioEvaluation {
  portfolioId: string;
  currentValue: number;
  targetAllocations: { [protocol: string]: number };
  currentAllocations: { [protocol: string]: number };
  actions: DPOAction[];
  shouldRebalance: boolean;
  riskStatus: 'healthy' | 'warning' | 'critical';
  timestamp: Date;
}

export class DPOEngine {
  private readonly rebalanceThreshold = parseFloat(
    process.env.DPO_REBALANCE_THRESHOLD || '0.15'
  );
  private readonly minYieldImprovement = parseFloat(
    process.env.DPO_MIN_YIELD_IMPROVEMENT || '0.02'
  );
  
  /**
   * Evaluate a portfolio and determine actions
   */
  async evaluatePortfolio(portfolioId: string): Promise<PortfolioEvaluation> {
    try {
      logger.info(`Evaluating portfolio ${portfolioId}`);
      
      // Fetch portfolio
      const portfolio = await prisma.portfolio.findUnique({
        where: { id: portfolioId },
      });
      
      if (!portfolio) {
        throw new Error(`Portfolio ${portfolioId} not found`);
      }
      
      const currentAllocations = portfolio.allocations as any;
      const riskProfile = portfolio.riskProfile as 'conservative' | 'moderate' | 'aggressive';
      
      // Get current yield data for all positions
      const currentYields = await this.getCurrentYields(currentAllocations);
      
      // Calculate optimal allocations
      const targetAllocations = await this.calculateOptimalAllocations(
        portfolio.totalValue,
        riskProfile,
        currentAllocations
      );
      
      // Determine necessary actions
      const actions = await this.determineActions(
        currentAllocations,
        targetAllocations,
        currentYields,
        portfolio.totalValue
      );
      
      // Check if rebalance is needed
      const shouldRebalance = this.shouldRebalance(
        currentAllocations,
        targetAllocations
      );
      
      // Assess risk status
      const riskStatus = await this.assessRiskStatus(currentAllocations);
      
      const evaluation: PortfolioEvaluation = {
        portfolioId,
        currentValue: portfolio.totalValue,
        targetAllocations,
        currentAllocations,
        actions,
        shouldRebalance,
        riskStatus,
        timestamp: new Date(),
      };
      
      logger.info(`Portfolio evaluation completed for ${portfolioId}`, {
        shouldRebalance,
        actionsCount: actions.length,
        riskStatus,
      });
      
      return evaluation;
    } catch (error) {
      logger.error(`Error evaluating portfolio ${portfolioId}:`, error);
      throw error;
    }
  }
  
  /**
   * Get current yields for all allocations
   */
  private async getCurrentYields(allocations: any): Promise<{ [protocol: string]: number }> {
    const yields: { [protocol: string]: number } = {};
    
    for (const protocol of Object.keys(allocations)) {
      try {
        const yieldRecord = await prisma.yieldRecord.findFirst({
          where: { protocol },
          orderBy: { timestamp: 'desc' },
        });
        
        yields[protocol] = yieldRecord?.apy || 0;
      } catch (error) {
        logger.warn(`Error fetching yield for ${protocol}:`, error);
        yields[protocol] = 0;
      }
    }
    
    return yields;
  }
  
  /**
   * Calculate optimal portfolio allocations
   */
  private async calculateOptimalAllocations(
    totalValue: number,
    riskProfile: 'conservative' | 'moderate' | 'aggressive',
    currentAllocations: any
  ): Promise<{ [protocol: string]: number }> {
    try {
      // Get all available routes for main assets
      const assets = ['SOL', 'USDC']; // Can be expanded
      const allRoutes: any[] = [];
      
      for (const asset of assets) {
        const criteria: RoutingCriteria = {
          amount: totalValue / assets.length,
          asset,
          riskProfile,
        };
        
        const routingResult = await routerEngine.findBestRoute(criteria);
        
        // Include best route and top alternatives
        allRoutes.push(routingResult.bestRoute);
        allRoutes.push(...routingResult.alternativeRoutes);
      }
      
      // Apply Modern Portfolio Theory (simplified)
      const targetAllocations = this.optimizeAllocations(
        allRoutes,
        totalValue,
        riskProfile
      );
      
      return targetAllocations;
    } catch (error) {
      logger.error('Error calculating optimal allocations:', error);
      return currentAllocations; // Keep current if calculation fails
    }
  }
  
  /**
   * Optimize allocations using risk/return profile
   */
  private optimizeAllocations(
    routes: any[],
    totalValue: number,
    riskProfile: string
  ): { [protocol: string]: number } {
    const allocations: { [protocol: string]: number } = {};
    
    // Sort routes by score
    const sortedRoutes = routes.sort((a, b) => b.score - a.score);
    
    // Determine diversification strategy based on risk profile
    let topN: number;
    switch (riskProfile) {
      case 'conservative':
        topN = Math.min(5, sortedRoutes.length); // Diversify across top 5
        break;
      case 'moderate':
        topN = Math.min(4, sortedRoutes.length); // Diversify across top 4
        break;
      case 'aggressive':
        topN = Math.min(3, sortedRoutes.length); // Focus on top 3
        break;
      default:
        topN = 4;
    }
    
    const topRoutes = sortedRoutes.slice(0, topN);
    
    // Calculate weights using score-weighted allocation
    const totalScore = topRoutes.reduce((sum, r) => sum + r.score, 0);
    
    for (const route of topRoutes) {
      const weight = route.score / totalScore;
      const amount = totalValue * weight;
      
      if (allocations[route.protocol]) {
        allocations[route.protocol] += amount;
      } else {
        allocations[route.protocol] = amount;
      }
    }
    
    return allocations;
  }
  
  /**
   * Determine necessary actions
   */
  private async determineActions(
    currentAllocations: any,
    targetAllocations: any,
    currentYields: any,
    totalValue: number
  ): Promise<DPOAction[]> {
    const actions: DPOAction[] = [];
    
    // Check for protocols to exit (not in target)
    for (const protocol of Object.keys(currentAllocations)) {
      if (!targetAllocations[protocol] || targetAllocations[protocol] === 0) {
        const currentAmount = currentAllocations[protocol].amount || 0;
        
        if (currentAmount > 0) {
          actions.push({
            action: 'exit',
            fromProtocol: protocol,
            amount: currentAmount,
            reason: 'Protocol no longer in optimal allocation',
            confidence: 0.8,
            urgency: 'low',
          });
        }
      }
    }
    
    // Check for rebalancing opportunities
    for (const protocol of Object.keys(targetAllocations)) {
      const targetAmount = targetAllocations[protocol];
      const currentAmount = currentAllocations[protocol]?.amount || 0;
      const difference = targetAmount - currentAmount;
      const percentageDiff = Math.abs(difference / totalValue);
      
      if (percentageDiff > this.rebalanceThreshold) {
        if (difference > 0) {
          // Need to increase allocation
          actions.push({
            action: 'allocate',
            toProtocol: protocol,
            amount: difference,
            percentage: percentageDiff,
            reason: `Increase allocation to ${protocol} to reach target`,
            confidence: 0.75,
            urgency: percentageDiff > 0.3 ? 'high' : 'medium',
          });
        } else {
          // Need to decrease allocation
          actions.push({
            action: 'reduce_exposure',
            fromProtocol: protocol,
            amount: Math.abs(difference),
            percentage: percentageDiff,
            reason: `Reduce ${protocol} allocation to reach target`,
            confidence: 0.75,
            urgency: 'low',
          });
        }
      }
    }
    
    // Check for yield chasing opportunities
    const yieldChaseActions = await this.identifyYieldChaseOpportunities(
      currentAllocations,
      currentYields
    );
    actions.push(...yieldChaseActions);
    
    // Check for risk events
    const riskActions = await this.identifyRiskActions(currentAllocations);
    actions.push(...riskActions);
    
    // Sort by urgency
    return actions.sort((a, b) => {
      const urgencyOrder = { critical: 4, high: 3, medium: 2, low: 1 };
      return urgencyOrder[b.urgency] - urgencyOrder[a.urgency];
    });
  }
  
  /**
   * Identify yield chasing opportunities
   */
  private async identifyYieldChaseOpportunities(
    currentAllocations: any,
    currentYields: any
  ): Promise<DPOAction[]> {
    const actions: DPOAction[] = [];
    
    for (const protocol of Object.keys(currentAllocations)) {
      const currentYield = currentYields[protocol] || 0;
      
      // Find better alternatives for the same asset
      const allocation = currentAllocations[protocol];
      const asset = allocation.asset || 'SOL';
      
      try {
        const criteria: RoutingCriteria = {
          amount: allocation.amount || 0,
          asset,
          riskProfile: 'moderate',
        };
        
        const routingResult = await routerEngine.findBestRoute(criteria);
        const bestRoute = routingResult.bestRoute;
        
        // If a significantly better route exists
        const yieldImprovement = bestRoute.apy - currentYield;
        if (
          yieldImprovement > this.minYieldImprovement &&
          bestRoute.protocol !== protocol
        ) {
          actions.push({
            action: 'chase_yield',
            fromProtocol: protocol,
            toProtocol: bestRoute.protocol,
            amount: allocation.amount,
            reason: `${bestRoute.protocol} offers ${(yieldImprovement * 100).toFixed(2)}% higher APY`,
            confidence: routingResult.confidence,
            urgency: yieldImprovement > 0.05 ? 'high' : 'medium',
          });
        }
      } catch (error) {
        logger.warn(`Error checking yield chase for ${protocol}:`, error);
      }
    }
    
    return actions;
  }
  
  /**
   * Identify risk-based actions
   */
  private async identifyRiskActions(currentAllocations: any): Promise<DPOAction[]> {
    const actions: DPOAction[] = [];
    
    // Check for unresolved risk events
    const riskEvents = await prisma.riskEvent.findMany({
      where: {
        resolved: false,
        severity: { in: ['high', 'critical'] },
      },
    });
    
    for (const event of riskEvents) {
      const protocol = event.protocol;
      
      if (currentAllocations[protocol]) {
        actions.push({
          action: 'exit',
          fromProtocol: protocol,
          amount: currentAllocations[protocol].amount,
          reason: `${event.severity.toUpperCase()} risk event: ${event.description}`,
          confidence: 0.9,
          urgency: event.severity === 'critical' ? 'critical' : 'high',
        });
      }
    }
    
    return actions;
  }
  
  /**
   * Check if rebalancing is needed
   */
  private shouldRebalance(currentAllocations: any, targetAllocations: any): boolean {
    for (const protocol of Object.keys(targetAllocations)) {
      const target = targetAllocations[protocol];
      const current = currentAllocations[protocol]?.amount || 0;
      const difference = Math.abs(target - current);
      
      // Calculate total value to get percentage
      const totalTarget = Object.values(targetAllocations).reduce(
        (sum: number, val: any) => sum + val,
        0
      );
      
      const percentageDiff = totalTarget > 0 ? difference / totalTarget : 0;
      
      if (percentageDiff > this.rebalanceThreshold) {
        return true;
      }
    }
    
    return false;
  }
  
  /**
   * Assess overall risk status
   */
  private async assessRiskStatus(
    currentAllocations: any
  ): Promise<'healthy' | 'warning' | 'critical'> {
    let lowestRiskScore = 100;
    let criticalEventsCount = 0;
    
    for (const protocol of Object.keys(currentAllocations)) {
      try {
        const asset = currentAllocations[protocol].asset || 'SOL';
        const assessment = await riskEngine.assessRisk(protocol, asset);
        
        if (assessment.riskScore < lowestRiskScore) {
          lowestRiskScore = assessment.riskScore;
        }
        
        // Check for critical events
        const criticalEvents = await prisma.riskEvent.count({
          where: {
            protocol,
            severity: 'critical',
            resolved: false,
          },
        });
        
        criticalEventsCount += criticalEvents;
      } catch (error) {
        logger.warn(`Error assessing risk for ${protocol}:`, error);
      }
    }
    
    if (criticalEventsCount > 0 || lowestRiskScore < 50) {
      return 'critical';
    }
    
    if (lowestRiskScore < 70) {
      return 'warning';
    }
    
    return 'healthy';
  }
  
  /**
   * Execute portfolio actions
   */
  async executeActions(portfolioId: string, actions: DPOAction[]): Promise<void> {
    try {
      logger.info(`Executing ${actions.length} actions for portfolio ${portfolioId}`);
      
      for (const action of actions) {
        // Create DPO job
        await prisma.dPOJob.create({
          data: {
            portfolioId,
            action: action.action,
            fromProtocol: action.fromProtocol,
            toProtocol: action.toProtocol,
            amount: action.amount,
            reason: action.reason,
            confidence: action.confidence,
            status: 'pending',
          },
        });
        
        logger.info(`Created DPO job for ${action.action}`, {
          from: action.fromProtocol,
          to: action.toProtocol,
        });
      }
    } catch (error) {
      logger.error('Error executing portfolio actions:', error);
      throw error;
    }
  }
  
  /**
   * Auto-heal portfolio based on historical volatility
   */
  async autoHealPortfolio(portfolioId: string): Promise<void> {
    try {
      logger.info(`Auto-healing portfolio ${portfolioId}`);
      
      const evaluation = await this.evaluatePortfolio(portfolioId);
      
      if (evaluation.riskStatus === 'critical') {
        // Emergency exit from critical positions
        const criticalActions = evaluation.actions.filter(
          a => a.urgency === 'critical'
        );
        
        if (criticalActions.length > 0) {
          await this.executeActions(portfolioId, criticalActions);
          logger.warn(`Emergency actions executed for portfolio ${portfolioId}`);
        }
      }
    } catch (error) {
      logger.error(`Error auto-healing portfolio ${portfolioId}:`, error);
    }
  }
}

export default new DPOEngine();
