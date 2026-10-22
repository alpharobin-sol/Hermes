# Integration gate

Every route moves through three stages: view only, beta, live. A route moves up only when every box in its stage is checked. One route at a time.

The stage lives in `backend/src/registry/routes.ts`:

- view only: `deposit: {}`
- beta: `deposit: { 'mainnet-beta': 'beta' }`
- live: `deposit: { 'mainnet-beta': 'live' }`

Devnet takes the same steps with test SOL, under the `devnet` key.

## 1. View only

Rates show on the site. The button opens the protocol's own app.

- [ ] Route added to the registry with its rate source
- [ ] APY and TVL from `/api/yields` checked against the protocol's own app. Write down the date and both numbers.
- [ ] The website link opens the right page

## 2. Beta

Deposits run in Hermes with real funds. The site labels the route Beta.

- [ ] The API builds the deposit as an unsigned transaction. Hermes never signs.
- [ ] Mainnet simulation passes at three sizes, e.g. 0.01, 1 and the beta cap
- [ ] The quote shows what lands in the wallet: expected amount, minimum, price impact
- [ ] Errors read plainly: low balance, price impact over the cap, protocol paused or full
- [ ] The deposit dialog shows the Beta label and the token the user receives
- [ ] Exit path written down: where and how the user withdraws

## 3. Live

- [ ] The owner deposits real funds through hermesagg.xyz and the receipt lands in the wallet. Link the transaction below.
- [ ] The owner exits (withdraw or swap back). Link the transaction below.
- [ ] No open issues from the beta

## Status

| Route | Stage | Rate check vs app | Mainnet simulation | Owner deposit | Notes |
| --- | --- | --- | --- | --- | --- |
| Jito (JitoSOL) | beta, devnet beta | 22 Oct: Hermes 4.85% / $1,077M, Jito API 4.848% / 10.42M SOL ($1,077M) | Stake pool 0.01 / 1 / 100 SOL pass, Jupiter 0.01 / 1 / 10 SOL pass, 22 Oct | pending | Quotes the stake pool against Jupiter and builds the better one. Jupiter has led by about 0.1% so far. A stale pool (between epochs) falls back to Jupiter. Exit: unstake at jito.network/staking or swap JitoSOL to SOL on Jupiter. |
| Marinade (mSOL) | beta | pending | 0.01 / 1 / 100 SOL pass, 22 Oct | pending | Jupiter swap. Phase 1: direct Marinade deposit. |
| Binance (BNSOL) | beta | pending | 0.01 / 1 / 100 SOL pass, 22 Oct | pending | Jupiter swap, price impact 0.2 to 0.3% |
| Jupiter (jupSOL) | beta | pending | 0.01 / 1 / 100 SOL pass, 22 Oct | pending | Jupiter swap |
| Drift (dSOL) | beta | pending | 0.01 / 1 / 100 SOL pass, 22 Oct | pending | Jupiter swap |
| Helius (hSOL) | beta | pending | 0.01 / 1 / 100 SOL pass, 22 Oct | pending | Jupiter swap, price impact 0.1 to 0.2% |
| Sanctum Infinity (INF) | view only | pending | | | |
| Bybit (bbSOL) | view only | pending | | | |
| JPool (JSOL) | view only | pending | | | |
| BlazeStake (bSOL) | view only | pending | | | |
| Kamino Lend SOL, USDC, USDT | view only | pending | | | Phase 1, step 2 |
| Jupiter Lend SOL, USDC, USDT | view only | pending | | | Phase 1, step 3 |
| MarginFi | not listed | | | | Phase 1, step 4. Needs a live rate source first. |

The six beta routes predate this gate. Their rate checks against each protocol's app are still to do.
