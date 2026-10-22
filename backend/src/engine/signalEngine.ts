/**
 * HERMES SIGNAL ENGINE
 * Early warning system and monitoring brain
 * Detects risks and triggers portfolio rebalancing
 */

import { prisma } from '../db/prisma';
import { logger } from '../utils/logger';
import marinadeService from '../services/marinade';
import jitoService from '../services/jito';
import lstService from '../services/lst';
import stablecoinService from '../services/stablecoins';

// Signal Types
export enum SignalType {
  VALIDATOR_DELINQUENCY = 'validator_delinquency',
  LIQUIDITY_DRYING = 'liquidity_drying',
  TVL_BELOW_THRESHOLD = 'tvl_below_threshold',
  APY_SPIKE = 'apy_spike',
  SOL_VOLATILITY = 'sol_volatility',
  LST_DEPEG = 'lst_depeg',
  PROTOCOL_DOWNTIME = 'protocol_downtime',
  MEMPOOL_CONGESTION = 'mempool_congestion',
}

export enum SignalSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
}

export interface Signal {
  type: SignalType;
  severity: SignalSeverity;
  protocol: string;
  asset?: string;
  message: string;
  data: any;
  timestamp: Date;
  actionable: boolean;
  suggestedAction?: string;
}

// Safety Thresholds
const SAFETY_THRESHOLDS = {
  // TVL thresholds (in USD)
  TVL_MINIMUM: {
    lst: 10_000_000,      // $10M minimum for LST protocols
    lending: 50_000_000,   // $50M minimum for lending
    amm: 5_000_000,        // $5M minimum for AMM pools
  },
  TVL_WARNING_RATIO: 0.8,  // Alert if TVL drops below 80% of threshold
  
  // APY thresholds
  APY_SPIKE_THRESHOLD: 2.0,  // 2x increase is suspicious
  APY_SPIKE_ABSOLUTE: 0.50,   // +50% APY in one period is suspicious
  
  // Validator health
  VALIDATOR_ACTIVE_RATIO: 0.95,  // 95% validators should be active
  
  // LST depeg
  DEPEG_WARNING: 0.02,    // 2% deviation from peg
  DEPEG_CRITICAL: 0.05,   // 5% deviation is critical
  
  // Volatility (daily price change)
  SOL_VOLATILITY_HIGH: 0.10,     // 10% daily change is high
  SOL_VOLATILITY_CRITICAL: 0.20,  // 20% daily change is critical
  
  // Liquidity depth (as % of TVL)
  LIQUIDITY_MINIMUM_RATIO: 0.10,  // 10% of TVL should be liquid
};

export class SignalEngine {
  private signals: Signal[] = [];
  
  /**
   * Run all signal checks
   */
  async runAllChecks(): Promise<Signal[]> {
    logger.info('🚨 Signal Engine: Running all checks...');
    this.signals = [];
    
    try {
      await Promise.all([
        this.checkValidatorHealth(),
        this.checkLiquidityLevels(),
        this.checkTVLThresholds(),
        this.checkAPYSpikes(),
        this.checkLSTDepeg(),
        this.checkProtocolHealth(),
      ]);
      
      logger.info(`Signal Engine: Found ${this.signals.length} signals`);
      
      // Store critical signals in database
      await this.storeSignals();
      
      return this.signals;
    } catch (error) {
      logger.error('Signal Engine: Error running checks:', error);
      return [];
    }
  }
  
  /**
   * Check validator health for LST protocols
   */
  private async checkValidatorHealth(): Promise<void> {
    try {
      // Check Marinade validators
      const marinadeData = await marinadeService.fetchYieldData();
      if (marinadeData.validatorScore < SAFETY_THRESHOLDS.VALIDATOR_ACTIVE_RATIO) {
        this.addSignal({
          type: SignalType.VALIDATOR_DELINQUENCY,
          severity: SignalSeverity.HIGH,
          protocol: 'marinade',
          asset: 'mSOL',
          message: `Marinade validator health low: ${(marinadeData.validatorScore * 100).toFixed(1)}%`,
          data: {
            validatorScore: marinadeData.validatorScore,
            stakeAccounts: marinadeData.stakeAccounts,
            threshold: SAFETY_THRESHOLDS.VALIDATOR_ACTIVE_RATIO,
          },
          timestamp: new Date(),
          actionable: true,
          suggestedAction: 'Consider reducing mSOL allocation or diversifying to Jito/Binance',
        });
      }
      
      // Check Jito TVL as proxy for validator health
      const jitoData = await jitoService.fetchYieldData();
      const jitoTotalStakers = jitoData.metadata?.totalStakers || 0;
      // Monitor Jito staker count
      if (jitoTotalStakers > 0 && jitoTotalStakers < 10000) {
        this.addSignal({
          type: SignalType.VALIDATOR_DELINQUENCY,
          severity: SignalSeverity.LOW,
          protocol: 'jito',
          asset: 'JitoSOL',
          message: `Jito total stakers: ${jitoTotalStakers}`,
          data: {
            totalStakers: jitoTotalStakers,
            jitosolSupply: jitoData.metadata?.jitosolSupply,
          },
          timestamp: new Date(),
          actionable: false,
          suggestedAction: 'Monitor Jito adoption metrics',
        });
      }
    } catch (error) {
      logger.error('Error checking validator health:', error);
    }
  }
  
  /**
   * Check liquidity levels across protocols
   */
  private async checkLiquidityLevels(): Promise<void> {
    try {
      const allYields = await lstService.fetchAllLSTYields();
      
      for (const yield_ of allYields) {
        const liquidityRatio = yield_.tvl > 0 ? (yield_.tvl * 0.1) / yield_.tvl : 0; // Simplified
        
        if (liquidityRatio < SAFETY_THRESHOLDS.LIQUIDITY_MINIMUM_RATIO && yield_.tvl > 0) {
          this.addSignal({
            type: SignalType.LIQUIDITY_DRYING,
            severity: SignalSeverity.MEDIUM,
            protocol: yield_.protocol,
            asset: yield_.asset,
            message: `Low liquidity detected for ${yield_.asset}`,
            data: {
              tvl: yield_.tvl,
              liquidityRatio: liquidityRatio,
              threshold: SAFETY_THRESHOLDS.LIQUIDITY_MINIMUM_RATIO,
            },
            timestamp: new Date(),
            actionable: true,
            suggestedAction: 'Monitor for potential exit difficulty',
          });
        }
      }
    } catch (error) {
      logger.error('Error checking liquidity levels:', error);
    }
  }
  
  /**
   * Check TVL against safety thresholds
   */
  private async checkTVLThresholds(): Promise<void> {
    try {
      const [lstYields, stableYields] = await Promise.all([
        lstService.fetchAllLSTYields(),
        stablecoinService.fetchAllStablecoinYields(),
      ]);
      
      // Check LST protocols
      for (const yield_ of lstYields) {
        const threshold = SAFETY_THRESHOLDS.TVL_MINIMUM.lst;
        const warningLevel = threshold * SAFETY_THRESHOLDS.TVL_WARNING_RATIO;
        
        if (yield_.tvl < warningLevel && yield_.tvl > 0) {
          const severity = yield_.tvl < threshold ? SignalSeverity.HIGH : SignalSeverity.MEDIUM;
          
          this.addSignal({
            type: SignalType.TVL_BELOW_THRESHOLD,
            severity,
            protocol: yield_.protocol,
            asset: yield_.asset,
            message: `${yield_.asset} TVL below safety threshold: $${(yield_.tvl / 1e6).toFixed(1)}M`,
            data: {
              currentTVL: yield_.tvl,
              threshold: threshold,
              warningLevel: warningLevel,
              ratio: yield_.tvl / threshold,
            },
            timestamp: new Date(),
            actionable: true,
            suggestedAction: severity === SignalSeverity.HIGH 
              ? 'Exit position - TVL too low for safety'
              : 'Reduce exposure or monitor closely',
          });
        }
      }
      
      // Check stablecoin pools
      for (const yield_ of stableYields) {
        const threshold = SAFETY_THRESHOLDS.TVL_MINIMUM.amm;
        const warningLevel = threshold * SAFETY_THRESHOLDS.TVL_WARNING_RATIO;
        
        if (yield_.tvl < warningLevel && yield_.tvl > 0) {
          const severity = yield_.tvl < threshold ? SignalSeverity.HIGH : SignalSeverity.MEDIUM;
          
          this.addSignal({
            type: SignalType.TVL_BELOW_THRESHOLD,
            severity,
            protocol: yield_.protocol,
            asset: yield_.asset,
            message: `${yield_.asset} pool TVL below threshold: $${(yield_.tvl / 1e6).toFixed(1)}M`,
            data: {
              currentTVL: yield_.tvl,
              threshold: threshold,
              category: yield_.category,
            },
            timestamp: new Date(),
            actionable: true,
            suggestedAction: 'Consider exiting low-liquidity pool',
          });
        }
      }
    } catch (error) {
      logger.error('Error checking TVL thresholds:', error);
    }
  }
  
  /**
   * Check for suspicious APY spikes
   */
  private async checkAPYSpikes(): Promise<void> {
    try {
      // Get recent yield records from database
      const recentYields = await prisma.yieldRecord.findMany({
        where: {
          timestamp: {
            gte: new Date(Date.now() - 24 * 60 * 60 * 1000), // Last 24h
          },
        },
        orderBy: {
          timestamp: 'desc',
        },
      });
      
      // Group by protocol+asset and check for spikes
      const yieldsByProtocol = new Map<string, typeof recentYields>();
      
      for (const record of recentYields) {
        const key = `${record.protocol}:${record.asset}`;
        if (!yieldsByProtocol.has(key)) {
          yieldsByProtocol.set(key, []);
        }
        yieldsByProtocol.get(key)!.push(record);
      }
      
      for (const records of yieldsByProtocol.values()) {
        if (records.length < 2) continue;
        
        const latest = records[0];
        const previous = records[1];
        
        const apyChange = latest.apy - previous.apy;
        const apyRatio = latest.apy / previous.apy;
        
        // Detect suspicious spike
        if (apyRatio > SAFETY_THRESHOLDS.APY_SPIKE_THRESHOLD || 
            apyChange > SAFETY_THRESHOLDS.APY_SPIKE_ABSOLUTE) {
          
          this.addSignal({
            type: SignalType.APY_SPIKE,
            severity: SignalSeverity.HIGH,
            protocol: latest.protocol,
            asset: latest.asset,
            message: `Suspicious APY spike detected for ${latest.asset}: ${(previous.apy * 100).toFixed(1)}% → ${(latest.apy * 100).toFixed(1)}%`,
            data: {
              previousAPY: previous.apy,
              currentAPY: latest.apy,
              change: apyChange,
              ratio: apyRatio,
              timeGap: latest.timestamp.getTime() - previous.timestamp.getTime(),
            },
            timestamp: new Date(),
            actionable: true,
            suggestedAction: 'POTENTIAL EXPLOIT - Verify protocol health before entering. May indicate liquidity attack or rug pull.',
          });
        }
      }
    } catch (error) {
      logger.error('Error checking APY spikes:', error);
    }
  }
  
  /**
   * Check for LST depeg risk
   */
  private async checkLSTDepeg(): Promise<void> {
    try {
      const lstYields = await lstService.fetchAllLSTYields();
      
      for (const yield_ of lstYields) {
        // Check if price data available
        if (!yield_.metadata?.exchangeRate && !yield_.tokenPrice) continue;
        
        const exchangeRate = yield_.metadata?.exchangeRate || yield_.tokenPrice || 1.0;
        const deviation = Math.abs(1.0 - exchangeRate);
        
        if (deviation > SAFETY_THRESHOLDS.DEPEG_WARNING) {
          const severity = deviation > SAFETY_THRESHOLDS.DEPEG_CRITICAL 
            ? SignalSeverity.CRITICAL 
            : SignalSeverity.HIGH;
          
          this.addSignal({
            type: SignalType.LST_DEPEG,
            severity,
            protocol: yield_.protocol,
            asset: yield_.asset,
            message: `${yield_.asset} depeg risk: ${(deviation * 100).toFixed(2)}% deviation from peg`,
            data: {
              exchangeRate,
              deviation,
              warningThreshold: SAFETY_THRESHOLDS.DEPEG_WARNING,
              criticalThreshold: SAFETY_THRESHOLDS.DEPEG_CRITICAL,
            },
            timestamp: new Date(),
            actionable: true,
            suggestedAction: severity === SignalSeverity.CRITICAL
              ? 'CRITICAL: Exit position immediately - severe depeg detected'
              : 'Monitor closely - consider reducing exposure',
          });
        }
      }
    } catch (error) {
      logger.error('Error checking LST depeg:', error);
    }
  }
  
  /**
   * Check protocol health (uptime, errors)
   */
  private async checkProtocolHealth(): Promise<void> {
    try {
      const protocols = await prisma.protocolMetadata.findMany({
        where: {
          isActive: true,
        },
      });
      
      for (const protocol of protocols) {
        // Check consecutive failures
        if (protocol.consecutiveFailures >= 3) {
          this.addSignal({
            type: SignalType.PROTOCOL_DOWNTIME,
            severity: SignalSeverity.HIGH,
            protocol: protocol.protocol,
            message: `${protocol.name} experiencing API issues: ${protocol.consecutiveFailures} consecutive failures`,
            data: {
              consecutiveFailures: protocol.consecutiveFailures,
              lastSuccess: protocol.lastSuccessfulFetch,
              healthScore: protocol.healthScore,
            },
            timestamp: new Date(),
            actionable: true,
            suggestedAction: 'Protocol data may be stale - consider diversifying to other protocols',
          });
        }
        
        // Check health score
        if (protocol.healthScore < 50) {
          this.addSignal({
            type: SignalType.PROTOCOL_DOWNTIME,
            severity: SignalSeverity.MEDIUM,
            protocol: protocol.protocol,
            message: `${protocol.name} health score low: ${protocol.healthScore}/100`,
            data: {
              healthScore: protocol.healthScore,
              isBlacklisted: protocol.isBlacklisted,
            },
            timestamp: new Date(),
            actionable: true,
            suggestedAction: 'Monitor protocol stability',
          });
        }
      }
    } catch (error) {
      logger.error('Error checking protocol health:', error);
    }
  }
  
  /**
   * Add signal to queue
   */
  private addSignal(signal: Signal): void {
    this.signals.push(signal);
    logger.warn(`🚨 SIGNAL: [${signal.severity.toUpperCase()}] ${signal.message}`);
  }
  
  /**
   * Store critical signals in database
   */
  private async storeSignals(): Promise<void> {
    const criticalSignals = this.signals.filter(
      s => s.severity === SignalSeverity.HIGH || s.severity === SignalSeverity.CRITICAL
    );
    
    for (const signal of criticalSignals) {
      try {
        await prisma.riskEvent.create({
          data: {
            protocol: signal.protocol,
            eventType: signal.type,
            severity: signal.severity,
            description: signal.message,
            metrics: signal.data,
            timestamp: signal.timestamp,
            resolved: false,
          },
        });
      } catch (error) {
        logger.error('Error storing signal:', error);
      }
    }
  }
  
  /**
   * Get active signals for a protocol
   */
  async getProtocolSignals(protocol: string): Promise<Signal[]> {
    return this.signals.filter(s => s.protocol === protocol);
  }
  
  /**
   * Get signals by severity
   */
  async getSignalsBySeverity(severity: SignalSeverity): Promise<Signal[]> {
    return this.signals.filter(s => s.severity === severity);
  }
  
  /**
   * Get actionable signals (that require portfolio changes)
   */
  async getActionableSignals(): Promise<Signal[]> {
    return this.signals.filter(s => s.actionable);
  }
}

export default new SignalEngine();
