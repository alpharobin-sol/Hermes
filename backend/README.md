# Hermes API

The backend for Hermes, a non-custodial yield router on Solana.

It does two things:

- Serves live yield routes: APY, TVL, Safety Score and risk tier for each route in the registry.
- Builds unsigned deposit transactions. The user's wallet signs and sends them. Hermes never holds funds.

## Layout

```
src/
├── index.ts                    # starts the server and the rate refresh
├── api/
│   ├── index.ts                # express app, CORS, health check
│   ├── yields.ts               # GET /api/yields
│   └── deposit.ts              # POST /api/deposit/quote, /api/deposit/build
├── registry/routes.ts          # every route: protocol, token, rate source, deposit status
├── services/
│   ├── rates.ts                # live rates from DefiLlama, Kamino and Jupiter Lend
│   ├── yields.ts               # joins the registry with live rates and Safety Scores
│   ├── safety.ts               # Safety Score: size, track record, outflows, exit
│   ├── cache.ts                # TTL cache with a stale fallback, shared by rates and scores
│   ├── jupiter.ts              # Jupiter swap API client
│   ├── deposit.ts              # quotes every path for a deposit and builds the best one
│   ├── stake-pool-deposit.ts   # direct SPL stake pool deposits (Jito)
│   ├── marinade-deposit.ts     # direct Marinade deposits (mainnet)
│   ├── kamino-deposit.ts       # Kamino Lend deposits via Kamino's transaction API (mainnet)
│   ├── jupiter-lend-deposit.ts # Jupiter Lend Earn deposits from Jupiter's deposit instruction (mainnet)
│   ├── compute-budget.ts       # priority fee for direct deposits
│   └── errors.ts               # errors written for users
├── config/runtime.ts           # SOLANA_NETWORK switch
└── utils/logger.ts
```

## Where the numbers come from

| Routes | Source |
| --- | --- |
| Liquid staking (JitoSOL, mSOL, ...) | DefiLlama yields API |
| Kamino Lend (SOL, USDC, USDT) | Kamino API, main market |
| Jupiter Lend (SOL, USDC, USDT) | Jupiter Lend API |

Rates refresh every few minutes. If a source fails, its last good rates serve for up to an hour, then its routes drop out. The API never shows an estimate in place of a live number.

## Safety Score

Every route gets a score from 0 to 100: four parts from live data, up to 25 points each. Each part comes back with its points, what it measured and its source.

| Part | Measures | 0 points | 25 points | Source |
| --- | --- | --- | --- | --- |
| Size | Money in the route now (TVL) | $10M or less | $1B or more (log scale) | the route's rate source |
| Track record | How long DefiLlama has tracked the protocol's deposits | new | 4 years or more | DefiLlama protocol API |
| Outflows | Largest fall in deposits within the last 30 days, in tokens so price moves don't count | 40% or more | 10% or less | Kamino history, or DefiLlama pool history in SOL |
| Exit, lending | Share of the reserve that can't be withdrawn right now: borrowed (Kamino), or borrowed or held back by the withdrawal limit (Jupiter Lend) | 100% | 90% or less | rate source |
| Exit, liquid staking | Price impact of selling 10,000 of the token for SOL | 5% or more | 1% or less | Jupiter quote |

The history behind the score refreshes in the background (track record daily, outflows every 6 hours, exit quotes every 30 minutes), so requests don't wait on it. Right after a restart, a request waits up to 12 seconds for it. A route with any part missing has `safety: null`. Jupiter Lend's history on DefiLlama has gaps, so outflows accept two weeks of data in the window and say how many days they saw. The score does not measure smart contract or depeg risk.

The risk tier follows the score: low at 80 and above, moderate from 60, high below. A route without a score gets its tier from TVL: low at $100M and above, moderate from $10M, high below. A lending reserve with 95% or more borrowed or held back is at least moderate, since withdrawals may have to wait.

## Endpoints

`GET /api/yields?token=SOL`

Routes Hermes can deposit into for one token (SOL, USDC or USDT), highest APY first. Each route has `deposit`: `live` or `beta` for the network the API runs on, and `safety`: `{ score, parts }` or `null`.

Add `all=true` to include view-only routes (`deposit: null`). They link out to the protocol's app and are hidden on the site for now. `SHOW_VIEW_ONLY_ROUTES=true` includes them by default.

`POST /api/deposit/quote` with `{ routeId, amount, slippageBps?, userPublicKey? }`

Quotes a deposit. `amount` is in UI units, e.g. `"1.5"` SOL. Routes with a direct deposit (Jito, Marinade, Jupiter Lend) are quoted directly and through Jupiter. The quote is the one that returns more, and `compared` lists the other. A direct deposit wins unless the swap leads by 0.01% or more, since it has no slippage.

Lending quotes (Kamino Lend) set `position` (the deposit is held there, not as a wallet token). With `userPublicKey`, they also build and simulate the deposit and return `setupCostSol`: the one-time account rent of a first deposit.

`POST /api/deposit/build` with `{ routeId, amount, userPublicKey, slippageBps? }`

Returns the quote plus unsigned base64 transactions to sign and send in order.

`GET /health`

## Run it

```bash
cp .env.example .env
npm install
npm run dev        # watch mode
npm run build && npm start
```

Set `SOLANA_NETWORK=devnet` to build deposits with test SOL. Yield data always comes from mainnet.

## Adding a route

1. Add it to `src/registry/routes.ts` with its rate source and an empty `deposit`.
2. Check the API's APY and TVL against the protocol's own app.
3. Follow `INTEGRATIONS.md` at the repo root before giving it a deposit status.
