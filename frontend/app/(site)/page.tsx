import type React from "react"
import Image from "next/image"
import Link from "next/link"
import {
  Activity,
  ArrowRight,
  ArrowRightLeft,
  Bell,
  Check,
  CircleDollarSign,
  Coins,
  Landmark,
  ListOrdered,
  ShieldCheck,
  TrendingUp,
  Wallet,
  type LucideIcon,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { YieldAPI, type YieldRoute } from "@/lib/api/yield-api"
import { isTopRated, TOP_RATED_MIN_SCORE } from "@/lib/top-rated"
import { NetworkPill } from "@/components/app/layout/network-pill"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { HeroBoard, type BoardColumn } from "@/components/site/hero-board"
import { ScoreShowcase, type ShowcaseRoute } from "@/components/site/score-showcase"
import { LiveDot } from "@/components/site/live-dot"
import { LaunchApp } from "@/components/site/launch-app"
import banner from "@/public/brand/aurora-banner.jpg"
import mark from "@/public/brand/hermes-mark.png"

// The landing page: what Hermes is, with the live board, rates, numbers and a real Safety Score breakdown in it.
// The app itself is at /app. Live data renders on the server, refreshed at most once a minute, so search engines
// see real numbers. If the API is down, every live part is left out rather than filled in.
export const revalidate = 60

async function liveRoutes(): Promise<YieldRoute[] | null> {
  try {
    const routes = await YieldAPI.getRoutes(undefined, { revalidate: 60, signal: AbortSignal.timeout(10_000) })
    return routes.length > 0 ? routes : null
  } catch {
    return null
  }
}

const FACTS = ["Non-custodial", "No Hermes fee today", "Beta: real funds, capped per deposit"]

const TOKENS = [
  { symbol: "SOL", icon: "/brand-logos/solanaLogoMark.svg" },
  { symbol: "USDC", icon: "/brand-logos/usdcLogoMark.svg" },
  { symbol: "USDT", icon: "/brand-logos/tetherLogoMark.svg" },
]

const TYPE: Record<YieldRoute["category"], string> = { "liquid-staking": "Liquid staking", lending: "Lending" }

const percent = (apy: number) => `${(apy * 100).toFixed(2)}%`

// Safety first, then APY: the app's default sort
const bySafety = (a: YieldRoute, b: YieldRoute) => (b.safety?.score ?? -1) - (a.safety?.score ?? -1) || b.apy - a.apy

function usdShort(value: number): string {
  if (value >= 1e9) return `$${(value / 1e9).toFixed(1)}B`
  if (value >= 1e6) return `$${Math.round(value / 1e6)}M`
  return `$${Math.round(value).toLocaleString("en-US")}`
}

const PILLARS = [
  {
    eyebrow: "Compare",
    title: "Every rate, side by side",
    body: "Staking and lending routes for SOL, USDC and USDT, read from the chain and the protocols every minute.",
    href: "/app",
    cta: "See the rates",
  },
  {
    eyebrow: "Rate",
    title: "A Safety Score on every route",
    body: `0 to 100 from live data. Hermes opens on Top rated: only the routes that score ${TOP_RATED_MIN_SCORE} or more.`,
    href: "#safety",
    cta: "How the score works",
  },
  {
    eyebrow: "Route",
    title: "One deposit, signed by you",
    body: "Type an amount and every route quotes it. Hermes builds the deposit for the one you pick, and your wallet signs it.",
    href: "#how",
    cta: "How it works",
  },
]

const SCORE_ROWS = [
  { label: "Size", detail: "What the route holds. Full points at $1B.", points: "25" },
  { label: "Track record", detail: "How long it has held deposits. Full points at four years.", points: "25" },
  { label: "Outflows", detail: "What left in the last 30 days, counted in tokens.", points: "25" },
  { label: "Exit", detail: "The borrowed share, or a 10,000-token sale against pool value.", points: "25" },
  { label: "Validator spread", detail: "One validator holding most of a pool's stake.", points: "up to −10", deduction: true },
  { label: "Incidents", detail: "A hack of the protocol or its team.", points: "up to −25", deduction: true },
]

const ALERT_KINDS = [
  { title: "Rate drop", body: "A route you watch falls 20% or more, and at least half a point, in a day." },
  { title: "A better route", body: "A top rated route for the same token pays a point or more above it." },
  { title: "Reserve nearly all borrowed", body: "5% or less of a lending reserve can be withdrawn right now." },
  { title: "Score drop", body: `The route's Safety Score falls below ${TOP_RATED_MIN_SCORE}.` },
]

const AUDIENCES: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: Coins,
    title: "SOL holders",
    body: "SOL sitting in a wallet earns nothing. Swap it for a staking token that scores well, and swap back to SOL at the market price any time.",
  },
  {
    icon: ArrowRightLeft,
    title: "Leaving an exchange",
    body: "Staking on an exchange today? Top rated shows established routes first, in plain words, and the keys stay yours.",
  },
  {
    icon: CircleDollarSign,
    title: "Stablecoin savers",
    body: "Lend USDC or USDT on Kamino and Jupiter Lend. No impermanent loss, and you see how much of each reserve is borrowed.",
  },
  {
    icon: Activity,
    title: "Rate watchers",
    body: "Every rate on one board, live quotes for any amount, and an alert when a better top rated route opens.",
  },
]

const CUSTODY = [
  {
    title: "You sign every move",
    body: "Hermes builds an unsigned transaction and your wallet signs it. Hermes never sees a key or a seed phrase, and no Hermes vault holds your funds.",
  },
  {
    title: "Simulated before you sign",
    body: "Hermes simulates deposits and withdrawals before you sign. The dialog shows what you put in, what you get and what it costs.",
  },
  {
    title: "Every number has a source",
    body: "Each rate and each part of the score names where it came from: the chain, the protocol, or DefiLlama where nothing else exists.",
  },
]

const ROADMAP = [
  {
    status: "Live",
    title: "The Index",
    body: "Live rates and a Safety Score for every staking and lending route Hermes lists.",
  },
  {
    status: "Live",
    title: "The Router",
    body: "Live quotes for any amount, the deposit built for the route you pick, and withdrawals from Portfolio.",
  },
  {
    status: "Live",
    title: "Signals and moves",
    body: "Phone alerts and moves are live: Hermes proposes a better top rated route and you sign. Next: alerts for your own positions, and Telegram.",
  },
  {
    status: "Later",
    title: "Automation",
    body: "An opt-in vault that rebalances and exits on signals. Only after a Hermes program, an outside security review and deposit caps.",
  },
]

const STATUS_DOT: Record<string, string> = { Live: "bg-success", Next: "bg-beta-dot", Later: "bg-placeholder" }

const FAQS = [
  {
    question: "What is Hermes?",
    answer:
      "Hermes is a guide to yield on Solana. It shows live rates from staking and lending protocols side by side, rates every route with a Safety Score, and builds the deposit for the route you pick. You sign it in your own wallet.",
  },
  {
    question: "Does Hermes hold my funds?",
    answer:
      "No. Each deposit goes straight from your wallet to the protocol in a transaction you sign, and so does each withdrawal. What you get back, like JitoSOL or a Kamino position, is yours. Hermes has no vault and never sees your keys.",
  },
  {
    question: "Which routes can I use?",
    answer:
      "Ten liquid staking tokens, including JitoSOL, mSOL and INF, plus Kamino Lend and Jupiter Lend for SOL, USDC and USDT. Every route on Hermes deposits inside Hermes. They are in beta, capped at 10 SOL per deposit, or 1,000 USDC or USDT for lending.",
  },
  {
    question: "What can go wrong?",
    answer:
      "A staking token can trade below its SOL value for a while. A bug in a protocol's program could lose funds. A lending reserve can be fully borrowed, so withdrawals wait until borrowers repay. A protocol or its team can be hacked. Rates move. The Safety Score weighs what live data can show, and alerts tell you when a route changes, but neither removes the risk. Start small.",
  },
  {
    question: "How is the Safety Score worked out?",
    answer:
      "Four parts from live data, 25 points each: size, track record, 30-day outflows and how easily you can exit. Up to 10 points come off when one validator holds most of a pool's stake, and up to 25 for a recent hack of the protocol or its team. Every part shows what it measured and where the number came from. The score does not cover smart contract bugs or a sudden depeg.",
  },
  {
    question: "What does Top rated mean?",
    answer:
      "The view Hermes opens with: only routes that score 80 or more, and no lending reserve that is nearly all borrowed. It means fewer surprises, not no risk. Tap All routes to compare everything.",
  },
  {
    question: "How do I withdraw?",
    answer:
      "Open Portfolio, tap Withdraw under a position and sign. Staking tokens swap back to SOL at the market price, and Hermes shows the exit cost first. Lending pays your token back when the reserve has room.",
  },
  {
    question: "Can Hermes move my funds to a better route?",
    answer:
      "Hermes proposes, you sign. In Portfolio, Hermes proposes a move under a position when a top rated route for the same token pays at least half a point more today. Tap Move to see the cost, what the new route earns in a year at today's rates and how long it takes to make the cost back. A staking token to a staking token is one swap. A move with lending in it is two steps you sign one after the other, and if the second fails the funds wait in your wallet.",
  },
  {
    question: "Can Hermes alert me?",
    answer:
      "Yes. Tap the bell under a route to get alerts on your phone or computer when its rate falls, a better top rated route opens, its reserve is nearly all borrowed, or its score drops below 80. On iPhone, add Hermes to your Home Screen first. Hermes stores only your device's notification address and the routes you watch, never your wallet.",
  },
  {
    question: "Does Hermes charge a fee?",
    answer:
      "Not today. You pay Solana network fees and any fee the protocol charges. Swaps can carry price impact, which Hermes shows before you sign.",
  },
]

// The same answers, for search engines
const FAQ_DATA = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: FAQS.map((faq) => ({
    "@type": "Question",
    name: faq.question,
    acceptedAnswer: { "@type": "Answer", text: faq.answer },
  })),
}

export default async function Landing() {
  const routes = await liveRoutes()
  return (
    <div>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(FAQ_DATA) }} />
      <Hero routes={routes} />
      {routes && <RateTape routes={routes} />}
      <Why />
      {routes && <LiveNumbers routes={routes} />}
      <HowItWorks routes={routes} />
      <SafetyScore routes={routes} />
      <Alerts />
      <Audiences />
      <Custody />
      <Roadmap />
      <Questions />
      <ClosingCall />
    </div>
  )
}

function SectionHead({ eyebrow, title, intro, className }: { eyebrow: string; title: React.ReactNode; intro?: string; className?: string }) {
  return (
    <div className={cn("mx-auto mb-10 max-w-[700px] text-center md:mb-14", className)}>
      <span className="eyebrow-pill">
        <span className="diamond" aria-hidden="true" />
        {eyebrow}
      </span>
      <h2 className="mt-4 font-display text-[34px] font-semibold leading-[1.06] md:text-[50px]">{title}</h2>
      {intro && <p className="mx-auto mt-3.5 max-w-[600px] text-[15px] leading-relaxed text-muted-foreground md:text-[17px]">{intro}</p>}
    </div>
  )
}

// The top rated routes per token, for the hero's board
function boardColumns(routes: YieldRoute[]): BoardColumn[] {
  return TOKENS.map((token) => ({
    ...token,
    routes: routes
      .filter((route) => route.token === token.symbol && isTopRated(route))
      .sort(bySafety)
      .slice(0, 4)
      .map((route) => ({ id: route.id, name: route.name, type: TYPE[route.category], apy: route.apy, score: route.safety?.score ?? 0 })),
  })).filter((column) => column.routes.length > 0)
}

// Reni's Aurora in an arch, with a plaque over its lower edge: the headline on the left, the live board on the right
function Hero({ routes }: { routes: YieldRoute[] | null }) {
  const columns = routes ? boardColumns(routes) : []
  return (
    <section className="mx-auto max-w-[1200px] px-4 pt-4 md:px-8 md:pt-8">
      <figure className="m-0 rounded-t-[100px] border border-gilt bg-card p-1 md:rounded-t-[246px] md:p-1.5">
        <Image
          src={banner}
          alt="Guido Reni's Aurora fresco with the Hermes mark as Apollo leading the Hours"
          sizes="(min-width: 1200px) 1136px, 100vw"
          className="block aspect-[2/1] h-auto w-full rounded-t-[96px] rounded-b-[2px] object-cover object-[37%_50%] sm:aspect-[3/1] md:rounded-t-[240px]"
          preload
        />
      </figure>

      <div className="plaque arch relative mx-1 -mt-6 border-gilt [--arch:36px] md:[--arch:64px] shadow-[0_30px_70px_-45px_rgba(43,20,14,0.6)] sm:mx-auto sm:max-w-[1040px] md:-mt-[clamp(24px,6.5vw,96px)] md:p-[5px]">
        <div className={cn("plaque-inner grid", columns.length > 0 && "lg:grid-cols-[minmax(0,1.12fr)_minmax(0,1fr)]")}>
          <div className={cn("px-5 pb-7 pt-5 sm:px-8 sm:pb-8 sm:pt-7 lg:px-10 lg:pb-10 lg:pt-9", columns.length === 0 && "text-center")}>
            <NetworkPill className="h-7 px-2.5 text-[11px]" />
            <h1 className="mt-4 font-display text-[46px] font-semibold leading-[0.98] sm:text-[58px] lg:text-[70px]">
              Your guide to <em className="font-medium">Solana yield</em>
            </h1>
            <p
              className={cn(
                "mt-4 max-w-[470px] text-[15px] leading-relaxed text-muted-foreground md:mt-5 md:text-[17px]",
                columns.length === 0 && "mx-auto"
              )}
            >
              Live rates from Solana staking and lending, side by side. A Safety Score on every route. The deposit built
              for the one you pick.
            </p>
            <div className={cn("mt-6 flex flex-wrap items-center gap-3 md:mt-7", columns.length === 0 && "justify-center")}>
              <LaunchApp className="h-12 flex-1 whitespace-nowrap px-3 text-[15px] sm:flex-none sm:px-6" />
              <Link href="#how" className="btn-frame h-12 flex-1 whitespace-nowrap px-3 text-[15px] sm:flex-none sm:px-6">
                How it works
              </Link>
            </div>
            <ul
              className={cn(
                "m-0 mt-6 flex list-none flex-wrap gap-x-5 gap-y-2 p-0 text-[13px] font-medium md:mt-7",
                columns.length === 0 && "justify-center"
              )}
            >
              {FACTS.map((fact) => (
                <li key={fact} className="flex items-center gap-2">
                  <span className="diamond" aria-hidden="true" />
                  {fact}
                </li>
              ))}
            </ul>
          </div>
          {columns.length > 0 && (
            <div className="border-t border-hairline bg-plate px-4 py-4 sm:px-6 sm:py-5 lg:border-l lg:border-t-0 lg:px-7 lg:py-8">
              <HeroBoard columns={columns} total={routes?.length ?? 0} />
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

// Every route, live, running across the page like a ticker. The list runs twice so the loop has no seam.
function RateTape({ routes }: { routes: YieldRoute[] }) {
  const sorted = [...routes].sort(bySafety)
  const best = Math.max(...routes.map((route) => route.apy))
  return (
    <section aria-label="Live rates" className="mt-12 border-y border-hairline bg-card md:mt-16">
      <div className="flex items-center">
        <span className="label-roman flex shrink-0 items-center gap-2 border-r border-hairline px-4 py-3.5 md:px-6">
          <LiveDot />
          Live
        </span>
        <div className="min-w-0 flex-1 overflow-hidden [mask-image:linear-gradient(to_right,transparent,#000_4%,#000_96%,transparent)] motion-reduce:overflow-x-auto">
          <ul
            className="animate-marquee m-0 flex w-max list-none items-center p-0"
            style={{ "--marquee-duration": `${sorted.length * 4}s` } as React.CSSProperties}
          >
            {[...sorted, ...sorted].map((route, index) => (
              <li
                key={`${route.id}-${index}`}
                aria-hidden={index >= sorted.length || undefined}
                className="flex items-center gap-2.5 whitespace-nowrap py-3.5 pl-6 pr-0"
              >
                <span className="font-display text-[17px] font-bold">{route.name}</span>
                <span className="text-[11px] font-medium text-muted-foreground">{route.token}</span>
                <span className={cn("font-roman text-[15px] font-bold", route.apy === best && "text-ink")}>{percent(route.apy)}</span>
                <span className="text-[11px] text-muted-foreground">{route.safety ? `Safety ${route.safety.score}` : "Not scored"}</span>
                <span className="diamond ml-3.5" aria-hidden="true" />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}

function Why() {
  return (
    <section id="why" className="reveal mx-auto max-w-[1200px] scroll-mt-24 px-4 pt-20 md:px-8 md:pt-32">
      <div className="text-center">
        <span className="eyebrow-pill">
          <span className="diamond" aria-hidden="true" />
          Why Hermes
        </span>
      </div>
      <h2 className="mx-auto mt-5 max-w-[940px] text-center font-display text-[34px] font-semibold leading-[1.06] sm:text-[46px] md:text-[58px]">
        Solana yield is spread across dozens of apps. <em className="font-medium text-muted-foreground">Hermes is the guide.</em>
      </h2>
      <p className="mx-auto mt-5 max-w-[640px] text-center text-[15px] leading-relaxed text-muted-foreground md:text-[17px]">
        Each protocol has its own app, its own words and its own rate, and the rate it shows is not always what you keep.
        Hermes compares the routes, scores each one and builds the deposit. Your funds go straight to the protocol.
      </p>
      <ul className="m-0 mt-12 grid list-none gap-9 p-0 md:mt-16 md:grid-cols-3 md:gap-10">
        {PILLARS.map((pillar) => (
          <li key={pillar.title} className="flex flex-col border-t border-gilt pt-5">
            <span className="label-roman text-ornament">{pillar.eyebrow}</span>
            <h3 className="mt-2 font-display text-[26px] font-bold leading-tight">{pillar.title}</h3>
            <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">{pillar.body}</p>
            <Link href={pillar.href} className="mt-4 inline-flex items-center gap-1.5 self-start text-sm font-semibold hover:text-ink">
              {pillar.cta}
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

// Four live numbers on a Night plaque
function LiveNumbers({ routes }: { routes: YieldRoute[] }) {
  const deposited = routes.reduce((sum, route) => sum + (Number.isFinite(route.tvl) ? route.tvl : 0), 0)
  const stats: { icon: LucideIcon; value: string; label: string; best?: boolean }[] = [
    { icon: ListOrdered, value: String(routes.length), label: "routes compared live" },
    { icon: Landmark, value: usdShort(deposited), label: "deposited across those routes" },
    { icon: ShieldCheck, value: String(routes.filter(isTopRated).length), label: `top rated, scoring ${TOP_RATED_MIN_SCORE} or more` },
    { icon: TrendingUp, value: percent(Math.max(...routes.map((route) => route.apy))), label: "highest APY right now", best: true },
  ]
  const borders = ["border-b border-r lg:border-b-0", "border-b lg:border-b-0 lg:border-r", "border-r", ""]

  return (
    <section aria-label="Hermes in numbers" className="reveal mx-auto max-w-[1200px] px-4 pt-16 md:px-8 md:pt-24">
      <div className="dark arch rounded-b-[4px] border border-gilt bg-card p-1 text-foreground [--arch:32px] md:p-1.5 md:[--arch:56px]">
        <div className="plaque-inner grid grid-cols-2 lg:grid-cols-4">
          {stats.map((stat, index) => (
            <div key={stat.label} className={cn("flex flex-col gap-3 border-hairline p-5 md:flex-row md:items-center md:gap-4 md:p-7", borders[index])}>
              <span className="medallion size-11 md:size-12" aria-hidden="true">
                <stat.icon className="size-5" />
              </span>
              <span className="flex flex-col">
                <span className={cn("font-roman text-[28px] font-bold leading-none md:text-[34px]", stat.best && "text-ink")}>{stat.value}</span>
                <span className="mt-1.5 text-xs leading-snug text-muted-foreground md:text-[13px]">{stat.label}</span>
              </span>
            </div>
          ))}
        </div>
      </div>
      <p className="mt-3 flex items-center justify-center gap-2 text-center text-xs text-muted-foreground">
        <LiveDot />
        From the chain and the protocols, refreshed every minute
      </p>
    </section>
  )
}

function HowItWorks({ routes }: { routes: YieldRoute[] | null }) {
  const sol = (routes ?? []).filter((route) => route.token === "SOL" && isTopRated(route)).sort(bySafety)
  const steps = [
    {
      numeral: "I",
      title: "Pick a token and amount",
      body: "SOL, USDC or USDT. Type an amount and every route quotes it at once, refreshed every 15 seconds.",
      visual: <AmountVisual />,
    },
    {
      numeral: "II",
      title: "Compare the routes",
      body: "Hermes opens on Top rated. Each row shows the route, its Safety Score and its APY, or what it earns in a year once you type an amount.",
      visual: sol.length > 0 ? <CompareVisual routes={sol.slice(0, 3)} /> : <IconVisual icon={ListOrdered} />,
    },
    {
      numeral: "III",
      title: "Open Why",
      body: "See each part of the route's Safety Score, what it measured and where the number came from, before any money moves.",
      visual: sol[0]?.safety ? <ScoreVisual route={sol[0]} /> : <IconVisual icon={ShieldCheck} />,
    },
    {
      numeral: "IV",
      title: "Sign in your wallet",
      body: "Hermes builds the deposit and simulates it. You sign. The tokens land in your wallet, and Portfolio withdraws them.",
      visual: <SignVisual />,
    },
  ]

  return (
    <section id="how" className="reveal mx-auto max-w-[1200px] scroll-mt-24 px-4 pt-20 md:px-8 md:pt-32">
      <SectionHead eyebrow="How it works" title="Four steps, one signature" intro="No account and no sign-up. Connect a wallet when you are ready to deposit." />
      <ol className="m-0 grid list-none gap-4 p-0 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((step) => (
          <li key={step.numeral} className="plaque arch flex [--arch:96px]">
            <div className="plaque-inner flex w-full flex-col">
              <div className="h-[232px] overflow-hidden border-b border-hairline bg-plate px-5 pb-4 pt-14">{step.visual}</div>
              <div className="flex flex-1 flex-col gap-1.5 p-4 md:p-5">
                <span aria-hidden="true" className="font-roman text-[22px] font-semibold leading-none text-ornament">
                  {step.numeral}
                </span>
                <h3 className="mt-1 font-display text-[23px] font-bold leading-tight">{step.title}</h3>
                <p className="text-sm leading-relaxed text-muted-foreground">{step.body}</p>
              </div>
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}

// The amount box from the app, drawn small
function AmountVisual() {
  return (
    <div aria-hidden="true" className="flex h-full flex-col justify-center gap-3">
      <div className="rounded-[4px] border border-frame bg-card px-3 py-2.5">
        <span className="label-roman text-[10px]">You deposit</span>
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <span className="text-[28px] font-semibold leading-none">
            2.5<span className="ml-0.5 inline-block h-6 w-px translate-y-0.5 animate-pulse bg-foreground align-baseline" />
          </span>
          <span className="inline-flex h-8 items-center gap-1.5 rounded-full border border-frame bg-secondary px-2.5 text-xs font-semibold">
            <Image src={TOKENS[0].icon} alt="" width={16} height={16} className="size-4" />
            SOL
          </span>
        </div>
      </div>
      <div className="flex gap-1.5">
        {TOKENS.map((token, index) => (
          <span
            key={token.symbol}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-semibold",
              index === 0 ? "border-gilt bg-card" : "border-hairline text-muted-foreground"
            )}
          >
            <Image src={token.icon} alt="" width={14} height={14} className="size-3.5" />
            {token.symbol}
          </span>
        ))}
      </div>
    </div>
  )
}

// Live top rated SOL routes, as rows
function CompareVisual({ routes }: { routes: YieldRoute[] }) {
  const best = Math.max(...routes.map((route) => route.apy))
  return (
    <ul aria-hidden="true" className="m-0 flex h-full list-none flex-col justify-center gap-1.5 p-0">
      {routes.map((route) => (
        <li key={route.id} className="flex items-center gap-2.5 rounded-[4px] border border-hairline bg-card px-2.5 py-2">
          <span className="medallion size-7 text-xs">{route.name.charAt(0)}</span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate font-display text-[16px] font-bold leading-tight">{route.name}</span>
            <span className="text-[10px] text-muted-foreground">Safety {route.safety?.score}</span>
          </span>
          <span className={cn("font-roman text-[14px] font-bold", route.apy === best && "text-ink")}>{percent(route.apy)}</span>
        </li>
      ))}
    </ul>
  )
}

// The top route's live score, part by part
function ScoreVisual({ route }: { route: YieldRoute }) {
  const safety = route.safety!
  return (
    <div aria-hidden="true" className="flex h-full flex-col justify-center gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate font-display text-[18px] font-bold">{route.name}</span>
        <span>
          <span className="font-roman text-[24px] font-bold text-success">{safety.score}</span>
          <span className="text-[11px] text-muted-foreground"> / 100</span>
        </span>
      </div>
      {safety.parts.map((part) => (
        <div key={part.key} className="flex flex-col gap-1">
          <span className="flex items-baseline justify-between text-[11px]">
            <span className="font-semibold">{part.label}</span>
            <span className="text-muted-foreground">
              {part.points}/{part.max}
            </span>
          </span>
          <span className="h-1 rounded-[1px] bg-hairline">
            <span className="block h-1 rounded-[1px] bg-foreground/60" style={{ width: `${(part.points / part.max) * 100}%` }} />
          </span>
        </div>
      ))}
    </div>
  )
}

// A wallet's approval card, drawn small
function SignVisual() {
  return (
    <div aria-hidden="true" className="flex h-full items-center justify-center">
      <div className="w-full max-w-[212px] rounded-[6px] border border-frame bg-card p-3 shadow-[0_16px_30px_-20px_rgba(43,20,14,0.5)]">
        <div className="flex items-center gap-2 text-xs font-semibold">
          <span className="grid size-6 place-items-center rounded-full bg-secondary">
            <Wallet className="size-3.5" />
          </span>
          Your wallet
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">Approve transaction</p>
        <dl className="m-0 mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px]">
          <dt className="text-muted-foreground">Built by</dt>
          <dd className="m-0 text-right font-medium">Hermes</dd>
          <dt className="text-muted-foreground">Signed by</dt>
          <dd className="m-0 text-right font-medium">You</dd>
          <dt className="text-muted-foreground">Simulated</dt>
          <dd className="m-0 flex items-center justify-end gap-1 font-medium">
            <Check className="size-3 text-success" />
            Yes
          </dd>
        </dl>
        <div className="mt-3 grid grid-cols-2 gap-1.5 text-[11px] font-semibold">
          <span className="grid h-7 place-items-center rounded-[4px] border border-frame">Reject</span>
          <span className="grid h-7 place-items-center rounded-[4px] bg-foreground text-background">Approve</span>
        </div>
      </div>
    </div>
  )
}

function IconVisual({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <div aria-hidden="true" className="grid h-full place-items-center">
      <span className="medallion size-16">
        <Icon className="size-7" />
      </span>
    </div>
  )
}

// The top scoring route, for the live breakdown
function topScored(routes: YieldRoute[]): ShowcaseRoute | null {
  const top = routes.filter((route) => route.safety).sort(bySafety)[0]
  if (!top?.safety) return null
  return {
    id: top.id,
    name: top.name,
    subtitle: `${top.receipt ?? top.token} · ${TYPE[top.category]}`,
    score: top.safety.score,
    parts: top.safety.parts,
    deductions: top.safety.deductions ?? [],
  }
}

function SafetyScore({ routes }: { routes: YieldRoute[] | null }) {
  const top = routes ? topScored(routes) : null
  return (
    <section id="safety" className="reveal mx-auto max-w-[1200px] scroll-mt-24 px-4 pt-20 md:px-8 md:pt-32">
      <div className={cn("grid gap-4", top && "lg:grid-cols-2")}>
        <div className="plaque arch [--arch:80px] md:[--arch:120px]">
          <div className="plaque-inner h-full px-6 pb-6 pt-12 md:px-10 md:pb-10 md:pt-16">
            <span className="eyebrow-pill">
              <span className="diamond" aria-hidden="true" />
              Safety Score
            </span>
            <h2 className="mt-4 font-display text-[34px] font-semibold leading-[1.06] md:text-[50px]">A score on every route</h2>
            <p className="mt-3.5 max-w-[520px] text-[15px] leading-relaxed text-muted-foreground md:text-[17px]">
              0 to 100, built from live data. Four parts worth 25 points each, then deductions. Top rated means{" "}
              {TOP_RATED_MIN_SCORE} or more, and no lending reserve that is nearly all borrowed.
            </p>
            <ul className="m-0 mt-7 list-none border-t border-hairline p-0">
              {SCORE_ROWS.map((row) => (
                <li key={row.label} className="flex items-center justify-between gap-4 border-b border-hairline py-3">
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-[15px] font-semibold">{row.label}</span>
                    <span className="text-[13px] leading-snug text-muted-foreground">{row.detail}</span>
                  </span>
                  <span className={cn("whitespace-nowrap font-roman text-[15px] font-bold", row.deduction && "text-destructive")}>{row.points}</span>
                </li>
              ))}
            </ul>
            <p className="mt-5 text-sm leading-relaxed text-muted-foreground">
              It does not cover smart contract bugs or a sudden depeg.{" "}
              <Link href="/docs#safety-score" className="font-medium text-ink underline underline-offset-2">
                Read more in Docs
              </Link>
            </p>
          </div>
        </div>
        {top && (
          <div className="arch relative flex items-center justify-center overflow-hidden rounded-b-[4px] border border-frame bg-plate px-4 pb-10 pt-16 [--arch:80px] md:px-10 md:pb-14 md:pt-20 md:[--arch:120px]">
            <Image src={banner} alt="" fill sizes="(min-width: 1024px) 560px, 100vw" className="object-cover object-[78%_50%] opacity-25 blur-[3px]" />
            <div aria-hidden="true" className="absolute inset-0 bg-linear-to-t from-plate via-plate/70 to-plate/30" />
            <div className="relative flex w-full justify-center">
              <ScoreShowcase route={top} />
            </div>
          </div>
        )}
      </div>
    </section>
  )
}

function Alerts() {
  return (
    <section id="alerts" className="reveal mx-auto grid max-w-[1200px] scroll-mt-24 items-center gap-10 px-4 pt-20 md:px-8 md:pt-32 lg:grid-cols-2 lg:gap-16">
      <div className="arch order-2 rounded-b-[4px] border border-frame bg-secondary/60 px-4 pb-4 pt-14 [--arch:80px] sm:px-6 sm:pb-6 md:px-8 md:pb-8 md:pt-20 md:[--arch:120px] lg:order-1">
        <ul aria-label="What alerts cover" className="m-0 flex list-none flex-col gap-3 p-0">
          {ALERT_KINDS.map((kind, index) => (
            <li
              key={kind.title}
              className={cn(
                "flex gap-3 rounded-[12px] border border-hairline bg-card p-3.5 shadow-[0_14px_30px_-24px_rgba(43,20,14,0.7)]",
                index % 2 === 1 && "sm:ml-8",
                index % 2 === 0 && "sm:mr-8"
              )}
            >
              <span className="grid size-10 shrink-0 place-items-center rounded-[10px] border border-hairline bg-background">
                <Image src={mark} alt="" className="h-5 w-auto" />
              </span>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="label-roman text-[10px]">Hermes</span>
                <span className="text-[15px] font-semibold leading-snug">{kind.title}</span>
                <span className="text-[13px] leading-snug text-muted-foreground">{kind.body}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
      <div className="order-1 lg:order-2">
        <span className="eyebrow-pill">
          <span className="diamond" aria-hidden="true" />
          Alerts
        </span>
        <h2 className="mt-4 font-display text-[34px] font-semibold leading-[1.06] md:text-[50px]">Alerts, not another dashboard</h2>
        <p className="mt-3.5 max-w-[520px] text-[15px] leading-relaxed text-muted-foreground md:text-[17px]">
          You should not have to watch rates all day. Tap the bell under a route and Hermes checks it every 10 minutes. Your
          phone hears about it when something changes.
        </p>
        <ul className="m-0 mt-6 flex list-none flex-col gap-2.5 p-0 text-[15px]">
          {[
            "Web push: no app and no Telegram needed.",
            "Android in Chrome. iPhone from the Home Screen, iOS 16.4 or later.",
            "Hermes keeps your device's notification address and the routes you watch. Never your wallet.",
          ].map((line) => (
            <li key={line} className="flex items-start gap-3">
              <span className="diamond mt-2 shrink-0" aria-hidden="true" />
              {line}
            </li>
          ))}
        </ul>
        <Link href="/app" className="btn-frame mt-7 h-12 px-6 text-[15px]">
          <Bell className="size-4" aria-hidden="true" />
          Turn on alerts
        </Link>
      </div>
    </section>
  )
}

function Audiences() {
  return (
    <section id="who" className="reveal mx-auto max-w-[1200px] scroll-mt-24 px-4 pt-20 md:px-8 md:pt-32">
      <SectionHead
        eyebrow="Who it's for"
        title="For money that should be earning"
        intro="Yield without living in ten apps, and without guessing which ones hold up."
      />
      <ul className="m-0 grid list-none gap-4 p-0 sm:grid-cols-2 lg:grid-cols-4">
        {AUDIENCES.map((audience) => (
          <li key={audience.title} className="plaque arch [--arch:96px]">
            <div className="plaque-inner flex h-full flex-col items-center gap-2 px-5 pb-6 pt-8 text-center">
              <span className="medallion mb-2 size-12" aria-hidden="true">
                <audience.icon className="size-5" />
              </span>
              <h3 className="font-display text-[23px] font-bold leading-tight">{audience.title}</h3>
              <p className="text-sm leading-relaxed text-muted-foreground">{audience.body}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

function Custody() {
  return (
    <section
      id="custody"
      className="reveal mx-auto grid max-w-[1200px] scroll-mt-24 gap-10 px-4 pt-20 md:px-8 md:pt-32 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,2fr)] lg:gap-16"
    >
      <div>
        <h2 className="font-display text-[40px] font-semibold leading-[1.02] md:text-[56px]">Funds never touch Hermes</h2>
        <Link href="/docs" className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold hover:text-ink">
          Read the Docs
          <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
      </div>
      <ul className="m-0 grid list-none gap-9 p-0 md:grid-cols-3 md:gap-8">
        {CUSTODY.map((item) => (
          <li key={item.title} className="border-t border-gilt pt-5">
            <h3 className="font-display text-[23px] font-bold leading-tight">{item.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground md:text-[15px]">{item.body}</p>
          </li>
        ))}
      </ul>
    </section>
  )
}

function Roadmap() {
  return (
    <section id="roadmap" className="reveal mx-auto max-w-[1200px] scroll-mt-24 px-4 pt-20 md:px-8 md:pt-32">
      <SectionHead
        eyebrow="Roadmap"
        title="Where Hermes is going"
        intro="The index first, then the router, then automation. One route at a time, each one checked before it goes in."
      />
      <ol className="m-0 grid list-none gap-4 p-0 sm:grid-cols-2 lg:grid-cols-4">
        {ROADMAP.map((stage, index) => (
          <li key={stage.title} className="plaque arch [--arch:96px]">
            <div className="plaque-inner flex h-full flex-col items-center gap-2 px-5 pb-6 pt-8 text-center">
              <span aria-hidden="true" className="font-roman text-[24px] font-semibold leading-none text-ornament">
                {["I", "II", "III", "IV"][index]}
              </span>
              <h3 className="mt-1 font-display text-[23px] font-bold leading-tight">{stage.title}</h3>
              <span className="inline-flex h-6 items-center gap-1.5 rounded-full border border-frame px-2.5 text-[11px] font-semibold">
                <span className={cn("size-1.5 rounded-full", STATUS_DOT[stage.status])} aria-hidden="true" />
                {stage.status}
              </span>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{stage.body}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}

function Questions() {
  return (
    <section id="faq" className="reveal mx-auto flex max-w-[1200px] scroll-mt-24 flex-wrap gap-x-16 gap-y-6 px-4 pt-20 md:px-8 md:pt-32">
      <div className="flex-[1_1_260px]">
        <span className="eyebrow-pill">
          <span className="diamond" aria-hidden="true" />
          Questions
        </span>
        <h2 className="mt-4 font-display text-[34px] font-semibold leading-[1.06] md:text-[50px]">Plain answers</h2>
        <p className="mt-3.5 text-[15px] leading-relaxed text-muted-foreground">
          About funds, risk and fees. More in{" "}
          <Link href="/docs" className="font-medium text-ink underline underline-offset-2">
            Docs
          </Link>
          .
        </p>
      </div>
      <Accordion type="single" collapsible defaultValue="item-0" className="min-w-0 flex-[999_1_560px] border-b border-frame">
        {FAQS.map((faq, index) => (
          <AccordionItem key={faq.question} value={`item-${index}`} className="border-b-0 border-t border-frame">
            <AccordionTrigger className="py-4 font-display text-[21px] font-bold text-foreground md:py-[18px] md:text-[23px]">
              {faq.question}
            </AccordionTrigger>
            <AccordionContent className="pb-[22px] pr-10 text-sm leading-[1.65] text-muted-foreground md:text-[15px]">
              {faq.answer}
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </section>
  )
}

// The hero's arch again, at dusk: the fresco under the Night colors, with one way into the app
function ClosingCall() {
  return (
    <section className="reveal mx-auto max-w-[1200px] px-4 pb-16 pt-20 md:px-8 md:pb-24 md:pt-32">
      <div className="dark relative overflow-hidden rounded-b-[4px] rounded-t-[110px] border border-gilt bg-card text-foreground sm:rounded-t-[200px] md:rounded-t-[300px]">
        <Image src={banner} alt="" fill sizes="(min-width: 1200px) 1136px, 100vw" className="object-cover object-[37%_50%] opacity-40" />
        <div aria-hidden="true" className="absolute inset-0 bg-linear-to-b from-card/10 via-card/75 to-card" />
        <div className="relative flex flex-col items-center gap-4 px-6 pb-12 pt-40 text-center md:pb-16 md:pt-44">
          <h2 className="font-display text-[40px] font-semibold leading-[1.04] md:text-[60px]">Find your route</h2>
          <p className="max-w-[460px] text-[15px] leading-relaxed text-muted-foreground md:text-[17px]">
            Live rates, a score on every route, and a deposit you sign yourself. Start small.
          </p>
          <div className="mt-2 flex w-full max-w-[420px] justify-center gap-3">
            <LaunchApp className="h-12 flex-1 whitespace-nowrap px-3 text-[15px] sm:flex-none sm:px-7" />
            <Link href="/docs" className="btn-frame h-12 flex-1 whitespace-nowrap px-3 text-[15px] sm:flex-none sm:px-7">
              Read the Docs
            </Link>
          </div>
        </div>
      </div>
    </section>
  )
}
