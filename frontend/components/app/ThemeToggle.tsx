"use client"

import { useEffect, useState } from "react"
import { useTheme } from "next-themes"
import { cn } from "@/lib/utils"

const THEMES = [
  { value: "light", label: "Aurora" },
  { value: "dark", label: "Night" },
]

export function ThemeToggle({ className }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme()
  // The stored theme is only known in the browser, so render no selection until mounted
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  return (
    <div role="radiogroup" aria-label="Theme" className={cn("flex gap-0.5 rounded-[4px] border border-border p-[3px]", className)}>
      {THEMES.map((theme) => {
        const active = mounted && resolvedTheme === theme.value
        return (
          <button
            key={theme.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => setTheme(theme.value)}
            className={cn(
              "h-9 rounded-[2px] px-3.5 text-[13px] font-medium transition-colors",
              active ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {theme.label}
          </button>
        )
      })}
    </div>
  )
}
