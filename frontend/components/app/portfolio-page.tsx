"use client"

import { useState } from "react"
import Image from "next/image"
import { useWallet } from "@solana/wallet-adapter-react"
import { Check, Copy, Wallet } from "lucide-react"

import { useTokenBalances } from "@/hooks/use-token-balances"
import { PortfolioSection, formatUsd, usePortfolio, type Portfolio } from "./portfolio"
import { BASE_TOKENS, formatTokenAmount } from "./tokens"
import { ConnectWalletDialog } from "./wallet-connect/CustomConnectKit"
import { useWalletName } from "./wallet-connect/use-wallet-name"

// The portfolio page, like Titan's profile and Gloam's portfolio: the wallet and what it holds, what it is earning in
// Hermes's routes and each position, then Disconnect
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

          {address && <WalletBalances prices={portfolio?.prices ?? null} />}

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

// The SOL, USDC and USDT in the wallet itself, ready to deposit. Read in the browser from the wallet's accounts.
function WalletBalances({ prices }: { prices: Portfolio["prices"] | null }) {
  const { balances } = useTokenBalances()
  const known = BASE_TOKENS.filter((token) => typeof balances[token.symbol] === "number")
  // No total unless every token held has a price: a short total would read as less money
  const priced = (symbol: string) => prices?.[symbol as keyof Portfolio["prices"]]
  const totalUsd =
    prices && known.every((token) => !balances[token.symbol] || priced(token.symbol))
      ? known.reduce((sum, token) => sum + balances[token.symbol] * (priced(token.symbol) ?? 0), 0)
      : null

  return (
    <section aria-label="In your wallet" className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="label-roman">In your wallet</h2>
        {totalUsd !== null && known.length > 0 && <span className="text-[13px] font-medium">{formatUsd(totalUsd)}</span>}
      </div>
      {known.length === 0 ? (
        <span aria-hidden="true" className="h-[52px] animate-pulse rounded-[4px] bg-hairline" />
      ) : (
        <ul className="m-0 grid list-none grid-cols-3 gap-2 p-0">
          {known.map((token) => (
            <li key={token.symbol} className="flex flex-col gap-1 rounded-[4px] border border-frame bg-background px-3 py-2.5">
              <span className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                <Image src={token.icon} alt="" width={14} height={14} className="size-3.5" />
                {token.symbol}
              </span>
              <span className="truncate text-[15px] font-semibold">{formatTokenAmount(balances[token.symbol], token.symbol)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
