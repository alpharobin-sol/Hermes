/**
 * Runtime switches
 */

export type SolanaNetwork = 'mainnet-beta' | 'devnet';

// Network deposits are built for. Yield data always comes from mainnet.
export function solanaNetwork(): SolanaNetwork {
  return process.env.SOLANA_NETWORK === 'devnet' ? 'devnet' : 'mainnet-beta';
}
