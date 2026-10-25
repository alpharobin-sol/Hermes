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

// Kamino lending vaults: one deposit spread across several Kamino Lend reserves by a curator. The deposit mints vault
// shares and stakes them in the vault's farm, so nothing reaches the wallet. The farm and shares mint are fixed here:
// a Kamino transaction that touches another farm or mint is refused.
const STEAKHOUSE_USDC = {
  vault: 'HDsayqAsDWy3QvANGqh2yNraqcD8Fnjgh73Mhb3WRS5E',
  farm: '9FVjHqduhDPMVqvu3cXiEBjU6nvxvGdCCLRwd9WpVRZj',
  shares: { symbol: 'kVUSDC', mint: '7D8C5pDFxug58L9zkwK7bCiDg4kD4AygzbcZUmf5usHS', decimals: 6 },
};

// Where a route's APY and TVL come from. Each kind has one fetcher in services/rates.ts.
export type RateSource =
  | { kind: 'stake-pool'; pool: string } // SPL stake pool account on chain (SPL program or Sanctum's forks)
  | { kind: 'infinity' } // Sanctum Infinity's pool account on chain (INF)
  | { kind: 'marinade' } // Marinade's API
  | { kind: 'defillama'; project: string; symbol: string } // yields.llama.fi pool on Solana, only where no live source exists
  | { kind: 'kamino'; reserve: string } // Kamino Lend main market reserve
  | { kind: 'kamino-vault'; vault: string } // Kamino lending vault
  | { kind: 'jupiter-lend'; mint: string }; // Jupiter Lend earn token

// A deposit straight into the protocol. LST deposits are quoted against Jupiter on mainnet.
export type DirectDeposit =
  | { kind: 'spl-stake-pool'; pool: string } // SPL stake pool that mints the receipt
  | { kind: 'marinade' } // Marinade liquid staking program, mainnet only
  | { kind: 'kamino-lend'; market: string; reserve: string } // supply to a Kamino Lend reserve, mainnet only
  | { kind: 'kamino-vault'; vault: string; farm: string; shares: TokenInfo } // deposit into a Kamino vault, mainnet only
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
  // First day DefiLlama recorded the protocol's deposits. Fixed, so the Safety Score's track record needs no live fetch.
  trackedSince: string;
  trackedFrom?: string; // where trackedSince comes from, when not DefiLlama's first record
  curator?: string; // a vault's curator, who picks the reserves it lends to
  defillamaPool?: string; // DefiLlama pool for deposit history (Safety Score outflows), until Hermes keeps its own
  // Names in DefiLlama's hacks list for the protocol and the team that runs it. Their incidents lower the Safety Score.
  incidents: string[];
  deposit: Partial<Record<SolanaNetwork, DepositStatus>>;
}

const lst = (symbol: string, mint: string): TokenInfo => ({ symbol, mint, decimals: 9 });

export const ROUTES: RouteConfig[] = [
  // Liquid staking: SOL in, LST out
  {
    id: 'jito',
    protocol: 'jito',
    incidents: ['Jito'],
    name: 'Jito',
    category: 'liquid-staking',
    token: 'SOL',
    receipt: lst('JitoSOL', 'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn'),
    direct: { kind: 'spl-stake-pool', pool: 'Jito4APyf642JPZPx3hGc6WWJ8zPKtRbRs4P815Awbb' }, // same address on devnet
    website: 'https://www.jito.network/staking',
    source: { kind: 'stake-pool', pool: 'Jito4APyf642JPZPx3hGc6WWJ8zPKtRbRs4P815Awbb' },
    trackedSince: '2022-11-24',
    defillamaPool: '0e7d0722-9054-4907-8593-567b353c0900',
    deposit: { 'mainnet-beta': 'beta', devnet: 'beta' },
  },
  {
    id: 'marinade',
    protocol: 'marinade',
    incidents: ['Marinade'],
    name: 'Marinade',
    category: 'liquid-staking',
    token: 'SOL',
    receipt: lst('mSOL', 'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So'),
    direct: { kind: 'marinade' },
    website: 'https://marinade.finance',
    source: { kind: 'marinade' },
    trackedSince: '2021-08-26',
    defillamaPool: 'b3f93865-5ec8-4662-90a0-11808e0aa2bd',
    deposit: { 'mainnet-beta': 'beta' },
  },
  {
    id: 'binance',
    protocol: 'binance',
    incidents: ['Binance', 'Binance Bridge'],
    name: 'Binance',
    category: 'liquid-staking',
    token: 'SOL',
    receipt: lst('BNSOL', 'BNso1VUJnh4zcfpZa6986Ea66P6TCp59hvtNJ8b1X85'),
    website: 'https://www.binance.com',
    source: { kind: 'stake-pool', pool: 'Hr9pzexrBge3vgmBNRR8u42CNQgBXdHm4UkUN2DH4a7r' },
    trackedSince: '2024-09-12',
    defillamaPool: '9e709e57-84eb-496b-82ce-2e8f6a17db1b',
    deposit: { 'mainnet-beta': 'beta' },
  },
  {
    id: 'jupiter',
    protocol: 'jupiter',
    incidents: ['Jupiter'],
    name: 'Jupiter',
    category: 'liquid-staking',
    token: 'SOL',
    receipt: lst('jupSOL', 'jupSoLaHXQiZZTSfEWMTRRgpnyFm8f6sZdosWBjx93v'),
    website: 'https://jup.ag',
    source: { kind: 'stake-pool', pool: '8VpRhuxa7sUUepdY3kQiTmX9rS5vx4WgaXiAnXq4KCtr' },
    trackedSince: '2024-08-16',
    defillamaPool: '52bd72a7-9e81-4112-abb4-71673e8de9bf',
    deposit: { 'mainnet-beta': 'beta' },
  },
  {
    id: 'drift',
    protocol: 'drift',
    incidents: ['Drift Trade'],
    name: 'Drift',
    category: 'liquid-staking',
    token: 'SOL',
    receipt: lst('dSOL', 'Dso1bDeDjCQxTrWHqUUi63oBvV7Mdm6WaobLbQ7gnPQ'),
    website: 'https://www.drift.trade',
    source: { kind: 'stake-pool', pool: '9mhGNSPArRMHpLDMSmxAvuoizBqtBGqYdT8WGuqgxNdn' },
    trackedSince: '2024-08-26',
    defillamaPool: '296651fc-25f6-4434-b8ec-17c2af9808da',
    deposit: { 'mainnet-beta': 'beta' },
  },
  {
    id: 'helius',
    protocol: 'helius',
    incidents: ['Helius'],
    name: 'Helius',
    category: 'liquid-staking',
    token: 'SOL',
    receipt: lst('hSOL', 'he1iusmfkpAdwvxLNGV8Y1iSbj4rUy6yMhEA3fotn9A'),
    website: 'https://www.helius.dev',
    source: { kind: 'stake-pool', pool: '3wK2g8ZdzAH8FJ7PKr2RcvGh7V9VYson5hrVsJM5Lmws' },
    trackedSince: '2024-08-16',
    defillamaPool: 'd7e101d6-8e6c-4348-9c5f-62398872a301',
    deposit: { 'mainnet-beta': 'beta' },
  },
  {
    id: 'sanctum-infinity',
    protocol: 'sanctum',
    incidents: ['Sanctum'],
    name: 'Sanctum Infinity',
    category: 'liquid-staking',
    token: 'SOL',
    receipt: lst('INF', '5oVNBeEEQvYi1cX3ir8Dx5n1P7pdxydbGF2X4TxVusJm'),
    website: 'https://app.sanctum.so',
    source: { kind: 'infinity' },
    trackedSince: '2024-03-25',
    defillamaPool: '3075a746-bdd1-4aac-bcd5-b035abee2622',
    deposit: { 'mainnet-beta': 'beta' },
  },
  {
    id: 'bybit',
    protocol: 'bybit',
    incidents: ['Bybit'],
    name: 'Bybit',
    category: 'liquid-staking',
    token: 'SOL',
    receipt: lst('bbSOL', 'Bybit2vBJGhPF52GBdNaQfUJ6ZpThSgHBobjWZpLPb4B'),
    website: 'https://www.bybit.com',
    source: { kind: 'stake-pool', pool: '2aMLkB5p5gVvCwKkdSo5eZAL1WwhZbxezQr1wxiynRhq' },
    trackedSince: '2024-09-25',
    defillamaPool: 'f76cc844-73a2-4cc7-8de7-f9fb874c626d',
    deposit: { 'mainnet-beta': 'beta' },
  },
  {
    id: 'jpool',
    protocol: 'jpool',
    incidents: ['JPool'],
    name: 'JPool',
    category: 'liquid-staking',
    token: 'SOL',
    receipt: lst('JSOL', '7Q2afV64in6N6SeZsAAB81TJzwDoD6zpqmHkzi9Dcavn'),
    website: 'https://jpool.one',
    source: { kind: 'stake-pool', pool: 'CtMyWsrUtAwXWiGr9WjHT5fC3p3fgV8cyGpLTo2LJzG1' },
    trackedSince: '2022-01-01',
    defillamaPool: '177d0a37-d0fb-4b18-b290-f46bbe8d307f',
    deposit: { 'mainnet-beta': 'beta' },
  },
  {
    id: 'blazestake',
    protocol: 'blazestake',
    incidents: ['BlazeStake', 'SolBlaze'],
    name: 'BlazeStake',
    category: 'liquid-staking',
    token: 'SOL',
    receipt: lst('bSOL', 'bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1'),
    website: 'https://stake.solblaze.org',
    source: { kind: 'stake-pool', pool: 'stk9ApL5HeVAwPLr3TLhDXdZS8ptVu7zp6ov8HFDuMi' },
    trackedSince: '2023-05-04',
    defillamaPool: '387d6732-59f0-4ae0-8a88-aba75a5cbe4a',
    deposit: { 'mainnet-beta': 'beta' },
  },

  // Lending: supply a token, earn the borrow interest
  ...(['SOL', 'USDC', 'USDT'] as InputToken[]).flatMap((token): RouteConfig[] => [
    {
      id: `kamino-${token.toLowerCase()}`,
      protocol: 'kamino',
      incidents: ['Kamino'],
      name: 'Kamino Lend',
      category: 'lending',
      token,
      // The deposit is a position in the user's Kamino account, not a token in the wallet
      direct: { kind: 'kamino-lend', market: KAMINO_MAIN_MARKET, reserve: KAMINO_RESERVES[token] },
      website: 'https://app.kamino.finance',
      source: { kind: 'kamino', reserve: KAMINO_RESERVES[token] },
      trackedSince: '2023-10-12',
      deposit: { 'mainnet-beta': 'beta' },
    },
    {
      id: `jupiter-lend-${token.toLowerCase()}`,
      protocol: 'jupiter-lend',
      incidents: ['Jupiter', 'Jupiter Lend'],
      name: 'Jupiter Lend',
      category: 'lending',
      token,
      // The deposit mints a jl token into the wallet. It grows in value as interest accrues.
      receipt: JUPITER_LEND[token].receipt,
      direct: { kind: 'jupiter-lend' },
      website: 'https://jup.ag/lend/earn',
      source: { kind: 'jupiter-lend', mint: TOKENS[token].mint },
      trackedSince: '2025-08-19',
      defillamaPool: JUPITER_LEND[token].defillamaPool,
      deposit: { 'mainnet-beta': 'beta' },
    },
  ]),

  // Lending vaults: Kamino spreads the deposit across Kamino Lend reserves the curator picks
  {
    id: 'steakhouse-usdc',
    protocol: 'kamino',
    incidents: ['Kamino', 'Steakhouse'],
    name: 'Steakhouse USDC',
    category: 'lending',
    token: 'USDC',
    curator: 'Steakhouse Financial',
    direct: { kind: 'kamino-vault', ...STEAKHOUSE_USDC },
    website: 'https://app.kamino.finance',
    source: { kind: 'kamino-vault', vault: STEAKHOUSE_USDC.vault },
    // DefiLlama lists the vault only since Oct 2026. Kamino's history starts the day the vault opened.
    trackedSince: '2025-04-02',
    trackedFrom: "Kamino's vault history",
    deposit: { 'mainnet-beta': 'beta' },
  },
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
