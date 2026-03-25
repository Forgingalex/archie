import { BaseConnector } from "./base.js";
import type { ConnectorResult } from "../types/index.js";
import { config } from "../config/env.js";

export class NewsConnector extends BaseConnector {
  constructor() {
    super({
      name: "news",
      description: "Latest news headlines and article search",
      baseUrl: "https://newsapi.org/v2",
      authType: "api_key",
      cost: "free",
      timeoutMs: 10_000,
      cacheTtlSeconds: 120,
    });
  }

  async execute(action: string, params: Record<string, unknown>): Promise<ConnectorResult> {
    if (!config.newsApiKey) {
      return this.failure("NEWS_API_KEY not configured", 0);
    }

    switch (action) {
      case "headlines": return this.headlines(params);
      case "search": return this.search(params);
      default: return this.failure(`Unknown action: ${action}`, 0);
    }
  }

  private async headlines(params: Record<string, unknown>): Promise<ConnectorResult> {
    const timer = this.timed();
    try {
      const category = (params.category as string) || "technology";
      const country = (params.country as string) || "us";

      const { data } = await this.http.get("/top-headlines", {
        params: { category, country, pageSize: 5, apiKey: config.newsApiKey },
      });

      const articles = (data.articles || []).map((a: Record<string, unknown>) => ({
        title: a.title as string,
        description: (a.description as string | null) ?? null,
        source: ((a.source as Record<string, unknown>)?.name as string) || "",
        url: a.url as string,
        publishedAt: a.publishedAt as string,
      }));

      return this.success({ articles, totalResults: data.totalResults as number }, timer.elapsed());
    } catch (err: unknown) {
      return this.failure(this.normalizeError(err), timer.elapsed());
    }
  }

  private async search(params: Record<string, unknown>): Promise<ConnectorResult> {
    const timer = this.timed();
    try {
      const query = params.query as string;
      if (!query) return this.failure("Missing query parameter", timer.elapsed());

      const { data } = await this.http.get("/everything", {
        params: { q: query, sortBy: "relevancy", pageSize: 5, apiKey: config.newsApiKey },
      });

      const articles = (data.articles || []).map((a: Record<string, unknown>) => ({
        title: a.title as string,
        description: (a.description as string | null) ?? null,
        source: ((a.source as Record<string, unknown>)?.name as string) || "",
        url: a.url as string,
        publishedAt: a.publishedAt as string,
      }));

      return this.success({ articles, totalResults: data.totalResults as number }, timer.elapsed());
    } catch (err: unknown) {
      return this.failure(this.normalizeError(err), timer.elapsed());
    }
  }
}
