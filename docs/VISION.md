# Hermes vision

The guide for what Hermes is and where it goes. Distilled from three documents the owner shared on 23 October 2026:

1. "HERMES - Meta Yield Aggregator": the owner's vision deck
2. Feedback from the owner's tutor at Turbine
3. "WK1 Assignment: Capstone Project Definition & Market Analysis": the owner's capstone research

`AGENTS.md` tracks what has shipped and what is next. This file says why.

## What Hermes is

Hermes is a yield router for Solana. Titan shows the best route to execute a trade. Hermes shows the best place to put capital to earn yield, and builds the deposit. Hermes = Titan for yield.

The problem: 50 to 150 yield platforms on Solana (LSTs, lending, LPs, stablecoin yield), each with its own app, jargon and advertised APY. A 10% APY can end up near 6% after slippage and fees. Most people give up before they find a route they trust.

Hermes is the router, not the destination. The capital goes to the protocol (Marinade, Jito, Kamino, MarginFi and others).

## The three pillars (vision deck)

1. Yield aggregation, the Hermes Index. One API and one clean, Titan-style screen for LSTs, lending, stablecoin yield and LPs. Index each route on:
   - current APY
   - risk score (protocol, pool, liquidity)
   - validator health
   - emission schedule and expected incentives
   - liquidity available
   - funding rate spreads
2. Yield routing, the Smart Router. Pick the route on real yield, not advertised APY, for the user's risk profile, time horizon and liquidity needs. Count:
   - slippage, withdrawal fees, network fees
   - lockups
   - protocol and validator risk
   - expected APY decay
   - transaction failure risk (route through infra like Sanctum)
3. Dynamic Portfolio Orchestration (DPO), with the Signal Engine. The user delegates capital and Hermes auto-allocates, auto-exits during risk events, auto-rebalances and auto-harvests. The Signal Engine watches for:
   - validator delinquency
   - liquidity drying up
   - TVL falling below a safety threshold
   - APY spikes (exploitable or dangerous)
   - SOL volatility and LST depegs
   - protocol upgrades, downtime and network congestion

The vision deck's order: index first (read only), then the router, then DPO, the core product.

## The wedge (capstone research and tutor feedback)

Better routing alone loses to Jupiter and Lulo. Hermes wins on trust and curation: a Michelin Guide of yield, not a Google of yield.

- Safety Score (the "Hermes Score"): 0 to 100 for every route. The capstone suggests audit status, TVL volatility and team reputation as inputs.
- Sleep Well: a mode that only routes to blue-chip protocols (the capstone names Kamino, Save and MarginFi) and ignores high-risk farms. In Hermes it is called Top rated (owner's choice, 23 Oct 2026): routes with a Safety Score of 80 or more.
- Notifications over dashboards. Alerts beat screens, for example "USDC yield on Lulo dropped to 2%, Kamino pays 12%. Move it?"

Tutor's feedback: keep the Safety Score and Sleep Well front and center, so the product does not drift into a generic dashboard. A solid and credible direction in a competitive space.

## Who it is for (capstone)

1. Passive yield seekers: busy professionals with $10K to $500K in crypto who can't watch positions. They want auto-rebalancing.
2. CEX-to-DeFi migrators: staking on Binance or Coinbase at about 5%, scared of self-custody and jargon. They want a blue-chip mode and a plain "Deposit here for 8%" screen, like a bank.
3. DAO treasuries and project founders: idle funds in multisigs, a duty to be careful. They want non-custodial routing and transparent reporting.
4. Power users: farm many protocols and track them in spreadsheets. They want the live index.

The capstone flags that new users want a savings account, not an index. Routing them to lending (no impermanent loss) instead of LPs is a differentiator.

## Competition (capstone)

- Kamino: the main rival. It routes mostly within its own products.
- Lulo (FlexLend): the direct competitor. Lending only, little risk tiering.
- Others: Meteora, Jupiter, Carrot, Drift, MarginFi, NX Finance. Overlooked: Save, Francium, Tulip, Vaults.fyi.
- Threats: super apps (Jupiter, Kamino) and wallets (Phantom, Solflare) adding yield. Stacking contract risk on top of protocol risk. Hermes avoids that today by holding no funds and building on the protocols' own programs and APIs.

## Language

- Never "risk-free", "guaranteed", "safest" or "audited". The capstone suggests "risk-minimized", "vetted", "blue-chip" and "curated for safety".
- Plain words for new users: "Deposit", "savings", what you get back, what can go wrong.
- Show where every number comes from.

## Custody (decided by the owner, 23 October 2026)

- Hermes stays a router. Routed deposits are non-custodial: Hermes builds the transaction and the user signs it in their own wallet.
- Hermes can hold funds for automation (DPO). It is opt-in: a user who wants Hermes to manage a position moves funds into a Hermes vault. That needs a Hermes program, an outside security review and deposit caps before real funds go in.
- The vision deck says both "not a vault" and "deposits enter a Hermes vault". This decision settles it: router by default, vault only for opt-in automation.

## Founder-market fit (capstone)

Emmanuel Udeze (Duke): ex-moderator of Allstars Nigeria, Superteam contributor, Solana Insiders. Strength: making the complex plain, plus distribution to users new to DeFi. The capstone's warning: a product that holds money needs visible security depth, so a technical co-founder or advisor and a security review matter before the vault.
