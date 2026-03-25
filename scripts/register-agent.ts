/**
 * One-time Arc agent registration script.
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/register-agent.ts
 *
 * What this does:
 *   1. Initialises two Circle developer-controlled wallets (agent + validator)
 *   2. Registers the agent on Arc Testnet via ERC-8004 IdentityRegistry
 *   3. Records an initial reputation event via ReputationRegistry
 *   4. Prints all values you need to add to your .env file
 *
 * Prerequisites:
 *   - CIRCLE_API_KEY and CIRCLE_ENTITY_SECRET set in .env
 *   - After wallets are created, fund both addresses from the Arc faucet:
 *     https://faucet.circle.com  (select Arc Testnet / chain ID 5042002)
 *   - Re-run this script after funding to complete the onchain registration
 */

import "dotenv/config";
import { initWallet } from "../src/payments/x402.js";
import { registerAgentOnchain, recordReputation } from "../src/identity/arc.js";

const METADATA_URI = "ipfs://archie-agent-v1";

async function main() {
  console.log("=".repeat(60));
  console.log("archie — Arc agent registration");
  console.log("=".repeat(60));

  // ── Step 1: Wallet setup ──────────────────────────────────────────────────
  const existingAgentId = process.env.ARC_AGENT_WALLET_ID;
  const existingValidatorId = process.env.ARC_VALIDATOR_WALLET_ID;

  let agentWalletId: string;
  let validatorWalletId: string;

  if (existingAgentId && existingValidatorId) {
    console.log("\n[1/3] Using existing wallets from .env");
    console.log(`  Agent wallet ID:     ${existingAgentId}`);
    console.log(`  Validator wallet ID: ${existingValidatorId}`);
    agentWalletId = existingAgentId;
    validatorWalletId = existingValidatorId;
  } else {
    console.log("\n[1/3] Initialising Circle developer-controlled wallets...");
    const wallets = await initWallet();

    if (!wallets) {
      console.error("\n✗ Wallet initialisation failed.");
      console.error("  Make sure CIRCLE_API_KEY and CIRCLE_ENTITY_SECRET are set in .env");
      process.exit(1);
    }

    console.log("\n  Wallets created successfully.");
    console.log(`  Agent wallet ID:     ${wallets.agentWallet.id}`);
    console.log(`  Agent wallet addr:   ${wallets.agentWallet.address}`);
    console.log(`  Validator wallet ID: ${wallets.validatorWallet.id}`);
    console.log(`  Validator wallet addr: ${wallets.validatorWallet.address}`);

    console.log("\n" + "─".repeat(60));
    console.log("ACTION REQUIRED — fund both wallet addresses before continuing:");
    console.log("  https://faucet.circle.com  (select Arc Testnet / chain ID 5042002)");
    console.log(`  1. Fund: ${wallets.agentWallet.address}`);
    console.log(`  2. Fund: ${wallets.validatorWallet.address}`);
    console.log("─".repeat(60));

    printEnvBlock(wallets.agentWallet.id, wallets.validatorWallet.id, null);
    console.log("\nAdd the wallet IDs to .env, then re-run this script.");
    process.exit(0);
  }

  // ── Step 2: Register on Arc Testnet ───────────────────────────────────────
  console.log("\n[2/3] Registering agent on Arc Testnet IdentityRegistry...");
  const identity = await registerAgentOnchain(METADATA_URI);

  if (!identity) {
    console.error("\n✗ Onchain registration failed. Check logs above for details.");
    printEnvBlock(agentWalletId, validatorWalletId, null);
    process.exit(1);
  }

  console.log("\n  Registration successful.");
  console.log(`  agentId:    ${identity.agentId}`);
  console.log(`  nerAddress: ${identity.nerAddress}`);

  // ── Step 3: Initial reputation event ─────────────────────────────────────
  console.log("\n[3/3] Recording initial reputation event...");
  const rep = await recordReputation(identity.agentId, 50, "init");

  if (!rep || !rep.txHash) {
    console.warn("  ⚠ Reputation event failed or not confirmed — non-fatal, continuing.");
  } else {
    console.log(`  Reputation recorded: txHash=${rep.txHash}`);
  }

  // ── Final: print .env block ───────────────────────────────────────────────
  printEnvBlock(agentWalletId, validatorWalletId, identity.agentId);
  console.log("\n✓ Registration complete.");
}

function printEnvBlock(
  agentWalletId: string,
  validatorWalletId: string,
  agentId: string | null,
) {
  console.log("\n" + "=".repeat(60));
  console.log("Add / update these values in your .env:");
  console.log("=".repeat(60));
  console.log(`ARC_AGENT_WALLET_ID=${agentWalletId}`);
  console.log(`ARC_VALIDATOR_WALLET_ID=${validatorWalletId}`);
  if (agentId) console.log(`ARC_AGENT_ID=${agentId}`);
  console.log("=".repeat(60));
}

main().catch((err) => {
  console.error("Unhandled error:", err);
  process.exit(1);
});
