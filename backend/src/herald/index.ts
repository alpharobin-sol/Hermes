import { createHash, timingSafeEqual } from 'crypto';
import { Bot, Context, InlineKeyboard, webhookCallback } from 'grammy';
import type { ChatPermissions, Message, User, UserFromGetMe } from 'grammy/types';
import type { RequestHandler } from 'express';
import { logger } from '../utils/logger';
import { answer, answersEnabled, mayAnswer, Question } from './answers';
import { GROUP_INVITE, impersonates, inspect, Strikes } from './spam';

/**
 * HERALD
 * The Hermes Telegram group's moderator bot (@HermesAggHeraldBot). He welcomes members, keeps scams out and answers
 * questions about Hermes.
 *
 * - Welcome: a new member can't post until they tap "I'm human" under Herald's welcome, within 5 minutes. Spam
 *   accounts don't, and are removed. A bot added by anyone but an admin is removed at once.
 * - Anti-spam: scam patterns are deleted (seed phrases, "validate your wallet", fake airdrops, "DM me", promised
 *   profits), as are links to other Telegram groups, posts made as a channel, and, for a member's first day, links
 *   and forwards. Names made to look like Hermes staff are banned. Each removal is a strike: a warning, then a
 *   day's mute, then a ban. A newcomer posting a scam is banned at once. Flooding (more than 6 messages in 10
 *   seconds) mutes for 10 minutes. Admins are never touched.
 * - Answers: Herald answers when mentioned, replied to or asked with /ask, and on his own when a member asks a
 *   question about Hermes. Answers come from Claude (answers.ts).
 *
 * Telegram delivers updates to a webhook on the API (POST /telegram/webhook), checked by a secret header, so a
 * redeploy hands over cleanly. Herald works only in the group TELEGRAM_GROUP_ID names and stays quiet anywhere else.
 * Needs TELEGRAM_BOT_TOKEN, and admin rights in the group to delete messages and ban users.
 */

const TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
// The group's id, forgiving quotes and spaces pasted with it. NaN when it isn't a number.
const GROUP_ID_RAW = (process.env.TELEGRAM_GROUP_ID ?? '').replace(/["'\s]/g, '');
const GROUP_ID = GROUP_ID_RAW ? Number(GROUP_ID_RAW) : null;

// What /status shows when the group id doesn't arrive: the names (never the values) of settings that look like it,
// so a typo or a setting on the wrong service shows up
function groupIdProblem(here: number): string {
  if (process.env.TELEGRAM_GROUP_ID !== undefined && !GROUP_ID_RAW) return `TELEGRAM_GROUP_ID: set but empty. Set it to ${here} on Render.`;
  if (GROUP_ID !== null && Number.isNaN(GROUP_ID)) return `TELEGRAM_GROUP_ID: not a number. Set it to ${here} on Render, nothing else in the value.`;
  const lookalikes = Object.keys(process.env).filter((key) => /tele|group|chat/i.test(key) && key !== 'TELEGRAM_BOT_TOKEN');
  return [
    `TELEGRAM_GROUP_ID: not set. Set it to ${here} on Render, on the hermes-api service, then Save, rebuild and deploy.`,
    lookalikes.length
      ? `Settings I can see with similar names: ${lookalikes.map((key) => JSON.stringify(key)).join(', ')}. The name must be exactly "TELEGRAM_GROUP_ID".`
      : 'I see no setting with a similar name, so it is on another service or wasn\'t saved and deployed.',
  ].join('\n');
}
const AUTO_ANSWER = process.env.HERALD_AUTO_ANSWER !== 'false';
const WEBHOOK_PATH = '/telegram/webhook';

const VERIFY_MS = 5 * 60_000;
const NEWCOMER_MS = 24 * 60 * 60_000;
const WARNING_LIFE_MS = 60_000;
const WELCOME_LIFE_MS = 10 * 60_000;
const ADMIN_CACHE_MS = 10 * 60_000;
// Telegram's own senders: channel posts relayed into a linked group, and admins posting anonymously
const TELEGRAM_SERVICE = 777000;
const ANONYMOUS_ADMIN = 1087968824;

const SILENT: ChatPermissions = {
  can_send_messages: false,
  can_send_audios: false,
  can_send_documents: false,
  can_send_photos: false,
  can_send_videos: false,
  can_send_video_notes: false,
  can_send_voice_notes: false,
  can_send_polls: false,
  can_send_other_messages: false,
  can_add_web_page_previews: false,
};

// A question about Hermes, for answering unasked: a question mark or question word, and a Hermes topic
const QUESTION = /\?|^(how|what|why|when|where|which|who|is|are|can|could|does|do|should|will|would)\b/i;
const TOPIC =
  /\b(hermes|herald|deposit|withdraw|reroute|portfolio|apy|yield|rate|stake|staking|lend|lending|vault|safety|score|top rated|route|jito|marinade|kamino|jupiter|project ?0|marginfi|steakhouse|sanctum|blaze|jpool|bybit|binance|helius|drift|lst|jitosol|msol|usdc|usdt|sol|wallet|fee|cap|beta|alert|safe|risk)\b/i;

const name = (user: User) => [user.first_name, user.last_name].filter(Boolean).join(' ') || user.username || 'there';

function welcomeText(user: User): string {
  return [
    `Welcome, ${name(user)}.`,
    '',
    'Hermes compares live Solana yields, rates every route with a Safety Score and builds the deposit for you to sign in your own wallet. Funds never touch Hermes.',
    '',
    'App: hermesagg.xyz/app',
    'Docs: hermesagg.xyz/docs',
    '',
    'Ask me anything about Hermes: mention me or reply to me.',
    '',
    'Admins never DM first. Never share your seed phrase or private key with anyone.',
  ].join('\n');
}

const SUPERGROUP_NOTE = [
  'Admins: I can\'t hold new members back until they tap the welcome button. Telegram allows that only in supergroups.',
  '',
  'Open the group\'s settings and set Chat history for new members to Visible. Telegram upgrades the group and gives it a new id, which I\'ll post here. Set TELEGRAM_GROUP_ID to it on Render.',
].join('\n');

const RIGHTS_NOTE =
  'Admins: I can\'t hold new members back until they tap the welcome button. Make me an admin with Ban users and Delete messages.';

const RULES_TEXT = [
  'Hermes group rules:',
  '',
  '1. Stay on Hermes and Solana yield. Be kind.',
  '2. No scams, no promotion, no links to other groups.',
  '3. New members can post links and forwards after their first day.',
  '4. Admins never DM first. Never share a seed phrase or private key.',
  '',
  'Removed messages count as strikes: a warning, then a day\'s mute, then a ban.',
].join('\n');

const HELP_TEXT = [
  'I am Herald, the Hermes group\'s moderator.',
  '',
  'Ask me about Hermes: mention me, reply to me or use /ask followed by your question.',
  '/rules shows the group rules. Admins: /status checks my setup.',
  '',
  'Docs: hermesagg.xyz/docs',
].join('\n');

export interface HeraldOptions {
  token: string;
  groupId: number | null;
  botInfo?: UserFromGetMe; // given in tests, so the bot doesn't call getMe
  ask?: (question: Question) => Promise<string | null>; // given in tests in place of Claude
  autoAnswer?: boolean;
}

/**
 * Herald's bot with every handler. The webhook and startup below wire it to Telegram.
 */
export function createHeraldBot(options: HeraldOptions): Bot {
  const bot = new Bot(options.token, options.botInfo ? { botInfo: options.botInfo } : undefined);
  const ask = options.ask ?? answer;
  const autoAnswer = options.autoAnswer ?? AUTO_ANSWER;
  const strikes = new Strikes();
  const verifiedAt = new Map<number, number>(); // when each newcomer passed the welcome check
  const pending = new Map<string, NodeJS.Timeout>(); // welcome checks waiting for a tap
  const admins = new Map<number, { ids: Set<number>; names: Set<string>; at: number }>();

  let migratedTo: number | null = null; // the group's new id, once it became a supergroup
  const toldAdmins = new Set<string>(); // setup notes already posted, once each
  const checkedJoins = new Map<string, number>(); // a join arrives twice: as a member update and as a chat notice
  const inGroup = (chatId: number) => options.groupId !== null && (chatId === options.groupId || chatId === migratedTo);

  async function adminsOf(ctx: Context, chatId: number) {
    const known = admins.get(chatId);
    if (known && Date.now() - known.at < ADMIN_CACHE_MS) return known;
    const list = await ctx.api.getChatAdministrators(chatId);
    const fresh = {
      ids: new Set(list.map((member) => member.user.id)),
      names: new Set(list.filter((member) => !member.user.is_bot).map((member) => name(member.user).toLowerCase())),
      at: Date.now(),
    };
    admins.set(chatId, fresh);
    return fresh;
  }

  async function isAdmin(ctx: Context, chatId: number, user: User): Promise<boolean> {
    if (user.id === TELEGRAM_SERVICE || user.id === ANONYMOUS_ADMIN || user.id === ctx.me.id) return true;
    return (await adminsOf(ctx, chatId)).ids.has(user.id);
  }

  // A name made to look like staff, or copying an admin's name
  async function impostor(ctx: Context, chatId: number, user: User): Promise<boolean> {
    const display = name(user);
    if (impersonates(`${display} ${user.username ?? ''}`)) return true;
    return (await adminsOf(ctx, chatId)).names.has(display.toLowerCase());
  }

  const quietly = (task: Promise<unknown>) => task.catch((error) => logger.debug(`Herald: ${error instanceof Error ? error.message : error}`));

  async function warn(ctx: Context, chatId: number, text: string) {
    const sent = await ctx.api.sendMessage(chatId, text);
    setTimeout(() => quietly(ctx.api.deleteMessage(chatId, sent.message_id)), WARNING_LIFE_MS);
  }

  async function ban(ctx: Context, chatId: number, user: User, why: string) {
    logger.info(`Herald banned ${user.id} (${name(user)}): ${why}`);
    await ctx.api.banChatMember(chatId, user.id);
  }

  async function mute(ctx: Context, chatId: number, user: User, ms: number, why: string) {
    logger.info(`Herald muted ${user.id} (${name(user)}) for ${ms / 60_000} min: ${why}`);
    await ctx.api.restrictChatMember(chatId, user.id, SILENT, { until_date: Math.floor((Date.now() + ms) / 1000) });
  }

  // ---------- Joining ----------

  // The welcome check for one new member. Telegram reports a join twice, as a member update (sent only to admin
  // bots) and as a notice in the chat, and either can arrive alone, so both lead here and the second is skipped.
  async function checkNewcomer(ctx: Context, chatId: number, user: User, addedBy: User | undefined) {
    const key = `${chatId}:${user.id}`;
    if (Date.now() - (checkedJoins.get(key) ?? 0) < 2 * 60_000) return;
    checkedJoins.set(key, Date.now());
    if (checkedJoins.size > 10_000) checkedJoins.delete(checkedJoins.keys().next().value!);

    // A bot an admin added is trusted. Every person gets the check, whoever added them.
    if (user.is_bot) {
      const byAdmin = addedBy && addedBy.id !== user.id && (await isAdmin(ctx, chatId, addedBy));
      if (!byAdmin) await ban(ctx, chatId, user, 'a bot added by a member');
      return;
    }
    if (await impostor(ctx, chatId, user)) return ban(ctx, chatId, user, 'a name made to look like Hermes staff');

    try {
      await ctx.api.restrictChatMember(chatId, user.id, SILENT);
    } catch (error) {
      // A basic group can't hold members back, nor can Herald without admin rights. Welcome them anyway, and tell
      // the admins once what to change.
      const why = error instanceof Error ? error.message : String(error);
      logger.warn(`Herald could not hold back ${user.id} in ${chatId}: ${why}`);
      await quietly(ctx.api.sendMessage(chatId, welcomeText(user), { link_preview_options: { is_disabled: true } }));
      const note = /supergroup/i.test(why) ? SUPERGROUP_NOTE : /rights|admin/i.test(why) ? RIGHTS_NOTE : null;
      if (note && !toldAdmins.has(note)) {
        toldAdmins.add(note);
        await quietly(ctx.api.sendMessage(chatId, note));
      }
      return;
    }
    const keyboard = new InlineKeyboard().text("I'm human", `verify:${user.id}`);
    const sent = await ctx.api.sendMessage(
      chatId,
      `Welcome, ${name(user)}. Tap the button below within 5 minutes to start chatting.`,
      { reply_markup: keyboard }
    );
    clearTimeout(pending.get(key));
    pending.set(
      key,
      setTimeout(async () => {
        pending.delete(key);
        logger.info(`Herald removed ${user.id} (${name(user)}): no tap on the welcome check`);
        // A ban then an unban removes them and lets them join again later
        await quietly(ctx.api.banChatMember(chatId, user.id));
        await quietly(ctx.api.unbanChatMember(chatId, user.id, { only_if_banned: true }));
        await quietly(ctx.api.deleteMessage(chatId, sent.message_id));
      }, VERIFY_MS)
    );
  }

  bot.on('chat_member', async (ctx) => {
    const update = ctx.chatMember;
    if (!inGroup(update.chat.id)) return;
    const was = update.old_chat_member.status;
    const now = update.new_chat_member.status;
    // A member who left while muted comes back restricted and stays that way
    if ((was === 'left' || was === 'kicked') && now === 'member') {
      await checkNewcomer(ctx, update.chat.id, update.new_chat_member.user, update.from);
    }
  });

  // The button carries the member's id, so it still works after a restart has forgotten the pending check
  bot.callbackQuery(/^verify:(\d+)$/, async (ctx) => {
    const memberId = Number(ctx.match[1]);
    const chatId = ctx.chat?.id;
    if (!chatId || !inGroup(chatId)) {
      await ctx.answerCallbackQuery();
      return;
    }
    if (ctx.from.id !== memberId) {
      await ctx.answerCallbackQuery({ text: 'This button is for the new member.' });
      return;
    }
    const key = `${chatId}:${memberId}`;
    clearTimeout(pending.get(key));
    pending.delete(key);
    // Only the welcome check's own restriction is lifted: it has no end date, where a mute has one
    const member = await ctx.api.getChatMember(chatId, memberId);
    if (member.status !== 'restricted' || member.until_date !== 0 || member.can_send_messages) {
      await ctx.answerCallbackQuery({ text: member.status === 'restricted' ? 'You are muted for now.' : 'You are already in.' });
      return;
    }
    // Back to what the group lets every member do
    const chat = await ctx.api.getChat(chatId);
    const permissions = 'permissions' in chat && chat.permissions ? chat.permissions : { ...SILENT, can_send_messages: true };
    await ctx.api.restrictChatMember(chatId, memberId, permissions);
    verifiedAt.set(memberId, Date.now());
    if (verifiedAt.size > 10_000) verifiedAt.delete(verifiedAt.keys().next().value!);
    await ctx.answerCallbackQuery({ text: 'Welcome to Hermes.' });
    const messageId = ctx.callbackQuery.message?.message_id;
    if (messageId) {
      await quietly(ctx.api.editMessageText(chatId, messageId, welcomeText(ctx.from), { link_preview_options: { is_disabled: true } }));
      setTimeout(() => quietly(ctx.api.deleteMessage(chatId, messageId)), WELCOME_LIFE_MS);
    }
    logger.info(`Herald let in ${memberId} (${name(ctx.from)})`);
  });

  // ---------- Groups Herald doesn't belong to ----------

  // He stays, but does nothing there. Leaving could lose the Hermes group itself: its id changes when it becomes a
  // supergroup.
  bot.on('my_chat_member', (ctx) => {
    const chat = ctx.myChatMember.chat;
    if (chat.type !== 'private' && !inGroup(chat.id)) {
      logger.info(`Herald is in ${chat.id} (${'title' in chat ? chat.title : ''}), not the Hermes group: he stays quiet there`);
    }
  });

  // The Hermes group became a supergroup, with a new id. Herald follows it until a restart, and says what to set.
  bot.on('message:migrate_from_chat_id', async (ctx) => {
    if (options.groupId === null || ctx.msg.migrate_from_chat_id !== options.groupId) return;
    migratedTo = ctx.chat.id;
    logger.warn(`Herald: the Hermes group is now ${ctx.chat.id}. Set TELEGRAM_GROUP_ID to it.`);
    await quietly(ctx.reply(`Admins: this group is now a supergroup, with the id ${ctx.chat.id}. Set TELEGRAM_GROUP_ID to it on Render.`));
  });

  // ---------- Private chats ----------

  bot.chatType('private').on('message', async (ctx) => {
    await ctx.reply(`${HELP_TEXT}\n\nI answer questions in the Hermes group: ${GROUP_INVITE}`, {
      link_preview_options: { is_disabled: true },
    });
  });

  // ---------- The group ----------

  // Every message and edit goes through moderation first. Spammers often post clean, then edit a link in.
  bot.on(['message', 'edited_message'], async (ctx, next) => {
    const message = ctx.msg;
    const chatId = message.chat.id;
    // Other chats only reach /groupid, which an admin uses to set Herald up
    if (!inGroup(chatId)) return next();
    // A join notice: check each new member who isn't already held back (a member who left while muted), then
    // remove the notice, as with leave notices, which clutter the chat
    if (message.new_chat_members) {
      for (const member of message.new_chat_members) {
        const status = member.is_bot ? null : await ctx.api.getChatMember(chatId, member.id).catch(() => null);
        if (status?.status !== 'restricted') await checkNewcomer(ctx, chatId, member, message.from);
      }
    }
    if (message.new_chat_members || message.left_chat_member) return quietly(ctx.api.deleteMessage(chatId, message.message_id));
    // The group's linked channel relays its posts, and anonymous admins post as the group
    if (message.is_automatic_forward || message.sender_chat?.id === chatId) return next();
    const user = message.from;
    if (!user || (await isAdmin(ctx, chatId, user))) return next();

    if (message.sender_chat) {
      await quietly(ctx.api.deleteMessage(chatId, message.message_id));
      return quietly(ctx.api.banChatSenderChat(chatId, message.sender_chat.id));
    }
    if (await impostor(ctx, chatId, user)) {
      await quietly(ctx.api.deleteMessage(chatId, message.message_id));
      return ban(ctx, chatId, user, 'a name made to look like Hermes staff');
    }
    if (strikes.flooding(user.id)) {
      await quietly(ctx.api.deleteMessage(chatId, message.message_id));
      await mute(ctx, chatId, user, 10 * 60_000, 'flooding');
      return warn(ctx, chatId, `${name(user)} is muted for 10 minutes for flooding.`);
    }

    const finding = inspect({
      text: message.text ?? message.caption ?? '',
      urls: linksIn(message),
      forwarded: !!message.forward_origin,
      newcomer: Date.now() - (verifiedAt.get(user.id) ?? 0) < NEWCOMER_MS,
    });
    if (!finding) return next();

    await quietly(ctx.api.deleteMessage(chatId, message.message_id));
    const newcomer = Date.now() - (verifiedAt.get(user.id) ?? 0) < NEWCOMER_MS;
    const penalty = finding.scam && newcomer ? 'ban' : strikes.add(user.id);
    logger.info(`Herald removed a message from ${user.id} (${name(user)}): ${finding.reason}`);
    if (penalty === 'ban') return ban(ctx, chatId, user, finding.reason);
    if (penalty === 'mute') {
      await mute(ctx, chatId, user, 24 * 60 * 60_000, finding.reason);
      return warn(ctx, chatId, `I removed a message from ${name(user)}: ${finding.reason}. Muted for a day. Next time is a ban.`);
    }
    return warn(ctx, chatId, `I removed a message from ${name(user)}: ${finding.reason}. Next time is a day's mute.`);
  });

  // An admin checks Herald's setup here: each line says what is wrong and what to change
  bot.command('status', async (ctx) => {
    if (ctx.chat.type === 'private' || !ctx.from || !(await isAdmin(ctx, ctx.chat.id, ctx.from))) return;
    const here = ctx.chat.id;
    const lines = ['Herald status'];
    lines.push(
      ctx.chat.type === 'supergroup'
        ? 'Group: supergroup, ok'
        : 'Group: basic group. The welcome check needs a supergroup: set Chat history for new members to Visible.'
    );
    lines.push(
      options.groupId === null || Number.isNaN(options.groupId)
        ? groupIdProblem(here)
        : inGroup(here)
          ? 'TELEGRAM_GROUP_ID: this group, ok'
          : `TELEGRAM_GROUP_ID: ${options.groupId}, not this group. Set it to ${here} on Render.`
    );
    const me = await ctx.api.getChatMember(here, ctx.me.id).catch(() => null);
    if (me?.status === 'administrator') {
      const missing = [!me.can_delete_messages && 'Delete messages', !me.can_restrict_members && 'Ban users'].filter(Boolean);
      lines.push(missing.length ? `Admin rights: missing ${missing.join(' and ')}. Turn them on.` : 'Admin rights: ok');
    } else {
      lines.push('Admin: no. Make me an admin with Delete messages and Ban users.');
    }
    const hook = await ctx.api.getWebhookInfo().catch(() => null);
    if (hook) {
      lines.push(hook.allowed_updates?.includes('chat_member') ? 'Join updates: on' : 'Join updates: off. Restart the API on Render.');
      if (hook.last_error_message) lines.push(`Last delivery error: ${hook.last_error_message}`);
    }
    lines.push(answersEnabled() ? 'Answers: on' : 'Answers: off until ANTHROPIC_API_KEY is set');
    await ctx.reply(lines.join('\n'));
  });

  // An admin finds the group's id here, for TELEGRAM_GROUP_ID
  bot.command('groupid', async (ctx) => {
    if (ctx.chat.type === 'private' || !ctx.from || !(await isAdmin(ctx, ctx.chat.id, ctx.from))) return;
    await ctx.reply(`This group's id is ${ctx.chat.id}. Set TELEGRAM_GROUP_ID to it on Render.`);
  });

  bot.command('rules', (ctx) => (inGroup(ctx.chat.id) ? ctx.reply(RULES_TEXT) : undefined));
  bot.command(['help', 'start'], (ctx) =>
    inGroup(ctx.chat.id) ? ctx.reply(HELP_TEXT, { link_preview_options: { is_disabled: true } }) : undefined
  );

  bot.command('ask', async (ctx) => {
    if (!inGroup(ctx.chat.id) || !ctx.from) return;
    const text = ctx.match.trim();
    if (!text) {
      await ctx.reply('Ask after the command, for example: /ask How does the Safety Score work?');
      return;
    }
    reply(ctx, ctx.msg, ctx.from, text, true);
  });

  // Questions: a mention, a reply to Herald, or on his own a member's question about Hermes
  bot.on('message:text', async (ctx) => {
    if (!inGroup(ctx.chat.id) || !ctx.from || ctx.msg.text.startsWith('/')) return;
    const text = ctx.msg.text;
    const mention = `@${ctx.me.username}`.toLowerCase();
    const mentioned = text.toLowerCase().includes(mention);
    const repliedToHerald = ctx.msg.reply_to_message?.from?.id === ctx.me.id;
    if (mentioned || repliedToHerald) {
      return reply(ctx, ctx.msg, ctx.from, text.replace(new RegExp(mention, 'ig'), '').trim() || text, true);
    }
    // Members talking to each other in replies, and admins, are left alone
    if (!autoAnswer || ctx.msg.reply_to_message || (await isAdmin(ctx, ctx.chat.id, ctx.from))) return;
    if (QUESTION.test(text) && TOPIC.test(text) && text.length >= 12) reply(ctx, ctx.msg, ctx.from, text, false);
  });

  // Runs after the webhook has answered Telegram: an answer can take a few seconds
  function reply(ctx: Context, message: Message, from: User, text: string, asked: boolean) {
    void (async () => {
      if (!answersEnabled() && !options.ask) {
        if (asked) await quietly(ctx.reply('I can\'t answer questions yet. The Docs have the answers: hermesagg.xyz/docs'));
        return;
      }
      if (!mayAnswer(from.id)) return;
      await quietly(ctx.api.sendChatAction(message.chat.id, 'typing'));
      const replyingTo = message.reply_to_message?.text ?? message.reply_to_message?.caption;
      const said = await ask({ name: from.first_name, text, replyingTo });
      if (!said) {
        if (asked) await quietly(ctx.reply('I don\'t have a good answer for that. The Docs may: hermesagg.xyz/docs', { reply_parameters: { message_id: message.message_id } }));
        return;
      }
      await quietly(
        ctx.api.sendMessage(message.chat.id, said, {
          reply_parameters: { message_id: message.message_id },
          link_preview_options: { is_disabled: true },
        })
      );
    })();
  }

  bot.catch((error) => logger.warn(`Herald: ${error.error instanceof Error ? error.error.message : error.error}`));
  return bot;
}

// Every link in a message: typed links, hidden text links, and the same in captions
function linksIn(message: Message): string[] {
  const text = message.text ?? message.caption ?? '';
  const entities = message.entities ?? message.caption_entities ?? [];
  const links: string[] = [];
  for (const entity of entities) {
    if (entity.type === 'url') links.push(text.slice(entity.offset, entity.offset + entity.length));
    if (entity.type === 'text_link') links.push(entity.url);
  }
  return links;
}

// ---------- Wiring to Telegram ----------

const bot = TOKEN ? createHeraldBot({ token: TOKEN, groupId: GROUP_ID }) : null;
// Telegram sends this with every update, so only Telegram can call the webhook
const secretToken = TOKEN ? createHash('sha256').update(TOKEN).digest('hex') : '';

function fromTelegram(given: string | undefined): boolean {
  const a = Buffer.from(given ?? '');
  const b = Buffer.from(secretToken);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * The webhook route. The secret is checked before anything else, and no error can escape: Express 4 doesn't catch
 * a failed async handler, and an unhandled rejection would stop the whole API. A slow update (an answer waiting on
 * Claude) returns to Telegram after 9 seconds and finishes on its own.
 */
export function heraldWebhook(): { path: string; handler: RequestHandler } | null {
  if (!bot) return null;
  const handle = webhookCallback(bot, 'express', { secretToken, onTimeout: 'return', timeoutMilliseconds: 9_000 });
  const handler: RequestHandler = (req, res) => {
    if (!fromTelegram(req.header('X-Telegram-Bot-Api-Secret-Token'))) {
      res.sendStatus(401);
      return;
    }
    handle(req, res).catch((error: unknown) => {
      logger.warn(`Herald webhook: ${error instanceof Error ? error.message : error}`);
      // Telegram sends the update again later
      if (!res.headersSent) res.sendStatus(500);
    });
  };
  return { path: WEBHOOK_PATH, handler };
}

/**
 * Point Telegram at this server's webhook. Render gives the service its public address in RENDER_EXTERNAL_URL.
 */
export async function startHerald(): Promise<void> {
  if (!bot) return;
  const base = process.env.TELEGRAM_WEBHOOK_BASE || process.env.RENDER_EXTERNAL_URL;
  if (!base) {
    logger.warn('Herald is off: no public address for the webhook (RENDER_EXTERNAL_URL or TELEGRAM_WEBHOOK_BASE)');
    return;
  }
  try {
    await bot.init();
    await bot.api.setWebhook(`${base.replace(/\/$/, '')}${WEBHOOK_PATH}`, {
      secret_token: secretToken,
      allowed_updates: ['message', 'edited_message', 'callback_query', 'chat_member', 'my_chat_member'],
    });
    logger.info(
      `Herald is on as @${bot.botInfo.username}${GROUP_ID === null ? ': set TELEGRAM_GROUP_ID (send /groupid in the group)' : ` in ${GROUP_ID}`}${answersEnabled() ? '' : ', answers off (no ANTHROPIC_API_KEY)'}`
    );
  } catch (error) {
    logger.warn(`Herald could not start: ${error instanceof Error ? error.message : error}`);
  }
}
