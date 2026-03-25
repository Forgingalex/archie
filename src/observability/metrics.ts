import type { AgentResponse } from "../types/index.js";

/**
 * Lightweight in-process metrics collector.
 *
 * Tracks request counts, success/error rates, latency percentiles, and
 * per-connector usage counts — all in memory.  This is intentionally
 * simple: no external dependency, no persistence.  Replace with a proper
 * APM (Prometheus, Datadog, etc.) when the service reaches production scale.
 *
 * Expose via GET /metrics.
 */

interface LatencyBucket {
  count: number;
  sum: number;
  min: number;
  max: number;
}

interface ConnectorStat {
  calls: number;
  errors: number;
}

interface MetricsSnapshot {
  uptime_seconds: number;
  requests: {
    total: number;
    success: number;
    partial: number;
    error: number;
  };
  latency_ms: {
    count: number;
    avg: number;
    min: number;
    max: number;
    p50: number;
    p95: number;
    p99: number;
  };
  connectors: Record<string, ConnectorStat>;
  cache: {
    hits: number;
    misses: number;
    hit_rate: number;
  };
}

class MetricsCollector {
  private readonly startTime = Date.now();

  private total = 0;
  private successCount = 0;
  private partialCount = 0;
  private errorCount = 0;

  private cacheHits = 0;
  private cacheMisses = 0;

  private latencyBucket: LatencyBucket = { count: 0, sum: 0, min: Infinity, max: -Infinity };
  // Keep the last 1 000 latency samples for percentile estimation.
  private latencySamples: number[] = [];
  private readonly SAMPLE_WINDOW = 1_000;

  private connectorStats = new Map<string, ConnectorStat>();

  /** Call this after every agent request completes. */
  record(response: AgentResponse): void {
    this.total++;

    if (response.status === "success") this.successCount++;
    else if (response.status === "partial") this.partialCount++;
    else this.errorCount++;

    const lat = response.meta.latencyMs;
    this.latencyBucket.count++;
    this.latencyBucket.sum += lat;
    if (lat < this.latencyBucket.min) this.latencyBucket.min = lat;
    if (lat > this.latencyBucket.max) this.latencyBucket.max = lat;

    this.latencySamples.push(lat);
    if (this.latencySamples.length > this.SAMPLE_WINDOW) {
      this.latencySamples.shift();
    }

    if (response.meta.cached) {
      this.cacheHits++;
    } else {
      this.cacheMisses++;
    }

    for (const source of response.meta.sources) {
      const stat = this.connectorStats.get(source) ?? { calls: 0, errors: 0 };
      stat.calls++;
      this.connectorStats.set(source, stat);
    }

    // Track connector errors from data keys like "<connector>_error".
    for (const key of Object.keys(response.data)) {
      if (key.endsWith("_error")) {
        const connector = key.slice(0, -6);
        const stat = this.connectorStats.get(connector) ?? { calls: 0, errors: 0 };
        stat.errors++;
        this.connectorStats.set(connector, stat);
      }
    }
  }

  /** Increment cache hit counter independently (e.g. from cache layer). */
  recordCacheHit(): void {
    this.cacheHits++;
  }

  /** Increment cache miss counter independently. */
  recordCacheMiss(): void {
    this.cacheMisses++;
  }

  /** Returns a JSON-serialisable snapshot of all current metrics. */
  snapshot(): MetricsSnapshot {
    const b = this.latencyBucket;
    const sorted = [...this.latencySamples].sort((a, z) => a - z);

    const percentile = (p: number): number => {
      if (sorted.length === 0) return 0;
      const idx = Math.min(Math.floor((p / 100) * sorted.length), sorted.length - 1);
      return sorted[idx];
    };

    const totalCacheOps = this.cacheHits + this.cacheMisses;

    const connectors: Record<string, ConnectorStat> = {};
    for (const [name, stat] of this.connectorStats) {
      connectors[name] = { ...stat };
    }

    return {
      uptime_seconds: Math.round((Date.now() - this.startTime) / 1_000),
      requests: {
        total: this.total,
        success: this.successCount,
        partial: this.partialCount,
        error: this.errorCount,
      },
      latency_ms: {
        count: b.count,
        avg: b.count > 0 ? Math.round(b.sum / b.count) : 0,
        min: b.count > 0 ? b.min : 0,
        max: b.count > 0 ? b.max : 0,
        p50: percentile(50),
        p95: percentile(95),
        p99: percentile(99),
      },
      connectors,
      cache: {
        hits: this.cacheHits,
        misses: this.cacheMisses,
        hit_rate: totalCacheOps > 0 ? Math.round((this.cacheHits / totalCacheOps) * 100) / 100 : 0,
      },
    };
  }

  /** Reset all counters — useful in tests. */
  reset(): void {
    this.total = 0;
    this.successCount = 0;
    this.partialCount = 0;
    this.errorCount = 0;
    this.cacheHits = 0;
    this.cacheMisses = 0;
    this.latencyBucket = { count: 0, sum: 0, min: Infinity, max: -Infinity };
    this.latencySamples = [];
    this.connectorStats.clear();
  }
}

export const metrics = new MetricsCollector();
