import axios, { type AxiosInstance } from "axios";
import type { ConnectorConfig, ConnectorResult, IConnector } from "../types/index.js";

export abstract class BaseConnector implements IConnector {
  config: ConnectorConfig;
  protected http: AxiosInstance;

  constructor(config: ConnectorConfig) {
    this.config = config;
    this.http = axios.create({
      baseURL: config.baseUrl,
      timeout: config.timeoutMs,
      headers: { "Accept": "application/json" },
    });
  }

  abstract execute(action: string, params: Record<string, unknown>): Promise<ConnectorResult>;

  protected success(data: Record<string, unknown>, latencyMs: number, cached = false): ConnectorResult {
    return {
      connector: this.config.name,
      success: true,
      data,
      cached,
      latencyMs,
    };
  }

  protected failure(error: string, latencyMs: number): ConnectorResult {
    return {
      connector: this.config.name,
      success: false,
      data: {},
      cached: false,
      latencyMs,
      error,
    };
  }

  protected timed(): { elapsed: () => number } {
    const start = performance.now();
    return { elapsed: () => Math.round(performance.now() - start) };
  }

  protected normalizeError(err: unknown): string {
    if (axios.isAxiosError(err)) {
      const msg = (err.response?.data as Record<string, unknown> | undefined)?.message;
      if (typeof msg === "string" && msg.length > 0) return msg;
      return err.message;
    }
    if (err instanceof Error) return err.message;
    if (typeof err === "string") return err;
    return "Unknown error";
  }
}
