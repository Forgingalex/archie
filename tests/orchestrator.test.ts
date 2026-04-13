/**
 * Orchestrator tests.
 *
 * The orchestrator calls the Groq planner and external connectors, so we mock
 * both to keep the tests fast and offline-safe.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mock the planner ─────────────────────────────────────────────────────────
vi.mock("../src/orchestrator/planner.js", () => ({
  plan: vi.fn(),
}));

// ── Mock the connector registry ───────────────────────────────────────────────
vi.mock("../src/connectors/registry.js", () => {
  const mockConnector = {
    config: { name: "crypto", cacheTtlSeconds: 30, cost: "free" },
    execute: vi.fn(),
  };
  const map = new Map<string, typeof mockConnector>();
  map.set("crypto", mockConnector);
  return {
    registry: {
      get: (name: string) => map.get(name),
      list: () => [{ name: "crypto", description: "test", cost: "free" }],
      toolDescriptions: () => "- crypto: prices",
    },
  };
});

import { handleRequest } from "../src/orchestrator/orchestrator.js";
import { plan } from "../src/orchestrator/planner.js";
import { registry } from "../src/connectors/registry.js";
import { cache } from "../src/cache/cache.js";

const mockPlan = plan as ReturnType<typeof vi.fn>;
const mockCryptoConnector = registry.get("crypto") as { execute: ReturnType<typeof vi.fn> };

beforeEach(() => {
  // resetAllMocks clears both call history AND implementations so each test
  // starts with a clean slate.
  vi.resetAllMocks();
  // Clear the module-level cache so cached results from a previous test
  // cannot bleed through and mask a failing mock connector.
  cache.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("handleRequest — planner edge cases", () => {
  it("returns error when confidence is too low", async () => {
    mockPlan.mockResolvedValue({ intent: "unknown", tools: [], confidence: 0.1 });

    const result = await handleRequest("zzz gibberish");
    expect(result.status).toBe("error");
    expect(result.data.message).toMatch(/not confident/i);
  });

  it("returns success with intent as message when confidence >= 0.5 and no tools", async () => {
    mockPlan.mockResolvedValue({ intent: "Hi! I'm Archie, an AI agent on Arc Network.", tools: [], confidence: 0.9 });

    const result = await handleRequest("who are you");
    expect(result.status).toBe("success");
    expect(result.data.message).toBe("Hi! I'm Archie, an AI agent on Arc Network.");
  });

  it("returns error when confidence is between 0.3 and 0.5 and no tools", async () => {
    mockPlan.mockResolvedValue({ intent: "ambiguous request", tools: [], confidence: 0.4 });

    const result = await handleRequest("something unclear");
    expect(result.status).toBe("error");
    expect(result.data.message).toMatch(/not sure/i);
  });

  it("includes requestId and latencyMs in every response", async () => {
    mockPlan.mockResolvedValue({ intent: "unknown", tools: [], confidence: 0.1 });

    const result = await handleRequest("test");
    expect(typeof result.requestId).toBe("string");
    expect(result.requestId.length).toBeGreaterThan(0);
    expect(typeof result.meta.latencyMs).toBe("number");
  });
});

describe("handleRequest — connector execution", () => {
  it("returns success when connector succeeds", async () => {
    mockPlan.mockResolvedValue({
      intent: "get BTC price",
      tools: [{ connector: "crypto", action: "getPrice", params: { coins: "bitcoin" } }],
      confidence: 0.95,
    });
    mockCryptoConnector.execute.mockResolvedValue({
      connector: "crypto",
      success: true,
      data: { bitcoin: { usd: 50000 } },
      cached: false,
      latencyMs: 120,
    });

    const result = await handleRequest("what is the price of bitcoin?");
    expect(result.status).toBe("success");
    expect(result.data.crypto).toEqual({ bitcoin: { usd: 50000 } });
    expect(result.meta.sources).toContain("crypto");
  });

  it("returns error when all connectors fail", async () => {
    mockPlan.mockResolvedValue({
      intent: "get price",
      tools: [{ connector: "crypto", action: "getPrice", params: { coins: "bitcoin" } }],
      confidence: 0.9,
    });
    mockCryptoConnector.execute.mockRejectedValue(new Error("Network timeout"));

    const result = await handleRequest("BTC price");
    expect(result.status).toBe("error");
    expect(result.data.errors).toMatch(/crypto/);
  });

  it("returns error when connector result is not success", async () => {
    mockPlan.mockResolvedValue({
      intent: "get price",
      tools: [{ connector: "crypto", action: "getPrice", params: { coins: "bitcoin" } }],
      confidence: 0.9,
    });
    mockCryptoConnector.execute.mockResolvedValue({
      connector: "crypto",
      success: false,
      data: {},
      cached: false,
      latencyMs: 10,
      error: "Rate limited",
    });

    const result = await handleRequest("BTC price");
    expect(result.status).toBe("error");
  });

  it("returns error for unknown connector", async () => {
    mockPlan.mockResolvedValue({
      intent: "use nonexistent connector",
      tools: [{ connector: "nonexistent", action: "doSomething", params: {} }],
      confidence: 0.8,
    });

    const result = await handleRequest("use nonexistent connector");
    expect(result.status).toBe("error");
    expect(result.data.errors).toMatch(/nonexistent/i);
  });

  it("sets cached: true in meta when connector result is cached", async () => {
    mockPlan.mockResolvedValue({
      intent: "get BTC price",
      tools: [{ connector: "crypto", action: "getPrice", params: { coins: "bitcoin" } }],
      confidence: 0.95,
    });
    mockCryptoConnector.execute.mockResolvedValue({
      connector: "crypto",
      success: true,
      data: { bitcoin: { usd: 60000 } },
      cached: true,
      latencyMs: 2,
    });

    const result = await handleRequest("bitcoin price");
    expect(result.meta.cached).toBe(true);
  });
});
