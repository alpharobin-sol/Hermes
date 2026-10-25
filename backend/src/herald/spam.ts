/**
 * What Herald removes from the group, as plain checks on a message so they can be tested without Telegram.
 *
 * Scams in crypto groups follow a few patterns: asking for a seed phrase or private key, "validate your wallet",
 * fake airdrops, "DM me" and fake support, promised profits, and links to other groups or phishing sites. A member
 * who joined in the last day can't post links or forwards, since spam accounts post within minutes of joining.
 * Members who have been around longer can share links, except invites to other Telegram groups.
 */

// Sites anyone may link to, newcomers included: Hermes itself and the Solana explorers
const ALWAYS_ALLOWED_HOSTS = ['hermesagg.xyz', 'solscan.io', 'explorer.solana.com'];

// Hermes's own group, the one invite link that stays
export const GROUP_INVITE = 't.me/+I2pSaIdIykgwMDQ0';

// Each pattern is the scammer's ask, aimed at "your" wallet or keys, so a member asking about their own doesn't match
const SCAM_PATTERNS: { pattern: RegExp; reason: string }[] = [
  {
    pattern: /\b(send|share|enter|submit|input|import|paste|provide|type|drop)\b[^.?!\n]{0,25}\byour\b[^.?!\n]{0,20}\b((seed|recovery|secret|mnemonic)\s*(phrase|words?)|private\s*key)/i,
    reason: 'it asked for a seed phrase or private key',
  },
  {
    pattern: /\b(validate|validation|sync|synchroni[sz]e|rectify|whitelist|unfreeze)\b[^.?!\n]{0,20}\byour\b[^.?!\n]{0,15}\bwallets?\b|\bconnect\s+your\s+wallet\s+(to|at|on|via)\s+(this|the|my|our)\s+(link|site|dapp|page|portal)/i,
    reason: 'it asked people to "validate" or connect a wallet, a common drainer scam',
  },
  { pattern: /\b(dm|pm|inbox|text)\s+me\b|\bmessage\s+me\s+(privately|directly|in\s+private)\b/i, reason: 'it asked people to message privately' },
  { pattern: /\bclaim\s+(your|free)\s+(\w+\s+){0,2}(airdrop|rewards?|bonus|tokens?)\b|\bairdrop\s+(is\s+)?(live|out\s+now)\b/i, reason: 'it pushed an airdrop claim' },
  {
    pattern: /\bguaranteed\s+(profits?|returns?|income|gains?)\b|\bdouble\s+your\s+(sol|crypto|money|investment|funds)\b|\b(daily|weekly)\s+(profits?|returns?)\s+of\s+\d+\s*%|\binvestment\s+(plan|opportunity|manager)\b|\baccount\s+manager\b/i,
    reason: 'it promised profits',
  },
  { pattern: /\bwa\.me\/|\bwhats\s?app\b/i, reason: 'it pointed to WhatsApp' },
];

// A warning ("never share your seed phrase") or a member asking about their own ("should I share my seed phrase?")
const WARNING = /\b(never|don'?t|do\s+not|dont|no\s+one|nobody|beware|scam|fake)\b/i;
const OWN_QUESTION = /\b(i|we|my|our)\b/i;

function scamIn(text: string): string | null {
  for (const sentence of text.split(/(?<=[.?!\n])/)) {
    const question = sentence.trim().endsWith('?');
    // A question is a member asking, unless it pushes "your" money or wallet ("want to double your SOL?")
    if (WARNING.test(sentence) || (question && (OWN_QUESTION.test(sentence) || !/\byour\b/i.test(sentence)))) continue;
    for (const { pattern, reason } of SCAM_PATTERNS) if (pattern.test(sentence)) return reason;
  }
  return null;
}

export interface MessageFacts {
  text: string; // the message text or caption
  urls: string[]; // every link in it, from Telegram's entities
  forwarded: boolean;
  newcomer: boolean; // joined less than a day ago
}

export interface Finding {
  reason: string; // shown to the member: "I removed a message from <name>: <reason>."
  // A scam pattern with a way to reach the scammer (a link or an @handle): bans a newcomer at once
  scam: boolean;
}

// The host of a link, lowercased, without "www."
export function hostOf(url: string): string | null {
  try {
    const parsed = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `https://${url}`);
    return parsed.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

function allowedHost(host: string): boolean {
  return ALWAYS_ALLOWED_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

// A link to another Telegram group, channel or bot: anything on t.me or telegram.me but Hermes's own group
function telegramInvite(url: string): boolean {
  const host = hostOf(url);
  if (host !== 't.me' && host !== 'telegram.me' && host !== 'telegram.dog') return false;
  return !url.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').startsWith(GROUP_INVITE.toLowerCase());
}

/**
 * Why a message should go, or null when it can stay. Only for members who aren't admins.
 */
export function inspect(facts: MessageFacts): Finding | null {
  const scam = scamIn(facts.text);
  if (scam) return { reason: scam, scam: facts.urls.length > 0 || /(^|\s)@[a-z0-9_]{4,}/i.test(facts.text) };
  if (facts.urls.some(telegramInvite)) return { reason: 'links to other Telegram groups aren\'t allowed', scam: false };
  if (facts.newcomer) {
    if (facts.forwarded) return { reason: 'new members can forward messages after their first day', scam: false };
    if (facts.urls.some((url) => !allowedHost(hostOf(url) ?? ''))) {
      return { reason: 'new members can post links after their first day', scam: false };
    }
  }
  return null;
}

/**
 * A name made to look like Hermes staff: "Hermes Support", "hermes_admin", "Official Hermes Team".
 * Real admins are checked before this runs.
 */
export function impersonates(name: string): boolean {
  const plain = name.toLowerCase().replace(/[^a-z0-9]+/g, ' ');
  return /\bhermes/.test(plain) && /\b(admin|support|mod|moderator|team|official|help|helpdesk|care)\b/.test(plain);
}

// ---------- Strikes and flooding ----------

const STRIKE_MEMORY_MS = 7 * 24 * 60 * 60 * 1000;
const FLOOD_WINDOW_MS = 10_000;
const FLOOD_MESSAGES = 6;

export type Penalty = 'warn' | 'mute' | 'ban';

/**
 * What a member gets for removed messages: a warning, then a day's mute, then a ban. Kept in memory for a week, so
 * a restart forgets them, which errs toward the member.
 */
export class Strikes {
  private strikes = new Map<number, { count: number; at: number }>();
  private recent = new Map<number, number[]>();

  add(userId: number, now = Date.now()): Penalty {
    const last = this.strikes.get(userId);
    const count = last && now - last.at < STRIKE_MEMORY_MS ? last.count + 1 : 1;
    this.strikes.set(userId, { count, at: now });
    if (this.strikes.size > 10_000) this.strikes.delete(this.strikes.keys().next().value!);
    return count === 1 ? 'warn' : count === 2 ? 'mute' : 'ban';
  }

  // True when this message makes more than 6 in 10 seconds
  flooding(userId: number, now = Date.now()): boolean {
    const times = (this.recent.get(userId) ?? []).filter((at) => now - at < FLOOD_WINDOW_MS);
    times.push(now);
    this.recent.set(userId, times);
    if (this.recent.size > 10_000) this.recent.delete(this.recent.keys().next().value!);
    return times.length > FLOOD_MESSAGES;
  }
}
