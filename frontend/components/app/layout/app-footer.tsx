import Image from "next/image"

import { Meander } from "./meander"
import mark from "@/public/brand/hermes-mark.png"

// Set TELEGRAM_URL to the Hermes channel
const TELEGRAM_URL = "https://t.me/"

const SOCIAL_LINKS = [
  {
    label: "Hermes on X",
    href: "https://x.com/Hermes_agg",
    icon: (
      <svg fill="currentColor" height="16" viewBox="0 0 20 20" width="16" aria-hidden="true">
        <path d="M15.2719 1.58643H18.0832L11.9415 8.606L19.1667 18.1581H13.5094L9.0784 12.3648L4.00833 18.1581H1.1954L7.76457 10.6498L0.833374 1.58643H6.6343L10.6395 6.8817L15.2719 1.58643ZM14.2853 16.4754H15.843L5.78787 3.1807H4.11626L14.2853 16.4754Z" />
      </svg>
    ),
  },
  {
    label: "Hermes on Telegram",
    href: TELEGRAM_URL,
    icon: (
      <svg fill="currentColor" height="18" viewBox="0 0 24 24" width="18" aria-hidden="true">
        <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
      </svg>
    ),
  },
]

export function AppFooter() {
  return (
    <footer className="mt-auto">
      <Meander />
      <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-4 px-4 pb-9 pt-7 md:px-8">
        <div className="flex items-center gap-3">
          <Image src={mark} alt="" className="h-[22px] w-auto" />
          <span className="font-roman text-xs font-semibold tracking-[0.12em] text-muted-foreground">
            © {new Date().getFullYear()} Hermes
          </span>
        </div>

        <p className="order-last w-full text-[13px] text-muted-foreground sm:order-none sm:w-auto">
          Hermes never holds funds. Rates change and are not guaranteed.
        </p>

        <div className="flex items-center gap-2">
          {SOCIAL_LINKS.map((link) => (
            <a
              key={link.label}
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={link.label}
              className="grid size-11 place-items-center rounded-[4px] border border-frame text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              {link.icon}
            </a>
          ))}
        </div>
      </div>
    </footer>
  )
}
