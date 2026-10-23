import dotenv from 'dotenv';

// Load environment variables before anything reads them
dotenv.config();

import { createApp } from './api';
import { logger } from './utils/logger';
import { solanaNetwork } from './config/runtime';
import { startRateRefresh } from './services/yields';
import { checkAlerts } from './services/alerts';

const PORT = process.env.PORT || 3000;

function main() {
  logger.info('Starting HERMES backend...');

  const app = createApp();
  const server = app.listen(PORT, () => {
    logger.info(`Server running on port ${PORT} (deposits on ${solanaNetwork()})`);
  });

  const refreshTimer = startRateRefresh();
  // Phone alerts for watched routes. The check runs every 10 minutes and needs DATABASE_URL.
  const alertsTimer = setInterval(() => checkAlerts(), 60 * 1000);

  const shutdown = (signal: string) => {
    logger.info(`${signal} received: closing HTTP server`);
    clearInterval(refreshTimer);
    clearInterval(alertsTimer);
    server.close(() => {
      logger.info('HTTP server closed');
      process.exit(0);
    });
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main();
