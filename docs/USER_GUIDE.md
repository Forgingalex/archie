# Archie — User Guide

## What Archie Can Do

Archie understands plain English requests and calls the right APIs automatically. You don't need to know which API to use or how to format requests — just describe what you want.

### Cryptocurrency Prices

Get live prices, market data, and search for coins by name.

Example queries:
- "What is the current price of Bitcoin?"
- "Show me Ethereum and Solana prices in USD"
- "Get market data for Cardano including market cap and 24h change"
- "Search for coins named 'pepe'"

### Currency Conversion

Convert between any major currencies using live exchange rates.

Example queries:
- "Convert 500 USD to EUR"
- "What is 1000 Japanese yen in British pounds?"
- "Show me exchange rates from USD to NGN, GHS, and KES"

### Combined Crypto + FX

Ask for a crypto price converted to a local currency in one shot. Archie chains the two connectors automatically.

Example queries:
- "What is the Bitcoin price in Nigerian naira?"
- "How much is 1 ETH in South African rand?"

### News Headlines

Get the latest headlines by category or search for articles on a topic.

Example queries:
- "What are the top technology headlines today?"
- "Show me the latest business news"
- "Find news articles about artificial intelligence"
- "What's in the sports headlines?"

Available categories: business, technology, sports, entertainment, health, science.

### Twitter / X Data

Search recent tweets or get tweets from a specific user. Requires a Twitter Bearer Token configured by the operator.

Example queries:
- "Search Twitter for tweets about Ethereum"
- "Get recent tweets from user ID 123456"

### Blockchain Data

Look up Ethereum wallet balances and recent transactions via Etherscan.

Example queries:
- "What is the ETH balance of 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045?"
- "Show me the last 5 transactions for address 0x..."

## Using the Web Interface

Open `http://localhost:3000` in your browser (or the deployed URL). Type your question in the chat box and press Enter or click Send. The response appears as formatted JSON showing the data you requested along with metadata about which sources were used and how long the request took.

## Using the API Directly

Send a POST request to `/agent` with a JSON body:

```bash
curl -X POST http://localhost:3000/agent \
  -H "Content-Type: application/json" \
  -d '{"query": "BTC price in USD"}'
```

Or use the GET shorthand for quick queries:

```bash
curl "http://localhost:3000/ask?q=ethereum+price"
```

Queries must be between 1 and 500 characters.

## Response Format

Every response follows the same structure:

```json
{
  "requestId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "success",
  "data": {
    "crypto": {
      "bitcoin": {
        "usd": 67420,
        "usd_24h_change": 2.34,
        "usd_market_cap": 1327000000000
      }
    }
  },
  "meta": {
    "sources": ["crypto"],
    "cached": false,
    "latencyMs": 284
  }
}
```

The `status` field is one of:
- `"success"` — all requested connectors returned data
- `"partial"` — some connectors succeeded, others failed (both success data and error details are included)
- `"error"` — the request could not be completed

The `meta.cached` field indicates whether the result came from cache. Cached responses are much faster (sub-millisecond) and count against rate limits the same as live responses.

## Troubleshooting

**"I'm not confident I understand your request."**
The query was too vague or ambiguous. Try being more specific. For example, instead of "prices", say "Bitcoin price in USD".

**"I couldn't determine which APIs to call."**
The request doesn't clearly map to any available connector. Check the `/connectors` endpoint to see what's available, then rephrase.

**A connector returns an error like "NEWS_API_KEY not configured"**
The operator hasn't added the required API key for that connector. The other connectors will still work.

**Rate limit error (429)**
The `/agent` endpoint allows 20 requests per minute per IP. Wait a moment and try again. The `/ask` endpoint shares the global 60 requests per minute limit.

**Slow responses**
First requests to an API are always slower because data isn't cached yet. Repeat the same query within the cache TTL window (30 seconds to 5 minutes depending on the connector) and you'll see sub-millisecond latency in `meta.latencyMs`.
