import {
  createPublicClient,
  defineChain,
  http,
  keccak256,
} from "viem";

import {
  readFileSync,
} from "node:fs";

const RPC_URL =
  process.env.TRACEFORGE_RPC_URL ??
  ["http", "://", "127.0.0.1", ":", "8545"].join("");

const EXPECTED_CHAIN_ID = 9009;

const deploymentPath =
  "deployments/9009/TraceForge.json";

const artifactPath =
  "artifacts/contracts/TraceForge.sol/TraceForge.json";

const deployment =
  JSON.parse(
    readFileSync(
      deploymentPath,
      "utf8",
    ),
  );

const artifact =
  JSON.parse(
    readFileSync(
      artifactPath,
      "utf8",
    ),
  );

const contractAddress =
  deployment.contract.address;

const chain =
  defineChain({
    id: EXPECTED_CHAIN_ID,
    name: "TraceForge",
    nativeCurrency: {
      name: "TraceForge Ether",
      symbol: "ETH",
      decimals: 18,
    },
    rpcUrls: {
      default: {
        http: [RPC_URL],
      },
    },
  });

const client =
  createPublicClient({
    chain,
    transport: http(RPC_URL),
  });

const [
  chainId,
  blockNumber,
  code,
  owner,
  pendingOwner,
] = await Promise.all([
  client.getChainId(),

  client.getBlockNumber(),

  client.getCode({
    address: contractAddress,
  }),

  client.readContract({
    address: contractAddress,
    abi: artifact.abi,
    functionName: "owner",
  }),

  client.readContract({
    address: contractAddress,
    abi: artifact.abi,
    functionName: "pendingOwner",
  }),
]);

if (!code || code === "0x") {
  throw new Error(
    "No contract bytecode found at deployment address.",
  );
}

const deployedRuntimeHash =
  keccak256(code);

const expectedRuntimeHash =
  deployment.artifact.expectedRuntimeHash;

const checks = {
  chainId:
    chainId === EXPECTED_CHAIN_ID,

  addressHasCode:
    code !== "0x",

  runtimeHash:
    deployedRuntimeHash.toLowerCase() ===
    expectedRuntimeHash.toLowerCase(),

  owner:
    String(owner).toLowerCase() ===
    deployment.contract.owner.toLowerCase(),

  pendingOwner:
    String(pendingOwner).toLowerCase() ===
    deployment.contract.pendingOwner.toLowerCase(),
};

console.log("TraceForge Live Deployment Verification");
console.log("=======================================");
console.log();

console.log(`RPC:           ${RPC_URL}`);
console.log(`Chain ID:      ${chainId}`);
console.log(`Latest block:  ${blockNumber}`);
console.log(`Contract:      ${contractAddress}`);
console.log(`Owner:         ${owner}`);
console.log(`Pending owner: ${pendingOwner}`);
console.log();

console.log(`Runtime hash:  ${deployedRuntimeHash}`);
console.log();

for (const [name, passed] of Object.entries(checks)) {
  console.log(
    `${passed ? "PASS" : "FAIL"}  ${name}`,
  );
}

const failed =
  Object.entries(checks)
    .filter(([, passed]) => !passed)
    .map(([name]) => name);

if (failed.length > 0) {
  console.error();
  console.error(
    `Verification failed: ${failed.join(", ")}`,
  );

  process.exit(1);
}

console.log();
console.log(
  "PASS: deployed TraceForge contract is verified.",
);
