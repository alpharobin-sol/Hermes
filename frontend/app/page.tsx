'use client';

import { YieldPanel } from "@/components/app/yield-panel";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"

export default function Home() {
  return (
    <div className="mx-auto max-w-7xl transition-opacity duration-300 flex flex-col items-center justify-start w-full flex-1 h-full mt-0 md:pt-[3vh]">

      {/* Yield explorer first: pick a token and amount, compare routes */}
      <div className="w-full flex-1 flex flex-col pb-6 px-3 min-sm:px-1 md:px-8 3xl:px-20">
        <YieldPanel />
      </div>

      <section className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between pb-6 px-3 min-sm:px-1 md:px-8 3xl:px-20">
        <div className="text-start md:text-center max-w-2xl mx-auto">
          <h1 className="text-lg font-bold text-foreground sm:text-xl">
            Compare Solana yields, deposit from your own wallet
          </h1>
          <p className="mt-2 text-caption">
            Hermes checks live rates across Solana protocols and builds the deposit for the route you pick. You sign it. Funds never touch Hermes.
          </p>
        </div>
      </section>

      <FaqSection />
    </div>
  );
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
    <section className="w-full py-14 px-3 min-sm:px-1 md:px-8 3xl:px-20">
      <div className="mx-auto max-w-2xl">

        <div className="mb-8">
          <h2 className="text-lg font-bold text-foreground sm:text-xl mb-1">
            FAQs
          </h2>
          <div className="flex items-center gap-2">
            <div className="w-1 h-4 bg-primary" />
            <h3 className="text-caption">Frequently Asked Questions</h3>
          </div>
        </div>
        <Accordion type="single" collapsible className="w-full space-y-3">
          {faqs.map((faq, index) => (
            <AccordionItem
              key={index}
              value={`item-${index}`}
              className="card-base w-full px-5 py-1 data-[state=open]:bg-secondary/50 transition-colors"
            >
              <AccordionTrigger className="text-left text-foreground hover:text-primary hover:no-underline py-4 text-base font-medium w-full">
                {faq.question}
              </AccordionTrigger>
              <AccordionContent className="text-muted-foreground pb-4 text-sm leading-relaxed">
                {faq.answer}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  )
}
