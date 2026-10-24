"use client"
import { useState } from "react"
import { useWallet } from "@solana/wallet-adapter-react"
import { Check, Wallet } from "lucide-react"

import { cn } from "@/lib/utils"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useWalletName } from "./use-wallet-name"

interface Props {
  className?: string
}

export function CustomConnectButton({ className }: Props) {
  const { connected, publicKey, wallet, select, connect, disconnect, wallets } = useWallet()
  const [open, setOpen] = useState(false)

  const short = publicKey ? `${publicKey.toBase58().slice(0, 4)}...${publicKey.toBase58().slice(-4)}` : ""
  // The wallet's main AllDomains name when it has one, the short address otherwise
  const name = useWalletName(connected ? publicKey : null)

  // The provider's autoConnect connects once the selection lands. Calling connect() here would race it.
  const handleSelectWallet = (walletName: string) => {
    if (wallet?.adapter.name === walletName) {
      // Already selected (e.g. the user rejected the first popup), so select() would be a no-op
      connect().catch((err) => console.warn("Wallet connection failed", err))
    } else {
      select(walletName as any)
    }
    setOpen(false)
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={connected ? publicKey?.toBase58() : undefined}
        className={cn(connected ? "btn-frame" : "btn-teal", "h-11 whitespace-nowrap px-3.5 text-sm md:px-[18px]", className)}
      >
        <Wallet className="size-4 shrink-0" strokeWidth={2} />
        {connected ? (
          <span className="max-w-[9rem] truncate md:max-w-[14rem]">{name ?? short}</span>
        ) : (
          // One label, so its text reads "Connect wallet" and not "ConnectConnect wallet"
          <span>
            Connect<span className="hidden lg:inline"> wallet</span>
          </span>
        )}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm gap-0 rounded-[4px] border-gilt bg-card p-[5px] sm:max-w-sm [&>[data-slot=dialog-close]]:right-5 [&>[data-slot=dialog-close]]:top-5">
          <div className="plaque-inner">
            <DialogHeader className="border-b border-hairline p-[18px] pb-3.5 pr-12 text-left">
              <DialogTitle className="font-display text-[26px] font-bold leading-[1.1]">
                {connected ? "Wallet connected" : "Connect your wallet"}
              </DialogTitle>
              <DialogDescription className="text-[13px] text-muted-foreground">
                {connected ? (name ? `${name} · ${short}` : short) : "Hermes never sees your keys. You sign every deposit in your wallet."}
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-2 p-[18px]">
              {!connected &&
                wallets.map((w) => (
                  <button
                    key={w.adapter.name}
                    type="button"
                    onClick={() => handleSelectWallet(w.adapter.name)}
                    className="btn-frame h-12 w-full justify-start px-3.5 text-sm"
                  >
                    {w.adapter.icon && <img src={w.adapter.icon} alt="" className="size-6 rounded-[4px]" />}
                    {w.adapter.name}
                    {w.readyState === "Installed" && (
                      <span className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
                        <Check className="size-3" />
                        Installed
                      </span>
                    )}
                  </button>
                ))}

              {connected && (
                <button
                  type="button"
                  onClick={async () => {
                    await disconnect()
                    setOpen(false)
                  }}
                  className="btn-frame h-12 w-full border-destructive-line text-sm text-destructive hover:bg-destructive-surface"
                >
                  Disconnect
                </button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
