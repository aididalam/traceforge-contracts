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
    organizationAWallet,
    organizationBWallet,
  ] = await viem.getWalletClients();

  const publicClient =
    await viem.getPublicClient();

  const traceForge =
    await viem.deployContract("TraceForge");

  async function wait(hash: `0x${string}`) {
    return publicClient.waitForTransactionReceipt({
      hash,
    });
  }

  async function asWallet(
    wallet: typeof tenantAdmin,
  ) {
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
    owner,
    tenantAdmin,
    organizationAWallet,
    organizationBWallet,
    publicClient,
    traceForge,
    wait,
    asWallet,
  };
}

async function prepareLifecycleScenario() {
  const context = await setup();

  const {
    traceForge,
    tenantAdmin,
    organizationAWallet,
    organizationBWallet,
    wait,
    asWallet,
  } = context;

  const tenantId = id("TENANT_A");
  const organizationAId = id("ORG_A");
  const organizationBId = id("ORG_B");
  const roleId = id("LIFECYCLE_OPERATOR");

  const entityId = id("ITEM_001");
  const targetEntityId = id("ITEM_002");

  await wait(
    await traceForge.write.createTenant([
      tenantId,
      id("TENANT_METADATA"),
      tenantAdmin.account.address,
    ]),
  );

  await wait(
    await traceForge.write.registerOrganization([
      organizationAId,
      id("ORG_A_METADATA"),
    ]),
  );

  await wait(
    await traceForge.write.registerOrganization([
      organizationBId,
      id("ORG_B_METADATA"),
    ]),
  );

  await wait(
    await traceForge.write.bindWallet([
      organizationAId,
      organizationAWallet.account.address,
    ]),
  );

  await wait(
    await traceForge.write.bindWallet([
      organizationBId,
      organizationBWallet.account.address,
    ]),
  );

  const adminContract =
    await asWallet(tenantAdmin);

  await wait(
    await adminContract.write.addOrganizationToTenant([
      tenantId,
      organizationAId,
    ]),
  );

  await wait(
    await adminContract.write.addOrganizationToTenant([
      tenantId,
      organizationBId,
    ]),
  );

  await wait(
    await adminContract.write.createRole([
      tenantId,
      roleId,
      id("LIFECYCLE_ROLE_METADATA"),
    ]),
  );

  for (const capability of [
    CAPABILITY.ENTITY_CREATE,
    CAPABILITY.TRACE_RECORD,
    CAPABILITY.STATE_UPDATE,
    CAPABILITY.METADATA_UPDATE,
    CAPABILITY.CUSTODY_TRANSFER,
    CAPABILITY.ENTITY_LINK,
    CAPABILITY.ENTITY_CLOSE,
  ]) {
    await wait(
      await adminContract.write.setRoleCapability([
        tenantId,
        roleId,
        capability,
        true,
      ]),
    );
  }

  await wait(
    await adminContract.write.assignRoleToOrganization([
      tenantId,
      organizationAId,
      roleId,
    ]),
  );

  await wait(
    await adminContract.write.assignRoleToOrganization([
      tenantId,
      organizationBId,
      roleId,
    ]),
  );

  const organizationAContract =
    await asWallet(organizationAWallet);

  const organizationBContract =
    await asWallet(organizationBWallet);

  await wait(
    await organizationAContract.write.createEntity([
      tenantId,
      roleId,
      entityId,
      id("PRODUCT"),
      id("ITEM_001_METADATA"),
      id("ACTIVE"),
    ]),
  );

  await wait(
    await organizationAContract.write.createEntity([
      tenantId,
      roleId,
      targetEntityId,
      id("PRODUCT"),
      id("ITEM_002_METADATA"),
      id("ACTIVE"),
    ]),
  );

  return {
    ...context,
    adminContract,
    organizationAContract,
    organizationBContract,
    tenantId,
    organizationAId,
    organizationBId,
    roleId,
    entityId,
    targetEntityId,
  };
}

describe("TraceForge closed entity lifecycle", () => {
  it("allows the current custodian to permanently close an entity with evidence", async () => {
    const {
      traceForge,
      publicClient,
      organizationAContract,
      organizationAWallet,
      tenantId,
      organizationAId,
      roleId,
      entityId,
      wait,
    } = await prepareLifecycleScenario();

    const eventType = id("ENTITY_CLOSED");
    const evidenceHash = id("CLOSE_EVIDENCE");

    const receipt = await wait(
      await organizationAContract.write.closeEntity([
        tenantId,
        roleId,
        entityId,
        eventType,
        evidenceHash,
      ]),
    );

    const entity =
      await traceForge.read.getEntity([
        tenantId,
        entityId,
      ]);

    assert.equal(entity.closed, true);

    const closeEvents =
      await publicClient.getContractEvents({
        address: traceForge.address,
        abi: traceForge.abi,
        eventName: "EntityClosed",
        fromBlock: receipt.blockNumber,
        toBlock: receipt.blockNumber,
      });

    assert.equal(closeEvents.length, 1);

    assert.equal(
      closeEvents[0].args.organizationId,
      organizationAId,
    );

    assert.equal(
      closeEvents[0].args.roleId,
      roleId,
    );

    assert.equal(
      closeEvents[0].args.evidenceHash,
      evidenceHash,
    );

    assert.equal(
      closeEvents[0].args.actor?.toLowerCase(),
      organizationAWallet.account.address.toLowerCase(),
    );

    const traceEvents =
      await publicClient.getContractEvents({
        address: traceForge.address,
        abi: traceForge.abi,
        eventName: "TraceRecorded",
        fromBlock: receipt.blockNumber,
        toBlock: receipt.blockNumber,
      });

    assert.equal(traceEvents.length, 1);

    assert.equal(
      traceEvents[0].args.eventType,
      eventType,
    );

    assert.equal(
      traceEvents[0].args.evidenceHash,
      evidenceHash,
    );
  });

  it("allows a current holder to close without an ENTITY_CLOSE role", async () => {
    const { adminContract, organizationAContract, traceForge, tenantId, roleId, entityId, wait } = await prepareLifecycleScenario();
    await wait(await adminContract.write.setRoleCapability([tenantId, roleId, CAPABILITY.ENTITY_CLOSE, false]));
    await wait(await organizationAContract.write.closeEntity([tenantId, zeroHash, entityId, id("DAMAGED"), id("EVIDENCE")]));
    assert.equal((await traceForge.read.getEntity([tenantId, entityId])).closed, true);
  });

  it("allows only the current custodian organization to close an entity", async () => {
    const {
      organizationBContract,
      tenantId,
      roleId,
      entityId,
    } = await prepareLifecycleScenario();

    await assert.rejects(async () => {
      await organizationBContract.write.closeEntity([
        tenantId,
        roleId,
        entityId,
        id("ENTITY_CLOSED"),
        id("CLOSE_EVIDENCE"),
      ]);
    });
  });

  it("requires non-zero event type and evidence when closing", async () => {
    const {
      organizationAContract,
      tenantId,
      roleId,
      entityId,
    } = await prepareLifecycleScenario();

    await assert.rejects(async () => {
      await organizationAContract.write.closeEntity([
        tenantId,
        roleId,
        entityId,
        zeroHash,
        id("CLOSE_EVIDENCE"),
      ]);
    });

    await assert.rejects(async () => {
      await organizationAContract.write.closeEntity([
        tenantId,
        roleId,
        entityId,
        id("ENTITY_CLOSED"),
        zeroHash,
      ]);
    });
  });

  it("rejects closing an already closed entity", async () => {
    const {
      organizationAContract,
      tenantId,
      roleId,
      entityId,
      wait,
    } = await prepareLifecycleScenario();

    await wait(
      await organizationAContract.write.closeEntity([
        tenantId,
        roleId,
        entityId,
        id("ENTITY_CLOSED"),
        id("FIRST_CLOSE_EVIDENCE"),
      ]),
    );

    await assert.rejects(async () => {
      await organizationAContract.write.closeEntity([
        tenantId,
        roleId,
        entityId,
        id("ENTITY_CLOSED_AGAIN"),
        id("SECOND_CLOSE_EVIDENCE"),
      ]);
    });
  });

  it("blocks ordinary entity mutations after closure", async () => {
    const {
      organizationAContract,
      tenantId,
      organizationBId,
      roleId,
      entityId,
      targetEntityId,
      wait,
    } = await prepareLifecycleScenario();

    const linkType = id("CONTAINS");

    await wait(
      await organizationAContract.write.createEntityLink([
        tenantId,
        roleId,
        entityId,
        targetEntityId,
        linkType,
        id("ENTITY_LINKED"),
        id("LINK_EVIDENCE"),
      ]),
    );

    await wait(
      await organizationAContract.write.closeEntity([
        tenantId,
        roleId,
        entityId,
        id("ENTITY_CLOSED"),
        id("CLOSE_EVIDENCE"),
      ]),
    );

    await assert.rejects(async () => {
      await organizationAContract.write.recordTrace([
        tenantId,
        roleId,
        entityId,
        id("INSPECTED"),
        id("TRACE_EVIDENCE"),
      ]);
    });

    await assert.rejects(async () => {
      await organizationAContract.write.updateEntityState([
        tenantId,
        roleId,
        entityId,
        id("STATE_CHANGED"),
        id("ARCHIVED"),
        id("STATE_EVIDENCE"),
      ]);
    });

    await assert.rejects(async () => {
      await organizationAContract.write.updateEntityMetadata([
        tenantId,
        roleId,
        entityId,
        id("METADATA_CHANGED"),
        id("NEW_METADATA"),
        id("METADATA_EVIDENCE"),
      ]);
    });

    await assert.rejects(async () => {
      await organizationAContract.write.claimCustody([
        tenantId,
        entityId,
        0n,
        id("CUSTODY_OFFERED"),
        id("CUSTODY_EVIDENCE"),
      ]);
    });

    await assert.rejects(async () => {
      await organizationAContract.write.setEntityLinkActive([
        tenantId,
        roleId,
        entityId,
        targetEntityId,
        linkType,
        false,
        id("ENTITY_LINK_DISABLED"),
        id("LINK_DISABLE_EVIDENCE"),
      ]);
    });
  });

  it("does not allow a closed entity to become the target of a new relationship", async () => {
    const {
      organizationAContract,
      tenantId,
      roleId,
      entityId,
      targetEntityId,
      wait,
    } = await prepareLifecycleScenario();

    await wait(
      await organizationAContract.write.closeEntity([
        tenantId,
        roleId,
        targetEntityId,
        id("ENTITY_CLOSED"),
        id("TARGET_CLOSE_EVIDENCE"),
      ]),
    );

    await assert.rejects(async () => {
      await organizationAContract.write.createEntityLink([
        tenantId,
        roleId,
        entityId,
        targetEntityId,
        id("CONTAINS"),
        id("ENTITY_LINKED"),
        id("LINK_EVIDENCE"),
      ]);
    });
  });
});
