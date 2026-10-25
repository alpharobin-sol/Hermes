import type { Metadata } from "next"
import Image from "next/image"

import { YieldAPI, type YieldRoute } from "@/lib/api/yield-api"
import { isTopRated, TOP_RATED_MIN_SCORE } from "@/lib/top-rated"
import { LaunchApp } from "@/components/site/launch-app"
import { LiveDot } from "@/components/site/live-dot"
import { RouteList, bySafety, percent } from "@/components/site/route-list"
import { typeLabel } from "@/lib/route-copy"

// Every route Hermes deposits into, by token, each opening its own page. Live on the server, refreshed at most once
// a minute. If the API is down the list is left out rather than filled in.
export const revalidate = 60

export const metadata: Metadata = {
  title: "Solana Yield Routes: Live Staking and Lending APYs · Hermes",
  description:
    "Every Solana staking and lending route Hermes deposits into, for SOL, USDC and USDT, with today's APY and a Safety Score from live data.",
  alternates: { canonical: "/routes" },
}

const TOKENS = [
  { symbol: "SOL", icon: "/brand-logos/solanaLogoMark.svg" },
  { symbol: "USDC", icon: "/brand-logos/usdcLogoMark.svg" },
  { symbol: "USDT", icon: "/brand-logos/tetherLogoMark.svg" },
]

// "10 liquid staking, 2 lending", from the routes themselves
function kinds(routes: YieldRoute[]): string {
  const counts = new Map<string, number>()
  for (const route of routes) counts.set(typeLabel(route), (counts.get(typeLabel(route)) ?? 0) + 1)
  return [...counts].map(([type, count]) => `${count} ${type.toLowerCase()}`).join(", ")
}

async function liveRoutes(): Promise<YieldRoute[] | null> {
  try {
    const routes = await YieldAPI.getRoutes(undefined, { revalidate: 60, signal: AbortSignal.timeout(10_000) })
    return routes.length > 0 ? routes : null
  } catch {
    return null
  }
}

export default async function RoutesIndex() {
  const routes = await liveRoutes()
  const groups = TOKENS.map((token) => ({ ...token, routes: (routes ?? []).filter((route) => route.token === token.symbol).sort(bySafety) })).filter(
    (group) => group.routes.length > 0
  )
  const updated = routes ? Math.min(...routes.map((route) => Date.parse(route.updatedAt)).filter((time) => !isNaN(time))) : NaN

  return (
    <div className="mx-auto max-w-[1200px] px-4 pb-16 pt-6 md:px-8 md:pb-24 md:pt-10">
      <div className="plaque arch [--arch:44px] md:[--arch:80px]">
        <div className="plaque-inner px-5 pb-8 pt-10 text-center sm:px-8 md:px-12 md:pb-10 md:pt-14">
          <span className="eyebrow-pill">
            <span className="diamond" aria-hidden="true" />
            Routes
          </span>
          <h1 className="mt-4 font-display text-[42px] font-semibold leading-[1] sm:text-[56px] lg:text-[64px]">
            Solana yield routes, <em className="font-medium">live</em>
          </h1>
          <p className="mx-auto mt-4 max-w-[560px] text-[15px] leading-relaxed text-muted-foreground md:text-[17px]">
            Every staking and lending route Hermes deposits into, with today&apos;s APY and its Safety Score. Open one to see
            each part of its score, what can go wrong and how to get out.
          </p>
          {routes && (
            <ul className="m-0 mt-6 flex list-none flex-wrap justify-center gap-x-5 gap-y-2 p-0 text-[13px] font-medium">
              <li className="flex items-center gap-2">
                <span className="diamond" aria-hidden="true" />
                {routes.length} routes
              </li>
              <li className="flex items-center gap-2">
                <span className="diamond" aria-hidden="true" />
                {routes.filter(isTopRated).length} top rated ({TOP_RATED_MIN_SCORE}+)
              </li>
              <li className="flex items-center gap-2">
                <span className="diamond" aria-hidden="true" />
                Highest APY {percent(Math.max(...routes.map((route) => route.apy)))}
              </li>
            </ul>
          )}
          <div className="mt-6 flex justify-center">
            <LaunchApp className="h-12 px-7 text-[15px]" />
          </div>
        </div>
      </div>

      {groups.length === 0 ? (
        <p className="mt-10 text-center text-sm text-muted-foreground">Live rates are unavailable right now. Try again in a minute.</p>
      ) : (
        <div className="mt-12 grid items-start gap-10 md:mt-16 lg:grid-cols-2 lg:gap-x-6">
          <TokenGroup group={groups[0]} />
          {groups.length > 1 && (
            <div className="flex flex-col gap-10">
              {groups.slice(1).map((group) => (
                <TokenGroup key={group.symbol} group={group} />
              ))}
            </div>
          )}
        </div>
      )}

      {routes && !isNaN(updated) && (
        <p className="mt-8 flex items-center justify-center gap-2 text-center text-xs text-muted-foreground">
          <LiveDot />
          Read {new Date(updated).toISOString().slice(11, 16)} UTC from the chain and the protocols, refreshed every minute. Sorted
          by Safety Score, then APY. The diamond marks Top rated.
        </p>
      )}
    </div>
  )
}

function TokenGroup({ group }: { group: { symbol: string; icon: string; routes: YieldRoute[] } }) {
  return (
    <section id={group.symbol.toLowerCase()} aria-labelledby={`${group.symbol}-title`} className="scroll-mt-24">
      <div className="mb-4 flex items-center gap-3 px-1">
        <Image src={group.icon} alt="" width={32} height={32} className="size-8" />
        <div>
          <h2 id={`${group.symbol}-title`} className="font-display text-[30px] font-bold leading-none">
            {group.symbol}
          </h2>
          <p className="mt-1 text-[13px] text-muted-foreground">{kinds(group.routes)}</p>
        </div>
      </div>
      <div className="plaque">
        <div className="plaque-inner">
          <RouteList routes={group.routes} />
        </div>
      </div>
    </section>
  )
}
