"use client"

import { useWallet as useSolanaWallet } from '@solana/wallet-adapter-react'

export function useWallet() {
  return useSolanaWallet()
}
