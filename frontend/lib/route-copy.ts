import type { YieldRoute } from "@/lib/api/yield-api"

// The words Hermes uses for a route, in one place so the app and the route pages say the same thing.
// Kept outside client components so the server can render them too.

export const CATEGORY_LABELS: Record<YieldRoute["category"], string> = {
  "liquid-staking": "Liquid staking",
  lending: "Lending",
}

// The route type as shown: a lending route with a curator is a vault
export function typeLabel(route: YieldRoute): string {
  return route.curator ? "Lending vault" : CATEGORY_LABELS[route.category]
}

// Above this share borrowed, a lending reserve may not have liquidity for withdrawals
export const HIGH_UTILIZATION = 0.95

export function borrowedPercent(route: YieldRoute): number | null {
  return typeof route.utilization === "number" ? Math.min(100, Math.round(route.utilization * 100)) : null
}

// Lending sources that report what can leave right now instead of what is borrowed (Jupiter Lend, vaults)
export function withdrawablePercent(route: YieldRoute): number | null {
  return typeof route.utilization !== "number" && typeof route.withdrawable === "number"
    ? Math.round(route.withdrawable * 100)
    : null
}

// Little can be withdrawn right now: 95% or more of the reserve is borrowed or held back
export function exitTight(route: YieldRoute): boolean {
  if (typeof route.utilization === "number") return route.utilization >= HIGH_UTILIZATION
  return typeof route.withdrawable === "number" && route.withdrawable <= 1 - HIGH_UTILIZATION
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "")
  } catch {
    return url
  }
}

// Plain labels for new users: what a route type is, where its yield comes from and how you get out
export function explainRoute(route: YieldRoute): { what: string; yieldFrom: string; out: string } {
  if (route.curator) {
    return {
      what: `A Kamino vault lends your ${route.token} across several Kamino reserves. ${route.curator} picks the reserves and how much goes to each. You hold vault shares, which grow as interest comes in.`,
      yieldFrom: "The interest borrowers pay in those reserves, less the vault's fee. It moves as they borrow more or less.",
      out: `Withdraw from your Portfolio or at ${hostOf(route.website)} whenever the reserves have room.`,
    }
  }
  if (route.category === "lending") {
    return {
      what: `You lend your ${route.token} to borrowers through ${route.name}. ${
        route.receipt ? `You get ${route.receipt}, which grows as interest comes in.` : "It sits in your own account there."
      }`,
      yieldFrom: "The interest borrowers pay. It moves up and down as they borrow more or less.",
      out: `Withdraw at ${hostOf(route.website)} whenever the reserve has room.`,
    }
  }
  const receipt = route.receipt ?? "a staking token"
  return {
    what: `You swap SOL for ${receipt}. It stays in your wallet, and each ${receipt} is worth a little more SOL every few days.`,
    yieldFrom: "Solana's staking rewards, paid to the validators the protocol stakes with.",
    out: "Swap back to SOL at the market price any time.",
  }
}

// A plain line on how the route can lose money and how to get out, from what Hermes knows about it now
export function whatCanGoWrong(route: YieldRoute): string {
  // A recent incident that lowered the score leads the line
  const incident = route.safety?.deductions?.find((deduction) => deduction.key === "incident" && deduction.points < 0)
  const lead = incident ? `${incident.detail} ` : ""
  return lead + baseRisk(route)
}

function baseRisk(route: YieldRoute): string {
  if (route.curator) {
    const now = typeof route.withdrawable === "number" ? ` Right now ${Math.round(route.withdrawable * 100)}% of it can leave.` : ""
    return `Your ${route.token} is lent through Kamino reserves that ${route.curator} picks. A withdrawal waits when those reserves are mostly borrowed.${now} A bug or bad debt in Kamino, or a poor pick by the curator, could lose funds.`
  }
  if (route.category === "lending") {
    const now = typeof route.withdrawable === "number" ? ` Right now ${Math.round(route.withdrawable * 100)}% of it can leave.` : ""
    return `Your ${route.token} is lent to borrowers. A withdrawal waits when most of the reserve is borrowed.${now} A bug or bad debt in ${route.name} could lose funds.`
  }
  return `${route.receipt ?? "The token"} can trade below its SOL value for a while, and a bug in ${route.name}'s program could lose funds. You can swap back to SOL at the market price at any time.`
}

// What people search for: the staking token for liquid staking ("JitoSOL"), the protocol and token for lending
// ("Kamino Lend USDC"), the vault's own name when it already says the token ("Steakhouse USDC")
export function routeLabel(route: YieldRoute): string {
  if (route.category === "liquid-staking" && route.receipt) return route.receipt
  return route.name.toLowerCase().includes(route.token.toLowerCase()) ? route.name : `${route.name} ${route.token}`
}

// The route page's address: /routes/jitosol, /routes/kamino-lend-usdc
export function routeSlug(route: YieldRoute): string {
  return routeLabel(route)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
}

export const routePath = (route: YieldRoute) => `/routes/${routeSlug(route)}`
