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

const deployment =
  JSON.parse(
    readFileSync(
      "deployments/9009/TraceForge.json",
      "utf8",
    ),
  );

const sourceRecord =
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

const targetMetadataPath =
  "bootstrap/entity-sandbox-item-001.json";

const createEvidencePath =
  "bootstrap/evidence-sandbox-item-001-created.json";

const linkEvidencePath =
  "bootstrap/evidence-batch-001-contains-item-001.json";

const disableEvidencePath =
  "bootstrap/evidence-batch-001-item-001-link-disabled.json";

const enableEvidencePath =
  "bootstrap/evidence-batch-001-item-001-link-enabled.json";

const outputPath =
  "deployments/9009/operations/relationship-batch-001-item-001.json";

function loadJson(path) {
  return JSON.parse(
    readFileSync(path, "utf8"),
  );
}

function fileHash(path) {
  return keccak256(
    toHex(
      readFileSync(path),
    ),
  );
}

function id(value) {
  return keccak256(
    stringToHex(value),
  );
}

function same(a, b) {
  return (
    String(a).toLowerCase() ===
    String(b).toLowerCase()
  );
}

function readKey(path) {
  const value =
    readFileSync(path, "utf8").trim();

  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(
      `Invalid private key: ${path}`,
    );
  }

  return value;
}

const targetMetadata =
  loadJson(targetMetadataPath);

const createEvidence =
  loadJson(createEvidencePath);

const linkEvidence =
  loadJson(linkEvidencePath);

const disableEvidence =
  loadJson(disableEvidencePath);

const enableEvidence =
  loadJson(enableEvidencePath);

const tenantId =
  sourceRecord.tenant.tenantId;

const sourceEntityId =
  sourceRecord.entity.entityId;

const producerOrganizationId =
  producerRecord.organization.organizationId;

const distributorOrganizationId =
  distributorRecord.organization.organizationId;

const producerRoleId =
  producerRecord.role.roleId;

const distributorRoleId =
  distributorRecord.role.roleId;

const targetEntityId =
  id(
    `traceforge:entity:${targetMetadata.slug}`,
  );

const targetEntityType =
  id(targetMetadata.entityType);

const targetState =
  id(targetMetadata.initialState);

const targetMetadataHash =
  fileHash(targetMetadataPath);

const createEventType =
  id(createEvidence.event);

const createEvidenceHash =
  fileHash(createEvidencePath);

const linkType =
  id(linkEvidence.linkType);

const linkEventType =
  id(linkEvidence.event);

const linkEvidenceHash =
  fileHash(linkEvidencePath);

const disableEventType =
  id(disableEvidence.event);

const disableEvidenceHash =
  fileHash(disableEvidencePath);

const enableEventType =
  id(enableEvidence.event);

const enableEvidenceHash =
  fileHash(enableEvidencePath);

const producer =
  privateKeyToAccount(
    readKey(
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
    readKey(
      join(
        homedir(),
        ".traceforge",
        "secrets",
        "sandbox-distributor.key",
      ),
    ),
  );

if (
  !same(
    producer.address,
    producerRecord.organization.wallet,
  )
) {
  throw new Error(
    "Producer wallet mismatch.",
  );
}

if (
  !same(
    distributor.address,
    distributorRecord.organization.wallet,
  )
) {
  throw new Error(
    "Distributor wallet mismatch.",
  );
}

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

async function readEntity(entityId) {
  const value =
    await publicClient.readContract({
      address:
        contractAddress,

      abi:
        artifact.abi,

      functionName:
        "getEntity",

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

async function targetExists() {
  return publicClient.readContract({
    address:
      contractAddress,

    abi:
      artifact.abi,

    functionName:
      "entityExists",

    args:
      argsFor(
        "entityExists",
        {
          tenantId,
          entityId:
            targetEntityId,
        },
      ),
  });
}

const linkIdentity = {
  tenantId,
  sourceEntityId,
  targetEntityId,
  linkType,
};

async function linkExists() {
  return publicClient.readContract({
    address:
      contractAddress,

    abi:
      artifact.abi,

    functionName:
      "entityLinkExists",

    args:
      argsFor(
        "entityLinkExists",
        linkIdentity,
      ),
  });
}

async function readLink() {
  const value =
    await publicClient.readContract({
      address:
        contractAddress,

      abi:
        artifact.abi,

      functionName:
        "getEntityLink",

      args:
        argsFor(
          "getEntityLink",
          linkIdentity,
        ),
    });

  return tupleToObject(
    "getEntityLink",
    value,
  );
}

async function findCreatedRelationshipEvent() {
  const logs =
    await publicClient.getContractEvents({
      address:
        contractAddress,

      abi:
        artifact.abi,

      eventName:
        "EntityLinkCreated",

      fromBlock:
        0n,

      toBlock:
        "latest",
    });

  return (
    logs.find(
      (log) =>
        same(
          log.args.sourceEntityId,
          sourceEntityId,
        ) &&
        same(
          log.args.targetEntityId,
          targetEntityId,
        ) &&
        same(
          log.args.linkType,
          linkType,
        ) &&
        same(
          log.args.evidenceHash,
          linkEvidenceHash,
        ),
    ) ??
    null
  );
}

function receiptHasEvent(
  receipt,
  eventName,
) {
  for (const log of receipt.logs) {
    if (
      !same(
        log.address,
        contractAddress,
      )
    ) {
      continue;
    }

    try {
      const decoded =
        decodeEventLog({
          abi:
            artifact.abi,
          data:
            log.data,
          topics:
            log.topics,
        });

      if (
        decoded.eventName ===
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

function receiptHasEvidenceEvent(
  receipt,
  eventName,
  evidenceHash,
) {
  for (const log of receipt.logs) {
    if (
      !same(
        log.address,
        contractAddress,
      )
    ) {
      continue;
    }

    try {
      const decoded =
        decodeEventLog({
          abi:
            artifact.abi,
          data:
            log.data,
          topics:
            log.topics,
        });

      if (
        decoded.eventName ===
          eventName &&
        decoded.args.evidenceHash &&
        same(
          decoded.args.evidenceHash,
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

async function send({
  functionName,
  values,
  requiredEvent,
  evidenceHash = null,
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
        distributor.address,

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
    await distributorClient.writeContract({
      address:
        contractAddress,

      abi:
        artifact.abi,

      functionName,

      args,

      account:
        distributor,

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
    requiredEvent &&
    !receiptHasEvent(
      receipt,
      requiredEvent,
    )
  ) {
    throw new Error(
      `${requiredEvent} event missing.`,
    );
  }

  if (
    evidenceHash &&
    !receiptHasEvidenceEvent(
      receipt,
      requiredEvent,
      evidenceHash,
    )
  ) {
    throw new Error(
      `${functionName}: matching ${requiredEvent} evidence missing.`,
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

const createValues = {
  tenantId,
  roleId:
    distributorRoleId,

  entityId:
    targetEntityId,

  entityType:
    targetEntityType,

  metadataHash:
    targetMetadataHash,

  initialState:
    targetState,

  currentState:
    targetState,

  state:
    targetState,

  eventType:
    createEventType,

  initialEventType:
    createEventType,

  evidenceHash:
    createEvidenceHash,

  initialEvidenceHash:
    createEvidenceHash,
};

const createLinkValues = {
  tenantId,

  roleId:
    distributorRoleId,

  sourceEntityId,
  targetEntityId,
  linkType,

  eventType:
    linkEventType,

  evidenceHash:
    linkEvidenceHash,
};

function statusValues(
  active,
  eventType,
  evidenceHash,
  roleId =
    distributorRoleId,
) {
  return {
    tenantId,
    roleId,
    sourceEntityId,
    targetEntityId,
    linkType,
    active,
    eventType,
    evidenceHash,
  };
}

const [
  chainId,
  linkCapability,
] = await Promise.all([
  publicClient.getChainId(),

  publicClient.readContract({
    address:
      contractAddress,

    abi:
      artifact.abi,

    functionName:
      "roleHasCapability",

    args:
      argsFor(
        "roleHasCapability",
        {
          tenantId,
          roleId:
            distributorRoleId,
          capability: 5,
        },
      ),
  }),
]);

if (
  chainId !== CHAIN_ID
) {
  throw new Error(
    `Wrong chain: ${chainId}`,
  );
}

if (
  linkCapability !== true
) {
  throw new Error(
    "Distributor lacks ENTITY_LINK capability.",
  );
}

const source =
  await readEntity(
    sourceEntityId,
  );

if (
  source.closed !== false
) {
  throw new Error(
    "Source entity is closed.",
  );
}

if (
  !same(
    source.currentCustodian,
    distributorOrganizationId,
  )
) {
  throw new Error(
    "Distributor is not current source custodian.",
  );
}

let targetPresent =
  await targetExists();

let relationshipPresent =
  await linkExists();

console.log(
  "TraceForge Relationship Control Proof",
);

console.log(
  "=====================================",
);

console.log();

console.log(
  `Mode:              ${broadcast ? "BROADCAST" : "DRY RUN"}`,
);

console.log(
  `Source entity:     ${sourceEntityId}`,
);

console.log(
  `Source custodian:  ${source.currentCustodian}`,
);

console.log(
  `Target entity:     ${targetEntityId}`,
);

console.log(
  `Link type:         CONTAINS`,
);

console.log(
  `Target exists:     ${targetPresent}`,
);

console.log(
  `Link exists:       ${relationshipPresent}`,
);

console.log();

console.log(
  `ABI: ${signature("createEntity")}`,
);

console.log(
  `ABI: ${signature("createEntityLink")}`,
);

console.log(
  `ABI: ${signature("setEntityLinkActive")}`,
);

if (!broadcast) {
  console.log();
  console.log(
    "Pending/verification plan:",
  );

  if (!targetPresent) {
    await publicClient.estimateContractGas({
      address:
        contractAddress,

      abi:
        artifact.abi,

      functionName:
        "createEntity",

      args:
        argsFor(
          "createEntity",
          createValues,
        ),

      account:
        distributor.address,

      gasPrice:
        0n,
    });

    console.log(
      "  - create target ITEM",
    );
  }

  if (!relationshipPresent) {
    if (!targetPresent) {
      console.log(
        "  - create CONTAINS relationship after target creation",
      );
    } else {
      await publicClient.estimateContractGas({
        address:
          contractAddress,

        abi:
          artifact.abi,

        functionName:
          "createEntityLink",

        args:
          argsFor(
            "createEntityLink",
            createLinkValues,
          ),

        account:
          distributor.address,

        gasPrice:
          0n,
      });

      console.log(
        "  - create CONTAINS relationship",
      );
    }
  }

  console.log(
    "  - prove old producer cannot control relationship",
  );

  console.log(
    "  - distributor toggles relationship",
  );

  console.log(
    "  - restore relationship active",
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

let record =
  existsSync(outputPath)
    ? loadJson(outputPath)
    : {
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

        source: {
          entityId:
            sourceEntityId,

          organizationId:
            distributorOrganizationId,
        },

        target: {
          entityId:
            targetEntityId,

          entityType:
            targetEntityType,

          metadataHash:
            targetMetadataHash,
        },

        relationship: {
          linkType,
        },

        transactions: {},
        verification: {},
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

if (
  relationshipPresent &&
  !record.transactions.createRelationship
) {
  const existingRelationshipEvent =
    await findCreatedRelationshipEvent();

  if (!existingRelationshipEvent) {
    throw new Error(
      "Relationship exists but matching EntityLinkCreated evidence could not be recovered.",
    );
  }

  record.transactions.createRelationship = {
    hash:
      existingRelationshipEvent.transactionHash,

    blockNumber:
      existingRelationshipEvent.blockNumber.toString(),

    recoveredFromChain:
      true,
  };

  save();

  console.log();
  console.log(
    "Recovered existing relationship transaction from chain.",
  );

  console.log(
    `  transaction: ${existingRelationshipEvent.transactionHash}`,
  );

  console.log(
    `  block:       ${existingRelationshipEvent.blockNumber}`,
  );
}

if (
  record.complete === true
) {
  if (
    !relationshipPresent
  ) {
    throw new Error(
      "Completed record exists but relationship is missing.",
    );
  }

  const link =
    await readLink();

  if (
    link.active !== true
  ) {
    throw new Error(
      "Completed relationship is not active.",
    );
  }

  console.log();
  console.log(
    "Relationship control proof is already complete.",
  );

  process.exit(0);
}

if (!targetPresent) {
  record.transactions.createTargetEntity =
    await send({
      functionName:
        "createEntity",

      values:
        createValues,

      requiredEvent:
        "EntityCreated",
    });

  save();

  targetPresent =
    await targetExists();

  if (
    targetPresent !== true
  ) {
    throw new Error(
      "Target entity creation verification failed.",
    );
  }
}

const target =
  await readEntity(
    targetEntityId,
  );

if (
  !same(
    target.currentCustodian,
    distributorOrganizationId,
  )
) {
  throw new Error(
    "Target entity is not in distributor custody.",
  );
}

if (
  target.closed !== false
) {
  throw new Error(
    "Target entity is closed.",
  );
}

if (!relationshipPresent) {
  record.transactions.createRelationship =
    await send({
      functionName:
        "createEntityLink",

      values:
        createLinkValues,

      requiredEvent:
        "EntityLinkCreated",

      evidenceHash:
        linkEvidenceHash,
    });

  save();

  relationshipPresent =
    await linkExists();

  if (
    relationshipPresent !== true
  ) {
    throw new Error(
      "Relationship creation verification failed.",
    );
  }
}

let link =
  await readLink();

const deniedTargetStatus =
  !link.active;

let producerDenied = false;

try {
  await publicClient.estimateContractGas({
    address:
      contractAddress,

    abi:
      artifact.abi,

    functionName:
      "setEntityLinkActive",

    args:
      argsFor(
        "setEntityLinkActive",
        statusValues(
          deniedTargetStatus,
          disableEventType,
          disableEvidenceHash,
          producerRoleId,
        ),
      ),

    account:
      producer.address,

    gasPrice:
      0n,
  });
} catch {
  producerDenied = true;
}

if (
  producerDenied !== true
) {
  throw new Error(
    "SECURITY FAILURE: previous custodian can still control relationship.",
  );
}

record.verification.previousCustodianDenied =
  true;

save();

console.log();
console.log(
  "PASS: previous producer custodian cannot mutate relationship.",
);

if (
  link.active === true
) {
  record.transactions.disableRelationship =
    await send({
      functionName:
        "setEntityLinkActive",

      values:
        statusValues(
          false,
          disableEventType,
          disableEvidenceHash,
        ),

      requiredEvent:
        "EntityLinkStatusChanged",

      evidenceHash:
        disableEvidenceHash,
    });

  save();

  link =
    await readLink();

  if (
    link.active !== false
  ) {
    throw new Error(
      "Relationship deactivation verification failed.",
    );
  }
}

if (
  link.active === false
) {
  record.transactions.enableRelationship =
    await send({
      functionName:
        "setEntityLinkActive",

      values:
        statusValues(
          true,
          enableEventType,
          enableEvidenceHash,
        ),

      requiredEvent:
        "EntityLinkStatusChanged",

      evidenceHash:
        enableEvidenceHash,
    });

  save();
}

link =
  await readLink();

if (
  link.active !== true
) {
  throw new Error(
    "Final relationship active-state verification failed.",
  );
}

const finalSource =
  await readEntity(
    sourceEntityId,
  );

if (
  !same(
    finalSource.currentCustodian,
    distributorOrganizationId,
  )
) {
  throw new Error(
    "Source custody unexpectedly changed.",
  );
}

record.complete = true;

record.verification = {
  ...record.verification,

  sourceCustodianIsDistributor:
    true,

  targetCustodianIsDistributor:
    true,

  previousCustodianDenied:
    true,

  distributorCanDeactivate:
    true,

  distributorCanReactivate:
    true,

  finalRelationshipActive:
    true,

  sourceOpen:
    true,

  targetOpen:
    true,
};

save();

console.log();
console.log(
  "RELATIONSHIP CONTROL PROOF SUCCESSFUL.",
);

console.log(
  "Source custodian: distributor",
);

console.log(
  "Previous producer: denied",
);

console.log(
  "Distributor:       control verified",
);

console.log(
  "Relationship:      CONTAINS / active",
);

console.log(
  `Record:            ${outputPath}`,
);
