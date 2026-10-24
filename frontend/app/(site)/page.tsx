import Image from "next/image"
import Link from "next/link"
import { ArrowRight } from "lucide-react"

import { YieldAPI, type YieldRoute } from "@/lib/api/yield-api"
import { isTopRated } from "@/lib/top-rated"
import { DiamondRule } from "@/components/app/layout/meander"
import { NetworkPill } from "@/components/app/layout/network-pill"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import banner from "@/public/brand/aurora-banner.jpg"

// The landing page: what Hermes is, the routes that are top rated right now, how it works, the Safety Score and
// plain answers. The app itself is at /app. Live rates render on the server, refreshed at most once a minute, so
// search engines see real numbers. If the API is down, the live section is left out rather than filled in.
export const revalidate = 60

async function liveRoutes(): Promise<YieldRoute[] | null> {
  try {
    return await YieldAPI.getRoutes(undefined, { revalidate: 60, signal: AbortSignal.timeout(10_000) })
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

const STEPS = [
  {
    numeral: "I",
    title: "Pick a token and amount",
    body: "Type how much SOL, USDC or USDT you want to put to work. Every route quotes it live, and the best quote is marked.",
  },
  {
    numeral: "II",
    title: "Pick a route you trust",
    body: "Hermes opens on Top rated: routes with a Safety Score of 80 or more. Open Why to see each part of the score and where it came from.",
  },
  {
    numeral: "III",
    title: "Sign in your own wallet",
    body: "Hermes builds the transaction and you sign it. The tokens land in your wallet, and you can withdraw from Portfolio any time.",
  },
]

const PARTS = [
  { title: "Size", body: "How much is deposited. Full points at $1B." },
  { title: "Track record", body: "How long the protocol has held deposits. Full points at four years." },
  { title: "Outflows", body: "How much left in the last 30 days, counted in tokens so price moves don't count." },
  { title: "Exit", body: "For lending, how much of the reserve is borrowed. For staking tokens, what a 10,000-token sale returns against the pool value." },
]

const FAQS = [
  {
    question: "What is Hermes?",
    answer:
      "Hermes compares yield on Solana. It shows live rates from staking and lending protocols side by side, scores every route for safety, and builds the deposit for the route you pick. You sign it in your own wallet.",
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

const apy = (route: YieldRoute) => `${(route.apy * 100).toFixed(2)}%`

export default async function Landing() {
  const routes = await liveRoutes()
  return (
    <div>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(FAQ_DATA) }} />
      <Hero />
      {routes && routes.length > 0 && <LiveNow routes={routes} />}
      <HowItWorks />
      <SafetyScore />
      <Questions />
      <ClosingCall />
    </div>
  )
}

// Reni's Aurora in an arch, with the headline on a plaque set over its lower edge
function Hero() {
  return (
    <section className="mx-auto max-w-[1200px] px-4 pt-4 md:px-8 md:pt-8">
      <figure className="m-0 rounded-t-[100px] border border-gilt bg-card p-1 md:rounded-t-[246px] md:p-1.5">
        <Image
          src={banner}
          alt="Guido Reni's Aurora fresco with the Hermes mark as Apollo leading the Hours"
          sizes="(min-width: 1200px) 1136px, 100vw"
          className="block aspect-[3/1] h-auto w-full rounded-t-[96px] rounded-b-[2px] object-cover md:rounded-t-[240px]"
          preload
        />
      </figure>

      <div className="plaque relative mx-2 -mt-6 border-gilt sm:mx-auto sm:max-w-[840px] md:-mt-[clamp(24px,6.5vw,96px)] md:p-[5px]">
        <div className="plaque-inner px-5 pb-6 pt-5 text-center sm:px-8 sm:pb-8 sm:pt-7 md:px-10 md:pb-10 md:pt-9">
          <NetworkPill className="mb-3 h-7 px-2.5 text-[11px] md:mb-4" />
          <h1 className="font-display text-[32px] font-semibold leading-[1.08] sm:text-[44px] md:text-[60px] md:leading-[1.04]">
            Compare Solana yields.{" "}
            <br />
            <em className="font-medium">Deposit from your own wallet.</em>
          </h1>
          <p className="mx-auto mt-3.5 max-w-[600px] text-[15px] leading-relaxed text-muted-foreground md:mt-[18px] md:text-[17px]">
            Hermes checks live rates across Solana staking and lending, scores every route for safety, and builds the
            deposit for the one you pick. You sign it in your wallet. Funds never touch Hermes.
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <Link href="/app" className="btn-teal h-12 px-6 text-[15px]">
              Open app
            </Link>
            <Link href="#how" className="btn-frame h-12 px-6 text-[15px]">
              How it works
            </Link>
          </div>
          <ul className="m-0 mt-6 flex list-none flex-wrap items-center justify-center gap-x-[18px] gap-y-2.5 p-0 text-[13px] font-medium md:mt-7 md:text-sm">
            {FACTS.map((fact, index) => (
              <li key={fact} className="flex items-center gap-[18px]">
                {index > 0 && <span className="diamond" aria-hidden="true" />}
                {fact}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}

// The routes that are top rated right now, per token, from the live API
function LiveNow({ routes }: { routes: YieldRoute[] }) {
  const columns = TOKENS.map((token) => ({
    ...token,
    routes: routes
      .filter((route) => route.token === token.symbol && isTopRated(route))
      .sort((a, b) => (b.safety?.score ?? 0) - (a.safety?.score ?? 0) || b.apy - a.apy)
      .slice(0, 3),
  })).filter((column) => column.routes.length > 0)
  if (columns.length === 0) return null

  return (
    <section id="live" className="mx-auto max-w-[1200px] scroll-mt-24 px-4 pt-16 md:px-8 md:pt-24">
      <p className="eyebrow text-center text-[11px] md:text-[13px]">Live now</p>
      <h2 className="mb-3 mt-2.5 text-center font-display text-[32px] font-semibold leading-[1.1] md:text-[44px]">Top rated right now</h2>
      <p className="mx-auto mb-8 max-w-[560px] text-center text-[15px] leading-relaxed text-muted-foreground md:mb-12">
        Routes with a Safety Score of 80 or more. Rates come from the chain and the protocols, refreshed every minute.
      </p>
      <div className="flex flex-wrap gap-4 md:gap-6">
        {columns.map((column) => {
          const best = Math.max(...column.routes.map((route) => route.apy))
          return (
            <div key={column.symbol} className="plaque min-w-0 flex-[1_1_300px]">
              <div className="plaque-inner">
                <div className="flex items-center gap-2.5 border-b border-hairline px-4 py-3">
                  <Image src={column.icon} alt="" width={24} height={24} className="size-6" />
                  <span className="font-roman text-[13px] font-bold tracking-[0.14em]">{column.symbol}</span>
                </div>
                <ul className="m-0 list-none p-0">
                  {column.routes.map((route) => (
                    <li key={route.id} className="flex items-center gap-3 border-t border-row-line px-4 py-3 first:border-t-0">
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="font-display text-[20px] font-bold leading-[1.1]">{route.name}</span>
                        <span className="text-[11px] text-muted-foreground">Safety {route.safety?.score}</span>
                      </span>
                      <span className={route.apy === best ? "font-roman text-[20px] font-bold text-ink" : "font-roman text-[20px] font-bold"}>
                        {apy(route)} <span className="font-sans text-xs font-medium">APY</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )
        })}
      </div>
      <p className="mt-6 text-center">
        <Link href="/app" className="inline-flex items-center gap-1.5 text-[15px] font-medium text-ink underline underline-offset-4">
          Compare all {routes.length} routes in the app
          <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
      </p>
    </section>
  )
}

function HowItWorks() {
  return (
    <section id="how" className="mx-auto max-w-[1200px] scroll-mt-24 px-4 pt-16 md:px-8 md:pt-24">
      <DiamondRule className="mb-7" />
      <p className="eyebrow text-center text-[11px] md:text-[13px]">How it works</p>
      <h2 className="mb-8 mt-2.5 text-center font-display text-[32px] font-semibold leading-[1.1] md:mb-12 md:text-[44px]">
        From rate to deposit
      </h2>
      <ol className="m-0 flex list-none flex-wrap gap-7 p-0 md:gap-8">
        {STEPS.map((step) => (
          <li key={step.numeral} className="flex flex-[1_1_280px] flex-col items-center gap-2 text-center md:gap-3">
            <span aria-hidden="true" className="font-roman text-[30px] font-semibold leading-none text-ornament md:text-[40px]">
              {step.numeral}
            </span>
            <h3 className="font-display text-[23px] font-bold md:text-[26px]">{step.title}</h3>
            <p className="max-w-[320px] text-sm leading-relaxed text-muted-foreground md:text-[15px]">{step.body}</p>
          </li>
        ))}
      </ol>
    </section>
  )
}

function SafetyScore() {
  return (
    <section id="safety" className="mx-auto max-w-[1200px] scroll-mt-24 px-4 pt-16 md:px-8 md:pt-24">
      <DiamondRule className="mb-7" />
      <p className="eyebrow text-center text-[11px] md:text-[13px]">Safety Score</p>
      <h2 className="mt-2.5 text-center font-display text-[32px] font-semibold leading-[1.1] md:text-[44px]">A score on every route</h2>
      <p className="mx-auto mb-8 mt-3 max-w-[600px] text-center text-[15px] leading-relaxed text-muted-foreground md:mb-12">
        0 to 100, built from live data, so you can see which routes hold up before you deposit. Four parts, 25 points
        each, then deductions. Every part shows what it measured and its source.
      </p>
      <ul className="m-0 grid list-none grid-cols-1 gap-4 p-0 sm:grid-cols-2 lg:grid-cols-4">
        {PARTS.map((part) => (
          <li key={part.title} className="plaque">
            <div className="plaque-inner flex h-full flex-col gap-1.5 p-4">
              <span className="flex items-baseline justify-between gap-3">
                <span className="font-display text-[22px] font-bold">{part.title}</span>
                <span className="label-roman">25 pts</span>
              </span>
              <span className="text-sm leading-relaxed text-muted-foreground">{part.body}</span>
            </div>
          </li>
        ))}
      </ul>
      <p className="mx-auto mt-6 max-w-[720px] text-center text-sm leading-relaxed text-muted-foreground md:text-[15px]">
        Up to 10 points come off when one validator holds most of a pool&apos;s stake, and up to 25 for a recent hack of
        the protocol or its team. It does not cover smart contract bugs or a sudden depeg.{" "}
        <Link href="/docs#safety-score" className="font-medium text-ink underline underline-offset-2">
          Read more in Docs
        </Link>
      </p>
    </section>
  )
}

function Questions() {
  return (
    <section id="faq" className="mx-auto flex max-w-[1200px] scroll-mt-24 flex-wrap gap-x-16 gap-y-6 px-4 pt-16 md:px-8 md:pt-24">
      <div className="flex-[1_1_260px]">
        <p className="eyebrow text-[11px] md:text-[13px]">Questions</p>
        <h2 className="mt-2.5 font-display text-[32px] font-semibold leading-[1.1] md:text-[44px]">Plain answers</h2>
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

function ClosingCall() {
  return (
    <section className="mx-auto max-w-[1200px] px-4 pb-16 pt-16 md:px-8 md:pb-24 md:pt-24">
      <div className="plaque border-gilt md:p-[5px]">
        <div className="plaque-inner flex flex-col items-center gap-4 px-5 py-10 text-center md:py-14">
          <h2 className="font-display text-[30px] font-semibold leading-[1.1] md:text-[40px]">Find your route</h2>
          <p className="max-w-[480px] text-[15px] leading-relaxed text-muted-foreground">
            Live rates, a Safety Score on every route, and a deposit you sign yourself. Start small.
          </p>
          <Link href="/app" className="btn-teal h-12 px-7 text-[15px]">
            Open app
          </Link>
        </div>
      </div>
    </section>
  )
}
