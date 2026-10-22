import { SolanaNetwork } from '../config/runtime';

/**
 * HERMES ROUTE REGISTRY
 * Every yield route Hermes shows, where its rate comes from, and whether Hermes can deposit into it.
 * A route gets a deposit status only after it passes the gate in INTEGRATIONS.md.
 */

export type Category = 'liquid-staking' | 'lending';

// live: passed every step in INTEGRATIONS.md, including a real deposit by the owner
// beta: deposit is built and simulated, waiting on that real deposit
export type DepositStatus = 'live' | 'beta';

export type InputToken = 'SOL' | 'USDC' | 'USDT';

export interface TokenInfo {
  symbol: string;
  mint: string;
  decimals: number;
}

export const TOKENS: Record<InputToken, TokenInfo> = {
  SOL: { symbol: 'SOL', mint: 'So11111111111111111111111111111111111111112', decimals: 9 },
  USDC: { symbol: 'USDC', mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', decimals: 6 },
  USDT: { symbol: 'USDT', mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', decimals: 6 },
};

// Where a route's APY and TVL come from. Each kind has one fetcher in services/sources.
export type RateSource =
  | { kind: 'defillama'; project: string; symbol: string } // yields.llama.fi pool on Solana
  | { kind: 'kamino'; mint: string } // Kamino Lend main market reserve
  | { kind: 'jupiter-lend'; mint: string }; // Jupiter Lend earn token

export interface RouteConfig {
  id: string; // unique, used by the deposit API
  protocol: string; // shared by every route of one protocol
  name: string;
  category: Category;
  token: InputToken; // what the user deposits
  receipt?: TokenInfo; // what lands in the user's wallet, when it is a token
  website: string;
  source: RateSource;
  deposit: Partial<Record<SolanaNetwork, DepositStatus>>;
}

const lst = (symbol: string, mint: string): TokenInfo => ({ symbol, mint, decimals: 9 });

export const ROUTES: RouteConfig[] = [
  // Liquid staking: SOL in, LST out
  {
    id: 'jito',
    protocol: 'jito',
    name: 'Jito',
    category: 'liquid-staking',
    token: 'SOL',
    receipt: lst('JitoSOL', 'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn'),
    website: 'https://www.jito.network/staking',
    source: { kind: 'defillama', project: 'jito-liquid-staking', symbol: 'JITOSOL' },
    deposit: { 'mainnet-beta': 'beta', devnet: 'beta' },
  },
  {
    id: 'marinade',
    protocol: 'marinade',
    name: 'Marinade',
    category: 'liquid-staking',
    token: 'SOL',
    receipt: lst('mSOL', 'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So'),
    website: 'https://marinade.finance',
    source: { kind: 'defillama', project: 'marinade-liquid-staking', symbol: 'MSOL' },
    deposit: { 'mainnet-beta': 'beta' },
  },
  {
    id: 'binance',
    protocol: 'binance',
    name: 'Binance',
    category: 'liquid-staking',
    token: 'SOL',
    receipt: lst('BNSOL', 'BNso1VUJnh4zcfpZa6986Ea66P6TCp59hvtNJ8b1X85'),
    website: 'https://www.binance.com',
    source: { kind: 'defillama', project: 'binance-staked-sol', symbol: 'BNSOL' },
    deposit: { 'mainnet-beta': 'beta' },
  },
  {
    id: 'jupiter',
    protocol: 'jupiter',
    name: 'Jupiter',
    category: 'liquid-staking',
    token: 'SOL',
    receipt: lst('jupSOL', 'jupSoLaHXQiZZTSfEWMTRRgpnyFm8f6sZdosWBjx93v'),
    website: 'https://jup.ag',
    source: { kind: 'defillama', project: 'jupiter-staked-sol', symbol: 'JUPSOL' },
    deposit: { 'mainnet-beta': 'beta' },
  },
  {
    id: 'drift',
    protocol: 'drift',
    name: 'Drift',
    category: 'liquid-staking',
    token: 'SOL',
    receipt: lst('dSOL', 'Dso1bDeDjCQxTrWHqUUi63oBvV7Mdm6WaobLbQ7gnPQ'),
    website: 'https://www.drift.trade',
    source: { kind: 'defillama', project: 'drift-staked-sol', symbol: 'DSOL' },
    deposit: { 'mainnet-beta': 'beta' },
  },
  {
    id: 'helius',
    protocol: 'helius',
    name: 'Helius',
    category: 'liquid-staking',
    token: 'SOL',
    receipt: lst('hSOL', 'he1iusmfkpAdwvxLNGV8Y1iSbj4rUy6yMhEA3fotn9A'),
    website: 'https://www.helius.dev',
    source: { kind: 'defillama', project: 'helius-staked-sol', symbol: 'HSOL' },
    deposit: { 'mainnet-beta': 'beta' },
  },
  {
    id: 'sanctum-infinity',
    protocol: 'sanctum',
    name: 'Sanctum Infinity',
    category: 'liquid-staking',
    token: 'SOL',
    receipt: lst('INF', '5oVNBeEEQvYi1cX3ir8Dx5n1P7pdxydbGF2X4TxVusJm'),
    website: 'https://app.sanctum.so',
    source: { kind: 'defillama', project: 'sanctum-infinity', symbol: 'INF' },
    deposit: {},
  },
  {
    id: 'bybit',
    protocol: 'bybit',
    name: 'Bybit',
    category: 'liquid-staking',
    token: 'SOL',
    receipt: lst('bbSOL', 'Bybit2vBJGhPF52GBdNaQfUJ6ZpThSgHBobjWZpLPb4B'),
    website: 'https://www.bybit.com',
    source: { kind: 'defillama', project: 'bybit-staked-sol', symbol: 'BBSOL' },
    deposit: {},
  },
  {
    id: 'jpool',
    protocol: 'jpool',
    name: 'JPool',
    category: 'liquid-staking',
    token: 'SOL',
    receipt: lst('JSOL', '7Q2afV64in6N6SeZsAAB81TJzwDoD6zpqmHkzi9Dcavn'),
    website: 'https://jpool.one',
    source: { kind: 'defillama', project: 'jpool', symbol: 'JSOL' },
    deposit: {},
  },
  {
    id: 'blazestake',
    protocol: 'blazestake',
    name: 'BlazeStake',
    category: 'liquid-staking',
    token: 'SOL',
    receipt: lst('bSOL', 'bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1'),
    website: 'https://stake.solblaze.org',
    source: { kind: 'defillama', project: 'blazestake', symbol: 'BSOL' },
    deposit: {},
  },

  // Lending: supply a token, earn the borrow interest
  ...(['SOL', 'USDC', 'USDT'] as InputToken[]).flatMap((token): RouteConfig[] => [
    {
      id: `kamino-${token.toLowerCase()}`,
      protocol: 'kamino',
      name: 'Kamino Lend',
      category: 'lending',
      token,
      website: 'https://app.kamino.finance',
      source: { kind: 'kamino', mint: TOKENS[token].mint },
      deposit: {},
    },
    {
      id: `jupiter-lend-${token.toLowerCase()}`,
      protocol: 'jupiter-lend',
      name: 'Jupiter Lend',
      category: 'lending',
      token,
      website: 'https://jup.ag/lend/earn',
      source: { kind: 'jupiter-lend', mint: TOKENS[token].mint },
      deposit: {},
    },
  ]),
];

export function getRoute(id: string): RouteConfig | undefined {
  return ROUTES.find((route) => route.id === id.toLowerCase());
}

export function depositStatus(route: RouteConfig, network: SolanaNetwork): DepositStatus | null {
  return route.deposit[network] ?? null;
}
