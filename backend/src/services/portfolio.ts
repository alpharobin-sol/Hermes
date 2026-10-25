import axios, { AxiosInstance } from 'axios';
import { AccountInfo, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID, unpackAccount } from '@solana/spl-token';
import { logger } from '../utils/logger';
import { Category, InputToken, KAMINO_MAIN_MARKET, ROUTES, RouteConfig, TokenInfo, TOKENS } from '../registry/routes';
import { cached, Cached } from './cache';
import { connection, getRate, http, solPrice, tokenPrices } from './rates';
import { createJupiterClient } from './jupiter';
import { getYieldRoutes } from './yields';
import { Project0Deposit, project0Account, PROJECT0_PROGRAM, readBank, readPosition } from './project0';

/**
 * PORTFOLIO
 * What a wallet holds in each route Hermes lists and what it has earned, read from the chain and the protocols.
 * Mainnet only, whatever network deposits run on.
 *
 * - Liquid staking: the wallet's token account for each LST, read as plain accounts. Worth the tokens times their
 *   SOL value in the pool. Earned: that value minus the SOL the wallet paid for the tokens it still holds, network
 *   fees aside, from the history of that token account. Needs SOLANA_HISTORY_RPC_URL, an RPC that keeps full
 *   history (Helius, for example). Without it, or when tokens came from another wallet or another token, Hermes
 *   leaves earned out and says why. Up to 200 transactions per token account.
 * - Kamino Lend: the wallet's Kamino accounts (obligations) from Kamino's API. Deposits turn into tokens at the
 *   reserve's exchange rate. Earned: Kamino's record of the interest each deposit has earned.
 * - Jupiter Lend: Jupiter's API for what the wallet's jl tokens are worth. Earned: that value minus what was paid in,
 *   from the wallet's history like liquid staking. Jupiter's own earnings figure stops at the wallet's last
 *   transaction, so Hermes doesn't use it.
 * - Kamino vaults: the wallet's vault shares from Kamino's API, staked or not, worth the shares times what one share
 *   holds. Earned: that value minus what was paid in, from Kamino's record of the wallet's vault deposits and
 *   withdrawals. Shares that came another way leave earned out.
 * - Project 0: the wallet's Project 0 accounts that Hermes opens (one per token, at a fixed address), read on chain.
 *   Earned: the value minus what went in, from that account's history through SOLANA_HISTORY_RPC_URL. Deposits made in
 *   Project 0's own app sit in other accounts and show there.
 *
 * A source that fails is named in `unavailable`, never counted as empty. Each wallet's answer is kept 60 seconds.
 */

export interface Position {
  routeId: string;
  name: string;
  category: Category;
  token: InputToken; // what value and earned are counted in
  holding: { amount: number; symbol: string }; // what the wallet holds: 1.2041 JitoSOL, or 500 USDC in Kamino
  value: number | null; // in `token`, null when the route has no live value right now
  valueUsd: number | null;
  earned: number | null; // in `token`, null when Hermes can't tell
  earnedUsd: number | null;
  earnedNote: string | null; // why earned is missing
  since: string | null; // when the wallet got the tokens it holds, when known
  apy: number | null; // today's APY
  safety: number | null; // today's Safety Score
  website: string; // where to manage it
  source: string; // where the numbers come from
  note: string | null; // anything else the holder should know
}

export interface Portfolio {
  address: string;
  positions: Position[];
  totalUsd: number | null; // null when a position's value can't be priced right now, never a short total
  earnedUsd: number | null; // positions with a known earned, null when none
  prices: Partial<Record<InputToken, number>>; // USD, for the wallet's own SOL, USDC and USDT too
  unavailable: string[]; // sources that didn't answer, so their positions are missing
  history: boolean; // whether Hermes can read wallet history, which liquid staking's earned needs
  updatedAt: string;
}

const CACHE_MS = 60_000;
const RETRY_NOTE = "Earned didn't load. Try again.";
const MAX_WALLETS = 2000;
const LAMPORTS = 1e9;

const kaminoApi = process.env.KAMINO_API_URL || 'https://api.kamino.finance';
const lendApi = createJupiterClient('lend/v1', process.env.JUPITER_LEND_API_URL);

const LST_ROUTES = ROUTES.filter((route) => route.category === 'liquid-staking' && route.receipt);
const KAMINO_ROUTES = ROUTES.filter((route) => route.source.kind === 'kamino');
const JUPITER_LEND_ROUTES = ROUTES.filter((route) => route.source.kind === 'jupiter-lend' && route.receipt);
const VAULT_ROUTES = ROUTES.filter((route) => route.source.kind === 'kamino-vault');
const PROJECT0_ROUTES = ROUTES.filter((route) => route.direct?.kind === 'project0');

// ---------- Wallet history, for what liquid staking has earned ----------

const historyUrl = process.env.SOLANA_HISTORY_RPC_URL;
const historyRpc: AxiosInstance | null = historyUrl ? axios.create({ baseURL: historyUrl, timeout: 20_000 }) : null;
// Above this many transactions on one token account, Hermes doesn't try to add them up
const MAX_HISTORY = 200;
// History requests in flight at once, across every wallet, so a free RPC plan's rate limit holds
const HISTORY_CONCURRENCY = Number(process.env.HISTORY_RPC_CONCURRENCY || 4);
let inFlight = 0;
const queued: (() => void)[] = [];

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  if (!historyRpc) throw new Error('no history RPC');
  // A finished request hands its slot straight to the next one waiting
  if (inFlight >= HISTORY_CONCURRENCY) await new Promise<void>((resolve) => queued.push(resolve));
  else inFlight += 1;
  try {
    return await rpcCall<T>(historyRpc, method, params);
  } finally {
    const next = queued.shift();
    if (next) next();
    else inFlight -= 1;
  }
}

async function rpcCall<T>(historyRpc: AxiosInstance, method: string, params: unknown[]): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const response = await historyRpc.post('', { jsonrpc: '2.0', id: 1, method, params });
      const error = response.data?.error;
      // Some RPCs answer a rate limit as a 200 with a 429 error inside
      if (error?.code === 429 && attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
        continue;
      }
      if (error) throw new Error(error.message ?? `RPC error ${error.code}`);
      return response.data.result as T;
    } catch (error) {
      const status = axios.isAxiosError(error) ? error.response?.status : undefined;
      if ((status === 429 || status === 503) && attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
        continue;
      }
      throw error;
    }
  }
}

export interface Change {
  at: number | null; // ms
  tokens: number; // change in the wallet's receipt token (an LST or a jl token)
  paid: number; // change in what the route takes. SOL counts wrapped SOL and token account rent as the wallet's, network fee aside.
}

// A transaction's changes never change, so each is read once
const changes = new Map<string, Change | null>();
const MAX_CHANGES = 20_000;

async function changeIn(signature: string, owner: string, receipt: TokenInfo, asset: TokenInfo): Promise<Change | null> {
  const key = `${signature}:${owner}:${receipt.mint}:${asset.mint}`;
  if (changes.has(key)) return changes.get(key)!;
  const tx = await rpc<any>('getTransaction', [
    signature,
    { encoding: 'jsonParsed', maxSupportedTransactionVersion: 1, commitment: 'confirmed' },
  ]);
  let change: Change | null = null;
  if (tx?.meta && !tx.meta.err) {
    const keys: string[] = (tx.transaction?.message?.accountKeys ?? []).map((k: any) => (typeof k === 'string' ? k : k.pubkey));
    const pre: number[] = tx.meta.preBalances ?? [];
    const post: number[] = tx.meta.postBalances ?? [];
    const ownerIndex = keys.indexOf(owner);
    let lamports = ownerIndex >= 0 ? post[ownerIndex] - pre[ownerIndex] : 0;
    if (ownerIndex === 0) lamports += Number(tx.meta.fee ?? 0);

    // The wallet's token accounts in this transaction. Their SOL (rent, and wrapped SOL) still belongs to the wallet.
    const touched = new Map<number, string>();
    const amounts = new Map<number, { pre: number; post: number }>();
    for (const [list, side] of [
      [tx.meta.preTokenBalances ?? [], 'pre'],
      [tx.meta.postTokenBalances ?? [], 'post'],
    ] as const) {
      for (const balance of list as any[]) {
        if (balance.owner !== owner) continue;
        touched.set(balance.accountIndex, balance.mint);
        const entry = amounts.get(balance.accountIndex) ?? { pre: 0, post: 0 };
        entry[side] = Number(balance.uiTokenAmount?.amount ?? 0);
        amounts.set(balance.accountIndex, entry);
      }
    }
    let tokens = 0;
    let paidRaw = 0;
    for (const [index, accountMint] of touched) {
      lamports += (post[index] ?? 0) - (pre[index] ?? 0);
      const entry = amounts.get(index)!;
      if (accountMint === receipt.mint) tokens += entry.post - entry.pre;
      if (accountMint === asset.mint) paidRaw += entry.post - entry.pre;
    }
    const paid = asset.mint === TOKENS.SOL.mint ? lamports / LAMPORTS : paidRaw / 10 ** asset.decimals;
    change = { at: tx.blockTime ? tx.blockTime * 1000 : null, tokens: tokens / 10 ** receipt.decimals, paid };
  }
  if (changes.size >= MAX_CHANGES) changes.delete(changes.keys().next().value!);
  changes.set(key, change);
  return change;
}

interface Earned {
  earned: number | null;
  note: string | null;
  since: number | null;
}

/**
 * What a position held as a token (an LST or a jl token) has earned: its value now, in what the route takes,
 * minus what was paid for the tokens still held. Walks the token account's history oldest first.
 * `tokenValue` is what one receipt token is worth now, in the route's token.
 */
async function earnedFromHistory(owner: string, account: PublicKey, route: RouteConfig, balance: number, tokenValue: number): Promise<Earned> {
  const receipt = route.receipt!;
  const symbol = receipt.symbol;
  if (!historyRpc) return { earned: null, note: null, since: null };
  const signatures = await rpc<any[]>('getSignaturesForAddress', [account.toBase58(), { limit: MAX_HISTORY }]);
  if (signatures.length >= MAX_HISTORY) {
    return { earned: null, note: `Earned unknown: too much ${symbol} history to add up.`, since: null };
  }
  const ordered = signatures.filter((s) => !s.err).reverse();
  const found: (Change | null)[] = new Array(ordered.length).fill(null);
  let next = 0;
  await Promise.all(
    Array.from({ length: HISTORY_CONCURRENCY }, async () => {
      while (next < ordered.length) {
        const i = next++;
        found[i] = await changeIn(ordered[i].signature, owner, receipt, TOKENS[route.token]);
      }
    })
  );

  const basis = costBasis(found, tokenValue, receipt.decimals);
  const dust = 10 ** -receipt.decimals;
  if (Math.abs(basis.held - balance) > Math.max(dust * 10, balance * 1e-6)) {
    return { earned: null, note: `Earned unknown: the ${symbol} history doesn't match the balance.`, since: null };
  }
  if (basis.unknownCost) {
    return { earned: null, note: `Earned unknown: some ${symbol} came from another wallet or token.`, since: basis.since };
  }
  return { earned: balance * tokenValue - basis.cost, note: null, since: basis.since };
}

/**
 * What was paid for the tokens still held, from changes oldest first. A sale or transfer out takes its share of the
 * cost with it, and selling everything starts over. Tokens that didn't come for about their value in the route's
 * token (from another wallet, or swapped from another token) make the cost unknown.
 */
export function costBasis(found: (Change | null)[], tokenValue: number, decimals: number) {
  const dust = 10 ** -decimals;
  let held = 0;
  let cost = 0;
  let since: number | null = null;
  let unknownCost = false;
  for (const change of found) {
    if (!change) continue;
    if (change.tokens > dust) {
      // Paid at about the token's value in the route's token: a stake, a deposit or a swap from that token
      const perToken = -change.paid / change.tokens;
      if (perToken >= 0.5 * tokenValue && perToken <= 1.5 * tokenValue) cost += -change.paid;
      else unknownCost = true;
      if (held <= dust) since = change.at;
      held += change.tokens;
    } else if (change.tokens < -dust) {
      if (held > dust) cost *= Math.max(0, held + change.tokens) / held;
      held += change.tokens;
      if (held <= dust) {
        held = 0;
        cost = 0;
        since = null;
        unknownCost = false;
      }
    }
  }
  return { held, cost, since, unknownCost };
}

// ---------- Sources ----------

type Found = Omit<Position, 'name' | 'category' | 'token' | 'valueUsd' | 'earnedUsd' | 'apy' | 'safety' | 'website'> & {
  route: RouteConfig;
};

async function liquidStaking(owner: PublicKey): Promise<Found[]> {
  // Every receipt token today is a classic SPL token, held in the wallet's associated token account.
  // Off-curve owners (multisig vaults) have them too.
  const accounts = LST_ROUTES.map((route) =>
    getAssociatedTokenAddressSync(new PublicKey(route.receipt!.mint), owner, true, TOKEN_PROGRAM_ID)
  );
  // Free RPCs cap a multiple-account read at 10
  const infos: (AccountInfo<Buffer> | null)[] = [];
  for (let i = 0; i < accounts.length; i += 10) infos.push(...(await connection.getMultipleAccountsInfo(accounts.slice(i, i + 10))));

  const held = LST_ROUTES.flatMap((route, i) => {
    const info = infos[i];
    if (!info) return [];
    const amount = Number(unpackAccount(accounts[i], info, TOKEN_PROGRAM_ID).amount) / 10 ** route.receipt!.decimals;
    return amount > 0 ? [{ route, account: accounts[i], amount }] : [];
  });

  return Promise.all(
    held.map(async ({ route, account, amount }): Promise<Found> => {
      const tokenValue = (await getRate(route.source))?.tokenValue ?? null;
      let earned: Earned = { earned: null, note: null, since: null };
      if (tokenValue) {
        try {
          earned = await earnedFromHistory(owner.toBase58(), account, route, amount, tokenValue);
        } catch (error) {
          logger.info(`Portfolio history failed for ${route.id}: ${error instanceof Error ? error.message : error}`);
          earned = { earned: null, note: RETRY_NOTE, since: null };
        }
      }
      return {
        route,
        routeId: route.id,
        holding: { amount, symbol: route.receipt!.symbol },
        value: tokenValue ? amount * tokenValue : null,
        earned: earned.earned,
        earnedNote: earned.note,
        since: earned.since ? new Date(earned.since).toISOString() : null,
        source: historyRpc ? 'On-chain: your token account and its history' : 'On-chain: your token account',
        note: null,
      };
    })
  );
}

// Kamino reserve exchange rate (collateral per token), kept 10 minutes per reserve
const exchangeRates = new Map<string, Cached<{ rate: number; decimals: number }>>();

function kaminoExchangeRate(reserve: string) {
  let entry = exchangeRates.get(reserve);
  if (!entry) {
    entry = cached(
      `Kamino exchange rate for ${reserve}`,
      async () => {
        const end = new Date();
        const start = new Date(end.getTime() - 3 * 60 * 60 * 1000);
        const { data } = await http.get(`${kaminoApi}/kamino-market/${KAMINO_MAIN_MARKET}/reserves/${reserve}/metrics/history`, {
          params: { env: 'mainnet-beta', start: start.toISOString(), end: end.toISOString(), frequency: 'hour' },
        });
        const history: any[] = Array.isArray(data?.history) ? data.history : [];
        const metrics = history[history.length - 1]?.metrics;
        const rate = Number(metrics?.exchangeRate);
        const decimals = Number(metrics?.decimals);
        if (!(rate > 0) || !Number.isInteger(decimals)) throw new Error('no exchange rate');
        return { rate, decimals };
      },
      { ttlMs: 10 * 60 * 1000, maxStaleMs: 2 * 60 * 60 * 1000 }
    );
    exchangeRates.set(reserve, entry);
  }
  return entry.get();
}

async function kamino(owner: string): Promise<Found[]> {
  const { data } = await http.get(`${kaminoApi}/kamino-market/${KAMINO_MAIN_MARKET}/users/${owner}/obligations`, {
    params: { env: 'mainnet-beta' },
  });
  const obligations: any[] = Array.isArray(data) ? data : [];
  const byRoute = new Map<string, Found>();

  for (const obligation of obligations) {
    const deposits = ((obligation.state?.deposits ?? []) as any[]).filter((deposit) => {
      const route = KAMINO_ROUTES.find((r) => r.source.kind === 'kamino' && r.source.reserve === deposit.depositReserve);
      return route && Number(deposit.depositedAmount) > 0;
    });
    if (deposits.length === 0) continue;

    // Interest each reserve has earned in this account, from Kamino's own record
    const { data: fees } = await http.get(
      `${kaminoApi}/v2/kamino-market/${KAMINO_MAIN_MARKET}/obligations/${obligation.obligationAddress}/interest-fees`,
      { params: { env: 'mainnet-beta' } }
    );
    const earnedByReserve = new Map<string, number>();
    const history: any[] = fees?.historicalFeesObligation?.[obligation.obligationAddress] ?? [];
    for (const entry of history) {
      for (const [reserve, value] of Object.entries<any>(entry)) {
        earnedByReserve.set(reserve, (earnedByReserve.get(reserve) ?? 0) + (Number(value?.nativeFees) || 0));
      }
    }
    const borrows = Number(obligation.refreshedStats?.userTotalBorrow) > 0;

    for (const deposit of deposits) {
      const route = KAMINO_ROUTES.find((r) => r.source.kind === 'kamino' && r.source.reserve === deposit.depositReserve)!;
      const exchange = await kaminoExchangeRate(deposit.depositReserve);
      if (!exchange) throw new Error('no Kamino exchange rate');
      const amount = Number(deposit.depositedAmount) / 10 ** exchange.decimals / exchange.rate;
      const earned = earnedByReserve.get(deposit.depositReserve) ?? 0;
      const current = byRoute.get(route.id);
      byRoute.set(route.id, {
        route,
        routeId: route.id,
        holding: { amount: (current?.holding.amount ?? 0) + amount, symbol: route.token },
        value: (current?.value ?? 0) + amount,
        earned: (current?.earned ?? 0) + earned,
        earnedNote: null,
        since: null,
        source: 'Kamino',
        note: current?.note ?? (borrows ? 'This Kamino account also borrows. Kamino shows the full position.' : null),
      });
    }
  }
  return [...byRoute.values()];
}

/**
 * What the wallet has deposited in one Kamino reserve through its main Kamino account (the one Hermes deposits into
 * and Kamino's withdraw transaction draws from), in the reserve's token. 0 when it has none.
 */
export async function kaminoDeposit(owner: string, reserve: string): Promise<{ amount: number; borrows: boolean }> {
  const { data } = await http.get(`${kaminoApi}/kamino-market/${KAMINO_MAIN_MARKET}/users/${owner}/obligations`, {
    params: { env: 'mainnet-beta' },
  });
  const main = (Array.isArray(data) ? data : []).find((obligation: any) => Number(obligation.obligationTag) === 0);
  const deposit = (main?.state?.deposits ?? []).find((d: any) => d.depositReserve === reserve && Number(d.depositedAmount) > 0);
  if (!deposit) return { amount: 0, borrows: false };
  const exchange = await kaminoExchangeRate(reserve);
  if (!exchange) throw new Error('no Kamino exchange rate');
  return {
    amount: Number(deposit.depositedAmount) / 10 ** exchange.decimals / exchange.rate,
    borrows: Number(main.refreshedStats?.userTotalBorrow) > 0,
  };
}

/**
 * The vault shares the wallet holds in each Kamino vault, staked or not, from Kamino's API. In shares, UI units.
 */
export async function kaminoVaultShares(owner: string): Promise<Map<string, number>> {
  const { data } = await http.get(`${kaminoApi}/kvaults/users/${owner}/positions`);
  const shares = new Map<string, number>();
  for (const position of Array.isArray(data) ? data : []) {
    const total = Number(position?.totalShares);
    if (typeof position?.vaultAddress === 'string' && total > 0) shares.set(position.vaultAddress, total);
  }
  return shares;
}

async function jupiterLend(owner: string): Promise<Found[]> {
  const { data } = await lendApi.get('/earn/positions', { params: { users: owner } });
  const held = (Array.isArray(data) ? data : []).flatMap((position: any) => {
    const route = JUPITER_LEND_ROUTES.find((r) => r.receipt!.mint === position.token?.address);
    const decimals = Number(position.token?.asset?.decimals);
    const shares = Number(position.shares);
    if (!route || !(shares > 0) || !Number.isInteger(decimals)) return [];
    return [{ route, shares: shares / 10 ** route.receipt!.decimals, value: Number(position.underlyingAssets) / 10 ** decimals }];
  });

  // Jupiter's own earnings figure stops at the wallet's last transaction, so earned comes from the wallet's history
  return Promise.all(
    held.map(async ({ route, shares, value }): Promise<Found> => {
      const account = getAssociatedTokenAddressSync(new PublicKey(route.receipt!.mint), new PublicKey(owner), true, TOKEN_PROGRAM_ID);
      let earned: Earned = { earned: null, note: null, since: null };
      try {
        earned = await earnedFromHistory(owner, account, route, shares, value / shares);
      } catch (error) {
        logger.info(`Portfolio history failed for ${route.id}: ${error instanceof Error ? error.message : error}`);
        earned = { earned: null, note: RETRY_NOTE, since: null };
      }
      return {
        route,
        routeId: route.id,
        holding: { amount: shares, symbol: route.receipt!.symbol },
        value,
        earned: earned.earned,
        earnedNote: earned.note,
        since: earned.since ? new Date(earned.since).toISOString() : null,
        source: historyRpc ? 'Jupiter Lend, and your token account history' : 'Jupiter Lend',
        note: null,
      };
    })
  );
}

// What a vault position has earned, from Kamino's record of the wallet's deposits into and withdrawals from the vault.
// Shares change hands at what they hold, so the cost basis works like a staking token's.
function vaultEarned(transactions: any[], shares: number, tokenValue: number, decimals: number): Earned {
  const found: Change[] = transactions
    .map((t) => ({ at: Date.parse(t?.createdOn), kind: t?.instruction, shares: Number(t?.numberOfShares), tokens: Number(t?.tokenAmount) }))
    .filter((t) => Number.isFinite(t.at) && t.shares > 0 && t.tokens > 0 && (t.kind === 'deposit' || t.kind === 'withdraw'))
    .sort((a, b) => a.at - b.at)
    .map((t) => (t.kind === 'deposit' ? { at: t.at, tokens: t.shares, paid: -t.tokens } : { at: t.at, tokens: -t.shares, paid: t.tokens }));
  const basis = costBasis(found, tokenValue, decimals);
  if (Math.abs(basis.held - shares) > Math.max(10 ** -decimals * 10, shares * 1e-6)) {
    return { earned: null, note: "Earned unknown: Kamino's record of this vault doesn't match the shares held.", since: null };
  }
  if (basis.unknownCost) return { earned: null, note: 'Earned unknown: some shares came another way.', since: basis.since };
  return { earned: shares * tokenValue - basis.cost, note: null, since: basis.since };
}

async function kaminoVaults(owner: string): Promise<Found[]> {
  const shares = await kaminoVaultShares(owner);
  const held = VAULT_ROUTES.flatMap((route) => {
    const amount = route.source.kind === 'kamino-vault' ? shares.get(route.source.vault) : undefined;
    return amount ? [{ route, amount }] : [];
  });
  if (held.length === 0) return [];

  let transactions: any[] | null = null;
  try {
    const { data } = await http.get(`${kaminoApi}/kvaults/users/${owner}/transactions`);
    transactions = Array.isArray(data) ? data : null;
  } catch (error) {
    logger.info(`Kamino vault history failed for ${owner}: ${error instanceof Error ? error.message : error}`);
  }

  return Promise.all(
    held.map(async ({ route, amount }): Promise<Found> => {
      const vault = route.source.kind === 'kamino-vault' ? route.source.vault : '';
      const tokenValue = (await getRate(route.source))?.tokenValue ?? null;
      const decimals = route.direct?.kind === 'kamino-vault' ? route.direct.shares.decimals : TOKENS[route.token].decimals;
      const earned: Earned = !tokenValue
        ? { earned: null, note: null, since: null }
        : transactions
          ? vaultEarned(transactions.filter((t) => t?.kvault === vault), amount, tokenValue, decimals)
          : { earned: null, note: RETRY_NOTE, since: null };
      const value = tokenValue ? amount * tokenValue : null;
      return {
        route,
        routeId: route.id,
        // Shown in the token, like Kamino Lend: the shares are staked for the wallet, not a token it sees
        holding: { amount: value ?? amount, symbol: value !== null ? route.token : 'shares' },
        value,
        earned: earned.earned,
        earnedNote: earned.note,
        since: earned.since ? new Date(earned.since).toISOString() : null,
        source: 'Kamino',
        note: null,
      };
    })
  );
}

// What a transaction on a Project 0 account did: the wallet's change in the token, and whether it opened or closed the
// account
interface Project0Change {
  at: number | null;
  paid: number;
  opened: boolean;
  closed: boolean;
}
const project0Changes = new Map<string, Project0Change | null>();

async function project0Change(signature: string, owner: string, account: string, token: TokenInfo) {
  const key = `${signature}:${owner}:${token.mint}`;
  if (project0Changes.has(key)) return project0Changes.get(key)!;
  const tx = await rpc<any>('getTransaction', [signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 1, commitment: 'confirmed' }]);
  let change: Project0Change | null = null;
  if (tx?.meta && !tx.meta.err) {
    const keys: string[] = (tx.transaction?.message?.accountKeys ?? []).map((k: any) => (typeof k === 'string' ? k : k.pubkey));
    const sum = (balances: any[] | undefined) =>
      (balances ?? []).filter((b) => b.owner === owner && b.mint === token.mint).reduce((total, b) => total + Number(b.uiTokenAmount?.amount ?? 0), 0);
    const index = keys.indexOf(account);
    const before = Number(tx.meta.preBalances?.[index]);
    const after = Number(tx.meta.postBalances?.[index]);
    change = {
      at: tx.blockTime ? tx.blockTime * 1000 : null,
      paid: (sum(tx.meta.postTokenBalances) - sum(tx.meta.preTokenBalances)) / 10 ** token.decimals,
      opened: index >= 0 && before === 0 && after > 0,
      closed: index >= 0 && before > 0 && after === 0,
    };
  }
  if (project0Changes.size >= MAX_CHANGES) project0Changes.delete(project0Changes.keys().next().value!);
  project0Changes.set(key, change);
  return change;
}

/**
 * What a Project 0 position has earned: its value now minus what went in, from the history of the wallet's Hermes
 * account. That account holds only this token, so what left the wallet in its transactions went in, and what came
 * back came out. The count runs from the transaction that opened the account; closing it starts over. A history that
 * doesn't start with the opening can't be added up.
 */
export async function project0Earned(owner: string, account: PublicKey, token: TokenInfo, value: number): Promise<Earned> {
  if (!historyRpc) return { earned: null, note: null, since: null };
  const signatures = await rpc<any[]>('getSignaturesForAddress', [account.toBase58(), { limit: MAX_HISTORY }]);
  if (signatures.length >= MAX_HISTORY) return { earned: null, note: 'Earned unknown: too much history to add up.', since: null };
  const ordered = signatures.filter((s) => !s.err).reverse();
  const found = await Promise.all(ordered.map((s) => project0Change(s.signature, owner, account.toBase58(), token)));
  let net = 0;
  let since: number | null = null;
  let open = false;
  for (const change of found) {
    if (!change) continue;
    if (change.opened) {
      open = true;
      net = 0;
      since = change.at;
    }
    net -= change.paid;
    if (change.closed) open = false;
  }
  if (!open) return { earned: null, note: "Earned unknown: the account is older than the history Hermes can read.", since: null };
  // More came out than went in, or nothing went in: deposits or withdrawals happened another way
  if (!(net > 0)) return { earned: null, note: "Earned unknown: the account's history doesn't add up.", since: null };
  return { earned: value - net, note: null, since };
}

async function project0(owner: PublicKey): Promise<Found[]> {
  const accounts = PROJECT0_ROUTES.map((route) => project0Account(route.direct as Project0Deposit, owner));
  const banks = PROJECT0_ROUTES.map((route) => new PublicKey((route.direct as Project0Deposit).bank));
  const infos = await connection.getMultipleAccountsInfo([...banks, ...accounts]);
  const held = PROJECT0_ROUTES.flatMap((route, i) => {
    const info = infos[banks.length + i];
    if (!info?.owner.equals(PROJECT0_PROGRAM)) return [];
    const bankInfo = infos[i];
    if (!bankInfo) throw new Error('no Project 0 bank');
    const direct = route.direct as Project0Deposit;
    const position = readPosition(accounts[i], info, direct, readBank(bankInfo.owner, bankInfo.data, direct.group), owner);
    const amount = position.amount.div(10 ** TOKENS[route.token].decimals).toNumber();
    return amount > 0 ? [{ route, position, amount }] : [];
  });

  return Promise.all(
    held.map(async ({ route, position, amount }): Promise<Found> => {
      let earned: Earned = { earned: null, note: null, since: null };
      try {
        earned = await project0Earned(owner.toBase58(), position.account, TOKENS[route.token], amount);
      } catch (error) {
        logger.info(`Portfolio history failed for ${route.id}: ${error instanceof Error ? error.message : error}`);
        earned = { earned: null, note: RETRY_NOTE, since: null };
      }
      return {
        route,
        routeId: route.id,
        holding: { amount, symbol: route.token },
        value: amount,
        earned: earned.earned,
        earnedNote: earned.note,
        since: earned.since ? new Date(earned.since).toISOString() : null,
        source: historyRpc ? 'On-chain: your Project 0 account and its history' : 'On-chain: your Project 0 account',
        note: position.borrows ? 'This Project 0 account also borrows. Project 0 shows the full position.' : null,
      };
    })
  );
}

// ---------- The answer ----------

async function readPortfolio(address: string): Promise<Portfolio> {
  const owner = new PublicKey(address);
  const sources: [string, Promise<Found[]>][] = [
    ['your token accounts', liquidStaking(owner)],
    ['Kamino', kamino(address)],
    ['Kamino vaults', kaminoVaults(address)],
    ['Project 0', project0(owner)],
    ['Jupiter Lend', jupiterLend(address)],
  ];
  const [settled, routes, fetched] = await Promise.all([
    Promise.allSettled(sources.map(([, promise]) => promise)),
    getYieldRoutes(undefined, true),
    tokenPrices.get(),
  ]);
  // Jupiter refuses some price calls from a shared IP. SOL falls back to the price the rates already use.
  const prices = new Map(fetched ?? []);
  if (!prices.has('SOL')) {
    const sol = await solPrice.get();
    if (sol) prices.set('SOL', sol);
  }

  const unavailable: string[] = [];
  const found: Found[] = [];
  settled.forEach((result, i) => {
    if (result.status === 'fulfilled') found.push(...result.value);
    else {
      unavailable.push(sources[i][0]);
      logger.info(`Portfolio source ${sources[i][0]} failed for ${address}: ${result.reason instanceof Error ? result.reason.message : result.reason}`);
    }
  });

  const positions = found.map(({ route, ...rest }): Position => {
    const live = routes.find((r) => r.id === route.id);
    const price = prices.get(route.token) ?? null;
    return {
      ...rest,
      name: route.name,
      category: route.category,
      token: route.token,
      valueUsd: rest.value !== null && price ? rest.value * price : null,
      earnedUsd: rest.earned !== null && price ? rest.earned * price : null,
      apy: live?.apy ?? null,
      safety: live?.safety?.score ?? null,
      website: route.website,
    };
  });
  positions.sort((a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0));

  const known = positions.filter((p) => p.earnedUsd !== null);
  const unpriced = positions.some((p) => p.value !== null && p.valueUsd === null);
  return {
    address,
    positions,
    totalUsd: unpriced ? null : positions.reduce((sum, p) => sum + (p.valueUsd ?? 0), 0),
    earnedUsd: known.length ? known.reduce((sum, p) => sum + p.earnedUsd!, 0) : null,
    prices: Object.fromEntries(prices),
    unavailable,
    history: historyRpc !== null,
    updatedAt: new Date().toISOString(),
  };
}

const answers = new Map<string, { at: number; portfolio: Promise<Portfolio> }>();

/**
 * The wallet's positions in Hermes's routes. Kept 60 seconds per wallet. An answer with a missing source, a missing
 * price or an earned that didn't load isn't kept, so the next request tries again.
 */
export function getPortfolio(address: string): Promise<Portfolio> {
  const now = Date.now();
  const hit = answers.get(address);
  if (hit && now - hit.at < CACHE_MS) return hit.portfolio;
  if (answers.size >= MAX_WALLETS) {
    for (const [key, entry] of answers) if (now - entry.at >= CACHE_MS) answers.delete(key);
    if (answers.size >= MAX_WALLETS) answers.delete(answers.keys().next().value!);
  }
  const portfolio = readPortfolio(address);
  answers.set(address, { at: now, portfolio });
  portfolio.then(
    (result) => {
      const retry = result.unavailable.length || result.totalUsd === null || result.positions.some((p) => p.earnedNote === RETRY_NOTE);
      if (retry) answers.delete(address);
    },
    () => answers.delete(address)
  );
  return portfolio;
}
