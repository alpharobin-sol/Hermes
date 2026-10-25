import Link from "next/link"

import { Meander } from "@/components/app/layout/meander"
import { SocialLinks } from "@/components/app/layout/social-links"
import { Wordmark } from "@/components/app/layout/wordmark"
import { LaunchApp } from "./launch-app"

const COLUMNS = [
  {
    title: "Product",
    links: [
      { href: "/app", label: "Launch app" },
      { href: "/routes", label: "Routes" },
      { href: "/portfolio", label: "Portfolio" },
      { href: "/docs", label: "Docs" },
    ],
  },
  {
    title: "Learn",
    links: [
      { href: "/#how", label: "How it works" },
      { href: "/#safety", label: "Safety Score" },
      { href: "/#alerts", label: "Alerts" },
      { href: "/#faq", label: "Questions" },
    ],
  },
  {
    title: "Community",
    links: [
      { href: "https://x.com/Hermes_agg", label: "X", external: true },
      { href: "https://t.me/+I2pSaIdIykgwMDQ0", label: "Telegram", external: true },
    ],
  },
]

// The landing page's footer, in the Night colors whatever the theme, like Gloam's: the line, the links and the
// beta note. The app keeps its own short footer.
export function SiteFooter() {
  return (
    <footer className="dark mt-auto bg-background text-foreground">
      <Meander />
      <div className="mx-auto grid max-w-[1200px] gap-10 px-4 pb-10 pt-12 md:px-8 md:pt-16 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1.6fr)]">
        <div className="flex flex-col items-start gap-5">
          <Wordmark className="h-[24px]" />
          <p className="max-w-[340px] font-display text-[28px] font-semibold leading-[1.1]">Your guide to Solana yield.</p>
          <div className="flex flex-wrap items-center gap-3">
            <SocialLinks />
            <LaunchApp className="h-11 px-5 text-sm" />
          </div>
        </div>
        <nav aria-label="Footer" className="grid grid-cols-3 gap-6 sm:gap-8">
          {COLUMNS.map((column) => (
            <div key={column.title}>
              <p className="label-roman mb-4">{column.title}</p>
              <ul className="m-0 flex list-none flex-col gap-3 p-0">
                {column.links.map((link) => (
                  <li key={link.href}>
                    {"external" in link ? (
                      <a href={link.href} target="_blank" rel="noopener noreferrer" className="text-[15px] text-foreground/90 hover:text-foreground">
                        {link.label}
                      </a>
                    ) : (
                      <Link href={link.href} className="text-[15px] text-foreground/90 hover:text-foreground">
                        {link.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </div>
      <div className="mx-auto max-w-[1200px] px-4 md:px-8">
        <p className="m-0 border-t border-hairline py-6 text-xs leading-relaxed text-muted-foreground">
          © {new Date().getFullYear()} Hermes. Beta: real funds on Solana mainnet, capped per deposit. Rates move, and
          nothing here is investment advice.
        </p>
      </div>
    </footer>
  )
}
