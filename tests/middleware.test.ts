/**
 * Middleware unit tests.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { apiKeyAuth } from "../src/gateway/middleware.js";
import type { FastifyRequest, FastifyReply } from "fastify";

// Minimal stubs — only fields the middleware actually reads/writes.
function makeReq(authHeader?: string): FastifyRequest {
  return {
    headers: authHeader ? { authorization: authHeader } : {},
  } as unknown as FastifyRequest;
}

function makeReply(): FastifyReply & { _status: number | null; _body: unknown } {
  const reply = {
    _status: null as number | null,
    _body: undefined as unknown,
    status(code: number) {
      this._status = code;
      return this;
    },
    send(body: unknown) {
      this._body = body;
      return this;
    },
  };
  return reply as unknown as FastifyReply & { _status: number | null; _body: unknown };
}

beforeEach(() => {
  // Ensure no key is set before each test.
  delete process.env.ARCHIE_API_KEY;
  // Invalidate the cached config object by re-setting through the module.
  vi.resetModules();
});

afterEach(() => {
  delete process.env.ARCHIE_API_KEY;
  vi.restoreAllMocks();
});

describe("apiKeyAuth — no key configured", () => {
  it("calls done() immediately when ARCHIE_API_KEY is empty", async () => {
    const { apiKeyAuth: freshMiddleware } = await import("../src/gateway/middleware.js");
    const req = makeReq();
    const reply = makeReply();
    const done = vi.fn();

    freshMiddleware(req, reply as FastifyReply, done);
    expect(done).toHaveBeenCalledOnce();
    expect(reply._status).toBeNull();
  });
});

describe("apiKeyAuth — key configured", () => {
  it("allows request with correct Bearer token", async () => {
    // Patch config inline by importing with a factory that injects a key.
    // We test the middleware logic directly with the module-level config already set.
    const { config } = await import("../src/config/env.js");
    // Cast to mutable for test purposes
    (config as Record<string, unknown>).archieApiKey = "secret123";

    const { apiKeyAuth: freshMiddleware } = await import("../src/gateway/middleware.js");
    const req = makeReq("Bearer secret123");
    const reply = makeReply();
    const done = vi.fn();

    freshMiddleware(req, reply as FastifyReply, done);
    expect(done).toHaveBeenCalledOnce();
    expect(reply._status).toBeNull();

    // Restore
    (config as Record<string, unknown>).archieApiKey = "";
  });

  it("rejects request with wrong key (401)", async () => {
    const { config } = await import("../src/config/env.js");
    (config as Record<string, unknown>).archieApiKey = "secret123";

    const { apiKeyAuth: freshMiddleware } = await import("../src/gateway/middleware.js");
    const req = makeReq("Bearer wrongkey");
    const reply = makeReply();
    const done = vi.fn();

    freshMiddleware(req, reply as FastifyReply, done);
    expect(done).not.toHaveBeenCalled();
    expect(reply._status).toBe(401);

    (config as Record<string, unknown>).archieApiKey = "";
  });

  it("rejects request with no Authorization header (401)", async () => {
    const { config } = await import("../src/config/env.js");
    (config as Record<string, unknown>).archieApiKey = "secret123";

    const { apiKeyAuth: freshMiddleware } = await import("../src/gateway/middleware.js");
    const req = makeReq(); // no header
    const reply = makeReply();
    const done = vi.fn();

    freshMiddleware(req, reply as FastifyReply, done);
    expect(done).not.toHaveBeenCalled();
    expect(reply._status).toBe(401);

    (config as Record<string, unknown>).archieApiKey = "";
  });

  it("accepts bare key without 'Bearer ' prefix", async () => {
    const { config } = await import("../src/config/env.js");
    (config as Record<string, unknown>).archieApiKey = "mykey";

    const { apiKeyAuth: freshMiddleware } = await import("../src/gateway/middleware.js");
    const req = makeReq("mykey"); // raw key, no Bearer prefix
    const reply = makeReply();
    const done = vi.fn();

    freshMiddleware(req, reply as FastifyReply, done);
    expect(done).toHaveBeenCalledOnce();

    (config as Record<string, unknown>).archieApiKey = "";
  });
});
