import Link from "next/link"

import { Wordmark } from "@/components/app/layout/wordmark"

// The landing page's header, like Gloam's: the logo, the page's sections and Docs, and one way into the app.
// No wallet here: the app is where you connect.
const LINKS = [
  { href: "/#how", label: "How it works" },
  { href: "/#safety", label: "Safety Score" },
  { href: "/#alerts", label: "Alerts" },
  { href: "/#faq", label: "Questions" },
  { href: "/docs", label: "Docs" },
]

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/85">
      <div className="mx-auto flex h-16 max-w-[1200px] items-center justify-between gap-6 px-4 md:h-[76px] md:px-8">
        <Link href="/" aria-label="Hermes home" className="flex items-center">
          <Wordmark className="h-[22px] md:h-[26px]" />
        </Link>
        <nav aria-label="Hermes" className="hidden lg:block">
          <ul className="m-0 flex list-none items-center gap-7 p-0">
            {LINKS.map((link) => (
              <li key={link.href}>
                <Link href={link.href} className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <Link href="/app" className="btn-teal h-11 px-5 text-sm">
          Open app
        </Link>
      </div>
    </header>
  )
}
