import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const privateKey = generatePrivateKey();
const account = privateKeyToAccount(privateKey);

console.log("\n=== Archie x402 Payment Wallet Generator ===\n");
console.log(`Private Key:  ${privateKey}`);
console.log(`Address:      ${account.address}`);
console.log("\nNext steps:");
console.log(`  1. Save to .env:`);
console.log(`     X402_PRIVATE_KEY=${privateKey}`);
console.log(`\n  2. Fund with testnet USDC on Base Sepolia:`);
console.log(`     https://faucet.circle.com`);
console.log(`     Network: Base Sepolia`);
console.log(`     Address: ${account.address}`);
console.log(`\n  3. Restart Archie\n`);
