import Image from "next/image"

import { cn } from "@/lib/utils"
import wordmarkLight from "@/public/brand/hermes-wordmark-light.png"
import wordmarkDark from "@/public/brand/hermes-wordmark-dark.png"

// Black wordmark on Aurora, white on Night. CSS picks one, so there is no flash on load.
// The hidden one loads eagerly too: a lazy image never loads while hidden, so Night would open on a blank logo.
export function Wordmark({ className }: { className?: string }) {
  return (
    <>
      <Image src={wordmarkLight} alt="Hermes" className={cn("w-auto dark:hidden", className)} preload />
      <Image src={wordmarkDark} alt="Hermes" className={cn("hidden w-auto dark:block", className)} loading="eager" />
    </>
  )
}
