import type React from "react"
import type { Metadata } from "next"
import Image from "next/image"
import Link from "next/link"
import { notFound } from "next/navigation"
import { AlertTriangle, ArrowRight, ChevronRight } from "lucide-react"

import { cn } from "@/lib/utils"
import { YieldAPI, type YieldRoute } from "@/lib/api/yield-api"
import { isTopRated, TOP_RATED_MIN_SCORE } from "@/lib/top-rated"
import {
  borrowedPercent,
  exitTight,
  explainRoute,
  routeLabel,
  routeSlug,
  typeLabel,
  whatCanGoWrong,
  withdrawablePercent,
} from "@/lib/route-copy"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { LaunchApp } from "@/components/site/launch-app"
import { LiveDot } from "@/components/site/live-dot"
import { RouteList, bySafety, percent } from "@/components/site/route-list"
import { ScoreShowcase, scoreColor } from "@/components/site/score-showcase"
import { SITE_URL } from "@/lib/site"

// A page per route ("JitoSOL APY today"): the live rate, the Safety Score part by part, what can go wrong, how to
// get in and out, and the other routes for the same token. Hermes's own data for searches no one else answers live.
// Rendered on the server and refreshed at most once a minute. If the API is down the last good page stays up, with
// the time it was read. A route whose source fails drops out, like it does in the app.
export const revalidate = 60

const TOKEN_ICONS: Record<string, string> = {
  SOL: "/brand-logos/solanaLogoMark.svg",
  USDC: "/brand-logos/usdcLogoMark.svg",
  USDT: "/brand-logos/tetherLogoMark.svg",
}

async function allRoutes(): Promise<YieldRoute[]> {
  return YieldAPI.getRoutes(undefined, { revalidate: 60, signal: AbortSignal.timeout(10_000) })
}

// No pages at build time: each renders on its first visit and is kept for a minute after. A deploy never waits on
// the API, and an API that is down during a build can't fail it.
export async function generateStaticParams() {
  return []
}

// The route for this address, with every route for the comparison. A failed read throws, so Next keeps the last
// good page instead of caching an error.
async function load(slug: string): Promise<{ route: YieldRoute; routes: YieldRoute[] }> {
  if (!/^[a-z0-9-]{1,48}$/.test(slug)) notFound()
  const routes = await allRoutes()
  const route = routes.find((candidate) => routeSlug(candidate) === slug)
  if (!route) notFound()
  return { route, routes }
}

function usd(value: number): string {
  if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`
  if (value >= 1e8) return `$${Math.round(value / 1e6)}M`
  if (value >= 1e6) return `$${(value / 1e6).toFixed(1)}M`
  return `$${Math.round(value).toLocaleString("en-US")}`
}

const readAt = (route: YieldRoute) =>
  new Date(route.updatedAt).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }) + " UTC"

// One line on what the route is, for the top of the page and the search snippet
function intro(route: YieldRoute): string {
  if (route.curator) {
    return `Kamino's ${route.name} vault, curated by ${route.curator}. Lend ${route.token} across several Kamino reserves from your own wallet.`
  }
  if (route.category === "lending") {
    return `Lend ${route.token} on ${route.name} from your own wallet and earn the interest borrowers pay.`
  }
  return `${route.name}'s liquid staking token. Swap SOL for ${route.receipt} and it earns staking rewards in your own wallet.`
}

// How easily money leaves today: the exit cost for a staking token, what can leave or what is borrowed for lending
function exitStat(route: YieldRoute): { value: string; label: string } | null {
  if (route.category === "liquid-staking") {
    return typeof route.exitCost === "number"
      ? { value: `${(route.exitCost * 100).toFixed(2)}%`, label: "lost selling back to SOL today" }
      : null
  }
  const withdrawable = withdrawablePercent(route)
  if (withdrawable !== null) return { value: `${withdrawable}%`, label: "can be withdrawn right now" }
  const borrowed = borrowedPercent(route)
  if (borrowed !== null) return { value: `${borrowed}%`, label: "of the reserve is borrowed" }
  return null
}

const UNSCORED = "A route gets a score once every part has live data. Until then it shows with its TVL risk and stays out of Top rated."

// Where the route stands against Top rated
function ratedSentence(route: YieldRoute): string {
  if (!route.safety) return UNSCORED
  if (isTopRated(route)) return `It is top rated: ${TOP_RATED_MIN_SCORE} or more, and Hermes opens on routes like it.`
  return route.safety.score >= TOP_RATED_MIN_SCORE
    ? "It scores 80 or more, but its reserve is nearly all borrowed, so it sits outside Top rated."
    : `Top rated needs ${TOP_RATED_MIN_SCORE} or more, so Hermes shows it under All routes.`
}

// The score with every part, for the question about it
function scoreSentence(route: YieldRoute): string {
  if (!route.safety) return `It is not scored yet. ${UNSCORED}`
  const parts = route.safety.parts.map((part) => `${part.label.toLowerCase()} ${part.points}/${part.max}`).join(", ")
  const taken = (route.safety.deductions ?? []).filter((deduction) => deduction.points < 0)
  const deductions = taken.length > 0 ? ` Deductions: ${taken.map((d) => `${d.label.toLowerCase()} −${-d.points}`).join(", ")}.` : ""
  return `${route.safety.score} of 100 from live data: ${parts}.${deductions} ${ratedSentence(route)}`
}

function questions(route: YieldRoute): { question: string; answer: string }[] {
  const label = routeLabel(route)
  const moves =
    route.category === "liquid-staking"
      ? "It moves as Solana's staking rewards change from one epoch to the next."
      : "It moves as borrowers borrow more or less."
  const cap = route.depositCap ? ` In beta, up to ${route.depositCap.toLocaleString("en-US")} ${route.token} per deposit.` : ""
  return [
    {
      question: `What is the ${label} APY today?`,
      answer: `${percent(route.apy)} as of ${readAt(route)}, from ${route.source === "On-chain" ? "the chain" : route.source}. ${moves} It is today's rate, not a promise of what you will earn.`,
    },
    {
      question: `What is ${label}'s Safety Score?`,
      answer: `${scoreSentence(route)} The score does not cover smart contract bugs or a sudden depeg.`,
    },
    {
      question: `How do I deposit into ${label}?`,
      answer: `Open it in Hermes, connect your wallet and type an amount. Hermes builds the deposit, simulates it, and your wallet signs it. The funds go straight to ${route.name}, never through Hermes.${cap}`,
    },
    {
      question: `How do I get out of ${label}?`,
      answer: `${explainRoute(route).out} Hermes's Portfolio has a Withdraw button for it, and Reroute to move it to another route for the same token.`,
    },
    { question: `What can go wrong with ${label}?`, answer: whatCanGoWrong(route) },
  ]
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const { route } = await load(slug)
  const label = routeLabel(route)
  const score = route.safety ? `, Safety ${route.safety.score}` : ""
  const title = `${label} APY Today: ${percent(route.apy)}${score} · Hermes`
  const description = `${label} pays ${percent(route.apy)} APY today, read live. ${
    route.safety ? `Safety Score ${route.safety.score}/100 from live data, part by part.` : "See how it scores as data comes in."
  } What can go wrong, how to get out, and a deposit you sign in your own wallet.`
  const path = `/routes/${slug}`
  return {
    title,
    description,
    alternates: { canonical: path },
    // The share image is the route's own, drawn by opengraph-image.tsx and twitter-image.tsx next to this page
    openGraph: { type: "website", url: path, siteName: "Hermes", title, description, locale: "en_US" },
    twitter: { card: "summary_large_image", site: "@Hermes_agg", title, description },
  }
}

export default async function RoutePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const { route, routes } = await load(slug)
  const label = routeLabel(route)
  const sameToken = routes.filter((candidate) => candidate.token === route.token).sort(bySafety)
  const faqs = questions(route)

  const structuredData = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Routes", item: `${SITE_URL}/routes` },
          { "@type": "ListItem", position: 2, name: `${route.token} routes`, item: `${SITE_URL}/routes#${route.token.toLowerCase()}` },
          { "@type": "ListItem", position: 3, name: label, item: `${SITE_URL}/routes/${slug}` },
        ],
      },
      {
        "@type": "FAQPage",
        mainEntity: faqs.map((faq) => ({ "@type": "Question", name: faq.question, acceptedAnswer: { "@type": "Answer", text: faq.answer } })),
      },
    ],
  }

  return (
    <div>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }} />
      <Hero route={route} sameToken={sameToken} />
      <Score route={route} />
      <InAndOut route={route} />
      <Compare route={route} sameToken={sameToken} />
      <Questions label={label} faqs={faqs} />
    </div>
  )
}

function Hero({ route, sameToken }: { route: YieldRoute; sameToken: YieldRoute[] }) {
  const label = routeLabel(route)
  const best = Math.max(...sameToken.map((candidate) => candidate.apy))
  const rank = [...sameToken].sort((a, b) => b.apy - a.apy).findIndex((candidate) => candidate.id === route.id) + 1
  const exit = exitStat(route)
  const stats: { label: string; value: React.ReactNode; note: React.ReactNode }[] = [
    {
      label: "APY today",
      value: <span className={cn(route.apy === best && "text-ink")}>{percent(route.apy)}</span>,
      note: route.apy === best ? `Highest of ${sameToken.length} ${route.token} routes` : `${ordinal(rank)} of ${sameToken.length} ${route.token} routes by APY`,
    },
    {
      label: "Safety Score",
      value: route.safety ? (
        <span>
          <span className={scoreColor(route.safety.score)}>{route.safety.score}</span>
          <span className="font-sans text-sm font-medium text-muted-foreground"> / 100</span>
        </span>
      ) : (
        <span className="font-display text-[24px] font-bold text-muted-foreground md:text-[28px]">Not scored yet</span>
      ),
      note: isTopRated(route) ? (
        <span className="flex items-center gap-1.5">
          <span className="diamond" aria-hidden="true" />
          Top rated
        </span>
      ) : route.safety ? (
        `Below Top rated (${TOP_RATED_MIN_SCORE}+)`
      ) : (
        "Waiting on live data"
      ),
    },
    { label: "Deposited", value: usd(route.tvl), note: `in ${route.name}` },
    ...(exit ? [{ label: route.category === "liquid-staking" ? "Exit cost" : "Exit", value: exit.value, note: exit.label }] : []),
  ]

  return (
    <section className="mx-auto max-w-[1200px] px-4 pt-6 md:px-8 md:pt-10">
      <nav aria-label="Breadcrumb" className="mb-4 text-[13px] text-muted-foreground">
        <ol className="m-0 flex list-none flex-wrap items-center gap-1.5 p-0">
          <li>
            <Link href="/routes" className="hover:text-foreground">
              Routes
            </Link>
          </li>
          <li aria-hidden="true">
            <ChevronRight className="size-3.5" />
          </li>
          <li>
            <Link href={`/routes#${route.token.toLowerCase()}`} className="hover:text-foreground">
              {route.token}
            </Link>
          </li>
          <li aria-hidden="true">
            <ChevronRight className="size-3.5" />
          </li>
          <li aria-current="page" className="font-medium text-foreground">
            {label}
          </li>
        </ol>
      </nav>

      <div className="plaque arch [--arch:44px] md:[--arch:80px] shadow-[0_30px_70px_-45px_rgba(43,20,14,0.6)]">
        <div className="plaque-inner">
          <div className="px-5 pb-7 pt-10 text-center sm:px-8 md:px-12 md:pb-9 md:pt-14">
            <span className="eyebrow-pill">
              <Image src={TOKEN_ICONS[route.token] ?? TOKEN_ICONS.SOL} alt="" width={14} height={14} className="size-3.5" />
              {typeLabel(route)} · {route.token}
            </span>
            <h1 className="mt-4 font-display text-[42px] font-semibold leading-[1] sm:text-[56px] lg:text-[68px]">
              {label} <em className="font-medium">APY today</em>
            </h1>
            <p className="mx-auto mt-4 max-w-[560px] text-[15px] leading-relaxed text-muted-foreground md:text-[17px]">{intro(route)}</p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              <LaunchApp href={`/app?route=${encodeURIComponent(route.id)}`} className="h-12 flex-1 px-3 text-[15px] sm:flex-none sm:px-7" />
              <Link href="#compare" className="btn-frame h-12 flex-1 whitespace-nowrap px-3 text-[15px] sm:flex-none sm:px-7">
                Compare {route.token} routes
              </Link>
            </div>
            <ul className="m-0 mt-6 flex list-none flex-wrap justify-center gap-x-5 gap-y-2 p-0 text-[13px] font-medium">
              {[
                route.depositCap ? `Beta: up to ${route.depositCap.toLocaleString("en-US")} ${route.token} per deposit` : "Beta",
                "No Hermes fee today",
                "You sign in your own wallet",
              ].map((fact) => (
                <li key={fact} className="flex items-center gap-2">
                  <span className="diamond" aria-hidden="true" />
                  {fact}
                </li>
              ))}
            </ul>
          </div>

          <dl className={cn("m-0 grid grid-cols-2 border-t border-hairline bg-plate", stats.length === 4 ? "lg:grid-cols-4" : "lg:grid-cols-3")}>
            {stats.map((stat, index) => (
              <div
                key={stat.label}
                className={cn(
                  "flex flex-col gap-1.5 border-hairline px-5 py-5 md:px-7 md:py-6",
                  index % 2 === 0 && "border-r",
                  index < 2 && "border-b lg:border-b-0",
                  index < stats.length - 1 && "lg:border-r"
                )}
              >
                <dt className="label-roman text-[10px]">{stat.label}</dt>
                <dd className="m-0 font-roman text-[26px] font-bold leading-none md:text-[32px]">{stat.value}</dd>
                <dd className="m-0 text-xs leading-snug text-muted-foreground">{stat.note}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>

      {exitTight(route) && (
        <p className="mt-4 flex items-start gap-2.5 rounded-[4px] border border-warning-line bg-warning-surface px-4 py-3 text-sm leading-relaxed">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
          Almost all of this reserve is borrowed right now, so a withdrawal may wait until borrowers repay. The rate is high
          because the reserve is scarce.
        </p>
      )}

      <p className="mt-3 flex items-center justify-center gap-2 text-center text-xs text-muted-foreground">
        <LiveDot className="shrink-0" />
        <span>
          Read {readAt(route)} · APY and deposits from {route.source === "On-chain" ? "the chain" : route.source} · refreshed every
          minute
        </span>
      </p>
    </section>
  )
}

function ordinal(n: number): string {
  const suffix = n % 10 === 1 && n % 100 !== 11 ? "st" : n % 10 === 2 && n % 100 !== 12 ? "nd" : n % 10 === 3 && n % 100 !== 13 ? "rd" : "th"
  return `${n}${suffix}`
}

function SectionTitle({ eyebrow, title, intro }: { eyebrow: string; title: React.ReactNode; intro?: string }) {
  return (
    <div>
      <span className="eyebrow-pill">
        <span className="diamond" aria-hidden="true" />
        {eyebrow}
      </span>
      <h2 className="mt-4 font-display text-[32px] font-semibold leading-[1.06] md:text-[44px]">{title}</h2>
      {intro && <p className="mt-3 max-w-[520px] text-[15px] leading-relaxed text-muted-foreground md:text-[16px]">{intro}</p>}
    </div>
  )
}

function Score({ route }: { route: YieldRoute }) {
  const label = routeLabel(route)
  return (
    <section
      id="score"
      className={cn(
        "mx-auto grid max-w-[1200px] scroll-mt-24 items-center gap-8 px-4 pt-16 md:px-8 md:pt-24",
        route.safety && "lg:grid-cols-2 lg:gap-14"
      )}
    >
      <div>
        <SectionTitle
          eyebrow="Safety Score"
          title={route.safety ? `Why ${label} scores ${route.safety.score}` : `${label} isn't scored yet`}
          intro={route.safety ? `${route.safety.score} of 100 from live data. ${ratedSentence(route)}` : UNSCORED}
        />
        <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
          Four parts from live data, 25 points each, then deductions for validator spread and incidents. It does not cover
          smart contract bugs or a sudden depeg.
        </p>
        <Link href="/docs#safety-score" className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold hover:text-ink">
          How the score works
          <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
      </div>
      {route.safety ? (
        <div className="arch flex justify-center rounded-b-[4px] border border-frame bg-plate px-4 pb-8 pt-14 [--arch:80px] md:px-10 md:pb-10 md:pt-16 md:[--arch:120px]">
          <ScoreShowcase
            route={{
              id: route.id,
              name: route.name,
              subtitle: `${route.receipt ?? route.token} · ${typeLabel(route)}`,
              score: route.safety.score,
              parts: route.safety.parts,
              deductions: route.safety.deductions ?? [],
            }}
            label={null}
            note="Live from the Hermes API. Each part names what it measured and its source."
          />
        </div>
      ) : null}
    </section>
  )
}

function InAndOut({ route }: { route: YieldRoute }) {
  const { what, yieldFrom, out } = explainRoute(route)
  const rows = [
    ["What it is", what],
    ["Yield from", yieldFrom],
    ["Getting out", out],
  ]
  return (
    <section className="mx-auto grid max-w-[1200px] gap-4 px-4 pt-16 md:px-8 md:pt-24 lg:grid-cols-2">
      <div className="plaque arch [--arch:72px]">
        <div className="plaque-inner h-full px-6 pb-7 pt-12 md:px-9 md:pt-14">
          <h2 className="font-display text-[28px] font-bold leading-tight md:text-[34px]">How it works</h2>
          <dl className="m-0 mt-5 flex flex-col gap-4">
            {rows.map(([term, text]) => (
              <div key={term} className="flex flex-col gap-1 border-t border-hairline pt-3">
                <dt className="label-roman text-[10px]">{term}</dt>
                <dd className="m-0 text-[15px] leading-relaxed">{text}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
      <div className="plaque arch [--arch:72px]">
        <div className="plaque-inner h-full px-6 pb-7 pt-12 md:px-9 md:pt-14">
          <h2 className="font-display text-[28px] font-bold leading-tight md:text-[34px]">What can go wrong</h2>
          <p className="mt-5 border-t border-hairline pt-3 text-[15px] leading-relaxed">{whatCanGoWrong(route)}</p>
          <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
            The Safety Score weighs what live data can show, and alerts tell you when this route changes. Neither removes the
            risk. Start small.
          </p>
          <Link href="/docs#risks" className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold hover:text-ink">
            Risks in Docs
            <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        </div>
      </div>
    </section>
  )
}

function Compare({ route, sameToken }: { route: YieldRoute; sameToken: YieldRoute[] }) {
  return (
    <section id="compare" className="mx-auto max-w-[1200px] scroll-mt-24 px-4 pt-16 md:px-8 md:pt-24">
      <div className="mx-auto max-w-[760px]">
        <div className="text-center">
          <SectionTitle
            eyebrow={`${sameToken.length} ${route.token} routes`}
            title={`Every ${route.token} route, live`}
          />
          <p className="mx-auto mt-3 max-w-[520px] text-[15px] leading-relaxed text-muted-foreground">
            Sorted by Safety Score, then APY, the way Hermes opens. The diamond marks Top rated.
          </p>
        </div>
        <div className="plaque mt-8">
          <div className="plaque-inner">
            <RouteList routes={sameToken} currentId={route.id} />
          </div>
        </div>
        <p className="mt-4 text-center">
          <Link href="/routes" className="inline-flex items-center gap-1.5 text-sm font-semibold hover:text-ink">
            Routes for every token
            <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        </p>
      </div>
    </section>
  )
}

function Questions({ label, faqs }: { label: string; faqs: { question: string; answer: string }[] }) {
  return (
    <section id="faq" className="mx-auto flex max-w-[1200px] scroll-mt-24 flex-wrap gap-x-16 gap-y-6 px-4 pb-16 pt-16 md:px-8 md:pb-24 md:pt-24">
      <div className="flex-[1_1_260px]">
        <SectionTitle eyebrow="Questions" title={`${label}, plainly`} />
        <p className="mt-3.5 text-[15px] leading-relaxed text-muted-foreground">
          Every number here is live. More in{" "}
          <Link href="/docs" className="font-medium text-ink underline underline-offset-2">
            Docs
          </Link>
          .
        </p>
      </div>
      <Accordion type="single" collapsible defaultValue="item-0" className="min-w-0 flex-[999_1_560px] border-b border-frame">
        {faqs.map((faq, index) => (
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
