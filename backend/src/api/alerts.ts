import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { logger } from '../utils/logger';
import { alertsPublicKey, subscribe, unsubscribe } from '../services/alerts';
import { confirmEmail, emailAlertsOn, emailStatus, saveEmailLists, startEmail, unsubscribeEmail } from '../services/email';
import { dbReady } from '../services/db';

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

const listsSchema = {
  routes: z.array(z.string().max(64)).max(40),
  held: z.array(z.string().max(64)).max(40).default([]),
};
// The email alerts token: 24 random bytes, base64url
const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{32}$/);

const EMAIL_OFF = 'Email alerts are off right now.';
const START_ERRORS = {
  off: [503, EMAIL_OFF],
  'address-limit': [429, 'Hermes just sent a link to this address. Check your inbox and spam folder, or try again in a few minutes.'],
  'ip-limit': [429, 'Too many sign-ups from here. Try again in an hour.'],
  send: [502, "Hermes couldn't send the email. Check the address, or try again shortly."],
} as const;

// Cloudflare sits in front of Render: the visitor's address is in CF-Connecting-IP
const clientIp = (req: Request) => req.header('cf-connecting-ip') || req.ip || 'unknown';

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
 * GET /api/alerts/channels
 * The ways alerts can arrive right now: this browser's notifications and email
 */
router.get('/channels', async (_req: Request, res: Response) => {
  const [push, database] = await Promise.all([alertsPublicKey(), dbReady()]);
  return res.json({ success: true, push: !!push, email: emailAlertsOn() && database });
});

/**
 * POST /api/alerts/email/start { token?, email, routes, held }
 * Start email alerts for an address: Hermes emails it a link, and alerts begin once the link is opened. Again with
 * the same token and address, it sends the link again.
 */
router.post('/email/start', async (req: Request, res: Response) => {
  const parsed = z
    .object({ token: tokenSchema.nullish(), email: z.string().trim().email().max(254), ...listsSchema })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, error: 'Check the email address.' });
  try {
    const result = await startEmail(parsed.data.token ?? null, parsed.data.email, parsed.data.routes, parsed.data.held, clientIp(req));
    if ('error' in result) {
      const [status, error] = START_ERRORS[result.error];
      return res.status(status).json({ success: false, error });
    }
    return res.json({ success: true, ...result });
  } catch (error) {
    logger.error('Email alerts start failed:', error);
    return res.status(500).json({ success: false, error: 'Could not start email alerts. Try again shortly.' });
  }
});

/**
 * POST /api/alerts/email/save { token, routes, held }
 * New lists for this device's address. 404 when Hermes no longer has it.
 */
router.post('/email/save', async (req: Request, res: Response) => {
  const parsed = z.object({ token: tokenSchema, ...listsSchema }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, error: 'Invalid request' });
  try {
    const saved = await saveEmailLists(parsed.data.token, parsed.data.routes, parsed.data.held);
    if (!saved) return res.status(404).json({ success: false, error: 'Email alerts are off for this address. Add it again in Settings.' });
    return res.json({ success: true, ...saved });
  } catch (error) {
    logger.error('Email alerts save failed:', error);
    return res.status(500).json({ success: false, error: 'Could not update email alerts. Try again shortly.' });
  }
});

/**
 * POST /api/alerts/email/confirm { token }
 * The link in the confirmation email, opened on the site
 */
router.post('/email/confirm', async (req: Request, res: Response) => {
  const parsed = z.object({ token: tokenSchema }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, error: 'This link is broken. Add your email again in Settings.' });
  try {
    if (!(await confirmEmail(parsed.data.token))) {
      return res.status(404).json({ success: false, error: 'This link has expired. Add your email again in Settings.' });
    }
    return res.json({ success: true, confirmed: true });
  } catch (error) {
    logger.error('Email alerts confirm failed:', error);
    return res.status(500).json({ success: false, error: 'Could not confirm. Try the link again shortly.' });
  }
});

/**
 * POST /api/alerts/email/unsubscribe { token }
 * Stop the emails: from Settings, or the link at the end of every alert email
 */
router.post('/email/unsubscribe', async (req: Request, res: Response) => {
  const parsed = z.object({ token: tokenSchema }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, error: 'This link is broken.' });
  try {
    await unsubscribeEmail(parsed.data.token);
    return res.json({ success: true });
  } catch (error) {
    logger.error('Email alerts unsubscribe failed:', error);
    return res.status(500).json({ success: false, error: 'Could not stop the emails. Try again shortly.' });
  }
});

/**
 * POST /api/alerts/email/one-click?token=...
 * The mail app's Unsubscribe button (RFC 8058): it posts here and expects a plain 200
 */
router.post('/email/one-click', async (req: Request, res: Response) => {
  const parsed = tokenSchema.safeParse(req.query.token);
  if (!parsed.success) return res.sendStatus(400);
  try {
    await unsubscribeEmail(parsed.data);
    return res.sendStatus(200);
  } catch (error) {
    logger.error('Email one-click unsubscribe failed:', error);
    return res.sendStatus(500);
  }
});

/**
 * GET /api/alerts/email/:token
 * Whether the address is confirmed yet. The browser asks while it waits. 404 when Hermes no longer has it.
 */
router.get('/email/:token', async (req: Request, res: Response) => {
  const parsed = tokenSchema.safeParse(req.params.token);
  if (!parsed.success) return res.status(400).json({ success: false, error: 'Invalid request' });
  try {
    const status = await emailStatus(parsed.data);
    if (!status) return res.status(404).json({ success: false, error: 'Not found' });
    return res.json({ success: true, ...status });
  } catch (error) {
    logger.error('Email alerts status failed:', error);
    return res.status(500).json({ success: false, error: 'Could not check. Try again shortly.' });
  }
});

export default router;
