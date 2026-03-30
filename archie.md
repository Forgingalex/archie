# CLAUDE.md — Archoe Project Brain

## What This Is
An AI agent that converts natural-language requests into authenticated API calls, returns structured JSON results, and uses Arc (Circle's stablecoin-native L1) for agent identity/reputation and x402/Nanopayments for paid API settlement.

## One-Liner
"Chat with it like 'Hey I need Twitter API' → it fetches, returns structured data, and handles payment if the API is paid."

## Architecture Principle
**Fast offchain execution + onchain trust layer (Arc)**
- The request/response path is entirely offchain (fast)
- Arc is used ONLY for: agent identity (ERC-8004), reputation events
- x402 payments use a separate EOA wallet on Base Sepolia (not Arc) — two wallets, two purposes:
  - **Circle Developer-Controlled Wallet** → Arc identity (ERC-8004), reputation signing
  - **EOA Wallet (viem)** → x402 autonomous micropayments (USDC on Base Sepolia)

## x402 Payment Flow (COMPLETE)
```
User asks for premium data
  → Planner selects paiddata connector
  → paiddata.ts calls GET /paid/market-intel via x402-wrapped axios
  → Server responds 402 + PAYMENT-REQUIRED header (payment requirements JSON, base64)
  → @x402/axios intercepts 402, creates EIP-3009 transferWithAuthorization
  → EOA wallet (viem) signs the authorization
  → Retry with X-PAYMENT header (signed authorization, base64)
  → Server verifies EIP-3009 signature with viem.verifyTypedData
  → Server returns 200 with premium market data
  → UI shows "Paid 0.001 USDC via x402" in orange
```

## Tech Stack
- **Runtime:** Node.js 20+ with TypeScript
- **Framework:** Fastify
- **LLM Planner:** Groq (Llama 3.x) — free tier, swap later if needed
- **Cache:** Redis (or in-memory Map for dev)
- **Database:** PostgreSQL (or SQLite for dev)
- **Onchain:** Arc Testnet (Chain ID: 5042002)
- **Payments:** x402 / Circle Nanopayments (USDC)
- **Identity:** ERC-8004 (IdentityRegistry, ReputationRegistry, ValidationRegistry)

## Arc Testnet Details
| Key | Value |
|-----|-------|
| RPC | https://rpc.testnet.arc.network |
| WebSocket | wss://rpc.testnet.arc.network |
| Chain ID | 5042002 |
| Currency | USDC |
| Explorer | https://testnet.arcscan.app |
| Faucet | https://faucet.circle.com |

## ERC-8004 Contract Addresses (Arc Testnet)
| Contract | Address |
|----------|---------|
| IdentityRegistry | 0x8004A818BFB912233c491871b3d84c89A494BD9e |
| ReputationRegistry | 0x8004B663056A597Dffe9eCcC1965A193B7388713 |
| ValidationRegistry | 0x8004Cb1BF31DAf7788923b405b754f57acEB4272 |

## MVP API Connectors (5 for v1)
1. **Crypto prices** — CoinGecko or CoinCap (free)
2. **Twitter/X data** — via RapidAPI or direct (may be paid → x402 demo)
3. **Forex/FX rates** — ExchangeRate-API or Open Exchange Rates (free tier)
4. **News** — NewsAPI.org (free tier)
5. **Blockchain data** — Etherscan / Blockscout (free tier)

## Project Structure
```
archie/
├── CLAUDE.md                  # This file — project brain
├── package.json
├── tsconfig.json
├── .env.example               # Template for secrets
├── .gitignore
├── src/
│   ├── index.ts               # Fastify server entrypoint
│   ├── config/
│   │   └── env.ts             # Environment variable loader
│   ├── gateway/
│   │   ├── router.ts          # HTTP routes
│   │   ├── paid-routes.ts     # x402-protected /paid/market-intel endpoint
│   │   └── middleware.ts      # Auth, rate limit, request ID
│   ├── orchestrator/
│   │   ├── orchestrator.ts    # Core request lifecycle
│   │   └── planner.ts        # LLM intent extraction (Groq)
│   ├── connectors/
│   │   ├── registry.ts        # API registry (which APIs exist, their config)
│   │   ├── base.ts            # Base connector interface
│   │   ├── crypto.ts          # CoinGecko/CoinCap
│   │   ├── twitter.ts         # Twitter/X
│   │   ├── forex.ts           # FX rates
│   │   ├── news.ts            # NewsAPI
│   │   ├── blockchain.ts      # Etherscan/Blockscout
│   │   └── paiddata.ts        # x402 paid data connector (0.001 USDC/request)
│   ├── cache/
│   │   └── cache.ts           # In-memory cache (Redis later)
│   ├── payments/
│   │   └── x402.ts            # Circle wallets (identity) + EOA x402 client (payments)
│   ├── identity/
│   │   └── arc.ts             # ERC-8004 registration + reputation
│   └── types/
│       └── index.ts           # Shared TypeScript types
├── scripts/
│   ├── register-agent.ts      # One-off: register agent on Arc
│   └── generate-wallet.ts     # One-off: generate EOA x402 payment wallet
└── tests/
    └── orchestrator.test.ts
```

## Request Flow
```
User: "Get BTC price and convert to naira"
  → Gateway receives request, assigns requestId
  → Orchestrator calls Planner (Groq LLM)
  → Planner returns: { tools: ["crypto", "forex"], params: {...} }
  → Orchestrator checks cache for each tool
  → If miss: Connector fetches from external API
  → If paid API: x402 payment authorized first
  → Results normalized to standard schema
  → Response returned to user
  → Optional: log reputation event on Arc
```

## Key Rules
1. **Never expose API keys to the LLM.** The planner gets tool names and schemas, not credentials.
2. **Connectors are isolated.** One failing connector cannot crash another.
3. **Cache aggressively.** 30s–5min TTL depending on data freshness needs.
4. **All external calls have timeouts.** Default 10s, configurable per connector.
5. **Structured output only.** Every response is JSON with a consistent envelope.
6. **Arc is not in the hot path.** Identity/reputation writes happen async after the response is sent.

## Response Envelope
```json
{
  "requestId": "uuid",
  "status": "success" | "error" | "partial",
  "data": { ... },
  "meta": {
    "sources": ["coingecko", "exchangerate-api"],
    "cached": false,
    "latencyMs": 340,
    "cost": { "amount": "0.00", "currency": "USDC", "paid": false }
  }
}
```

## Environment Variables (.env)
```
# Server
PORT=3000
NODE_ENV=development

# LLM (Groq — free)
GROQ_API_KEY=

# Arc Testnet
ARC_RPC_URL=https://rpc.testnet.arc.network
ARC_CHAIN_ID=5042002

# Circle (for Arc identity wallets)
CIRCLE_API_KEY=
CIRCLE_ENTITY_SECRET=

# Arc wallet IDs — populated by running: npx tsx --env-file=.env scripts/register-agent.ts
ARC_AGENT_WALLET_ID=
ARC_VALIDATOR_WALLET_ID=

# x402 EOA Payment Wallet (separate from Circle identity wallets)
# Generate: npx tsx scripts/generate-wallet.ts
# Fund: https://faucet.circle.com (select Base Sepolia)
X402_PRIVATE_KEY=
X402_NETWORK=base-sepolia

# API Keys for connectors
COINGECKO_API_KEY=
TWITTER_BEARER_TOKEN=
NEWS_API_KEY=
ETHERSCAN_API_KEY=
```

## Git Rules
- Alexander runs all git commands himself
- Never commit .env or private keys
- Use .env.example as the template

## Build Order (Weekly)
**Week 1 (COMPLETE):** Gateway + Orchestrator + Planner + 3 connectors (crypto, forex, news) + basic chat UI
**Week 2 (COMPLETE):** Cache + validation + retries + structured output + 2 more connectors
**Week 3 (COMPLETE):** x402 payment flow for paid APIs + Circle wallet setup
**Week 4 (COMPLETE):** Arc ERC-8004 agent registration + reputation logging + observability

## Current Status
- [x] Project scaffolded
- [x] Fastify server running
- [x] Planner (Groq) wired up
- [x] First connector (crypto) working
- [x] Cache layer
- [x] Gateway auth + rate limit
- [x] x402 autonomous payments (EOA wallet + @x402/axios + @x402/evm)
- [x] Self-hosted x402-protected endpoint (/paid/market-intel)
- [x] paiddata connector (pays 0.001 USDC via x402 per request)
- [x] UI payment indicator ("Paid 0.001 USDC via x402")
- [x] Arc identity registration
