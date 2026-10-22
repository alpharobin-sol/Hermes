"use client"
import { useState } from "react"
import { useWallet } from "@solana/wallet-adapter-react"
import { Wallet, Check } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { Label } from "@/components/ui/label"

interface Props {
  className?: string
  small?: boolean
}

export function CustomConnectButton({ className, small }: Props) {
  const { connected, publicKey, wallet, select, connect, disconnect, wallets } =
    useWallet()
  const [open, setOpen] = useState(false)

  const short = publicKey
    ? `${publicKey.toBase58().slice(0, 4)}...${publicKey
      .toBase58()
      .slice(-4)}`
    : ""

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
    <div className="relative">
      <Button
        size={small ? "sm" : "default"}
        variant={"lite_primary"}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex items-center gap-2 px-2 py-2 text-xs font-mono tracking-wider",
          connected
            ? ""
            : "",
          className
        )}
      >
        <Wallet className="h-3.5 w-3.5" />
        {connected ? <span className="text-[10px]">{short}</span> : "Connect"}
      </Button>

      {open && (
        <>
          {/* Overlay */}
          <div
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40"
            onClick={() => setOpen(false)}
          />

          {/* Modal */}
          <div className="fixed top-1/2 left-1/2 z-50 w-[90vw] max-w-sm -translate-x-1/2 -translate-y-1/2 bg-card p-4 rounded-md shadow-xl flex flex-col gap-3">
            <h2 className="text-lg font-semibold text-foreground">
              {connected ? "Wallet Connected" : "Connect Your Wallet"}
            </h2>

            {!connected && (
              <div className="flex flex-col gap-2">
                {wallets.map((wallet) => (
                  <div key={wallet.adapter.name} className="relative">
                    <Button
                      variant={"outline"}
                      className="w-full"
                      onClick={() => handleSelectWallet(wallet.adapter.name)}
                    >
                      Connect {wallet.adapter.name}
                    </Button>
                    {wallet.readyState === "Installed" && (
                      <Label className="absolute right-3 top-1/2 -translate-y-1/2">
                        <Check className="h-3 w-3" />
                        Installed
                      </Label>
                    )}
                  </div>
                ))}
              </div>
            )}

            {connected && (
              <Button

                variant={"destructive"}
                className=""
                onClick={async () => {
                  await disconnect()
                  setOpen(false)
                }}
              >
                Disconnect
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  )
}