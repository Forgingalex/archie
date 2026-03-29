import { v4 as uuidv4 } from "uuid";
import { plan } from "./planner.js";
import { registry } from "../connectors/registry.js";
import { cache, cacheKey } from "../cache/cache.js";
import type { AgentResponse, ConnectorResult } from "../types/index.js";

const MAX_RETRIES = 2;

export async function handleRequest(input: string): Promise<AgentResponse> {
  const requestId = uuidv4();
  const startTime = performance.now();

  const planResult = await plan(input);
  console.log(`[${requestId}] plan: ${planResult.intent} (confidence: ${planResult.confidence}) tools: ${planResult.tools.map((t) => `${t.connector}.${t.action}`).join(", ")}`);

  if (planResult.confidence < 0.3) {
    return buildResponse(requestId, "error", {
      message: "I'm not confident I understand your request. Could you be more specific?",
      intent: planResult.intent,
    }, [], startTime);
  }

  if (planResult.tools.length === 0) {
    if (planResult.confidence >= 0.5) {
      return buildResponse(requestId, "success", {
        message: planResult.intent
      }, [], startTime);
    }
    return buildResponse(requestId, "error", {
      message: "I'm not sure what you need. Try asking for a crypto price, currency conversion, news, or a wallet balance.",
      intent: planResult.intent,
    }, [], startTime);
  }

  // Run all connector calls in parallel — they are independent of each other.
  const results: ConnectorResult[] = await Promise.all(
    planResult.tools.map(async (toolCall): Promise<ConnectorResult> => {
      const connector = registry.get(toolCall.connector);
      if (!connector) {
        console.warn(`[${requestId}] unknown connector "${toolCall.connector}" — skipping`);
        return {
          connector: toolCall.connector,
          success: false,
          data: {},
          cached: false,
          latencyMs: 0,
          error: `Unknown connector "${toolCall.connector}"`,
        };
      }

      const key = cacheKey(toolCall.connector, toolCall.action, toolCall.params);
      const cached = cache.get<ConnectorResult>(key);
      if (cached) {
        return { ...cached, cached: true };
      }

      let result: ConnectorResult | null = null;
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          result = await connector.execute(toolCall.action, toolCall.params);
          if (result.success) {
            cache.set(key, result, connector.config.cacheTtlSeconds);
            break;
          }
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : "unknown error";
          console.error(`[${requestId}] attempt ${attempt + 1} failed for ${toolCall.connector}.${toolCall.action}: ${message}`);
        }

        if (attempt < MAX_RETRIES) {
          await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
        }
      }

      return result ?? {
        connector: toolCall.connector,
        success: false,
        data: {},
        cached: false,
        latencyMs: 0,
        error: "All retries exhausted",
      };
    }),
  );

  // When the planner returns both a crypto and forex tool and the LLM leaves
  // forex.amount null, re-run forex.convert with the USD price from the
  // crypto result so users get a full conversion without a second request.
  const forexResult = results.find((r) => {
    if (r.connector !== "forex") return false;
    const amt = r.data.amount;
    return amt == null || (typeof amt === "number" && isNaN(amt));
  });
  const cryptoResult = results.find((r) => r.connector === "crypto" && r.success);
  if (forexResult && cryptoResult) {
    const usdPrice = extractUsdPrice(cryptoResult.data);
    if (usdPrice !== null) {
      const forexConnector = registry.get("forex");
      if (forexConnector) {
        const patchedParams = { from: forexResult.data.from, to: forexResult.data.to, amount: usdPrice };
        try {
          const rerun = await forexConnector.execute("convert", patchedParams);
          results[results.indexOf(forexResult)] = rerun;
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : "unknown";
          console.error(`[${requestId}] forex chaining re-run failed: ${message}`);
        }
      }
    }
  }

  const allSuccess = results.every((r) => r.success);
  const anySuccess = results.some((r) => r.success);

  if (!anySuccess) {
    const errors = results.map((r) => `${r.connector}: ${r.error ?? "unknown error"}`).join("; ");
    return buildResponse(requestId, "error", {
      message: "All API calls failed. Please try again.",
      errors,
    }, results, startTime);
  }

  const status = allSuccess ? "success" : "partial";

  const mergedData: Record<string, unknown> = {};
  for (const r of results) {
    if (r.success) {
      mergedData[r.connector] = r.data;
    } else if (r.error) {
      mergedData[`${r.connector}_error`] = r.error;
    }
  }

  return buildResponse(requestId, status, mergedData, results, startTime);
}

// Handles both getPrice format ({ bitcoin: { usd: number } })
// and getMarketData format ({ price_usd: number }).
function extractUsdPrice(data: Record<string, unknown>): number | null {
  if (typeof data.price_usd === "number") return data.price_usd;
  for (const coinData of Object.values(data)) {
    if (coinData && typeof coinData === "object") {
      const price = (coinData as Record<string, unknown>).usd;
      if (typeof price === "number") return price;
    }
  }
  return null;
}

function buildResponse(
  requestId: string,
  status: "success" | "error" | "partial",
  data: Record<string, unknown>,
  results: ConnectorResult[],
  startTime: number,
): AgentResponse {
  return {
    requestId,
    status,
    data,
    meta: {
      sources: results.filter((r) => r.success).map((r) => r.connector),
      cached: results.some((r) => r.cached),
      latencyMs: Math.round(performance.now() - startTime),
    },
  };
}
