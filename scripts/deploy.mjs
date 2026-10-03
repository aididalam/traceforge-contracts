import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  keccak256,
} from "viem";

import {
  privateKeyToAccount,
} from "viem/accounts";

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";

import {
  homedir,
} from "node:os";

import {
  join,
} from "node:path";

const broadcast =
  process.argv.includes("--broadcast");

const RPC_URL =
  process.env.TRACEFORGE_RPC_URL ??
  [
    "http",
    "://",
    "127.0.0.1",
    ":",
    "8545",
  ].join("");

const EXPECTED_CHAIN_ID = 9009;

const keyPath =
  process.env.TRACEFORGE_DEPLOYER_KEY_FILE ??
  join(
    homedir(),
    ".traceforge",
    "secrets",
    "traceforge-deployer.key",
  );

const artifactPath =
  "artifacts/contracts/TraceForge.sol/TraceForge.json";

const deploymentDir =
  "deployments/9009";

const deploymentPath =
  join(
    deploymentDir,
    "TraceForge.json",
  );

const artifact =
  JSON.parse(
    readFileSync(
      artifactPath,
      "utf8",
    ),
  );

const bytecode =
  artifact.bytecode;

const deployedBytecode =
  artifact.deployedBytecode;

if (
  typeof bytecode !== "string" ||
  !bytecode.startsWith("0x")
) {
  throw new Error(
    "Artifact creation bytecode is invalid.",
  );
}

if (
  typeof deployedBytecode !== "string" ||
  !deployedBytecode.startsWith("0x")
) {
  throw new Error(
    "Artifact runtime bytecode is invalid.",
  );
}

const privateKey =
  readFileSync(
    keyPath,
    "utf8",
  ).trim();

if (
  !/^0x[0-9a-fA-F]{64}$/.test(
    privateKey,
  )
) {
  throw new Error(
    "Invalid deployer private key file.",
  );
}

const account =
  privateKeyToAccount(
    privateKey,
  );

const traceForgeChain =
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

const publicClient =
  createPublicClient({
    chain: traceForgeChain,
    transport: http(RPC_URL),
  });

const walletClient =
  createWalletClient({
    account,
    chain: traceForgeChain,
    transport: http(RPC_URL),
  });

const [
  chainId,
  gasPrice,
  latestBlock,
  balance,
] = await Promise.all([
  publicClient.getChainId(),
  publicClient.getGasPrice(),
  publicClient.getBlock({
    blockTag: "latest",
  }),
  publicClient.getBalance({
    address: account.address,
  }),
]);

if (
  chainId !== EXPECTED_CHAIN_ID
) {
  throw new Error(
    `Wrong chain: expected ${EXPECTED_CHAIN_ID}, got ${chainId}`,
  );
}

if (gasPrice !== 0n) {
  throw new Error(
    `Expected zero gas price, got ${gasPrice}`,
  );
}

if (
  latestBlock.baseFeePerGas !== null &&
  latestBlock.baseFeePerGas !== undefined &&
  latestBlock.baseFeePerGas !== 0n
) {
  throw new Error(
    `Expected zero base fee, got ${latestBlock.baseFeePerGas}`,
  );
}

const gasEstimate =
  await publicClient.estimateGas({
    account: account.address,
    data: bytecode,
    gasPrice: 0n,
  });

const gasLimit =
  (gasEstimate * 120n) / 100n;

const creationBytes =
  (bytecode.length - 2) / 2;

const runtimeBytes =
  (deployedBytecode.length - 2) / 2;

console.log(
  "TraceForge Deployment",
);

console.log(
  "=====================",
);

console.log();

console.log(
  `Mode:             ${broadcast ? "BROADCAST" : "DRY RUN"}`,
);

console.log(
  `Chain ID:         ${chainId}`,
);

console.log(
  `Latest block:     ${latestBlock.number}`,
);

console.log(
  `Deployer:         ${account.address}`,
);

console.log(
  `Balance:          ${balance} wei`,
);

console.log(
  `Gas price:        ${gasPrice} wei`,
);

console.log(
  `Estimated gas:    ${gasEstimate}`,
);

console.log(
  `Gas limit:        ${gasLimit}`,
);

console.log(
  `Creation bytes:   ${creationBytes}`,
);

console.log(
  `Runtime bytes:    ${runtimeBytes}`,
);

console.log(
  `Runtime hash:     ${keccak256(deployedBytecode)}`,
);

console.log();

if (!broadcast) {
  console.log(
    "DRY RUN PASSED.",
  );

  console.log(
    "No transaction was sent.",
  );

  console.log(
    "Use --broadcast to perform the real deployment.",
  );

  process.exit(0);
}

if (
  existsSync(deploymentPath)
) {
  throw new Error(
    `Deployment record already exists: ${deploymentPath}`,
  );
}

console.log(
  "Broadcasting deployment transaction...",
);

const transactionHash =
  await walletClient.deployContract({
    abi: artifact.abi,
    bytecode,
    account,
    gas: gasLimit,
    gasPrice: 0n,
  });

console.log(
  `Transaction:      ${transactionHash}`,
);

const receipt =
  await publicClient.waitForTransactionReceipt({
    hash: transactionHash,
    confirmations: 1,
  });

if (
  receipt.status !== "success"
) {
  throw new Error(
    `Deployment transaction failed: ${transactionHash}`,
  );
}

if (
  !receipt.contractAddress
) {
  throw new Error(
    "Receipt does not contain a contract address.",
  );
}

const contractAddress =
  receipt.contractAddress;

const deployedCode =
  await publicClient.getCode({
    address: contractAddress,
  });

if (
  !deployedCode ||
  deployedCode === "0x"
) {
  throw new Error(
    "No runtime bytecode found at deployed address.",
  );
}

const runtimeMatches =
  deployedCode.toLowerCase() ===
  deployedBytecode.toLowerCase();

if (!runtimeMatches) {
  throw new Error(
    "Deployed runtime bytecode does not match local artifact.",
  );
}

const [
  owner,
  pendingOwner,
  deploymentBlock,
] = await Promise.all([
  publicClient.readContract({
    address: contractAddress,
    abi: artifact.abi,
    functionName: "owner",
  }),

  publicClient.readContract({
    address: contractAddress,
    abi: artifact.abi,
    functionName: "pendingOwner",
  }),

  publicClient.getBlock({
    blockNumber:
      receipt.blockNumber,
  }),
]);

if (
  String(owner).toLowerCase() !==
  account.address.toLowerCase()
) {
  throw new Error(
    "Deployed owner does not match deployer address.",
  );
}

const record = {
  schemaVersion: 1,

  network: {
    name: "TraceForge",
    chainId,
  },

  contract: {
    name: "TraceForge",
    address: contractAddress,
    owner,
    pendingOwner,
  },

  deployment: {
    deployer:
      account.address,

    transactionHash,

    blockNumber:
      receipt.blockNumber.toString(),

    blockTimestamp:
      deploymentBlock.timestamp.toString(),

    deployedAt:
      new Date(
        Number(
          deploymentBlock.timestamp,
        ) * 1000,
      ).toISOString(),

    gasUsed:
      receipt.gasUsed.toString(),

    effectiveGasPrice:
      receipt.effectiveGasPrice?.toString() ??
      null,
  },

  artifact: {
    creationBytes,
    runtimeBytes,

    expectedRuntimeHash:
      keccak256(
        deployedBytecode,
      ),

    deployedRuntimeHash:
      keccak256(
        deployedCode,
      ),

    runtimeMatches,
  },
};

mkdirSync(
  deploymentDir,
  {
    recursive: true,
  },
);

writeFileSync(
  deploymentPath,
  JSON.stringify(
    record,
    null,
    2,
  ) + "\n",
);

console.log();

console.log(
  "DEPLOYMENT SUCCESSFUL.",
);

console.log(
  `Contract:         ${contractAddress}`,
);

console.log(
  `Owner:            ${owner}`,
);

console.log(
  `Pending owner:    ${pendingOwner}`,
);

console.log(
  `Block:            ${receipt.blockNumber}`,
);

console.log(
  `Gas used:         ${receipt.gasUsed}`,
);

console.log(
  `Runtime verified: ${runtimeMatches}`,
);

console.log(
  `Record:           ${deploymentPath}`,
);
