import { BaseConnector } from "./base.js";
import type { ConnectorResult } from "../types/index.js";

export class ForexConnector extends BaseConnector {
  constructor() {
    super({
      name: "forex",
      description: "Foreign exchange rates and currency conversion",
      baseUrl: "https://open.er-api.com/v6",
      authType: "none",
      cost: "free",
      timeoutMs: 10_000,
      cacheTtlSeconds: 300,
    });
  }

  async execute(action: string, params: Record<string, unknown>): Promise<ConnectorResult> {
    switch (action) {
      case "getRates": return this.getRates(params);
      case "convert": return this.convert(params);
      default: return this.failure(`Unknown action: ${action}`, 0);
    }
  }

  private async getRates(params: Record<string, unknown>): Promise<ConnectorResult> {
    const timer = this.timed();
    try {
      const base = ((params.base as string) || "USD").toUpperCase();
      const { data } = await this.http.get(`/latest/${base}`);

      if (data.result !== "success") {
        return this.failure(`API error: ${data["error-type"] || "unknown"}`, timer.elapsed());
      }

      const targets = params.targets as string | undefined;
      let rates = data.rates;
      if (targets) {
        const targetList = targets.toUpperCase().split(",").map((t: string) => t.trim());
        rates = Object.fromEntries(
          Object.entries(rates).filter(([k]) => targetList.includes(k))
        );
      }

      return this.success({ base, rates: rates as Record<string, number>, last_updated: data.time_last_update_utc as string }, timer.elapsed());
    } catch (err: unknown) {
      return this.failure(this.normalizeError(err), timer.elapsed());
    }
  }

  private async convert(params: Record<string, unknown>): Promise<ConnectorResult> {
    const timer = this.timed();
    try {
      const from = ((params.from as string) || "USD").toUpperCase();
      const to = ((params.to as string) || "NGN").toUpperCase();
      const parsedAmount = parseFloat(params.amount as string);
      const amount = params.amount != null && params.amount !== "null" && !isNaN(parsedAmount) ? parsedAmount : NaN;

      const { data } = await this.http.get(`/latest/${from}`);

      if (data.result !== "success") {
        return this.failure(`API error: ${data["error-type"] || "unknown"}`, timer.elapsed());
      }

      const rate = data.rates[to] as number | undefined;
      if (!rate) {
        return this.failure(`Currency ${to} not found`, timer.elapsed());
      }

      return this.success({
        from,
        to,
        amount,
        rate,
        result: !isNaN(amount) ? Math.round(amount * rate * 100) / 100 : NaN,
      }, timer.elapsed());
    } catch (err: unknown) {
      return this.failure(this.normalizeError(err), timer.elapsed());
    }
  }
}
