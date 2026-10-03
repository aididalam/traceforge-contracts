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

const deploymentPath =
  "deployments/9009/TraceForge.json";

const entityRecordPath =
  "deployments/9009/bootstrap/entity-sandbox-batch-001.json";

const artifactPath =
  "artifacts/contracts/TraceForge.sol/TraceForge.json";

const metadataPath =
  "bootstrap/entity-sandbox-batch-001-v2.json";

const stateEvidencePath =
  "bootstrap/evidence-sandbox-batch-001-packed.json";

const metadataEvidencePath =
  "bootstrap/evidence-sandbox-batch-001-metadata-v2.json";

const traceEvidencePath =
  "bootstrap/evidence-sandbox-batch-001-quality-check.json";

const recordPath =
  "deployments/9009/operations/entity-sandbox-batch-001-update-001.json";

const producerKeyPath =
  process.env.TRACEFORGE_PRODUCER_KEY_FILE ??
  join(
    homedir(),
    ".traceforge",
    "secrets",
    "sandbox-producer.key",
  );

function loadJson(path) {
  return JSON.parse(
    readFileSync(path, "utf8"),
  );
}

function readKey(path) {
  const key =
    readFileSync(path, "utf8").trim();

  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error(
      `Invalid private key: ${path}`,
    );
  }

  return key;
}

function hashFile(path) {
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

const deployment =
  loadJson(deploymentPath);

const creation =
  loadJson(entityRecordPath);

const artifact =
  loadJson(artifactPath);

if (creation.complete !== true) {
  throw new Error(
    "Initial entity record is not complete.",
  );
}

const metadata =
  loadJson(metadataPath);

const stateEvidence =
  loadJson(stateEvidencePath);

const metadataEvidence =
  loadJson(metadataEvidencePath);

const traceEvidence =
  loadJson(traceEvidencePath);

const tenantId =
  creation.tenant.tenantId;

const organizationId =
  creation.organization.organizationId;

const roleId =
  creation.organization.roleId;

const entityId =
  creation.entity.entityId;

const originalState =
  creation.entity.initialState;

const originalMetadataHash =
  creation.entity.metadataHash;

const targetState =
  id("PACKED");

const targetMetadataHash =
  hashFile(metadataPath);

const stateEventType =
  id(stateEvidence.event);

const stateEvidenceHash =
  hashFile(stateEvidencePath);

const metadataEventType =
  id(metadataEvidence.event);

const metadataEvidenceHash =
  hashFile(metadataEvidencePath);

const traceEventType =
  id(traceEvidence.event);

const traceEvidenceHash =
  hashFile(traceEvidencePath);

const producer =
  privateKeyToAccount(
    readKey(producerKeyPath),
  );

if (
  producer.address.toLowerCase() !==
  creation.organization.wallet.toLowerCase()
) {
  throw new Error(
    "Producer key does not match entity creation record.",
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
    account: producer,
  });

const contractAddress =
  deployment.contract.address;

function fn(name) {
  const result =
    artifact.abi.find(
      (item) =>
        item.type === "function" &&
        item.name === name,
    );

  if (!result) {
    throw new Error(
      `ABI function missing: ${name}`,
    );
  }

  return result;
}

function argsFor(
  functionName,
  values,
) {
  return fn(functionName).inputs.map(
    (input) => {
      if (
        !Object.prototype.hasOwnProperty.call(
          values,
          input.name,
        )
      ) {
        throw new Error(
          `Unsupported ABI input: ${functionName}.${input.name}`,
        );
      }

      return values[input.name];
    },
  );
}

function signature(name) {
  const item = fn(name);

  return (
    `${name}(` +
    item.inputs
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
    const name =
      components[i].name;

    result[name] =
      value?.[name] ??
      value?.[i];
  }

  return result;
}

async function getEntity() {
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

const common = {
  tenantId,
  roleId,
  entityId,
};

const stateValues = {
  ...common,

  newState:
    targetState,

  state:
    targetState,

  currentState:
    targetState,

  eventType:
    stateEventType,

  evidenceHash:
    stateEvidenceHash,
};

const metadataValues = {
  ...common,

  newMetadataHash:
    targetMetadataHash,

  metadataHash:
    targetMetadataHash,

  eventType:
    metadataEventType,

  evidenceHash:
    metadataEvidenceHash,
};

const traceValues = {
  ...common,

  eventType:
    traceEventType,

  evidenceHash:
    traceEvidenceHash,
};

async function hasCapability(
  capability,
) {
  return publicClient.readContract({
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
          roleId,
          capability,
        },
      ),
  });
}

async function findTrace(
  eventType,
  evidenceHash,
) {
  const logs =
    await publicClient.getContractEvents({
      address:
        contractAddress,

      abi:
        artifact.abi,

      eventName:
        "TraceRecorded",

      fromBlock:
        0n,

      toBlock:
        "latest",
    });

  return (
    logs.find(
      (log) =>
        same(
          log.args.tenantId,
          tenantId,
        ) &&
        same(
          log.args.entityId,
          entityId,
        ) &&
        same(
          log.args.eventType,
          eventType,
        ) &&
        same(
          log.args.evidenceHash,
          evidenceHash,
        ),
    ) ??
    null
  );
}

function decodedTrace(
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
          "TraceRecorded" &&
        same(
          decoded.args.tenantId,
          tenantId,
        ) &&
        same(
          decoded.args.entityId,
          entityId,
        ) &&
        same(
          decoded.args.eventType,
          eventType,
        ) &&
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

async function send(
  functionName,
  values,
  eventType,
  evidenceHash,
) {
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
        producer.address,

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
    await walletClient.writeContract({
      address:
        contractAddress,

      abi:
        artifact.abi,

      functionName,

      args,

      account:
        producer,

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
      `${functionName} transaction failed.`,
    );
  }

  console.log(
    `  block:         ${receipt.blockNumber}`,
  );

  if (
    !decodedTrace(
      receipt,
      eventType,
      evidenceHash,
    )
  ) {
    throw new Error(
      `${functionName}: matching TraceRecorded event missing.`,
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
  code,
  traceCapability,
  stateCapability,
  metadataCapability,
] = await Promise.all([
  publicClient.getChainId(),

  publicClient.getCode({
    address:
      contractAddress,
  }),

  hasCapability(1),

  hasCapability(2),

  hasCapability(3),
]);

if (chainId !== CHAIN_ID) {
  throw new Error(
    `Wrong chain: ${chainId}`,
  );
}

if (!code || code === "0x") {
  throw new Error(
    "TraceForge contract code missing.",
  );
}

if (traceCapability !== true) {
  throw new Error(
    "TRACE_RECORD capability missing.",
  );
}

if (stateCapability !== true) {
  throw new Error(
    "STATE_UPDATE capability missing.",
  );
}

if (metadataCapability !== true) {
  throw new Error(
    "METADATA_UPDATE capability missing.",
  );
}

const before =
  await getEntity();

if (
  before.exists !== true
) {
  throw new Error(
    "Entity does not exist.",
  );
}

if (
  before.closed !== false
) {
  throw new Error(
    "Entity is closed.",
  );
}

if (
  !same(
    before.currentCustodian,
    organizationId,
  )
) {
  throw new Error(
    "Producer organization is not current custodian.",
  );
}

const stateDone =
  same(
    before.currentState,
    targetState,
  );

const metadataDone =
  same(
    before.metadataHash,
    targetMetadataHash,
  );

if (
  !stateDone &&
  !same(
    before.currentState,
    originalState,
  )
) {
  throw new Error(
    "Unexpected current entity state; refusing overwrite.",
  );
}

if (
  !metadataDone &&
  !same(
    before.metadataHash,
    originalMetadataHash,
  )
) {
  throw new Error(
    "Unexpected current metadata hash; refusing overwrite.",
  );
}

const existingStateTrace =
  await findTrace(
    stateEventType,
    stateEvidenceHash,
  );

const existingMetadataTrace =
  await findTrace(
    metadataEventType,
    metadataEvidenceHash,
  );

const existingStandaloneTrace =
  await findTrace(
    traceEventType,
    traceEvidenceHash,
  );

if (
  stateDone &&
  !existingStateTrace
) {
  throw new Error(
    "Target state exists but matching state evidence is missing.",
  );
}

if (
  metadataDone &&
  !existingMetadataTrace
) {
  throw new Error(
    "Target metadata exists but matching metadata evidence is missing.",
  );
}

console.log(
  "TraceForge Entity Lifecycle Update",
);

console.log(
  "==================================",
);

console.log();

console.log(
  `Mode:           ${broadcast ? "BROADCAST" : "DRY RUN"}`,
);

console.log(
  `Chain ID:       ${chainId}`,
);

console.log(
  `Contract:       ${contractAddress}`,
);

console.log(
  `Producer:       ${producer.address}`,
);

console.log(
  `Entity ID:      ${entityId}`,
);

console.log();

console.log(
  `Target state:   PACKED`,
);

console.log(
  `State ID:       ${targetState}`,
);

console.log(
  `Metadata v2:    ${targetMetadataHash}`,
);

console.log();

console.log(
  `ABI: ${signature("updateEntityState")}`,
);

console.log(
  `ABI: ${signature("updateEntityMetadata")}`,
);

console.log(
  `ABI: ${signature("recordTrace")}`,
);

console.log();

console.log(
  `State updated:    ${stateDone}`,
);

console.log(
  `Metadata updated: ${metadataDone}`,
);

console.log(
  `Quality trace:    ${existingStandaloneTrace !== null}`,
);

const pending = [];

if (!stateDone) {
  pending.push(
    "updateEntityState -> PACKED",
  );
}

if (!metadataDone) {
  pending.push(
    "updateEntityMetadata -> revision 2",
  );
}

if (!existingStandaloneTrace) {
  pending.push(
    "recordTrace -> QUALITY_CHECK_PASSED",
  );
}

console.log();

if (pending.length === 0) {
  console.log(
    "Lifecycle update is already complete.",
  );
  process.exit(0);
}

console.log(
  "Pending operations:",
);

for (const operation of pending) {
  console.log(
    `  - ${operation}`,
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
  process.exit(0);
}

let record =
  existsSync(recordPath)
    ? loadJson(recordPath)
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
          organizationId,
          roleId,
        },

        update: {
          targetState,
          metadataHash:
            targetMetadataHash,

          events: {
            state: {
              eventType:
                stateEventType,
              evidenceHash:
                stateEvidenceHash,
            },

            metadata: {
              eventType:
                metadataEventType,
              evidenceHash:
                metadataEvidenceHash,
            },

            quality: {
              eventType:
                traceEventType,
              evidenceHash:
                traceEvidenceHash,
            },
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
    recordPath,
    JSON.stringify(
      record,
      null,
      2,
    ) + "\n",
  );
}

if (stateDone) {
  record.transactions.updateEntityState ??= {
    hash:
      existingStateTrace.transactionHash,

    blockNumber:
      existingStateTrace.blockNumber.toString(),

    recoveredFromChain:
      true,
  };

  save();
} else {
  record.transactions.updateEntityState =
    await send(
      "updateEntityState",
      stateValues,
      stateEventType,
      stateEvidenceHash,
    );

  save();

  const entity =
    await getEntity();

  if (
    !same(
      entity.currentState,
      targetState,
    )
  ) {
    throw new Error(
      "State read-back verification failed.",
    );
  }
}

const currentAfterState =
  await getEntity();

if (
  same(
    currentAfterState.metadataHash,
    targetMetadataHash,
  )
) {
  const trace =
    existingMetadataTrace ??
    await findTrace(
      metadataEventType,
      metadataEvidenceHash,
    );

  if (!trace) {
    throw new Error(
      "Metadata target exists but matching evidence is missing.",
    );
  }

  record.transactions.updateEntityMetadata ??= {
    hash:
      trace.transactionHash,

    blockNumber:
      trace.blockNumber.toString(),

    recoveredFromChain:
      true,
  };

  save();
} else {
  record.transactions.updateEntityMetadata =
    await send(
      "updateEntityMetadata",
      metadataValues,
      metadataEventType,
      metadataEvidenceHash,
    );

  save();

  const entity =
    await getEntity();

  if (
    !same(
      entity.metadataHash,
      targetMetadataHash,
    )
  ) {
    throw new Error(
      "Metadata read-back verification failed.",
    );
  }
}

const currentStandaloneTrace =
  existingStandaloneTrace ??
  await findTrace(
    traceEventType,
    traceEvidenceHash,
  );

if (currentStandaloneTrace) {
  record.transactions.qualityTrace ??= {
    hash:
      currentStandaloneTrace.transactionHash,

    blockNumber:
      currentStandaloneTrace.blockNumber.toString(),

    recoveredFromChain:
      true,
  };

  save();
} else {
  record.transactions.qualityTrace =
    await send(
      "recordTrace",
      traceValues,
      traceEventType,
      traceEvidenceHash,
    );

  save();
}

const finalEntity =
  await getEntity();

if (
  !same(
    finalEntity.currentState,
    targetState,
  )
) {
  throw new Error(
    "Final state verification failed.",
  );
}

if (
  !same(
    finalEntity.metadataHash,
    targetMetadataHash,
  )
) {
  throw new Error(
    "Final metadata verification failed.",
  );
}

if (
  !same(
    finalEntity.currentCustodian,
    organizationId,
  )
) {
  throw new Error(
    "Custody unexpectedly changed.",
  );
}

if (
  finalEntity.closed !== false
) {
  throw new Error(
    "Entity unexpectedly closed.",
  );
}

const [
  finalStateTrace,
  finalMetadataTrace,
  finalQualityTrace,
] = await Promise.all([
  findTrace(
    stateEventType,
    stateEvidenceHash,
  ),

  findTrace(
    metadataEventType,
    metadataEvidenceHash,
  ),

  findTrace(
    traceEventType,
    traceEvidenceHash,
  ),
]);

if (
  !finalStateTrace ||
  !finalMetadataTrace ||
  !finalQualityTrace
) {
  throw new Error(
    "Final trace verification failed.",
  );
}

record.complete = true;

record.verification = {
  stateMatches: true,
  metadataMatches: true,
  custodyUnchanged: true,
  entityOpen: true,
  stateEvidenceRecorded: true,
  metadataEvidenceRecorded: true,
  qualityEvidenceRecorded: true,
};

save();

console.log();
console.log(
  "ENTITY LIFECYCLE UPDATE SUCCESSFUL.",
);

console.log(
  "Current state:   PACKED",
);

console.log(
  `Metadata hash:   ${targetMetadataHash}`,
);

console.log(
  "Custody:         unchanged",
);

console.log(
  "Evidence events: 3/3 verified",
);

console.log(
  `Record:          ${recordPath}`,
);
