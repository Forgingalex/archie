import { BaseConnector } from "./base.js";
import type { ConnectorResult } from "../types/index.js";
import { config } from "../config/env.js";

export class BlockchainConnector extends BaseConnector {
  constructor() {
    super({
      name: "blockchain",
      description: "Ethereum blockchain data via Etherscan (balances, transactions)",
      baseUrl: "https://api.etherscan.io/v2/api",
      authType: "api_key",
      cost: "free",
      timeoutMs: 10_000,
      cacheTtlSeconds: 30,
    });
  }

  async execute(action: string, params: Record<string, unknown>): Promise<ConnectorResult> {
    switch (action) {
      case "getBalance":
        return this.getBalance(params);
      case "getTransactions":
        return this.getTransactions(params);
      default:
        return this.failure(`Unknown action: ${action}`, 0);
    }
  }

  private async getBalance(params: Record<string, unknown>): Promise<ConnectorResult> {
    const timer = this.timed();
    try {
      const address = params.address as string;
      if (!address) return this.failure("Missing address parameter", timer.elapsed());

      const { data } = await this.http.get("", {
        params: {
          chainid: 1,
          module: "account",
          action: "balance",
          address,
          tag: "latest",
          apikey: config.etherscanApiKey || "YourApiKeyToken",
        },
      });

      if (data.status !== "1") {
        return this.failure(data.message || "Etherscan error", timer.elapsed());
      }

      const weiBalance = BigInt(data.result);
      const ethBalance = Number(weiBalance) / 1e18;

      return this.success({ address, balance_wei: data.result, balance_eth: ethBalance }, timer.elapsed());
    } catch (err: unknown) {
      return this.failure(this.normalizeError(err), timer.elapsed());
    }
  }

  private async getTransactions(params: Record<string, unknown>): Promise<ConnectorResult> {
    const timer = this.timed();
    try {
      const address = params.address as string;
      if (!address) return this.failure("Missing address parameter", timer.elapsed());

      const { data } = await this.http.get("", {
        params: {
          chainid: 1,
          module: "account",
          action: "txlist",
          address,
          startblock: 0,
          endblock: 99999999,
          page: 1,
          offset: params.limit ?? 10,
          sort: "desc",
          apikey: config.etherscanApiKey || "YourApiKeyToken",
        },
      });

      if (data.status !== "1") {
        return this.failure(data.message || "Etherscan error", timer.elapsed());
      }

      const txs = (data.result as Record<string, unknown>[]).map((tx) => ({
        hash: tx["hash"] as string,
        from: tx["from"] as string,
        to: tx["to"] as string,
        value_eth: Number(tx["value"]) / 1e18,
        timestamp: tx["timeStamp"] as string,
      }));

      return this.success({ address, transactions: txs }, timer.elapsed());
    } catch (err: unknown) {
      return this.failure(this.normalizeError(err), timer.elapsed());
    }
  }
}
