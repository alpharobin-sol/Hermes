"use client"

import { useState } from "react"
import { useWallet } from "@solana/wallet-adapter-react"
import { Check, Copy, Wallet } from "lucide-react"

import { PortfolioSection, usePortfolio } from "./portfolio"
import { ConnectWalletDialog } from "./wallet-connect/CustomConnectKit"
import { useWalletName } from "./wallet-connect/use-wallet-name"

// The portfolio page, like Titan's profile: the wallet, its total and each position, then Disconnect
export function PortfolioPage() {
  const { connected, publicKey, wallet, disconnect } = useWallet()
  const address = connected && publicKey ? publicKey.toBase58() : null
  const name = useWalletName(connected ? publicKey : null)
  const { status, portfolio, refresh } = usePortfolio(address, true)
  const [connectOpen, setConnectOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const short = address ? `${address.slice(0, 4)}...${address.slice(-4)}` : ""

  const copy = async () => {
    if (!address) return
    try {
      await navigator.clipboard.writeText(address)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard blocked: the address stays on screen to copy by hand
    }
  }

  return (
    <div className="mx-auto w-full max-w-[640px] px-4 py-6 md:px-8 md:py-10">
      <h1 className="sr-only">Portfolio</h1>
      <section className="plaque">
        <div className="plaque-inner flex flex-col gap-6 p-[18px] md:p-[22px]">
          {address ? (
            <div className="flex items-center gap-3">
              <span aria-hidden="true" className="grid size-14 shrink-0 place-items-center rounded-full border border-frame bg-secondary">
                {wallet?.adapter.icon ? (
                  <img src={wallet.adapter.icon} alt="" className="size-8 rounded-[4px]" />
                ) : (
                  <Wallet className="size-5 text-muted-foreground" />
                )}
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="truncate font-display text-[28px] font-bold leading-[1.1]">{name ?? short}</span>
                <button
                  type="button"
                  onClick={copy}
                  title={address}
                  className="inline-flex w-fit items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground"
                >
                  {/* With no name, the address is the title already */}
                  {name ? short : copied ? "Copied" : "Copy address"}
                  {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
                  {name && <span className="sr-only">{copied ? "Address copied" : "Copy address"}</span>}
                </button>
              </span>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <h2 className="font-display text-[28px] font-bold leading-[1.1]">Your portfolio</h2>
              <p className="text-[13px] leading-relaxed text-muted-foreground">
                Connect a wallet to see what it holds in each route and what it has earned. Hermes never sees your keys.
              </p>
              <button type="button" onClick={() => setConnectOpen(true)} className="btn-teal h-12 w-full text-sm">
                <Wallet className="size-4" strokeWidth={2} />
                Connect wallet
              </button>
            </div>
          )}

          {address && <PortfolioSection status={status} portfolio={portfolio} onRefresh={refresh} />}

          {address && (
            <button
              type="button"
              onClick={() => disconnect()}
              className="btn-frame h-12 w-full border-destructive-line text-sm text-destructive hover:bg-destructive-surface"
            >
              Disconnect
            </button>
          )}
        </div>
      </section>
      <ConnectWalletDialog open={connectOpen} onOpenChange={setConnectOpen} />
    </div>
  )
}
