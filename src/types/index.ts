export interface AgentResponse {
  requestId: string;
  status: "success" | "error" | "partial";
  data: Record<string, unknown>;
  meta: ResponseMeta;
}

export interface ResponseMeta {
  sources: string[];
  cached: boolean;
  latencyMs: number;
  cost?: { amount: string; currency: "USDC"; paid: boolean; provider?: string };
}

export interface PlannerResult {
  intent: string;
  tools: ToolCall[];
  confidence: number;
}

export interface ToolCall {
  connector: string;
  action: string;
  params: Record<string, unknown>;
}

export interface ConnectorConfig {
  name: string;
  description: string;
  baseUrl: string;
  authType: "none" | "api_key" | "bearer" | "x402";
  cost: "free" | "paid";
  timeoutMs: number;
  cacheTtlSeconds: number;
}

export interface ConnectorResult {
  connector: string;
  success: boolean;
  data: Record<string, unknown>;
  cached: boolean;
  latencyMs: number;
  error?: string;
  paymentMade?: { amount: string; currency: string; protocol?: string; provider?: string };
}

export interface IConnector {
  config: ConnectorConfig;
  execute(action: string, params: Record<string, unknown>): Promise<ConnectorResult>;
}

export interface CacheEntry {
  key: string;
  value: unknown;
  expiresAt: number;
}

export interface PaymentEvent {
  requestId: string;
  connector: string;
  amount: string;
  currency: string;
  txHash: string | null;
  paid: boolean;
  timestamp: string;
}

export interface ArcAgentIdentity {
  agentId: string;
  nerAddress: string;
  walletId: string;
  walletAddress: string;
}

export interface ReputationEvent {
  agentId: string;
  score: number;
  tag: string;
  txHash: string | null;
  timestamp: string;
}
