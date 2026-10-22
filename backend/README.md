# Hermes API

The backend for Hermes, a non-custodial yield router on Solana.

It does two things:

- Serves live yield routes: APY, TVL and risk tier for each route in the registry.
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
│   ├── yields.ts               # joins the registry with live rates
│   ├── deposit.ts              # quotes every path for a deposit and builds the best one
│   ├── stake-pool-deposit.ts   # direct SPL stake pool deposits (Jito)
│   ├── marinade-deposit.ts     # direct Marinade deposits (mainnet)
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

The risk tier comes from TVL only: low at $100M and above, moderate from $10M, high below. It says how much money already sits in the route. It does not measure contract or depeg risk.

## Endpoints

`GET /api/yields?token=SOL`

Routes Hermes can deposit into for one token (SOL, USDC or USDT), highest APY first. Each route has `deposit`: `live` or `beta` for the network the API runs on.

Add `all=true` to include view-only routes (`deposit: null`). They link out to the protocol's app and are hidden on the site for now. `SHOW_VIEW_ONLY_ROUTES=true` includes them by default.

`POST /api/deposit/quote` with `{ routeId, amount, slippageBps? }`

Quotes a deposit. `amount` is in UI units, e.g. `"1.5"` SOL. Routes with a direct deposit (Jito, Marinade) are quoted directly and through Jupiter. The quote is the one that returns more, and `compared` lists the other.

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
