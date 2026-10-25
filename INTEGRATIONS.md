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
- [ ] `incidents` in the registry lists the protocol's and its team's names as DefiLlama's hacks list spells them (check https://api.llama.fi/hacks), so a hack lowers the score.

## 2. Beta

Deposits run in Hermes with real funds. The site labels the route Beta.

- [ ] The API builds the deposit as an unsigned transaction. Hermes never signs.
- [ ] Mainnet simulation passes at three sizes, e.g. 0.01, 1 and the beta cap
- [ ] The quote shows what lands in the wallet: expected amount, minimum, price impact
- [ ] Errors read plainly: low balance, price impact over the cap, protocol paused or full
- [ ] The deposit dialog shows the Beta label and the token the user receives
- [ ] Exit path written down: where and how the user withdraws
- [ ] In-app withdrawal from Portfolio simulates at a small amount and for the whole position

## 3. Live

- [ ] The owner deposits real funds through hermesagg.xyz and the receipt lands in the wallet. Link the transaction below.
- [ ] The owner exits through Hermes's Withdraw (or at the protocol). Link the transaction below.
- [ ] No open issues from the beta

## Status

| Route | Stage | Rate check vs app | Mainnet simulation | Owner deposit | Notes |
| --- | --- | --- | --- | --- | --- |
| Jito (JitoSOL) | beta, devnet beta | 22 Oct: Hermes 4.85% / $1,077M, Jito API 4.848% / 10.42M SOL ($1,077M) | Stake pool 0.01 / 1 / 100 SOL pass, Jupiter 0.01 / 1 / 10 SOL pass, 22 Oct | 25 Oct, owner's wallet from hermesagg.xyz: 0.009 SOL (Max with the new 0.0053 SOL hold-back, from 0.0144 SOL) for 0.0068876 JitoSOL through Jupiter, worth 0.0090093 SOL in the pool (0.1% above what went in). Phantom added its Lighthouse checks; the transaction landed. Portfolio showed the position with Safety 99 within a minute. [tx](https://solscan.io/tx/5SzjA4PAw6ZwFsmDQMSwJrCWv9T1PwsP93SQgwcApoVdqrbRwv8y1yxjPWj1SWXxdsPe5j3JEyVrc1uiH5x482Am). Exit pending. | Quotes the stake pool against Jupiter and builds the better one. Jupiter has led by about 0.1% so far. A stale pool (between epochs) falls back to Jupiter. Exit: unstake at jito.network/staking or swap JitoSOL to SOL on Jupiter. |
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
| Steakhouse USDC (Kamino vault) | beta | 25 Oct: Hermes 4.51% / $19.38M, worked out from where the vault lends (Kamino's vault allocations, each reserve's rate from its market, after the 5% performance fee). Kamino's vault API: 4.41% (lags up to an hour; at 00:13 UTC it still showed 27.4% from a spent rate spike). DefiLlama: 4.14% / $19.38M. Kamino's app (kamino.com, the vault's page) at 00:48 UTC: 4.15% / $19.38M, 90.63% utilization; Hermes 4.148% / $19.38M at the same minute. | 1 / 10 / 1,000 USDC pass, 0.0068 SOL rent on a first deposit, 0 after; 0.05 and 0.1 refused below Kamino's minimum. Refused when the response names another amount, farm or vault. 25 Oct | pending | Kamino's transaction API builds it (`/ktx/kvault/deposit`): token account, vault deposit, farm account, stake. Hermes allows only the vault, farms, token account and compute budget programs, pins the vault, farm and shares mint, checks the amount in the vault instruction, then simulates. The shares are staked in the vault's farm, so nothing lands in the wallet. 76% of the vault could leave on 25 Oct. Exit: Withdraw in Portfolio or on the vault's page at kamino.com (app.kamino.finance redirects there). |
| Project 0 (formerly marginfi) USDC, USDT | beta | 25 Oct, 01:05 UTC: Hermes (each bank's account on chain, the lending APR it caches, compounded) USDC 9.90% / $7.83M deposited / 97.6% borrowed, USDT 11.62% / $3.13M / 98.5% borrowed. Project 0's app (app.0.xyz, Markets): USDC 9.90% / $7.94M, USDT 11.62% / $3.14M. The APYs match; the app's deposit totals run 1.4% and 0.3% above the banks' own share totals. DefiLlama USDT 11.62%. | USDC and USDT 0.01 / 1 / 1,000 pass, 0.0124 SOL account rent on a first deposit. Withdrawals simulated after a deposit in the same transaction: 4 of 10 (with the health check's bank and oracle) and everything with the account's close (rent back, only the fee spent). 25 Oct | pending | Built by Hermes from the program's IDL (0.1.12), no SDK: `marginfi_account_initialize_pda` at a Hermes index per token (USDC 4801, USDT 4802, no third-party id), then `lending_account_deposit`. A Hermes account only ever holds that deposit, so a withdrawal never touches loans; one that borrows is refused. Not scored until Hermes's own history covers two weeks: DefiLlama's free data tracks only what can be withdrawn and its supply history is paid. About 98% borrowed: $188k USDC and $48k USDT could leave on 25 Oct, so the rate is a scarcity rate and withdrawals may wait. No incidents in DefiLlama's hacks list. Exit: Withdraw in Portfolio or at app.0.xyz. |
| MarginFi | renamed | | | | Now Project 0, above. | | | | Phase 1, step 4. Needs a live rate source first. |

The first six beta routes predate this gate. Their rate checks against each protocol's app are still to do.

## In-app withdrawals (beta, 24 Oct)

Built and simulated on mainnet with real positions, never signed:

- Liquid staking (JitoSOL): 0.01 and the whole balance swap back to SOL on Jupiter. 0.037 JitoSOL returned 0.04837 SOL against a pool value of 0.04842 (0.1% exit cost, 0.09% price impact).
- Kamino Lend SOL: 0.01, 0.5 and the whole deposit pass. The whole deposit asks for 0.1% more than Kamino's hourly exchange rate shows; Kamino caps it at the deposit, so nothing is left, and closes the account, returning 0.0176 SOL of rent. With loans in the same account, a full exit is refused with the most that can leave (about 13.88 of 29.11 SOL in the test account).
- Kamino Lend USDC: 1 passes.
- Jupiter Lend USDC: 1 and the whole position (redeems every jlUSDC) pass.
- Jupiter Lend SOL: 0.5 and the whole position pass, SOL arrives unwrapped.
- Steakhouse USDC (25 Oct, real holders, simulated): 10 USDC and the whole position pass for staked shares (unstake, then redeem) and unstaked shares (redeem every share, close the shares account). About 0.001 USDC less lands than asked, as in Kamino's app.

The same checks as the deposits: Kamino's transaction against the deposit allow-list, Jupiter Lend's program only with the user the only signer, the swap with the user the only signer. Each is simulated, and SOL may not leave the wallet beyond the fee and a token account (0.01 SOL).

## Moves (beta, 24 Oct)

A move is a withdrawal and a deposit Hermes already builds, so each half goes through the checks above. Built and simulated on mainnet with real positions, never signed:

- Staking token to staking token, one Jupiter swap: the whole 0.0484 dSOL to mSOL (0.0418 mSOL, worth 0.05918 SOL in its pool against 0.05915 SOL in, so no cost), and 0.02 jupSOL to JitoSOL. The swap has the user as the only signer and the deposit's 1% price impact limit.
- Kamino Lend SOL to Marinade and to Jupiter Lend SOL, the whole 1.3613 SOL: step 1 is the Kamino withdrawal (simulated, 0.0176 SOL of account rent back). Simulated, the wallet's SOL rises 1.3789 with the fee added back; taking out the closed Kamino account's 0.0176 SOL leaves 1.3613 SOL, the position, which is what step 2 deposits.
- dSOL to Kamino Lend SOL: step 1 swaps dSOL to SOL (0.0000625 SOL cost, about 0.1% of 0.0591 SOL, made back in about 172 days at today's APYs).
- Step 2 from real withdrawals by other wallets in the last half hour: Jupiter Lend USDC withdrawals of 33.757367 and 100 USDC were read from their confirmed transactions (one a version 1 transaction) and built into Kamino Lend USDC deposits with each wallet's one-time rent (0.0176 and 0.0298 SOL). Transactions that pay the signer nothing (bots moving funds elsewhere) are refused with a plain reason.
- Steakhouse USDC to Jupiter Lend USDC (50 USDC) and to Kamino Lend USDC (the whole 237.72 USDC): step 1 is the vault withdrawal, built and simulated. Step 1's landed amount read from a real vault withdrawal: 19.998998 USDC.
- Owner's reroute from hermesagg.xyz (25 Oct, Solflare on Android Chrome): the whole 0.0068876 JitoSOL (0.0090093 SOL in its pool) to 0.006374506 mSOL (0.0090141 SOL in its pool, 0.05% more), one Jupiter swap, quote ≈ 0.006375 mSOL. [tx](https://solscan.io/tx/5YKHR8fZW3f1omEqCNQLoBn8GTVczDW6oBXHM3vTfSmhQsbmu28zixQ3Vu1gwp1NcXTyC6CSZJXSdxqxekXu2ZhA). The dialog wrongly said nothing moved: fixed in the follow-up to PR #60.
- Refused: a move to another token, the same route, or more than the target's beta cap (Jupiter Lend USDC to Kamino Lend USDC above 1,000 USDC).

Still to do: an owner move per kind, signed, before moves leave beta.
