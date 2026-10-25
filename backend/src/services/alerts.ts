import webpush from 'web-push';
import { logger } from '../utils/logger';
import { ROUTES } from '../registry/routes';
import { dbReady, pool } from './db';
import { readingNear } from './history';
import { getYieldRoutes, YieldRoute } from './yields';
import { emailAlertsOn, emailTargets, sendAlertEmail } from './email';

/**
 * ALERTS
 * Notifications about the routes a device watches and the routes its wallet holds, by web push to the phone or
 * computer, or by email (services/email.ts). Hermes keeps the device's push subscription or the confirmed email
 * address, the route ids it watches and the route ids its wallet holds. Never the wallet: the browser reads the
 * positions and sends only their route ids. Every 10 minutes Hermes checks those routes against its own history and
 * sends at most one alert per device (or address), route and kind a day:
 * - apy-drop: the APY fell 20% or more and at least half a point in a day
 * - better-route: a top rated route for the same token pays a point or more above a watched route, or half a point
 *   above a held one (the gap Portfolio proposes a Reroute at)
 * - exit-tight: 5% or less of a lending reserve can be withdrawn right now
 * - left-top-rated: the Safety Score fell below 80 since a day ago
 * - depeg: selling a staking token on Jupiter returns 1% or more less than its SOL value in its pool
 * - outflow: 15% or more of the route's deposits, counted in its token, left in a day
 * An alert about a held route says so and opens Portfolio, where Withdraw and Reroute are.
 * The VAPID keys that sign push notifications come from VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY when set, otherwise
 * they are created once and kept in the database. Email needs RESEND_API_KEY. Needs DATABASE_URL.
 */

export type AlertKind = 'apy-drop' | 'better-route' | 'exit-tight' | 'left-top-rated' | 'depeg' | 'outflow';

const TOP_RATED_MIN_SCORE = 80;
const APY_DROP_SHARE = 0.2;
const APY_DROP_MIN = 0.005; // half a percentage point
const BETTER_ROUTE_GAP = 0.01; // one percentage point
const HELD_BETTER_GAP = 0.005; // half a point: Portfolio's Reroute proposal
const EXIT_TIGHT_WITHDRAWABLE = 0.05;
const DEPEG_GAP = 0.01; // a 10-token sale against the pool value. Normal is 0.1% to 0.4%.
const OUTFLOW_SHARE = 0.15;
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

export interface Notice {
  title: string;
  body: string;
  url: string;
}

type Outcome = 'sent' | 'gone' | 'failed';

async function sendPush(subscription: PushSubscriptionInput, notice: Notice): Promise<Outcome> {
  const keys = await vapidKeys();
  if (!keys) return 'failed';
  try {
    await webpush.sendNotification(subscription, JSON.stringify(notice), {
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

// ---------- Push subscriptions ----------

const KNOWN_ROUTES = new Set(ROUTES.map((route) => route.id));
const known = (ids: string[]) => [...new Set(ids.filter((id) => KNOWN_ROUTES.has(id)))];

/**
 * Store or update a device's subscription, the routes it watches and the routes its wallet holds. A new device gets
 * a first notification, so the user sees alerts work right away.
 */
export async function subscribe(
  subscription: PushSubscriptionInput,
  routes: string[],
  held: string[] = []
): Promise<{ routes: string[]; held: string[] } | null> {
  if (!(await dbReady()) || !(await vapidKeys())) return null;
  const watched = known(routes);
  const holding = known(held);
  const result = await pool!.query(
    `insert into push_subscriptions (endpoint, p256dh, auth, routes, held) values ($1, $2, $3, $4, $5)
     on conflict (endpoint) do update set p256dh = excluded.p256dh, auth = excluded.auth, routes = excluded.routes,
       held = excluded.held, updated_at = now()
     returning (xmax = 0) as inserted`,
    [subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth, watched, holding]
  );
  if (result.rows[0]?.inserted) {
    const outcome = await sendPush(subscription, {
      title: 'Hermes alerts are on',
      body: "You'll hear from Hermes when a route you watch or hold changes. Turn alerts off any time in Hermes.",
      url: `${SITE_URL}/app`,
    });
    if (outcome === 'gone') await unsubscribe(subscription.endpoint);
  }
  return { routes: watched, held: holding };
}

export async function unsubscribe(endpoint: string): Promise<void> {
  if (!(await dbReady())) return;
  await pool!.query(`delete from push_subscriptions where endpoint = $1`, [endpoint]);
}

// ---------- What changed ----------

const percent = (value: number) => `${(value * 100).toFixed(2)}%`;
const points = (value: number) => (value * 100).toFixed(2);
const amount = (value: number) =>
  value >= 1e6 ? `${(value / 1e6).toFixed(2)}M` : value >= 1e3 ? `${(value / 1e3).toFixed(1)}K` : value.toFixed(value >= 10 ? 0 : 2);
const isTopRated = (route: YieldRoute) => !!route.safety && route.safety.score >= TOP_RATED_MIN_SCORE && route.risk === 'low';

/**
 * What Hermes sees for one route now, before it is worded for a watcher or a holder
 */
export interface Signals {
  apyDrop?: { before: number };
  better?: YieldRoute; // the best paying top rated route for the same token, when it pays more
  exitTight?: boolean;
  leftTopRated?: { before: number };
  depeg?: number; // how far below its pool value a sale lands
  outflow?: { before: number; now: number };
}

export async function signalsFor(route: YieldRoute, all: YieldRoute[]): Promise<Signals> {
  const signals: Signals = {};
  const [dayAgo, latest] = await Promise.all([readingNear(route.id, new Date(Date.now() - DAY_MS)), readingNear(route.id, new Date())]);

  if (dayAgo && dayAgo.apy > 0) {
    const drop = dayAgo.apy - route.apy;
    if (drop >= APY_DROP_MIN && drop >= dayAgo.apy * APY_DROP_SHARE) signals.apyDrop = { before: dayAgo.apy };
  }

  const better = all
    .filter((other) => other.id !== route.id && other.token === route.token && other.deposit && isTopRated(other))
    .sort((a, b) => b.apy - a.apy)[0];
  if (better && better.apy > route.apy) signals.better = better;

  if (route.category === 'lending' && typeof route.withdrawable === 'number' && route.withdrawable <= EXIT_TIGHT_WITHDRAWABLE) {
    signals.exitTight = true;
  }

  if (dayAgo?.safetyScore != null && dayAgo.safetyScore >= TOP_RATED_MIN_SCORE && route.safety && route.safety.score < TOP_RATED_MIN_SCORE) {
    signals.leftTopRated = { before: dayAgo.safetyScore };
  }

  if (route.category === 'liquid-staking' && typeof route.exitCost === 'number' && route.exitCost >= DEPEG_GAP) {
    signals.depeg = route.exitCost;
  }

  // Two readings a day apart, not the same one found twice
  if (dayAgo?.deposits && latest?.deposits != null && latest.at - dayAgo.at >= DAY_MS / 2) {
    if (dayAgo.deposits - latest.deposits >= dayAgo.deposits * OUTFLOW_SHARE) signals.outflow = { before: dayAgo.deposits, now: latest.deposits };
  }
  return signals;
}

/**
 * The signals in words: for someone watching the route, or someone holding it (which says so and opens Portfolio)
 */
export function noticesFor(route: YieldRoute, signals: Signals, held: boolean): Map<AlertKind, Notice> {
  const notices = new Map<AlertKind, Notice>();
  const url = `${SITE_URL}${held ? '/portfolio' : '/app'}`;
  const your = held ? 'Your ' : '';
  const name = route.name;

  if (signals.apyDrop) {
    notices.set('apy-drop', {
      title: `${your}${name} rate fell`,
      body: held
        ? `Your ${route.token} in ${name} earns ${percent(route.apy)} now, down from ${percent(signals.apyDrop.before)} a day ago.`
        : `${name} (${route.token}) pays ${percent(route.apy)} now, down from ${percent(signals.apyDrop.before)} a day ago.`,
      url,
    });
  }

  const better = signals.better;
  if (better && better.apy - route.apy >= (held ? HELD_BETTER_GAP : BETTER_ROUTE_GAP)) {
    const gap = points(better.apy - route.apy);
    notices.set(
      'better-route',
      held
        ? {
            title: `${better.name} pays more than your ${name}`,
            body: `${better.name} pays ${percent(better.apy)}, ${gap} points more than ${name} (${percent(route.apy)}). It's top rated. Reroute from Portfolio.`,
            url,
          }
        : {
            title: `A better ${route.token} route`,
            body: `${better.name} pays ${percent(better.apy)}, ${gap} points more than ${name} (${percent(route.apy)}). ${better.name} is top rated.`,
            url,
          }
    );
  }

  if (signals.exitTight && typeof route.withdrawable === 'number') {
    notices.set('exit-tight', {
      title: `${your}${name}: withdrawals may wait`,
      body: `Only ${Math.round(route.withdrawable * 100)}% of ${route.curator ? 'the vault' : `the ${route.token} reserve`} can be withdrawn right now.`,
      url,
    });
  }

  if (signals.leftTopRated && route.safety) {
    notices.set('left-top-rated', {
      title: `${your}${name} left Top rated`,
      body: `Its Safety Score fell to ${route.safety.score} from ${signals.leftTopRated.before}. ${held ? 'See why in Hermes, and withdraw or reroute from Portfolio.' : 'Open Hermes to see why.'}`,
      url,
    });
  }

  if (signals.depeg !== undefined) {
    const token = route.receipt ?? `${name}'s token`;
    notices.set('depeg', {
      title: `${your}${token} trades below its value`,
      body: `Selling ${token} on Jupiter returns ${percent(signals.depeg)} less than its SOL value in the ${name} pool.${held ? ' A sale now would take that loss.' : ''}`,
      url,
    });
  }

  if (signals.outflow) {
    const { before, now } = signals.outflow;
    notices.set('outflow', {
      title: held ? `Your ${name}: deposits are leaving` : `Deposits are leaving ${name}`,
      body: `${Math.round(((before - now) / before) * 100)}% of the ${route.token} in ${name} left in a day, from ${amount(before)} to ${amount(now)} ${route.token}.`,
      url,
    });
  }
  return notices;
}

// ---------- The check ----------

interface Target {
  key: string; // the alert log's device: the push endpoint, or mail: and the address
  push?: PushSubscriptionInput;
  email?: { address: string; token: string };
  routes: string[];
  held: string[];
}

let lastCheckAt = 0;
let checking = false;

/**
 * Check every watched and held route and send what changed, at most once per device, route and kind a day.
 * Runs from the rate refresh, every 10 minutes.
 */
export async function checkAlerts(): Promise<void> {
  if (!pool || checking || Date.now() - lastCheckAt < CHECK_EVERY_MS || !(await dbReady())) return;
  const pushOn = !!(await vapidKeys());
  if (!pushOn && !emailAlertsOn()) return;
  checking = true;
  lastCheckAt = Date.now();
  try {
    const targets: Target[] = [];
    if (pushOn) {
      const rows = (await pool.query(`select endpoint, p256dh, auth, routes, held from push_subscriptions where cardinality(routes) + cardinality(held) > 0`)).rows;
      for (const row of rows) {
        targets.push({ key: row.endpoint, push: { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } }, routes: row.routes, held: row.held });
      }
    }
    // An address on two devices shares one log, so it hears about each change once
    for (const target of await emailTargets()) {
      targets.push({ key: `mail:${target.address}`, email: { address: target.address, token: target.token }, routes: target.routes, held: target.held });
    }
    if (targets.length > 0) await deliver(targets);
    await pool.query(`delete from alert_log where sent_at < now() - interval '30 days'`);
  } catch (error) {
    logger.warn(`Alert check failed: ${error instanceof Error ? error.message : error}`);
  } finally {
    checking = false;
  }
}

async function deliver(targets: Target[]): Promise<void> {
  const routes = await getYieldRoutes(undefined, true);
  const byId = new Map(routes.map((route) => [route.id, route]));
  const signals = new Map<string, Signals>();
  for (const id of new Set(targets.flatMap((target) => [...target.routes, ...target.held]))) {
    const route = byId.get(id);
    if (route) signals.set(id, await signalsFor(route, routes));
  }

  let sent = 0;
  const log = (key: string, routeId: string, kind: AlertKind) =>
    pool!.query(`insert into alert_log (endpoint, route_id, kind) values ($1, $2, $3)`, [key, routeId, kind]);

  targets: for (const target of targets) {
    // What this device hasn't heard today. A route both watched and held is worded as held.
    const fresh: { routeId: string; kind: AlertKind; notice: Notice }[] = [];
    for (const routeId of new Set([...target.held, ...target.routes])) {
      const route = byId.get(routeId);
      const found = signals.get(routeId);
      if (!route || !found) continue;
      for (const [kind, notice] of noticesFor(route, found, target.held.includes(routeId))) {
        const recent = await pool!.query(
          `select 1 from alert_log where endpoint = $1 and route_id = $2 and kind = $3 and sent_at > now() - interval '1 day' limit 1`,
          [target.key, routeId, kind]
        );
        if (!recent.rowCount) fresh.push({ routeId, kind, notice });
      }
    }
    if (fresh.length === 0) continue;

    // Email: everything in one message
    if (target.email) {
      if (await sendAlertEmail(target.email.address, target.email.token, fresh.map((item) => item.notice))) {
        sent += fresh.length;
        for (const item of fresh) await log(target.key, item.routeId, item.kind);
      }
      continue;
    }

    // Push: one notification each
    for (const item of fresh) {
      const outcome = await sendPush(target.push!, item.notice);
      if (outcome === 'gone') {
        await unsubscribe(target.push!.endpoint);
        continue targets;
      }
      if (outcome === 'sent') {
        sent += 1;
        await log(target.key, item.routeId, item.kind);
      }
    }
  }
  if (sent > 0) logger.info(`Sent ${sent} alerts`);
}
