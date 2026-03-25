/**
 * MetricsCollector tests.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { metrics } from "../src/observability/metrics.js";
import type { AgentResponse } from "../src/types/index.js";

function makeResponse(
  overrides: Partial<AgentResponse> = {},
): AgentResponse {
  return {
    requestId: "test-id",
    status: "success",
    data: {},
    meta: { sources: ["crypto"], cached: false, latencyMs: 100 },
    ...overrides,
  };
}

beforeEach(() => {
  metrics.reset();
});

describe("MetricsCollector.record", () => {
  it("increments total request count", () => {
    metrics.record(makeResponse());
    metrics.record(makeResponse());
    expect(metrics.snapshot().requests.total).toBe(2);
  });

  it("tracks success/partial/error counts separately", () => {
    metrics.record(makeResponse({ status: "success" }));
    metrics.record(makeResponse({ status: "partial" }));
    metrics.record(makeResponse({ status: "error" }));

    const { requests } = metrics.snapshot();
    expect(requests.success).toBe(1);
    expect(requests.partial).toBe(1);
    expect(requests.error).toBe(1);
    expect(requests.total).toBe(3);
  });

  it("tracks latency min/max/avg", () => {
    metrics.record(makeResponse({ meta: { sources: [], cached: false, latencyMs: 50 } }));
    metrics.record(makeResponse({ meta: { sources: [], cached: false, latencyMs: 150 } }));

    const { latency_ms } = metrics.snapshot();
    expect(latency_ms.min).toBe(50);
    expect(latency_ms.max).toBe(150);
    expect(latency_ms.avg).toBe(100);
    expect(latency_ms.count).toBe(2);
  });

  it("tracks cache hit/miss counts", () => {
    metrics.record(makeResponse({ meta: { sources: ["crypto"], cached: true, latencyMs: 5 } }));
    metrics.record(makeResponse({ meta: { sources: ["crypto"], cached: false, latencyMs: 100 } }));

    const { cache } = metrics.snapshot();
    expect(cache.hits).toBe(1);
    expect(cache.misses).toBe(1);
    expect(cache.hit_rate).toBe(0.5);
  });

  it("tracks per-connector call counts from sources", () => {
    metrics.record(makeResponse({ meta: { sources: ["crypto", "forex"], cached: false, latencyMs: 100 } }));

    const { connectors } = metrics.snapshot();
    expect(connectors["crypto"].calls).toBe(1);
    expect(connectors["forex"].calls).toBe(1);
  });

  it("tracks connector errors from data keys", () => {
    metrics.record(
      makeResponse({
        status: "partial",
        data: { crypto: { usd: 1 }, forex_error: "timeout" },
        meta: { sources: ["crypto"], cached: false, latencyMs: 300 },
      }),
    );

    const { connectors } = metrics.snapshot();
    expect(connectors["forex"]?.errors).toBe(1);
    expect(connectors["crypto"].calls).toBe(1);
  });
});

describe("MetricsCollector.snapshot", () => {
  it("returns zeroes on a fresh (reset) collector", () => {
    const snap = metrics.snapshot();
    expect(snap.requests.total).toBe(0);
    expect(snap.latency_ms.count).toBe(0);
    expect(snap.latency_ms.avg).toBe(0);
    expect(snap.latency_ms.min).toBe(0);
    expect(snap.latency_ms.max).toBe(0);
    expect(snap.cache.hit_rate).toBe(0);
  });

  it("computes p50/p95/p99 percentiles", () => {
    // Insert 100 latency samples: 1..100 ms
    for (let i = 1; i <= 100; i++) {
      metrics.record(makeResponse({ meta: { sources: [], cached: false, latencyMs: i } }));
    }

    const { latency_ms } = metrics.snapshot();
    // p50 should be near 50, p95 near 95, p99 near 99
    expect(latency_ms.p50).toBeGreaterThanOrEqual(49);
    expect(latency_ms.p50).toBeLessThanOrEqual(51);
    expect(latency_ms.p95).toBeGreaterThanOrEqual(94);
    expect(latency_ms.p95).toBeLessThanOrEqual(96);
    expect(latency_ms.p99).toBeGreaterThanOrEqual(98);
    expect(latency_ms.p99).toBeLessThanOrEqual(100);
  });

  it("includes uptime_seconds as a non-negative number", () => {
    const snap = metrics.snapshot();
    expect(snap.uptime_seconds).toBeGreaterThanOrEqual(0);
  });
});

describe("MetricsCollector.reset", () => {
  it("resets all counters to zero", () => {
    metrics.record(makeResponse());
    metrics.reset();
    const snap = metrics.snapshot();
    expect(snap.requests.total).toBe(0);
    expect(snap.latency_ms.count).toBe(0);
  });
});
