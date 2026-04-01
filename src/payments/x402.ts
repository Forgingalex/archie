import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";
import { GatewayClient } from "@circle-fin/x402-batching/client";
import { config } from "../config/env.js";
import type { PaymentEvent } from "../types/index.js";

// ── Circle Developer-Controlled Wallets (Arc identity) ─────────────────────

function getCircleClient() {
  if (!config.circleApiKey || !config.circleEntitySecret) return null;
  return initiateDeveloperControlledWalletsClient({
    apiKey: config.circleApiKey,
    entitySecret: config.circleEntitySecret,
  });
}

export interface WalletInfo {
  id: string;
  address: string;
}

export interface InitWalletResult {
  agentWallet: WalletInfo;
  validatorWallet: WalletInfo;
}

// Creates a wallet set named "archie-agent" and two SCA wallets.
// The agent wallet handles x402 micropayments; the validator wallet signs
// ERC-8004 reputation events on Arc.
export async function initWallet(): Promise<InitWalletResult | null> {
  const client = getCircleClient();
  if (!client) {
    console.warn("[circle] Circle credentials not configured — skipping wallet init");
    return null;
  }

  try {
    const { data: wsData } = await client.createWalletSet({
      name: "archie-agent",
    });
    const walletSetId = wsData?.walletSet?.id;
    if (!walletSetId) throw new Error("createWalletSet returned no walletSetId");

    const { data: walletsData } = await client.createWallets({
      idempotencyKey: crypto.randomUUID(),
      blockchains: ["ARC-TESTNET"] as unknown as Parameters<typeof client.createWallets>[0]["blockchains"],
      accountType: "SCA",
      count: 2,
      walletSetId,
    });

    const wallets = walletsData?.wallets ?? [];
    if (wallets.length < 2) {
      throw new Error(`Expected 2 wallets, got ${wallets.length}`);
    }

    const agentWallet: WalletInfo = { id: wallets[0].id, address: wallets[0].address };
    const validatorWallet: WalletInfo = { id: wallets[1].id, address: wallets[1].address };

    console.log(`[circle] agent wallet:     ${agentWallet.address}  (id: ${agentWallet.id})`);
    console.log(`[circle] validator wallet: ${validatorWallet.address}  (id: ${validatorWallet.id})`);

    return { agentWallet, validatorWallet };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const responseData = (err as Record<string, unknown>)?.response
      ? JSON.stringify((err as Record<string, Record<string, unknown>>).response?.data, null, 2)
      : null;
    console.error(`[circle] initWallet failed: ${msg}`);
    if (responseData) console.error(`[circle] response data: ${responseData}`);
    return null;
  }
}

export async function getWalletBalance(walletId: string): Promise<unknown> {
  const client = getCircleClient();
  if (!client) {
    console.warn("[circle] Circle credentials not configured — cannot fetch balance");
    return null;
  }

  try {
    const { data } = await client.getWalletTokenBalance({ id: walletId });
    return data?.tokenBalances ?? [];
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[circle] getWalletBalance(${walletId}) failed: ${msg}`);
    return null;
  }
}

export function isPaymentRequired(statusCode: number): boolean {
  return statusCode === 402;
}

export async function handleX402Payment(
  requestId: string,
  connector: string,
  statusCode: number,
  paymentHeaders: Record<string, string>,
): Promise<PaymentEvent> {
  const timestamp = new Date().toISOString();

  if (!isPaymentRequired(statusCode)) {
    return { requestId, connector, amount: "0", currency: "USDC", txHash: null, paid: false, timestamp };
  }

  const paymentDetails =
    paymentHeaders["x-payment-details"] ??
    paymentHeaders["x-payment"] ??
    paymentHeaders["x-accepts-payment"] ??
    "(no payment details header)";

  const amount = paymentHeaders["x-payment-amount"] ?? "0";
  const currency = paymentHeaders["x-payment-currency"] ?? "USDC";

  console.log(`[x402] payment required for connector="${connector}" requestId=${requestId} amount=${amount} ${currency} details=${paymentDetails}`);

  return { requestId, connector, amount, currency, txHash: null, paid: false, timestamp };
}

// ── Circle Nanopayments Gateway Client ─────────────────────────────────────
// Pays for x402-protected resources with USDC on Arc Testnet via Circle's
// Gateway batching protocol. Settlement is handled by Circle's facilitator.

let _gatewayClient: GatewayClient | null = null;

/**
 * Returns true if the Nanopayments wallet is configured.
 */
export function isX402Configured(): boolean {
  return config.x402PrivateKey.length > 0;
}

/**
 * Returns a lazily-initialized GatewayClient for Arc Testnet.
 * Throws if X402_PRIVATE_KEY is not set.
 */
export function getGatewayClient(): GatewayClient {
  if (!isX402Configured()) {
    throw new Error("X402_PRIVATE_KEY is not configured. Run: npx tsx scripts/generate-wallet.ts");
  }
  if (_gatewayClient) return _gatewayClient;

  _gatewayClient = new GatewayClient({
    chain: "arcTestnet",
    privateKey: config.x402PrivateKey as `0x${string}`,
  });

  console.log(`[x402] GatewayClient ready — wallet: ${_gatewayClient.address} — chain: arcTestnet`);
  return _gatewayClient;
}

/**
 * The EOA wallet address used for Nanopayments.
 * Null if X402_PRIVATE_KEY is not set.
 */
export function getX402WalletAddress(): string | null {
  if (!isX402Configured()) return null;
  try {
    return getGatewayClient().address;
  } catch {
    return null;
  }
}

/**
 * Pays for an x402-protected resource using Circle Nanopayments on Arc Testnet.
 * Handles the full 402 → sign → retry flow automatically via GatewayClient.
 */
export async function payForResource<T = unknown>(
  url: string,
): Promise<{ data: T; amount: string; transaction: string }> {
  const client = getGatewayClient();
  const result = await client.pay<T>(url);
  return {
    data: result.data,
    amount: result.formattedAmount,
    transaction: result.transaction,
  };
}

/**
 * Deposits USDC into the Circle Gateway Wallet on Arc Testnet.
 * Run once via: npm run deposit-gateway
 */
export async function depositToGateway(amount: string): Promise<void> {
  const client = getGatewayClient();
  const result = await client.deposit(amount);
  console.log(`[x402] deposited ${result.formattedAmount} USDC to Gateway — tx: ${result.depositTxHash}`);
}

/**
 * Returns the current wallet and Gateway balances.
 */
export async function getGatewayBalance(): Promise<{ wallet: string; gateway: string }> {
  const client = getGatewayClient();
  const balances = await client.getBalances();
  return {
    wallet: balances.wallet.formatted,
    gateway: balances.gateway.formattedAvailable,
  };
}
