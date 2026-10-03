import {
  createPublicClient,
  http,
  formatEther,
} from "viem";

import {
  privateKeyToAccount,
} from "viem/accounts";

import {
  readFileSync,
} from "node:fs";

import {
  homedir,
} from "node:os";

import {
  join,
} from "node:path";

const RPC_URL =
  process.env.TRACEFORGE_RPC_URL ??
  ["http", "://", "127.0.0.1", ":", "8545"].join("");

const EXPECTED_CHAIN_ID = 9009;

const keyPath =
  process.env.TRACEFORGE_DEPLOYER_KEY_FILE ??
  join(
    homedir(),
    ".traceforge",
    "secrets",
    "traceforge-deployer.key",
  );

const privateKey =
  readFileSync(keyPath, "utf8").trim();

if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
  throw new Error(
    "Deployer key file does not contain a valid Ethereum private key.",
  );
}

const account =
  privateKeyToAccount(privateKey);

const client =
  createPublicClient({
    transport: http(RPC_URL),
  });

const [
  chainId,
  blockNumber,
  balance,
  gasPrice,
  block,
] = await Promise.all([
  client.getChainId(),
  client.getBlockNumber(),
  client.getBalance({
    address: account.address,
  }),
  client.getGasPrice(),
  client.getBlock({
    blockTag: "latest",
  }),
]);

console.log("TraceForge Chain Preflight");
console.log("==========================");
console.log();

console.log(`RPC:          ${RPC_URL}`);
console.log(`Chain ID:     ${chainId}`);
console.log(`Latest block: ${blockNumber}`);
console.log(`Deployer:     ${account.address}`);
console.log(`Balance:      ${formatEther(balance)} ETH`);
console.log(`Gas price:    ${gasPrice} wei`);
console.log(
  `Base fee:     ${block.baseFeePerGas ?? "not reported"} wei`,
);

console.log();

if (chainId !== EXPECTED_CHAIN_ID) {
  console.error(
    `FAIL: expected chain ${EXPECTED_CHAIN_ID}, got ${chainId}`,
  );
  process.exit(1);
}

if (gasPrice !== 0n) {
  console.error(
    `FAIL: expected zero gas price, got ${gasPrice}`,
  );
  process.exit(1);
}

if (
  block.baseFeePerGas !== null &&
  block.baseFeePerGas !== undefined &&
  block.baseFeePerGas !== 0n
) {
  console.error(
    `FAIL: expected zero base fee, got ${block.baseFeePerGas}`,
  );
  process.exit(1);
}

console.log(
  "PASS: TraceForge chain preflight succeeded.",
);
