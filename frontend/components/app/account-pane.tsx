"use client"

import { useState } from "react"
import { useWallet } from "@solana/wallet-adapter-react"
import { Check, Copy, Wallet } from "lucide-react"

import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet"
import { ThemeToggle } from "./ThemeToggle"
import { AlertsSettings } from "./alerts"
import { PortfolioSection, usePortfolio } from "./portfolio"
import { ConnectWalletDialog } from "./wallet-connect/CustomConnectKit"
import { useWalletName } from "./wallet-connect/use-wallet-name"

// The account pane, the way Titan's menu opens: the wallet, its portfolio and Settings in one place.
// From the right on desktop, full screen on phones.
export function AccountPane({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { connected, publicKey, wallet, disconnect } = useWallet()
  const address = connected && publicKey ? publicKey.toBase58() : null
  const name = useWalletName(connected ? publicKey : null)
  const { status, portfolio, refresh } = usePortfolio(address, open)
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
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" aria-describedby={undefined}>
          <div className="border-b border-hairline px-[18px] pb-3.5 pr-14 pt-[18px]">
            <SheetTitle className="font-display text-[26px] font-bold leading-[1.1]">Account</SheetTitle>
            <SheetDescription className="sr-only">Your wallet, your positions and settings.</SheetDescription>
          </div>

          <div className="flex flex-1 flex-col gap-6 overflow-y-auto px-[18px] py-5">
            {/* The wallet */}
            {address ? (
              <div className="flex items-center gap-3">
                <span aria-hidden="true" className="grid size-12 shrink-0 place-items-center rounded-full border border-frame bg-secondary">
                  {wallet?.adapter.icon ? (
                    <img src={wallet.adapter.icon} alt="" className="size-7 rounded-[4px]" />
                  ) : (
                    <Wallet className="size-5 text-muted-foreground" />
                  )}
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-display text-[24px] font-bold leading-[1.1]">{name ?? short}</span>
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
              <div className="flex flex-col gap-3 rounded-[4px] border border-frame bg-accent px-4 py-4">
                <p className="text-[13px] leading-relaxed text-foreground">
                  Connect a wallet to see your positions and what they have earned. Hermes never sees your keys.
                </p>
                <button type="button" onClick={() => setConnectOpen(true)} className="btn-teal h-11 w-full text-sm">
                  <Wallet className="size-4" strokeWidth={2} />
                  Connect wallet
                </button>
              </div>
            )}

            {address && <PortfolioSection status={status} portfolio={portfolio} onRefresh={refresh} />}

            {/* Settings */}
            <section aria-label="Settings" className="flex flex-col gap-3">
              <h3 className="label-roman">Settings</h3>
              <div className="overflow-hidden rounded-[4px] border border-frame">
                <div className="flex items-center justify-between gap-4 bg-card p-[18px]">
                  <div>
                    <div className="label-roman">Theme</div>
                    <div className="mt-1 text-xs text-muted-foreground">Aurora is the default.</div>
                  </div>
                  <ThemeToggle />
                </div>
                <div className="border-t border-hairline bg-card">
                  <AlertsSettings />
                </div>
              </div>
            </section>

            {address && (
              <button
                type="button"
                onClick={async () => {
                  await disconnect()
                  onOpenChange(false)
                }}
                className="btn-frame mt-auto h-12 w-full shrink-0 border-destructive-line text-sm text-destructive hover:bg-destructive-surface"
              >
                Disconnect
              </button>
            )}
          </div>
        </SheetContent>
      </Sheet>
      <ConnectWalletDialog open={connectOpen} onOpenChange={setConnectOpen} />
    </>
  )
}
