import { randomBytes } from 'crypto';
import webpush from 'web-push';
import { Api, GrammyError } from 'grammy';
import { logger } from '../utils/logger';
import { ROUTES } from '../registry/routes';
import { dbReady, pool } from './db';
import { readingNear } from './history';
import { getYieldRoutes, YieldRoute } from './yields';

/**
 * ALERTS
 * Notifications about the routes a device watches and the routes its wallet holds, by web push to the device and by
 * Telegram through Herald. Hermes keeps the device's push subscription (or its Telegram chat), the route ids it
 * watches and the route ids its wallet holds. Never the wallet: the browser reads the positions and sends only
 * their route ids. Every 10 minutes Hermes checks those routes against its own history and sends at most one alert
 * per device, route and kind a day:
 * - apy-drop: the APY fell 20% or more and at least half a point in a day
 * - better-route: a top rated route for the same token pays a point or more above a watched route, or half a point
 *   above a held one (the gap Portfolio proposes a Reroute at)
 * - exit-tight: 5% or less of a lending reserve can be withdrawn right now
 * - left-top-rated: the Safety Score fell below 80 since a day ago
 * - depeg: selling a staking token on Jupiter returns 1% or more less than its SOL value in its pool
 * - outflow: 15% or more of the route's deposits, counted in its token, left in a day
 * An alert about a held route says so and opens Portfolio, where Withdraw and Reroute are.
 * The VAPID keys that sign push notifications come from VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY when set, otherwise
 * they are created once and kept in the database. Telegram needs TELEGRAM_BOT_TOKEN, Herald's. Needs DATABASE_URL.
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
const BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME || 'HermesAggHeraldBot';

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

// ---------- Telegram ----------

let telegramClient: Api | null | undefined;

function telegram(): Api | null {
  if (telegramClient === undefined) telegramClient = process.env.TELEGRAM_BOT_TOKEN ? new Api(process.env.TELEGRAM_BOT_TOKEN) : null;
  return telegramClient;
}

export function telegramAlertsOn(): boolean {
  return telegram() !== null;
}

async function sendTelegram(chatId: number, notice: Notice): Promise<Outcome> {
  const api = telegram();
  if (!api) return 'failed';
  try {
    await api.sendMessage(chatId, `${notice.title}\n\n${notice.body}\n\n${notice.url}`, { link_preview_options: { is_disabled: true } });
    return 'sent';
  } catch (error) {
    // The user blocked Herald or deleted the chat: forget it
    if (error instanceof GrammyError && (error.error_code === 403 || /chat not found/i.test(error.description))) return 'gone';
    logger.warn(`Telegram alert failed: ${error instanceof Error ? error.message : error}`);
    return 'failed';
  }
}

export function telegramLink(token: string): string {
  return `https://t.me/${BOT_USERNAME}?start=${token}`;
}

export interface TelegramAlerts {
  token: string;
  linked: boolean;
  routes: string[];
  held: string[];
}

/**
 * Save what a device wants on Telegram. Without a token, or with one Hermes no longer has, it starts a new link,
 * which Herald completes when the user opens it in Telegram.
 */
export async function saveTelegram(token: string | null, routes: string[], held: string[]): Promise<TelegramAlerts | null> {
  if (!telegramAlertsOn() || !(await dbReady())) return null;
  const lists = [known(routes), known(held)];
  if (token) {
    const updated = await pool!.query(
      `update telegram_alerts set routes = $2, held = $3, updated_at = now() where token = $1 returning chat_id`,
      [token, ...lists]
    );
    if (updated.rowCount) return { token, linked: updated.rows[0].chat_id !== null, routes: lists[0], held: lists[1] };
  }
  const fresh = randomBytes(24).toString('base64url');
  await pool!.query(`insert into telegram_alerts (token, routes, held) values ($1, $2, $3)`, [fresh, ...lists]);
  return { token: fresh, linked: false, routes: lists[0], held: lists[1] };
}

export async function telegramLinked(token: string): Promise<boolean | null> {
  if (!telegramAlertsOn() || !(await dbReady())) return null;
  const result = await pool!.query(`select chat_id from telegram_alerts where token = $1`, [token]);
  return result.rowCount ? result.rows[0].chat_id !== null : false;
}

/**
 * Turn Telegram alerts off from Hermes. Herald says so in the chat.
 */
export async function unlinkTelegram(token: string): Promise<void> {
  if (!(await dbReady())) return;
  const result = await pool!.query(`delete from telegram_alerts where token = $1 returning chat_id`, [token]);
  const chatId = result.rows[0]?.chat_id;
  if (chatId != null) {
    await telegram()
      ?.sendMessage(Number(chatId), 'Hermes alerts are off for this chat. Link Telegram again from Settings in Hermes any time.')
      .catch(() => {});
  }
}

/**
 * Herald, when someone opens a link from Hermes: tie the chat to it. A chat belongs to one link at a time, so
 * linking from a second device moves it there. Null when the link is unknown.
 */
export async function linkTelegramChat(token: string, chatId: number): Promise<{ routes: string[]; held: string[] } | null> {
  if (!(await dbReady())) return null;
  // Only when the new link exists: an expired one leaves the chat's current alerts alone
  await pool!.query(
    `update telegram_alerts set chat_id = null
     where chat_id = $1 and token <> $2 and exists (select 1 from telegram_alerts where token = $2)`,
    [chatId, token]
  );
  const result = await pool!.query(
    `update telegram_alerts set chat_id = $2, updated_at = now() where token = $1 returning routes, held`,
    [token, chatId]
  );
  return result.rowCount ? { routes: result.rows[0].routes, held: result.rows[0].held } : null;
}

// Herald's /stop. True when the chat had alerts.
export async function unlinkTelegramChat(chatId: number): Promise<boolean> {
  if (!(await dbReady())) return false;
  return !!(await pool!.query(`delete from telegram_alerts where chat_id = $1`, [chatId])).rowCount;
}

// Herald's /alerts
export async function telegramWatching(chatId: number): Promise<{ routes: string[]; held: string[] } | null> {
  if (!(await dbReady())) return null;
  const result = await pool!.query(`select routes, held from telegram_alerts where chat_id = $1`, [chatId]);
  return result.rowCount ? { routes: result.rows[0].routes, held: result.rows[0].held } : null;
}

// ---------- Push subscriptions ----------

const KNOWN_ROUTES = new Set(ROUTES.map((route) => route.id));
const known = (ids: string[]) => [...new Set(ids.filter((id) => KNOWN_ROUTES.has(id)))];

export function routeNames(ids: string[]): string[] {
  return ids.map((id) => {
    const route = ROUTES.find((r) => r.id === id);
    return route ? `${route.name} (${route.token})` : id;
  });
}

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
  key: string; // the alert log's device: the push endpoint, or tg: and the chat id
  push?: PushSubscriptionInput;
  chatId?: number;
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
  if (!pushOn && !telegramAlertsOn()) return;
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
    if (telegramAlertsOn()) {
      const rows = (await pool.query(`select chat_id, routes, held from telegram_alerts where chat_id is not null and cardinality(routes) + cardinality(held) > 0`)).rows;
      for (const row of rows) targets.push({ key: `tg:${row.chat_id}`, chatId: Number(row.chat_id), routes: row.routes, held: row.held });
    }
    if (targets.length > 0) await deliver(targets);
    await pool.query(`delete from alert_log where sent_at < now() - interval '30 days'`);
    // Links never opened in Telegram
    await pool.query(`delete from telegram_alerts where chat_id is null and created_at < now() - interval '1 day'`);
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
  targets: for (const target of targets) {
    // A route both watched and held is worded as held
    for (const routeId of new Set([...target.held, ...target.routes])) {
      const route = byId.get(routeId);
      const found = signals.get(routeId);
      if (!route || !found) continue;
      for (const [kind, notice] of noticesFor(route, found, target.held.includes(routeId))) {
        const recent = await pool!.query(
          `select 1 from alert_log where endpoint = $1 and route_id = $2 and kind = $3 and sent_at > now() - interval '1 day' limit 1`,
          [target.key, routeId, kind]
        );
        if (recent.rowCount) continue;
        const outcome = target.push ? await sendPush(target.push, notice) : await sendTelegram(target.chatId!, notice);
        if (outcome === 'gone') {
          if (target.push) await unsubscribe(target.push.endpoint);
          else await unlinkTelegramChat(target.chatId!);
          continue targets;
        }
        if (outcome === 'sent') {
          sent += 1;
          await pool!.query(`insert into alert_log (endpoint, route_id, kind) values ($1, $2, $3)`, [target.key, routeId, kind]);
        }
      }
    }
  }
  if (sent > 0) logger.info(`Sent ${sent} alerts`);
}
