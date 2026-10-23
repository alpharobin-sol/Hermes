"use client"

import { useEffect, useState } from "react"
import Image from "next/image"
import { Menu, Settings, X } from "lucide-react"

import { cn } from "@/lib/utils"
import { IS_DEVNET } from "@/lib/network"
import { SettingsModal } from "../settings-modal"
import { CustomConnectButton } from "../wallet-connect/CustomConnectKit"
import { useLoading } from "./loading-context"
import wordmarkLight from "@/public/brand/hermes-wordmark-light.png"
import wordmarkDark from "@/public/brand/hermes-wordmark-dark.png"

const NAV_ITEMS = [
  { label: "Rates", href: "#rates" },
  { label: "How it works", href: "#how" },
  { label: "Questions", href: "#faq" },
]

// Black wordmark on Aurora, white on Night. CSS picks one, so there is no flash on load.
function Wordmark({ className }: { className?: string }) {
  return (
    <>
      <Image src={wordmarkLight} alt="Hermes" className={cn("w-auto dark:hidden", className)} preload />
      <Image src={wordmarkDark} alt="Hermes" className={cn("hidden w-auto dark:block", className)} />
    </>
  )
}

function NetworkPill() {
  return (
    <span
      title={IS_DEVNET ? "Devnet uses test SOL." : "Real funds. Start small."}
      className="inline-flex h-8 items-center gap-2 rounded-full border border-frame px-3 text-xs font-medium text-muted-foreground"
    >
      <span className="size-2 rounded-full bg-beta-dot" />
      {IS_DEVNET ? "Devnet · test SOL" : "Mainnet beta"}
    </span>
  )
}

export function AppHeader() {
  const [menuOpen, setMenuOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const { isLoading } = useLoading()

  // Keep the page from scrolling behind the open menu
  useEffect(() => {
    document.body.style.overflow = menuOpen ? "hidden" : ""
    return () => {
      document.body.style.overflow = ""
    }
  }, [menuOpen])

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/85">
        <div className="mx-auto flex h-16 max-w-[1200px] items-center justify-between gap-6 px-4 md:h-[76px] md:px-8">
          <a href="#top" aria-label="Hermes home" className="flex items-center">
            <Wordmark className="h-[22px] md:h-[26px]" />
          </a>

          <nav aria-label="Sections" className="hidden items-center gap-1 md:flex">
            {NAV_ITEMS.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="px-3.5 py-3 font-roman text-[13px] font-semibold tracking-[0.14em] text-muted-foreground transition-colors hover:text-foreground"
              >
                {item.label}
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-2 md:gap-3">
            <div className="hidden lg:block">
              <NetworkPill />
            </div>
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              aria-label="Settings"
              className="hidden size-11 place-items-center rounded-[4px] border border-frame text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground md:grid"
            >
              <Settings className="size-[18px]" strokeWidth={1.75} />
            </button>
            <CustomConnectButton />
            <button
              type="button"
              onClick={() => setMenuOpen(true)}
              aria-label="Open menu"
              aria-expanded={menuOpen}
              className="grid size-11 place-items-center rounded-[4px] border border-frame text-muted-foreground md:hidden"
            >
              <Menu className="size-[18px]" />
            </button>
          </div>
        </div>

        {/* Shows while live rates load */}
        <div className="relative h-0.5 w-full overflow-hidden" aria-hidden="true">
          {isLoading && <div className="animate-scan absolute top-0 h-full w-1/5 bg-primary" />}
        </div>
      </header>

      {/* Phone menu */}
      <div
        onClick={() => setMenuOpen(false)}
        className={cn(
          "fixed inset-0 z-50 bg-[rgba(43,20,14,0.6)] transition-opacity duration-300 md:hidden",
          menuOpen ? "opacity-100" : "pointer-events-none opacity-0"
        )}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
        aria-hidden={!menuOpen}
        className={cn(
          "fixed inset-y-0 right-0 z-50 flex w-72 flex-col border-l border-frame bg-card transition-transform duration-300 md:hidden",
          menuOpen ? "translate-x-0" : "pointer-events-none translate-x-full"
        )}
      >
        <div className="flex h-16 items-center justify-between border-b border-border px-4">
          <span className="label-roman">Menu</span>
          <button
            type="button"
            onClick={() => setMenuOpen(false)}
            aria-label="Close menu"
            tabIndex={menuOpen ? 0 : -1}
            className="grid size-11 place-items-center rounded-[4px] text-muted-foreground"
          >
            <X className="size-[18px]" />
          </button>
        </div>
        <nav aria-label="Sections" className="flex flex-col p-2">
          {NAV_ITEMS.map((item) => (
            <a
              key={item.href}
              href={item.href}
              tabIndex={menuOpen ? 0 : -1}
              onClick={() => setMenuOpen(false)}
              className="rounded-[4px] px-3 py-3.5 font-roman text-sm font-semibold tracking-[0.14em] text-foreground hover:bg-secondary"
            >
              {item.label}
            </a>
          ))}
          <button
            type="button"
            tabIndex={menuOpen ? 0 : -1}
            onClick={() => {
              setMenuOpen(false)
              setSettingsOpen(true)
            }}
            className="rounded-[4px] px-3 py-3.5 text-left font-roman text-sm font-semibold tracking-[0.14em] text-foreground hover:bg-secondary"
          >
            Settings
          </button>
        </nav>
        <div className="mt-auto border-t border-border p-4">
          <NetworkPill />
        </div>
      </div>

      <SettingsModal open={settingsOpen} onOpenChange={setSettingsOpen} />
    </>
  )
}
