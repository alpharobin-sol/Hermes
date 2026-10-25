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

// ---------- The look ----------
// Night in an email: umber around an umber card, parchment text, gold for ornament, the teal button. A dark email
// looks meant in dark mode, so mail apps leave it as it is. The hero is a Roman marble of Hermes (1st or 2nd century
// CE, The Metropolitan Museum of Art, open access) toned to the palette, in a gilt arch like the site's. The Met's
// open access images are CC0, so the card carries no credit line.

const C = {
  page: '#0f0806',
  card: '#160b08',
  line: '#45291e',
  text: '#f7e6c4',
  muted: '#c7a988',
  faint: '#8e755e',
  gold: '#f2c585',
  teal: '#1ab5b7',
  link: '#3fd0d2',
};
const SERIF = "Georgia,'Times New Roman',serif";
const SANS = 'Arial,Helvetica,sans-serif';
const HERO = `${SITE_URL}/brand/email-hermes.jpg`;

// Marcus Aurelius, Meditations VI.3, in George Long's translation (1862)
const QUOTE = 'Look within. Let neither the peculiar quality of anything nor its value escape thee.';

const SAFETY_LINE = 'Hermes never asks for your seed phrase or private key.';

function roman(n: number): string {
  const numerals: [number, string][] = [
    [10, 'X'],
    [9, 'IX'],
    [5, 'V'],
    [4, 'IV'],
    [1, 'I'],
  ];
  let out = '';
  for (const [value, numeral] of numerals) {
    while (n >= value) {
      out += numeral;
      n -= value;
    }
  }
  return out;
}

const longDate = () => new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

const button = (href: string, label: string) =>
  `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto"><tr><td style="background:${C.teal};border-radius:4px"><a href="${escape(href)}" style="display:inline-block;padding:14px 28px;font-family:${SANS};font-size:15px;font-weight:bold;color:#2b140e;text-decoration:none;border-radius:4px">${escape(label)}</a></td></tr></table>`;

// A gilt rule with a diamond in the middle, like the site's dividers
const divider = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td style="border-top:1px solid ${C.line};font-size:0;line-height:0" width="45%">&nbsp;</td>
<td align="center" style="padding:0 10px;font-size:11px;line-height:11px;color:${C.gold}">&#9670;</td>
<td style="border-top:1px solid ${C.line};font-size:0;line-height:0" width="45%">&nbsp;</td>
</tr></table>`;

/**
 * The whole email: the mark, the arch, an eyebrow and a title, what it says, then the quote and the footer
 */
function page(options: { preheader: string; eyebrow: string; title: string; body: string; footer: string }): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark">
<title>${escape(options.title)}</title></head>
<body style="margin:0;padding:0;background:${C.page}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${C.page}">${escape(options.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.page}"><tr><td align="center" style="padding:28px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:${C.card};border:1px solid ${C.line};border-radius:4px">
<tr><td align="center" style="padding:30px 24px 0;font-family:${SERIF};font-size:13px;letter-spacing:7px;color:${C.gold}">HERMES</td></tr>
<tr><td align="center" style="padding:18px 24px 0"><img src="${HERO}" width="380" alt="A Roman marble of Hermes in a gilt arch" style="display:block;width:100%;max-width:380px;height:auto;border:0"></td></tr>
<tr><td align="center" style="padding:22px 32px 0;font-family:${SANS};font-size:11px;letter-spacing:3px;color:${C.gold}">${escape(options.eyebrow.toUpperCase())}</td></tr>
<tr><td align="center" style="padding:10px 32px 0;font-family:${SERIF};font-size:30px;line-height:1.15;font-weight:bold;color:${C.text}">${escape(options.title)}</td></tr>
${options.body}
<tr><td style="padding:30px 32px 0">${divider}</td></tr>
<tr><td align="center" style="padding:22px 40px 0;font-family:${SERIF};font-size:16px;line-height:1.55;font-style:italic;color:${C.muted}">&ldquo;${escape(QUOTE)}&rdquo;</td></tr>
<tr><td align="center" style="padding:10px 24px 34px;font-family:${SANS};font-size:10px;letter-spacing:2px;color:${C.gold}">MARCUS AURELIUS &middot; MEDITATIONS VI.3</td></tr>
</table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px"><tr><td align="center" style="padding:20px 24px 0;font-family:${SANS};font-size:12px;line-height:1.7;color:${C.faint}">
${options.footer}<br>${SAFETY_LINE}
</td></tr></table>
</td></tr></table>
</body></html>`;
}

const paragraph = (html: string) =>
  `<tr><td align="center" style="padding:14px 36px 0;font-family:${SANS};font-size:15px;line-height:1.65;color:${C.muted}">${html}</td></tr>`;

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
    `"${QUOTE}" Marcus Aurelius, Meditations VI.3`,
    '',
    SAFETY_LINE,
  ].join('\n');
  const html = page({
    preheader: `${what} Tap the button to turn them on.`,
    eyebrow: 'One step left',
    title: 'Confirm your Hermes alerts',
    body: `${paragraph(`${escape(what)} Tap below to get them at this address.`)}
<tr><td align="center" style="padding:24px 32px 0">${button(link, 'Turn on email alerts')}</td></tr>`,
    footer: "If this wasn't you, ignore this email. Nothing more will come.",
  });
  return send(address, 'Confirm your Hermes alerts', text, html);
}

/**
 * One email with everything that changed for this address in a check. Each change is numbered like a tablet.
 */
export async function sendAlertEmail(address: string, token: string, notices: Notice[]): Promise<boolean> {
  if (notices.length === 0) return true;
  const unsubscribe = `${SITE_URL}/settings?unsubscribe=${token}`;
  const single = notices.length === 1;
  const subject = single ? notices[0].title : `${notices.length} changes on your Hermes routes`;
  // A change about a route you hold opens Portfolio, where Withdraw and Reroute are
  const main = notices.find((notice) => notice.url.endsWith('/portfolio'))?.url ?? notices[0].url;
  const text = [
    ...notices.flatMap((notice) => [notice.title, notice.body, notice.url, '']),
    `"${QUOTE}" Marcus Aurelius, Meditations VI.3`,
    '',
    'You get these because you turned on Hermes alerts for this address. At most one of each kind per route a day.',
    `Stop them: ${unsubscribe}`,
    SAFETY_LINE,
  ].join('\n');

  const changes = single
    ? paragraph(escape(notices[0].body))
    : `<tr><td style="padding:18px 32px 0">${notices
        .map(
          (notice, index) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid ${C.line}"><tr>
<td width="46" valign="top" style="padding:18px 0 18px;font-family:${SERIF};font-size:16px;letter-spacing:1px;color:${C.gold}">${roman(index + 1)}</td>
<td valign="top" style="padding:16px 0 18px">
<div style="font-family:${SERIF};font-size:19px;line-height:1.3;font-weight:bold;color:${C.text}">${escape(notice.title)}</div>
<div style="padding-top:6px;font-family:${SANS};font-size:14px;line-height:1.6;color:${C.muted}">${escape(notice.body)}</div>
<div style="padding-top:8px"><a href="${escape(notice.url)}" style="font-family:${SANS};font-size:14px;font-weight:bold;color:${C.link};text-decoration:none">Open in Hermes &rarr;</a></div>
</td></tr></table>`
        )
        .join('')}</td></tr>`;

  const html = page({
    preheader: single ? notices[0].body : notices.map((notice) => notice.title).join(' · '),
    eyebrow: longDate(),
    title: subject,
    body: `${changes}
<tr><td align="center" style="padding:26px 32px 0">${button(main, main.endsWith('/portfolio') ? 'Open Portfolio' : 'Open Hermes')}</td></tr>`,
    footer: `You get these because you turned on Hermes alerts for this address. At most one of each kind per route a day. <a href="${escape(unsubscribe)}" style="color:${C.muted}">Stop these emails</a>.`,
  });
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
