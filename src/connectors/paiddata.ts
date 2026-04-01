import { config } from "../config/env.js";
import { payForResource, isX402Configured, getX402WalletAddress } from "../payments/x402.js";
import type { ConnectorConfig, ConnectorResult, IConnector } from "../types/index.js";

// GoldRush uses chain names like "eth-mainnet", "base-mainnet", "base-sepolia-testnet"
const DEFAULT_CHAIN = "eth-mainnet";

// Display amount for Nanopayments (GoldRush charges ~0.001 USDC per call on testnet)
const PAYMENT_AMOUNT_DISPLAY = "0.001";

const CONNECTOR_CONFIG: ConnectorConfig = {
  name: "paiddata",
  description:
    "Premium blockchain data (token balances, NFTs, transaction history) via GoldRush x402 API — costs 0.001 USDC per request paid autonomously via Circle Nanopayments on Arc Testnet",
  baseUrl: config.goldrushX402Url,
  authType: "x402",
  cost: "paid",
  timeoutMs: 20_000,
  cacheTtlSeconds: 60,
};

// ── GoldRush response normalizers ────────────────────────────────────────────

interface GoldRushResponse {
  data?: {
    address?: string;
    items?: unknown[];
    pagination?: unknown;
    updated_at?: string;
  };
  error?: boolean;
  error_message?: string;
  error_code?: number;
}

function normalizeTokenBalances(raw: GoldRushResponse, address: string): Record<string, unknown> {
  const items = raw.data?.items ?? [];
  const tokens = (items as Record<string, unknown>[])
    .filter((item) => item && typeof item === "object")
    .map((item) => ({
      name: item.contract_name ?? "Unknown",
      symbol: item.contract_ticker_symbol ?? "?",
      balance: item.balance ?? "0",
      decimals: item.contract_decimals ?? 18,
      valueUsd: typeof item.quote === "number" ? item.quote : null,
      priceUsd: typeof item.quote_rate === "number" ? item.quote_rate : null,
      logoUrl: item.logo_url ?? null,
      type: item.type ?? "token",
    }));
  return {
    address,
    tokenCount: tokens.length,
    tokens,
    updatedAt: raw.data?.updated_at ?? new Date().toISOString(),
  };
}

function normalizeNFTs(raw: GoldRushResponse, address: string): Record<string, unknown> {
  const items = raw.data?.items ?? [];
  const collections = (items as Record<string, unknown>[])
    .filter((item) => item && typeof item === "object")
    .map((item) => {
      const nftData = Array.isArray(item.nft_data) ? item.nft_data as Record<string, unknown>[] : [];
      return {
        collectionName: item.contract_name ?? "Unknown Collection",
        symbol: item.contract_ticker_symbol ?? "?",
        contractAddress: item.contract_address ?? null,
        count: nftData.length,
        nfts: nftData.slice(0, 5).map((nft) => ({
          tokenId: nft.token_id ?? null,
          name: (nft.external_data as Record<string, unknown> | null)?.name ?? `#${nft.token_id}`,
          image: (nft.external_data as Record<string, unknown> | null)?.image ?? null,
        })),
      };
    });
  return {
    address,
    collectionCount: collections.length,
    nftCount: collections.reduce((sum, c) => sum + (c.count as number), 0),
    collections,
  };
}

function normalizeTransactions(raw: GoldRushResponse, address: string): Record<string, unknown> {
  const items = raw.data?.items ?? [];
  const transactions = (items as Record<string, unknown>[])
    .filter((item) => item && typeof item === "object")
    .slice(0, 20)
    .map((item) => ({
      hash: item.tx_hash ?? item.hash ?? null,
      from: item.from_address ?? null,
      to: item.to_address ?? null,
      valueWei: item.value ?? "0",
      valueUsd: typeof item.value_quote === "number" ? item.value_quote : null,
      timestamp: item.block_signed_at ?? null,
      successful: item.successful ?? true,
      gasSpent: item.gas_spent ?? null,
    }));
  return {
    address,
    count: transactions.length,
    transactions,
  };
}

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
      case "getTokenBalances":
        return this.callGoldRush(
          this.balancesPath(params),
          (raw) => normalizeTokenBalances(raw, String(params.address ?? "")),
          start,
        );

      case "getNFTs":
        return this.callGoldRush(
          this.nftPath(params),
          (raw) => normalizeNFTs(raw, String(params.address ?? "")),
          start,
        );

      case "getTransactionHistory":
        return this.callGoldRush(
          this.txPath(params),
          (raw) => normalizeTransactions(raw, String(params.address ?? "")),
          start,
        );

      case "getData":
      default:
        return this.callSelfHosted(start);
    }
  }

  // ── Path builders ──────────────────────────────────────────────────────────

  private balancesPath(params: Record<string, unknown>): string {
    const chain = String(params.chain ?? DEFAULT_CHAIN);
    const address = String(params.address ?? "");
    return `/v1/${chain}/address/${address}/balances_v2/`;
  }

  private nftPath(params: Record<string, unknown>): string {
    const chain = String(params.chain ?? DEFAULT_CHAIN);
    const address = String(params.address ?? "");
    return `/v1/${chain}/address/${address}/balances_nft/`;
  }

  private txPath(params: Record<string, unknown>): string {
    const chain = String(params.chain ?? DEFAULT_CHAIN);
    const address = String(params.address ?? "");
    return `/v1/${chain}/address/${address}/transactions_v3/`;
  }

  // ── GoldRush call (primary) ───────────────────────────────────────────────

  private async callGoldRush(
    path: string,
    normalize: (raw: GoldRushResponse) => Record<string, unknown>,
    start: number,
  ): Promise<ConnectorResult> {
    const url = `${config.goldrushX402Url}${path}`;
    console.log(`[paiddata] GoldRush Nanopayment request — ${url}`);

    try {
      const result = await payForResource<GoldRushResponse>(url);
      const latencyMs = Math.round(performance.now() - start);

      const raw = result.data;
      if (raw.error) {
        return this.failure(
          `GoldRush API error: ${raw.error_message ?? "unknown error"}`,
          latencyMs,
        );
      }

      console.log(`[paiddata] GoldRush Nanopayment successful — ${result.amount} USDC on Arc Testnet in ${latencyMs}ms — tx: ${result.transaction}`);

      return {
        connector: "paiddata",
        success: true,
        data: normalize(raw),
        cached: false,
        latencyMs,
        paymentMade: {
          amount: result.amount || PAYMENT_AMOUNT_DISPLAY,
          currency: "USDC",
          protocol: "x402",
          provider: "goldrush",
        },
      };
    } catch (err: unknown) {
      const latencyMs = Math.round(performance.now() - start);
      return this.failure(this.formatError(err), latencyMs);
    }
  }

  // ── Self-hosted fallback (getData action) ─────────────────────────────────

  private async callSelfHosted(start: number): Promise<ConnectorResult> {
    const base = config.vercelUrl
      ? `https://${config.vercelUrl}`
      : `http://localhost:${config.port}`;
    const url = `${base}/paid/market-intel`;
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
