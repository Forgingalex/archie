/**
 * Connector unit tests.
 *
 * All HTTP calls are intercepted with vi.mock so tests run fully offline.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import axios from "axios";

// Spy on axios.create so individual connector instances reuse the mock.
vi.mock("axios", async (importOriginal) => {
  const original = await importOriginal<typeof import("axios")>();
  const mockGet = vi.fn();
  const mockInstance = { get: mockGet, defaults: { headers: { common: {} } } };
  return {
    ...original,
    default: {
      ...original.default,
      create: vi.fn(() => mockInstance),
      isAxiosError: original.default.isAxiosError,
    },
  };
});

// Import connectors AFTER mocking axios.
import { CryptoConnector } from "../src/connectors/crypto.js";
import { ForexConnector } from "../src/connectors/forex.js";
import { NewsConnector } from "../src/connectors/news.js";
import { TwitterConnector } from "../src/connectors/twitter.js";
import { BlockchainConnector } from "../src/connectors/blockchain.js";

/** Helper to grab the mocked `get` function from a connector's http instance. */
function getMockGet(connector: { http: unknown }): ReturnType<typeof vi.fn> {
  return (connector as { http: { get: ReturnType<typeof vi.fn> } }).http.get;
}

// ── CryptoConnector ──────────────────────────────────────────────────────────

describe("CryptoConnector", () => {
  let crypto: CryptoConnector;
  let mockGet: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    crypto = new CryptoConnector();
    mockGet = getMockGet(crypto);
  });

  it("getPrice returns shaped price data", async () => {
    mockGet.mockResolvedValue({
      data: {
        bitcoin: { usd: 55000, usd_24h_change: 2.5, usd_market_cap: 1_000_000_000 },
      },
    });

    const result = await crypto.execute("getPrice", { coins: "bitcoin", currencies: "usd" });
    expect(result.success).toBe(true);
    expect(result.connector).toBe("crypto");
    expect((result.data.bitcoin as Record<string, unknown>).usd).toBe(55000);
  });

  it("getPrice defaults coins to 'bitcoin' when params are empty", async () => {
    mockGet.mockResolvedValue({ data: { bitcoin: { usd: 55000 } } });
    const result = await crypto.execute("getPrice", {});
    expect(result.success).toBe(true);
    expect(mockGet).toHaveBeenCalledWith(
      "/simple/price",
      expect.objectContaining({
        params: expect.objectContaining({ ids: "bitcoin" }),
      }),
    );
  });

  it("getMarketData returns normalized coin data", async () => {
    mockGet.mockResolvedValue({
      data: {
        name: "Bitcoin",
        symbol: "btc",
        market_data: {
          current_price: { usd: 55000 },
          market_cap: { usd: 1_000_000_000_000 },
          price_change_percentage_24h: 1.2,
          ath: { usd: 69000 },
          total_supply: 21_000_000,
        },
      },
    });

    const result = await crypto.execute("getMarketData", { coin: "bitcoin" });
    expect(result.success).toBe(true);
    expect(result.data.name).toBe("Bitcoin");
    expect(result.data.price_usd).toBe(55000);
  });

  it("search returns up to 5 coins", async () => {
    const coins = Array.from({ length: 10 }, (_, i) => ({
      id: `coin-${i}`,
      name: `Coin ${i}`,
      symbol: `C${i}`,
      market_cap_rank: i + 1,
    }));
    mockGet.mockResolvedValue({ data: { coins } });

    const result = await crypto.execute("search", { query: "coin" });
    expect(result.success).toBe(true);
    expect((result.data.results as unknown[]).length).toBeLessThanOrEqual(5);
  });

  it("search returns error when query param is missing", async () => {
    const result = await crypto.execute("search", {});
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Missing query/);
  });

  it("returns failure for unknown action", async () => {
    const result = await crypto.execute("unknownAction", {});
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Unknown action/);
  });

  it("returns failure on network error", async () => {
    mockGet.mockRejectedValue(new Error("Network Error"));
    const result = await crypto.execute("getPrice", { coins: "bitcoin" });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Network Error/);
  });
});

// ── ForexConnector ───────────────────────────────────────────────────────────

describe("ForexConnector", () => {
  let forex: ForexConnector;
  let mockGet: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    forex = new ForexConnector();
    mockGet = getMockGet(forex);
  });

  it("getRates returns rates for the base currency", async () => {
    mockGet.mockResolvedValue({
      data: {
        result: "success",
        rates: { EUR: 0.92, NGN: 1500 },
        time_last_update_utc: "2024-01-01",
      },
    });

    const result = await forex.execute("getRates", { base: "USD" });
    expect(result.success).toBe(true);
    expect(result.data.base).toBe("USD");
    expect((result.data.rates as Record<string, number>).EUR).toBe(0.92);
  });

  it("getRates filters to requested targets", async () => {
    mockGet.mockResolvedValue({
      data: {
        result: "success",
        rates: { EUR: 0.92, GBP: 0.79, NGN: 1500 },
        time_last_update_utc: "2024-01-01",
      },
    });

    const result = await forex.execute("getRates", { base: "USD", targets: "EUR,GBP" });
    expect(result.success).toBe(true);
    const rates = result.data.rates as Record<string, number>;
    expect(Object.keys(rates)).toContain("EUR");
    expect(Object.keys(rates)).toContain("GBP");
    expect(Object.keys(rates)).not.toContain("NGN");
  });

  it("convert returns computed result", async () => {
    mockGet.mockResolvedValue({
      data: { result: "success", rates: { NGN: 1500 } },
    });

    const result = await forex.execute("convert", { from: "USD", to: "NGN", amount: 10 });
    expect(result.success).toBe(true);
    expect(result.data.result).toBe(15000);
    expect(result.data.rate).toBe(1500);
  });

  it("convert handles NaN amount gracefully", async () => {
    mockGet.mockResolvedValue({
      data: { result: "success", rates: { NGN: 1500 } },
    });

    const result = await forex.execute("convert", { from: "USD", to: "NGN", amount: "null" });
    expect(result.success).toBe(true);
    // result should be NaN when amount is NaN — no crash
    expect(Number.isNaN(result.data.result)).toBe(true);
  });

  it("getRates returns failure on API error response", async () => {
    mockGet.mockResolvedValue({
      data: { result: "error", "error-type": "unsupported-code" },
    });

    const result = await forex.execute("getRates", { base: "XYZ" });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/unsupported-code/);
  });

  it("convert returns failure when target currency not found", async () => {
    mockGet.mockResolvedValue({
      data: { result: "success", rates: { EUR: 0.92 } },
    });

    const result = await forex.execute("convert", { from: "USD", to: "FAKE", amount: 100 });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/FAKE/);
  });

  it("returns failure for unknown action", async () => {
    const result = await forex.execute("badAction", {});
    expect(result.success).toBe(false);
  });
});

// ── NewsConnector ────────────────────────────────────────────────────────────

describe("NewsConnector", () => {
  let news: NewsConnector;
  let mockGet: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    // Temporarily inject a fake key so the key-guard passes.
    process.env.NEWS_API_KEY = "test-key";
    news = new NewsConnector();
    mockGet = getMockGet(news);
  });

  it("headlines returns shaped article list", async () => {
    mockGet.mockResolvedValue({
      data: {
        articles: [
          {
            title: "AI is huge",
            description: "Very big",
            source: { name: "TechCrunch" },
            url: "https://example.com/1",
            publishedAt: "2024-01-01T00:00:00Z",
          },
        ],
        totalResults: 1,
      },
    });

    const result = await news.execute("headlines", { category: "technology" });
    expect(result.success).toBe(true);
    expect((result.data.articles as unknown[]).length).toBe(1);
    expect((result.data.articles as Array<{ title: string }>)[0].title).toBe("AI is huge");
  });

  it("search returns articles matching query", async () => {
    mockGet.mockResolvedValue({
      data: {
        articles: [{ title: "BTC hits ATH", description: null, source: { name: "CoinDesk" }, url: "https://example.com/2", publishedAt: "2024-01-02T00:00:00Z" }],
        totalResults: 1,
      },
    });

    const result = await news.execute("search", { query: "bitcoin" });
    expect(result.success).toBe(true);
  });

  it("search returns failure for missing query", async () => {
    const result = await news.execute("search", {});
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Missing query/);
  });

  it("returns failure for unknown action", async () => {
    const result = await news.execute("badAction", {});
    expect(result.success).toBe(false);
  });
});

// ── TwitterConnector ─────────────────────────────────────────────────────────

describe("TwitterConnector", () => {
  let twitter: TwitterConnector;
  let mockGet: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    // Patch the config object directly — `as const` is a TypeScript-only
    // constraint; at runtime the object is mutable.
    const { config } = await import("../src/config/env.js");
    (config as Record<string, unknown>).twitterBearerToken = "test-bearer";
    twitter = new TwitterConnector();
    mockGet = getMockGet(twitter);
  });

  afterEach(async () => {
    const { config } = await import("../src/config/env.js");
    (config as Record<string, unknown>).twitterBearerToken = "";
  });

  it("search returns shaped tweet list", async () => {
    mockGet.mockResolvedValue({
      data: {
        data: [
          { id: "1", text: "Hello world", author_id: "user1", created_at: "2024-01-01T00:00:00Z" },
        ],
      },
    });

    const result = await twitter.execute("search", { query: "bitcoin" });
    expect(result.success).toBe(true);
    expect((result.data.tweets as unknown[]).length).toBe(1);
  });

  it("search returns failure when no query", async () => {
    const result = await twitter.execute("search", {});
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Missing query/);
  });

  it("userTweets returns shaped tweet list", async () => {
    mockGet.mockResolvedValue({
      data: { data: [{ id: "2", text: "My tweet", author_id: "user1", created_at: "2024-01-01T00:00:00Z" }] },
    });

    const result = await twitter.execute("userTweets", { userId: "user1" });
    expect(result.success).toBe(true);
  });

  it("userTweets returns failure when no userId", async () => {
    const result = await twitter.execute("userTweets", {});
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Missing userId/);
  });

  it("returns failure for unknown action", async () => {
    const result = await twitter.execute("badAction", {});
    expect(result.success).toBe(false);
  });
});

// ── BlockchainConnector ──────────────────────────────────────────────────────

describe("BlockchainConnector", () => {
  let blockchain: BlockchainConnector;
  let mockGet: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    blockchain = new BlockchainConnector();
    mockGet = getMockGet(blockchain);
  });

  it("getBalance returns ETH balance", async () => {
    mockGet.mockResolvedValue({
      data: { status: "1", result: "1000000000000000000" }, // 1 ETH in wei
    });

    const result = await blockchain.execute("getBalance", {
      address: "0x742d35Cc6634C0532925a3b844Bc454e4438f44e",
    });
    expect(result.success).toBe(true);
    expect(result.data.balance_eth).toBe(1);
  });

  it("getBalance returns failure for missing address", async () => {
    const result = await blockchain.execute("getBalance", {});
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Missing address/);
  });

  it("getBalance returns failure when etherscan status is not 1", async () => {
    mockGet.mockResolvedValue({
      data: { status: "0", message: "Invalid address format" },
    });

    const result = await blockchain.execute("getBalance", { address: "bad" });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Invalid address format/);
  });

  it("getTransactions returns shaped tx list", async () => {
    mockGet.mockResolvedValue({
      data: {
        status: "1",
        result: [
          { hash: "0xabc", from: "0x1", to: "0x2", value: "1000000000000000000", timeStamp: "1700000000" },
        ],
      },
    });

    const result = await blockchain.execute("getTransactions", {
      address: "0x742d35Cc6634C0532925a3b844Bc454e4438f44e",
    });
    expect(result.success).toBe(true);
    expect((result.data.transactions as unknown[]).length).toBe(1);
    expect((result.data.transactions as Array<{ value_eth: number }>)[0].value_eth).toBe(1);
  });

  it("getTransactions returns failure for missing address", async () => {
    const result = await blockchain.execute("getTransactions", {});
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Missing address/);
  });

  it("returns failure for unknown action", async () => {
    const result = await blockchain.execute("unknownAction", {});
    expect(result.success).toBe(false);
  });
});
