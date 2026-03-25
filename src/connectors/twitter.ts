import { BaseConnector } from "./base.js";
import type { ConnectorResult } from "../types/index.js";
import { config } from "../config/env.js";

export class TwitterConnector extends BaseConnector {
  constructor() {
    super({
      name: "twitter",
      description: "Twitter/X search and user tweets via Bearer Token",
      baseUrl: "https://api.twitter.com/2",
      authType: "bearer",
      cost: "paid",
      timeoutMs: 10_000,
      cacheTtlSeconds: 60,
    });

    if (config.twitterBearerToken) {
      this.http.defaults.headers.common["Authorization"] =
        `Bearer ${config.twitterBearerToken}`;
    }
  }

  async execute(action: string, params: Record<string, unknown>): Promise<ConnectorResult> {
    switch (action) {
      case "search":
        return this.search(params);
      case "userTweets":
        return this.userTweets(params);
      default:
        return this.failure(`Unknown action: ${action}`, 0);
    }
  }

  private async search(params: Record<string, unknown>): Promise<ConnectorResult> {
    const timer = this.timed();
    try {
      if (!config.twitterBearerToken) {
        return this.failure("TWITTER_BEARER_TOKEN is not set — Twitter connector unavailable", timer.elapsed());
      }
      const query = params.query as string;
      if (!query) return this.failure("Missing query parameter", timer.elapsed());

      const { data } = await this.http.get("/tweets/search/recent", {
        params: {
          query,
          max_results: params.max_results ?? 10,
          "tweet.fields": "created_at,author_id",
        },
      });

      const tweets = (data.data ?? []).map((t: Record<string, unknown>) => ({
        id: t.id as string,
        text: t.text as string,
        author: (t.author_id as string) || "",
        created_at: (t.created_at as string) || "",
      }));

      return this.success({ tweets }, timer.elapsed());
    } catch (err: unknown) {
      return this.failure(this.normalizeError(err), timer.elapsed());
    }
  }

  private async userTweets(params: Record<string, unknown>): Promise<ConnectorResult> {
    const timer = this.timed();
    try {
      if (!config.twitterBearerToken) {
        return this.failure("TWITTER_BEARER_TOKEN is not set — Twitter connector unavailable", timer.elapsed());
      }
      const userId = params.userId as string;
      if (!userId) return this.failure("Missing userId parameter", timer.elapsed());

      const { data } = await this.http.get(`/users/${userId}/tweets`, {
        params: {
          max_results: params.max_results ?? 10,
          "tweet.fields": "created_at,author_id",
        },
      });

      const tweets = (data.data ?? []).map((t: Record<string, unknown>) => ({
        id: t.id as string,
        text: t.text as string,
        author: (t.author_id as string) || "",
        created_at: (t.created_at as string) || "",
      }));

      return this.success({ tweets }, timer.elapsed());
    } catch (err: unknown) {
      return this.failure(this.normalizeError(err), timer.elapsed());
    }
  }
}
