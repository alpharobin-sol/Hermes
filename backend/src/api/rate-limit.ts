import type { Request, Response } from 'express';
import { rateLimit, ipKeyGenerator } from 'express-rate-limit';

/**
 * RATE LIMITS
 * Hermes runs on a free tier with a shared RPC and a shared Jupiter allowance. The quote, deposit, withdraw, move,
 * portfolio and name endpoints each read the chain or call Jupiter, so a flood would burn that budget and slow the
 * site for everyone. These limits cap how fast those endpoints can be hit.
 *
 * Two layers, because one IP's limit is only as honest as the IP:
 * - Per client: by Cloudflare's CF-Connecting-IP (the real visitor behind Cloudflare, which Cloudflare sets and a
 *   client can't forge through it), falling back to the socket IP. Stops one visitor from hogging the budget.
 * - Global: a total cap across everyone on the endpoints that hit an upstream, so the budget holds even against
 *   traffic spread over many IPs or sent straight to the origin with a forged header.
 * All limits are per minute and tunable by env. Preflights (OPTIONS) and /health (UptimeRobot) are never limited.
 */

const WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_SEC || 60) * 1000;
const PER_IP = Number(process.env.RATE_LIMIT_PER_IP || 240);
const EXPENSIVE_PER_IP = Number(process.env.RATE_LIMIT_EXPENSIVE_PER_IP || 60);
const EXPENSIVE_GLOBAL = Number(process.env.RATE_LIMIT_EXPENSIVE_GLOBAL || 1200);

// The visitor behind Cloudflare, or the socket IP otherwise. ipKeyGenerator collapses IPv6 to a /64 so a single
// client can't walk a whole range to get a fresh limit each request.
function clientKey(req: Request): string {
  const forwarded = req.headers['cf-connecting-ip'];
  const cfip = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return ipKeyGenerator(cfip || req.ip || 'unknown');
}

function tooMany(_req: Request, res: Response) {
  return res.status(429).json({ success: false, error: 'Too many requests. Please slow down and try again shortly.' });
}

const base = {
  windowMs: WINDOW_MS,
  standardHeaders: true as const,
  legacyHeaders: false,
  handler: tooMany,
  // A browser sends an OPTIONS preflight before each POST; it is cheap and shouldn't eat the budget
  skip: (req: Request) => req.method === 'OPTIONS',
};

// Every /api endpoint, per client
export const apiLimiter = rateLimit({ ...base, limit: PER_IP, keyGenerator: clientKey });

// The endpoints that read the chain or call Jupiter, per client (tighter than the all-/api limit)
export const expensivePerClientLimiter = rateLimit({ ...base, limit: EXPENSIVE_PER_IP, keyGenerator: clientKey });

// The same endpoints, one shared bucket across everyone, so the upstream budget holds whatever the traffic's shape
export const expensiveGlobalLimiter = rateLimit({
  ...base,
  limit: EXPENSIVE_GLOBAL,
  keyGenerator: () => 'global',
  // A single constant key is the point here, not a misconfiguration
  validate: { keyGeneratorIpFallback: false },
});

// Endpoints that hit an upstream on most requests
export const EXPENSIVE_PATHS = ['/api/deposit', '/api/names', '/api/withdraw', '/api/move', '/api/portfolio'];
