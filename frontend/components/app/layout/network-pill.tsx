import { cn } from "@/lib/utils"
import { IS_DEVNET } from "@/lib/network"

// Which network deposits go to. The header shows it on desktop, the hero on phones and tablets.
export function NetworkPill({ className }: { className?: string }) {
  return (
    <span
      title={IS_DEVNET ? "Devnet uses test SOL." : "Real funds. Start small."}
      className={cn(
        "inline-flex h-8 items-center gap-2 whitespace-nowrap rounded-full border border-frame px-3 text-xs font-medium text-muted-foreground",
        className
      )}
    >
      <span className="size-2 rounded-full bg-beta-dot" aria-hidden="true" />
      {IS_DEVNET ? "Devnet · test SOL" : "Mainnet beta"}
    </span>
  )
}
