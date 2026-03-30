import type { FastifyInstance } from "fastify";
import { getAddress, recoverTypedDataAddress } from "viem";
import { config } from "../config/env.js";
import { isX402Configured, getX402WalletAddress } from "../payments/x402.js";

// USDC on Base Sepolia (canonical Circle-deployed testnet USDC)
const USDC_BASE_SEPOLIA = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
// 0.001 USDC (6 decimals)
const PAYMENT_AMOUNT = "1000";
const PAYMENT_AMOUNT_DISPLAY = "0.001";
const BASE_SEPOLIA_CHAIN_ID = 84532;

const EIP3009_TYPES = {
  TransferWithAuthorization: [
    { name: "from",        type: "address" },
    { name: "to",          type: "address" },
    { name: "value",       type: "uint256" },
    { name: "validAfter",  type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce",       type: "bytes32" },
  ],
} as const;

function buildPaymentRequired(payTo: string, resource: string): Record<string, unknown> {
  return {
    x402Version: 1,
    error: "Payment Required",
    accepts: [
      {
        scheme: "exact",
        network: config.x402Network,
        maxAmountRequired: PAYMENT_AMOUNT,
        resource,
        description: "Premium market intelligence: top crypto prices, fear & greed index, BTC dominance",
        mimeType: "application/json",
        payTo,
        maxTimeoutSeconds: 300,
        asset: USDC_BASE_SEPOLIA,
        extra: {
          name: "USD Coin",
          version: "2",
        },
      },
    ],
  };
}

function safeBase64Encode(data: string): string {
  return Buffer.from(data, "utf8").toString("base64");
}

function safeBase64Decode(data: string): string {
  return Buffer.from(data, "base64").toString("utf-8");
}

/**
 * Verify an EIP-3009 transferWithAuthorization signature without hitting the blockchain.
 * Returns the signer address if valid, throws if invalid.
 */
async function verifyEip3009Signature(payload: {
  authorization: {
    from: string;
    to: string;
    value: string;
    validAfter: string;
    validBefore: string;
    nonce: string;
  };
  signature: `0x${string}`;
}): Promise<string> {
  const { authorization, signature } = payload;
  const now = Math.floor(Date.now() / 1000);

  const validAfter = BigInt(authorization.validAfter);
  const validBefore = BigInt(authorization.validBefore);

  if (BigInt(now) <= validAfter) {
    throw new Error("Payment authorization is not yet valid");
  }
  if (BigInt(now) >= validBefore) {
    throw new Error("Payment authorization has expired");
  }

  const domain = {
    name: "USD Coin",
    version: "2",
    chainId: BASE_SEPOLIA_CHAIN_ID,
    verifyingContract: getAddress(USDC_BASE_SEPOLIA),
  } as const;

  const message = {
    from:        getAddress(authorization.from),
    to:          getAddress(authorization.to),
    value:       BigInt(authorization.value),
    validAfter:  validAfter,
    validBefore: validBefore,
    nonce:       authorization.nonce as `0x${string}`,
  };

  // Recover the signer address from the signature — if it matches `from`, the signature is valid.
  const signer = await recoverTypedDataAddress({
    domain,
    types: EIP3009_TYPES,
    primaryType: "TransferWithAuthorization",
    message,
    signature,
  });

  const claimedFrom = getAddress(authorization.from);
  if (signer.toLowerCase() !== claimedFrom.toLowerCase()) {
    throw new Error(`Signature mismatch: claimed from=${claimedFrom}, recovered signer=${signer}`);
  }

  return signer;
}

/**
 * Mock premium market intelligence data.
 * In production, this would call real APIs (CoinGecko Pro, etc.)
 * The x402 payment gate ensures only paying callers get this data.
 */
function buildMarketIntel(): Record<string, unknown> {
  return {
    source: "archie-premium",
    generatedAt: new Date().toISOString(),
    payment: {
      amount: PAYMENT_AMOUNT_DISPLAY,
      currency: "USDC",
      network: "base-sepolia",
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
   * x402-protected endpoint. Returns premium market intelligence data
   * in exchange for a 0.001 USDC payment authorization (EIP-3009).
   *
   * If X-PAYMENT header is absent → 402 with PAYMENT-REQUIRED header.
   * If X-PAYMENT header is present and valid → 200 with market data.
   */
  app.get("/paid/market-intel", async (request, reply) => {
    const resource = `http://localhost:${config.port}/paid/market-intel`;

    // Determine the payment recipient — use x402 wallet address if configured,
    // otherwise fall back to a placeholder so the route still works for testing.
    const recipientAddress =
      isX402Configured() ? (getX402WalletAddress() ?? "0x0000000000000000000000000000000000000000")
                         : "0x0000000000000000000000000000000000000000";

    const paymentRequired = buildPaymentRequired(recipientAddress, resource);
    const encodedPaymentRequired = safeBase64Encode(JSON.stringify(paymentRequired));

    // ── No payment header → 402 ──────────────────────────────────────────────
    const xPaymentHeader = request.headers["x-payment"];
    if (!xPaymentHeader || typeof xPaymentHeader !== "string") {
      return reply
        .status(402)
        .headers({
          "payment-required": encodedPaymentRequired,
          "content-type": "application/json",
          "access-control-expose-headers": "payment-required",
        })
        .send(paymentRequired);
    }

    // ── Verify payment ────────────────────────────────────────────────────────
    try {
      const decoded = JSON.parse(safeBase64Decode(xPaymentHeader)) as Record<string, unknown>;
      const payload = decoded.payload as { authorization: Record<string, string>; signature: `0x${string}` } | undefined;

      if (!payload?.authorization || !payload?.signature) {
        throw new Error("Malformed X-PAYMENT header: missing authorization or signature");
      }

      const authorizationValue = BigInt(payload.authorization.value ?? "0");
      if (authorizationValue < BigInt(PAYMENT_AMOUNT)) {
        throw new Error(
          `Payment amount too low: got ${authorizationValue}, required ${PAYMENT_AMOUNT} (${PAYMENT_AMOUNT_DISPLAY} USDC)`,
        );
      }

      const signerAddress = await verifyEip3009Signature({
        authorization: payload.authorization as Parameters<typeof verifyEip3009Signature>[0]["authorization"],
        signature: payload.signature,
      });

      console.log(
        `[paid-routes] x402 payment verified — signer: ${signerAddress} amount: ${PAYMENT_AMOUNT_DISPLAY} USDC`,
      );

      const data = buildMarketIntel();

      return reply
        .status(200)
        .headers({ "x-payment-response": safeBase64Encode(JSON.stringify({ success: true, network: config.x402Network })) })
        .send(data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[paid-routes] payment verification failed: ${msg}`);

      return reply
        .status(402)
        .headers({
          "payment-required": encodedPaymentRequired,
          "content-type": "application/json",
        })
        .send({ ...paymentRequired, error: `Payment verification failed: ${msg}` });
    }
  });
}
