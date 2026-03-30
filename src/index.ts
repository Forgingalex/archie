import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import staticFiles from "@fastify/static";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { config, validateConfig } from "./config/env.js";
import { registerRoutes } from "./gateway/router.js";
import { registerPaidRoutes } from "./gateway/paid-routes.js";
import { initWallet } from "./payments/x402.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  const warnings = validateConfig();
  for (const w of warnings) {
    console.warn(`[config] ${w}`);
  }

  const app = Fastify({
    logger: config.isDev
      ? { transport: { target: "pino-pretty", options: { colorize: true } } }
      : true,
  });

  await app.register(cors, { origin: true });
  await app.register(rateLimit, { max: 60, timeWindow: "1 minute" });
  await app.register(staticFiles, {
    root: join(__dirname, "public"),
    prefix: "/",
  });

  await registerRoutes(app);
  await registerPaidRoutes(app);

  try {
    await app.listen({ port: config.port, host: "0.0.0.0" });
    console.log(`archie listening on http://localhost:${config.port}`);
    console.log(`network: Arc Testnet (${config.arcChainId})`);
    console.log(`model: ${config.groqModel}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }

  if (config.circleApiKey && config.circleEntitySecret) {
    initWallet().catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[x402] background wallet init error: ${msg}`);
    });
  }
}

main();
