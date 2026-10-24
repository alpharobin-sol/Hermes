import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import { logger } from '../utils/logger';
import yieldsRouter from './yields';
import depositRouter from './deposit';
import alertsRouter from './alerts';
import namesRouter from './names';
import portfolioRouter from './portfolio';
import withdrawRouter from './withdraw';
import moveRouter from './move';
import { apiLimiter, expensiveGlobalLimiter, expensivePerClientLimiter, EXPENSIVE_PATHS } from './rate-limit';
import { historyEnabled, lastSnapshot } from '../services/history';

export function createApp(): Express {
  const app = express();

  // Cloudflare then Render sit in front, so the client IP comes from the forwarded headers, not the socket
  app.set('trust proxy', 1);

  // Security middleware
  app.use(helmet());
  
  // CORS
  app.use(cors({
    // Comma-separated list, e.g. "https://www.hermesagg.xyz,https://hermes-three-beta.vercel.app"
    origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',').map((o) => o.trim()) : '*',
    // Credentials can't go with a wildcard origin. Only allow them once CORS_ORIGIN names the sites.
    credentials: !!process.env.CORS_ORIGIN,
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
      // Hermes's own rate history (DATABASE_URL): whether it is on and when it last recorded
      history: { enabled: historyEnabled(), lastSnapshot: lastSnapshot() },
    });
  });
  
  // Rate limits: every /api endpoint per client, and a tighter per-client plus a global cap on the ones that
  // read the chain or call Jupiter. /health is above this line, so UptimeRobot's pings are never limited.
  app.use('/api', apiLimiter);
  app.use(EXPENSIVE_PATHS, expensiveGlobalLimiter, expensivePerClientLimiter);

  // API routes
  app.use('/api/yields', yieldsRouter);
  app.use('/api/deposit', depositRouter);
  app.use('/api/alerts', alertsRouter);
  app.use('/api/names', namesRouter);
  app.use('/api/portfolio', portfolioRouter);
  app.use('/api/withdraw', withdrawRouter);
  app.use('/api/move', moveRouter);
  
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
