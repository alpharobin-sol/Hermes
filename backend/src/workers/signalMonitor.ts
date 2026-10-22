/**
 * SIGNAL MONITORING WORKER
 * Runs Signal Engine periodically to detect risks
 */

import { logger } from '../utils/logger';
import signalEngine, { SignalSeverity } from '../engine/signalEngine';
import dpoEngine from '../engine/dpo';
import { prisma } from '../db/prisma';
import { workersEnabled } from '../config/runtime';

const CHECK_INTERVAL = parseInt(process.env.SIGNAL_CHECK_INTERVAL_MINUTES || '5') * 60 * 1000;

export class SignalMonitor {
  private intervalId: NodeJS.Timeout | null = null;
  private isRunning = false;

  /**
   * Start monitoring
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Signal monitor already running');
      return;
    }

    logger.info(`🚨 Starting Signal Monitor (interval: ${CHECK_INTERVAL / 1000}s)`);
    this.isRunning = true;

    // Run immediately
    await this.runCheck();

    // Then run periodically
    this.intervalId = setInterval(async () => {
      await this.runCheck();
    }, CHECK_INTERVAL);
  }

  /**
   * Stop monitoring
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isRunning = false;
    logger.info('Signal monitor stopped');
  }

  /**
   * Run signal check
   */
  private async runCheck(): Promise<void> {
    try {
      logger.info('🚨 Signal Monitor: Running checks...');
      const startTime = Date.now();

      // Run all signal checks
      const signals = await signalEngine.runAllChecks();

      const duration = Date.now() - startTime;
      logger.info(`Signal check complete in ${duration}ms: ${signals.length} signals detected`);

      // Log signal breakdown
      const breakdown = {
        critical: signals.filter(s => s.severity === SignalSeverity.CRITICAL).length,
        high: signals.filter(s => s.severity === SignalSeverity.HIGH).length,
        medium: signals.filter(s => s.severity === SignalSeverity.MEDIUM).length,
        low: signals.filter(s => s.severity === SignalSeverity.LOW).length,
      };

      logger.info(`Signal breakdown: CRITICAL=${breakdown.critical}, HIGH=${breakdown.high}, MEDIUM=${breakdown.medium}, LOW=${breakdown.low}`);

      // Trigger auto-rebalancing for critical signals
      await this.handleCriticalSignals(signals.filter(s => 
        s.severity === SignalSeverity.CRITICAL || s.severity === SignalSeverity.HIGH
      ));

      // Force garbage collection to prevent memory buildup
      if (global.gc) {
        global.gc();
        logger.info('Signal monitor: Memory cleanup triggered');
      }

    } catch (error) {
      logger.error('Signal monitor error:', error);
    }
  }

  /**
   * Handle critical signals - trigger auto-rebalancing
   */
  private async handleCriticalSignals(signals: any[]): Promise<void> {
    if (signals.length === 0) return;

    logger.warn(`🚨 ${signals.length} critical signals require action`);

    try {
      // Get all active portfolios
      const portfolios = await prisma.portfolio.findMany({
        where: {
          // Could add filters for users who opted into auto-rebalancing
        },
      });

      for (const portfolio of portfolios) {
        const allocations = portfolio.allocations as any;
        let needsRebalance = false;

        // Check if portfolio has exposure to problematic protocols
        for (const signal of signals) {
          if (allocations[signal.protocol]) {
            needsRebalance = true;
            logger.warn(`Portfolio ${portfolio.id} has exposure to ${signal.protocol} (signal: ${signal.message})`);
          }
        }

        if (needsRebalance) {
          // Trigger DPO evaluation
          logger.info(`Triggering portfolio evaluation for ${portfolio.id}`);
          
          try {
            const evaluation = await dpoEngine.evaluatePortfolio(portfolio.id);
            
            // If there are recommended exits, create DPO jobs
            if (evaluation.actions.some((a: any) => a.action === 'exit')) {
              logger.warn(`Creating exit jobs for portfolio ${portfolio.id} due to critical signals`);
              
              for (const action of evaluation.actions.filter((a: any) => a.action === 'exit')) {
                await prisma.dPOJob.create({
                  data: {
                    portfolioId: portfolio.id,
                    action: 'exit',
                    fromProtocol: action.fromProtocol || '',
                    amount: action.amount,
                    reason: `Critical signal: ${signals.find(s => s.protocol === action.fromProtocol)?.message}`,
                    confidence: 0.95,
                    status: 'pending',
                  },
                });
              }
            }
          } catch (error) {
            logger.error(`Error evaluating portfolio ${portfolio.id}:`, error);
          }
        }
      }
    } catch (error) {
      logger.error('Error handling critical signals:', error);
    }
    
    // Clean up memory after handling signals
    if (global.gc) {
      global.gc();
    }
  }

  /**
   * Get monitor status
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      checkInterval: CHECK_INTERVAL,
      nextCheck: this.intervalId ? new Date(Date.now() + CHECK_INTERVAL) : null,
    };
  }
}

const signalMonitorInstance = new SignalMonitor();

// Auto-start on import (skip in test env, and when workers are off since it needs Postgres)
if (process.env.NODE_ENV !== 'test' && workersEnabled()) {
  signalMonitorInstance.start().catch(err => {
    logger.error('Failed to start signal monitor:', err);
  });
}

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, stopping signal monitor...');
  signalMonitorInstance.stop();
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, stopping signal monitor...');
  signalMonitorInstance.stop();
});

export default signalMonitorInstance;
