"use client"

import { useState } from "react"
import Image from "next/image"
import { Menu } from "lucide-react"

import { cn } from "@/lib/utils"
import { AccountPane } from "../account-pane"
import { CustomConnectButton } from "../wallet-connect/CustomConnectKit"
import { useLoading } from "./loading-context"
import { NetworkPill } from "./network-pill"
import wordmarkLight from "@/public/brand/hermes-wordmark-light.png"
import wordmarkDark from "@/public/brand/hermes-wordmark-dark.png"

// Black wordmark on Aurora, white on Night. CSS picks one, so there is no flash on load.
// The hidden one loads eagerly too: a lazy image never loads while hidden, so Night would open on a blank logo.
function Wordmark({ className }: { className?: string }) {
  return (
    <>
      <Image src={wordmarkLight} alt="Hermes" className={cn("w-auto dark:hidden", className)} preload />
      <Image src={wordmarkDark} alt="Hermes" className={cn("hidden w-auto dark:block", className)} loading="eager" />
    </>
  )
}

// The app's header, the way Titan's works: logo, network, wallet and a menu that opens the account pane (wallet,
// portfolio, settings). Section links belong to the landing page.
export function AppHeader() {
  const [paneOpen, setPaneOpen] = useState(false)
  const { isLoading } = useLoading()

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/85">
        <div className="mx-auto flex h-16 max-w-[1200px] items-center justify-between gap-6 px-4 md:h-[76px] md:px-8">
          <a href="#top" aria-label="Hermes home" className="flex items-center">
            <Wordmark className="h-[22px] md:h-[26px]" />
          </a>

          <div className="flex items-center gap-2 md:gap-3">
            <div className="hidden lg:block">
              <NetworkPill />
            </div>
            <CustomConnectButton onOpenAccount={() => setPaneOpen(true)} />
            <button
              type="button"
              onClick={() => setPaneOpen(true)}
              aria-label="Menu: portfolio and settings"
              className="grid size-11 place-items-center rounded-[4px] border border-frame text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              <Menu className="size-[18px]" strokeWidth={1.75} />
            </button>
          </div>
        </div>

        {/* Shows while live rates load */}
        <div className="relative h-0.5 w-full overflow-hidden" aria-hidden="true">
          {isLoading && <div className="animate-scan absolute top-0 h-full w-1/5 bg-primary" />}
        </div>
      </header>

      <AccountPane open={paneOpen} onOpenChange={setPaneOpen} />
    </>
  )
}
