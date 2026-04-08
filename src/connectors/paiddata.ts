import { config } from "../config/env.js";
import { payForResource, isX402Configured, getX402WalletAddress } from "../payments/x402.js";
import type { ConnectorConfig, ConnectorResult, IConnector } from "../types/index.js";

// Display amount for Nanopayments (0.001 USDC per call on Arc Testnet)
const PAYMENT_AMOUNT_DISPLAY = "0.001";

const CONNECTOR_CONFIG: ConnectorConfig = {
  name: "paiddata",
  description:
    "Premium self-hosted data (market intel, wallet analysis, trend reports) via Circle Nanopayments on Arc Testnet — costs 0.001 USDC per request paid autonomously",
  baseUrl: "",
  authType: "x402",
  cost: "paid",
  timeoutMs: 20_000,
  cacheTtlSeconds: 60,
};

// ── Connector ─────────────────────────────────────────────────────────────────

export class PaidDataConnector implements IConnector {
  config: ConnectorConfig = CONNECTOR_CONFIG;

  async execute(action: string, params: Record<string, unknown>): Promise<ConnectorResult> {
    const start = performance.now();

    if (!isX402Configured()) {
      const walletAddr = getX402WalletAddress();
      return this.failure(
        `Archie's Nanopayments wallet is not configured. ` +
          `Run: npx tsx scripts/generate-wallet.ts, then deposit USDC on Arc Testnet via: npm run deposit-gateway` +
          (walletAddr ? ` — wallet: ${walletAddr}` : ""),
        0,
      );
    }

    switch (action) {
      case "getWalletAnalysis":
        return this.callSelfHosted(
          `/paid/wallet-analysis?address=${encodeURIComponent(String(params.address ?? ""))}`,
          start,
        );

      case "getTrendReport":
        return this.callSelfHosted(
          `/paid/trend-report?topic=${encodeURIComponent(String(params.topic ?? "ethereum"))}`,
          start,
        );

      case "getData":
      default:
        return this.callSelfHosted("/paid/market-intel", start);
    }
  }

  // ── Self-hosted call ──────────────────────────────────────────────────────

  private async callSelfHosted(path: string, start: number): Promise<ConnectorResult> {
    const base = config.vercelProductionUrl
      ? `https://${config.vercelProductionUrl}`
      : config.vercelUrl
        ? `https://${config.vercelUrl}`
        : `http://localhost:${config.port}`;
    const url = `${base}${path}`;
    console.log(`[paiddata] self-hosted Nanopayment request — ${url}`);

    try {
      const result = await payForResource<Record<string, unknown>>(url);
      const latencyMs = Math.round(performance.now() - start);

      console.log(`[paiddata] self-hosted Nanopayment successful — ${result.amount} USDC on Arc Testnet in ${latencyMs}ms`);

      return {
        connector: "paiddata",
        success: true,
        data: result.data,
        cached: false,
        latencyMs,
        paymentMade: {
          amount: result.amount || PAYMENT_AMOUNT_DISPLAY,
          currency: "USDC",
          protocol: "x402",
          provider: "self",
        },
      };
    } catch (err: unknown) {
      const latencyMs = Math.round(performance.now() - start);
      return this.failure(this.formatError(err), latencyMs);
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private formatError(err: unknown): string {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.toLowerCase().includes("insufficient") || msg.toLowerCase().includes("balance")) {
      const addr = getX402WalletAddress() ?? "unknown";
      return `Gateway wallet needs USDC on Arc Testnet. Fund address ${addr} via: npm run deposit-gateway`;
    }
    return `Nanopayment request failed: ${msg}`;
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
