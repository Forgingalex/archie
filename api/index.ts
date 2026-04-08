import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import staticFiles from "@fastify/static";
import type { IncomingMessage, ServerResponse } from "http";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { config, validateConfig } from "../src/config/env.js";
import { registerRoutes } from "../src/gateway/router.js";
import { registerPaidRoutes } from "../src/gateway/paid-routes.js";
import { initWallet } from "../src/payments/x402.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Singleton promise — builds the app once per container, cached across warm invocations.
let appPromise: Promise<FastifyInstance> | undefined;

function buildApp(): Promise<FastifyInstance> {
  if (appPromise) return appPromise;

  appPromise = (async () => {
    const warnings = validateConfig();
    for (const w of warnings) {
      console.warn(`[config] ${w}`);
    }

    const app = Fastify({ logger: false });

    await app.register(cors, { origin: true });
    await app.register(rateLimit, { max: 60, timeWindow: "1 minute" });

    // Static files are bundled into the serverless function via vercel.json includeFiles.
    // The path ../src/public resolves correctly both locally (from api/) and in the
    // Vercel runtime (files are included at their original paths relative to the project root).
    await app.register(staticFiles, {
      root: join(__dirname, "..", "src", "public"),
      prefix: "/",
    });

    await registerRoutes(app);
    await registerPaidRoutes(app);
    await app.ready();

    return app;
  })();

  return appPromise;
}

// Fire-and-forget wallet init at module load time so it runs during cold start
// rather than blocking the first request. Errors are logged but never re-thrown.
if (config.circleApiKey && config.circleEntitySecret) {
  initWallet().catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[x402] background wallet init error: ${msg}`);
  });
}

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const app = await buildApp();
  app.server.emit("request", req, res);
}
