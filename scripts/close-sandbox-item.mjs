import {
  createPublicClient,
  createWalletClient,
  decodeErrorResult,
  decodeEventLog,
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

const deployment =
  JSON.parse(
    readFileSync(
      "deployments/9009/TraceForge.json",
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

const relationshipRecord =
  JSON.parse(
    readFileSync(
      "deployments/9009/operations/relationship-batch-001-item-001.json",
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

const evidencePath =
  "bootstrap/evidence-sandbox-item-001-closed.json";

const outputPath =
  "deployments/9009/operations/entity-sandbox-item-001-close-001.json";

if (
  relationshipRecord.complete !== true
) {
  throw new Error(
    "Relationship proof record is not complete.",
  );
}

const tenantRecord =
  JSON.parse(
    readFileSync(
      "deployments/9009/bootstrap/tenant-traceforge-sandbox.json",
      "utf8",
    ),
  );

const tenantId =
  tenantRecord.tenant.tenantId;

const distributorOrganizationId =
  distributorRecord.organization.organizationId;

const producerOrganizationId =
  producerRecord.organization.organizationId;

const distributorRoleId =
  distributorRecord.role.roleId;

const sourceEntityId =
  relationshipRecord.source.entityId;

const entityId =
  relationshipRecord.target.entityId;

const linkType =
  relationshipRecord.relationship.linkType;

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

function fileHash(path) {
  return keccak256(
    toHex(
      readFileSync(path),
    ),
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

const evidence =
  JSON.parse(
    readFileSync(
      evidencePath,
      "utf8",
    ),
  );

const closeEventType =
  id(evidence.event);

const closeEvidenceHash =
  fileHash(evidencePath);

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

const walletClient =
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
    let index = 0;
    index < components.length;
    index += 1
  ) {
    result[
      components[index].name
    ] =
      value?.[
        components[index].name
      ] ??
      value?.[index];
  }

  return result;
}

async function readEntity(
  targetEntityId,
) {
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
            entityId:
              targetEntityId,
          },
        ),
    });

  return tupleToObject(
    "getEntity",
    value,
  );
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
          {
            tenantId,
            sourceEntityId,
            targetEntityId:
              entityId,
            linkType,
          },
        ),
    });

  return tupleToObject(
    "getEntityLink",
    value,
  );
}

function findDecodedError(
  error,
) {
  let current = error;

  for (
    let depth = 0;
    current && depth < 12;
    depth += 1
  ) {
    if (
      typeof current.data ===
        "string" &&
      current.data.startsWith("0x")
    ) {
      try {
        return decodeErrorResult({
          abi:
            artifact.abi,
          data:
            current.data,
        });
      } catch {
        // Try the next cause.
      }
    }

    current =
      current.cause;
  }

  return null;
}

function errorText(error) {
  const parts = [];

  let current = error;

  for (
    let depth = 0;
    current && depth < 12;
    depth += 1
  ) {
    if (current.shortMessage) {
      parts.push(
        current.shortMessage,
      );
    }

    if (current.message) {
      parts.push(
        current.message,
      );
    }

    current =
      current.cause;
  }

  return parts.join("\n");
}

async function expectClosedRevert({
  label,
  functionName,
  values,
}) {
  let failure = null;

  try {
    await publicClient.simulateContract({
      address:
        contractAddress,

      abi:
        artifact.abi,

      functionName,

      args:
        argsFor(
          functionName,
          values,
        ),

      account:
        distributor.address,
    });
  } catch (error) {
    failure = error;
  }

  if (!failure) {
    throw new Error(
      `SECURITY FAILURE: ${label} was allowed after closure.`,
    );
  }

  const decoded =
    findDecodedError(
      failure,
    );

  const name =
    decoded?.errorName ??
    (
      errorText(
        failure,
      ).includes(
        "EntityIsClosed",
      )
        ? "EntityIsClosed"
        : null
    );

  if (
    name !==
    "EntityIsClosed"
  ) {
    throw new Error(
      `${label} reverted, but expected EntityIsClosed. ` +
      `Observed: ${name ?? "unknown revert"}`,
    );
  }

  console.log(
    `PASS: ${label} -> EntityIsClosed`,
  );

  return true;
}

function findCloseEventInReceipt(
  receipt,
) {
  for (
    const log of receipt.logs
  ) {
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
        decoded.eventName !==
        "EntityClosed"
      ) {
        continue;
      }

      if (
        decoded.args.tenantId &&
        !same(
          decoded.args.tenantId,
          tenantId,
        )
      ) {
        continue;
      }

      if (
        decoded.args.entityId &&
        !same(
          decoded.args.entityId,
          entityId,
        )
      ) {
        continue;
      }

      if (
        decoded.args.evidenceHash &&
        !same(
          decoded.args.evidenceHash,
          closeEvidenceHash,
        )
      ) {
        continue;
      }

      return decoded;
    } catch {
      // Ignore unrelated logs.
    }
  }

  return null;
}

async function findExistingCloseEvent() {
  const logs =
    await publicClient.getContractEvents({
      address:
        contractAddress,

      abi:
        artifact.abi,

      eventName:
        "EntityClosed",

      fromBlock:
        0n,

      toBlock:
        "latest",
    });

  return (
    logs.find(
      (log) => {
        if (
          log.args.tenantId &&
          !same(
            log.args.tenantId,
            tenantId,
          )
        ) {
          return false;
        }

        if (
          log.args.entityId &&
          !same(
            log.args.entityId,
            entityId,
          )
        ) {
          return false;
        }

        if (
          log.args.evidenceHash &&
          !same(
            log.args.evidenceHash,
            closeEvidenceHash,
          )
        ) {
          return false;
        }

        return true;
      },
    ) ??
    null
  );
}

const closeValues = {
  tenantId,
  roleId:
    distributorRoleId,
  entityId,
  eventType:
    closeEventType,
  evidenceHash:
    closeEvidenceHash,
};

const blockedTraceValues = {
  tenantId,
  roleId:
    distributorRoleId,
  entityId,
  eventType:
    id(
      "AFTER_CLOSE_TRACE",
    ),
  evidenceHash:
    id(
      "AFTER_CLOSE_TRACE_EVIDENCE",
    ),
};

const blockedStateValues = {
  tenantId,
  roleId:
    distributorRoleId,
  entityId,

  newState:
    id(
      "AFTER_CLOSE_STATE",
    ),

  state:
    id(
      "AFTER_CLOSE_STATE",
    ),

  currentState:
    id(
      "AFTER_CLOSE_STATE",
    ),

  eventType:
    id(
      "AFTER_CLOSE_STATE_UPDATE",
    ),

  evidenceHash:
    id(
      "AFTER_CLOSE_STATE_EVIDENCE",
    ),
};

const blockedMetadataValues = {
  tenantId,
  roleId:
    distributorRoleId,
  entityId,

  newMetadataHash:
    id(
      "AFTER_CLOSE_METADATA",
    ),

  metadataHash:
    id(
      "AFTER_CLOSE_METADATA",
    ),

  eventType:
    id(
      "AFTER_CLOSE_METADATA_UPDATE",
    ),

  evidenceHash:
    id(
      "AFTER_CLOSE_METADATA_EVIDENCE",
    ),
};

const recipientAliases = {
  toOrganizationId:
    producerOrganizationId,

  recipientOrganizationId:
    producerOrganizationId,

  targetOrganizationId:
    producerOrganizationId,

  newCustodianOrganizationId:
    producerOrganizationId,

  toOrganization:
    producerOrganizationId,

  recipientOrganization:
    producerOrganizationId,

  targetOrganization:
    producerOrganizationId,

  recipient:
    producerOrganizationId,
};

const blockedCustodyValues = {
  tenantId,
  roleId:
    distributorRoleId,
  entityId,

  ...recipientAliases,

  eventType:
    id(
      "AFTER_CLOSE_CUSTODY",
    ),

  evidenceHash:
    id(
      "AFTER_CLOSE_CUSTODY_EVIDENCE",
    ),
};

const blockedLinkStatusValues = {
  tenantId,
  roleId:
    distributorRoleId,
  sourceEntityId,
  targetEntityId:
    entityId,
  linkType,
  active:
    false,
  eventType:
    id(
      "AFTER_CLOSE_LINK_STATUS",
    ),
  evidenceHash:
    id(
      "AFTER_CLOSE_LINK_STATUS_EVIDENCE",
    ),
};

const blockedNewLinkValues = {
  tenantId,
  roleId:
    distributorRoleId,

  sourceEntityId:
    entityId,

  targetEntityId:
    sourceEntityId,

  linkType:
    id(
      "CLOSED_ITEM_TEST_LINK",
    ),

  eventType:
    id(
      "AFTER_CLOSE_NEW_LINK",
    ),

  evidenceHash:
    id(
      "AFTER_CLOSE_NEW_LINK_EVIDENCE",
    ),
};

const requiredCapabilities = [
  ["TRACE_RECORD", 1],
  ["STATE_UPDATE", 2],
  ["METADATA_UPDATE", 3],
  ["CUSTODY_TRANSFER", 4],
  ["ENTITY_LINK", 5],
  ["ENTITY_CLOSE", 6],
];

const [
  chainId,
  code,
  ...capabilities
] = await Promise.all([
  publicClient.getChainId(),

  publicClient.getCode({
    address:
      contractAddress,
  }),

  ...requiredCapabilities.map(
    ([, capability]) =>
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
              capability,
            },
          ),
      }),
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
  !code ||
  code === "0x"
) {
  throw new Error(
    "TraceForge contract code missing.",
  );
}

for (
  let index = 0;
  index <
    requiredCapabilities.length;
  index += 1
) {
  if (
    capabilities[index] !== true
  ) {
    throw new Error(
      `Distributor missing capability: ${requiredCapabilities[index][0]}`,
    );
  }
}

let entity =
  await readEntity(
    entityId,
  );

const source =
  await readEntity(
    sourceEntityId,
  );

const relationship =
  await readLink();

if (
  entity.exists !== true
) {
  throw new Error(
    "Sandbox item does not exist.",
  );
}

if (
  !same(
    entity.currentCustodian,
    distributorOrganizationId,
  )
) {
  throw new Error(
    "Distributor is not current item custodian.",
  );
}

if (
  source.closed !== false
) {
  throw new Error(
    "Source batch must remain open for this proof.",
  );
}

if (
  relationship.active !== true
) {
  throw new Error(
    "Expected CONTAINS relationship to be active before closure.",
  );
}

const stateBefore =
  entity.currentState;

const metadataBefore =
  entity.metadataHash;

const custodyBefore =
  entity.currentCustodian;

console.log(
  "TraceForge Terminal Lifecycle Proof",
);

console.log(
  "===================================",
);

console.log();

console.log(
  `Mode:              ${broadcast ? "BROADCAST" : "DRY RUN"}`,
);

console.log(
  `Entity ID:         ${entityId}`,
);

console.log(
  `Custodian:         ${entity.currentCustodian}`,
);

console.log(
  `Currently closed:  ${entity.closed}`,
);

console.log(
  `Relationship:      active`,
);

console.log();

console.log(
  `ABI: ${signature("closeEntity")}`,
);

console.log(
  `ABI: ${signature("recordTrace")}`,
);

console.log(
  `ABI: ${signature("updateEntityState")}`,
);

console.log(
  `ABI: ${signature("updateEntityMetadata")}`,
);

console.log(
  `ABI: ${signature("proposeCustodyTransfer")}`,
);

console.log(
  `ABI: ${signature("setEntityLinkActive")}`,
);

console.log(
  `ABI: ${signature("createEntityLink")}`,
);

if (
  !broadcast
) {
  console.log();

  if (
    entity.closed === false
  ) {
    const estimate =
      await publicClient.estimateContractGas({
        address:
          contractAddress,

        abi:
          artifact.abi,

        functionName:
          "closeEntity",

        args:
          argsFor(
            "closeEntity",
            closeValues,
          ),

        account:
          distributor.address,

        gasPrice:
          0n,
      });

    console.log(
      `Close gas:         ${estimate}`,
    );

    console.log();
    console.log(
      "Pending operation: closeEntity",
    );
  } else {
    console.log(
      "Entity is already closed; closure transaction will be recovered.",
    );
  }

  console.log();
  console.log(
    "Post-close proofs:",
  );

  console.log(
    "  - recordTrace rejected",
  );

  console.log(
    "  - state update rejected",
  );

  console.log(
    "  - metadata update rejected",
  );

  console.log(
    "  - custody proposal rejected",
  );

  console.log(
    "  - existing relationship mutation rejected",
  );

  console.log(
    "  - new relationship rejected",
  );

  console.log(
    "  - second close rejected",
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
    ? JSON.parse(
        readFileSync(
          outputPath,
          "utf8",
        ),
      )
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

        entity: {
          entityId,
          organizationId:
            distributorOrganizationId,
          roleId:
            distributorRoleId,
        },

        closure: {
          eventType:
            closeEventType,
          evidenceHash:
            closeEvidenceHash,
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
  entity.closed === false
) {
  const args =
    argsFor(
      "closeEntity",
      closeValues,
    );

  const estimate =
    await publicClient.estimateContractGas({
      address:
        contractAddress,

      abi:
        artifact.abi,

      functionName:
        "closeEntity",

      args,

      account:
        distributor.address,

      gasPrice:
        0n,
    });

  const gas =
    (estimate * 120n) / 100n;

  console.log();
  console.log(
    "closeEntity",
  );

  console.log(
    `  estimated gas: ${estimate}`,
  );

  const hash =
    await walletClient.writeContract({
      address:
        contractAddress,

      abi:
        artifact.abi,

      functionName:
        "closeEntity",

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
    receipt.status !==
    "success"
  ) {
    throw new Error(
      "closeEntity failed.",
    );
  }

  const closeEvent =
    findCloseEventInReceipt(
      receipt,
    );

  if (!closeEvent) {
    throw new Error(
      "Matching EntityClosed event missing.",
    );
  }

  record.transactions.closeEntity = {
    hash,
    blockNumber:
      receipt.blockNumber.toString(),
    gasUsed:
      receipt.gasUsed.toString(),
  };

  save();

  console.log(
    `  block:         ${receipt.blockNumber}`,
  );
} else if (
  !record.transactions.closeEntity
) {
  const existing =
    await findExistingCloseEvent();

  if (!existing) {
    throw new Error(
      "Entity is closed but matching EntityClosed event could not be recovered.",
    );
  }

  record.transactions.closeEntity = {
    hash:
      existing.transactionHash,
    blockNumber:
      existing.blockNumber.toString(),
    recoveredFromChain:
      true,
  };

  save();

  console.log();
  console.log(
    "Recovered existing close transaction from chain.",
  );
}

entity =
  await readEntity(
    entityId,
  );

if (
  entity.closed !== true
) {
  throw new Error(
    "Entity closed flag verification failed.",
  );
}

if (
  !same(
    entity.currentState,
    stateBefore,
  )
) {
  throw new Error(
    "Closing unexpectedly changed current state.",
  );
}

if (
  !same(
    entity.metadataHash,
    metadataBefore,
  )
) {
  throw new Error(
    "Closing unexpectedly changed metadata hash.",
  );
}

if (
  !same(
    entity.currentCustodian,
    custodyBefore,
  )
) {
  throw new Error(
    "Closing unexpectedly changed custody.",
  );
}

console.log();
console.log(
  "Entity closed. Running terminal mutation proofs...",
);

const proofs = {};

proofs.recordTrace =
  await expectClosedRevert({
    label:
      "recordTrace",

    functionName:
      "recordTrace",

    values:
      blockedTraceValues,
  });

proofs.updateEntityState =
  await expectClosedRevert({
    label:
      "updateEntityState",

    functionName:
      "updateEntityState",

    values:
      blockedStateValues,
  });

proofs.updateEntityMetadata =
  await expectClosedRevert({
    label:
      "updateEntityMetadata",

    functionName:
      "updateEntityMetadata",

    values:
      blockedMetadataValues,
  });

proofs.proposeCustodyTransfer =
  await expectClosedRevert({
    label:
      "proposeCustodyTransfer",

    functionName:
      "proposeCustodyTransfer",

    values:
      blockedCustodyValues,
  });

proofs.setEntityLinkActive =
  await expectClosedRevert({
    label:
      "setEntityLinkActive",

    functionName:
      "setEntityLinkActive",

    values:
      blockedLinkStatusValues,
  });

proofs.createEntityLink =
  await expectClosedRevert({
    label:
      "createEntityLink",

    functionName:
      "createEntityLink",

    values:
      blockedNewLinkValues,
  });

proofs.closeAgain =
  await expectClosedRevert({
    label:
      "closeEntity again",

    functionName:
      "closeEntity",

    values:
      closeValues,
  });

const finalEntity =
  await readEntity(
    entityId,
  );

const finalRelationship =
  await readLink();

if (
  finalEntity.closed !== true
) {
  throw new Error(
    "Final closed-state verification failed.",
  );
}

if (
  !same(
    finalEntity.currentCustodian,
    distributorOrganizationId,
  )
) {
  throw new Error(
    "Final custody verification failed.",
  );
}

if (
  finalRelationship.active !== true
) {
  throw new Error(
    "Existing relationship state unexpectedly changed.",
  );
}

record.complete = true;

record.verification = {
  entityClosed:
    true,

  stateUnchanged:
    true,

  metadataUnchanged:
    true,

  custodyUnchanged:
    true,

  existingRelationshipStillActive:
    true,

  recordTraceBlocked:
    proofs.recordTrace,

  stateUpdateBlocked:
    proofs.updateEntityState,

  metadataUpdateBlocked:
    proofs.updateEntityMetadata,

  custodyTransferBlocked:
    proofs.proposeCustodyTransfer,

  relationshipMutationBlocked:
    proofs.setEntityLinkActive,

  newRelationshipBlocked:
    proofs.createEntityLink,

  secondCloseBlocked:
    proofs.closeAgain,

  terminalGuard:
    "EntityIsClosed",
};

save();

console.log();
console.log(
  "TERMINAL LIFECYCLE PROOF SUCCESSFUL.",
);

console.log(
  "Entity:            CLOSED",
);

console.log(
  "Custody:           unchanged",
);

console.log(
  "Relationship:      frozen active",
);

console.log(
  "Blocked mutations: 7/7",
);

console.log(
  "Guard:             EntityIsClosed",
);

console.log(
  `Record:            ${outputPath}`,
);
