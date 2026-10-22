import dotenv from 'dotenv';
import { createApp } from './api';
import { logger } from './utils/logger';
import { workersEnabled } from './config/runtime';
import { yieldRefresher } from './workers/yield-refresher';
import signalMonitor from './workers/signalMonitor';

// Load environment variables
dotenv.config();

const PORT = process.env.PORT || 3000;

async function main() {
  try {
    logger.info('Starting HERMES backend...');
    
    // Create Express app
    const app = createApp();
    
    // Start server
    const server = app.listen(PORT, () => {
      logger.info(`Server running on port ${PORT}`);
      logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
    });
    
    // Yield refresher auto-starts on import (every 10 minutes). It only warms the in-memory cache.
    logger.info('Yield refresher status:', yieldRefresher.getStatus());
    
    if (workersEnabled()) {
      // Imported lazily: these modules open a Redis connection as soon as they load
      logger.info('Starting background workers...');
      const [{ startYieldCollector }, { startDPOWorker }] = await Promise.all([
        import('./workers/yieldCollector'),
        import('./workers/dpoWorker'),
      ]);
      await Promise.all([
        startYieldCollector(),
        startDPOWorker(),
      ]);
      
      // Signal monitor auto-starts on import (every 5 minutes)
      logger.info('Signal monitor status:', signalMonitor.getStatus());
      logger.info('🚨 Signal Engine activated - monitoring for risks');
    } else {
      logger.info('Background workers disabled (ENABLE_WORKERS=false). Running API only.');
    }
    
    logger.info('HERMES backend started successfully');
    
    // Graceful shutdown
    process.on('SIGTERM', async () => {
      logger.info('SIGTERM signal received: closing HTTP server');
      server.close(() => {
        logger.info('HTTP server closed');
        process.exit(0);
      });
    });
    
    process.on('SIGINT', async () => {
      logger.info('SIGINT signal received: closing HTTP server');
      server.close(() => {
        logger.info('HTTP server closed');
        process.exit(0);
      });
    });
  } catch (error) {
    logger.error('Failed to start HERMES backend:', error);
    process.exit(1);
  }
}

main();
