import { Queue, Worker, QueueEvents } from 'bullmq';
import { Redis } from 'ioredis';
import { prisma } from '../db/prisma';
import { logger } from '../utils/logger';
import marinadeService from '../services/marinade';
import jitoService from '../services/jito';
import marginfiService from '../services/marginfi';
import kaminoService from '../services/kamino';
import orcaService from '../services/orca';
// Individual LST services
import binanceService from '../services/binance';
import jupiterService from '../services/jupiter';
import heliusService from '../services/helius';
import driftService from '../services/drift';
import volatilityOracle from '../engine/volatilityOracle';
import riskEngine from '../engine/risk';
import { getProtocolEmissions } from '../config/protocolEmissions';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const COLLECTION_INTERVAL = parseInt(
  process.env.YIELD_COLLECTION_INTERVAL_MINUTES || '10'
);

// Create Redis connection
const connection = new Redis(REDIS_URL, {
  maxRetriesPerRequest: null,
});

// Create queue
export const yieldCollectorQueue = new Queue('yield-collector', { connection });

// Queue events for monitoring (used by BullMQ internally for job tracking)
const queueEvents = new QueueEvents('yield-collector', { connection });
queueEvents.on('completed', ({ jobId }) => {
  logger.debug(`Queue event: Job ${jobId} completed`);
});

/**
 * Helper: Update protocol metadata with emissions and incentives
 */
async function updateProtocolMetadata(protocol: string, name: string): Promise<void> {
  const emissionsConfig = getProtocolEmissions(protocol);
  
  const updateData: any = {
    lastSuccessfulFetch: new Date(),
    consecutiveFailures: 0,
  };
  
  if (emissionsConfig) {
    updateData.hasEmissions = emissionsConfig.hasEmissions;
    updateData.emissionSchedule = emissionsConfig.emissionSchedule;
    updateData.nextEmissionChange = emissionsConfig.nextEmissionChange;
    updateData.incentivePrograms = emissionsConfig.incentivePrograms;
  }
  
  await prisma.protocolMetadata.upsert({
    where: { protocol },
    update: updateData,
    create: {
      protocol,
      name,
      isActive: true,
      ...updateData,
    },
  });
}

/**
 * Collect yield data from all protocols
 */
async function collectYields(): Promise<void> {
  logger.info('Starting yield collection...');
  
  // Collect Marinade data
  try {
    logger.info('Collecting yield data from Marinade...');
    const data = await marinadeService.fetchYieldData();
    
    await prisma.yieldRecord.create({
      data: {
        protocol: data.protocol,
        asset: data.asset,
        apy: data.apy,
        apr: data.apr || data.apy,
        tvl: data.tvl,
        riskScore: marinadeService.calculateRiskScore(data),
        volatility: 0,
        metadata: data.metadata || {},
      },
    });
    
    logger.info('Marinade yield collected', { apy: data.apy, tvl: data.tvl });
    await updateProtocolMetadata('marinade', 'Marinade');
  } catch (error) {
    logger.error('Error collecting yield from Marinade:', error);
  }
  
  // Collect Jito data
  try {
    logger.info('Collecting yield data from Jito...');
    const data = await jitoService.fetchYieldData();
    
    await prisma.yieldRecord.create({
      data: {
        protocol: data.protocol,
        asset: data.asset,
        apy: data.apy,
        apr: data.apr || data.apy,
        tvl: data.tvl,
        riskScore: jitoService.calculateRiskScore(data),
        volatility: 0,
        metadata: data.metadata || {},
      },
    });
    
    logger.info('Jito yield collected', { apy: data.apy, tvl: data.tvl });
    await updateProtocolMetadata('jito', 'Jito');
  } catch (error) {
    logger.error('Error collecting yield from Jito:', error);
  }
  
  // Collect MarginFi data (multiple assets)
  try {
    logger.info('Collecting yield data from MarginFi...');
    const assets = ['SOL', 'USDC'];
    
    for (const asset of assets) {
      const data = await marginfiService.fetchYieldData(asset);
      
      await prisma.yieldRecord.create({
        data: {
          protocol: 'marginfi',
          asset: data.asset,
          apy: data.supplyAPY,
          apr: data.supplyAPY,
          tvl: data.tvl,
          riskScore: marginfiService.calculateRiskScore(data),
          volatility: 0,
          liquidationRisk: data.liquidationThreshold < 0.85 ? 0.5 : 0.2,
          metadata: data.metadata,
        },
      });
    }
    
    await prisma.protocolMetadata.upsert({
      where: { protocol: 'marginfi' },
      update: {
        lastSuccessfulFetch: new Date(),
        consecutiveFailures: 0,
      },
      create: {
        protocol: 'marginfi',
        name: 'MarginFi',
        isActive: true,
        lastSuccessfulFetch: new Date(),
      },
    });
  } catch (error) {
    logger.error('Error collecting yield from MarginFi:', error);
  }
  
  // Collect Kamino data (Lending Protocol)
  try {
    logger.info('Collecting yield data from Kamino...');
    const reserves = await kaminoService.fetchYieldData();
    
    for (const reserve of reserves) {
      await prisma.yieldRecord.create({
        data: {
          protocol: 'kamino',
          asset: reserve.asset,
          pool: reserve.reserve,
          apy: reserve.totalAPY,
          apr: reserve.supplyAPY,
          tvl: reserve.tvl,
          riskScore: kaminoService.calculateRiskScore(reserve),
          volatility: 0,
          // Kamino's API has no liquidation threshold; lenders are not liquidated, so unknown counts as low risk
          liquidationRisk: (reserve.metadata.liquidationThreshold ?? 1) < 0.85 ? 0.5 : 0.2,
          metadata: reserve.metadata,
        },
      });
    }
    
    await prisma.protocolMetadata.upsert({
      where: { protocol: 'kamino' },
      update: {
        lastSuccessfulFetch: new Date(),
        consecutiveFailures: 0,
      },
      create: {
        protocol: 'kamino',
        name: 'Kamino Lend',
        isActive: true,
        lastSuccessfulFetch: new Date(),
      },
    });
  } catch (error) {
    logger.error('Error collecting yield from Kamino:', error);
  }
  
  // Collect Orca data
  try {
    logger.info('Collecting yield data from Orca...');
    const pools = await orcaService.fetchYieldData();
    
    for (const pool of pools) {
      await prisma.yieldRecord.create({
        data: {
          protocol: 'orca',
          asset: pool.asset,
          pool: pool.pool,
          apy: pool.totalAPY,
          apr: pool.feeAPR + pool.incentivesAPR,
          tvl: pool.tvl,
          riskScore: orcaService.calculateRiskScore(pool),
          volatility: 0,
          impermanentLoss: 0.03, // Estimate for Whirlpool positions
          metadata: pool.metadata,
        },
      });
    }
    
    await prisma.protocolMetadata.upsert({
      where: { protocol: 'orca' },
      update: {
        lastSuccessfulFetch: new Date(),
        consecutiveFailures: 0,
      },
      create: {
        protocol: 'orca',
        name: 'Orca',
        isActive: true,
        lastSuccessfulFetch: new Date(),
      },
    });
  } catch (error) {
    logger.error('Error collecting yield from Orca:', error);
  }
  
  // Collect Binance BNSOL data
  try {
    logger.info('Collecting yield data from Binance (BNSOL)...');
    const data = await binanceService.fetchYieldData();
    
    await prisma.yieldRecord.create({
      data: {
        protocol: data.protocol,
        asset: data.asset,
        apy: data.apy,
        apr: data.apr,
        tvl: data.tvl,
        riskScore: binanceService.calculateRiskScore(data),
        volatility: 0,
        metadata: data.metadata || {},
      },
    });
    
    logger.info('BNSOL yield collected', { apy: data.apy, tvl: data.tvl });
    
    await prisma.protocolMetadata.upsert({
      where: { protocol: 'binance' },
      update: { lastSuccessfulFetch: new Date(), consecutiveFailures: 0 },
      create: { protocol: 'binance', name: 'Binance Staked SOL', isActive: true, lastSuccessfulFetch: new Date() },
    });
  } catch (error) {
    logger.error('Error collecting yield from Binance:', error);
  }
  
  // Collect Jupiter jupSOL data
  try {
    logger.info('Collecting yield data from Jupiter (jupSOL)...');
    const data = await jupiterService.fetchYieldData();
    
    await prisma.yieldRecord.create({
      data: {
        protocol: data.protocol,
        asset: data.asset,
        apy: data.apy,
        apr: data.apr,
        tvl: data.tvl,
        riskScore: jupiterService.calculateRiskScore(data),
        volatility: 0,
        metadata: data.metadata || {},
      },
    });
    
    logger.info('jupSOL yield collected', { apy: data.apy, tvl: data.tvl });
    
    await prisma.protocolMetadata.upsert({
      where: { protocol: 'jupiter' },
      update: { lastSuccessfulFetch: new Date(), consecutiveFailures: 0 },
      create: { protocol: 'jupiter', name: 'Jupiter Staked SOL', isActive: true, lastSuccessfulFetch: new Date() },
    });
  } catch (error) {
    logger.error('Error collecting yield from Jupiter:', error);
  }
  
  // Collect Helius hSOL data
  try {
    logger.info('Collecting yield data from Helius (hSOL)...');
    const data = await heliusService.fetchYieldData();
    
    await prisma.yieldRecord.create({
      data: {
        protocol: data.protocol,
        asset: data.asset,
        apy: data.apy,
        apr: data.apr,
        tvl: data.tvl,
        riskScore: heliusService.calculateRiskScore(data),
        volatility: 0,
        metadata: data.metadata || {},
      },
    });
    
    logger.info('hSOL yield collected', { apy: data.apy, tvl: data.tvl });
    
    await prisma.protocolMetadata.upsert({
      where: { protocol: 'helius' },
      update: { lastSuccessfulFetch: new Date(), consecutiveFailures: 0 },
      create: { protocol: 'helius', name: 'Helius Staked SOL', isActive: true, lastSuccessfulFetch: new Date() },
    });
  } catch (error) {
    logger.error('Error collecting yield from Helius:', error);
  }
  
  // Collect Drift dSOL data
  try {
    logger.info('Collecting yield data from Drift (dSOL)...');
    const data = await driftService.fetchYieldData();
    
    await prisma.yieldRecord.create({
      data: {
        protocol: data.protocol,
        asset: data.asset,
        apy: data.apy,
        apr: data.apr,
        tvl: data.tvl,
        riskScore: driftService.calculateRiskScore(data),
        volatility: 0,
        metadata: data.metadata || {},
      },
    });
    
    logger.info('dSOL yield collected', { apy: data.apy, tvl: data.tvl });
    
    await prisma.protocolMetadata.upsert({
      where: { protocol: 'drift' },
      update: { lastSuccessfulFetch: new Date(), consecutiveFailures: 0 },
      create: { protocol: 'drift', name: 'Drift Staked SOL', isActive: true, lastSuccessfulFetch: new Date() },
    });
  } catch (error) {
    logger.error('Error collecting yield from Drift:', error);
  }
  
  logger.info('Yield collection completed');
  
  // Force garbage collection to free memory
  if (global.gc) {
    global.gc();
    logger.info('Memory cleanup triggered');
  }
}

/**
 * Update volatility metrics
 */
async function updateVolatilityMetrics(): Promise<void> {
  try {
    logger.info('Updating volatility metrics...');
    await volatilityOracle.calculateAllMetrics();
    logger.info('Volatility metrics updated');
    
    // Clean up memory after processing
    if (global.gc) {
      global.gc();
    }
  } catch (error) {
    logger.error('Error updating volatility metrics:', error);
  }
}

/**
 * Detect risk events
 */
async function detectRiskEvents(): Promise<void> {
  try {
    logger.info('Detecting risk events...');
    await riskEngine.detectRiskEvents();
    logger.info('Risk event detection completed');
    
    // Clean up memory after processing
    if (global.gc) {
      global.gc();
    }
  } catch (error) {
    logger.error('Error detecting risk events:', error);
  }
}

/**
 * Worker to process yield collection jobs
 */
const worker = new Worker(
  'yield-collector',
  async (job) => {
    logger.info(`Processing job ${job.id}: ${job.name}`);
    
    switch (job.name) {
      case 'collect-yields':
        await collectYields();
        break;
      case 'update-volatility':
        await updateVolatilityMetrics();
        break;
      case 'detect-risk':
        await detectRiskEvents();
        break;
      default:
        logger.warn(`Unknown job name: ${job.name}`);
    }
  },
  {
    connection,
    concurrency: 1, // Process one job at a time
  }
);

// Worker event handlers
worker.on('completed', (job) => {
  logger.info(`Job ${job.id} completed`);
});

worker.on('failed', (job, err) => {
  logger.error(`Job ${job?.id} failed:`, err);
});

/**
 * Schedule recurring jobs
 */
export async function scheduleYieldCollection(): Promise<void> {
  // Schedule yield collection every N minutes
  await yieldCollectorQueue.add(
    'collect-yields',
    {},
    {
      repeat: {
        every: COLLECTION_INTERVAL * 60 * 1000, // Convert minutes to milliseconds
      },
    }
  );
  
  // Schedule volatility update every 30 minutes
  await yieldCollectorQueue.add(
    'update-volatility',
    {},
    {
      repeat: {
        every: 30 * 60 * 1000,
      },
    }
  );
  
  // Schedule risk detection every hour
  await yieldCollectorQueue.add(
    'detect-risk',
    {},
    {
      repeat: {
        every: 60 * 60 * 1000,
      },
    }
  );
  
  logger.info('Yield collection jobs scheduled', {
    collectionInterval: `${COLLECTION_INTERVAL} minutes`,
  });
}

/**
 * Start the yield collector worker
 */
export async function startYieldCollector(): Promise<void> {
  logger.info('Starting yield collector worker...');
  
  // Schedule jobs
  await scheduleYieldCollection();
  
  // Run initial collection
  await collectYields();
  
  logger.info('Yield collector worker started');
}

// If running directly
if (require.main === module) {
  startYieldCollector()
    .then(() => {
      logger.info('Yield collector running');
    })
    .catch((error) => {
      logger.error('Error starting yield collector:', error);
      process.exit(1);
    });
}

export default worker;
