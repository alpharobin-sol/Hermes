'use client';

import Image from "next/image"

import { YieldPanel } from "@/components/app/yield-panel"
import { DiamondRule } from "@/components/app/layout/meander"
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
    <section className="mx-auto max-w-[1200px] px-4 pt-4 md:px-8 md:pt-7">
      <figure className="m-0 rounded-t-[100px] border border-gilt bg-card p-1 md:rounded-t-[246px] md:p-1.5">
        <Image
          src={banner}
          alt="Guido Reni's Aurora fresco with the Hermes mark as Apollo leading the Hours"
          sizes="(min-width: 1200px) 1136px, 100vw"
          className="block aspect-[3/1] h-auto w-full rounded-t-[96px] rounded-b-[2px] object-cover md:rounded-t-[240px]"
          preload
        />
      </figure>

      <div className="plaque relative mx-2 -mt-5 border-gilt sm:mx-auto sm:max-w-[840px] md:-mt-[clamp(24px,6.5vw,96px)] md:p-[5px]">
        <div className="plaque-inner px-4 pb-7 pt-6 text-center sm:px-6 md:px-10 md:pb-10 md:pt-9">
          <p className="eyebrow mb-2.5 text-[11px] md:mb-3.5 md:text-[13px]">Live Solana yields</p>
          <h1 className="font-display text-[29px] font-semibold leading-[1.08] sm:text-[40px] md:text-[60px] md:leading-[1.04]">
            Compare Solana yields.
            <br />
            <em className="font-medium">Deposit from your own wallet.</em>
          </h1>
          <p className="mx-auto mt-3.5 max-w-[600px] text-sm leading-relaxed text-muted-foreground md:mt-[18px] md:text-[17px]">
            Hermes checks live rates across Solana protocols and builds the deposit for the route you pick. You sign it
            in your wallet. Funds never touch Hermes.
          </p>
          {/* Phone: one fact per line. Wider: one row with diamonds between. */}
          <ul className="mt-5 flex flex-col items-center gap-1.5 text-[13px] font-medium sm:flex-row sm:flex-wrap sm:justify-center sm:gap-x-[18px] sm:gap-y-2.5 md:mt-[26px] md:text-sm">
            {facts.map((fact, index) => (
              <li key={fact} className="flex items-center gap-[18px]">
                {index > 0 && <span className="diamond hidden sm:inline-block" aria-hidden="true" />}
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
    body: "Each row shows the rate, where it comes from, the pool size and a risk tier.",
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
    answer: "Every route carries the risks of its protocol: smart contract bugs, depegs and market moves. Hermes shows a risk level per route, but it cannot remove those risks. Start small.",
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
