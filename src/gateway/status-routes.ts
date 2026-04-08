import type { FastifyInstance } from "fastify";
import { config } from "../config/env.js";
import { getGatewayBalance, isX402Configured } from "../payments/x402.js";

interface RpcResponse {
  result?: string;
  error?: unknown;
}

export async function registerStatusRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /gateway-balance
   * Returns the Circle Gateway USDC wallet and available balances on Arc Testnet.
   */
  app.get("/gateway-balance", async (_request, reply) => {
    if (!isX402Configured()) {
      return reply.status(200).send({ balance: "0.000000", available: "0.000000", chain: "arcTestnet" });
    }
    try {
      const balances = await getGatewayBalance();
      return reply.status(200).send({
        balance: balances.wallet,
        available: balances.gateway,
        chain: "arcTestnet",
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[status-routes] gateway-balance error: ${msg}`);
      return reply.status(200).send({ balance: "—", available: "—", chain: "arcTestnet" });
    }
  });

  /**
   * GET /arc-status
   * Checks Arc Testnet RPC connectivity via eth_blockNumber.
   * Always returns 200 so the UI can show connected/disconnected state.
   */
  app.get("/arc-status", async (_request, reply) => {
    try {
      const response = await fetch(config.arcRpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method: "eth_blockNumber", params: [], id: 1 }),
        signal: AbortSignal.timeout(5_000),
      });
      const json = (await response.json()) as RpcResponse;
      if (json.result) {
        const blockNumber = parseInt(json.result, 16).toString();
        return reply.status(200).send({ connected: true, blockNumber });
      }
      return reply.status(200).send({ connected: false });
    } catch {
      return reply.status(200).send({ connected: false });
    }
  });
}
