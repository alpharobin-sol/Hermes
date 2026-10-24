"use client"

import type { RefObject } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { FileText, LayoutGrid, Settings, type LucideIcon } from "lucide-react"

import { cn } from "@/lib/utils"

// The menu, the way Titan's and Gloam's work: a card under the header with the pages, each opening on its own.
// The routes are home, under the logo. The header's menu button turns into a close button while it is open.
const PAGES: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/portfolio", label: "Portfolio", icon: LayoutGrid },
  { href: "/settings", label: "Settings", icon: Settings },
  { href: "/docs", label: "Docs", icon: FileText },
]

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
          className="data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-top-2 fixed right-4 top-[72px] z-50 w-[calc(100vw-2rem)] max-w-sm rounded-[4px] border border-gilt bg-card p-[5px] shadow-[0_12px_40px_rgba(0,0,0,0.25)] outline-none md:right-[max(2rem,calc((100vw-1200px)/2+2rem))] md:top-[84px] md:w-64"
        >
          <div className="plaque-inner p-2">
            <DialogPrimitive.Title className="sr-only">Menu</DialogPrimitive.Title>
            <DialogPrimitive.Description className="sr-only">Portfolio, settings and docs</DialogPrimitive.Description>
            <nav aria-label="Hermes">
              <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
                {PAGES.map(({ href, label, icon: Icon }) => {
                  const current = pathname === href || pathname.startsWith(`${href}/`)
                  return (
                    <li key={href}>
                      <Link
                        href={href}
                        onClick={() => onOpenChange(false)}
                        aria-current={current ? "page" : undefined}
                        className={cn(
                          "flex h-12 items-center gap-3 rounded-[4px] px-3.5 text-[15px] font-medium transition-colors",
                          current ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-plate hover:text-foreground"
                        )}
                      >
                        <Icon className="size-[18px]" strokeWidth={1.75} aria-hidden="true" />
                        {label}
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </nav>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
