import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import { logger } from '../utils/logger';
import yieldsRouter from './yields';
import emissionsRouter from './emissions';
import signalsRouter from './signals';
import depositRouter from './deposit';

export function createApp(): Express {
  const app = express();
  
  // Security middleware
  app.use(helmet());
  
  // CORS
  app.use(cors({
    // Comma-separated list, e.g. "https://www.hermesagg.xyz,https://hermes-three-beta.vercel.app"
    origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',').map((o) => o.trim()) : '*',
    credentials: true,
  }));
  
  // Compression
  app.use(compression());
  
  // Body parsing
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  
  // Request logging
  app.use((req: Request, _res: Response, next: NextFunction) => {
    logger.info(`${req.method} ${req.path}`, {
      query: req.query,
      ip: req.ip,
    });
    next();
  });
  
  // Health check
  app.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    });
  });
  
  // API routes
  logger.info(`Mounting yields router on /api/yields and /api`);
  app.use('/api/yields', yieldsRouter); // Primary mount point
  app.use('/api', yieldsRouter);         // Also mount at /api for backwards compat
  logger.info(`Yields router mounted successfully`);
  
  logger.info(`Mounting emissions router on /api/emissions`);
  app.use('/api/emissions', emissionsRouter);
  logger.info(`Emissions router mounted successfully`);
  
  logger.info(`Mounting signals router on /api/signals`);
  app.use('/api/signals', signalsRouter);
  logger.info(`Signals router mounted successfully`);
  
  logger.info(`Mounting deposit router on /api/deposit`);
  app.use('/api/deposit', depositRouter);
  logger.info(`Deposit router mounted successfully`);
  
  // Debug: List all registered routes
  app._router.stack.forEach((middleware: any) => {
    if (middleware.route) {
      logger.info(`Registered route: ${middleware.route.path}`);
    } else if (middleware.name === 'router') {
      middleware.handle.stack.forEach((handler: any) => {
        if (handler.route) {
          logger.info(`Registered nested route: ${handler.route.path}`);
        }
      });
    }
  });
  
  // 404 handler
  app.use((_req: Request, res: Response) => {
    res.status(404).json({
      success: false,
      error: 'Route not found',
    });
  });
  
  // Error handler
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    logger.error('Unhandled error:', err);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  });
  
  return app;
}

export default createApp;
