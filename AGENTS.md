# Hermes

**Thesis: Solana yield is spread across dozens of protocols, each with its own app and its own rate. Hermes shows the live rates side by side and builds the deposit for the route you pick. You sign it in your own wallet. Routed deposits never touch Hermes.**

Guides: `docs/VISION.md` distills the owner's vision deck, the Turbine tutor's feedback and the capstone research. Read it before planning work. It is the reference for what Hermes is.

Model: Titan for yield. Titan compares swap routes across DEX aggregators. Hermes compares yield routes across staking and lending protocols.

Wedge: trust and curation. Hermes rates every route with a Safety Score built from live data and leads with the routes that score well. A guide to Solana yield, not another dashboard. Keep the Safety Score and Top rated front and center.

- Router first. Routed deposits are non-custodial: the API builds unsigned transactions and the user's wallet signs them. Today no Hermes vault or contract holds money.
- Custody (owner's decision, 23 Oct 2026): Hermes can hold funds for automation only. A user opts in by moving funds into a Hermes vault that auto-allocates, auto-exits and rebalances. The vault needs a Hermes program, an outside security review and caps before real funds go in.
- "Best APY" means the highest current APY among the routes shown. Never promise a return.
- Hermes charges no fee today. The fee model is paused until the yield routes are done.
- Never say "audited", "risk-free", "guaranteed" or "safest". The risk tier follows the Safety Score (low from 80, moderate from 60, from TVL when a route has no score), and a lending reserve with 95% or more borrowed or held back is at least moderate.

## Canonical

- Site: `www.hermesagg.xyz` (Vercel, Root Directory = `frontend`). The landing page is `/`, the app is `/app` (the routes), with Portfolio, Settings and Docs beside it. Next route groups: `frontend/app/(site)` for the landing page (its own header), `frontend/app/(app)` for the app (wallet, menu, alerts).
- API: `hermes-api-pyw9.onrender.com` (Render free plan, `render.yaml`, root `backend`). An UptimeRobot monitor (owner's account) pings `/health` every 5 minutes so it never sleeps. The free plan's 750 hours a month cover this one service awake all month.
- Repo: `alpharobin-sol/Hermes`
- Community: X `x.com/Hermes_agg` and the Telegram group `t.me/+gYZPiesNgH85YzE8`, both linked in the footer
- Network: mainnet beta, real funds. `SOLANA_NETWORK=mainnet-beta` on Render and `NEXT_PUBLIC_SOLANA_NETWORK=mainnet-beta` (or unset) on Vercel. Both must match, or the app turns deposits off. Set both to `devnet` to test with test SOL.
- Beta deposit cap: 10 SOL per deposit on mainnet routes in beta (`BETA_DEPOSIT_CAP_SOL` on Render).
- Wallet history RPC: `SOLANA_HISTORY_RPC_URL` on Render, a Helius RPC URL with its key (free plan, owner added it 24 Oct). The portfolio reads a wallet's history with it for what staking tokens and Jupiter Lend have earned. Without it the portfolio leaves those earnings out.
- History database: Supabase Postgres (West US, Oregon), `DATABASE_URL` on Render, Session pooler string. Hermes's own rate history, every 10 minutes, 90 days. `/health` shows whether it records.
- Route registry: `backend/src/registry/routes.ts`. The one place that lists routes, their rate source and their deposit status per network.
- Integration gate: `INTEGRATIONS.md`
- Search: the landing page and `/app` render live rates on the server (Next ISR, every 60 seconds; the browser refreshes on load), so crawlers and link previews see real routes and APYs. Title, description, Open Graph and X card tags and JSON-LD (Organization, WebSite, WebApplication) are in `frontend/app/layout.tsx`. Share image: `frontend/app/opengraph-image.jpg` and `twitter-image.jpg` (1200x630, made from the hero). Search Console codes go in `GOOGLE_SITE_VERIFICATION` and `BING_SITE_VERIFICATION` on Vercel. "Hermes" alone is a crowded name, so the alternate names Hermes Agg and HermesAgg and the X account tie this Hermes to hermesagg.xyz.

## Brand

- Look: Aurora, from the Hermes X banner (Guido Reni's Aurora fresco, 1614, public domain, with the Hermes mark as Apollo). Aurora is the default theme. Night is the dark option in Settings.
- Logo unchanged. Wordmarks, mark and favicons are in `frontend/public/brand`.
- Type: Cormorant Garamond for headlines, Cinzel for rates and labels, Inter for sentences and amounts.
- Color tokens live in `frontend/app/globals.css`. Teal marks only the main button, the best rate and the selected route. Gilt is for frames and ornament, never text.
- The app opens on the tool, the way a swap app works (Titan is the reference): no hero and no section links in the header. The header holds the logo (home: the routes), the network (desktop), the wallet and a menu (≡), the way Titan's does. The menu opens a card under the header (≡ turns to ×) with three pages, each with an icon like Gloam's menu (gloam.trade, the owner's other app): Portfolio (`/portfolio`), Settings (`/settings`) and Docs (`/docs`). Each opens on its own, the current one highlighted. The wallet's name opens Portfolio, like Titan's profile. No settings gear. Portfolio and Settings are noindex and stay out of the sitemap: they are about one wallet or device. Docs is in the sitemap. The app's logo goes to `/app`.
- Landing page (`/`), like Gloam's (gloam.trade): its own header (logo, How it works, Safety Score, Questions, Docs, Open app; no wallet), the Aurora hero (banner in an arch, the headline "Compare Solana yields. Deposit from your own wallet.", the Mainnet beta pill, Open app and How it works, the facts line), Top rated right now (live from the API on the server, up to three routes per token by Safety Score, the best APY in teal; left out if the API is down), how it works in three steps, the Safety Score's four parts and deductions, Questions (FAQ, with FAQPage structured data) and a closing Open app. Code: `frontend/app/(site)/page.tsx`, `frontend/components/site/site-header.tsx`.
- Phones and tablets (under 1024px): one deposit card comes first. Amount and token, then the route, then one button. Before an amount the card shows the best route and the list below compares APYs. With an amount the card lists the routes in the current sort with their live quotes (below), and the list below steps aside. Each row, on phones and desktop, is the route name, its tag (Best quote), "Safety 98" and one number: the APY before an amount ("4.83% APY"), what it earns in a year after ("+0.0493 SOL / yr"). No rate line and no TVL or source column: the APY and TVL source is at the end of the Why panel, and what lands shows in the deposit dialog. The desktop deposit panel shows the route, its type and its APY, like the phone card, with no stats block. The token opens as a bottom sheet. A toolbar sits over the card there, the way Titan puts its mode chip over the swap card: the network pill (Mainnet beta) on the left, a refresh button for the rates on the right. On desktop the network shows in the header.
- Hero art (landing page): `frontend/public/brand/aurora-banner.jpg`, the same image as the X banner, with no protocol marks. A protocol's medallion goes back on the X banner when its integration is announced.

## Live (23 October 2026)

- The site shows only routes Hermes deposits into in-app: ten LSTs, Kamino Lend and Jupiter Lend (SOL, USDC, USDT) below.
- No route is hidden right now. A route without an in-app deposit stays in the registry with its live rate, off the site (`/api/yields?all=true` lists it), until its deposit passes `INTEGRATIONS.md`.
- The token picker lists only tokens that have a route: SOL, USDC and USDT since Kamino Lend.
- Mainnet deposits (real funds), all beta, capped at 10 SOL each:
  - JitoSOL and mSOL: Hermes quotes the protocol directly (Jito's stake pool, Marinade's liquid staking program) and Jupiter, and builds whichever gives more of the token. The dialog shows both.
  - BNSOL, jupSOL, dSOL, hSOL, INF, bbSOL, JSOL and bSOL: through the Jupiter swap API
  - Kamino Lend SOL, USDC, USDT (capped at 1,000 USDC or USDT each): built by Kamino's transaction API (`POST /ktx/klend/deposit`, the one the Kamino app uses, not in Kamino's public API docs). The deposit is a position in the user's own Kamino account, managed and withdrawn at app.kamino.finance. A first deposit pays one-time account rent in SOL (measured live by simulation, about 0.024 to 0.03 SOL) and the dialog shows it before signing. The Why panel's exit part shows how much of each reserve is borrowed, and the panel and dialog warn at 95% or more.
  - Jupiter Lend SOL, USDC, USDT (capped at 1,000 USDC or USDT each): built from Jupiter's deposit instruction. Hermes accepts only the Jupiter Lend program with the user as the only signer, adds the jl token account and, for SOL, wraps and unwraps SOL. The user gets jlWSOL, jlUSDC or jlUSDT in the wallet, growing as interest accrues. Withdrawn at jup.ag/lend/earn. The Why panel's exit part shows how much can be withdrawn right now, and the panel and dialog warn at 5% or less.
  - A direct deposit is built unless a Jupiter swap beats it by 0.01% or more: a direct deposit has no slippage.
  - Built and simulated, no real deposit by the owner yet
- Devnet deposits (test SOL, when both apps are set to devnet): Jito stake pool
- Live rates come from the chain or the protocol, refreshed every minute on the API and the site: stake pool accounts on chain for JitoSOL, BNSOL, jupSOL, dSOL, hSOL, bbSOL, JSOL and bSOL (priced with Jupiter's SOL price), Marinade's API for mSOL, Kamino's API and Jupiter Lend's API. INF reads Sanctum Infinity's pool on chain; its APY comes from Hermes's own history once that is a day old, DefiLlama until then.
- Live quotes, the way Titan quotes swap venues: type an amount and every route in view quotes it at once. `POST /api/deposit/quotes` quotes the direct deposits (Jito's stake pool, Marinade, Kamino Lend, Jupiter Lend) and hands back the Jupiter swaps, which the visitor's browser quotes on lite-api.jup.ag itself, one at a time, waiting for Jupiter's rate-limit reset on a 429. Jupiter limits requests per IP (about 5 every few seconds) and Render's IP is shared, so the API alone can't quote ten swaps at once. Each route keeps whichever path gives more, the way the deposit does, and a refused refresh keeps the last good quote. The API's own Jupiter calls (deposits, exit checks) go through one queue in `backend/src/services/jupiter.ts`. Each row shows what the route leaves after a year at today's APY once the entry cost is taken off, or "No quote" when it can't take the amount (over the cap, price impact). "Best quote" marks the most, and that route stays in view even below the top 3. A live dot and countdown sit over the list; quotes refresh every 15 seconds while the tab is in view and pause while the deposit dialog is open. The API reuses a route's quote for the same amount for 15 seconds. Code: `backend/src/services/route-quotes.ts`, `frontend/components/app/live-quotes.tsx`.
- Top rated is the first screen (named "Sleep Well" in the capstone, renamed by the owner on 23 Oct): only routes with a Safety Score of 80 or more and risk level low (so no lending reserve 95% or more borrowed or held back). A toggle shows All routes. The rate board and the phone card list the top 3 routes in the current sort (plus the selected route if it sits further down), and "Show all" opens the rest. Every route has a plain "What can go wrong" line in the deposit dialog, the last step before signing. The panel and the phone card leave it out to stay simple. They keep only live warnings (a reserve 95% or more borrowed, 5% or less withdrawable). The landing page FAQ covers the risks of DeFi routes, and alerts watch for them. On 24 Oct, after the spread and incident deductions, 6 of 12 SOL routes are top rated (Jito, Marinade, JPool, Sanctum Infinity, BlazeStake, Kamino Lend SOL) and Kamino Lend USDC is. Code: `frontend/components/app/safety.tsx`.
- Portfolio page (`/portfolio`, from the menu or the wallet's name): the wallet (name, address, copy) and the SOL, USDC and USDT in it (read in the browser, priced with Jupiter), then under Earning what it holds in each route Hermes lists, what it's worth (USD total, ≈ SOL) and what it has earned. `GET /api/portfolio/:address`, mainnet, kept a minute per wallet. Liquid staking: the wallet's token account for each LST (plain account reads), worth the tokens times their SOL value in the pool. Kamino Lend: the wallet's Kamino accounts from Kamino's API, deposits turned into tokens at the reserve's exchange rate, earned from Kamino's own interest record. Jupiter Lend: Jupiter's positions API for what the jl tokens are worth. Earned for staking tokens and Jupiter Lend is value now minus what was paid in, network fees aside, from the token account's history (up to 200 transactions) through `SOLANA_HISTORY_RPC_URL`. Jupiter's own earnings figure stops at the wallet's last transaction, so Hermes doesn't use it. When tokens came from another wallet or another token, or the history is too long or doesn't match the balance, earned is left out with a short reason. Each row links to the protocol to manage it. A source that fails is named, never counted as empty. Disconnect sits at the bottom. Code: `backend/src/services/portfolio.ts`, `frontend/components/app/portfolio.tsx`, `frontend/components/app/portfolio-page.tsx`, `frontend/components/app/layout/app-menu.tsx`.
- In-app withdrawals (beta): a Withdraw button under each Portfolio position opens a dialog like the deposit's: an amount or Max, what you get, then sign. `POST /api/withdraw/quote` and `/build`, mainnet. Staking tokens swap back to SOL on Jupiter (the user the only signer, the SOL held to the quote's minimum), with the pool value and exit cost shown. Kamino Lend: Kamino's transaction API (`/ktx/klend/withdraw`), checked with the same allow-list as Kamino deposits, from the wallet's main Kamino account. A full exit asks for 0.1% more than Kamino's hourly exchange rate shows (Kamino caps a request at the deposit), so nothing is left, and closes the account, returning its rent (shown as "Account rent back"). Loans in the same account cap a withdrawal, and the error gives the most that can leave. Jupiter Lend: Jupiter's withdraw instruction, or for everything its redeem instruction (every jl token), Jupiter Lend's program only; SOL arrives unwrapped. Lending shows "Can leave right now" only when the reserve's free liquidity caps the amount. Every withdrawal is simulated before signing, and SOL may not leave the wallet beyond the fee and a token account. Code: `backend/src/services/withdraw.ts`, `frontend/components/app/withdraw-dialog.tsx`.
- Wallet names, the way Titan shows them: a connected wallet's name replaces the short address on the wallet button, which keeps the address in its tooltip and the wallet dialog. `GET /api/names/:address` checks SNS first (the primary name, shown bare like Titan: "alpharobin"; SNS moved from .sol to .sns, so the ending is left off) and AllDomains next (the main domain, shown with its ending: "fatcat.wen"). Both are read on chain (`@bonfida/spl-name-service`, `@onsol/tldparser`), leave out a name the wallet no longer owns, and are kept an hour per wallet. Code: `backend/src/services/names.ts`, `frontend/components/app/wallet-connect/use-wallet-name.ts`.
- Phone alerts: web push, no app or Telegram needed. A bell under each route ("Alert me about Jito") turns alerts on for that route on this device, Settings turns them all off. A device's first bell opens a guide (a bottom sheet on phones): what alerts cover, then the browser's prompt, asked straight from the tap so Chrome and Safari show it. If the prompt is hidden, closed or blocked, the guide shows the steps for that browser (Android Chrome, iPhone, Firefox, Safari, other desktop) and carries on by itself once notifications are allowed. iPhones outside the Home Screen and in-app browsers get their own steps. Every 10 minutes the API checks watched routes against its own history and sends at most one alert per device, route and kind a day: APY down 20% or more and at least half a point in a day, a top rated route for the same token paying a point or more above, 5% or less of a lending reserve withdrawable, or the Safety Score falling below 80. Android works in Chrome. iPhone needs Hermes added to the Home Screen (iOS 16.4+), and the site says so. Stored: the device's push endpoint and keys and the watched route ids, no wallet. VAPID keys are created once and kept in the database (or `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY`). Needs `DATABASE_URL`, and alerts only go out while the API is awake. Code: `backend/src/services/alerts.ts`, `frontend/components/app/alerts.tsx`, `frontend/public/sw.js`.
- Safety Score on every route, 0 to 100, default sort. Four parts, 25 points each: size (TVL), track record (a fixed date per protocol in the registry), 30-day outflows (in tokens, from Hermes's own history once it covers two weeks, Kamino or DefiLlama history until then) and exit (borrowed share for lending; for liquid staking, what selling 10,000 tokens on Jupiter returns against the token's SOL value in its pool, so a depeg counts as well as price impact). Then deductions (owner's call, 24 Oct: they count): validator spread for liquid staking (the largest validator's share of the stake, from each stake pool's validator list on chain or Marinade's records; 10% or less takes nothing, 50% or more takes 10) and incidents from DefiLlama's hacks list, matched by the registry's `incidents` names for the protocol and its team (last year: 25 if not returned, 5 if returned; one to three years: 5 if not returned; older not shown). A scored incident leads the route's "What can go wrong" line. Pick a route to see each part and its source (the Why line under the route). It does not cover smart contract bugs or a sudden depeg. Code: `backend/src/services/safety.ts`.

## Roadmap

From the vision deck, the Turbine tutor's feedback and the capstone research. Tick items off as they ship. Each route still goes through `INTEGRATIONS.md`, one at a time.

Landing page (next, owner's call on 24 Oct)

- [x] A landing page apart from the app (24 Oct): landing at `/`, the app at `/app`, like Gloam. Built from what the app dropped on 23 Oct: the Aurora hero (banner in an arch, the headline "Compare Solana yields. Deposit from your own wallet.", the Mainnet beta pill), the facts line (Non-custodial, No Hermes fee today, Beta: real funds, capped per deposit), section links (How it works, Questions), how it works and the FAQ. The FAQ covers the risks behind every route (a token trading below its value, a contract bug, a reserve fully borrowed, a protocol hack) and points to the Safety Score and alerts: the app shows that only in the deposit dialog now. The removed code is in git: the hero in `frontend/app/page.tsx` at commit 8c8a3ea, how it works and the FAQ in the same file at 1f5322b.

Search and growth

- [x] Crawlable rates, share image, structured data, search tags
- [x] Google Search Console and Bing Webmaster: hermesagg.xyz verified, sitemap submitted (owner, 24 Oct)
- [x] Docs (`/docs`, 24 Oct): how Hermes works in plain words. What Hermes is, quick start, routes, the Safety Score, live quotes, what can go wrong, withdrawing, portfolio, alerts, fees and limits, contact. Risk explanations live here and in the deposit dialog, not on the cards. Keep it current when anything it describes changes. Code: `frontend/app/docs/page.tsx`.
- [x] Landing page copy and its FAQ with FAQPage structured data (24 Oct)
- [ ] A page per route (for example "JitoSOL APY today") with its live rate, Safety Score and what can go wrong: Hermes's own data for searches no one else answers live (owner's call)
- [ ] Links in: Solana ecosystem directories, X threads and articles that link to hermesagg.xyz (owner)

Trust and curation (the wedge)

- [x] Safety Score on every route: 0 to 100 from live data, each part shown with its source
- [x] Top rated (the capstone's Sleep Well) as the first screen: only routes scoring 80 or more, with a plain line on what can go wrong
- [ ] Top rated split: one signed deposit spread across two or three top rated routes
- [x] Plain labels for new users: tap the route type (Liquid staking, Lending) for what it is, where the yield comes from and how you get out. LP gets its own when LP routes arrive.
- [x] Depeg in the score: liquid staking exit measures the sale against the pool value (24 Oct)
- [x] Validator spread counts: up to 10 points off when one validator holds most of the stake (24 Oct)
- [x] Incident history with links: DefiLlama's hacks list, up to 25 points off (24 Oct). Drift's team was drained in Apr 2026, so Drift (dSOL) scores 47.

Routes

- [ ] Owner deposits to move Jito, Marinade and Kamino Lend from beta to live (owner)
- [ ] Rate checks against each protocol's app for the beta routes
- [x] Hidden LSTs back with in-app deposits: Sanctum Infinity, Bybit, JPool, BlazeStake
- [x] Jupiter Lend
- [ ] More stablecoin routes. Research 24 Oct (live checks, simulated deposits): next are Kamino's Steakhouse USDC vault (Kamino's transaction API builds deposit and withdraw, share token can land in the wallet) and Project 0, formerly MarginFi (USDC and USDT banks, two raw instructions, about 98% borrowed today). Lulo Protected USDC after an API key. Save later (low yield, shrinking). Not: Drift (drained Apr 2026), Loopscale (co-signed transactions, thin exits), Solstice (backing reports unhealthy).
- No geo-blocking (owner, 24 Oct): Hermes does not block US users, so routes that exclude US persons stay out (Maple syrupUSDC, OnRe ONyc, Ondo USDY, Perena USD*).

Smart router

- [x] Live quotes for every route at once, best quote marked, 1-year earnings after the entry cost (24 Oct)
- [ ] Real yield by time horizon: entry and exit costs (price impact, rent, unstake delay) taken off the APY for 1 month, 6 months and 1 year. The 1-year view with entry cost ships with live quotes.
- [ ] Match routes to the user's risk, time horizon and liquidity needs

Portfolio and signals

- [x] Portfolio: what the connected wallet holds in each route and what it has earned, its own page from the menu (24 Oct). Earned for staking tokens and Jupiter Lend reads wallet history through `SOLANA_HISTORY_RPC_URL` (Helius, added 24 Oct).
- [x] In-app withdrawals, beta (24 Oct): staking tokens back to SOL on Jupiter, Kamino Lend and Jupiter Lend from Portfolio. Owner withdrawal per route still to do, like the owner deposits.
- [x] Alerts: a rate drop, a better route, a reserve nearly all borrowed, a score drop (web push to phones, bell per route)
- [ ] Alerts by Telegram, and alerts for a connected wallet's positions
- [ ] One-click move: Hermes proposes, the user signs

Later

- [x] Keep the API awake: an UptimeRobot ping on `/health` every 5 minutes (24 Oct). Free Render sleeps after 15 idle minutes, so without it the first visit waits, history pauses and alerts wait.
- [ ] Hermes fee
- [ ] Lift the beta cap
- [ ] LP routes, labeled with impermanent loss
- [ ] Automation vault (DPO): opt-in, Hermes holds the funds and auto-allocates, auto-exits and rebalances on Signal Engine alerts. Needs a Hermes program, an outside security review and caps before real funds.

Open decisions for the owner

- LPs in or out for now
- First user: CEX users new to DeFi, passive holders, or DAO treasuries

## Rules

- Never fake or mock data or success. A route shows only with a live rate. If a source fails, its routes drop out. No hardcoded APY or TVL, ever.
- Live rates come from the chain or the protocol itself. An aggregator (DefiLlama) only where no live source exists, named as the source, and replaced as soon as one does.
- A route gets a deposit button only through its deposit status in the registry, and only after it passes `INTEGRATIONS.md`. `live` needs a real deposit by the owner.
- Label real money and test funds plainly. Devnet means test SOL. Mainnet beta means real funds, start small.
- Never handle private keys or seed phrases. The API builds unsigned transactions only.
- Secrets stay server-side (`JUPITER_API_KEY` on Render).
- Show where every number comes from. Each part of the Safety Score shows its points, what it measured and its source.
- If it does not serve comparing Solana yields, depositing from your own wallet, or (later) opt-in automation, it waits.
- The app is the routes (the rate board with its deposit panel, `/app`), plus Portfolio, Settings and Docs from the menu. Nothing else. Explaining Hermes is the job of the landing page (`/`) and Docs, never the cards. Rates show before an amount is typed.
- Show only routes Hermes can deposit into. A view-only route stays in the registry, hidden, until its deposit passes `INTEGRATIONS.md` (`SHOW_VIEW_ONLY_ROUTES=true` on Render shows them again).
- Writing: plain language, short sentences, no hype.
- Commit to a branch and merge through a PR. Run `npm run build` in `backend` and `frontend` before pushing.

## Shipped

- 24 Oct 2026, landing page: hermesagg.xyz opens on a landing page (the Aurora hero, Top rated right now from live rates, how it works, the Safety Score, plain answers with FAQPage data) and the app moves to /app, like Gloam. Home Screen launches and alert taps open /app. The sitemap lists /, /app and /docs.
- 24 Oct 2026, in-app withdrawals (beta): Withdraw under each Portfolio position. Staking tokens swap back to SOL with the exit cost shown, Kamino Lend and Jupiter Lend pay the token back, Max empties the position (a Kamino exit returns the account rent). Simulated before signing, checked like the deposits.
- 24 Oct 2026, portfolio, docs and a Titan-style menu: a menu (≡) replaces the settings gear and lists Portfolio, Settings and Docs, each its own page with an icon (Gloam's style). The wallet's name opens Portfolio, which shows the wallet's own SOL, USDC and USDT too. Docs explains Hermes in plain words. The portfolio shows the total in USD and SOL, each position with its Safety Score, its value and what it has earned: Kamino from its interest record, staking tokens and Jupiter Lend from the wallet's history (value now minus what was paid in).
- 24 Oct 2026, simpler deposit card and panel: the "What can go wrong" line and the one-time rent note are off the phone card and the desktop panel. Both show in the deposit dialog before signing. The landing page FAQ will cover DeFi risks.
- 24 Oct 2026, cleaner route lists on phones and desktop: each row is the route, Safety and one number (APY before an amount, SOL a year after). The receipt token, "You get", entry cost, the gap to the best quote, the TVL and source columns, the phone's rate line (Safety, risk, TVL, source, update time) and the desktop panel's stats block are gone. The source moved to the end of the Why panel.
- 24 Oct 2026, Safety Score fails safe on cold cache: the incident and validator-spread deductions now gate the score the same way the four parts do. Before, a route served before its penalty loaded (just after a restart) scored as if the penalty were zero, so a hacked or validator-concentrated route could briefly reach Top rated. Now an applicable-but-unloaded deduction leaves the route unscored (shown with TVL risk, out of Top rated) until the data loads.
- 24 Oct 2026, wallet names: the wallet button shows the connected wallet's SNS name ("alpharobin") or AllDomains name ("fatcat.wen") when it has one, the short address otherwise, the way Titan does.
- 24 Oct 2026, swap build and CORS hardening: the Jupiter swap transaction is checked before the user signs it (the user is the only signer, so no co-signer is slipped in; the amount received is held to the quote minimum on-chain by Jupiter). The API no longer sends Access-Control-Allow-Credentials with a wildcard origin; credentials are allowed only once CORS_ORIGIN names the sites.
- 24 Oct 2026, live quotes: type an amount and every route quotes it at once, refreshed every 15 seconds with a live dot and countdown. Rows show what you get, the entry cost against pool value and the 1-year earnings after it, with "Best quote" on the top one.
- 24 Oct 2026, depeg, validator spread and incidents: the liquid staking exit part measures what a 10,000-token sale returns against the token's pool value, so a depeg lowers the score. Validator spread and incidents are deductions shown in the Why panel. Binance and Jupiter (one validator holds 80% and 87%) and Drift (one validator, and its team's Drift Trade drained of $295M in Apr 2026) leave Top rated.
- 24 Oct 2026, plain labels: the route type on the phone card and desktop panel opens a three-line explainer (what it is, yield from, getting out), hidden until tapped. Code: `frontend/components/app/route-type.tsx`.
- 24 Oct 2026, Kamino deposit hardening: the Kamino transaction API response is checked before the user signs it. Only the programs a deposit uses are allowed, no top-level token transfer or approval, wrapped SOL moves only between the user's own accounts, and SOL leaving the wallet beyond the deposit is bounded. A compromised Kamino response can now at worst fail, never move funds the user did not intend. Matches the checks the Jupiter Lend builder already does.
- 24 Oct 2026, search basics: live rates in the server HTML, a 1200x630 share image for X and Telegram, Open Graph and X card tags, JSON-LD, a keyword title and description, and Search Console codes from Vercel env.
- 24 Oct 2026, API kept awake: an UptimeRobot monitor pings `/health` every 5 minutes. Checked: the API stayed up through 21 minutes with no other requests.
- 24 Oct 2026: how it works and the FAQ are off the app and wait for the landing page. The app is the rate board and the deposit alone. The rate board's footnote (sources, returns caveat, score summary) is gone too: each route shows its rate source and the Why panel explains the score and what it doesn't cover. The footer is the logo, the copyright and the Telegram and X links, nothing else. Longer explanations go in articles and threads. Under the deposit button only the cap shows ("Max 10 SOL per deposit"): the Mainnet beta pill already says real funds.
- 23 Oct 2026, app opens on the tool: the hero and the header's section links (Rates, How it works, Questions) are off the app and wait for the landing page. Phones get Settings in the header instead of a menu, and a toolbar over the deposit card with the network and a rate refresh.
- 23 Oct 2026, site audit fixes: robots.txt, sitemap.xml and a canonical URL (www.hermesagg.xyz), headers that stop other sites framing Hermes, Vercel Web Analytics turned on (its script returned 404 while it was off), the Night wordmark loads up front, clean H1 and Connect text, and the empty Top rated state names how many routes "Show all" opens.
- 23 Oct 2026, alerts guide: the bell asks for notifications straight from the tap, with a pop-up that shows what to tap and how to allow blocked or hidden prompts per browser.
- 23 Oct 2026, phone alerts: web push for watched routes (rate drop, better route, reserve nearly all borrowed, left Top rated), a bell per route, an off switch in Settings, a web app manifest so iPhones can add Hermes to the Home Screen.
- 23 Oct 2026, Top rated (first shipped as Sleep Well): the first screen shows only routes scoring 80 or more, with a toggle to All routes and a "What can go wrong" line per route. Replaces the Low / Moderate / High risk filter.
- 23 Oct 2026, Jupiter Lend: SOL, USDC and USDT deposits into Jupiter Lend Earn for jl tokens in the wallet, beta. The Safety Score's exit part reads how much can be withdrawn right now.
- 23 Oct 2026, four more LSTs: Sanctum Infinity (INF), Bybit (bbSOL), JPool (JSOL) and BlazeStake (bSOL) deposit in-app through Jupiter, beta.
- 23 Oct 2026, Safety Score: 0 to 100 on every route from size, track record, 30-day outflows and exit, with a breakdown per route. Routes sort by score by default, and the risk level follows the score.
- 23 Oct 2026, Aurora redesign: new look from the X banner, Night theme, rates on load with a rate board and a deposit panel, a single deposit card on phones, the dialog shows every path Hermes checked, real favicons.
- 23 Oct 2026: a lending reserve 95% or more borrowed shows at least moderate risk.
- 23 Oct 2026, Kamino Lend: SOL, USDC and USDT deposits into Kamino's main market, with one-time rent and borrowed share shown before signing. USDC and USDT back in the token picker.
- 22 Oct 2026, Marinade direct: mSOL deposits compare Marinade's own deposit with Jupiter and build the better one.
- 22 Oct 2026: view-only routes hidden from the site, kept in the registry. Insufficient balance state before deposits (PR #10).
- 22 Oct 2026, Jito direct: mainnet Jito deposits compare the stake pool with Jupiter and build the better one. Site switched to mainnet beta with a 10 SOL cap per deposit.
- 22 Oct 2026, Phase 0 cleanup: removed the database engine, workers, fake-data pages, the waitlist app and about 1,500 unused packages. Replaced estimated rates with live sources. Added the route registry and this gate.
- PR #7: footer on mobile
- PR #6: live Kamino rates, footer logo
- PR #5: devnet mode
- PR #3, #4: backend on Render
- PR #2: admin panel off
- PR #1: non-custodial deposit router
