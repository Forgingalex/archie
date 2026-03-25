import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";
import { config } from "../config/env.js";
import type { PaymentEvent } from "../types/index.js";

function getClient() {
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
//
// NOTE: Arc Testnet is not yet in Circle's Blockchain enum. Using "ARC-TESTNET"
// as a string cast. Replace once Circle officially adds Arc Testnet support.
export async function initWallet(): Promise<InitWalletResult | null> {
  const client = getClient();
  if (!client) {
    console.warn("[x402] Circle credentials not configured — skipping wallet init");
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

    const agentWallet: WalletInfo = {
      id: wallets[0].id,
      address: wallets[0].address,
    };
    const validatorWallet: WalletInfo = {
      id: wallets[1].id,
      address: wallets[1].address,
    };

    console.log(`[x402] agent wallet:     ${agentWallet.address}  (id: ${agentWallet.id})`);
    console.log(`[x402] validator wallet: ${validatorWallet.address}  (id: ${validatorWallet.id})`);

    return { agentWallet, validatorWallet };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const responseData = (err as Record<string, unknown>)?.response
      ? JSON.stringify((err as Record<string, Record<string, unknown>>).response?.data, null, 2)
      : null;
    console.error(`[x402] initWallet failed: ${msg}`);
    if (responseData) console.error(`[x402] response data: ${responseData}`);
    return null;
  }
}

export async function getWalletBalance(walletId: string): Promise<unknown> {
  const client = getClient();
  if (!client) {
    console.warn("[x402] Circle credentials not configured — cannot fetch balance");
    return null;
  }

  try {
    const { data } = await client.getWalletTokenBalance({ id: walletId });
    return data?.tokenBalances ?? [];
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[x402] getWalletBalance(${walletId}) failed: ${msg}`);
    return null;
  }
}

export function isPaymentRequired(statusCode: number): boolean {
  return statusCode === 402;
}

// Detects a 402 response and extracts x402 payment details from headers.
// EIP-3009 authorization signing via the Circle agent wallet is not yet
// implemented — this returns paid: false until a paid connector is wired up.
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
