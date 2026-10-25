import { randomBytes } from 'crypto';
import { Api, GrammyError } from 'grammy';
import { logger } from '../utils/logger';
import { ROUTES } from '../registry/routes';
import { dbReady, pool } from './db';
import type { Notice } from './alerts';

/**
 * TELEGRAM ALERTS
 * The third way alerts arrive, beside the phone's notifications and email: Herald messages the user on Telegram.
 * Hermes makes a link token, the user opens t.me/HermesAggHeraldBot?start=<token>, and Herald ties their chat to it
 * (/start in his private chat). /alerts lists what he watches there, /stop ends it. Herald only messages people who
 * started a chat with him. Each check's changes come in one message.
 * Hermes keeps the chat id, the token and the routes the device watches and holds. Never the wallet.
 * Needs TELEGRAM_BOT_TOKEN (Herald's) and DATABASE_URL. TELEGRAM_BOT_USERNAME if the bot is ever renamed.
 */

const BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME || 'HermesAggHeraldBot';

let client: Api | null | undefined;

function telegram(): Api | null {
  if (client === undefined) client = process.env.TELEGRAM_BOT_TOKEN ? new Api(process.env.TELEGRAM_BOT_TOKEN) : null;
  return client;
}

export function telegramAlertsOn(): boolean {
  return telegram() !== null;
}

const KNOWN_ROUTES = new Set(ROUTES.map((route) => route.id));
const known = (ids: string[]) => [...new Set(ids.filter((id) => KNOWN_ROUTES.has(id)))];

export function routeNames(ids: string[]): string[] {
  return ids.map((id) => {
    const route = ROUTES.find((r) => r.id === id);
    return route ? `${route.name} (${route.token})` : id;
  });
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

/**
 * New lists for a device's chat. Null when Hermes no longer has the link (the user sent /stop, or never opened it).
 */
export async function saveTelegramLists(
  token: string,
  routes: string[],
  held: string[]
): Promise<{ linked: boolean; routes: string[]; held: string[] } | null> {
  if (!(await dbReady())) throw new Error('The alerts database is unavailable');
  const lists = [known(routes), known(held)];
  const result = await pool!.query(
    `update telegram_alerts set routes = $2, held = $3, updated_at = now() where token = $1 returning chat_id`,
    [token, ...lists]
  );
  return result.rowCount ? { linked: result.rows[0].chat_id !== null, routes: lists[0], held: lists[1] } : null;
}

// Whether the link has been opened in Telegram. Null when Hermes doesn't have it.
export async function telegramLinked(token: string): Promise<boolean | null> {
  if (!(await dbReady())) throw new Error('The alerts database is unavailable');
  const result = await pool!.query(`select chat_id from telegram_alerts where token = $1`, [token]);
  return result.rowCount ? result.rows[0].chat_id !== null : null;
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

export interface TelegramTarget {
  chatId: number;
  routes: string[];
  held: string[];
}

export async function telegramTargets(): Promise<TelegramTarget[]> {
  if (!telegramAlertsOn() || !(await dbReady())) return [];
  // Links never opened in Telegram are forgotten after a day
  await pool!.query(`delete from telegram_alerts where chat_id is null and created_at < now() - interval '1 day'`);
  const rows = (
    await pool!.query(`select chat_id, routes, held from telegram_alerts where chat_id is not null and cardinality(routes) + cardinality(held) > 0`)
  ).rows;
  return rows.map((row) => ({ chatId: Number(row.chat_id), routes: row.routes, held: row.held }));
}

/**
 * One message with everything that changed for this chat in a check. Gone when the user blocked Herald or deleted
 * the chat: Hermes forgets it.
 */
export async function sendTelegramAlert(chatId: number, notices: Notice[]): Promise<'sent' | 'gone' | 'failed'> {
  const api = telegram();
  if (!api) return 'failed';
  if (notices.length === 0) return 'sent';
  const blocks = notices.map((notice) => `${notice.title}\n${notice.body}\n${notice.url}`);
  const text = (notices.length === 1 ? blocks : [`${notices.length} changes on your Hermes routes`, ...blocks]).join('\n\n');
  try {
    await api.sendMessage(chatId, `${text}\n\n/stop turns these off.`, { link_preview_options: { is_disabled: true } });
    return 'sent';
  } catch (error) {
    if (error instanceof GrammyError && (error.error_code === 403 || /chat not found/i.test(error.description))) return 'gone';
    logger.warn(`Telegram alert failed: ${error instanceof Error ? error.message : error}`);
    return 'failed';
  }
}
