import webpush from 'web-push';
import { logger } from '../utils/logger';
import { ROUTES } from '../registry/routes';
import { dbReady, pool } from './db';
import { readingNear } from './history';
import { getYieldRoutes, YieldRoute } from './yields';

/**
 * PHONE ALERTS
 * Web push notifications for the routes a device watches. The user turns alerts on in Hermes, the browser asks for
 * permission, and the subscription (endpoint and keys, no wallet, no personal data) is stored with the route ids.
 * Every 10 minutes Hermes checks the watched routes against its own history and sends at most one alert per route
 * and kind a day:
 * - apy-drop: the APY fell 20% or more and at least half a point in a day
 * - better-route: a top rated route for the same token pays a point or more above the watched one
 * - exit-tight: 5% or less of a lending reserve can be withdrawn right now
 * - left-top-rated: the Safety Score fell below 80 since a day ago
 * The VAPID keys that sign the notifications come from VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY when set, otherwise
 * they are created once and kept in the database. Needs DATABASE_URL.
 */

export type AlertKind = 'apy-drop' | 'better-route' | 'exit-tight' | 'left-top-rated';

const TOP_RATED_MIN_SCORE = 80;
const APY_DROP_SHARE = 0.2;
const APY_DROP_MIN = 0.005; // half a percentage point
const BETTER_ROUTE_GAP = 0.01; // one percentage point
const EXIT_TIGHT_WITHDRAWABLE = 0.05;
const CHECK_EVERY_MS = 10 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const SITE_URL = process.env.SITE_URL || 'https://www.hermesagg.xyz';

interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

let vapid: VapidKeys | null = null;

async function vapidKeys(): Promise<VapidKeys | null> {
  if (vapid) return vapid;
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    vapid = { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
    return vapid;
  }
  if (!(await dbReady())) return null;
  try {
    // Create a pair once. Two instances racing keep whichever landed first.
    const generated = webpush.generateVAPIDKeys();
    await pool!.query(`insert into app_settings (key, value) values ('vapid', $1) on conflict (key) do nothing`, [
      JSON.stringify(generated),
    ]);
    const result = await pool!.query(`select value from app_settings where key = 'vapid'`);
    const stored = JSON.parse(result.rows[0].value);
    if (stored?.publicKey && stored?.privateKey) vapid = { publicKey: stored.publicKey, privateKey: stored.privateKey };
  } catch (error) {
    logger.warn(`Could not load alert keys: ${error instanceof Error ? error.message : error}`);
  }
  return vapid;
}

/**
 * The public key browsers subscribe with, or null when alerts are off (no database)
 */
export async function alertsPublicKey(): Promise<string | null> {
  return (await vapidKeys())?.publicKey ?? null;
}

export interface PushSubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

interface Notice {
  title: string;
  body: string;
}

async function send(subscription: PushSubscriptionInput, notice: Notice): Promise<'sent' | 'gone' | 'failed'> {
  const keys = await vapidKeys();
  if (!keys) return 'failed';
  try {
    await webpush.sendNotification(subscription, JSON.stringify({ ...notice, url: `${SITE_URL}/app` }), {
      TTL: 12 * 60 * 60,
      vapidDetails: { subject: SITE_URL, publicKey: keys.publicKey, privateKey: keys.privateKey },
    });
    return 'sent';
  } catch (error: any) {
    // The browser dropped the subscription: forget it
    if (error?.statusCode === 404 || error?.statusCode === 410) return 'gone';
    logger.warn(`Push failed (${error?.statusCode ?? 'no status'}): ${error?.body ?? error?.message ?? error}`);
    return 'failed';
  }
}

const KNOWN_ROUTES = new Set(ROUTES.map((route) => route.id));

/**
 * Store or update a device's subscription and the routes it watches. A new device gets a first notification, so the
 * user sees alerts work right away.
 */
export async function subscribe(subscription: PushSubscriptionInput, routes: string[]): Promise<string[] | null> {
  if (!(await dbReady()) || !(await vapidKeys())) return null;
  const watched = [...new Set(routes.filter((id) => KNOWN_ROUTES.has(id)))];
  const result = await pool!.query(
    `insert into push_subscriptions (endpoint, p256dh, auth, routes) values ($1, $2, $3, $4)
     on conflict (endpoint) do update set p256dh = excluded.p256dh, auth = excluded.auth, routes = excluded.routes, updated_at = now()
     returning (xmax = 0) as inserted`,
    [subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth, watched]
  );
  if (result.rows[0]?.inserted) {
    const outcome = await send(subscription, {
      title: 'Hermes alerts are on',
      body: "You'll hear from Hermes when a route you watch changes. Turn alerts off any time in Hermes.",
    });
    if (outcome === 'gone') await unsubscribe(subscription.endpoint);
  }
  return watched;
}

export async function unsubscribe(endpoint: string): Promise<void> {
  if (!(await dbReady())) return;
  await pool!.query(`delete from push_subscriptions where endpoint = $1`, [endpoint]);
}

const percent = (value: number) => `${(value * 100).toFixed(2)}%`;
const points = (value: number) => (value * 100).toFixed(2);
const isTopRated = (route: YieldRoute) => !!route.safety && route.safety.score >= TOP_RATED_MIN_SCORE && route.risk === 'low';

/**
 * What changed for one route that its watchers should hear about
 */
async function noticesFor(route: YieldRoute, all: YieldRoute[]): Promise<Map<AlertKind, Notice>> {
  const notices = new Map<AlertKind, Notice>();
  const dayAgo = await readingNear(route.id, new Date(Date.now() - DAY_MS));

  if (dayAgo && dayAgo.apy > 0) {
    const drop = dayAgo.apy - route.apy;
    if (drop >= APY_DROP_MIN && drop >= dayAgo.apy * APY_DROP_SHARE) {
      notices.set('apy-drop', {
        title: `${route.name} rate fell`,
        body: `${route.name} (${route.token}) pays ${percent(route.apy)} now, down from ${percent(dayAgo.apy)} a day ago.`,
      });
    }
  }

  const better = all
    .filter((other) => other.id !== route.id && other.token === route.token && other.deposit && isTopRated(other))
    .sort((a, b) => b.apy - a.apy)[0];
  if (better && better.apy - route.apy >= BETTER_ROUTE_GAP) {
    notices.set('better-route', {
      title: `A better ${route.token} route`,
      body: `${better.name} pays ${percent(better.apy)}, ${points(better.apy - route.apy)} points more than ${route.name} (${percent(route.apy)}). ${better.name} is top rated.`,
    });
  }

  if (route.category === 'lending' && typeof route.withdrawable === 'number' && route.withdrawable <= EXIT_TIGHT_WITHDRAWABLE) {
    notices.set('exit-tight', {
      title: `${route.name}: withdrawals may wait`,
      body: `Only ${Math.round(route.withdrawable * 100)}% of the ${route.token} reserve can be withdrawn right now.`,
    });
  }

  if (dayAgo?.safetyScore != null && dayAgo.safetyScore >= TOP_RATED_MIN_SCORE && route.safety && route.safety.score < TOP_RATED_MIN_SCORE) {
    notices.set('left-top-rated', {
      title: `${route.name} left Top rated`,
      body: `Its Safety Score fell to ${route.safety.score} from ${dayAgo.safetyScore}. Open Hermes to see why.`,
    });
  }
  return notices;
}

let lastCheckAt = 0;
let checking = false;

/**
 * Check every watched route and send what changed, at most once per device, route and kind a day.
 * Runs from the rate refresh, every 10 minutes.
 */
export async function checkAlerts(): Promise<void> {
  if (!pool || checking || Date.now() - lastCheckAt < CHECK_EVERY_MS || !(await dbReady()) || !(await vapidKeys())) return;
  checking = true;
  lastCheckAt = Date.now();
  try {
    const subscriptions = (await pool.query(`select endpoint, p256dh, auth, routes from push_subscriptions where cardinality(routes) > 0`)).rows;
    if (subscriptions.length === 0) return;

    const routes = await getYieldRoutes(undefined, true);
    const byId = new Map(routes.map((route) => [route.id, route]));
    const watched = new Set<string>(subscriptions.flatMap((row) => row.routes as string[]));
    const notices = new Map<string, Map<AlertKind, Notice>>();
    for (const id of watched) {
      const route = byId.get(id);
      if (route) notices.set(id, await noticesFor(route, routes));
    }

    let sent = 0;
    devices: for (const row of subscriptions) {
      const subscription: PushSubscriptionInput = { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } };
      for (const routeId of row.routes as string[]) {
        for (const [kind, notice] of notices.get(routeId) ?? new Map<AlertKind, Notice>()) {
          const recent = await pool.query(
            `select 1 from alert_log where endpoint = $1 and route_id = $2 and kind = $3 and sent_at > now() - interval '1 day' limit 1`,
            [row.endpoint, routeId, kind]
          );
          if (recent.rowCount) continue;
          const outcome = await send(subscription, notice);
          if (outcome === 'gone') {
            await unsubscribe(row.endpoint);
            continue devices;
          }
          if (outcome === 'sent') {
            sent += 1;
            await pool.query(`insert into alert_log (endpoint, route_id, kind) values ($1, $2, $3)`, [row.endpoint, routeId, kind]);
          }
        }
      }
    }
    await pool.query(`delete from alert_log where sent_at < now() - interval '30 days'`);
    if (sent > 0) logger.info(`Sent ${sent} alerts`);
  } catch (error) {
    logger.warn(`Alert check failed: ${error instanceof Error ? error.message : error}`);
  } finally {
    checking = false;
  }
}
