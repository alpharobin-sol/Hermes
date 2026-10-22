# HERMES - Solana Meta-Yield Aggregator & Routing Engine 

HERMES is a sophisticated backend system for optimizing yield farming on Solana. It aggregates yield data from multiple protocols, performs risk-adjusted routing, and automates portfolio management through Dynamic Portfolio Orchestration (DPO).

##  Core Features

### 1. **Yield Aggregation**
- Real-time yield tracking from 5+ Solana protocols
- Marinade (mSOL staking)
- Jito (JitoSOL with MEV rewards)
- MarginFi (lending/borrowing)
- Kamino (automated liquidity management)
- Orca (Whirlpool concentrated liquidity)

### 2. **Smart Routing Engine**
- Risk-adjusted yield scoring
- Multi-factor route optimization (APY, TVL, volatility, slippage)
- User risk profiles (conservative, moderate, aggressive)
- Route simulation and comparison

### 3. **Dynamic Portfolio Orchestration (DPO)**
- Automated portfolio rebalancing
- Risk event detection and response
- Yield chasing with confidence scoring
- Auto-healing for critical positions

### 4. **Risk Management**
- Real-time volatility tracking
- Safety tier ratings (AAA to B)
- Impermanent loss estimation
- Liquidation risk monitoring
- Historical performance analysis

##  Architecture

```
backend/
├── src/
│   ├── api/              # REST API endpoints
│   ├── services/         # Protocol integrations
│   ├── engine/           # Core logic (routing, risk, DPO)
│   ├── db/               # Database & Prisma
│   ├── workers/          # Background jobs
│   └── utils/            # Helpers & utilities
├── package.json
├── tsconfig.json
└── README.md
```

##  Quick Start

### Prerequisites
- Node.js >= 18.0.0
- PostgreSQL database
- Redis server
- Solana RPC endpoint (Helius recommended)

### Installation

```bash
# Clone the repository
cd backend

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env
# Edit .env with your configuration

# Generate Prisma client
npm run prisma:generate

# Run database migrations
npm run prisma:migrate

# Start the development server
npm run dev
```

### Environment Variables

```env
# Database
DATABASE_URL="postgresql://postgres:password@localhost:5432/hermes?schema=public"

# Redis
REDIS_URL="redis://localhost:6379"

# Solana RPC
SOLANA_RPC_URL="https://mainnet.helius-rpc.com/?api-key=YOUR_KEY"
HELIUS_API_KEY="your-helius-api-key"

# API Server
PORT=3000
NODE_ENV="development"

# Risk Model Weights
RISK_WEIGHT_APY=0.4
RISK_WEIGHT_TVL=0.2
RISK_WEIGHT_VOLATILITY=0.25
RISK_WEIGHT_IL=0.1
RISK_WEIGHT_PROTOCOL=0.05

# DPO Settings
DPO_REBALANCE_THRESHOLD=0.15
DPO_MIN_YIELD_IMPROVEMENT=0.02

# Worker Settings
YIELD_COLLECTION_INTERVAL_MINUTES=10
DPO_WORKER_INTERVAL_MINUTES=30
```

### Deploy to Render (API only)

`render.yaml` at the repo root deploys the API without Postgres or Redis (`ENABLE_WORKERS=false`).
Yields and deposit routes work in this mode. `/api/yields/best` needs the yield collector's database, so the app falls back to `/api/yields`.

1. Render → New → Blueprint → pick this repo.
2. Fill in `JUPITER_API_KEY` and `SOLANA_RPC_URL` when asked.
3. Set `NEXT_PUBLIC_API_BASE_URL` in the frontend's Vercel project to the Render URL, then redeploy the frontend.

The free plan sleeps after 15 minutes without traffic, so the first request after a quiet spell can take up to a minute.

## 📡 API Endpoints

### Yield Data

#### Get All Yields
```http
GET /api/yields?protocol=marinade&asset=SOL&limit=50
```

#### Get Best Route
```http
GET /api/yields/best?asset=SOL&amount=1000&riskProfile=moderate
```

Response:
```json
{
  "success": true,
  "data": {
    "bestRoute": {
      "protocol": "kamino",
      "score": 87.21,
      "apy": 0.23,
      "tvl": 25000000,
      "riskScore": 82.5,
      "reason": "Best risk-adjusted yield for low volatility tolerance"
    },
    "alternativeRoutes": [...],
    "confidence": 0.85,
    "metrics": {
      "totalRoutesEvaluated": 8,
      "averageAPY": 0.12,
      "averageRiskScore": 75.3
    }
  }
}
```

#### Simulate Route
```http
POST /api/yields/simulate
Content-Type: application/json

{
  "protocol": "jito",
  "asset": "SOL",
  "amount": 1000
}
```

#### Compare Protocols
```http
GET /api/yields/compare?protocols=marinade,jito,kamino&asset=SOL
```

### Risk & Volatility

#### Get Risk Assessment
```http
GET /api/risk/jito/SOL
```

Response:
```json
{
  "success": true,
  "data": {
    "protocol": "jito",
    "asset": "SOL",
    "riskScore": 85.2,
    "safetyTier": "AA",
    "factors": {
      "apyScore": 42.5,
      "tvlScore": 87.0,
      "volatilityScore": 78.3,
      "ilScore": 100.0,
      "protocolScore": 90.0
    },
    "risks": [
      "Protocol health score below optimal threshold"
    ]
  }
}
```

#### Get Volatility Metrics
```http
GET /api/volatility/kamino/SOL-USDC
```

#### Get Risk Events
```http
GET /api/risk-events?severity=high&resolved=false
```

### Portfolio Management

#### Get Portfolio
```http
GET /api/portfolio/:id
```

#### Evaluate Portfolio
```http
POST /api/portfolio/:id/evaluate
```

Response:
```json
{
  "success": true,
  "data": {
    "portfolioId": "abc123",
    "currentValue": 10000,
    "shouldRebalance": true,
    "riskStatus": "healthy",
    "actions": [
      {
        "action": "rebalance",
        "fromProtocol": "jito",
        "toProtocol": "kamino",
        "reason": "APY drop + rising volatility",
        "confidence": 0.82,
        "urgency": "medium"
      }
    ]
  }
}
```

#### Execute Portfolio Actions
```http
POST /api/portfolio/:id/execute
Content-Type: application/json

{
  "actions": [...]
}
```

### Statistics

#### Get Platform Stats
```http
GET /api/stats
```

## 🔧 Protocol Integrations

### Marinade Finance
- **Features**: mSOL staking, validator quality metrics
- **Risk**: Low (AAA/AA rated)
- **APY Range**: 6-8%
- **Fees**: 2% of rewards, 0.3% instant unstaking

### Jito
- **Features**: MEV-boosted staking rewards
- **Risk**: Low (AAA/AA rated)
- **APY Range**: 7-9% (including MEV)
- **Fees**: 4% staking rewards, 5% MEV rewards

### MarginFi
- **Features**: Lending/borrowing markets
- **Risk**: Medium (A/BBB rated)
- **APY Range**: 3-12% (varies by utilization)
- **Fees**: 15% reserve factor

### Kamino Finance
- **Features**: Automated LP management, concentrated liquidity
- **Risk**: Medium (A/BBB rated)
- **APY Range**: 12-25%
- **Fees**: 10% performance fee, 1% management fee

### Orca (Whirlpools)
- **Features**: Concentrated liquidity AMM
- **Risk**: Low-Medium (AA/A rated)
- **APY Range**: 7-18%
- **Fees**: 0.01-1% swap fees (pool dependent)

## 🧮 Risk Scoring Model

```typescript
riskScore = (
  APY * 0.4 +
  log(TVL) * 0.2 +
  (100 - volatility) * 0.25 +
  (100 - IL_risk) * 0.1 +
  protocolScore * 0.05
)
```

### Safety Tiers
- **AAA**: 90-100 (Extremely Safe)
- **AA**: 80-89 (Very Safe)
- **A**: 70-79 (Safe)
- **BBB**: 60-69 (Moderate Risk)
- **BB**: 50-59 (Higher Risk)
- **B**: <50 (High Risk)

## 🤖 Background Workers

### Yield Collector
- **Frequency**: Every 10 minutes
- **Tasks**:
  - Fetch yield data from all protocols
  - Update protocol health metrics
  - Calculate volatility metrics
  - Detect risk events

### DPO Worker
- **Frequency**: Every 30 minutes
- **Tasks**:
  - Evaluate all portfolios
  - Execute rebalancing actions
  - Auto-heal critical positions
  - Clean up old jobs

##  Database Schema

### Key Tables
- `YieldRecord`: Historical yield data
- `Portfolio`: User portfolio allocations
- `DPOJob`: Automation tasks
- `ProtocolMetadata`: Protocol health & status
- `VolatilitySnapshot`: Volatility metrics
- `RiskEvent`: Risk event log

## 🛠 Development

### Run Tests
```bash
npm test
```

### Run Linter
```bash
npm run lint
```

### Database Management
```bash
# Open Prisma Studio
npm run prisma:studio

# Create new migration
npm run prisma:migrate

# Reset database
npx prisma migrate reset
```

### Run Workers Separately
```bash
# Yield collector only
npm run worker:yield

# DPO worker only
npm run worker:dpo
```

## 📅 12-16 Week Development Sprint Plan

### **Weeks 1-2: Foundation**
**Goal**: Set up infrastructure and architecture

**Tasks**:
- [x] Initialize TypeScript project with proper tooling
- [x] Set up PostgreSQL + Prisma ORM
- [x] Configure Redis for BullMQ
- [x] Design database schema
- [x] Set up Solana RPC connections
- [x] Create project structure
- [x] Set up logging (Winston)
- [x] Configure environment management

**Deliverables**:
- Runnable backend skeleton
- Database migrations
- Development environment setup

---

### **Weeks 3-4: Protocol Integrations (Part 1)**
**Goal**: Integrate Marinade and Jito

**Tasks**:
- [x] Marinade API integration
  - mSOL APY fetching
  - Validator quality metrics
  - Slippage estimation
- [x] Jito API integration
  - JitoSOL APY + MEV rewards
  - Stake pool metrics
  - Fee structure
- [x] Error handling & retry logic
- [x] Protocol health monitoring
- [x] Basic yield storage in DB

**Deliverables**:
- Working Marinade integration
- Working Jito integration
- Yield data in database

---

### **Weeks 5-6: Protocol Integrations (Part 2)**
**Goal**: Integrate MarginFi, Kamino, Orca

**Tasks**:
- [x] MarginFi integration
  - Multi-asset support (SOL, USDC)
  - Supply/borrow APY
  - Liquidation thresholds
- [x] Kamino integration
  - Vault yields (base + emissions)
  - IL risk calculation
  - Strategy types
- [x] Orca Whirlpool integration
  - Concentrated liquidity pools
  - Fee APR + incentives
  - Price range optimization
- [x] Unified yield API endpoint

**Deliverables**:
- All 5 protocols integrated
- Unified yield data model
- `/api/yields` endpoint

---

### **Weeks 7-8: Risk Model V1**
**Goal**: Build basic risk assessment

**Tasks**:
- [x] Risk scoring algorithm
  - APY weighting
  - TVL depth scoring
  - Protocol maturity scores
- [x] Safety tier classification (AAA-B)
- [x] Risk factor identification
- [x] `/api/risk/:protocol/:asset` endpoint
- [ ] Risk dashboard (future UI work)

**Deliverables**:
- Working risk engine
- Risk API endpoints
- Documentation on risk model

---

### **Weeks 9-10: Volatility Oracle & Risk Model V2**
**Goal**: Advanced risk metrics

**Tasks**:
- [x] Historical volatility calculation
  - 24h, 7d, 30d windows
  - Standard deviation
- [x] Sharpe ratio calculation
- [x] Max drawdown tracking
- [x] Volatility spike detection
- [x] Risk event logging
- [x] `/api/volatility/:protocol/:asset` endpoint

**Deliverables**:
- Volatility oracle
- Enhanced risk scoring
- Risk event system

---

### **Weeks 11-12: Smart Routing Engine**
**Goal**: Build yield optimization

**Tasks**:
- [x] Route discovery algorithm
- [x] Risk-adjusted scoring
- [x] User risk profiles (conservative/moderate/aggressive)
- [x] Multi-factor optimization
- [x] Route simulation
- [x] Slippage estimation
- [x] `/api/yields/best` endpoint
- [x] `/api/yields/simulate` endpoint

**Deliverables**:
- Working router engine
- Route comparison API
- Simulation endpoints

---

### **Weeks 13-14: DPO Engine**
**Goal**: Automated portfolio management

**Tasks**:
- [x] Portfolio evaluation logic
- [x] Optimal allocation calculator
- [x] Rebalancing detection
- [x] Yield chasing logic
- [x] Risk-based auto-exit
- [x] DPO job queue (BullMQ)
- [x] `/api/portfolio/:id/evaluate` endpoint
- [ ] On-chain transaction execution (future)

**Deliverables**:
- DPO engine
- Portfolio API endpoints
- Automated evaluation

---

### **Weeks 15-16: Background Workers & Testing**
**Goal**: Production readiness

**Tasks**:
- [x] Yield collector worker
  - Scheduled fetching (every 10 min)
  - Protocol health updates
  - Error recovery
- [x] DPO worker
  - Portfolio evaluation (every 30 min)
  - Job execution
  - Cleanup tasks
- [ ] Integration tests
- [ ] Load testing
- [ ] Security audit checklist
- [ ] API documentation (Swagger)
- [ ] Deployment guide

**Deliverables**:
- Production-ready workers
- Test coverage >70%
- Deployment documentation

---

### **Post-Sprint: Testnet & Hardening**
**Future Work**:
- Solana transaction execution
- Testnet integration
- Security audit
- Performance optimization
- Monitoring & alerting
- Frontend integration

---

##  Security Considerations

### Current Implementation
- Environment variable protection
- Input validation on API endpoints
- Error handling without data leakage
- Rate limiting ready (add middleware)

### TODO for Production
- [ ] API key authentication
- [ ] Rate limiting per user
- [ ] Transaction signing security
- [ ] Wallet key management (HSM/KMS)
- [ ] Security audit
- [ ] DDoS protection

##  Deployment

### Docker (Recommended)
```dockerfile
# Coming soon
```

### Manual Deployment
1. Set up PostgreSQL database
2. Set up Redis instance
3. Configure environment variables
4. Run migrations: `npm run prisma:migrate`
5. Build: `npm run build`
6. Start: `npm start`

### Monitoring
- Use Winston logs for debugging
- Monitor worker queue health
- Track API response times
- Set up alerts for risk events

## 🤝 Contributing

This is a private project, but contributions are welcome via:
1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## 📄 License

MIT License - See LICENSE file for details

## 📞 Support

For issues or questions:
- Open a GitHub issue
- Contact: [your-email]

---

**Built with ❤ for the Solana DeFi ecosystem**
