import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { logger } from '../utils/logger';
import {
  alertsPublicKey,
  saveTelegram,
  subscribe,
  telegramLink,
  telegramLinked,
  unlinkTelegram,
  unsubscribe,
} from '../services/alerts';

const router = Router();

// Push services Hermes will send to: Chrome and Android (Google), Firefox (Mozilla), Safari and iPhone (Apple),
// Edge (Microsoft). Anything else is refused, so the API can't be made to post to arbitrary servers.
const PUSH_HOSTS = ['fcm.googleapis.com', 'android.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com'];
const PUSH_HOST_SUFFIXES = ['.notify.windows.com', '.push.apple.com'];

function isPushService(endpoint: string): boolean {
  // Local tests only: ALERTS_ANY_ENDPOINT=true accepts any https endpoint
  if (process.env.ALERTS_ANY_ENDPOINT === 'true') return true;
  const host = new URL(endpoint).hostname;
  return PUSH_HOSTS.includes(host) || PUSH_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

const endpointSchema = z.string().url().startsWith('https://').max(1000).refine(isPushService, 'Unknown push service');

const subscribeSchema = z.object({
  subscription: z.object({
    endpoint: endpointSchema,
    keys: z.object({ p256dh: z.string().min(16).max(200), auth: z.string().min(8).max(100) }),
  }),
  routes: z.array(z.string().max(64)).max(40),
  held: z.array(z.string().max(64)).max(40).default([]), // the routes the device's wallet holds, never the wallet
});

// A Telegram link token: Telegram's start parameter allows letters, digits, _ and -
const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{24,64}$/);

const telegramSchema = z.object({
  token: tokenSchema.nullish(),
  routes: z.array(z.string().max(64)).max(40),
  held: z.array(z.string().max(64)).max(40).default([]),
});

const TELEGRAM_OFF = 'Telegram alerts are off right now.';

/**
 * GET /api/alerts/key
 * The public key a browser subscribes with. 503 when alerts are off (no database).
 */
router.get('/key', async (_req: Request, res: Response) => {
  const publicKey = await alertsPublicKey();
  if (!publicKey) return res.status(503).json({ success: false, error: 'Alerts are off right now.' });
  return res.json({ success: true, publicKey });
});

/**
 * POST /api/alerts/subscribe { subscription, routes }
 * Store this device's push subscription and the route ids it watches (the full list, replacing the last one)
 */
router.post('/subscribe', async (req: Request, res: Response) => {
  const parsed = subscribeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, error: 'Invalid subscription' });
  try {
    const saved = await subscribe(parsed.data.subscription, parsed.data.routes, parsed.data.held);
    if (!saved) return res.status(503).json({ success: false, error: 'Alerts are off right now.' });
    return res.json({ success: true, ...saved });
  } catch (error) {
    logger.error('Alert subscribe failed:', error);
    return res.status(500).json({ success: false, error: 'Could not turn alerts on. Try again shortly.' });
  }
});

/**
 * POST /api/alerts/unsubscribe { endpoint }
 * Forget this device. Hermes sends it nothing more.
 */
router.post('/unsubscribe', async (req: Request, res: Response) => {
  const parsed = z.object({ endpoint: endpointSchema }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, error: 'Invalid endpoint' });
  try {
    await unsubscribe(parsed.data.endpoint);
    return res.json({ success: true });
  } catch (error) {
    logger.error('Alert unsubscribe failed:', error);
    return res.status(500).json({ success: false, error: 'Could not turn alerts off. Try again shortly.' });
  }
});

/**
 * POST /api/alerts/telegram { token?, routes, held }
 * Save what this device wants on Telegram. Without a token it starts a link, which the user opens in Telegram:
 * Herald ties the chat to it. Returns the token, whether a chat has it yet, and the link.
 */
router.post('/telegram', async (req: Request, res: Response) => {
  const parsed = telegramSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, error: 'Invalid request' });
  try {
    const saved = await saveTelegram(parsed.data.token ?? null, parsed.data.routes, parsed.data.held);
    if (!saved) return res.status(503).json({ success: false, error: TELEGRAM_OFF });
    return res.json({ success: true, ...saved, url: telegramLink(saved.token) });
  } catch (error) {
    logger.error('Telegram alerts save failed:', error);
    return res.status(500).json({ success: false, error: 'Could not update Telegram alerts. Try again shortly.' });
  }
});

/**
 * GET /api/alerts/telegram/:token
 * Whether the link has been opened in Telegram yet. The browser asks while it waits.
 */
router.get('/telegram/:token', async (req: Request, res: Response) => {
  const parsed = tokenSchema.safeParse(req.params.token);
  if (!parsed.success) return res.status(400).json({ success: false, error: 'Invalid link' });
  try {
    const linked = await telegramLinked(parsed.data);
    if (linked === null) return res.status(503).json({ success: false, error: TELEGRAM_OFF });
    return res.json({ success: true, linked });
  } catch (error) {
    logger.error('Telegram alerts status failed:', error);
    return res.status(500).json({ success: false, error: 'Could not check Telegram. Try again shortly.' });
  }
});

/**
 * POST /api/alerts/telegram/unlink { token }
 * Stop Telegram alerts for this device. Herald tells the chat.
 */
router.post('/telegram/unlink', async (req: Request, res: Response) => {
  const parsed = z.object({ token: tokenSchema }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, error: 'Invalid link' });
  try {
    await unlinkTelegram(parsed.data.token);
    return res.json({ success: true });
  } catch (error) {
    logger.error('Telegram alerts unlink failed:', error);
    return res.status(500).json({ success: false, error: 'Could not turn Telegram alerts off. Try again shortly.' });
  }
});

export default router;
