import { BaseConnector } from "./base.js";
import type { ConnectorResult } from "../types/index.js";

export class CryptoConnector extends BaseConnector {
  constructor() {
    super({
      name: "crypto",
      description: "Cryptocurrency prices and market data via CoinGecko",
      baseUrl: "https://api.coingecko.com/api/v3",
      authType: "none",
      cost: "free",
      timeoutMs: 10_000,
      cacheTtlSeconds: 30,
    });
  }

  async execute(action: string, params: Record<string, unknown>): Promise<ConnectorResult> {
    switch (action) {
      case "getPrice": return this.getPrice(params);
      case "getMarketData": return this.getMarketData(params);
      case "search": return this.search(params);
      default: return this.failure(`Unknown action: ${action}`, 0);
    }
  }

  private async getPrice(params: Record<string, unknown>): Promise<ConnectorResult> {
    const timer = this.timed();
    try {
      const ids = (params.coins as string) || "bitcoin";
      const currencies = (params.currencies as string) || "usd";

      const { data } = await this.http.get("/simple/price", {
        params: {
          ids,
          vs_currencies: currencies,
          include_24hr_change: true,
          include_market_cap: true,
        },
      });

      const shaped: Record<string, unknown> = {};
      for (const [coinId, coinData] of Object.entries(data as Record<string, Record<string, number>>)) {
        shaped[coinId] = {
          usd: coinData.usd ?? 0,
          usd_24h_change: coinData.usd_24h_change ?? 0,
          usd_market_cap: coinData.usd_market_cap ?? 0,
        };
      }

      return this.success(shaped, timer.elapsed());
    } catch (err: unknown) {
      return this.failure(this.normalizeError(err), timer.elapsed());
    }
  }

  private async getMarketData(params: Record<string, unknown>): Promise<ConnectorResult> {
    const timer = this.timed();
    try {
      const id = (params.coin as string) || "bitcoin";
      const { data } = await this.http.get(`/coins/${id}`, {
        params: {
          localization: false,
          tickers: false,
          community_data: false,
          developer_data: false,
        },
      });

      return this.success({
        name: data.name,
        symbol: data.symbol,
        price_usd: data.market_data?.current_price?.usd,
        market_cap_usd: data.market_data?.market_cap?.usd,
        price_change_24h: data.market_data?.price_change_percentage_24h,
        ath_usd: data.market_data?.ath?.usd,
        total_supply: data.market_data?.total_supply,
      }, timer.elapsed());
    } catch (err: unknown) {
      return this.failure(this.normalizeError(err), timer.elapsed());
    }
  }

  private async search(params: Record<string, unknown>): Promise<ConnectorResult> {
    const timer = this.timed();
    try {
      const query = params.query as string;
      if (!query) return this.failure("Missing query parameter", timer.elapsed());

      const { data } = await this.http.get("/search", { params: { query } });

      const coins = (data.coins || []).slice(0, 5).map((c: Record<string, unknown>) => ({
        id: c.id,
        name: c.name,
        symbol: c.symbol,
        market_cap_rank: c.market_cap_rank,
      }));

      return this.success({ results: coins }, timer.elapsed());
    } catch (err: unknown) {
      return this.failure(this.normalizeError(err), timer.elapsed());
    }
  }
}
