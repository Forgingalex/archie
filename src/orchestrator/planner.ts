import Groq from "groq-sdk";
import { config } from "../config/env.js";
import { registry } from "../connectors/registry.js";
import type { PlannerResult, ToolCall } from "../types/index.js";

const SYSTEM_PROMPT = `You are the planner for an API agent. Your job is to understand the user's request and decide which API tools to call.

Available tools:
{TOOLS}

Respond ONLY with valid JSON. No markdown, no backticks, no explanation. Just the JSON object.

Response format:
{
  "intent": "brief description of what user wants",
  "tools": [
    {
      "connector": "connector_name",
      "action": "action_name",
      "params": { "key": "value" }
    }
  ],
  "confidence": 0.0 to 1.0
}

Rules:
- Choose the minimum tools needed.
- If user asks for a price, use crypto connector with getPrice action.
- If user asks to convert currency, use forex connector with convert action.
- If user asks for both (e.g. "BTC price in naira"), use BOTH crypto (getPrice) and forex (convert).
- For news/headlines, use news connector.
- If unclear, set confidence below 0.5 and pick the best guess.
- Params should match what the API expects. For crypto getPrice: coins (comma-separated ids like "bitcoin,ethereum"), currencies (like "usd").
- For forex convert: from, to, amount.
- For news search: query. For headlines: category (business, technology, etc).`;

let groqClient: Groq | null = null;

function getClient(): Groq {
  if (!groqClient) {
    if (!config.groqApiKey) {
      throw new Error("GROQ_API_KEY is required for the planner");
    }
    groqClient = new Groq({ apiKey: config.groqApiKey });
  }
  return groqClient;
}

function sanitizeInput(input: string): string {
  // Truncate as a second line of defense (router enforces 500 chars, but be safe).
  // Replace literal newlines/carriage returns to prevent prompt injection via
  // multi-line user content breaking out of the user message block.
  return input.slice(0, 500).replace(/[\r\n]+/g, " ").trim();
}

export async function plan(userInput: string): Promise<PlannerResult> {
  const client = getClient();
  const systemPrompt = SYSTEM_PROMPT.replace("{TOOLS}", registry.toolDescriptions());
  const safeInput = sanitizeInput(userInput);

  try {
    const completion = await client.chat.completions.create({
      model: config.groqModel,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: safeInput },
      ],
      temperature: 0.1,
      max_tokens: 500,
      response_format: { type: "json_object" },
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(raw) as Record<string, unknown>;

    return {
      intent: typeof parsed.intent === "string" ? parsed.intent : "unknown",
      tools: Array.isArray(parsed.tools) ? (parsed.tools as ToolCall[]) : [],
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "unknown error";
    console.error("[planner] error:", message);
    // Return a low-confidence empty plan so the orchestrator can handle gracefully
    // rather than surfacing a raw exception to the caller.
    return { intent: "error", tools: [], confidence: 0 };
  }
}
