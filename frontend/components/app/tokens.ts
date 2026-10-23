export interface Token {
  symbol: string
  name: string
  icon: string
  balance: number
}

// Tokens the panel can offer. Only those with at least one route show up. Balances come from the connected wallet.
export const BASE_TOKENS: Token[] = [
  { symbol: "SOL", name: "Solana", icon: "/brand-logos/solanaLogoMark.svg", balance: 0 },
  { symbol: "USDC", name: "USD Coin", icon: "/brand-logos/usdcLogoMark.svg", balance: 0 },
  { symbol: "USDT", name: "Tether", icon: "/brand-logos/tetherLogoMark.svg", balance: 0 },
]

// Token amounts in the panel: SOL needs more precision than stablecoins
export function formatTokenAmount(value: number, symbol: string): string {
  const digits = symbol === "SOL" ? 4 : 2
  return value.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })
}
