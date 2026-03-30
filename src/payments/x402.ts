import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";
import axios, { type AxiosInstance } from "axios";
import { privateKeyToAccount } from "viem/accounts";
import { x402Client, wrapAxiosWithPayment } from "@x402/axios";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
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

// ── EOA x402 Payment Client (autonomous micropayments) ─────────────────────

// Lazily initialized — built on first call to getX402AxiosClient().
let _x402Client: AxiosInstance | null = null;
let _x402WalletAddress: string | null = null;

/**
 * Returns true if the EOA x402 payment wallet is configured.
 */
export function isX402Configured(): boolean {
  return config.x402PrivateKey.length > 0;
}

/**
 * The EOA wallet address used for x402 payments.
 * Null if X402_PRIVATE_KEY is not set.
 */
export function getX402WalletAddress(): string | null {
  if (!isX402Configured()) return null;
  if (_x402WalletAddress) return _x402WalletAddress;

  try {
    const account = privateKeyToAccount(config.x402PrivateKey as `0x${string}`);
    _x402WalletAddress = account.address;
    return _x402WalletAddress;
  } catch {
    return null;
  }
}

/**
 * Returns an axios instance that automatically handles x402 (HTTP 402) payment
 * challenges using the configured EOA wallet.
 *
 * On receiving a 402, the interceptor:
 *   1. Parses the PAYMENT-REQUIRED header for payment details
 *   2. Signs an EIP-3009 transferWithAuthorization using the EOA wallet
 *   3. Retries the request with the X-PAYMENT header attached
 *
 * Throws if X402_PRIVATE_KEY is not configured.
 */
export function getX402AxiosClient(): AxiosInstance {
  if (!isX402Configured()) {
    throw new Error("X402_PRIVATE_KEY is not configured. Run: npx tsx scripts/generate-wallet.ts");
  }

  if (_x402Client) return _x402Client;

  const account = privateKeyToAccount(config.x402PrivateKey as `0x${string}`);
  _x402WalletAddress = account.address;

  // Build the x402 client and register the EVM payment scheme.
  // registerExactEvmScheme handles both v1 and v2 of the protocol,
  // and registers for all supported EVM networks including base-sepolia.
  const client = new x402Client();
  registerExactEvmScheme(client, { signer: account });

  // Wrap a fresh axios instance so 402 responses are handled transparently.
  const axiosInstance = axios.create({ timeout: 15_000 });
  wrapAxiosWithPayment(axiosInstance, client);

  _x402Client = axiosInstance;

  console.log(`[x402] payment client ready — wallet: ${account.address} — network: ${config.x402Network}`);
  return _x402Client;
}
