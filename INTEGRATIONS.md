# Integration gate

Every route moves through three stages: view only, beta, live. A route moves up only when every box in its stage is checked. One route at a time.

The stage lives in `backend/src/registry/routes.ts`:

- view only: `deposit: {}`
- beta: `deposit: { 'mainnet-beta': 'beta' }`
- live: `deposit: { 'mainnet-beta': 'live' }`

Devnet takes the same steps with test SOL, under the `devnet` key.

## 1. View only

The route is in the registry with a live rate. The site hides view-only routes for now (`/api/yields?all=true` lists them, `SHOW_VIEW_ONLY_ROUTES=true` shows them on the site). When shown, the button opens the protocol's own app.

- [ ] Route added to the registry with its rate source
- [ ] APY and TVL from `/api/yields` checked against the protocol's own app. Write down the date and both numbers.
- [ ] The website link opens the right page
- [ ] The route has a Safety Score: its protocol is on DefiLlama and its deposit history has a source in `backend/src/services/safety.ts`. Without both the card says Not scored.

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
| Marinade (mSOL) | beta | 22 Oct: Hermes 5.351% / $233.0M, Marinade API 7-day 5.351% / liquid stake $231.1M | Marinade direct 0.01 / 1 / 4 / 10 SOL pass (new and existing mSOL accounts), Jupiter 0.01 / 1 / 10 SOL pass, 22 Oct | pending | Quotes Marinade's own deposit against Jupiter and builds the better one. Jupiter has led by about 0.15% so far. Exit: swap mSOL to SOL on Jupiter, or unstake at marinade.finance (instant via its pool, or delayed). |
| Binance (BNSOL) | beta | pending | 0.01 / 1 / 100 SOL pass, 22 Oct | pending | Jupiter swap, price impact 0.2 to 0.3% |
| Jupiter (jupSOL) | beta | pending | 0.01 / 1 / 100 SOL pass, 22 Oct | pending | Jupiter swap |
| Drift (dSOL) | beta | pending | 0.01 / 1 / 100 SOL pass, 22 Oct | pending | Jupiter swap |
| Helius (hSOL) | beta | pending | 0.01 / 1 / 100 SOL pass, 22 Oct | pending | Jupiter swap, price impact 0.1 to 0.2% |
| Sanctum Infinity (INF) | beta | 23 Oct: Hermes 5.50% / $201.7M (DefiLlama). On-chain supply x Jupiter value: $201.2M. Sanctum's APY API returns 0 and its TVL API is stale. | Jupiter 0.01 / 1 / 10 SOL pass, received equals quote, 23 Oct | pending | Jupiter swap via Meteora DLMM, price impact under 0.03%. Exit: swap INF to SOL on Jupiter or at app.sanctum.so. |
| Bybit (bbSOL) | beta | 23 Oct: Hermes 4.71% / $150.5M (DefiLlama). On-chain supply x Jupiter value: $150.1M. No protocol APY API. | Jupiter 0.01 / 1 / 10 SOL pass, received equals quote, 23 Oct | pending | Jupiter swap via Manifest (and Sanctum at 10 SOL), price impact 0.16 to 0.21%. Exit: swap bbSOL to SOL on Jupiter. |
| JPool (JSOL) | beta | 23 Oct: Hermes 4.73% / $129.5M (DefiLlama). On-chain supply x Jupiter value: $129.4M. No protocol APY API. | Jupiter 0.01 / 1 / 10 SOL pass, received equals quote, 23 Oct | pending | Jupiter swap via Sanctum, Saber, Raydium. JPool's own stake pool gives the same JSOL for 1 SOL (0.72334), so no direct path yet. Buying and selling back costs about 0.4%. Exit: swap JSOL to SOL on Jupiter or unstake at jpool.one. |
| BlazeStake (bSOL) | beta | 23 Oct: Hermes 4.62% / $91.4M (DefiLlama). BlazeStake API 4.86%. On-chain supply x Jupiter value: $91.1M. | Jupiter 0.01 / 1 / 10 SOL pass, received equals quote, 23 Oct | pending | Jupiter swap via Whirlpool. Jupiter gives more bSOL than BlazeStake's own stake pool (0.75712 vs 0.75644 for 1 SOL), so no direct path yet. Exit: swap bSOL to SOL on Jupiter or unstake at stake.solblaze.org. |
| Kamino Lend SOL, USDC, USDT | beta | 23 Oct: rates come from Kamino's own reserve API (SOL 5.50% / $247M / 92% borrowed, USDC 31.3% / $120M / 99% borrowed, USDT 4.0% / $12.4M / 87% borrowed). Check against app.kamino.finance pending. | SOL 0.01 / 1 / 4 (first deposit, new Kamino account), USDC and USDT 1 / 1,000 pass, 23 Oct | pending | Kamino's transaction API builds it; Hermes swaps in a priority fee and simulates. First deposit pays one-time account rent (0.0241 SOL for SOL, 0.0298 SOL for USDC/USDT, measured by simulation). USDC was 99 to 100% borrowed at integration, so USDC withdrawals may have to wait. Exit: withdraw at app.kamino.finance when the reserve has liquidity. |
| Jupiter Lend SOL, USDC, USDT | beta | 23 Oct: Hermes (Jupiter Lend API) SOL 3.83% / $22.2M, USDC 7.53% / $471.7M, USDT 4.64% / $16.8M. DefiLlama Earn pools: 3.90% / $22.3M, 7.92% / $471.5M, 4.67% / $16.8M. Check against jup.ag/lend/earn pending. | SOL 0.01 / 1 / 10, USDC and USDT 1 / 10 / 1,000 pass, jl tokens minted equal the built amount, 23 Oct | pending | Built from Jupiter's deposit instruction (`/earn/deposit-instructions`, Jupiter Lend program only, user the only signer). Hermes adds the jl token account and, for SOL, wraps SOL in an account it closes after. Quoted against a Jupiter swap to the same jl token, which routes through Jupiter Lend and lands within 0.0001%, so the direct deposit is built. The deposit is a jl token (jlWSOL, jlUSDC, jlUSDT) in the wallet that grows as interest accrues. Only part of each reserve can be withdrawn at once (USDC 6%, USDT 12%, SOL 25% on 23 Oct), set by what is lent out and Jupiter Lend's withdrawal limit. Exit: withdraw at jup.ag/lend/earn, or swap the jl token on Jupiter. |
| MarginFi | not listed | | | | Phase 1, step 4. Needs a live rate source first. |

The first six beta routes predate this gate. Their rate checks against each protocol's app are still to do.
