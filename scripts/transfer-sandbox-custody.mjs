import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  keccak256,
  stringToHex,
  toHex,
  decodeEventLog,
} from "viem";

import {
  privateKeyToAccount,
} from "viem/accounts";

import {
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

const deployment =
  JSON.parse(
    readFileSync(
      "deployments/9009/TraceForge.json",
      "utf8",
    ),
  );

const entityRecord =
  JSON.parse(
    readFileSync(
      "deployments/9009/bootstrap/entity-sandbox-batch-001.json",
      "utf8",
    ),
  );

const producerRecord =
  JSON.parse(
    readFileSync(
      "deployments/9009/bootstrap/organization-sandbox-producer.json",
      "utf8",
    ),
  );

const distributorRecord =
  JSON.parse(
    readFileSync(
      "deployments/9009/bootstrap/organization-sandbox-distributor.json",
      "utf8",
    ),
  );

const artifact =
  JSON.parse(
    readFileSync(
      "artifacts/contracts/TraceForge.sol/TraceForge.json",
      "utf8",
    ),
  );

const proposalEvidencePath =
  "bootstrap/evidence-sandbox-batch-001-custody-proposed.json";

const acceptanceEvidencePath =
  "bootstrap/evidence-sandbox-batch-001-custody-accepted.json";

const outputPath =
  "deployments/9009/operations/entity-sandbox-batch-001-custody-001.json";

const tenantId =
  entityRecord.tenant.tenantId;

const entityId =
  entityRecord.entity.entityId;

const producerOrganizationId =
  producerRecord.organization.organizationId;

const distributorOrganizationId =
  distributorRecord.organization.organizationId;

const producerRoleId =
  producerRecord.role.roleId;

const distributorRoleId =
  distributorRecord.role.roleId;

function key(path) {
  const value =
    readFileSync(path, "utf8").trim();

  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(
      `Invalid private key: ${path}`,
    );
  }

  return value;
}

const producer =
  privateKeyToAccount(
    key(
      join(
        homedir(),
        ".traceforge",
        "secrets",
        "sandbox-producer.key",
      ),
    ),
  );

const distributor =
  privateKeyToAccount(
    key(
      join(
        homedir(),
        ".traceforge",
        "secrets",
        "sandbox-distributor.key",
      ),
    ),
  );

if (
  producer.address.toLowerCase() !==
  producerRecord.organization.wallet.toLowerCase()
) {
  throw new Error(
    "Producer wallet mismatch.",
  );
}

if (
  distributor.address.toLowerCase() !==
  distributorRecord.organization.wallet.toLowerCase()
) {
  throw new Error(
    "Distributor wallet mismatch.",
  );
}

const proposalMetadata =
  JSON.parse(
    readFileSync(
      proposalEvidencePath,
      "utf8",
    ),
  );

const acceptanceMetadata =
  JSON.parse(
    readFileSync(
      acceptanceEvidencePath,
      "utf8",
    ),
  );

const proposalEventType =
  keccak256(
    stringToHex(
      proposalMetadata.event,
    ),
  );

const proposalEvidenceHash =
  keccak256(
    toHex(
      readFileSync(
        proposalEvidencePath,
      ),
    ),
  );

const acceptanceEventType =
  keccak256(
    stringToHex(
      acceptanceMetadata.event,
    ),
  );

const acceptanceEvidenceHash =
  keccak256(
    toHex(
      readFileSync(
        acceptanceEvidencePath,
      ),
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

const producerClient =
  createWalletClient({
    chain,
    transport: http(RPC_URL),
    account: producer,
  });

const distributorClient =
  createWalletClient({
    chain,
    transport: http(RPC_URL),
    account: distributor,
  });

const contractAddress =
  deployment.contract.address;

function fn(name) {
  const item =
    artifact.abi.find(
      (entry) =>
        entry.type === "function" &&
        entry.name === name,
    );

  if (!item) {
    throw new Error(
      `ABI function missing: ${name}`,
    );
  }

  return item;
}

function argsFor(name, values) {
  return fn(name).inputs.map(
    (input) => {
      if (
        !Object.prototype.hasOwnProperty.call(
          values,
          input.name,
        )
      ) {
        throw new Error(
          `Unsupported ABI input: ${name}.${input.name}`,
        );
      }

      return values[input.name];
    },
  );
}

function signature(name) {
  return (
    `${name}(` +
    fn(name).inputs
      .map(
        (input) =>
          `${input.type} ${input.name}`,
      )
      .join(", ") +
    ")"
  );
}

function same(a, b) {
  return (
    String(a).toLowerCase() ===
    String(b).toLowerCase()
  );
}

function tupleToObject(
  functionName,
  value,
) {
  const components =
    fn(functionName)
      .outputs?.[0]?.components;

  if (!components?.length) {
    return value;
  }

  const result = {};

  for (
    let i = 0;
    i < components.length;
    i += 1
  ) {
    result[components[i].name] =
      value?.[components[i].name] ??
      value?.[i];
  }

  return result;
}

async function readEntity() {
  const value =
    await publicClient.readContract({
      address: contractAddress,
      abi: artifact.abi,
      functionName: "getEntity",
      args:
        argsFor(
          "getEntity",
          {
            tenantId,
            entityId,
          },
        ),
    });

  return tupleToObject(
    "getEntity",
    value,
  );
}

async function hasPending() {
  return publicClient.readContract({
    address: contractAddress,
    abi: artifact.abi,
    functionName:
      "hasPendingCustodyTransfer",
    args:
      argsFor(
        "hasPendingCustodyTransfer",
        {
          tenantId,
          entityId,
        },
      ),
  });
}

async function capability(
  roleId,
) {
  return publicClient.readContract({
    address: contractAddress,
    abi: artifact.abi,
    functionName:
      "roleHasCapability",
    args:
      argsFor(
        "roleHasCapability",
        {
          tenantId,
          roleId,
          capability: 4,
        },
      ),
  });
}

const targetAliases = {
  toOrganizationId:
    distributorOrganizationId,

  recipientOrganizationId:
    distributorOrganizationId,

  targetOrganizationId:
    distributorOrganizationId,

  newCustodianOrganizationId:
    distributorOrganizationId,

  toOrganization:
    distributorOrganizationId,

  recipientOrganization:
    distributorOrganizationId,

  targetOrganization:
    distributorOrganizationId,

  recipient:
    distributorOrganizationId,
};

const proposeValues = {
  tenantId,
  roleId:
    producerRoleId,
  entityId,

  ...targetAliases,

  eventType:
    proposalEventType,

  evidenceHash:
    proposalEvidenceHash,
};

const acceptValues = {
  tenantId,
  roleId:
    distributorRoleId,
  entityId,

  eventType:
    acceptanceEventType,

  evidenceHash:
    acceptanceEvidenceHash,
};

function matchingTrace(
  receipt,
  eventType,
  evidenceHash,
) {
  for (const log of receipt.logs) {
    if (
      log.address.toLowerCase() !==
      contractAddress.toLowerCase()
    ) {
      continue;
    }

    try {
      const event =
        decodeEventLog({
          abi:
            artifact.abi,
          data:
            log.data,
          topics:
            log.topics,
        });

      if (
        event.eventName ===
          "TraceRecorded" &&
        same(
          event.args.tenantId,
          tenantId,
        ) &&
        same(
          event.args.entityId,
          entityId,
        ) &&
        same(
          event.args.eventType,
          eventType,
        ) &&
        same(
          event.args.evidenceHash,
          evidenceHash,
        )
      ) {
        return true;
      }
    } catch {
      // Ignore unrelated logs.
    }
  }

  return false;
}

function containsEvent(
  receipt,
  eventName,
) {
  for (const log of receipt.logs) {
    if (
      log.address.toLowerCase() !==
      contractAddress.toLowerCase()
    ) {
      continue;
    }

    try {
      const event =
        decodeEventLog({
          abi:
            artifact.abi,
          data:
            log.data,
          topics:
            log.topics,
        });

      if (
        event.eventName ===
        eventName
      ) {
        return true;
      }
    } catch {
      // Ignore unrelated logs.
    }
  }

  return false;
}

async function send({
  client,
  account,
  functionName,
  values,
  requiredEvent,
  eventType,
  evidenceHash,
}) {
  const args =
    argsFor(
      functionName,
      values,
    );

  const estimate =
    await publicClient.estimateContractGas({
      address:
        contractAddress,
      abi:
        artifact.abi,
      functionName,
      args,
      account:
        account.address,
      gasPrice:
        0n,
    });

  const gas =
    (estimate * 120n) / 100n;

  console.log();
  console.log(functionName);
  console.log(
    `  estimated gas: ${estimate}`,
  );

  const hash =
    await client.writeContract({
      address:
        contractAddress,
      abi:
        artifact.abi,
      functionName,
      args,
      account,
      gas,
      gasPrice:
        0n,
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
      `${functionName} failed.`,
    );
  }

  console.log(
    `  block:         ${receipt.blockNumber}`,
  );

  if (
    !containsEvent(
      receipt,
      requiredEvent,
    )
  ) {
    throw new Error(
      `${requiredEvent} event missing.`,
    );
  }

  if (
    !matchingTrace(
      receipt,
      eventType,
      evidenceHash,
    )
  ) {
    throw new Error(
      "Matching TraceRecorded event missing.",
    );
  }

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
  producerCapability,
  distributorCapability,
] = await Promise.all([
  publicClient.getChainId(),

  capability(
    producerRoleId,
  ),

  capability(
    distributorRoleId,
  ),
]);

if (
  chainId !== CHAIN_ID
) {
  throw new Error(
    `Wrong chain: ${chainId}`,
  );
}

if (
  producerCapability !== true
) {
  throw new Error(
    "Producer lacks CUSTODY_TRANSFER.",
  );
}

if (
  distributorCapability !== true
) {
  throw new Error(
    "Distributor lacks CUSTODY_TRANSFER.",
  );
}

let entity =
  await readEntity();

let pending =
  await hasPending();

if (
  entity.closed !== false
) {
  throw new Error(
    "Entity is closed.",
  );
}

if (
  !same(
    entity.currentCustodian,
    producerOrganizationId,
  ) &&
  !same(
    entity.currentCustodian,
    distributorOrganizationId,
  )
) {
  throw new Error(
    "Entity has unexpected custodian.",
  );
}

console.log(
  "TraceForge Two-Step Custody Transfer",
);

console.log(
  "====================================",
);

console.log();

console.log(
  `Mode:              ${broadcast ? "BROADCAST" : "DRY RUN"}`,
);

console.log(
  `Entity ID:         ${entityId}`,
);

console.log(
  `Producer org:      ${producerOrganizationId}`,
);

console.log(
  `Distributor org:   ${distributorOrganizationId}`,
);

console.log(
  `Current custodian: ${entity.currentCustodian}`,
);

console.log(
  `Pending transfer:  ${pending}`,
);

console.log();

console.log(
  `ABI: ${signature("proposeCustodyTransfer")}`,
);

console.log(
  `ABI: ${signature("acceptCustodyTransfer")}`,
);

const alreadyComplete =
  same(
    entity.currentCustodian,
    distributorOrganizationId,
  ) &&
  pending === false;

if (
  alreadyComplete
) {
  console.log();
  console.log(
    "Custody transfer is already complete.",
  );
  process.exit(0);
}

if (
  !same(
    entity.currentCustodian,
    producerOrganizationId,
  )
) {
  throw new Error(
    "Producer is no longer current custodian.",
  );
}

if (!broadcast) {
  if (!pending) {
    const estimate =
      await publicClient.estimateContractGas({
        address:
          contractAddress,
        abi:
          artifact.abi,
        functionName:
          "proposeCustodyTransfer",
        args:
          argsFor(
            "proposeCustodyTransfer",
            proposeValues,
          ),
        account:
          producer.address,
        gasPrice:
          0n,
      });

    console.log();
    console.log(
      `Proposal gas:      ${estimate}`,
    );

    console.log(
      "Pending operation: proposeCustodyTransfer",
    );
  }

  console.log(
    "Pending operation: acceptCustodyTransfer",
  );

  console.log();
  console.log(
    "DRY RUN PASSED.",
  );
  console.log(
    "No transaction was sent.",
  );

  process.exit(0);
}

const record = {
  schemaVersion: 1,
  complete: false,

  network: {
    chainId:
      CHAIN_ID,
  },

  contract: {
    address:
      contractAddress,
  },

  entity: {
    entityId,
  },

  custody: {
    fromOrganizationId:
      producerOrganizationId,

    toOrganizationId:
      distributorOrganizationId,

    proposal: {
      eventType:
        proposalEventType,

      evidenceHash:
        proposalEvidenceHash,
    },

    acceptance: {
      eventType:
        acceptanceEventType,

      evidenceHash:
        acceptanceEvidenceHash,
    },
  },

  transactions: {},
};

function save() {
  mkdirSync(
    join(
      "deployments",
      "9009",
      "operations",
    ),
    {
      recursive: true,
    },
  );

  writeFileSync(
    outputPath,
    JSON.stringify(
      record,
      null,
      2,
    ) + "\n",
  );
}

if (!pending) {
  record.transactions.proposal =
    await send({
      client:
        producerClient,

      account:
        producer,

      functionName:
        "proposeCustodyTransfer",

      values:
        proposeValues,

      requiredEvent:
        "CustodyTransferProposed",

      eventType:
        proposalEventType,

      evidenceHash:
        proposalEvidenceHash,
    });

  save();

  pending =
    await hasPending();

  if (
    pending !== true
  ) {
    throw new Error(
      "Custody proposal read-back verification failed.",
    );
  }
}

record.transactions.acceptance =
  await send({
    client:
      distributorClient,

    account:
      distributor,

    functionName:
      "acceptCustodyTransfer",

    values:
      acceptValues,

    requiredEvent:
      "CustodyTransferred",

    eventType:
      acceptanceEventType,

    evidenceHash:
      acceptanceEvidenceHash,
  });

save();

entity =
  await readEntity();

pending =
  await hasPending();

if (
  !same(
    entity.currentCustodian,
    distributorOrganizationId,
  )
) {
  throw new Error(
    "Final custodian verification failed.",
  );
}

if (
  pending !== false
) {
  throw new Error(
    "Pending transfer was not cleared.",
  );
}

record.complete = true;

record.verification = {
  custodianTransferred: true,
  pendingTransferCleared: true,
  entityOpen:
    entity.closed === false,
  proposalEvidenceRecorded: true,
  acceptanceEvidenceRecorded: true,
};

save();

console.log();
console.log(
  "CUSTODY TRANSFER SUCCESSFUL.",
);

console.log(
  `Entity ID:       ${entityId}`,
);

console.log(
  `New custodian:   ${distributorOrganizationId}`,
);

console.log(
  "Pending:         false",
);

console.log(
  "Evidence:        proposal + acceptance verified",
);

console.log(
  `Record:          ${outputPath}`,
);
