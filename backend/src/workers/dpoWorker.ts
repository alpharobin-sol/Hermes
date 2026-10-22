import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { prisma } from '../db/prisma';
import { logger } from '../utils/logger';
import dpoEngine from '../engine/dpo';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const EVALUATION_INTERVAL = parseInt(
  process.env.DPO_WORKER_INTERVAL_MINUTES || '30'
);

// Create Redis connection
const connection = new Redis(REDIS_URL, {
  maxRetriesPerRequest: null,
});

// Create queue
export const dpoQueue = new Queue('dpo-worker', { connection });

/**
 * Evaluate all active portfolios
 */
async function evaluateAllPortfolios(): Promise<void> {
  logger.info('Starting portfolio evaluation...');
  
  try {
    // Get all active portfolios
    const portfolios = await prisma.portfolio.findMany({
      where: {
        // Add any active filters if needed
      },
    });
    
    logger.info(`Evaluating ${portfolios.length} portfolios`);
    
    for (const portfolio of portfolios) {
      try {
        // Evaluate portfolio
        const evaluation = await dpoEngine.evaluatePortfolio(portfolio.id);
        
        logger.info(`Portfolio ${portfolio.id} evaluated`, {
          shouldRebalance: evaluation.shouldRebalance,
          riskStatus: evaluation.riskStatus,
          actionsCount: evaluation.actions.length,
        });
        
        // Execute actions if needed
        if (evaluation.shouldRebalance && evaluation.actions.length > 0) {
          // Filter for high urgency actions
          const urgentActions = evaluation.actions.filter(
            a => a.urgency === 'critical' || a.urgency === 'high'
          );
          
          if (urgentActions.length > 0) {
            await dpoEngine.executeActions(portfolio.id, urgentActions);
            logger.info(`Executed ${urgentActions.length} urgent actions for portfolio ${portfolio.id}`);
          }
        }
        
        // Auto-heal if in critical state
        if (evaluation.riskStatus === 'critical') {
          logger.warn(`Portfolio ${portfolio.id} in critical state, auto-healing...`);
          await dpoEngine.autoHealPortfolio(portfolio.id);
        }
        
        // Update portfolio metrics
        await prisma.portfolio.update({
          where: { id: portfolio.id },
          data: {
            lastRebalance: evaluation.shouldRebalance ? new Date() : portfolio.lastRebalance,
            updatedAt: new Date(),
          },
        });
      } catch (error) {
        logger.error(`Error evaluating portfolio ${portfolio.id}:`, error);
      }
    }
    
    logger.info('Portfolio evaluation completed');
    
    // Force garbage collection to free memory
    if (global.gc) {
      global.gc();
      logger.info('DPO worker: Memory cleanup triggered');
    }
  } catch (error) {
    logger.error('Error in portfolio evaluation:', error);
  }
}

/**
 * Execute pending DPO jobs
 */
async function executePendingJobs(): Promise<void> {
  logger.info('Executing pending DPO jobs...');
  
  try {
    // Get pending jobs
    const pendingJobs = await prisma.dPOJob.findMany({
      where: {
        status: 'pending',
        createdAt: {
          // Only process jobs older than 1 minute (give time for batching)
          lte: new Date(Date.now() - 60 * 1000),
        },
      },
      orderBy: { createdAt: 'asc' },
      take: 10, // Process in batches
    });
    
    logger.info(`Found ${pendingJobs.length} pending jobs`);
    
    for (const job of pendingJobs) {
      try {
        // Update status to executing
        await prisma.dPOJob.update({
          where: { id: job.id },
          data: {
            status: 'executing',
            executedAt: new Date(),
          },
        });
        
        logger.info(`Executing DPO job ${job.id}: ${job.action}`, {
          from: job.fromProtocol,
          to: job.toProtocol,
          amount: job.amount,
        });
        
        // TODO: Implement actual on-chain execution
        // For now, we'll mark as completed
        // In production, this would call routeDeposit/routeWithdraw functions
        
        // Simulate execution delay
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Mark as completed
        await prisma.dPOJob.update({
          where: { id: job.id },
          data: {
            status: 'completed',
            completedAt: new Date(),
          },
        });
        
        logger.info(`DPO job ${job.id} completed successfully`);
      } catch (error) {
        logger.error(`Error executing DPO job ${job.id}:`, error);
        
        // Mark as failed
        await prisma.dPOJob.update({
          where: { id: job.id },
          data: {
            status: 'failed',
            error: error instanceof Error ? error.message : 'Unknown error',
          },
        });
      }
    }
    
    logger.info('Pending job execution completed');
  } catch (error) {
    logger.error('Error executing pending jobs:', error);
  }
}

/**
 * Clean up old completed jobs
 */
async function cleanupOldJobs(): Promise<void> {
  try {
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    
    const result = await prisma.dPOJob.deleteMany({
      where: {
        status: 'completed',
        completedAt: {
          lte: oneWeekAgo,
        },
      },
    });
    
    logger.info(`Cleaned up ${result.count} old completed jobs`);
  } catch (error) {
    logger.error('Error cleaning up old jobs:', error);
  }
}

/**
 * Resolve old risk events
 */
async function resolveOldRiskEvents(): Promise<void> {
  try {
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    
    const result = await prisma.riskEvent.updateMany({
      where: {
        resolved: false,
        timestamp: {
          lte: twoDaysAgo,
        },
        severity: { in: ['low', 'medium'] },
      },
      data: {
        resolved: true,
        resolvedAt: new Date(),
      },
    });
    
    logger.info(`Auto-resolved ${result.count} old risk events`);
  } catch (error) {
    logger.error('Error resolving old risk events:', error);
  }
}

/**
 * Worker to process DPO jobs
 */
const worker = new Worker(
  'dpo-worker',
  async (job) => {
    logger.info(`Processing DPO job ${job.id}: ${job.name}`);
    
    switch (job.name) {
      case 'evaluate-portfolios':
        await evaluateAllPortfolios();
        break;
      case 'execute-pending':
        await executePendingJobs();
        break;
      case 'cleanup-jobs':
        await cleanupOldJobs();
        break;
      case 'resolve-risk-events':
        await resolveOldRiskEvents();
        break;
      default:
        logger.warn(`Unknown job name: ${job.name}`);
    }
  },
  {
    connection,
    concurrency: 1,
  }
);

// Worker event handlers
worker.on('completed', (job) => {
  logger.info(`DPO job ${job.id} completed`);
});

worker.on('failed', (job, err) => {
  logger.error(`DPO job ${job?.id} failed:`, err);
});

/**
 * Schedule recurring DPO jobs
 */
export async function scheduleDPOJobs(): Promise<void> {
  // Evaluate portfolios every N minutes
  await dpoQueue.add(
    'evaluate-portfolios',
    {},
    {
      repeat: {
        every: EVALUATION_INTERVAL * 60 * 1000,
      },
    }
  );
  
  // Execute pending jobs every 5 minutes
  await dpoQueue.add(
    'execute-pending',
    {},
    {
      repeat: {
        every: 5 * 60 * 1000,
      },
    }
  );
  
  // Cleanup old jobs daily
  await dpoQueue.add(
    'cleanup-jobs',
    {},
    {
      repeat: {
        every: 24 * 60 * 60 * 1000,
      },
    }
  );
  
  // Resolve old risk events every 6 hours
  await dpoQueue.add(
    'resolve-risk-events',
    {},
    {
      repeat: {
        every: 6 * 60 * 60 * 1000,
      },
    }
  );
  
  logger.info('DPO jobs scheduled', {
    evaluationInterval: `${EVALUATION_INTERVAL} minutes`,
  });
}

/**
 * Start the DPO worker
 */
export async function startDPOWorker(): Promise<void> {
  logger.info('Starting DPO worker...');
  
  // Schedule jobs
  await scheduleDPOJobs();
  
  // Run initial evaluation
  await evaluateAllPortfolios();
  
  logger.info('DPO worker started');
}

// If running directly
if (require.main === module) {
  startDPOWorker()
    .then(() => {
      logger.info('DPO worker running');
    })
    .catch((error) => {
      logger.error('Error starting DPO worker:', error);
      process.exit(1);
    });
}

export default worker;
