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

// Kamino Lend main market, and the reserve Hermes uses for each token (the largest one for that token)
export const KAMINO_MAIN_MARKET = '7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF';
const KAMINO_RESERVES: Record<InputToken, string> = {
  SOL: 'd4A2prbA2whesmvHaL88BH6Ewn5N4bTSU2Ze8P6Bc4Q',
  USDC: 'D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59',
  USDT: 'H3t6qZ1JkguCNTi9uzVKqQ7dvt2cum4XiXWom6Gn5e5S',
};

// Jupiter Lend Earn: the jl token a deposit mints, and the DefiLlama Earn pool that tracks its deposits
const JUPITER_LEND: Record<InputToken, { receipt: TokenInfo; defillamaPool: string }> = {
  SOL: {
    receipt: { symbol: 'jlWSOL', mint: '2uQsyo1fXXQkDtcpXnLofWy88PxcvnfH2L8FPSE62FVU', decimals: 9 },
    defillamaPool: '19721758-74e1-4a0c-acf8-6903257b80e5',
  },
  USDC: {
    receipt: { symbol: 'jlUSDC', mint: '9BEcn9aPEmhSPbPQeFGjidRiEKki46fVQDyPpSQXPA2D', decimals: 6 },
    defillamaPool: 'd783c8df-e2ed-44b4-8317-161ccc1b5f06',
  },
  USDT: {
    receipt: { symbol: 'jlUSDT', mint: 'Cmn4v2wipYV41dkakDvCgFJpxhtaaKt11NyWV8pjSE8A', decimals: 6 },
    defillamaPool: 'a2fbc7ec-22c2-43fe-aa42-49f854aa940d',
  },
};

// Where a route's APY and TVL come from. Each kind has one fetcher in services/rates.ts.
export type RateSource =
  | { kind: 'defillama'; project: string; symbol: string } // yields.llama.fi pool on Solana
  | { kind: 'kamino'; reserve: string } // Kamino Lend main market reserve
  | { kind: 'jupiter-lend'; mint: string }; // Jupiter Lend earn token

// A deposit straight into the protocol. LST deposits are quoted against Jupiter on mainnet.
export type DirectDeposit =
  | { kind: 'spl-stake-pool'; pool: string } // SPL stake pool that mints the receipt
  | { kind: 'marinade' } // Marinade liquid staking program, mainnet only
  | { kind: 'kamino-lend'; market: string; reserve: string } // supply to a Kamino Lend reserve, mainnet only
  | { kind: 'jupiter-lend' }; // supply to Jupiter Lend Earn for its jl token, mainnet only

export interface RouteConfig {
  id: string; // unique, used by the deposit API
  protocol: string; // shared by every route of one protocol
  name: string;
  category: Category;
  token: InputToken; // what the user deposits
  receipt?: TokenInfo; // what lands in the user's wallet, when it is a token
  direct?: DirectDeposit;
  website: string;
  source: RateSource;
  defillamaPool?: string; // DefiLlama pool for deposit history, when the rate comes from another source
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
    direct: { kind: 'spl-stake-pool', pool: 'Jito4APyf642JPZPx3hGc6WWJ8zPKtRbRs4P815Awbb' }, // same address on devnet
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
    direct: { kind: 'marinade' },
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
    deposit: { 'mainnet-beta': 'beta' },
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
    deposit: { 'mainnet-beta': 'beta' },
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
    deposit: { 'mainnet-beta': 'beta' },
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
    deposit: { 'mainnet-beta': 'beta' },
  },

  // Lending: supply a token, earn the borrow interest
  ...(['SOL', 'USDC', 'USDT'] as InputToken[]).flatMap((token): RouteConfig[] => [
    {
      id: `kamino-${token.toLowerCase()}`,
      protocol: 'kamino',
      name: 'Kamino Lend',
      category: 'lending',
      token,
      // The deposit is a position in the user's Kamino account, not a token in the wallet
      direct: { kind: 'kamino-lend', market: KAMINO_MAIN_MARKET, reserve: KAMINO_RESERVES[token] },
      website: 'https://app.kamino.finance',
      source: { kind: 'kamino', reserve: KAMINO_RESERVES[token] },
      deposit: { 'mainnet-beta': 'beta' },
    },
    {
      id: `jupiter-lend-${token.toLowerCase()}`,
      protocol: 'jupiter-lend',
      name: 'Jupiter Lend',
      category: 'lending',
      token,
      // The deposit mints a jl token into the wallet. It grows in value as interest accrues.
      receipt: JUPITER_LEND[token].receipt,
      direct: { kind: 'jupiter-lend' },
      website: 'https://jup.ag/lend/earn',
      source: { kind: 'jupiter-lend', mint: TOKENS[token].mint },
      defillamaPool: JUPITER_LEND[token].defillamaPool,
      deposit: { 'mainnet-beta': 'beta' },
    },
  ]),
];

export function getRoute(id: string): RouteConfig | undefined {
  return ROUTES.find((route) => route.id === id.toLowerCase());
}

export function depositStatus(route: RouteConfig, network: SolanaNetwork): DepositStatus | null {
  return route.deposit[network] ?? null;
}

// Largest single deposit into a mainnet route while it is in beta, in the deposit token
const BETA_DEPOSIT_CAPS: Record<InputToken, number> = {
  SOL: Number(process.env.BETA_DEPOSIT_CAP_SOL || 10),
  USDC: 1_000,
  USDT: 1_000,
};

export function depositCap(route: RouteConfig, network: SolanaNetwork): number | null {
  return network === 'mainnet-beta' && route.deposit[network] === 'beta' ? BETA_DEPOSIT_CAPS[route.token] : null;
}
