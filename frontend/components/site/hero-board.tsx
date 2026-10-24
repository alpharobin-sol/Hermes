"use client"

import { useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { ArrowRight } from "lucide-react"

import { cn } from "@/lib/utils"
import { LiveDot } from "./live-dot"

export interface BoardRoute {
  id: string
  name: string
  type: string // "Liquid staking" or "Lending"
  apy: number // decimal
  score: number
}

export interface BoardColumn {
  symbol: string
  icon: string
  routes: BoardRoute[]
}

// The hero's live board: up to four top rated routes for one token at a time, rendered on the server and switched here.
// The highest APY on the board is the one teal number.
export function HeroBoard({ columns, total }: { columns: BoardColumn[]; total: number }) {
  const [active, setActive] = useState(columns[0].symbol)
  const column = columns.find((c) => c.symbol === active) ?? columns[0]
  const best = Math.max(...column.routes.map((route) => route.apy))

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-3">
        <span className="label-roman flex items-center gap-2 whitespace-nowrap">
          <LiveDot />
          Top rated now
        </span>
        <div role="tablist" aria-label="Token" className="flex gap-0.5 rounded-[4px] border border-frame p-0.5">
          {columns.map((c) => (
            <button
              key={c.symbol}
              type="button"
              role="tab"
              aria-selected={c.symbol === column.symbol}
              onClick={() => setActive(c.symbol)}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-[2px] px-2.5 text-xs font-semibold transition-colors",
                c.symbol === column.symbol ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Image src={c.icon} alt="" width={16} height={16} className="size-4" />
              {c.symbol}
            </button>
          ))}
        </div>
      </div>

      <ul role="tabpanel" aria-label={`Top rated ${column.symbol} routes`} className="m-0 mt-3 list-none p-0">
        {column.routes.map((route) => (
          <li key={route.id} className="flex items-center gap-3 border-t border-row-line py-3 first:border-t-0">
            <span aria-hidden="true" className="medallion size-9 text-sm">
              {route.name.charAt(0)}
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="truncate font-display text-[20px] font-bold leading-[1.1]">{route.name}</span>
              <span className="text-[11px] text-muted-foreground">
                Safety {route.score} · {route.type}
              </span>
            </span>
            <span className={cn("whitespace-nowrap font-roman text-[19px] font-bold", route.apy === best && "text-ink")}>
              {(route.apy * 100).toFixed(2)}% <span className="font-sans text-[11px] font-medium">APY</span>
            </span>
          </li>
        ))}
      </ul>

      <p className="mt-auto border-t border-row-line pt-3 text-xs leading-relaxed text-muted-foreground">
        Top rated: a Safety Score of 80 or more, and no lending reserve nearly all borrowed. Rates from the chain and the
        protocols, refreshed every minute.
      </p>
      <Link
        href="/app"
        className="mt-3 inline-flex items-center gap-1.5 self-start text-sm font-medium text-ink underline-offset-4 hover:underline"
      >
        Compare all {total} routes
        <ArrowRight className="size-4" aria-hidden="true" />
      </Link>
    </div>
  )
}
