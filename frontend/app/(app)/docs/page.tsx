import type { Metadata } from "next"
import Link from "next/link"
import type { ReactNode } from "react"

// Docs: how Hermes works in plain words, so the app itself can stay clean. Static, and open to search engines.
export const metadata: Metadata = {
  title: "Docs · Hermes",
  description:
    "How Hermes works: live Solana yield routes, the Safety Score, live quotes, what can go wrong, withdrawing, rerouting, your portfolio, alerts and fees.",
  alternates: { canonical: "/docs" },
}

const SECTIONS = [
  { id: "overview", title: "What Hermes is" },
  { id: "quick-start", title: "Quick start" },
  { id: "routes", title: "Routes" },
  { id: "safety-score", title: "Safety Score" },
  { id: "quotes", title: "Live quotes" },
  { id: "risks", title: "What can go wrong" },
  { id: "withdrawing", title: "Withdrawing" },
  { id: "rerouting", title: "Rerouting" },
  { id: "portfolio", title: "Portfolio" },
  { id: "alerts", title: "Alerts" },
  { id: "fees", title: "Fees and limits" },
  { id: "contact", title: "Contact" },
]

const LINK = "font-medium text-ink underline underline-offset-2"

function Section({ id, children }: { id: string; children: ReactNode }) {
  const title = SECTIONS.find((section) => section.id === id)!.title
  return (
    <section id={id} className="scroll-mt-24 border-t border-hairline pt-8 first:border-t-0 first:pt-0">
      <h2 className="font-display text-[28px] font-bold leading-[1.15]">{title}</h2>
      <div className="mt-3 flex flex-col gap-3 text-[15px] leading-relaxed text-foreground">{children}</div>
    </section>
  )
}

function List({ children }: { children: ReactNode }) {
  return <ul className="m-0 flex list-disc flex-col gap-2 pl-5 marker:text-gilt">{children}</ul>
}

export default function Docs() {
  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-8 md:px-8 md:py-12">
      <div className="lg:grid lg:grid-cols-[200px_minmax(0,1fr)] lg:gap-12">
        {/* Contents: a sticky list on desktop, a row of links on phones */}
        <nav aria-label="On this page" className="mb-8 lg:mb-0">
          <div className="lg:sticky lg:top-28">
            <p className="label-roman mb-3 hidden lg:block">On this page</p>
            <ul className="m-0 flex list-none flex-wrap gap-2 p-0 lg:flex-col lg:gap-1">
              {SECTIONS.map((section) => (
                <li key={section.id}>
                  <a
                    href={`#${section.id}`}
                    className="inline-flex h-9 items-center rounded-full border border-frame px-3 text-[13px] text-muted-foreground hover:bg-secondary hover:text-foreground lg:h-8 lg:rounded-[4px] lg:border-0 lg:px-2"
                  >
                    {section.title}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </nav>

        <article className="min-w-0 max-w-[720px]">
          <h1 className="font-display text-[40px] font-bold leading-[1.1]">Docs</h1>
          <p className="mt-2 text-[15px] text-muted-foreground">How Hermes works, in plain words.</p>

          <div className="mt-10 flex flex-col gap-8">
            <Section id="overview">
              <p>
                Hermes compares yield on Solana. It shows live rates from staking and lending protocols side by side,
                scores each route for safety, and builds the deposit for the route you pick.
              </p>
              <p>
                You sign every deposit in your own wallet. Your funds go straight to the protocol. Hermes never holds
                them and never sees your keys.
              </p>
              <p>
                Rates come from the chain or the protocol itself and refresh every minute. When a source has no live
                rate, its routes drop out. Hermes never fills the gap with an estimate.
              </p>
            </Section>

            <Section id="quick-start">
              <ol className="m-0 flex list-decimal flex-col gap-2 pl-5 marker:font-semibold">
                <li>Pick a token: SOL, USDC or USDT.</li>
                <li>
                  Pick a route. Top rated shows routes with a Safety Score of 80 or more. Switch to All routes to see
                  the rest.
                </li>
                <li>Type an amount. Every route quotes it live, and the best quote is marked.</li>
                <li>Review the deposit and sign it in your wallet.</li>
              </ol>
              <p>Hermes is in beta on mainnet. Deposits use real funds, so start small.</p>
              <p>
                The first time you open the app, Getting started walks you through four steps: connect your wallet,
                learn the Safety Score with a short tour of the page, make a small deposit and turn on alerts. Each step
                shows about how long it takes on your device and ticks itself once you have done it. Close it for now or
                hide it for good. Settings brings it back.
              </p>
              <p>
                <Link href="/app" className={LINK}>
                  Open the routes
                </Link>
              </p>
            </Section>

            <Section id="routes">
              <p>
                <strong>Liquid staking.</strong> You swap SOL for a staking token, such as JitoSOL or mSOL. It stays in
                your wallet, and each token is worth a little more SOL every few days. The yield comes from Solana&apos;s
                staking rewards. To get out, you swap back to SOL at the market price.
              </p>
              <p>
                <strong>Lending.</strong> You lend SOL, USDC or USDT to borrowers through Kamino Lend, Jupiter Lend or
                Project 0 (formerly marginfi). The yield is the interest borrowers pay, so it moves as they borrow more or
                less. You withdraw at the protocol whenever the reserve has room. A rate far above the others usually
                means nearly everything is borrowed, so getting out may wait.
              </p>
              <p>
                <strong>Lending vault.</strong> A Kamino vault lends your USDC across several Kamino reserves. Its curator
                picks the reserves and how much goes to each: Steakhouse Financial for the Steakhouse USDC vault. You hold
                vault shares, staked in Kamino for your wallet, and they grow as interest comes in. The vault takes a
                share of the interest as its fee, and its APY on Hermes is after that fee.
              </p>
              <p>
                Hermes builds each deposit through the protocol itself or through a Jupiter swap, whichever gives you
                more. The deposit dialog shows every path it checked.
              </p>
            </Section>

            <Section id="safety-score">
              <p>Every route gets a score from 0 to 100, built from live data. Four parts, 25 points each:</p>
              <List>
                <li>
                  <strong>Size:</strong> how much is deposited.
                </li>
                <li>
                  <strong>Track record:</strong> how long the protocol has held deposits.
                </li>
                <li>
                  <strong>Outflows:</strong> how much left in the last 30 days.
                </li>
                <li>
                  <strong>Exit:</strong> how easily you can get out. For lending, how much of the reserve is borrowed.
                  For staking tokens, what selling 10,000 tokens returns against their value in the pool.
                </li>
              </List>
              <p>Then deductions:</p>
              <List>
                <li>
                  <strong>Validator spread:</strong> up to 10 points off when one validator holds most of the stake.
                </li>
                <li>
                  <strong>Incidents:</strong> up to 25 points off for a hack of the protocol or its team in the last three
                  years, less when the funds were returned.
                </li>
              </List>
              <p>
                Top rated routes score 80 or more. Open Why next to any Safety Score to see each part, what it measured
                and where the number came from. The score does not cover smart contract bugs or a sudden depeg. A route
                whose deposit history has no source yet shows Not scored until Hermes has two weeks of its own: Project
                0 for now.
              </p>
            </Section>

            <Section id="quotes">
              <p>
                Type an amount and every route quotes it at once, refreshed every 15 seconds. Each row shows what the
                deposit leaves you over 1 month, 6 months or 1 year at today&apos;s APY, after the entry cost and the
                exit cost. Pick the length with 1M, 6M and 1Y over the routes.
              </p>
              <List>
                <li>
                  The entry cost is the price impact, or the gap between what you pay and what the tokens are worth in
                  their pool.
                </li>
                <li>
                  The exit cost is what selling a staking token back to SOL loses against its pool value at
                  today&apos;s price, from a Jupiter quote for 10 tokens. Lending leaves at face value, so it has none.
                </li>
                <li>
                  The shorter the time, the more the costs weigh. A staking token with a high exit cost can leave you
                  with less after a month than you put in, and still come out ahead after a year.
                </li>
              </List>
              <p>Best quote marks the route that leaves you the most over the length you picked. The deposit dialog shows all three.</p>
              <p>APY is today&apos;s rate. It changes, and it is not a promise of returns.</p>
            </Section>

            <Section id="risks">
              <List>
                <li>A staking token can trade below its SOL value for a while. Selling then means taking less.</li>
                <li>A bug in a protocol&apos;s program could lose funds. The Safety Score does not measure this.</li>
                <li>
                  A lending reserve can be fully borrowed. Withdrawals then wait until borrowers repay or new deposits
                  arrive.
                </li>
                <li>A protocol or its team can be hacked. Past incidents lower the score.</li>
                <li>Rates move. Today&apos;s APY can fall.</li>
              </List>
              <p>
                Turn on <a href="#alerts" className={LINK}>alerts</a> for a route, or for your positions, to hear when
                its rate drops, its token trades below its value, deposits leave, its score falls or its reserve fills
                up. The deposit dialog repeats what can go wrong for each route before
                you sign.
              </p>
            </Section>

            <Section id="withdrawing">
              <p>
                Open{" "}
                <Link href="/portfolio" className={LINK}>
                  Portfolio
                </Link>{" "}
                and tap Withdraw under a position. Type an amount or tap Max, check what you get, and sign in your wallet.
              </p>
              <List>
                <li>
                  Staking tokens swap back to SOL on Jupiter at the market price. Hermes shows what the tokens are worth in
                  their pool, so you see the exit cost before you sign.
                </li>
                <li>
                  Kamino Lend, Jupiter Lend, Project 0 and the Kamino vault pay your USDC, USDT or SOL back. Only part of
                  a reserve can leave at once when most of it is lent out, and Hermes shows how much can leave right now.
                </li>
                <li>
                  Taking everything out of Kamino Lend, Project 0 or Jupiter Lend closes the account and returns the
                  one-time rent you paid on your first deposit.
                </li>
              </List>
              <p>
                In-app withdrawals are in beta. You can also withdraw in each protocol&apos;s own app: Kamino at{" "}
                <a href="https://app.kamino.finance" target="_blank" rel="noopener noreferrer" className={LINK}>
                  app.kamino.finance
                </a>
                , Jupiter Lend at{" "}
                <a href="https://jup.ag/lend/earn" target="_blank" rel="noopener noreferrer" className={LINK}>
                  jup.ag/lend/earn
                </a>
                , Project 0 at{" "}
                <a href="https://app.0.xyz" target="_blank" rel="noopener noreferrer" className={LINK}>
                  app.0.xyz
                </a>
                , and staking tokens on{" "}
                <a href="https://jup.ag" target="_blank" rel="noopener noreferrer" className={LINK}>
                  Jupiter
                </a>
                .
              </p>
            </Section>

            <Section id="rerouting">
              <p>
                Open{" "}
                <Link href="/portfolio" className={LINK}>
                  Portfolio
                </Link>{" "}
                and tap Reroute under a position to move it into another route for the same token. When a top rated
                route pays at least half a point more today, Hermes proposes it right under the position. Pick the route,
                keep Max or type an amount, check the numbers and sign.
              </p>
              <List>
                <li>
                  A staking token to another staking token is one swap on Jupiter and one signature. Both tokens are
                  counted at their value in their pools, so the cost of the reroute is plain.
                </li>
                <li>
                  A reroute with lending in it takes two steps: the withdrawal, then the deposit of what it paid into your
                  wallet. You sign each one. If the second step fails, the funds wait in your wallet, and you can try it
                  again or deposit them from the app.
                </li>
                <li>
                  Before you sign, Hermes shows what the reroute costs, what the new route earns in a year at today&apos;s
                  rates next to the old one, and how many days the higher APY takes to make the cost back. Rates move,
                  so this is today&apos;s picture, not a promise.
                </li>
              </List>
              <p>Rerouting stays in one token, follows the same beta caps as deposits, and is in beta.</p>
            </Section>

            <Section id="portfolio">
              <p>
                <Link href="/portfolio" className={LINK}>
                  Portfolio
                </Link>{" "}
                shows your wallet, the SOL, USDC and USDT in it, and what you hold in each Hermes route: what it is worth
                and what it has earned.
              </p>
              <p>
                Earned is what a position is worth now minus what you paid in, network fees aside. Kamino reports its own
                interest, and its record of your vault deposits and withdrawals. For staking tokens, Jupiter Lend and
                Project 0, Hermes reads your wallet&apos;s history. Portfolio shows the Project 0 accounts Hermes opens;
                deposits made in Project 0&apos;s own app show there. When tokens came
                from another wallet or another token, Hermes says it can&apos;t tell what they cost instead of guessing.
              </p>
            </Section>

            <Section id="alerts">
              <p>
                Tap the bell under a route to get alerts for it. Or, in Portfolio, tap Alert me about my positions:
                Hermes then follows your wallet, so a route joins when you deposit and leaves when you withdraw. No
                account needed. Hermes checks every 10 minutes and sends at most one alert per route and kind a day,
                when:
              </p>
              <List>
                <li>the APY falls by a fifth or more, and at least half a point, in a day</li>
                <li>
                  a top rated route for the same token pays a point or more above a route you watch, or half a point
                  above one you hold (the gap at which Portfolio proposes a Reroute)
                </li>
                <li>a staking token sells on Jupiter for 1% or more below its SOL value in its pool</li>
                <li>15% or more of a route&apos;s deposits leave in a day</li>
                <li>5% or less of a lending reserve can be withdrawn</li>
                <li>the Safety Score falls below 80</li>
              </List>
              <p>
                The first bell asks how Hermes should reach you: notifications on this device, or email. Android works
                in Chrome. On iPhone, add Hermes to your Home Screen first (iOS 16.4 or later), or use email. For email,
                Hermes sends a link to confirm the address, and alerts start once it is opened. Each check&apos;s
                changes come in one email, and every email has a link to stop them. Add or remove either way in{" "}
                <Link href="/settings" className={LINK}>
                  Settings
                </Link>
                .
              </p>
              <p>
                Hermes keeps this device&apos;s notification address or your email address, and the routes you watch
                or hold. Never your wallet: the browser sends only which routes it holds.
              </p>
            </Section>

            <Section id="fees">
              <p>
                Hermes charges no fee today. You pay Solana network fees, and a protocol may charge its own.
              </p>
              <p>
                In beta, each deposit is capped at 10 SOL, or 1,000 USDC or USDT for lending. A first Kamino deposit also
                pays a one-time account rent in SOL, shown before you sign: about 0.03 SOL for Kamino Lend, about 0.007
                SOL for a Kamino vault. A first Project 0 deposit pays about 0.0124 SOL, back when you take everything
                out.
              </p>
              <p>
                Each route keeps back the SOL its deposit needs for fees and the accounts it opens, so the deposit can
                pay for itself: about 0.0042 SOL for a staking token or Jupiter Lend, about 0.033 SOL for a first
                Kamino Lend deposit. A USDC or USDT deposit needs that SOL in your wallet beside it. The deposit box shows
                how much you can deposit.
              </p>
            </Section>

            <Section id="contact">
              <p>
                Questions, or a route you want added? Find Hermes on{" "}
                <a href="https://x.com/Hermes_agg" target="_blank" rel="noopener noreferrer" className={LINK}>
                  X
                </a>{" "}
                or{" "}
                <a href="https://t.me/+I2pSaIdIykgwMDQ0" target="_blank" rel="noopener noreferrer" className={LINK}>
                  Telegram
                </a>
                .
              </p>
              <p>
                In the Telegram group, Herald, Hermes&apos;s bot, welcomes new members and removes scams. Admins never DM
                first, and no one from Hermes will ever ask for your seed phrase or private key.
              </p>
            </Section>
          </div>
        </article>
      </div>
    </div>
  )
}
