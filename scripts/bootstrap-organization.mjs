import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  keccak256,
  stringToHex,
  toHex,
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
  ["http", "://", "127.0.0.1", ":", "8545"].join("");

const CHAIN_ID = 9009;

const deploymentPath =
  "deployments/9009/TraceForge.json";

const tenantRecordPath =
  "deployments/9009/bootstrap/tenant-traceforge-sandbox.json";

const organizationMetadataPath =
  "bootstrap/organization-sandbox-producer.json";

const roleMetadataPath =
  "bootstrap/role-sandbox-producer.json";

const artifactPath =
  "artifacts/contracts/TraceForge.sol/TraceForge.json";

const recordPath =
  "deployments/9009/bootstrap/organization-sandbox-producer.json";

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

const producerKeyPath =
  process.env.TRACEFORGE_PRODUCER_KEY_FILE ??
  join(
    homedir(),
    ".traceforge",
    "secrets",
    "sandbox-producer.key",
  );

const CAPABILITIES = [
  {
    name: "ENTITY_CREATE",
    value: 0,
  },
  {
    name: "TRACE_RECORD",
    value: 1,
  },
  {
    name: "STATE_UPDATE",
    value: 2,
  },
  {
    name: "METADATA_UPDATE",
    value: 3,
  },
  {
    name: "CUSTODY_TRANSFER",
    value: 4,
  },
  {
    name: "ENTITY_LINK",
    value: 5,
  },
  {
    name: "ENTITY_CLOSE",
    value: 6,
  },
];

function loadJson(path) {
  return JSON.parse(
    readFileSync(path, "utf8"),
  );
}

function readPrivateKey(path) {
  const key =
    readFileSync(path, "utf8").trim();

  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error(
      `Invalid private key file: ${path}`,
    );
  }

  return key;
}

function bytes32Equal(a, b) {
  return (
    String(a).toLowerCase() ===
    String(b).toLowerCase()
  );
}

const deployment =
  loadJson(deploymentPath);

const tenantRecord =
  loadJson(tenantRecordPath);

const artifact =
  loadJson(artifactPath);

const organizationMetadataBytes =
  readFileSync(
    organizationMetadataPath,
  );

const organizationMetadata =
  JSON.parse(
    organizationMetadataBytes.toString(
      "utf8",
    ),
  );

const roleMetadataBytes =
  readFileSync(
    roleMetadataPath,
  );

const roleMetadata =
  JSON.parse(
    roleMetadataBytes.toString(
      "utf8",
    ),
  );

const expectedCapabilityNames =
  CAPABILITIES.map(
    (capability) => capability.name,
  );

if (
  JSON.stringify(
    roleMetadata.capabilities,
  ) !==
  JSON.stringify(
    expectedCapabilityNames,
  )
) {
  throw new Error(
    "Role metadata capability list does not match bootstrap policy.",
  );
}

const tenantId =
  tenantRecord.tenant.tenantId;

const organizationId =
  keccak256(
    stringToHex(
      `traceforge:organization:${organizationMetadata.slug}`,
    ),
  );

const roleId =
  keccak256(
    stringToHex(
      `traceforge:role:${roleMetadata.slug}`,
    ),
  );

const organizationMetadataHash =
  keccak256(
    toHex(
      organizationMetadataBytes,
    ),
  );

const roleMetadataHash =
  keccak256(
    toHex(
      roleMetadataBytes,
    ),
  );

const deployer =
  privateKeyToAccount(
    readPrivateKey(
      deployerKeyPath,
    ),
  );

const tenantAdmin =
  privateKeyToAccount(
    readPrivateKey(
      tenantAdminKeyPath,
    ),
  );

const producer =
  privateKeyToAccount(
    readPrivateKey(
      producerKeyPath,
    ),
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

const ownerClient =
  createWalletClient({
    chain,
    transport: http(RPC_URL),
    account: deployer,
  });

const tenantAdminClient =
  createWalletClient({
    chain,
    transport: http(RPC_URL),
    account: tenantAdmin,
  });

const contractAddress =
  deployment.contract.address;

function functionAbi(name) {
  const fn =
    artifact.abi.find(
      (item) =>
        item.type === "function" &&
        item.name === name,
    );

  if (!fn) {
    throw new Error(
      `ABI function not found: ${name}`,
    );
  }

  return fn;
}

function tupleToObject(
  functionName,
  value,
) {
  if (value === null) {
    return null;
  }

  const fn =
    functionAbi(functionName);

  const components =
    fn.outputs?.[0]?.components;

  if (!components?.length) {
    throw new Error(
      `No tuple components found for ${functionName}`,
    );
  }

  const result = {};

  for (
    let index = 0;
    index < components.length;
    index += 1
  ) {
    const component =
      components[index];

    const name =
      component.name;

    result[name] =
      value?.[name] ??
      value?.[index];
  }

  return result;
}

async function readTuple(
  functionName,
  args,
) {
  try {
    const value =
      await publicClient.readContract({
        address: contractAddress,
        abi: artifact.abi,
        functionName,
        args,
      });

    return tupleToObject(
      functionName,
      value,
    );
  } catch {
    return null;
  }
}

async function sendTransaction({
  label,
  client,
  account,
  functionName,
  args,
}) {
  const estimate =
    await publicClient.estimateContractGas({
      address: contractAddress,
      abi: artifact.abi,
      functionName,
      args,
      account: account.address,
      gasPrice: 0n,
    });

  const gas =
    (estimate * 120n) / 100n;

  console.log();
  console.log(
    `${label}`,
  );

  console.log(
    `  estimated gas: ${estimate}`,
  );

  console.log(
    `  gas limit:     ${gas}`,
  );

  const hash =
    await client.writeContract({
      address: contractAddress,
      abi: artifact.abi,
      functionName,
      args,
      account,
      gas,
      gasPrice: 0n,
    });

  console.log(
    `  transaction:   ${hash}`,
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
      `${label} transaction failed.`,
    );
  }

  console.log(
    `  block:         ${receipt.blockNumber}`,
  );

  return {
    hash,
    blockNumber:
      receipt.blockNumber.toString(),
    gasUsed:
      receipt.gasUsed.toString(),
  };
}

const [
  chainId,
  contractOwner,
  code,
  tenantAdminActive,
  tenant,
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
    functionName: "isTenantAdmin",
    args: [
      tenantId,
      tenantAdmin.address,
    ],
  }),

  publicClient.readContract({
    address: contractAddress,
    abi: artifact.abi,
    functionName: "getTenant",
    args: [tenantId],
  }),
]);

if (
  chainId !== CHAIN_ID
) {
  throw new Error(
    `Wrong chain: expected ${CHAIN_ID}, got ${chainId}`,
  );
}

if (
  !code ||
  code === "0x"
) {
  throw new Error(
    "TraceForge contract code not found.",
  );
}

if (
  contractOwner.toLowerCase() !==
  deployer.address.toLowerCase()
) {
  throw new Error(
    "Configured deployer is not current platform owner.",
  );
}

if (
  tenantAdminActive !== true
) {
  throw new Error(
    "Configured tenant-admin wallet is not an active tenant admin.",
  );
}

const tenantState =
  tupleToObject(
    "getTenant",
    tenant,
  );

if (
  tenantState.active !== true
) {
  throw new Error(
    "Sandbox tenant is not active.",
  );
}

let organization =
  await readTuple(
    "getOrganization",
    [organizationId],
  );

let walletBinding =
  await readTuple(
    "getWalletBinding",
    [producer.address],
  );

let membership =
  await readTuple(
    "getTenantMembership",
    [
      tenantId,
      organizationId,
    ],
  );

let role =
  await readTuple(
    "getRole",
    [
      tenantId,
      roleId,
    ],
  );

let assignment =
  await readTuple(
    "getOrganizationRoleAssignment",
    [
      tenantId,
      organizationId,
      roleId,
    ],
  );

if (organization) {
  if (
    !bytes32Equal(
      organization.metadataHash,
      organizationMetadataHash,
    )
  ) {
    throw new Error(
      "Existing organization metadata hash does not match bootstrap metadata.",
    );
  }

  if (
    organization.active !== true
  ) {
    throw new Error(
      "Existing organization is inactive.",
    );
  }
}

if (walletBinding) {
  if (
    !bytes32Equal(
      walletBinding.organizationId,
      organizationId,
    )
  ) {
    throw new Error(
      "Producer wallet is already bound to another organization.",
    );
  }

  if (
    walletBinding.active !== true
  ) {
    throw new Error(
      "Producer wallet binding exists but is inactive.",
    );
  }
}

if (
  membership &&
  membership.active !== true
) {
  throw new Error(
    "Organization tenant membership exists but is inactive.",
  );
}

if (role) {
  if (
    !bytes32Equal(
      role.metadataHash,
      roleMetadataHash,
    )
  ) {
    throw new Error(
      "Existing role metadata hash does not match bootstrap metadata.",
    );
  }

  if (
    role.active !== true
  ) {
    throw new Error(
      "Existing producer role is inactive.",
    );
  }
}

if (
  assignment &&
  assignment.active !== true
) {
  throw new Error(
    "Existing role assignment is inactive.",
  );
}

let capabilityStatus = {};

if (role) {
  const values =
    await Promise.all(
      CAPABILITIES.map(
        (capability) =>
          publicClient.readContract({
            address:
              contractAddress,
            abi:
              artifact.abi,
            functionName:
              "roleHasCapability",
            args: [
              tenantId,
              roleId,
              capability.value,
            ],
          }),
      ),
    );

  capabilityStatus =
    Object.fromEntries(
      CAPABILITIES.map(
        (capability, index) => [
          capability.name,
          values[index],
        ],
      ),
    );
} else {
  capabilityStatus =
    Object.fromEntries(
      CAPABILITIES.map(
        (capability) => [
          capability.name,
          false,
        ],
      ),
    );
}

const steps = [];

if (!organization) {
  steps.push(
    "registerOrganization",
  );
}

if (!walletBinding) {
  steps.push(
    "bindWallet",
  );
}

if (!membership) {
  steps.push(
    "addOrganizationToTenant",
  );
}

if (!role) {
  steps.push(
    "createRole",
  );
}

for (
  const capability
  of CAPABILITIES
) {
  if (
    capabilityStatus[
      capability.name
    ] !== true
  ) {
    steps.push(
      `setRoleCapability:${capability.name}`,
    );
  }
}

if (!assignment) {
  steps.push(
    "assignRoleToOrganization",
  );
}

console.log(
  "TraceForge Organization Bootstrap",
);

console.log(
  "=================================",
);

console.log();

console.log(
  `Mode:              ${broadcast ? "BROADCAST" : "DRY RUN"}`,
);

console.log(
  `Chain ID:          ${chainId}`,
);

console.log(
  `Contract:          ${contractAddress}`,
);

console.log(
  `Platform owner:    ${deployer.address}`,
);

console.log(
  `Tenant ID:         ${tenantId}`,
);

console.log(
  `Tenant admin:      ${tenantAdmin.address}`,
);

console.log(
  `Organization:      ${organizationMetadata.slug}`,
);

console.log(
  `Organization ID:   ${organizationId}`,
);

console.log(
  `Organization hash: ${organizationMetadataHash}`,
);

console.log(
  `Producer wallet:   ${producer.address}`,
);

console.log(
  `Role:              ${roleMetadata.slug}`,
);

console.log(
  `Role ID:           ${roleId}`,
);

console.log(
  `Role hash:         ${roleMetadataHash}`,
);

console.log();

if (
  steps.length === 0
) {
  console.log(
    "Bootstrap state is already complete.",
  );

  process.exit(0);
}

console.log(
  "Pending operations:",
);

for (const step of steps) {
  console.log(
    `  - ${step}`,
  );
}

if (!broadcast) {
  console.log();

  console.log(
    "DRY RUN PASSED.",
  );

  console.log(
    "No transaction was sent.",
  );

  console.log(
    "Dependent transactions will be estimated immediately before broadcast.",
  );

  process.exit(0);
}

const previousRecord =
  existsSync(recordPath)
    ? loadJson(recordPath)
    : null;

const transactions = {
  ...(
    previousRecord?.transactions ??
    {}
  ),

  capabilities: {
    ...(
      previousRecord
        ?.transactions
        ?.capabilities ??
      {}
    ),
  },
};

function saveProgress(
  complete,
) {
  mkdirSync(
    join(
      "deployments",
      "9009",
      "bootstrap",
    ),
    {
      recursive: true,
    },
  );

  const record = {
    schemaVersion: 1,

    complete,

    network: {
      chainId: CHAIN_ID,
    },

    contract: {
      address:
        contractAddress,
    },

    tenant: {
      tenantId,
      tenantAdmin:
        tenantAdmin.address,
    },

    organization: {
      slug:
        organizationMetadata.slug,

      organizationId,

      metadataHash:
        organizationMetadataHash,

      wallet:
        producer.address,
    },

    role: {
      slug:
        roleMetadata.slug,

      roleId,

      metadataHash:
        roleMetadataHash,

      capabilities:
        expectedCapabilityNames,
    },

    transactions,
  };

  writeFileSync(
    recordPath,
    JSON.stringify(
      record,
      null,
      2,
    ) + "\n",
  );
}

if (!organization) {
  transactions.registerOrganization =
    await sendTransaction({
      label:
        "Register organization",

      client:
        ownerClient,

      account:
        deployer,

      functionName:
        "registerOrganization",

      args: [
        organizationId,
        organizationMetadataHash,
      ],
    });

  saveProgress(false);

  organization =
    await readTuple(
      "getOrganization",
      [organizationId],
    );

  if (!organization) {
    throw new Error(
      "Organization read-back verification failed.",
    );
  }
}

if (!walletBinding) {
  transactions.bindWallet =
    await sendTransaction({
      label:
        "Bind producer wallet",

      client:
        ownerClient,

      account:
        deployer,

      functionName:
        "bindWallet",

      args: [
        organizationId,
        producer.address,
      ],
    });

  saveProgress(false);

  walletBinding =
    await readTuple(
      "getWalletBinding",
      [producer.address],
    );

  if (
    !walletBinding ||
    !bytes32Equal(
      walletBinding.organizationId,
      organizationId,
    ) ||
    walletBinding.active !== true
  ) {
    throw new Error(
      "Wallet binding read-back verification failed.",
    );
  }
}

if (!membership) {
  transactions.addOrganizationToTenant =
    await sendTransaction({
      label:
        "Add organization to tenant",

      client:
        tenantAdminClient,

      account:
        tenantAdmin,

      functionName:
        "addOrganizationToTenant",

      args: [
        tenantId,
        organizationId,
      ],
    });

  saveProgress(false);

  membership =
    await readTuple(
      "getTenantMembership",
      [
        tenantId,
        organizationId,
      ],
    );

  if (
    !membership ||
    membership.active !== true
  ) {
    throw new Error(
      "Tenant membership read-back verification failed.",
    );
  }
}

if (!role) {
  transactions.createRole =
    await sendTransaction({
      label:
        "Create producer role",

      client:
        tenantAdminClient,

      account:
        tenantAdmin,

      functionName:
        "createRole",

      args: [
        tenantId,
        roleId,
        roleMetadataHash,
      ],
    });

  saveProgress(false);

  role =
    await readTuple(
      "getRole",
      [
        tenantId,
        roleId,
      ],
    );

  if (!role) {
    throw new Error(
      "Role read-back verification failed.",
    );
  }
}

for (
  const capability
  of CAPABILITIES
) {
  const enabled =
    await publicClient.readContract({
      address:
        contractAddress,

      abi:
        artifact.abi,

      functionName:
        "roleHasCapability",

      args: [
        tenantId,
        roleId,
        capability.value,
      ],
    });

  if (enabled === true) {
    continue;
  }

  transactions.capabilities[
    capability.name
  ] =
    await sendTransaction({
      label:
        `Enable ${capability.name}`,

      client:
        tenantAdminClient,

      account:
        tenantAdmin,

      functionName:
        "setRoleCapability",

      args: [
        tenantId,
        roleId,
        capability.value,
        true,
      ],
    });

  saveProgress(false);

  const verified =
    await publicClient.readContract({
      address:
        contractAddress,

      abi:
        artifact.abi,

      functionName:
        "roleHasCapability",

      args: [
        tenantId,
        roleId,
        capability.value,
      ],
    });

  if (verified !== true) {
    throw new Error(
      `Capability verification failed: ${capability.name}`,
    );
  }
}

assignment =
  await readTuple(
    "getOrganizationRoleAssignment",
    [
      tenantId,
      organizationId,
      roleId,
    ],
  );

if (!assignment) {
  transactions.assignRoleToOrganization =
    await sendTransaction({
      label:
        "Assign producer role",

      client:
        tenantAdminClient,

      account:
        tenantAdmin,

      functionName:
        "assignRoleToOrganization",

      args: [
        tenantId,
        organizationId,
        roleId,
      ],
    });

  saveProgress(false);
}

const [
  finalOrganization,
  finalBinding,
  finalMembership,
  finalRole,
  finalAssignment,
] = await Promise.all([
  readTuple(
    "getOrganization",
    [organizationId],
  ),

  readTuple(
    "getWalletBinding",
    [producer.address],
  ),

  readTuple(
    "getTenantMembership",
    [
      tenantId,
      organizationId,
    ],
  ),

  readTuple(
    "getRole",
    [
      tenantId,
      roleId,
    ],
  ),

  readTuple(
    "getOrganizationRoleAssignment",
    [
      tenantId,
      organizationId,
      roleId,
    ],
  ),
]);

if (
  !finalOrganization ||
  finalOrganization.active !== true
) {
  throw new Error(
    "Final organization verification failed.",
  );
}

if (
  !finalBinding ||
  finalBinding.active !== true ||
  !bytes32Equal(
    finalBinding.organizationId,
    organizationId,
  )
) {
  throw new Error(
    "Final wallet verification failed.",
  );
}

if (
  !finalMembership ||
  finalMembership.active !== true
) {
  throw new Error(
    "Final membership verification failed.",
  );
}

if (
  !finalRole ||
  finalRole.active !== true
) {
  throw new Error(
    "Final role verification failed.",
  );
}

if (
  !finalAssignment ||
  finalAssignment.active !== true
) {
  throw new Error(
    "Final role assignment verification failed.",
  );
}

for (
  const capability
  of CAPABILITIES
) {
  const enabled =
    await publicClient.readContract({
      address:
        contractAddress,

      abi:
        artifact.abi,

      functionName:
        "roleHasCapability",

      args: [
        tenantId,
        roleId,
        capability.value,
      ],
    });

  if (enabled !== true) {
    throw new Error(
      `Final capability verification failed: ${capability.name}`,
    );
  }
}

saveProgress(true);

console.log();
console.log(
  "ORGANIZATION BOOTSTRAP SUCCESSFUL.",
);

console.log(
  `Organization ID: ${organizationId}`,
);

console.log(
  `Producer wallet: ${producer.address}`,
);

console.log(
  `Role ID:         ${roleId}`,
);

console.log(
  "Capabilities:    7/7 enabled",
);

console.log(
  `Record:          ${recordPath}`,
);
