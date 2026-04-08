import "dotenv/config";

export const config = {
  port: parseInt(process.env.PORT || "3000", 10),
  nodeEnv: process.env.NODE_ENV || "development",
  isDev: (process.env.NODE_ENV || "development") === "development",

  groqApiKey: process.env.GROQ_API_KEY || "",
  groqModel: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",

  arcRpcUrl: process.env.ARC_RPC_URL || "https://rpc.testnet.arc.network",
  arcChainId: parseInt(process.env.ARC_CHAIN_ID || "5042002", 10),

  circleApiKey: process.env.CIRCLE_API_KEY || "",
  circleEntitySecret: process.env.CIRCLE_ENTITY_SECRET || "",

  arcAgentWalletId: process.env.ARC_AGENT_WALLET_ID || "",
  arcValidatorWalletId: process.env.ARC_VALIDATOR_WALLET_ID || "",
  arcAgentId: process.env.ARC_AGENT_ID || "",

  coingeckoApiKey: process.env.COINGECKO_API_KEY || "",
  twitterBearerToken: process.env.TWITTER_BEARER_TOKEN || "",
  newsApiKey: process.env.NEWS_API_KEY || "",
  etherscanApiKey: process.env.ETHERSCAN_API_KEY || "",
  exchangeRateApiKey: process.env.EXCHANGE_RATE_API_KEY || "",

  // Optional gateway API key. When set, all /agent and /ask requests must
  // carry "Authorization: Bearer <key>". Leave empty to disable auth (dev mode).
  archieApiKey: process.env.ARCHIE_API_KEY || "",

  // x402 EOA payment wallet (separate from Circle identity wallets)
  // Generate with: npx tsx scripts/generate-wallet.ts
  x402PrivateKey: process.env.X402_PRIVATE_KEY || "",
  x402Network: process.env.X402_NETWORK || "base-sepolia",

  // GoldRush x402 API (by Covalent) — paid blockchain data via x402 micropayments
  goldrushX402Url: process.env.GOLDRUSH_X402_URL || "https://x402.goldrush.dev",

  // Vercel deployment URLs — set automatically by Vercel.
  // VERCEL_PROJECT_PRODUCTION_URL is the stable production domain (no auth wall).
  // VERCEL_URL is the preview deployment URL (may be behind Vercel auth).
  vercelProductionUrl: process.env.VERCEL_PROJECT_PRODUCTION_URL || "",
  vercelUrl: process.env.VERCEL_URL || "",
} as const;

export function validateConfig(): string[] {
  const warnings: string[] = [];
  if (!config.groqApiKey) {
    warnings.push("GROQ_API_KEY is not set — planner will not work");
  }
  if (!config.circleApiKey || !config.circleEntitySecret) {
    warnings.push("CIRCLE_API_KEY or CIRCLE_ENTITY_SECRET not set — Arc identity unavailable");
  }
  if (!config.x402PrivateKey) {
    warnings.push("X402_PRIVATE_KEY not set — paid data connector unavailable (run: npx tsx scripts/generate-wallet.ts)");
  }
  return warnings;
}
