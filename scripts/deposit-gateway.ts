/**
 * deposit-gateway.ts
 *
 * One-time script to deposit USDC into Circle's Gateway Wallet on Arc Testnet.
 * The Gateway balance is what Archie draws from when making Nanopayments.
 *
 * Prerequisites:
 *   1. X402_PRIVATE_KEY is set in .env (run: npx tsx scripts/generate-wallet.ts)
 *   2. The wallet has USDC on Arc Testnet (from the Arc Testnet faucet)
 *
 * Usage:
 *   npm run deposit-gateway [amount]
 *
 * Examples:
 *   npm run deposit-gateway          # deposits 10 USDC (default)
 *   npm run deposit-gateway 1        # deposits 1 USDC
 *   npm run deposit-gateway 50       # deposits 50 USDC
 */

import "dotenv/config";
import { GatewayClient } from "@circle-fin/x402-batching/client";

const PRIVATE_KEY = process.env.X402_PRIVATE_KEY;

if (!PRIVATE_KEY) {
  console.error("X402_PRIVATE_KEY is not set in .env");
  console.error("Run: npx tsx scripts/generate-wallet.ts");
  process.exit(1);
}

const depositAmount = process.argv[2] ?? "10";

async function main(): Promise<void> {
  const client = new GatewayClient({
    chain: "arcTestnet",
    privateKey: PRIVATE_KEY as `0x${string}`,
  });

  console.log(`\nCircle Gateway Deposit — Arc Testnet`);
  console.log(`Wallet:  ${client.address}`);
  console.log(`Amount:  ${depositAmount} USDC\n`);

  // Show current balances before deposit
  const before = await client.getBalances();
  console.log(`Before deposit:`);
  console.log(`  Wallet USDC:  ${before.wallet.formatted}`);
  console.log(`  Gateway USDC: ${before.gateway.formattedAvailable} (available)`);

  if (parseFloat(before.wallet.formatted) < parseFloat(depositAmount)) {
    console.error(`\nInsufficient wallet balance (${before.wallet.formatted} USDC).`);
    console.error(`Fund this address with USDC on Arc Testnet: ${client.address}`);
    process.exit(1);
  }

  console.log(`\nDepositing ${depositAmount} USDC to Circle Gateway...`);

  const result = await client.deposit(depositAmount);

  console.log(`\nDeposit successful!`);
  console.log(`  Tx hash:    ${result.depositTxHash}`);
  console.log(`  Deposited:  ${result.formattedAmount} USDC`);

  // Show updated balances
  const after = await client.getBalances();
  console.log(`\nAfter deposit:`);
  console.log(`  Wallet USDC:  ${after.wallet.formatted}`);
  console.log(`  Gateway USDC: ${after.gateway.formattedAvailable} (available)`);
  console.log(`\nArchie is ready to make Nanopayments on Arc Testnet.`);
}

main().catch((err) => {
  console.error("Deposit failed:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
