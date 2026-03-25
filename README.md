# Archie

Archie is an AI-powered API agent that converts natural-language requests into authenticated API calls and returns structured JSON. You describe what you want in plain English like "Get the current Bitcoin price in Nigerian naira" and Archie figures out which APIs to call, runs them in parallel, and hands back a consistent response envelope. It runs on Node.js with Fastify, uses Groq (Llama 3) as its planning brain, and anchors agent identity and reputation on Arc Testnet via ERC-8004 contracts. Paid API access is handled through x402 micropayments settled in USDC via Circle wallets.

## Quick Start

Prerequisites: Node.js 20+, npm, a free [Groq API key](https://console.groq.com/keys).

```bash
git clone <your-repo-url>
cd archie
npm install
cp .env.example .env
# Edit .env and add your GROQ_API_KEY at minimum
npm run dev
```

The server starts on `http://localhost:3000`. Test it immediately:

```bash
curl -X POST http://localhost:3000/agent \
  -H "Content-Type: application/json" \
  -d '{"query": "What is the current price of Ethereum?"}'
```

## API

All responses follow the same envelope:

```json
{
  "requestId": "uuid",
  "status": "success",
  "data": { ... },
  "meta": {
    "sources": ["crypto"],
    "cached": false,
    "latencyMs": 312
  }
}
```

`status` is `"success"`, `"partial"` (some connectors succeeded), or `"error"`.

### POST /agent

Main endpoint. Accepts a natural-language query in the request body.

```
POST /agent
Content-Type: application/json

{ "query": "Get BTC and ETH prices in USD" }
```

Rate limit: 20 requests per minute per IP (stricter than other endpoints because it invokes the LLM and external APIs).

```bash
curl -X POST http://localhost:3000/agent \
  -H "Content-Type: application/json" \
  -d '{"query": "What are the latest tech headlines?"}'
```

### GET /ask

Convenience endpoint for quick tests — same as POST /agent but query in the URL.

```
GET /ask?q=bitcoin+price
```

```bash
curl "http://localhost:3000/ask?q=convert+100+USD+to+EUR"
```

### GET /connectors

Lists all registered connectors with their name, description, and cost tier.

```bash
curl http://localhost:3000/connectors
```

### GET /health

Returns server status and current cache size. Use for uptime monitoring.

```bash
curl http://localhost:3000/health
```

### GET /info

Returns agent metadata: name, version, network, chain ID, connector names.

```bash
curl http://localhost:3000/info
```

## How It Works

When a query arrives, the orchestrator calls the Groq LLM planner with a system prompt that lists available connectors and their actions. The planner returns a JSON plan, which connectors to call, which actions to invoke, and what parameters to pass. The orchestrator then runs all connector calls in parallel, checking the in-memory cache first for each one. Results are merged into the response envelope and returned. Arc identity and reputation events are written asynchronously after the response is sent, so they never add latency.

## Connectors

| Name | API | Env var required | Actions |
|------|-----|-----------------|---------|
| crypto | CoinGecko v3 | `COINGECKO_API_KEY` (optional) | `getPrice`, `getMarketData`, `search` |
| forex | open.er-api.com | none | `getRates`, `convert` |
| news | NewsAPI.org | `NEWS_API_KEY` | `headlines`, `search` |
| twitter | Twitter API v2 | `TWITTER_BEARER_TOKEN` | `search`, `userTweets` |
| blockchain | Etherscan v2 | `ETHERSCAN_API_KEY` (optional) | `getBalance`, `getTransactions` |

All connectors time out after 10 seconds and retry up to 2 times on failure.

## Arc Integration

Archie uses ERC-8004 contracts on Arc Testnet for onchain agent identity and reputation. The `IdentityRegistry` contract mints an agent NFT with a metadata URI; the `ReputationRegistry` records scored feedback events from a validator wallet.

To set up Arc identity:

1. Add `CIRCLE_API_KEY` and `CIRCLE_ENTITY_SECRET` to your `.env`.
2. Run `npm run register-agent`. This creates two Circle developer-controlled wallets (agent + validator), prints their addresses, and exits.
3. Fund both wallet addresses from the [Arc faucet](https://faucet.circle.com) (select Arc Testnet, chain ID 5042002).
4. Run `npm run register-agent` again. It will register the agent on-chain and print wallet IDs to add to `.env`.

Arc docs: https://docs.arc.net

## Configuration

Every environment variable with its purpose:

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | no | Server port (default: 3000) |
| `NODE_ENV` | no | `development` or `production` |
| `GROQ_API_KEY` | yes | Groq API key for the LLM planner |
| `GROQ_MODEL` | no | Groq model override (default: llama-3.3-70b-versatile) |
| `ARC_RPC_URL` | no | Arc Testnet RPC URL |
| `ARC_CHAIN_ID` | no | Arc chain ID (default: 5042002) |
| `CIRCLE_API_KEY` | for Arc/x402 | Circle developer-controlled wallets API key |
| `CIRCLE_ENTITY_SECRET` | for Arc/x402 | Circle entity secret for signing wallet ops |
| `ARC_AGENT_WALLET_ID` | for Arc/x402 | Circle wallet ID for the agent (set by register-agent script) |
| `ARC_VALIDATOR_WALLET_ID` | for Arc/x402 | Circle wallet ID for the validator (set by register-agent script) |
| `COINGECKO_API_KEY` | no | CoinGecko API key (free tier works without one) |
| `TWITTER_BEARER_TOKEN` | for Twitter | Twitter/X Bearer Token |
| `NEWS_API_KEY` | for News | NewsAPI.org key |
| `ETHERSCAN_API_KEY` | no | Etherscan API key (free fallback key used if absent) |
| `EXCHANGE_RATE_API_KEY` | no | ExchangeRate-API key (current endpoint does not require auth) |

## Adding a Connector

1. Create `src/connectors/yourname.ts` extending `BaseConnector` from `./base.js`.
2. Implement `execute(action, params)` with a switch on `action`.
3. Use `this.timed()`, `this.success()`, and `this.failure()` helpers from the base class.
4. Import and register the connector in `src/connectors/registry.ts`.
5. Add the action names to the `actionMap` in `registry.ts` so the planner knows about them.

## Development

```bash
npm run dev          # Start with hot reload (tsx --env-file=.env)
npm run build        # Compile TypeScript to dist/
npm start            # Run compiled output
npm test             # Run Vitest test suite
npm run register-agent  # One-time Arc identity registration
```

## License

MIT
