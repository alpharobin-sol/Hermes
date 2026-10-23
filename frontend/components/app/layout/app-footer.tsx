import Image from "next/image"

import { Meander } from "./meander"
import mark from "@/public/brand/hermes-mark.png"

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

        <a
          href="https://x.com/Hermes_agg"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Hermes on X"
          className="grid size-11 place-items-center rounded-[4px] border border-frame text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <svg fill="currentColor" height="16" viewBox="0 0 20 20" width="16" aria-hidden="true">
            <path d="M15.2719 1.58643H18.0832L11.9415 8.606L19.1667 18.1581H13.5094L9.0784 12.3648L4.00833 18.1581H1.1954L7.76457 10.6498L0.833374 1.58643H6.6343L10.6395 6.8817L15.2719 1.58643ZM14.2853 16.4754H15.843L5.78787 3.1807H4.11626L14.2853 16.4754Z" />
          </svg>
        </a>
      </div>
    </footer>
  )
}
