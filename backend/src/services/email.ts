import { randomBytes } from 'crypto';
import { logger } from '../utils/logger';
import { ROUTES } from '../registry/routes';
import { dbReady, pool } from './db';
import type { Notice } from './alerts';

/**
 * EMAIL ALERTS
 * The other way alerts arrive, beside the phone's notifications: by email, sent through Resend (RESEND_API_KEY).
 * Someone types their address in Hermes, Hermes emails them a link to confirm it, and only a confirmed address gets
 * alerts. An alert email bundles whatever changed in one check and ends with a one-tap unsubscribe link, also in the
 * List-Unsubscribe header that mail apps show as Unsubscribe.
 * Hermes keeps the address, a random token the browser and the links use, and the routes it watches and holds.
 * Never the wallet.
 * Caps, so nobody can use Hermes to flood an inbox or spend the plan: a confirmation email per address every 2
 * minutes and 3 a day, 5 sign-ups per IP an hour, and EMAIL_DAILY_LIMIT emails a day in all (default 100, Resend's
 * free plan). The counts live in memory and start again on a restart.
 */

const KEY = process.env.RESEND_API_KEY || '';
const FROM = process.env.ALERTS_FROM_EMAIL || 'Hermes <alerts@hermesagg.xyz>';
const SITE_URL = process.env.SITE_URL || 'https://www.hermesagg.xyz';
const API_URL = (process.env.PUBLIC_API_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/$/, '');
const DAILY_LIMIT = Number(process.env.EMAIL_DAILY_LIMIT || 100);
const RESEND_PAUSE_MS = 2 * 60 * 1000;
const CONFIRMS_PER_DAY = 3;
const SIGNUPS_PER_IP_HOUR = 5;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export function emailAlertsOn(): boolean {
  return KEY.length > 0;
}

// ---------- Caps ----------

let day = '';
let sentToday = 0;
const confirmsTo = new Map<string, number[]>(); // when confirmation emails went to each address
const signupsFrom = new Map<string, number[]>(); // when each IP started a sign-up

function underDailyLimit(): boolean {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== day) {
    day = today;
    sentToday = 0;
  }
  return sentToday < DAILY_LIMIT;
}

function recent(map: Map<string, number[]>, key: string, windowMs: number): number[] {
  const kept = (map.get(key) ?? []).filter((at) => Date.now() - at < windowMs);
  map.set(key, kept);
  if (map.size > 10_000) map.delete(map.keys().next().value!);
  return kept;
}

// ---------- Sending ----------

async function send(to: string, subject: string, text: string, html: string, headers?: Record<string, string>): Promise<boolean> {
  if (!emailAlertsOn() || !underDailyLimit()) return false;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to: [to], subject, text, html, ...(headers ? { headers } : {}) }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      logger.warn(`Email failed (${res.status}): ${(await res.text().catch(() => '')).slice(0, 300)}`);
      return false;
    }
    sentToday += 1;
    return true;
  } catch (error) {
    logger.warn(`Email failed: ${error instanceof Error ? error.message : error}`);
    return false;
  }
}

const escape = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const routeNames = (ids: string[]) =>
  ids.map((id) => {
    const route = ROUTES.find((r) => r.id === id);
    return route ? `${route.name} (${route.token})` : id;
  });

// Aurora in an email: plaster around a vellum card, umber text, the teal button
function page(title: string, inner: string, footer: string): string {
  return `<!doctype html><html><body style="margin:0;background:#f6ead0;padding:24px 12px;font-family:Arial,Helvetica,sans-serif;color:#2b140e">
<div style="max-width:520px;margin:0 auto;background:#fcf5e6;border:1px solid #cdb185;border-radius:4px;padding:24px">
<div style="font-family:Georgia,serif;font-size:13px;letter-spacing:3px;color:#8e3b1f">HERMES</div>
<h1 style="font-family:Georgia,serif;font-size:26px;line-height:1.15;margin:8px 0 16px">${escape(title)}</h1>
${inner}
</div>
<p style="max-width:520px;margin:16px auto 0;font-size:12px;line-height:1.6;color:#6b4a36">${footer}</p>
</body></html>`;
}

const button = (href: string, label: string) =>
  `<a href="${escape(href)}" style="display:inline-block;background:#1ab5b7;color:#2b140e;font-weight:bold;text-decoration:none;padding:12px 20px;border-radius:4px">${escape(label)}</a>`;

const SAFETY_LINE = 'Hermes never asks for your seed phrase or private key.';

async function sendConfirmation(address: string, token: string, routes: string[], held: string[]): Promise<boolean> {
  const link = `${SITE_URL}/settings?confirm=${token}`;
  const about = [...(held.length > 0 ? ['your positions'] : []), ...routeNames(routes.filter((id) => !held.includes(id)))];
  const what = about.length > 0 ? `You asked for alerts about ${about.join(', ')}.` : 'You asked for Hermes alerts.';
  const text = [
    'Tap to get Hermes alerts at this address:',
    link,
    '',
    what,
    "If this wasn't you, ignore this email. Nothing more will come.",
    '',
    SAFETY_LINE,
  ].join('\n');
  const html = page(
    'Confirm your Hermes alerts',
    `<p style="font-size:15px;line-height:1.6;margin:0 0 20px">${escape(what)} Tap below to get them at this address.</p>${button(link, 'Turn on email alerts')}`,
    `If this wasn't you, ignore this email. Nothing more will come.<br>${SAFETY_LINE}`
  );
  return send(address, 'Confirm your Hermes alerts', text, html);
}

/**
 * One email with everything that changed for this address in a check
 */
export async function sendAlertEmail(address: string, token: string, notices: Notice[]): Promise<boolean> {
  if (notices.length === 0) return true;
  const unsubscribe = `${SITE_URL}/settings?unsubscribe=${token}`;
  const subject = notices.length === 1 ? notices[0].title : `${notices.length} changes on your Hermes routes`;
  const text = [
    ...notices.flatMap((notice) => [notice.title, notice.body, notice.url, '']),
    'You get these because you turned on Hermes alerts for this address. At most one of each kind per route a day.',
    `Stop them: ${unsubscribe}`,
    SAFETY_LINE,
  ].join('\n');
  const html = page(
    subject,
    notices
      .map(
        (notice) =>
          `<div style="border-top:1px solid #e3cfa8;padding:14px 0"><div style="font-weight:bold;font-size:15px">${escape(notice.title)}</div><div style="font-size:14px;line-height:1.6;color:#6b4a36;margin:4px 0 10px">${escape(notice.body)}</div><a href="${escape(notice.url)}" style="color:#086668;font-size:14px">Open in Hermes</a></div>`
      )
      .join(''),
    `You get these because you turned on Hermes alerts for this address. At most one of each kind per route a day. <a href="${escape(unsubscribe)}" style="color:#6b4a36">Stop these emails</a>.<br>${SAFETY_LINE}`
  );
  // Mail apps show an Unsubscribe button from these. One tap posts to the API and stops the emails.
  const headers: Record<string, string> = API_URL
    ? { 'List-Unsubscribe': `<${API_URL}/api/alerts/email/one-click?token=${token}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' }
    : { 'List-Unsubscribe': `<${unsubscribe}>` };
  return send(address, subject, text, html, headers);
}

// ---------- Addresses ----------

const KNOWN_ROUTES = new Set(ROUTES.map((route) => route.id));
const known = (ids: string[]) => [...new Set(ids.filter((id) => KNOWN_ROUTES.has(id)))];

export type StartResult =
  | { token: string; confirmed: boolean }
  | { error: 'off' | 'address-limit' | 'ip-limit' | 'send' };

/**
 * Start email alerts for an address, or ask for the confirmation link again. A new address on the same device
 * replaces the old one. The address gets nothing but the confirmation email until its link is opened.
 */
export async function startEmail(
  token: string | null,
  email: string,
  routes: string[],
  held: string[],
  ip: string
): Promise<StartResult> {
  if (!emailAlertsOn() || !(await dbReady())) return { error: 'off' };
  const address = email.trim().toLowerCase();
  const lists = [known(routes), known(held)];

  const asked = recent(confirmsTo, address, DAY_MS);
  const mayConfirm = () => asked.length < CONFIRMS_PER_DAY && (asked.length === 0 || Date.now() - asked[asked.length - 1] >= RESEND_PAUSE_MS);

  if (token) {
    const found = await pool!.query(`select email, confirmed from email_alerts where token = $1`, [token]);
    const row = found.rows[0];
    if (row && row.email === address) {
      await pool!.query(`update email_alerts set routes = $2, held = $3, updated_at = now() where token = $1`, [token, ...lists]);
      if (row.confirmed) return { token, confirmed: true };
      if (!mayConfirm()) return { error: 'address-limit' };
      if (!(await sendConfirmation(address, token, lists[0], lists[1]))) return { error: 'send' };
      asked.push(Date.now());
      await pool!.query(`update email_alerts set confirm_sent_at = now() where token = $1`, [token]);
      return { token, confirmed: false };
    }
    if (row) await pool!.query(`delete from email_alerts where token = $1`, [token]);
  }

  if (!mayConfirm()) return { error: 'address-limit' };
  const signups = recent(signupsFrom, ip, HOUR_MS);
  if (signups.length >= SIGNUPS_PER_IP_HOUR) return { error: 'ip-limit' };

  const fresh = randomBytes(24).toString('base64url');
  await pool!.query(`insert into email_alerts (token, email, routes, held, confirm_sent_at) values ($1, $2, $3, $4, now())`, [
    fresh,
    address,
    ...lists,
  ]);
  if (!(await sendConfirmation(address, fresh, lists[0], lists[1]))) {
    await pool!.query(`delete from email_alerts where token = $1`, [fresh]);
    return { error: 'send' };
  }
  asked.push(Date.now());
  signups.push(Date.now());
  return { token: fresh, confirmed: false };
}

/**
 * Save new lists for a device's address. Null when Hermes no longer has it (unsubscribed, or never confirmed).
 */
export async function saveEmailLists(
  token: string,
  routes: string[],
  held: string[]
): Promise<{ confirmed: boolean; routes: string[]; held: string[] } | null> {
  if (!(await dbReady())) return null;
  const lists = [known(routes), known(held)];
  const result = await pool!.query(
    `update email_alerts set routes = $2, held = $3, updated_at = now() where token = $1 returning confirmed`,
    [token, ...lists]
  );
  return result.rowCount ? { confirmed: result.rows[0].confirmed, routes: lists[0], held: lists[1] } : null;
}

export async function emailStatus(token: string): Promise<{ confirmed: boolean } | null> {
  if (!(await dbReady())) return null;
  const result = await pool!.query(`select confirmed from email_alerts where token = $1`, [token]);
  return result.rowCount ? { confirmed: result.rows[0].confirmed } : null;
}

// The link in the confirmation email. False when it has expired.
export async function confirmEmail(token: string): Promise<boolean> {
  if (!(await dbReady())) return false;
  return !!(await pool!.query(`update email_alerts set confirmed = true, updated_at = now() where token = $1`, [token])).rowCount;
}

// The unsubscribe link, the mail app's Unsubscribe button, and Settings
export async function unsubscribeEmail(token: string): Promise<boolean> {
  if (!(await dbReady())) return false;
  return !!(await pool!.query(`delete from email_alerts where token = $1`, [token])).rowCount;
}

export interface EmailTarget {
  token: string;
  address: string;
  routes: string[];
  held: string[];
}

export async function emailTargets(): Promise<EmailTarget[]> {
  if (!emailAlertsOn() || !(await dbReady())) return [];
  // Addresses never confirmed are forgotten after a day
  await pool!.query(`delete from email_alerts where not confirmed and created_at < now() - interval '1 day'`);
  const rows = (
    await pool!.query(`select token, email, routes, held from email_alerts where confirmed and cardinality(routes) + cardinality(held) > 0`)
  ).rows;
  return rows.map((row) => ({ token: row.token, address: row.email, routes: row.routes, held: row.held }));
}
