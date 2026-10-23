'use client';

import Image from "next/image"

import { YieldPanel } from "@/components/app/yield-panel"
import { DiamondRule } from "@/components/app/layout/meander"
import { NetworkPill } from "@/components/app/layout/network-pill"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import banner from "@/public/brand/aurora-banner.jpg"

export default function Home() {
  return (
    <div id="top">
      <Hero />
      <YieldPanel />
      <HowItWorks />
      <FaqSection />
    </div>
  )
}

const facts = ["Non-custodial", "No Hermes fee today", "Beta: real funds, capped per deposit"]

// Reni's Aurora in an arch, with the headline on a plaque set over its lower edge
function Hero() {
  return (
    <section className="mx-auto max-w-[1200px] px-4 pt-3 md:px-8 md:pt-7">
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
        {/* Phones get the headline only, so the deposit card comes right after it */}
        <div className="plaque-inner px-4 pb-4 pt-4 text-center sm:px-6 sm:pb-7 sm:pt-6 md:px-10 md:pb-10 md:pt-9">
          {/* The header has no room for the network on phones and tablets, so it shows here */}
          <NetworkPill className="mb-2.5 h-7 px-2.5 text-[11px] md:mb-3.5 lg:hidden" />
          <p className="eyebrow mb-2.5 hidden md:mb-3.5 lg:block">Live Solana yields</p>
          <h1 className="font-display text-[28px] font-semibold leading-[1.08] sm:text-[40px] md:text-[60px] md:leading-[1.04]">
            Compare Solana yields.
            <br />
            <em className="text-[0.8em] font-medium sm:text-[1em]">Deposit from your own wallet.</em>
          </h1>
          <p className="mx-auto mt-3.5 hidden max-w-[600px] text-sm leading-relaxed text-muted-foreground sm:block md:mt-[18px] md:text-[17px]">
            Hermes checks live rates across Solana protocols and builds the deposit for the route you pick. You sign it
            in your wallet. Funds never touch Hermes.
          </p>
          <ul className="mt-5 hidden flex-wrap items-center justify-center gap-x-[18px] gap-y-2.5 text-[13px] font-medium sm:flex md:mt-[26px] md:text-sm">
            {facts.map((fact, index) => (
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

const steps = [
  {
    numeral: "I",
    title: "Pick a token and amount",
    body: "Hermes pulls live APY and TVL for every route it can deposit into, across liquid staking and lending.",
  },
  {
    numeral: "II",
    title: "Compare routes side by side",
    body: "Hermes opens on Top rated: routes with a Safety Score of 80 or more. Each row shows the rate, where it comes from and the pool size. Pick a route to see why it scores what it does and what can go wrong.",
  },
  {
    numeral: "III",
    title: "Sign in your own wallet",
    body: "Hermes builds an unsigned transaction. You approve it. The tokens or position land in your own account.",
  },
]

function HowItWorks() {
  return (
    <section id="how" className="mx-auto max-w-[1200px] scroll-mt-24 px-4 pb-16 md:px-8 md:pb-24">
      <DiamondRule className="mb-7" />
      <p className="eyebrow text-center text-[11px] md:text-[13px]">How it works</p>
      <h2 className="mb-8 mt-2.5 text-center font-display text-[32px] font-semibold leading-[1.1] md:mb-12 md:text-[44px]">
        From rate to deposit
      </h2>
      <ol className="flex flex-wrap gap-7 md:gap-8">
        {steps.map((step) => (
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

const faqs = [
  {
    question: "What is Hermes?",
    answer: "A yield aggregator for Solana. It pulls live APY and TVL from liquid staking, lending and liquidity protocols, ranks the routes for your token and amount, and builds the deposit for the one you choose.",
  },
  {
    question: "Does Hermes hold my funds?",
    answer: "No. Each deposit goes straight from your wallet to the protocol in a transaction you sign. What you receive back (for example JitoSOL) sits in your own wallet. Hermes has no vaults and no contracts holding money.",
  },
  {
    question: "Which routes can I deposit into from Hermes?",
    answer: "Every route Hermes shows deposits inside Hermes. Protocols are added one at a time, after their deposits pass our checks. Routes still in beta are labeled and capped per deposit.",
  },
  {
    question: "What are the risks?",
    answer: "Every route carries the risks of its protocol: smart contract bugs, depegs and market moves. Hermes shows a Safety Score and a risk level per route, but it cannot remove those risks. Start small.",
  },
  {
    question: "How is the Safety Score worked out?",
    answer: "Four parts from live data, up to 25 points each. Size: how much is deposited, full points at $1B. Track record: how long DefiLlama has tracked the protocol's deposits, full points at 4 years. Outflows: the largest fall in deposits in the last 30 days, counted in tokens so price moves don't count. Exit: for lending, how much of the reserve is borrowed or can't be withdrawn right now, and for liquid staking, the price impact of selling 10,000 tokens for SOL on Jupiter. Pick a route to see each part. The score does not cover smart contract bugs or depegs.",
  },
  {
    question: "What does Top rated mean?",
    answer: "The view Hermes opens with. It shows only routes with a Safety Score of 80 or more, and leaves out lending reserves where almost nothing can be withdrawn right now. Each route says plainly what can go wrong before you sign. Top rated means fewer surprises, not no risk. Tap All routes to compare everything.",
  },
  {
    question: "Can Hermes alert me when a route changes?",
    answer: "Yes, on your phone or computer. Tap the bell under a route and allow notifications. If your browser hides or blocks the prompt, Hermes shows you where to allow them. Hermes tells you when its rate falls, a better top rated route opens, a lending reserve is nearly all borrowed, or it leaves Top rated, at most once a day per kind. On iPhone, add Hermes to your Home Screen first (Share, then Add to Home Screen). Hermes keeps only your device's notification address and the routes you watch, never your wallet. Turn alerts off any time in Settings.",
  },
  {
    question: "Does Hermes charge a fee?",
    answer: "Not today. You pay the protocol's own fees and Solana network fees, and swap routes can include price impact, which Hermes shows before you sign.",
  },
]

function FaqSection() {
  return (
    <section id="faq" className="mx-auto flex max-w-[1200px] scroll-mt-24 flex-wrap gap-x-16 gap-y-6 px-4 pb-16 md:px-8 md:pb-24">
      <div className="flex-[1_1_260px]">
        <p className="eyebrow text-[11px] md:text-[13px]">Questions</p>
        <h2 className="mt-2.5 font-display text-[32px] font-semibold leading-[1.1] md:text-[44px]">Plain answers</h2>
        <p className="mt-3.5 text-[15px] leading-relaxed text-muted-foreground">About funds, risk and fees.</p>
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
