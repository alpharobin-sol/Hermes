"use client"

import { useRef, useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Menu, X } from "lucide-react"

import { cn } from "@/lib/utils"
import { AppMenu } from "./app-menu"
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

// The app's header, the way Titan's works: logo, network, wallet and a menu with the app's pages (Earn, Portfolio,
// Settings). The wallet's name opens the portfolio. Section links belong to the landing page.
export function AppHeader() {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuButton = useRef<HTMLButtonElement>(null)
  const router = useRouter()
  const { isLoading } = useLoading()

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/85">
        <div className="mx-auto flex h-16 max-w-[1200px] items-center justify-between gap-6 px-4 md:h-[76px] md:px-8">
          <Link href="/" aria-label="Hermes home" className="flex items-center">
            <Wordmark className="h-[22px] md:h-[26px]" />
          </Link>

          <div className="flex items-center gap-2 md:gap-3">
            <div className="hidden lg:block">
              <NetworkPill />
            </div>
            <CustomConnectButton onOpenPortfolio={() => router.push("/portfolio")} />
            <button
              ref={menuButton}
              type="button"
              onClick={() => setMenuOpen((open) => !open)}
              aria-label={menuOpen ? "Close menu" : "Menu"}
              aria-expanded={menuOpen}
              className="grid size-11 place-items-center rounded-[4px] border border-frame text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              {menuOpen ? <X className="size-[18px]" strokeWidth={1.75} /> : <Menu className="size-[18px]" strokeWidth={1.75} />}
            </button>
          </div>
        </div>

        {/* Shows while live rates load */}
        <div className="relative h-0.5 w-full overflow-hidden" aria-hidden="true">
          {isLoading && <div className="animate-scan absolute top-0 h-full w-1/5 bg-primary" />}
        </div>
      </header>

      <AppMenu open={menuOpen} onOpenChange={setMenuOpen} toggle={menuButton} />
    </>
  )
}
