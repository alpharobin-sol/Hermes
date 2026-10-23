# Hermes

**Thesis: Solana yield is spread across dozens of protocols, each with its own app and its own rate. Hermes shows the live rates side by side and builds the deposit for the route you pick. You sign it in your own wallet. Routed deposits never touch Hermes.**

Guides: `docs/VISION.md` distills the owner's vision deck, the Turbine tutor's feedback and the capstone research. Read it before planning work. It is the reference for what Hermes is.

Model: Titan for yield. Titan compares swap routes across DEX aggregators. Hermes compares yield routes across staking and lending protocols.

Wedge: trust and curation. Hermes rates every route with a Safety Score built from live data and leads with the routes that score well. A guide to Solana yield, not another dashboard. Keep the Safety Score and Sleep Well front and center.

- Router first. Routed deposits are non-custodial: the API builds unsigned transactions and the user's wallet signs them. Today no Hermes vault or contract holds money.
- Custody (owner's decision, 23 Oct 2026): Hermes can hold funds for automation only. A user opts in by moving funds into a Hermes vault that auto-allocates, auto-exits and rebalances. The vault needs a Hermes program, an outside security review and caps before real funds go in.
- "Best APY" means the highest current APY among the routes shown. Never promise a return.
- Hermes charges no fee today. The fee model is paused until the yield routes are done.
- Never say "audited", "risk-free", "guaranteed" or "safest". The risk tier follows the Safety Score (low from 80, moderate from 60, from TVL when a route has no score), and a lending reserve with 95% or more borrowed or held back is at least moderate.

## Canonical

- Site: `www.hermesagg.xyz` (Vercel, Root Directory = `frontend`)
- API: `hermes-api-pyw9.onrender.com` (Render free plan, `render.yaml`, root `backend`)
- Repo: `alpharobin-sol/Hermes`
- Network: mainnet beta, real funds. `SOLANA_NETWORK=mainnet-beta` on Render and `NEXT_PUBLIC_SOLANA_NETWORK=mainnet-beta` (or unset) on Vercel. Both must match, or the app turns deposits off. Set both to `devnet` to test with test SOL.
- Beta deposit cap: 10 SOL per deposit on mainnet routes in beta (`BETA_DEPOSIT_CAP_SOL` on Render).
- Route registry: `backend/src/registry/routes.ts`. The one place that lists routes, their rate source and their deposit status per network.
- Integration gate: `INTEGRATIONS.md`

## Brand

- Look: Aurora, from the Hermes X banner (Guido Reni's Aurora fresco, 1614, public domain, with the Hermes mark as Apollo). Aurora is the default theme. Night is the dark option in Settings.
- Logo unchanged. Wordmarks, mark and favicons are in `frontend/public/brand`.
- Type: Cormorant Garamond for headlines, Cinzel for rates and labels, Inter for sentences and amounts.
- Color tokens live in `frontend/app/globals.css`. Teal marks only the main button, the best rate and the selected route. Gilt is for frames and ornament, never text.
- Phones and tablets (under 1024px): one deposit card comes first, the way a swap app works (Titan is the reference). Amount and token, then the route, then one button. Before an amount the card shows the best route and the list below compares APYs. With an amount the card lists every route by what it earns, best first, with the gap to the best for the rest, and the list below steps aside. The token opens as a bottom sheet.
- Hero art: `frontend/public/brand/aurora-banner.jpg`, the same image as the X banner, with no protocol marks. A protocol's medallion goes back on the X banner when its integration is announced.

## Live (23 October 2026)

- The site shows only routes Hermes deposits into in-app: ten LSTs, Kamino Lend and Jupiter Lend (SOL, USDC, USDT) below.
- No route is hidden right now. A route without an in-app deposit stays in the registry with its live rate, off the site (`/api/yields?all=true` lists it), until its deposit passes `INTEGRATIONS.md`.
- The token picker lists only tokens that have a route: SOL, USDC and USDT since Kamino Lend.
- Mainnet deposits (real funds), all beta, capped at 10 SOL each:
  - JitoSOL and mSOL: Hermes quotes the protocol directly (Jito's stake pool, Marinade's liquid staking program) and Jupiter, and builds whichever gives more of the token. The dialog shows both.
  - BNSOL, jupSOL, dSOL, hSOL, INF, bbSOL, JSOL and bSOL: through the Jupiter swap API
  - Kamino Lend SOL, USDC, USDT (capped at 1,000 USDC or USDT each): built by Kamino's transaction API (`POST /ktx/klend/deposit`, the one the Kamino app uses, not in Kamino's public API docs). The deposit is a position in the user's own Kamino account, managed and withdrawn at app.kamino.finance. A first deposit pays one-time account rent in SOL (measured live by simulation, about 0.024 to 0.03 SOL) and the dialog shows it before signing. Rows show how much of each reserve is borrowed, and the dialog warns at 95% or more.
  - Jupiter Lend SOL, USDC, USDT (capped at 1,000 USDC or USDT each): built from Jupiter's deposit instruction. Hermes accepts only the Jupiter Lend program with the user as the only signer, adds the jl token account and, for SOL, wraps and unwraps SOL. The user gets jlWSOL, jlUSDC or jlUSDT in the wallet, growing as interest accrues. Withdrawn at jup.ag/lend/earn. Rows show how much can be withdrawn right now, and the dialog warns at 5% or less.
  - A direct deposit is built unless a Jupiter swap beats it by 0.01% or more: a direct deposit has no slippage.
  - Built and simulated, no real deposit by the owner yet
- Devnet deposits (test SOL, when both apps are set to devnet): Jito stake pool
- Safety Score on every route, 0 to 100, default sort. Four parts from live data, 25 points each: size (TVL), track record (how long DefiLlama has tracked the protocol), 30-day outflows (in tokens) and exit (borrowed share for lending, Jupiter price impact of selling 10,000 tokens for liquid staking). Pick a route to see each part and its source (the Why line under the route). It does not cover smart contract bugs or depegs. Code: `backend/src/services/safety.ts`.

## Roadmap

From the vision deck, the Turbine tutor's feedback and the capstone research. Tick items off as they ship. Each route still goes through `INTEGRATIONS.md`, one at a time.

Trust and curation (the wedge)

- [x] Safety Score on every route: 0 to 100 from live data, each part shown with its source
- [ ] Sleep Well mode as the first screen: only routes scoring 80 or more, with a plain line on what can go wrong. Later, one signed deposit split across two or three of them.
- [ ] Plain labels for new users: staking, lending and LP, and what each can lose
- [ ] More score inputs: depeg (LST market price vs fair value), validator concentration, incident history with links

Routes

- [ ] Owner deposits to move Jito, Marinade and Kamino Lend from beta to live (owner)
- [ ] Rate checks against each protocol's app for the beta routes
- [x] Hidden LSTs back with in-app deposits: Sanctum Infinity, Bybit, JPool, BlazeStake
- [x] Jupiter Lend
- [ ] Save and MarginFi

Smart router

- [ ] Real yield by time horizon: entry and exit costs (price impact, rent, unstake delay) taken off the APY for 1 month, 6 months and 1 year
- [ ] Match routes to the user's risk, time horizon and liquidity needs

Portfolio and signals

- [ ] Portfolio: what the connected wallet holds in each route and what it has earned
- [ ] In-app withdrawals
- [ ] Alerts: a rate drop, a better route, a reserve nearly all borrowed, a score drop
- [ ] One-click move: Hermes proposes, the user signs

Later

- [ ] Hermes fee
- [ ] Lift the beta cap
- [ ] LP routes, labeled with impermanent loss
- [ ] Automation vault (DPO): opt-in, Hermes holds the funds and auto-allocates, auto-exits and rebalances on Signal Engine alerts. Needs a Hermes program, an outside security review and caps before real funds.

Open decisions for the owner

- LPs in or out for now
- First user: CEX users new to DeFi, passive holders, or DAO treasuries

## Rules

- Never fake or mock data or success. A route shows only with a live rate. If a source fails, its routes drop out. No hardcoded APY or TVL, ever.
- A route gets a deposit button only through its deposit status in the registry, and only after it passes `INTEGRATIONS.md`. `live` needs a real deposit by the owner.
- Label real money and test funds plainly. Devnet means test SOL. Mainnet beta means real funds, start small.
- Never handle private keys or seed phrases. The API builds unsigned transactions only.
- Secrets stay server-side (`JUPITER_API_KEY` on Render).
- Show where every number comes from. Each part of the Safety Score shows its points, what it measured and its source.
- If it does not serve comparing Solana yields, depositing from your own wallet, or (later) opt-in automation, it waits.
- One page: the hero, the rate board with its deposit panel, how it works, and the FAQ. Rates show before an amount is typed.
- Show only routes Hermes can deposit into. A view-only route stays in the registry, hidden, until its deposit passes `INTEGRATIONS.md` (`SHOW_VIEW_ONLY_ROUTES=true` on Render shows them again).
- Writing: plain language, short sentences, no hype.
- Commit to a branch and merge through a PR. Run `npm run build` in `backend` and `frontend` before pushing.

## Shipped

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
