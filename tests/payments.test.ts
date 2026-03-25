/**
 * x402 payment handler tests.
 *
 * The Circle SDK is mocked so tests run fully offline.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { isPaymentRequired, handleX402Payment } from "../src/payments/x402.js";

// The x402 module calls Circle's SDK only from initWallet / getWalletBalance
// which require credentials. handleX402Payment is pure logic so no mock needed.

beforeEach(() => {
  vi.clearAllMocks();
});

describe("isPaymentRequired", () => {
  it("returns true for status 402", () => {
    expect(isPaymentRequired(402)).toBe(true);
  });

  it("returns false for status 200", () => {
    expect(isPaymentRequired(200)).toBe(false);
  });

  it("returns false for status 401", () => {
    expect(isPaymentRequired(401)).toBe(false);
  });

  it("returns false for status 500", () => {
    expect(isPaymentRequired(500)).toBe(false);
  });
});

describe("handleX402Payment", () => {
  it("returns paid: false for non-402 status code", async () => {
    const event = await handleX402Payment("req-1", "twitter", 200, {});
    expect(event.paid).toBe(false);
    expect(event.txHash).toBeNull();
    expect(event.amount).toBe("0");
  });

  it("returns paid: false for 402 (no signing yet)", async () => {
    const event = await handleX402Payment("req-2", "twitter", 402, {
      "x-payment-amount": "0.001",
      "x-payment-currency": "USDC",
      "x-payment-details": "some-details",
    });
    expect(event.paid).toBe(false);
    expect(event.txHash).toBeNull();
    expect(event.connector).toBe("twitter");
    expect(event.requestId).toBe("req-2");
  });

  it("extracts amount and currency from payment headers", async () => {
    const event = await handleX402Payment("req-3", "news", 402, {
      "x-payment-amount": "0.05",
      "x-payment-currency": "USDC",
    });
    expect(event.amount).toBe("0.05");
    expect(event.currency).toBe("USDC");
  });

  it("defaults to USDC currency when header is absent", async () => {
    const event = await handleX402Payment("req-4", "news", 402, {});
    expect(event.currency).toBe("USDC");
    expect(event.amount).toBe("0");
  });

  it("includes a timestamp string", async () => {
    const event = await handleX402Payment("req-5", "twitter", 402, {});
    expect(typeof event.timestamp).toBe("string");
    expect(event.timestamp.length).toBeGreaterThan(0);
  });
});
