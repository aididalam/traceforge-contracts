import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  keccak256,
  stringToHex,
  toHex,
  zeroAddress,
} from "viem";

import {
  privateKeyToAccount,
} from "viem/accounts";

import {
  readFileSync,
  existsSync,
  mkdirSync,
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
  ["http", "://", "127.0.0.1", ":", "8545"].join("");

const CHAIN_ID = 9009;

const deploymentPath =
  "deployments/9009/TraceForge.json";

const artifactPath =
  "artifacts/contracts/TraceForge.sol/TraceForge.json";

const metadataPath =
  process.env.TRACEFORGE_TENANT_METADATA_FILE ??
  "bootstrap/tenant-sandbox.json";

const bootstrapDir =
  "deployments/9009/bootstrap";

const bootstrapRecordPath =
  join(
    bootstrapDir,
    "tenant-traceforge-sandbox.json",
  );

const deployerKeyPath =
  process.env.TRACEFORGE_DEPLOYER_KEY_FILE ??
  join(
    homedir(),
    ".traceforge",
    "secrets",
    "traceforge-deployer.key",
  );

const tenantAdminKeyPath =
  process.env.TRACEFORGE_TENANT_ADMIN_KEY_FILE ??
  join(
    homedir(),
    ".traceforge",
    "secrets",
    "tenant-admin.key",
  );

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

const metadataBytes =
  readFileSync(metadataPath);

const metadata =
  JSON.parse(
    metadataBytes.toString("utf8"),
  );

if (
  typeof metadata.slug !== "string" ||
  metadata.slug.length === 0
) {
  throw new Error(
    "Tenant metadata must contain a non-empty slug.",
  );
}

const tenantId =
  keccak256(
    stringToHex(
      `traceforge:tenant:${metadata.slug}`,
    ),
  );

const metadataHash =
  keccak256(
    toHex(metadataBytes),
  );

const deployerPrivateKey =
  readFileSync(
    deployerKeyPath,
    "utf8",
  ).trim();

const tenantAdminPrivateKey =
  readFileSync(
    tenantAdminKeyPath,
    "utf8",
  ).trim();

if (
  !/^0x[0-9a-fA-F]{64}$/.test(
    deployerPrivateKey,
  )
) {
  throw new Error(
    "Invalid deployer private key.",
  );
}

if (
  !/^0x[0-9a-fA-F]{64}$/.test(
    tenantAdminPrivateKey,
  )
) {
  throw new Error(
    "Invalid tenant-admin private key.",
  );
}

const deployer =
  privateKeyToAccount(
    deployerPrivateKey,
  );

const tenantAdmin =
  privateKeyToAccount(
    tenantAdminPrivateKey,
  );

const chain =
  defineChain({
    id: CHAIN_ID,
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
    chain,
    transport: http(RPC_URL),
  });

const walletClient =
  createWalletClient({
    chain,
    transport: http(RPC_URL),
    account: deployer,
  });

const contractAddress =
  deployment.contract.address;

const [
  chainId,
  owner,
  code,
  currentTenant,
  currentAdminStatus,
] = await Promise.all([
  publicClient.getChainId(),

  publicClient.readContract({
    address: contractAddress,
    abi: artifact.abi,
    functionName: "owner",
  }),

  publicClient.getCode({
    address: contractAddress,
  }),

  publicClient.readContract({
    address: contractAddress,
    abi: artifact.abi,
    functionName: "getTenant",
    args: [tenantId],
  }).catch(() => null),

  publicClient.readContract({
    address: contractAddress,
    abi: artifact.abi,
    functionName: "isTenantAdmin",
    args: [
      tenantId,
      tenantAdmin.address,
    ],
  }).catch(() => false),
]);

if (chainId !== CHAIN_ID) {
  throw new Error(
    `Wrong chain: expected ${CHAIN_ID}, got ${chainId}`,
  );
}

if (!code || code === "0x") {
  throw new Error(
    "TraceForge contract is not deployed at manifest address.",
  );
}

if (
  String(owner).toLowerCase() !==
  deployer.address.toLowerCase()
) {
  throw new Error(
    "Deployer is not the current TraceForge owner.",
  );
}

if (
  tenantAdmin.address === zeroAddress
) {
  throw new Error(
    "Tenant admin cannot be zero address.",
  );
}

if (
  currentTenant?.exists === true
) {
  throw new Error(
    `Tenant already exists: ${tenantId}`,
  );
}

if (currentAdminStatus === true) {
  throw new Error(
    "Tenant-admin relationship already exists unexpectedly.",
  );
}

const gasEstimate =
  await publicClient.estimateContractGas({
    address: contractAddress,
    abi: artifact.abi,
    functionName: "createTenant",
    args: [
      tenantId,
      metadataHash,
      tenantAdmin.address,
    ],
    account: deployer.address,
    gasPrice: 0n,
  });

const gasLimit =
  (gasEstimate * 120n) / 100n;

console.log("TraceForge Tenant Bootstrap");
console.log("===========================");
console.log();

console.log(
  `Mode:          ${broadcast ? "BROADCAST" : "DRY RUN"}`,
);

console.log(
  `Chain ID:      ${chainId}`,
);

console.log(
  `Contract:      ${contractAddress}`,
);

console.log(
  `Owner:         ${owner}`,
);

console.log(
  `Tenant slug:   ${metadata.slug}`,
);

console.log(
  `Tenant ID:     ${tenantId}`,
);

console.log(
  `Metadata hash: ${metadataHash}`,
);

console.log(
  `Initial admin: ${tenantAdmin.address}`,
);

console.log(
  `Estimated gas: ${gasEstimate}`,
);

console.log(
  `Gas limit:     ${gasLimit}`,
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
    "Use --broadcast only after reviewing these values.",
  );

  process.exit(0);
}

if (
  existsSync(
    bootstrapRecordPath,
  )
) {
  throw new Error(
    `Bootstrap record already exists: ${bootstrapRecordPath}`,
  );
}

const hash =
  await walletClient.writeContract({
    address: contractAddress,
    abi: artifact.abi,
    functionName: "createTenant",
    args: [
      tenantId,
      metadataHash,
      tenantAdmin.address,
    ],
    account: deployer,
    gas: gasLimit,
    gasPrice: 0n,
  });

console.log(
  `Transaction:   ${hash}`,
);

const receipt =
  await publicClient.waitForTransactionReceipt({
    hash,
    confirmations: 1,
  });

if (
  receipt.status !== "success"
) {
  throw new Error(
    "Tenant bootstrap transaction failed.",
  );
}

const [
  createdTenant,
  adminActive,
] = await Promise.all([
  publicClient.readContract({
    address: contractAddress,
    abi: artifact.abi,
    functionName: "getTenant",
    args: [tenantId],
  }),

  publicClient.readContract({
    address: contractAddress,
    abi: artifact.abi,
    functionName: "isTenantAdmin",
    args: [
      tenantId,
      tenantAdmin.address,
    ],
  }),
]);

if (
  createdTenant.exists !== true
) {
  throw new Error(
    "Tenant read-back verification failed.",
  );
}

if (
  createdTenant.active !== true
) {
  throw new Error(
    "Created tenant is not active.",
  );
}

if (
  String(
    createdTenant.metadataHash,
  ).toLowerCase() !==
  metadataHash.toLowerCase()
) {
  throw new Error(
    "Tenant metadata hash mismatch.",
  );
}

if (adminActive !== true) {
  throw new Error(
    "Initial tenant admin verification failed.",
  );
}

const record = {
  schemaVersion: 1,

  network: {
    chainId,
  },

  contract: {
    address: contractAddress,
  },

  tenant: {
    slug: metadata.slug,
    tenantId,
    metadataHash,
    initialAdmin:
      tenantAdmin.address,
  },

  transaction: {
    hash,
    blockNumber:
      receipt.blockNumber.toString(),
    gasUsed:
      receipt.gasUsed.toString(),
  },

  verification: {
    exists:
      createdTenant.exists,
    active:
      createdTenant.active,
    initialAdminActive:
      adminActive,
  },
};

mkdirSync(
  bootstrapDir,
  {
    recursive: true,
  },
);

writeFileSync(
  bootstrapRecordPath,
  JSON.stringify(
    record,
    null,
    2,
  ) + "\n",
);

console.log();
console.log(
  "TENANT BOOTSTRAP SUCCESSFUL.",
);

console.log(
  `Tenant ID:     ${tenantId}`,
);

console.log(
  `Initial admin: ${tenantAdmin.address}`,
);

console.log(
  `Block:         ${receipt.blockNumber}`,
);

console.log(
  `Verified:      ${adminActive}`,
);

console.log(
  `Record:        ${bootstrapRecordPath}`,
);
