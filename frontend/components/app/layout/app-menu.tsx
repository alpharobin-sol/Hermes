"use client"

import type { RefObject } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { ArrowUpRight } from "lucide-react"

import { cn } from "@/lib/utils"

// The menu, the way Titan's works: a card under the header with the app's pages, then Hermes's links.
// Each page opens on its own. The header's menu button turns into a close button while it is open.
const PAGES = [
  { href: "/", label: "Earn" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/settings", label: "Settings" },
]

const LINKS = [
  { href: "https://x.com/Hermes_agg", label: "X" },
  { href: "https://t.me/+gYZPiesNgH85YzE8", label: "Telegram" },
]

const ROW = "flex h-14 items-center justify-between rounded-[4px] px-4 font-display text-[22px] font-bold transition-colors"

export function AppMenu({
  open,
  onOpenChange,
  toggle,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  toggle: RefObject<HTMLButtonElement | null> // the header's menu button, which opens and closes the menu itself
}) {
  const pathname = usePathname()

  return (
    // Not modal, so the header (and its close button) stays usable while the menu is open. A tap outside or Escape closes it.
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange} modal={false}>
      <DialogPrimitive.Portal>
        {/* A shade below the header. Tapping it counts as outside, which closes the menu. */}
        {open && <div aria-hidden="true" className="animate-in fade-in-0 fixed inset-x-0 bottom-0 top-16 z-40 bg-[rgba(43,20,14,0.35)] md:top-[76px]" />}
        <DialogPrimitive.Content
          // The menu button opens and closes the menu itself, so a tap or focus there doesn't count as outside
          onInteractOutside={(event) => {
            if (toggle.current?.contains(event.target as Node)) event.preventDefault()
          }}
          className="data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-top-2 fixed right-4 top-[72px] z-50 w-[calc(100vw-2rem)] max-w-sm rounded-[4px] border border-gilt bg-card p-[5px] shadow-[0_12px_40px_rgba(0,0,0,0.25)] outline-none md:right-[max(2rem,calc((100vw-1200px)/2+2rem))] md:top-[84px] md:w-80"
        >
          <div className="plaque-inner p-2">
            <DialogPrimitive.Title className="sr-only">Menu</DialogPrimitive.Title>
            <DialogPrimitive.Description className="sr-only">Hermes pages and links</DialogPrimitive.Description>
            <nav aria-label="Hermes">
              <ul className="m-0 flex list-none flex-col gap-1 p-0">
                {PAGES.map((page) => {
                  const current = pathname === page.href
                  return (
                    <li key={page.href}>
                      <Link
                        href={page.href}
                        onClick={() => onOpenChange(false)}
                        aria-current={current ? "page" : undefined}
                        className={cn(ROW, current ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-plate hover:text-foreground")}
                      >
                        {page.label}
                      </Link>
                    </li>
                  )
                })}
              </ul>
              <p className="m-0 pb-1 pt-3 text-center label-roman">Community</p>
              <ul className="m-0 flex list-none flex-col gap-1 p-0">
                {LINKS.map((link) => (
                  <li key={link.href}>
                    <a
                      href={link.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={cn(ROW, "text-muted-foreground hover:bg-plate hover:text-foreground")}
                    >
                      {link.label}
                      <ArrowUpRight className="size-5" aria-hidden="true" />
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
