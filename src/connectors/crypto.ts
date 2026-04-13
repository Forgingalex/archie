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

      // Always include "usd" so the USD price is available for forex chaining.
      // If the planner passed a non-USD currency (e.g. "ngn"), we merge it in
      // so CoinGecko still returns the usd field.
      const requested = ((params.currencies as string) || "usd").toLowerCase();
      const currencySet = new Set(requested.split(",").map((c) => c.trim()).filter(Boolean));
      currencySet.add("usd");
      const currencies = Array.from(currencySet).join(",");

      if (currencies !== requested && requested !== "usd") {
        console.warn(`[crypto] currencies param "${requested}" did not include usd — added it to guarantee USD fallback`);
      }

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
        if (!coinData.usd) {
          console.warn(`[crypto] usd field missing for ${coinId} — response keys: ${Object.keys(coinData).join(", ")}`);
        }
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
