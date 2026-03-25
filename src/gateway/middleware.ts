import type { FastifyRequest, FastifyReply, HookHandlerDoneFunction } from "fastify";
import { config } from "../config/env.js";

/**
 * Optional API-key authentication middleware.
 *
 * When ARCHIE_API_KEY is set in the environment every request to protected
 * routes must carry the header:
 *
 *   Authorization: Bearer <key>
 *
 * Requests without a matching key receive HTTP 401.
 * When ARCHIE_API_KEY is not set the middleware is a no-op so the server
 * still starts in development without any configuration.
 */
export function apiKeyAuth(
  request: FastifyRequest,
  reply: FastifyReply,
  done: HookHandlerDoneFunction,
): void {
  const expectedKey = config.archieApiKey;

  // No key configured → auth disabled, allow all.
  if (!expectedKey) {
    done();
    return;
  }

  const authHeader = request.headers["authorization"] ?? "";
  const providedKey = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : authHeader.trim();

  if (providedKey !== expectedKey) {
    reply.status(401).send({
      status: "error",
      data: { message: "Unauthorized — valid API key required in Authorization header" },
      meta: { sources: [], cached: false, latencyMs: 0 },
    });
    return;
  }

  done();
}

/**
 * Attaches a monotonic start time to the request so route handlers can
 * compute accurate latency without re-calling performance.now().
 */
export function requestTimer(
  request: FastifyRequest & { startMs?: number },
  _reply: FastifyReply,
  done: HookHandlerDoneFunction,
): void {
  request.startMs = performance.now();
  done();
}
