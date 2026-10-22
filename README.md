# Hermes

Compare live Solana yields and deposit from your own wallet.

Hermes pulls current APY and TVL from liquid staking and lending protocols, ranks the routes for your token, and builds the deposit for the one you pick. Your wallet signs it. Hermes never holds funds.

Live at [hermesagg.xyz](https://www.hermesagg.xyz), in devnet mode for now.

## Repo

- `frontend/`: Next.js app (Vercel)
- `backend/`: Express API (Render). See `backend/README.md`.
- `AGENTS.md`: what Hermes is, what is live, and the rules
- `INTEGRATIONS.md`: the checks every route passes before it takes deposits

## Run it locally

```bash
# API on :3000
cd backend && cp .env.example .env && npm install && npm run dev

# App on :3001
cd frontend && npm install
NEXT_PUBLIC_API_BASE_URL=http://localhost:3000 npm run dev
```

Set `SOLANA_NETWORK=devnet` (API) and `NEXT_PUBLIC_SOLANA_NETWORK=devnet` (app) together to test deposits with test SOL.
