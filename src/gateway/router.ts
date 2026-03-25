import type { FastifyInstance } from "fastify";
import { handleRequest } from "../orchestrator/orchestrator.js";
import { registry } from "../connectors/registry.js";
import { cache } from "../cache/cache.js";
import { apiKeyAuth } from "./middleware.js";
import { metrics } from "../observability/metrics.js";

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  // ── Public routes ─────────────────────────────────────────────────────────

  app.get("/health", async () => ({
    status: "ok",
    timestamp: new Date().toISOString(),
    cache_size: cache.size,
    uptime_seconds: Math.round(process.uptime()),
  }));

  app.get("/info", async () => ({
    name: "archie",
    version: "0.1.0",
    network: "Arc Testnet",
    chainId: 5042002,
    connectors: registry.list().map((c) => c.name),
  }));

  app.get("/connectors", async () => ({
    connectors: registry.list(),
  }));

  // ── Observability ─────────────────────────────────────────────────────────

  app.get("/metrics", async () => metrics.snapshot());

  // ── Protected routes (optional API-key auth) ─────────────────────────────

  app.post<{ Body: { query: string } }>(
    "/agent",
    {
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
      preHandler: apiKeyAuth,
    },
    async (request, reply) => {
      const { query } = request.body ?? {};

      if (typeof query !== "string" || query.trim().length === 0) {
        return reply.status(400).send({
          status: "error",
          data: { message: "query must be a non-empty string" },
          meta: { sources: [], cached: false, latencyMs: 0 },
        });
      }
      if (query.trim().length > 500) {
        return reply.status(400).send({
          status: "error",
          data: { message: "query must be 500 characters or fewer" },
          meta: { sources: [], cached: false, latencyMs: 0 },
        });
      }

      const response = await handleRequest(query.trim());
      metrics.record(response);
      return reply.status(response.status === "error" ? 500 : 200).send(response);
    },
  );

  app.get<{ Querystring: { q: string } }>(
    "/ask",
    { preHandler: apiKeyAuth },
    async (request, reply) => {
      const q = request.query.q;

      if (!q || typeof q !== "string" || q.trim().length === 0) {
        return reply.status(400).send({
          status: "error",
          data: { message: "Missing query parameter '?q=your question'" },
        });
      }

      if (q.trim().length > 500) {
        return reply.status(400).send({
          status: "error",
          data: { message: "query must be 500 characters or fewer" },
        });
      }

      const response = await handleRequest(q.trim());
      metrics.record(response);
      return reply.send(response);
    },
  );
}
