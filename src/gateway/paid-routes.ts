import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { createGatewayMiddleware } from "@circle-fin/x402-batching/server";
import { config } from "../config/env.js";
import { isX402Configured, getX402WalletAddress } from "../payments/x402.js";

// The Circle Developer-Controlled Wallet that RECEIVES payment for self-hosted endpoints.
// This must be DIFFERENT from the X402_PRIVATE_KEY buyer wallet.
// Address from the registered Arc agent wallet (ARC_AGENT_WALLET_ID).
const SELLER_ADDRESS = "0x149bee97a912268de2ea424e6f432623ad3f59ab";

// 0.001 USDC (passed as a decimal string to Circle's middleware)
const PAYMENT_AMOUNT_DISPLAY = "0.001";

// Arc Testnet in CAIP-2 format
const ARC_TESTNET_NETWORK = "eip155:5042002";

/**
 * Runs Circle's Gateway middleware against the raw Fastify req/res.
 * Returns true if the payment is verified and the route should continue.
 * Returns false if the middleware already sent a 402 (reply.raw.writableEnded).
 */
async function requireNanopayment(
  request: FastifyRequest,
  reply: FastifyReply,
  description: string,
): Promise<boolean> {
  const sellerAddress = SELLER_ADDRESS;
  const buyerAddress = getX402WalletAddress() ?? "(no buyer wallet)";
  console.log(`[paid-routes] sellerAddress (receives): ${sellerAddress}`);
  console.log(`[paid-routes] buyerAddress  (pays):     ${buyerAddress}`);
  if (sellerAddress.toLowerCase() === buyerAddress.toLowerCase()) {
    console.error("[paid-routes] BUG: seller and buyer are the same address — Gateway will reject");
  }

  const gatewayMiddleware = createGatewayMiddleware({
    sellerAddress,
    networks: ARC_TESTNET_NETWORK,
    description,
  });

  const priceMiddleware = gatewayMiddleware.require(PAYMENT_AMOUNT_DISPLAY);

  let middlewareError: unknown = undefined;
  const paymentVerified = await new Promise<boolean>((resolve) => {
    priceMiddleware(
      request.raw as Parameters<typeof priceMiddleware>[0],
      reply.raw as Parameters<typeof priceMiddleware>[1],
      (err?: unknown) => {
        if (err) {
          middlewareError = err;
          console.error("[paid-routes] Gateway middleware rejected payment:", err);
        }
        resolve(!err);
      },
    );
  });

  if (reply.raw.writableEnded) {
    await reply.hijack();
    return false;
  }

  if (!paymentVerified) {
    const reason = middlewareError instanceof Error ? middlewareError.message : String(middlewareError ?? "unknown");
    console.error(`[paid-routes] Payment verification failed — reason: ${reason}`);
    await reply.status(402).send({ error: "Nanopayment verification failed", reason });
    return false;
  }

  return true;
}

/**
 * Mock premium market intelligence data.
 */
function buildMarketIntel(): Record<string, unknown> {
  return {
    source: "archie-premium",
    generatedAt: new Date().toISOString(),
    payment: {
      amount: PAYMENT_AMOUNT_DISPLAY,
      currency: "USDC",
      network: "arc-testnet",
      protocol: "x402",
    },
    prices: {
      bitcoin:  { usd: 97_420,  change24h: 2.1  },
      ethereum: { usd: 3_812,   change24h: 1.7  },
      solana:   { usd: 183,     change24h: -0.5 },
    },
    marketOverview: {
      fearGreedIndex: { value: 72, label: "Greed" },
      btcDominance:   { percentage: 54.2 },
      totalMarketCap: { usd: 3_480_000_000_000 },
      total24hVolume: { usd: 124_000_000_000   },
    },
    topMovers: [
      { symbol: "WIF",  change24h: 18.4  },
      { symbol: "PEPE", change24h: -12.1 },
      { symbol: "JTO",  change24h: 9.6   },
    ],
  };
}

/**
 * Mock deep wallet analysis data.
 */
function buildWalletAnalysis(address: string): Record<string, unknown> {
  return {
    source: "archie-premium",
    generatedAt: new Date().toISOString(),
    address,
    portfolioValue: { usd: 48_320.55 },
    activityScore: 87,
    riskRating: "medium",
    topHoldings: [
      { symbol: "ETH",  name: "Ethereum",  balanceUsd: 31_200.00, allocation: 64.6 },
      { symbol: "USDC", name: "USD Coin",  balanceUsd: 10_000.00, allocation: 20.7 },
      { symbol: "ARB",  name: "Arbitrum",  balanceUsd:  4_120.55, allocation:  8.5 },
      { symbol: "LINK", name: "Chainlink", balanceUsd:  3_000.00, allocation:  6.2 },
    ],
    activitySummary: {
      totalTransactions: 342,
      last30DaysTxCount: 28,
      avgTxValueUsd: 1_240,
      firstSeenDaysAgo: 890,
    },
    riskFactors: [
      { factor: "interacts with unverified contracts", severity: "medium" },
      { factor: "low diversification (64% ETH)", severity: "low" },
    ],
  };
}

/**
 * Mock trend report data.
 */
function buildTrendReport(topic: string): Record<string, unknown> {
  return {
    source: "archie-premium",
    generatedAt: new Date().toISOString(),
    topic,
    sentiment: { score: 0.68, label: "bullish" },
    momentum: { score: 0.74, label: "strong" },
    signals: [
      { type: "social_spike",    description: `${topic} mentions up 34% in the last 24h` },
      { type: "developer_activity", description: "GitHub commits increased 18% week-over-week" },
      { type: "whale_accumulation", description: "Large wallet inflows detected in last 6h" },
    ],
    keyMentions: [
      { source: "twitter", content: `${topic} is positioned for a breakout according to on-chain data` },
      { source: "reddit",  content: `Long-term holders not selling — strong ${topic} conviction` },
      { source: "news",    content: `Institutional interest in ${topic} hits 6-month high` },
    ],
    priceContext: {
      currentTrend: "uptrend",
      support: "strong",
      resistanceLevels: ["short-term", "medium-term"],
    },
  };
}

export async function registerPaidRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /paid/market-intel
   *
   * Circle Nanopayments-protected endpoint (x402 protocol).
   * Settlement on Arc Testnet via Circle Gateway.
   */
  app.get("/paid/market-intel", async (request, reply) => {
    const ok = await requireNanopayment(
      request,
      reply,
      "Premium market intelligence: top crypto prices, fear & greed index, BTC dominance",
    );
    if (!ok) return;
    console.log(`[paid-routes] Circle Nanopayment verified — delivering market intel`);
    return reply.status(200).send(buildMarketIntel());
  });

  /**
   * GET /paid/wallet-analysis?address=0x...
   *
   * Deep wallet analysis: portfolio value, top holdings, activity score, risk rating.
   */
  app.get("/paid/wallet-analysis", async (request, reply) => {
    const ok = await requireNanopayment(
      request,
      reply,
      "Deep wallet analysis: portfolio value, top holdings, activity score, risk rating",
    );
    if (!ok) return;
    const query = request.query as Record<string, string>;
    const address = query.address ?? "";
    console.log(`[paid-routes] Circle Nanopayment verified — delivering wallet analysis for ${address}`);
    return reply.status(200).send(buildWalletAnalysis(address));
  });

  /**
   * GET /paid/trend-report?topic=ethereum
   *
   * Trend analysis: sentiment, momentum, key mentions, signals.
   */
  app.get("/paid/trend-report", async (request, reply) => {
    const ok = await requireNanopayment(
      request,
      reply,
      "Trend analysis: sentiment score, momentum, social signals, key mentions",
    );
    if (!ok) return;
    const query = request.query as Record<string, string>;
    const topic = query.topic ?? "ethereum";
    console.log(`[paid-routes] Circle Nanopayment verified — delivering trend report for ${topic}`);
    return reply.status(200).send(buildTrendReport(topic));
  });
}
