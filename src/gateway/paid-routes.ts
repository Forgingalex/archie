import type { FastifyInstance } from "fastify";
import { createGatewayMiddleware } from "@circle-fin/x402-batching/server";
import { config } from "../config/env.js";
import { isX402Configured, getX402WalletAddress } from "../payments/x402.js";

// The Circle Developer-Controlled Wallet that RECEIVES payment for self-hosted endpoints.
// This must be DIFFERENT from the X402_PRIVATE_KEY buyer wallet.
// Address from the registered Arc agent wallet (ARC_AGENT_WALLET_ID).
const SELLER_ADDRESS = "0x149bee97a912268de2ea424e6f432623ad3f59ab";

// 0.001 USDC (passed as a decimal string to Circle's middleware)
const PAYMENT_AMOUNT_DISPLAY = "0.001";

/**
 * Mock premium market intelligence data.
 * In production, this would call real APIs (CoinGecko Pro, etc.)
 * The Nanopayment gate ensures only paying callers get this data.
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

export async function registerPaidRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /paid/market-intel
   *
   * Circle Nanopayments-protected endpoint (x402 protocol).
   * Settlement on Arc Testnet via Circle Gateway.
   *
   * If X-PAYMENT header is absent → 402 with PAYMENT-REQUIRED header.
   * If X-PAYMENT header is present and valid → 200 with market data.
   */
  app.get("/paid/market-intel", async (request, reply) => {
    // SELLER = Circle agent wallet (receives payment).
    // BUYER  = X402_PRIVATE_KEY EOA wallet (GatewayClient) — must be a different address.
    // Using the same address for both causes Gateway to reject the payment.
    const sellerAddress = SELLER_ADDRESS;
    const buyerAddress = getX402WalletAddress() ?? "(no buyer wallet)";
    console.log(`[paid-routes] sellerAddress (receives): ${sellerAddress}`);
    console.log(`[paid-routes] buyerAddress  (pays):     ${buyerAddress}`);
    if (sellerAddress.toLowerCase() === buyerAddress.toLowerCase()) {
      console.error("[paid-routes] BUG: seller and buyer are the same address — Gateway will reject");
    }

    // Circle's official Gateway middleware.
    // network "eip155:5042002" = Arc Testnet in CAIP-2 format.
    const gatewayMiddleware = createGatewayMiddleware({
      sellerAddress,
      networks: "eip155:5042002",
      description: "Premium market intelligence: top crypto prices, fear & greed index, BTC dominance",
    });

    // Bridge Circle's Express-style middleware to Fastify's raw Node.js req/res.
    // The middleware either:
    //   (a) sends a 402 directly on reply.raw and ends the socket, or
    //   (b) verifies the Nanopayment and calls next()
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

    // If the middleware already wrote the 402 response to reply.raw, tell
    // Fastify not to attempt a second send.
    if (reply.raw.writableEnded) {
      return reply.hijack();
    }

    if (!paymentVerified) {
      const reason = middlewareError instanceof Error ? middlewareError.message : String(middlewareError ?? "unknown");
      console.error(`[paid-routes] Payment verification failed — reason: ${reason}`);
      return reply.status(402).send({ error: "Nanopayment verification failed", reason });
    }

    console.log(`[paid-routes] Circle Nanopayment verified — delivering market intel`);
    return reply.status(200).send(buildMarketIntel());
  });
}
