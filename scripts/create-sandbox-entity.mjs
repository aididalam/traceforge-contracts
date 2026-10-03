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

const tenantRecordPath =
  "deployments/9009/bootstrap/tenant-traceforge-sandbox.json";

const organizationRecordPath =
  "deployments/9009/bootstrap/organization-sandbox-producer.json";

const artifactPath =
  "artifacts/contracts/TraceForge.sol/TraceForge.json";

const entityMetadataPath =
  "bootstrap/entity-sandbox-batch-001.json";

const traceEvidencePath =
  "bootstrap/trace-sandbox-batch-001-created.json";

const recordPath =
  "deployments/9009/bootstrap/entity-sandbox-batch-001.json";

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

function readPrivateKey(path) {
  const value =
    readFileSync(path, "utf8").trim();

  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(
      `Invalid private key file: ${path}`,
    );
  }

  return value;
}

function sameHex(a, b) {
  return (
    String(a).toLowerCase() ===
    String(b).toLowerCase()
  );
}

const deployment =
  loadJson(deploymentPath);

const tenantRecord =
  loadJson(tenantRecordPath);

const organizationRecord =
  loadJson(organizationRecordPath);

const artifact =
  loadJson(artifactPath);

if (
  organizationRecord.complete !== true
) {
  throw new Error(
    "Organization bootstrap record is not complete.",
  );
}

const entityBytes =
  readFileSync(
    entityMetadataPath,
  );

const traceBytes =
  readFileSync(
    traceEvidencePath,
  );

const entityMetadata =
  JSON.parse(
    entityBytes.toString("utf8"),
  );

const traceEvidence =
  JSON.parse(
    traceBytes.toString("utf8"),
  );

const tenantId =
  tenantRecord.tenant.tenantId;

const organizationId =
  organizationRecord.organization.organizationId;

const roleId =
  organizationRecord.role.roleId;

const expectedProducerWallet =
  organizationRecord.organization.wallet;

const entityId =
  keccak256(
    stringToHex(
      `traceforge:entity:${entityMetadata.slug}`,
    ),
  );

const entityType =
  keccak256(
    stringToHex(
      entityMetadata.entityType,
    ),
  );

const initialState =
  keccak256(
    stringToHex(
      entityMetadata.initialState,
    ),
  );

const eventType =
  keccak256(
    stringToHex(
      traceEvidence.event,
    ),
  );

const metadataHash =
  keccak256(
    toHex(entityBytes),
  );

const evidenceHash =
  keccak256(
    toHex(traceBytes),
  );

const producer =
  privateKeyToAccount(
    readPrivateKey(
      producerKeyPath,
    ),
  );

if (
  producer.address.toLowerCase() !==
  expectedProducerWallet.toLowerCase()
) {
  throw new Error(
    "Producer key does not match organization bootstrap record.",
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

function getFunction(name) {
  const fn =
    artifact.abi.find(
      (item) =>
        item.type === "function" &&
        item.name === name,
    );

  if (!fn) {
    throw new Error(
      `Required ABI function missing: ${name}`,
    );
  }

  return fn;
}

function getEvent(name) {
  const event =
    artifact.abi.find(
      (item) =>
        item.type === "event" &&
        item.name === name,
    );

  if (!event) {
    throw new Error(
      `Required ABI event missing: ${name}`,
    );
  }

  return event;
}

function argsFor(
  functionName,
  values,
) {
  const fn =
    getFunction(functionName);

  return fn.inputs.map(
    (input) => {
      if (
        !Object.prototype.hasOwnProperty.call(
          values,
          input.name,
        )
      ) {
        throw new Error(
          `Unsupported ABI input ${functionName}.${input.name}`,
        );
      }

      return values[input.name];
    },
  );
}

function signature(name) {
  const fn =
    getFunction(name);

  return (
    `${name}(` +
    fn.inputs
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
  const fn =
    getFunction(functionName);

  const components =
    fn.outputs?.[0]?.components;

  if (!components?.length) {
    return value;
  }

  const result = {};

  for (
    let i = 0;
    i < components.length;
    i += 1
  ) {
    const component =
      components[i];

    result[component.name] =
      value?.[component.name] ??
      value?.[i];
  }

  return result;
}

async function readTuple(
  functionName,
  values,
) {
  const result =
    await publicClient.readContract({
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
    });

  return tupleToObject(
    functionName,
    result,
  );
}

function verifyEventAbi(
  eventName,
  requiredNames,
) {
  const event =
    getEvent(eventName);

  const names =
    new Set(
      event.inputs.map(
        (input) => input.name,
      ),
    );

  for (
    const name of requiredNames
  ) {
    if (!names.has(name)) {
      throw new Error(
        `${eventName} event is missing expected field ${name}`,
      );
    }
  }
}

verifyEventAbi(
  "EntityCreated",
  [
    "tenantId",
    "entityId",
  ],
);

verifyEventAbi(
  "TraceRecorded",
  [
    "tenantId",
    "entityId",
    "eventType",
    "evidenceHash",
  ],
);

const createValues = {
  tenantId,
  roleId,
  entityId,
  entityType,
  metadataHash,

  initialState,
  currentState:
    initialState,
  state:
    initialState,

  eventType,
  initialEventType:
    eventType,

  evidenceHash,
  initialEvidenceHash:
    evidenceHash,
};

const traceValues = {
  tenantId,
  roleId,
  entityId,
  eventType,
  evidenceHash,
};

const entityExistsArgs =
  argsFor(
    "entityExists",
    {
      tenantId,
      entityId,
    },
  );

const [
  chainId,
  code,
  walletBinding,
  membership,
  assignment,
  createCapability,
  traceCapability,
  alreadyExists,
] = await Promise.all([
  publicClient.getChainId(),

  publicClient.getCode({
    address:
      contractAddress,
  }),

  readTuple(
    "getWalletBinding",
    {
      wallet:
        producer.address,
    },
  ),

  readTuple(
    "getTenantMembership",
    {
      tenantId,
      organizationId,
    },
  ),

  readTuple(
    "getOrganizationRoleAssignment",
    {
      tenantId,
      organizationId,
      roleId,
    },
  ),

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
          roleId,
          capability: 0,
        },
      ),
  }),

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
          roleId,
          capability: 1,
        },
      ),
  }),

  publicClient.readContract({
    address:
      contractAddress,

    abi:
      artifact.abi,

    functionName:
      "entityExists",

    args:
      entityExistsArgs,
  }),
]);

if (chainId !== CHAIN_ID) {
  throw new Error(
    `Wrong chain: ${chainId}`,
  );
}

if (!code || code === "0x") {
  throw new Error(
    "TraceForge contract code not found.",
  );
}

if (
  !walletBinding ||
  walletBinding.active !== true ||
  !sameHex(
    walletBinding.organizationId,
    organizationId,
  )
) {
  throw new Error(
    "Producer wallet binding verification failed.",
  );
}

if (
  !membership ||
  membership.active !== true
) {
  throw new Error(
    "Producer organization is not an active tenant member.",
  );
}

if (
  !assignment ||
  assignment.active !== true
) {
  throw new Error(
    "Producer role assignment is not active.",
  );
}

if (
  createCapability !== true
) {
  throw new Error(
    "Producer role lacks ENTITY_CREATE.",
  );
}

if (
  traceCapability !== true
) {
  throw new Error(
    "Producer role lacks TRACE_RECORD.",
  );
}

console.log(
  "TraceForge First Live Entity",
);

console.log(
  "============================",
);

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
  `Producer:      ${producer.address}`,
);

console.log(
  `Organization:  ${organizationId}`,
);

console.log(
  `Role ID:       ${roleId}`,
);

console.log();

console.log(
  `Entity slug:   ${entityMetadata.slug}`,
);

console.log(
  `Entity ID:     ${entityId}`,
);

console.log(
  `Entity type:   ${entityMetadata.entityType}`,
);

console.log(
  `Entity type ID:${entityType}`,
);

console.log(
  `Initial state: ${entityMetadata.initialState}`,
);

console.log(
  `State ID:      ${initialState}`,
);

console.log(
  `Metadata hash: ${metadataHash}`,
);

console.log();

console.log(
  `Trace event:   ${traceEvidence.event}`,
);

console.log(
  `Event type ID: ${eventType}`,
);

console.log(
  `Evidence hash: ${evidenceHash}`,
);

console.log();

console.log(
  `ABI: ${signature("createEntity")}`,
);

console.log(
  `ABI: ${signature("recordTrace")}`,
);

let createGas = null;

if (!alreadyExists) {
  createGas =
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
        producer.address,

      gasPrice:
        0n,
    });
}

console.log();

console.log(
  `Entity exists: ${alreadyExists}`,
);

if (
  createGas !== null
) {
  console.log(
    `Create gas:    ${createGas}`,
  );
}

if (!broadcast) {
  if (alreadyExists) {
    console.log();
    console.log(
      "Entity already exists; dry-run will not create another.",
    );
  } else {
    console.log();
    console.log(
      "Pending operation: createEntity",
    );

    console.log(
      "Pending operation: recordTrace",
    );
  }

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

        tenant: {
          tenantId,
        },

        organization: {
          organizationId,
          wallet:
            producer.address,
          roleId,
        },

        entity: {
          slug:
            entityMetadata.slug,

          entityId,
          entityType,
          initialState,
          metadataHash,
        },

        trace: {
          event:
            traceEvidence.event,

          eventType,
          evidenceHash,
        },

        transactions: {},
      };

function saveRecord() {
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

  writeFileSync(
    recordPath,
    JSON.stringify(
      record,
      null,
      2,
    ) + "\n",
  );
}

async function send(
  functionName,
  values,
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
  console.log(
    `${functionName}`,
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
      `${functionName} failed.`,
    );
  }

  console.log(
    `  block:         ${receipt.blockNumber}`,
  );

  return {
    hash,
    receipt,
  };
}

function decodedEvents(
  receipt,
  eventName,
) {
  const result = [];

  for (
    const log of receipt.logs
  ) {
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
        eventName
      ) {
        result.push(decoded);
      }
    } catch {
      // Ignore unrelated logs.
    }
  }

  return result;
}

if (!alreadyExists) {
  const result =
    await send(
      "createEntity",
      createValues,
    );

  const events =
    decodedEvents(
      result.receipt,
      "EntityCreated",
    );

  if (events.length === 0) {
    throw new Error(
      "EntityCreated event not found in transaction receipt.",
    );
  }

  record.transactions.createEntity = {
    hash:
      result.hash,

    blockNumber:
      result.receipt.blockNumber.toString(),

    gasUsed:
      result.receipt.gasUsed.toString(),
  };

  saveRecord();
}

const nowExists =
  await publicClient.readContract({
    address:
      contractAddress,

    abi:
      artifact.abi,

    functionName:
      "entityExists",

    args:
      entityExistsArgs,
  });

if (nowExists !== true) {
  throw new Error(
    "Entity does not exist after create step.",
  );
}

const entity =
  await readTuple(
    "getEntity",
    {
      tenantId,
      entityId,
    },
  );

if (
  entity.exists !== true
) {
  throw new Error(
    "Entity read-back exists flag failed.",
  );
}

if (
  !sameHex(
    entity.entityType,
    entityType,
  )
) {
  throw new Error(
    "Entity type verification failed.",
  );
}

if (
  !sameHex(
    entity.metadataHash,
    metadataHash,
  )
) {
  throw new Error(
    "Entity metadata hash verification failed.",
  );
}

if (
  !sameHex(
    entity.currentState,
    initialState,
  )
) {
  throw new Error(
    "Entity state verification failed.",
  );
}

if (
  !sameHex(
    entity.currentCustodian,
    organizationId,
  )
) {
  throw new Error(
    "Entity custody verification failed.",
  );
}

if (
  entity.closed !== false
) {
  throw new Error(
    "New entity is unexpectedly closed.",
  );
}

let traceAlreadyRecorded = false;

if (
  record.transactions?.recordTrace
) {
  traceAlreadyRecorded = true;
}

if (!traceAlreadyRecorded) {
  const fromBlock =
    BigInt(
      deployment.deployment.blockNumber,
    );

  const existingTraceLogs =
    await publicClient.getContractEvents({
      address:
        contractAddress,

      abi:
        artifact.abi,

      eventName:
        "TraceRecorded",

      fromBlock,
      toBlock:
        "latest",
    });

  traceAlreadyRecorded =
    existingTraceLogs.some(
      (log) =>
        sameHex(
          log.args.tenantId,
          tenantId,
        ) &&
        sameHex(
          log.args.entityId,
          entityId,
        ) &&
        sameHex(
          log.args.eventType,
          eventType,
        ) &&
        sameHex(
          log.args.evidenceHash,
          evidenceHash,
        ),
    );

  if (
    traceAlreadyRecorded
  ) {
    const log =
      existingTraceLogs.find(
        (candidate) =>
          sameHex(
            candidate.args.tenantId,
            tenantId,
          ) &&
          sameHex(
            candidate.args.entityId,
            entityId,
          ) &&
          sameHex(
            candidate.args.eventType,
            eventType,
          ) &&
          sameHex(
            candidate.args.evidenceHash,
            evidenceHash,
          ),
      );

    record.transactions.recordTrace = {
      hash:
        log.transactionHash,

      blockNumber:
        log.blockNumber.toString(),

      recoveredFromChain:
        true,
    };

    saveRecord();
  }
}

if (!traceAlreadyRecorded) {
  const result =
    await send(
      "recordTrace",
      traceValues,
    );

  const events =
    decodedEvents(
      result.receipt,
      "TraceRecorded",
    );

  const matching =
    events.find(
      (event) =>
        sameHex(
          event.args.tenantId,
          tenantId,
        ) &&
        sameHex(
          event.args.entityId,
          entityId,
        ) &&
        sameHex(
          event.args.eventType,
          eventType,
        ) &&
        sameHex(
          event.args.evidenceHash,
          evidenceHash,
        ),
    );

  if (!matching) {
    throw new Error(
      "Matching TraceRecorded event not found.",
    );
  }

  record.transactions.recordTrace = {
    hash:
      result.hash,

    blockNumber:
      result.receipt.blockNumber.toString(),

    gasUsed:
      result.receipt.gasUsed.toString(),
  };

  saveRecord();
}

const finalEntity =
  await readTuple(
    "getEntity",
    {
      tenantId,
      entityId,
    },
  );

if (
  !sameHex(
    finalEntity.currentState,
    initialState,
  ) ||
  !sameHex(
    finalEntity.metadataHash,
    metadataHash,
  ) ||
  !sameHex(
    finalEntity.currentCustodian,
    organizationId,
  ) ||
  finalEntity.closed !== false
) {
  throw new Error(
    "Final entity verification failed.",
  );
}

record.complete = true;

record.verification = {
  exists: true,
  metadataMatches: true,
  stateMatches: true,
  custodianMatches: true,
  closed: false,
  traceRecorded: true,
};

saveRecord();

console.log();
console.log(
  "FIRST LIVE ENTITY SUCCESSFUL.",
);

console.log(
  `Entity ID:     ${entityId}`,
);

console.log(
  `Custodian:     ${organizationId}`,
);

console.log(
  `Metadata hash: ${metadataHash}`,
);

console.log(
  `Evidence hash: ${evidenceHash}`,
);

console.log(
  "Trace event:   verified",
);

console.log(
  `Record:        ${recordPath}`,
);
