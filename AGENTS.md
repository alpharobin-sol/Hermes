# Hermes

**Thesis: Solana yield is spread across dozens of protocols, each with its own app and its own rate. Hermes shows the live rates side by side and builds the deposit for the route you pick. You sign it in your own wallet. Hermes never holds funds.**

Model: Titan for yield. Titan compares swap routes across DEX aggregators. Hermes compares yield routes across staking and lending protocols.

- Non-custodial router. No vaults and no Hermes contracts hold money. The API builds unsigned transactions and the user's wallet signs them.
- "Best APY" means the highest current APY among the routes shown. Never promise a return.
- Hermes charges no fee today. The fee model is paused until the yield routes are done.
- Never say "audited", "risk-free", "guaranteed" or "safest". The risk tier comes from TVL only.

## Canonical

- Site: `www.hermesagg.xyz` (Vercel, Root Directory = `frontend`)
- API: `hermes-api-pyw9.onrender.com` (Render free plan, `render.yaml`, root `backend`)
- Repo: `alpharobin-sol/Hermes`
- Network: devnet mode today. `SOLANA_NETWORK=devnet` on Render and `NEXT_PUBLIC_SOLANA_NETWORK=devnet` on Vercel. Both must match, or the app turns deposits off.
- Route registry: `backend/src/registry/routes.ts`. The one place that lists routes, their rate source and their deposit status per network.
- Integration gate: `INTEGRATIONS.md`

## Live (22 October 2026)

- Rates for 16 routes, all from live sources:
  - Liquid staking (10 LSTs): DefiLlama yields API
  - Kamino Lend SOL, USDC, USDT: Kamino API, main market
  - Jupiter Lend SOL, USDC, USDT: Jupiter Lend API
- Devnet deposits (test SOL): Jito stake pool, beta
- Mainnet deposits (real funds): JitoSOL, mSOL, BNSOL, jupSOL, dSOL and hSOL through the Jupiter swap API, beta. Built and simulated, no real deposit by the owner yet. Not reachable on the site while it runs on devnet.
- Every other route is view only and links to the protocol's app.

## Roadmap, in order

1. Liquid staking: Jito and Marinade direct, other LSTs through Jupiter
2. Kamino Lend
3. Jupiter Lend
4. MarginFi
5. LP vaults
6. Then: in-app withdrawals, the Hermes fee, mainnet switch

Each route goes through `INTEGRATIONS.md`, one at a time.

## Rules

- Never fake or mock data or success. A route shows only with a live rate. If a source fails, its routes drop out. No hardcoded APY or TVL, ever.
- A route gets a deposit button only through its deposit status in the registry, and only after it passes `INTEGRATIONS.md`. `live` needs a real deposit by the owner.
- Label real money and test funds plainly. Devnet means test SOL. Mainnet beta means real funds, start small.
- Never handle private keys or seed phrases. The API builds unsigned transactions only.
- Secrets stay server-side (`JUPITER_API_KEY` on Render).
- Show where every number comes from. The risk tier says it reflects TVL only.
- If it does not serve comparing Solana yields and depositing from your own wallet, it waits.
- One page: the yield panel and the FAQ.
- Writing: plain language, short sentences, no hype.
- Commit to a branch and merge through a PR. Run `npm run build` in `backend` and `frontend` before pushing.

## Shipped

- 22 Oct 2026, Phase 0 cleanup: removed the database engine, workers, fake-data pages, the waitlist app and about 1,500 unused packages. Replaced estimated rates with live sources. Added the route registry and this gate.
- PR #7: footer on mobile
- PR #6: live Kamino rates, footer logo
- PR #5: devnet mode
- PR #3, #4: backend on Render
- PR #2: admin panel off
- PR #1: non-custodial deposit router
