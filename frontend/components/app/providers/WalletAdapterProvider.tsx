"use client"

import { ReactNode, useMemo } from "react"
import { WalletAdapterNetwork } from "@solana/wallet-adapter-base"
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react"
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui"
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom"
import { SolflareWalletAdapter } from "@solana/wallet-adapter-solflare"
import { BackpackWalletAdapter } from "@solana/wallet-adapter-backpack"
import { clusterApiUrl } from "@solana/web3.js"
import { IS_DEVNET } from "@/lib/network"

import "@solana/wallet-adapter-react-ui/styles.css"

// api.mainnet-beta.solana.com rejects browser requests (403), so default to an RPC that allows them.
// Set NEXT_PUBLIC_SOLANA_RPC_URL to a Helius/Triton URL in production.
const BROWSER_MAINNET_RPC = "https://solana-rpc.publicnode.com"

export default function WalletAdapterProvider({
  children,
  network = IS_DEVNET ? WalletAdapterNetwork.Devnet : WalletAdapterNetwork.Mainnet,
}: {
  children: ReactNode
  network?: WalletAdapterNetwork
}) {
  // Separate devnet variable so a mainnet RPC set for production never leaks into devnet mode
  const endpoint =
    network === WalletAdapterNetwork.Mainnet
      ? process.env.NEXT_PUBLIC_SOLANA_RPC_URL || BROWSER_MAINNET_RPC
      : process.env.NEXT_PUBLIC_SOLANA_DEVNET_RPC_URL || clusterApiUrl(network)

  const wallets = useMemo(
    () => [
      new PhantomWalletAdapter(),
      new SolflareWalletAdapter({ network }),
      new BackpackWalletAdapter(),
    ],
    [network]
  )

  return (
    <ConnectionProvider endpoint={endpoint}>
      {/* autoConnect lets select() connect the chosen wallet, and restores it on reload */}
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  )
}
