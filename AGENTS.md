# Hermes

**Thesis: Solana yield is spread across dozens of protocols, each with its own app and its own rate. Hermes shows the live rates side by side and builds the deposit for the route you pick. You sign it in your own wallet. Hermes never holds funds.**

Model: Titan for yield. Titan compares swap routes across DEX aggregators. Hermes compares yield routes across staking and lending protocols.

- Non-custodial router. No vaults and no Hermes contracts hold money. The API builds unsigned transactions and the user's wallet signs them.
- "Best APY" means the highest current APY among the routes shown. Never promise a return.
- Hermes charges no fee today. The fee model is paused until the yield routes are done.
- Never say "audited", "risk-free", "guaranteed" or "safest". The risk tier comes from TVL, and a lending reserve 95% or more borrowed is at least moderate.

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
- Hero art: `frontend/public/brand/aurora-banner.jpg`, the same image as the X banner, with no protocol marks. A protocol's medallion goes back on the X banner when its integration is announced.

## Live (23 October 2026)

- The site shows only routes Hermes deposits into in-app: the six LSTs and Kamino Lend (SOL, USDC, USDT) below.
- Hidden for now, not removed: routes that send users to another app. They stay in the registry with live rates (`/api/yields?all=true` lists them) and come back one at a time as each gets an in-app deposit:
  - Sanctum Infinity, Bybit, JPool, BlazeStake (liquid staking, DefiLlama rates)
  - Jupiter Lend SOL, USDC, USDT (Jupiter Lend API)
- The token picker lists only tokens that have a route: SOL, USDC and USDT since Kamino Lend.
- Mainnet deposits (real funds), all beta, capped at 10 SOL each:
  - JitoSOL and mSOL: Hermes quotes the protocol directly (Jito's stake pool, Marinade's liquid staking program) and Jupiter, and builds whichever gives more of the token. The dialog shows both.
  - BNSOL, jupSOL, dSOL and hSOL: through the Jupiter swap API
  - Kamino Lend SOL, USDC, USDT (capped at 1,000 USDC or USDT each): built by Kamino's transaction API (`POST /ktx/klend/deposit`, the one the Kamino app uses, not in Kamino's public API docs). The deposit is a position in the user's own Kamino account, managed and withdrawn at app.kamino.finance. A first deposit pays one-time account rent in SOL (measured live by simulation, about 0.024 to 0.03 SOL) and the dialog shows it before signing. Rows show how much of each reserve is borrowed, and the dialog warns at 95% or more.
  - Built and simulated, no real deposit by the owner yet
- Devnet deposits (test SOL, when both apps are set to devnet): Jito stake pool

## Roadmap, in order

1. Liquid staking: Jito direct and Marinade direct (built, waiting on the owner's deposits), then the hidden LSTs (Sanctum Infinity, Bybit, JPool, BlazeStake)
2. Kamino Lend (built, waiting on the owner's deposit)
3. Jupiter Lend
4. MarginFi
5. LP vaults
6. Then: in-app withdrawals, the Hermes fee, lifting the beta cap

Each route goes through `INTEGRATIONS.md`, one at a time.

## Rules

- Never fake or mock data or success. A route shows only with a live rate. If a source fails, its routes drop out. No hardcoded APY or TVL, ever.
- A route gets a deposit button only through its deposit status in the registry, and only after it passes `INTEGRATIONS.md`. `live` needs a real deposit by the owner.
- Label real money and test funds plainly. Devnet means test SOL. Mainnet beta means real funds, start small.
- Never handle private keys or seed phrases. The API builds unsigned transactions only.
- Secrets stay server-side (`JUPITER_API_KEY` on Render).
- Show where every number comes from. The risk tier says what it reflects: TVL, plus the borrowed share for lending.
- If it does not serve comparing Solana yields and depositing from your own wallet, it waits.
- One page: the hero, the rate board with its deposit panel, how it works, and the FAQ. Rates show before an amount is typed.
- Show only routes Hermes can deposit into. A view-only route stays in the registry, hidden, until its deposit passes `INTEGRATIONS.md` (`SHOW_VIEW_ONLY_ROUTES=true` on Render shows them again).
- Writing: plain language, short sentences, no hype.
- Commit to a branch and merge through a PR. Run `npm run build` in `backend` and `frontend` before pushing.

## Shipped

- 23 Oct 2026, Aurora redesign: new look from the X banner, Night theme, rates on load with a rate board and a deposit panel, the dialog shows every path Hermes checked, real favicons.
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
