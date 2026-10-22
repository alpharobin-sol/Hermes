"use client"

import { useCallback, useEffect, useState } from "react"
import { useConnection, useWallet } from "@solana/wallet-adapter-react"
import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js"
import { IS_DEVNET } from "@/lib/network"

// SPL mints for the tokens the yield panel offers. Devnet has Circle's test USDC but no USDT.
const TOKEN_MINTS: Record<string, string> = IS_DEVNET
  ? { USDC: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU" }
  : {
      USDC: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      USDT: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
    }

const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA")
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL")

function getAssociatedTokenAddress(owner: PublicKey, mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [owner.toBytes(), TOKEN_PROGRAM_ID.toBytes(), mint.toBytes()],
    ASSOCIATED_TOKEN_PROGRAM_ID
  )[0]
}

export type TokenBalances = Record<string, number>

// Fee buffer kept back from MAX so the deposit transaction can still pay for itself
export const SOL_FEE_RESERVE = 0.01

export function useTokenBalances() {
  const { connection } = useConnection()
  const { publicKey } = useWallet()
  const [balances, setBalances] = useState<TokenBalances>({})
  const [isLoading, setIsLoading] = useState(false)

  const refresh = useCallback(async () => {
    if (!publicKey) {
      setBalances({})
      return
    }

    setIsLoading(true)

    // Read each token's associated account as a plain account. Free RPCs often block indexed token queries.
    const symbols = Object.keys(TOKEN_MINTS)
    const tokenAccounts = symbols.map((symbol) =>
      getAssociatedTokenAddress(publicKey, new PublicKey(TOKEN_MINTS[symbol]))
    )
    const [solResult, tokenResult] = await Promise.allSettled([
      connection.getBalance(publicKey),
      connection.getMultipleParsedAccounts(tokenAccounts),
    ])

    const next: TokenBalances = {}
    if (solResult.status === "fulfilled") {
      next.SOL = solResult.value / LAMPORTS_PER_SOL
    } else {
      console.warn("Failed to load SOL balance", solResult.reason)
    }
    if (tokenResult.status === "fulfilled") {
      symbols.forEach((symbol, i) => {
        const data = tokenResult.value.value[i]?.data
        // A missing token account just means a zero balance
        next[symbol] = data && "parsed" in data ? (data.parsed?.info?.tokenAmount?.uiAmount ?? 0) : 0
      })
    } else {
      // Left unset rather than 0, so the app never claims a balance it could not read
      console.warn("Failed to load token balances", tokenResult.reason)
    }

    setBalances(next)
    setIsLoading(false)
  }, [connection, publicKey])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { balances, isLoading, refresh, isConnected: !!publicKey }
}
