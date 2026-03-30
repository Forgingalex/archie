import { config } from "../config/env.js";
import { getX402AxiosClient, isX402Configured, getX402WalletAddress } from "../payments/x402.js";
import type { ConnectorConfig, ConnectorResult, IConnector } from "../types/index.js";

// USDC on Base Sepolia — 6 decimals, 0.001 USDC = 1000 units
const PAYMENT_AMOUNT_DISPLAY = "0.001";

const CONNECTOR_CONFIG: ConnectorConfig = {
  name: "paiddata",
  description: "Premium market intelligence: top crypto prices, fear & greed index, BTC dominance — costs 0.001 USDC per request via x402 autonomous payment",
  baseUrl: `http://localhost:${config.port}`,
  authType: "x402",
  cost: "paid",
  timeoutMs: 15_000,
  cacheTtlSeconds: 60,
};

export class PaidDataConnector implements IConnector {
  config: ConnectorConfig = CONNECTOR_CONFIG;

  async execute(action: string, _params: Record<string, unknown>): Promise<ConnectorResult> {
    const start = performance.now();

    if (action !== "getData") {
      return this.failure(`Unknown action "${action}" — paiddata only supports getData`, 0);
    }

    if (!isX402Configured()) {
      const walletAddr = getX402WalletAddress();
      return this.failure(
        `Archie's x402 payment wallet is not configured. ` +
          `Add X402_PRIVATE_KEY to .env (run: npx tsx scripts/generate-wallet.ts) ` +
          `then fund the wallet with USDC on Base Sepolia at https://faucet.circle.com` +
          (walletAddr ? ` — wallet address: ${walletAddr}` : ""),
        0,
      );
    }

    try {
      const client = getX402AxiosClient();
      const url = `http://localhost:${config.port}/paid/market-intel`;

      console.log(`[paiddata] requesting premium data via x402 — ${url}`);

      const response = await client.get<Record<string, unknown>>(url);
      const latencyMs = Math.round(performance.now() - start);

      console.log(`[paiddata] payment successful — 0.001 USDC paid via x402 in ${latencyMs}ms`);

      return {
        connector: "paiddata",
        success: true,
        data: response.data as Record<string, unknown>,
        cached: false,
        latencyMs,
        paymentMade: { amount: PAYMENT_AMOUNT_DISPLAY, currency: "USDC" },
      };
    } catch (err: unknown) {
      const latencyMs = Math.round(performance.now() - start);
      const msg = err instanceof Error ? err.message : String(err);

      if (msg.toLowerCase().includes("insufficient") || msg.toLowerCase().includes("balance")) {
        const addr = getX402WalletAddress() ?? "unknown";
        return this.failure(
          `Archie's payment wallet needs USDC. Fund address ${addr} on Base Sepolia at https://faucet.circle.com`,
          latencyMs,
        );
      }

      return this.failure(`x402 paid request failed: ${msg}`, latencyMs);
    }
  }

  private failure(error: string, latencyMs: number): ConnectorResult {
    return {
      connector: "paiddata",
      success: false,
      data: {},
      cached: false,
      latencyMs,
      error,
    };
  }
}
