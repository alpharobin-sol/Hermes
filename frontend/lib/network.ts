// lib/network.ts

export type SolanaNetwork = "mainnet-beta" | "devnet"

// Set NEXT_PUBLIC_SOLANA_NETWORK=devnet to test deposits with devnet SOL.
// The backend's SOLANA_NETWORK must match.
export const SOLANA_NETWORK: SolanaNetwork =
  process.env.NEXT_PUBLIC_SOLANA_NETWORK === "devnet" ? "devnet" : "mainnet-beta"

export const IS_DEVNET = SOLANA_NETWORK === "devnet"

export function explorerTxUrl(signature: string): string {
  return `https://solscan.io/tx/${signature}${IS_DEVNET ? "?cluster=devnet" : ""}`
}
