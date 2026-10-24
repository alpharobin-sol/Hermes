import Image from "next/image"

import { Meander } from "./meander"
import { SocialLinks } from "./social-links"
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

        <SocialLinks />
      </div>
    </footer>
  )
}
