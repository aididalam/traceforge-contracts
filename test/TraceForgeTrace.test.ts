import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { network } from "hardhat";
import {
  keccak256,
  stringToHex,
  zeroHash,
} from "viem";

function id(value: string) {
  return keccak256(stringToHex(value));
}

const CAPABILITY = {
  ENTITY_CREATE: 0,
  TRACE_RECORD: 1,
  STATE_UPDATE: 2,
  METADATA_UPDATE: 3,
  CUSTODY_TRANSFER: 4,
  ENTITY_LINK: 5,
  ENTITY_CLOSE: 6,
} as const;

async function setup() {
  const connection = await network.create();
  const { viem } = connection;

  const [
    owner,
    tenantAdmin,
    outsider,
    organizationWallet,
  ] = await viem.getWalletClients();

  const publicClient = await viem.getPublicClient();

  const traceForge =
    await viem.deployContract("TraceForge");

  async function wait(hash: `0x${string}`) {
    return publicClient.waitForTransactionReceipt({
      hash,
    });
  }

  async function asWallet(wallet: typeof tenantAdmin) {
    return viem.getContractAt(
      "TraceForge",
      traceForge.address,
      {
        client: {
          wallet,
        },
      },
    );
  }

  return {
    viem,
    owner,
    tenantAdmin,
    outsider,
    organizationWallet,
    publicClient,
    traceForge,
    wait,
    asWallet,
  };
}

async function prepareEntity() {
  const context = await setup();

  const {
    traceForge,
    tenantAdmin,
    organizationWallet,
    wait,
    asWallet,
  } = context;

  const tenantId = id("TENANT_A");
  const organizationId = id("ORG_A");
  const roleId = id("OPERATOR");
  const entityId = id("ITEM_001");

  const entityType = id("PRODUCT");
  const metadataHash = id("ITEM_METADATA_V1");
  const initialState = id("MANUFACTURED");

  await wait(
    await traceForge.write.createTenant([
      tenantId,
      id("TENANT_METADATA"),
      tenantAdmin.account.address,
    ]),
  );

  await wait(
    await traceForge.write.registerOrganization([
      organizationId,
      id("ORG_METADATA"),
    ]),
  );

  await wait(
    await traceForge.write.bindWallet([
      organizationId,
      organizationWallet.account.address,
    ]),
  );

  const adminContract =
    await asWallet(tenantAdmin);

  await wait(
    await adminContract.write.addOrganizationToTenant([
      tenantId,
      organizationId,
    ]),
  );

  await wait(
    await adminContract.write.createRole([
      tenantId,
      roleId,
      id("OPERATOR_ROLE_METADATA"),
    ]),
  );

  await wait(
    await adminContract.write.setRoleCapability([
      tenantId,
      roleId,
      CAPABILITY.ENTITY_CREATE,
      true,
    ]),
  );

  await wait(
    await adminContract.write.assignRoleToOrganization([
      tenantId,
      organizationId,
      roleId,
    ]),
  );

  const organizationContract =
    await asWallet(organizationWallet);

  await wait(
    await organizationContract.write.createEntity([
      tenantId,
      roleId,
      entityId,
      entityType,
      metadataHash,
      initialState,
    ]),
  );

  return {
    ...context,
    adminContract,
    organizationContract,
    tenantId,
    organizationId,
    roleId,
    entityId,
    entityType,
    metadataHash,
    initialState,
  };
}

describe("TraceForge trace and evidence foundation", () => {
  it("records immutable trace evidence when TRACE_RECORD is granted", async () => {
    const {
      adminContract,
      organizationContract,
      organizationWallet,
      publicClient,
      traceForge,
      tenantId,
      organizationId,
      roleId,
      entityId,
      initialState,
      metadataHash,
      wait,
    } = await prepareEntity();

    await wait(
      await adminContract.write.setRoleCapability([
        tenantId,
        roleId,
        CAPABILITY.TRACE_RECORD,
        true,
      ]),
    );

    const eventType = id("QUALITY_CHECKED");
    const evidenceHash = id("QUALITY_REPORT_HASH");

    const receipt = await wait(
      await organizationContract.write.recordTrace([
        tenantId,
        roleId,
        entityId,
        eventType,
        evidenceHash,
      ]),
    );

    const events =
      await publicClient.getContractEvents({
        address: traceForge.address,
        abi: traceForge.abi,
        eventName: "TraceRecorded",
        fromBlock: receipt.blockNumber,
        toBlock: receipt.blockNumber,
      });

    assert.equal(events.length, 1);

    const event = events[0];

    assert.equal(
      event.args.tenantId,
      tenantId,
    );

    assert.equal(
      event.args.entityId,
      entityId,
    );

    assert.equal(
      event.args.eventType,
      eventType,
    );

    assert.equal(
      event.args.organizationId,
      organizationId,
    );

    assert.equal(
      event.args.roleId,
      roleId,
    );

    assert.equal(
      event.args.actor?.toLowerCase(),
      organizationWallet.account.address.toLowerCase(),
    );

    assert.equal(
      event.args.evidenceHash,
      evidenceHash,
    );

    assert.equal(
      event.args.stateAfter,
      initialState,
    );

    assert.equal(
      event.args.metadataHashAfter,
      metadataHash,
    );
  });

  it("recordTrace does not mutate current entity state or metadata", async () => {
    const {
      adminContract,
      organizationContract,
      traceForge,
      tenantId,
      roleId,
      entityId,
      wait,
    } = await prepareEntity();

    await wait(
      await adminContract.write.setRoleCapability([
        tenantId,
        roleId,
        CAPABILITY.TRACE_RECORD,
        true,
      ]),
    );

    const before =
      await traceForge.read.getEntity([
        tenantId,
        entityId,
      ]);

    await wait(
      await organizationContract.write.recordTrace([
        tenantId,
        roleId,
        entityId,
        id("INSPECTED"),
        id("INSPECTION_EVIDENCE"),
      ]),
    );

    const after =
      await traceForge.read.getEntity([
        tenantId,
        entityId,
      ]);

    assert.equal(
      after.currentState,
      before.currentState,
    );

    assert.equal(
      after.metadataHash,
      before.metadataHash,
    );

    assert.equal(
      after.updatedAt,
      before.updatedAt,
    );
  });

  it("updates current state only with STATE_UPDATE capability", async () => {
    const {
      adminContract,
      organizationContract,
      publicClient,
      traceForge,
      tenantId,
      roleId,
      entityId,
      wait,
    } = await prepareEntity();

    const newState = id("PACKAGED");
    const eventType = id("PACKAGED");
    const evidenceHash = id("PACKAGING_EVIDENCE");

    await assert.rejects(async () => {
      await organizationContract.write.updateEntityState([
        tenantId,
        roleId,
        entityId,
        eventType,
        newState,
        evidenceHash,
      ]);
    });

    await wait(
      await adminContract.write.setRoleCapability([
        tenantId,
        roleId,
        CAPABILITY.STATE_UPDATE,
        true,
      ]),
    );

    const receipt = await wait(
      await organizationContract.write.updateEntityState([
        tenantId,
        roleId,
        entityId,
        eventType,
        newState,
        evidenceHash,
      ]),
    );

    const entity =
      await traceForge.read.getEntity([
        tenantId,
        entityId,
      ]);

    assert.equal(
      entity.currentState,
      newState,
    );

    const events =
      await publicClient.getContractEvents({
        address: traceForge.address,
        abi: traceForge.abi,
        eventName: "TraceRecorded",
        fromBlock: receipt.blockNumber,
        toBlock: receipt.blockNumber,
      });

    assert.equal(events.length, 1);

    assert.equal(
      events[0].args.stateAfter,
      newState,
    );
  });

  it("updates metadata hash only with METADATA_UPDATE capability", async () => {
    const {
      adminContract,
      organizationContract,
      publicClient,
      traceForge,
      tenantId,
      roleId,
      entityId,
      wait,
    } = await prepareEntity();

    const newMetadataHash =
      id("ITEM_METADATA_V2");

    const eventType =
      id("METADATA_REVISED");

    const evidenceHash =
      id("METADATA_REVISION_EVIDENCE");

    await assert.rejects(async () => {
      await organizationContract.write.updateEntityMetadata([
        tenantId,
        roleId,
        entityId,
        eventType,
        newMetadataHash,
        evidenceHash,
      ]);
    });

    await wait(
      await adminContract.write.setRoleCapability([
        tenantId,
        roleId,
        CAPABILITY.METADATA_UPDATE,
        true,
      ]),
    );

    const receipt = await wait(
      await organizationContract.write.updateEntityMetadata([
        tenantId,
        roleId,
        entityId,
        eventType,
        newMetadataHash,
        evidenceHash,
      ]),
    );

    const entity =
      await traceForge.read.getEntity([
        tenantId,
        entityId,
      ]);

    assert.equal(
      entity.metadataHash,
      newMetadataHash,
    );

    const events =
      await publicClient.getContractEvents({
        address: traceForge.address,
        abi: traceForge.abi,
        eventName: "TraceRecorded",
        fromBlock: receipt.blockNumber,
        toBlock: receipt.blockNumber,
      });

    assert.equal(events.length, 1);

    assert.equal(
      events[0].args.metadataHashAfter,
      newMetadataHash,
    );
  });

  it("TRACE_RECORD alone does not authorize state or metadata mutation", async () => {
    const {
      adminContract,
      organizationContract,
      tenantId,
      roleId,
      entityId,
      wait,
    } = await prepareEntity();

    await wait(
      await adminContract.write.setRoleCapability([
        tenantId,
        roleId,
        CAPABILITY.TRACE_RECORD,
        true,
      ]),
    );

    await assert.rejects(async () => {
      await organizationContract.write.updateEntityState([
        tenantId,
        roleId,
        entityId,
        id("PACKAGED"),
        id("PACKAGED_STATE"),
        id("STATE_EVIDENCE"),
      ]);
    });

    await assert.rejects(async () => {
      await organizationContract.write.updateEntityMetadata([
        tenantId,
        roleId,
        entityId,
        id("METADATA_REVISED"),
        id("METADATA_V2"),
        id("METADATA_EVIDENCE"),
      ]);
    });
  });

  it("rejects zero event type or zero evidence hash", async () => {
    const {
      adminContract,
      organizationContract,
      tenantId,
      roleId,
      entityId,
      wait,
    } = await prepareEntity();

    await wait(
      await adminContract.write.setRoleCapability([
        tenantId,
        roleId,
        CAPABILITY.TRACE_RECORD,
        true,
      ]),
    );

    await assert.rejects(async () => {
      await organizationContract.write.recordTrace([
        tenantId,
        roleId,
        entityId,
        zeroHash,
        id("EVIDENCE"),
      ]);
    });

    await assert.rejects(async () => {
      await organizationContract.write.recordTrace([
        tenantId,
        roleId,
        entityId,
        id("INSPECTED"),
        zeroHash,
      ]);
    });
  });

  it("rejects zero or unchanged state updates", async () => {
    const {
      adminContract,
      organizationContract,
      tenantId,
      roleId,
      entityId,
      initialState,
      wait,
    } = await prepareEntity();

    await wait(
      await adminContract.write.setRoleCapability([
        tenantId,
        roleId,
        CAPABILITY.STATE_UPDATE,
        true,
      ]),
    );

    await assert.rejects(async () => {
      await organizationContract.write.updateEntityState([
        tenantId,
        roleId,
        entityId,
        id("STATE_CHANGED"),
        zeroHash,
        id("STATE_EVIDENCE"),
      ]);
    });

    await assert.rejects(async () => {
      await organizationContract.write.updateEntityState([
        tenantId,
        roleId,
        entityId,
        id("STATE_CHANGED"),
        initialState,
        id("STATE_EVIDENCE"),
      ]);
    });
  });

  it("rejects zero or unchanged metadata updates", async () => {
    const {
      adminContract,
      organizationContract,
      tenantId,
      roleId,
      entityId,
      metadataHash,
      wait,
    } = await prepareEntity();

    await wait(
      await adminContract.write.setRoleCapability([
        tenantId,
        roleId,
        CAPABILITY.METADATA_UPDATE,
        true,
      ]),
    );

    await assert.rejects(async () => {
      await organizationContract.write.updateEntityMetadata([
        tenantId,
        roleId,
        entityId,
        id("METADATA_REVISED"),
        zeroHash,
        id("METADATA_EVIDENCE"),
      ]);
    });

    await assert.rejects(async () => {
      await organizationContract.write.updateEntityMetadata([
        tenantId,
        roleId,
        entityId,
        id("METADATA_REVISED"),
        metadataHash,
        id("METADATA_EVIDENCE"),
      ]);
    });
  });
});
