import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";
import { createPublicClient, http, parseAbiItem, keccak256, toHex } from "viem";
import { config } from "../config/env.js";
import type { ArcAgentIdentity, ReputationEvent } from "../types/index.js";

const IDENTITY_REGISTRY = "0x8004A818BFB912233c491871b3d84c89A494BD9e" as const;
const REPUTATION_REGISTRY = "0x8004B663056A597Dffe9eCcC1965A193B7388713" as const;

const arcTestnet = {
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USD", symbol: "USD", decimals: 18 },
  rpcUrls: { default: { http: [config.arcRpcUrl] } },
} as const;

function getClient() {
  if (!config.circleApiKey || !config.circleEntitySecret) return null;
  return initiateDeveloperControlledWalletsClient({
    apiKey: config.circleApiKey,
    entitySecret: config.circleEntitySecret,
  });
}

function getPublicClient() {
  return createPublicClient({
    chain: arcTestnet,
    transport: http(config.arcRpcUrl),
  });
}

async function pollTransaction(
  client: ReturnType<typeof initiateDeveloperControlledWalletsClient>,
  txId: string,
  label: string,
  maxPolls = 30,
): Promise<string | null> {
  const TERMINAL = new Set(["COMPLETE", "FAILED", "CANCELLED", "DENIED"]);
  const MAX_POLLS = maxPolls;
  const INTERVAL_MS = 3_000;

  for (let i = 0; i < MAX_POLLS; i++) {
    await new Promise((r) => setTimeout(r, INTERVAL_MS));

    const { data } = await client.getTransaction({ id: txId });
    const tx = data?.transaction;
    const state = tx?.state ?? "UNKNOWN";

    console.log(`[arc] ${label} — poll ${i + 1}: state=${state}`);

    if (TERMINAL.has(state)) {
      if (state === "COMPLETE") return tx?.txHash ?? null;
      console.error(`[arc] ${label} — transaction ended with state=${state}`);
      return null;
    }
  }

  console.error(`[arc] ${label} — timed out waiting for transaction ${txId}`);
  return null;
}

export async function registerAgentOnchain(
  metadataUri: string,
): Promise<ArcAgentIdentity | null> {
  const client = getClient();
  if (!client) {
    console.warn("[arc] Circle credentials not configured — skipping onchain registration");
    return null;
  }

  if (!config.arcAgentWalletId) {
    console.warn("[arc] ARC_AGENT_WALLET_ID not set — run scripts/register-agent.ts first");
    return null;
  }

  try {
    console.log(`[arc] registering agent with metadataUri="${metadataUri}"`);

    const idempotencyKey = crypto.randomUUID();
    const callCreate = () => client.createContractExecutionTransaction({
      idempotencyKey,
      walletId: config.arcAgentWalletId,
      contractAddress: IDENTITY_REGISTRY,
      abiFunctionSignature: "register(string)",
      abiParameters: [metadataUri],
      fee: { type: "level", config: { feeLevel: "MEDIUM" } },
    });

    let createResult: Awaited<ReturnType<typeof callCreate>>;
    try {
      createResult = await callCreate();
    } catch {
      console.warn("[arc] register: first attempt failed, retrying in 3s...");
      await new Promise((r) => setTimeout(r, 3_000));
      createResult = await callCreate();
    }

    const txId = createResult.data?.id;
    if (!txId) throw new Error("createContractExecutionTransaction returned no transaction id");

    console.log(`[arc] registration transaction submitted: ${txId}`);

    const txHash = await pollTransaction(client, txId, "register");
    if (!txHash) throw new Error("Registration transaction did not complete");

    console.log(`[arc] registration confirmed: txHash=${txHash}`);

    const publicClient = getPublicClient();
    const receipt = await publicClient.getTransactionReceipt({ hash: txHash as `0x${string}` });
    const transferEvent = parseAbiItem(
      "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
    );

    const logs = await publicClient.getLogs({
      address: IDENTITY_REGISTRY,
      event: transferEvent,
      fromBlock: receipt.blockNumber,
      toBlock: receipt.blockNumber,
    });

    if (logs.length === 0) throw new Error("No Transfer event found in registration receipt");

    const agentId = String(logs[0].args.tokenId ?? "");
    const nerAddress = String(logs[0].args.to ?? "");

    console.log(`[arc] agentId=${agentId}  nerAddress=${nerAddress}`);

    const { data: walletData } = await client.getWallet({ id: config.arcAgentWalletId });
    const walletAddress = walletData?.wallet?.address ?? "";

    return {
      agentId,
      nerAddress,
      walletId: config.arcAgentWalletId,
      walletAddress,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[arc] registerAgentOnchain failed: ${msg}`);
    return null;
  }
}

export async function recordReputation(
  agentId: string,
  score: number,
  tag: string,
): Promise<ReputationEvent | null> {
  const client = getClient();
  if (!client) {
    console.warn("[arc] Circle credentials not configured — skipping reputation event");
    return null;
  }

  if (!config.arcValidatorWalletId) {
    console.warn("[arc] ARC_VALIDATOR_WALLET_ID not set — skipping reputation event");
    return null;
  }

  try {
    console.log(`[arc] recording reputation: agentId=${agentId} score=${score} tag="${tag}"`);

    // Sanity-check: log the actual address of the wallet submitting this tx
    // so we can verify it matches the funded wallet in the env.
    try {
      const { data: vWalletData } = await client.getWallet({ id: config.arcValidatorWalletId });
      const vAddress = vWalletData?.wallet?.address ?? "(unknown)";
      console.log(`[arc] validator wallet address: ${vAddress}  (id: ${config.arcValidatorWalletId})`);
    } catch (walletErr) {
      const walletMsg = walletErr instanceof Error ? walletErr.message : String(walletErr);
      console.warn(`[arc] could not fetch validator wallet address: ${walletMsg}`);
    }

    // keccak256 of the tag string, used as the bytes32 identifier
    const tagHash = keccak256(toHex(tag));

    const { data: txData } = await client.createContractExecutionTransaction({
      idempotencyKey: crypto.randomUUID(),
      walletId: config.arcValidatorWalletId,
      contractAddress: REPUTATION_REGISTRY,
      // Full ReputationRegistry ABI: agentId, score (int128), decimals (uint8),
      // tag, empty description/uri/extra fields, tagHash (bytes32)
      abiFunctionSignature: "giveFeedback(uint256,int128,uint8,string,string,string,string,bytes32)",
      abiParameters: [agentId, String(score), "0", tag, "", "", "", tagHash],
      fee: { type: "level", config: { feeLevel: "MEDIUM" } },
    });

    const txId = txData?.id;
    if (!txId) throw new Error("createContractExecutionTransaction returned no transaction id");

    // 30s max for reputation events (10 polls × 3s) — never block the response
    const txHash = await pollTransaction(client, txId, "giveFeedback", 10);
    const timestamp = new Date().toISOString();

    if (!txHash) {
      console.error(`[arc] reputation transaction failed for agentId=${agentId}`);
      return { agentId, score, tag, txHash: null, timestamp };
    }

    console.log(`[arc] reputation recorded: txHash=${txHash}`);
    return { agentId, score, tag, txHash, timestamp };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[arc] recordReputation failed: ${msg}`);
    return null;
  }
}
