# Archie — Technical Documentation

## System Architecture

Archie is a single-process Node.js service. There is no separate worker or database process in the current implementation. All state is in-process (in-memory cache). The modules and their responsibilities:

| Module | Path | Responsibility |
|--------|------|----------------|
| Server | `src/index.ts` | Fastify bootstrap, plugin registration, startup |
| Config | `src/config/env.ts` | Environment variable loading and validation |
| Router | `src/gateway/router.ts` | HTTP route definitions and per-route rate limits |
| Orchestrator | `src/orchestrator/orchestrator.ts` | Request lifecycle: plan → dispatch → merge → respond |
| Planner | `src/orchestrator/planner.ts` | Groq LLM call: intent extraction and tool selection |
| Connectors | `src/connectors/` | Isolated API adapters (one file per API) |
| Registry | `src/connectors/registry.ts` | Connector discovery and tool descriptions for the planner |
| Base connector | `src/connectors/base.ts` | Shared HTTP client, timing helpers, error normalization |
| Cache | `src/cache/cache.ts` | In-memory TTL cache with size cap and periodic eviction |
| x402 | `src/payments/x402.ts` | Circle wallet management and x402 payment detection |
| Arc identity | `src/identity/arc.ts` | ERC-8004 registration and reputation events on Arc Testnet |
| Types | `src/types/index.ts` | Shared TypeScript interfaces |

## Request Lifecycle

1. A request arrives at `POST /agent` or `GET /ask`.
2. The router validates the query: non-empty string, 500 character maximum. This happens synchronously before any async work.
3. `handleRequest()` in the orchestrator is called with the sanitized query.
4. The orchestrator calls `plan()` in the planner, which sends the query to Groq with a system prompt listing available connectors and actions. The Groq model returns a JSON object with `intent`, `tools`, and `confidence`.
5. If confidence is below 0.3, or no tools are returned, the orchestrator returns an error response immediately.
6. All connector calls are dispatched in parallel with `Promise.all`. For each tool call:
   a. Check the in-memory cache using a deterministic key (connector:action:sorted-params).
   b. On a cache hit, return the cached result.
   c. On a cache miss, call the connector's `execute()` method. Retry up to 2 times with exponential backoff (500ms, 1000ms) on failure.
   d. On success, write the result to cache with the connector's configured TTL.
7. A forex post-processing step runs: if the planner returned both a crypto and forex tool but left the forex amount null, the orchestrator re-runs the forex convert using the USD price from the crypto result. This handles queries like "BTC price in naira" where the LLM doesn't know the BTC price when constructing the plan.
8. Results are merged. If all connectors failed, a structured error with individual error messages is returned. Otherwise, successful results are keyed by connector name; errors are included as `{connector}_error` keys.
9. The response envelope is constructed and returned to the caller.

## Planner Prompt Design

The planner receives a fixed system prompt with `{TOOLS}` replaced by a human-readable list of connector names, descriptions, actions, and cost tiers. It is instructed to respond only with a JSON object (enforced by `response_format: { type: "json_object" }`). API credentials never appear in the system prompt or the user message — the planner only knows connector names and action signatures.

User input is sanitized before being sent to Groq: truncated to 500 characters and stripped of newlines/carriage returns to prevent prompt injection through multi-line content.

The planner uses `temperature: 0.1` to keep tool selection deterministic. `max_tokens: 500` is sufficient for any valid plan.

If the Groq API call fails for any reason (network error, rate limit, model error), the planner returns `{ intent: "error", tools: [], confidence: 0 }`. The orchestrator checks confidence < 0.3 and returns a user-friendly error.

## Cache Strategy

The cache is an in-memory `Map<string, CacheEntry>`. Cache keys are deterministic: `{connector}:{action}:{sorted-param-pairs}`. Sorting params ensures that `{ coins: "bitcoin", currencies: "usd" }` and `{ currencies: "usd", coins: "bitcoin" }` produce the same key.

TTLs are set per connector based on data freshness requirements:
- Crypto prices: 30 seconds
- Blockchain data: 30 seconds
- News: 120 seconds
- Twitter: 60 seconds
- Forex rates: 300 seconds

The cache is capped at 1000 entries. When inserting a new entry that would exceed the cap, the oldest entry (by insertion order, since `Map` preserves insertion order) is evicted. A cleanup interval runs every 5 minutes to sweep expired entries.

## Error Handling Strategy

Errors are handled at every boundary:

- **Connector level**: Every connector wraps its HTTP call in try/catch and uses `this.normalizeError()` to extract a readable message from axios errors or generic errors. Connectors return a `ConnectorResult` with `success: false` and an `error` string rather than throwing.
- **Orchestrator level**: Each connector call is isolated in a `Promise.all` callback. An uncaught exception from a connector is caught by the retry loop's catch block. If all retries are exhausted, a failure result is returned. If every single connector fails, the orchestrator returns a top-level error response listing all individual failures.
- **Planner level**: The Groq call is wrapped in try/catch. Failures return a zero-confidence empty plan.
- **Router level**: Async route handlers propagate errors to Fastify's default error handler through the promise chain. Validation (empty query, too long) returns early with a 400 before any async work.
- **Startup level**: `initWallet()` is called with `.catch()` so a Circle credential failure never crashes the server.

## Arc Onchain Identity

ERC-8004 is a standard for onchain AI agent identity on Arc. Two registries are used:

- `IdentityRegistry` at `0x8004A818BFB912233c491871b3d84c89A494BD9e`: mints an NFT per agent. Archie calls `register(string metadataUri)` with an IPFS URI. The emitted `Transfer` event contains the `tokenId` (agentId).
- `ReputationRegistry` at `0x8004B663056A597Dffe9eCcC1965A193B7388713`: records `giveFeedback(uint256 agentId, int256 score, string tag)` calls from a validator wallet.

All on-chain transactions go through Circle's developer-controlled wallets SDK. The `createContractExecutionTransaction` method submits a transaction from a managed wallet; `getTransaction` is polled until the transaction reaches a terminal state (COMPLETE, FAILED, CANCELLED, DENIED). viem's `getTransactionReceipt` and `getLogs` are used to extract the minted agentId from the Transfer event.

The Arc identity flow is entirely out of the hot path. Registration happens once via the `register-agent.ts` script. Reputation events, when implemented, would be enqueued and written asynchronously after each successful request.

## x402 Payment Flow

x402 is a micropayment protocol that uses HTTP 402 responses to signal that an API requires payment. The `handleX402Payment` function in `src/payments/x402.ts` detects a 402 status code, extracts payment details from `x-payment-details`, `x-payment-amount`, and `x-payment-currency` headers, and logs the payment requirement.

Full EIP-3009 authorization signing (which would authorize a USDC transfer from the Circle agent wallet) is not yet implemented. The function currently returns `paid: false`. This will be wired up when a connector using a paid API (e.g., Twitter Enterprise, premium data providers) is added.

## Security Model

- **API keys never reach the LLM.** The planner system prompt contains only connector names, descriptions, and action names. Credentials are only accessed inside connector `execute()` methods on the server.
- **User input is sanitized** before being passed to Groq: 500-char truncation and newline stripping prevent prompt injection.
- **Rate limiting** is applied globally (60 req/min) and additionally on `POST /agent` (20 req/min per IP), which is the expensive endpoint invoking Groq and external APIs.
- **Connector isolation**: each connector's HTTP client is separate. A network error or timeout in one connector does not affect others.
- **No secrets in logs.** Console output from connectors contains API response data and error messages, but never raw credentials. The config object holding keys is never serialized to output.
