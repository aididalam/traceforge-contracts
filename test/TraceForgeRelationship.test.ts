import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { network } from "hardhat";
import {
  keccak256,
  stringToHex,
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

async function prepareRelationshipScenario() {
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
  const roleId = id("LINK_OPERATOR");

  const sourceEntityId = id("BATCH_001");
  const targetEntityId = id("ITEM_001");

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
      id("LINK_ROLE_METADATA"),
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
    await adminContract.write.setRoleCapability([
      tenantId,
      roleId,
      CAPABILITY.ENTITY_LINK,
      true,
    ]),
  );

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
      sourceEntityId,
      id("BATCH"),
      id("BATCH_METADATA"),
      id("CREATED"),
    ]),
  );

  await wait(
    await organizationAContract.write.createEntity([
      tenantId,
      roleId,
      targetEntityId,
      id("PRODUCT"),
      id("ITEM_METADATA"),
      id("CREATED"),
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
    sourceEntityId,
    targetEntityId,
  };
}

describe("TraceForge entity relationships", () => {
  it("allows the source custodian to create a typed entity link", async () => {
    const {
      traceForge,
      organizationAContract,
      tenantId,
      sourceEntityId,
      targetEntityId,
      roleId,
      wait,
    } = await prepareRelationshipScenario();

    const linkType = id("CONTAINS");

    await wait(
      await organizationAContract.write.createEntityLink([
        tenantId,
        roleId,
        sourceEntityId,
        targetEntityId,
        linkType,
        id("ENTITY_LINKED"),
        id("LINK_EVIDENCE"),
      ]),
    );

    const link =
      await traceForge.read.getEntityLink([
        tenantId,
        sourceEntityId,
        targetEntityId,
        linkType,
      ]);

    assert.equal(link.exists, true);
    assert.equal(link.active, true);
    assert.equal(
      link.sourceEntityId,
      sourceEntityId,
    );
    assert.equal(
      link.targetEntityId,
      targetEntityId,
    );
    assert.equal(link.linkType, linkType);
    assert.equal(
      link.createdAt,
      link.updatedAt,
    );
  });

  it("supports different dynamic link types for the same entity pair", async () => {
    const {
      traceForge,
      organizationAContract,
      tenantId,
      sourceEntityId,
      targetEntityId,
      roleId,
      wait,
    } = await prepareRelationshipScenario();

    for (const linkType of [
      id("CONTAINS"),
      id("REFERENCES"),
    ]) {
      await wait(
        await organizationAContract.write.createEntityLink([
          tenantId,
          roleId,
          sourceEntityId,
          targetEntityId,
          linkType,
          id("ENTITY_LINKED"),
          id("LINK_EVIDENCE"),
        ]),
      );
    }

    assert.equal(
      await traceForge.read.entityLinkExists([
        tenantId,
        sourceEntityId,
        targetEntityId,
        id("CONTAINS"),
      ]),
      true,
    );

    assert.equal(
      await traceForge.read.entityLinkExists([
        tenantId,
        sourceEntityId,
        targetEntityId,
        id("REFERENCES"),
      ]),
      true,
    );
  });

  it("rejects recreation of the same relationship identity", async () => {
    const {
      organizationAContract,
      tenantId,
      sourceEntityId,
      targetEntityId,
      roleId,
      wait,
    } = await prepareRelationshipScenario();

    const args = [
      tenantId,
      roleId,
      sourceEntityId,
      targetEntityId,
      id("CONTAINS"),
      id("ENTITY_LINKED"),
      id("LINK_EVIDENCE"),
    ] as const;

    await wait(
      await organizationAContract.write.createEntityLink(args),
    );

    await assert.rejects(async () => {
      await organizationAContract.write.createEntityLink(args);
    });
  });

  it("rejects self-referential links", async () => {
    const {
      organizationAContract,
      tenantId,
      sourceEntityId,
      roleId,
    } = await prepareRelationshipScenario();

    await assert.rejects(async () => {
      await organizationAContract.write.createEntityLink([
        tenantId,
        roleId,
        sourceEntityId,
        sourceEntityId,
        id("CONTAINS"),
        id("ENTITY_LINKED"),
        id("LINK_EVIDENCE"),
      ]);
    });
  });

  it("rejects links to a missing target entity", async () => {
    const {
      organizationAContract,
      tenantId,
      sourceEntityId,
      roleId,
    } = await prepareRelationshipScenario();

    await assert.rejects(async () => {
      await organizationAContract.write.createEntityLink([
        tenantId,
        roleId,
        sourceEntityId,
        id("DOES_NOT_EXIST"),
        id("CONTAINS"),
        id("ENTITY_LINKED"),
        id("LINK_EVIDENCE"),
      ]);
    });
  });

  it("requires ENTITY_LINK capability", async () => {
    const {
      adminContract,
      organizationAContract,
      tenantId,
      sourceEntityId,
      targetEntityId,
      roleId,
      wait,
    } = await prepareRelationshipScenario();

    await wait(
      await adminContract.write.setRoleCapability([
        tenantId,
        roleId,
        CAPABILITY.ENTITY_LINK,
        false,
      ]),
    );

    await assert.rejects(async () => {
      await organizationAContract.write.createEntityLink([
        tenantId,
        roleId,
        sourceEntityId,
        targetEntityId,
        id("CONTAINS"),
        id("ENTITY_LINKED"),
        id("LINK_EVIDENCE"),
      ]);
    });
  });

  it("rejects relationship creation by a non-custodian organization", async () => {
    const {
      organizationBContract,
      tenantId,
      sourceEntityId,
      targetEntityId,
      roleId,
    } = await prepareRelationshipScenario();

    await assert.rejects(async () => {
      await organizationBContract.write.createEntityLink([
        tenantId,
        roleId,
        sourceEntityId,
        targetEntityId,
        id("CONTAINS"),
        id("ENTITY_LINKED"),
        id("LINK_EVIDENCE"),
      ]);
    });
  });

  it("deactivates and reactivates a relationship without changing identity", async () => {
    const {
      traceForge,
      organizationAContract,
      tenantId,
      sourceEntityId,
      targetEntityId,
      roleId,
      wait,
    } = await prepareRelationshipScenario();

    const linkType = id("CONTAINS");

    await wait(
      await organizationAContract.write.createEntityLink([
        tenantId,
        roleId,
        sourceEntityId,
        targetEntityId,
        linkType,
        id("ENTITY_LINKED"),
        id("CREATE_EVIDENCE"),
      ]),
    );

    const original =
      await traceForge.read.getEntityLink([
        tenantId,
        sourceEntityId,
        targetEntityId,
        linkType,
      ]);

    await wait(
      await organizationAContract.write.setEntityLinkActive([
        tenantId,
        roleId,
        sourceEntityId,
        targetEntityId,
        linkType,
        false,
        id("ENTITY_LINK_DISABLED"),
        id("DISABLE_EVIDENCE"),
      ]),
    );

    let updated =
      await traceForge.read.getEntityLink([
        tenantId,
        sourceEntityId,
        targetEntityId,
        linkType,
      ]);

    assert.equal(updated.active, false);
    assert.equal(
      updated.createdAt,
      original.createdAt,
    );

    await wait(
      await organizationAContract.write.setEntityLinkActive([
        tenantId,
        roleId,
        sourceEntityId,
        targetEntityId,
        linkType,
        true,
        id("ENTITY_LINK_ENABLED"),
        id("ENABLE_EVIDENCE"),
      ]),
    );

    updated =
      await traceForge.read.getEntityLink([
        tenantId,
        sourceEntityId,
        targetEntityId,
        linkType,
      ]);

    assert.equal(updated.active, true);
    assert.equal(
      updated.createdAt,
      original.createdAt,
    );

    assert.ok(
      updated.updatedAt >= original.createdAt,
    );
  });

  it("does not allow an inactive relationship to be recreated", async () => {
    const {
      organizationAContract,
      tenantId,
      sourceEntityId,
      targetEntityId,
      roleId,
      wait,
    } = await prepareRelationshipScenario();

    const linkType = id("CONTAINS");

    await wait(
      await organizationAContract.write.createEntityLink([
        tenantId,
        roleId,
        sourceEntityId,
        targetEntityId,
        linkType,
        id("ENTITY_LINKED"),
        id("CREATE_EVIDENCE"),
      ]),
    );

    await wait(
      await organizationAContract.write.setEntityLinkActive([
        tenantId,
        roleId,
        sourceEntityId,
        targetEntityId,
        linkType,
        false,
        id("ENTITY_LINK_DISABLED"),
        id("DISABLE_EVIDENCE"),
      ]),
    );

    await assert.rejects(async () => {
      await organizationAContract.write.createEntityLink([
        tenantId,
        roleId,
        sourceEntityId,
        targetEntityId,
        linkType,
        id("ENTITY_LINKED_AGAIN"),
        id("RECREATE_EVIDENCE"),
      ]);
    });
  });

  it("uses tenant-scoped deterministic relationship IDs", async () => {
    const {
      traceForge,
      tenantId,
      sourceEntityId,
      targetEntityId,
    } = await prepareRelationshipScenario();

    const linkType = id("CONTAINS");

    const linkIdA =
      await traceForge.read.computeEntityLinkId([
        tenantId,
        sourceEntityId,
        targetEntityId,
        linkType,
      ]);

    const linkIdB =
      await traceForge.read.computeEntityLinkId([
        id("TENANT_B"),
        sourceEntityId,
        targetEntityId,
        linkType,
      ]);

    assert.notEqual(
      linkIdA,
      linkIdB,
    );
  });

  it("emits immutable relationship evidence", async () => {
    const {
      traceForge,
      publicClient,
      organizationAContract,
      organizationAWallet,
      tenantId,
      organizationAId,
      sourceEntityId,
      targetEntityId,
      roleId,
      wait,
    } = await prepareRelationshipScenario();

    const linkType = id("CONTAINS");
    const eventType = id("ENTITY_LINKED");
    const evidenceHash = id("LINK_EVIDENCE");

    const receipt = await wait(
      await organizationAContract.write.createEntityLink([
        tenantId,
        roleId,
        sourceEntityId,
        targetEntityId,
        linkType,
        eventType,
        evidenceHash,
      ]),
    );

    const events =
      await publicClient.getContractEvents({
        address: traceForge.address,
        abi: traceForge.abi,
        eventName: "EntityLinkCreated",
        fromBlock: receipt.blockNumber,
        toBlock: receipt.blockNumber,
      });

    assert.equal(events.length, 1);

    assert.equal(
      events[0].args.sourceEntityId,
      sourceEntityId,
    );

    assert.equal(
      events[0].args.targetEntityId,
      targetEntityId,
    );

    assert.equal(
      events[0].args.linkType,
      linkType,
    );

    assert.equal(
      events[0].args.organizationId,
      organizationAId,
    );

    assert.equal(
      events[0].args.evidenceHash,
      evidenceHash,
    );

    assert.equal(
      events[0].args.actor?.toLowerCase(),
      organizationAWallet.account.address.toLowerCase(),
    );
  });

  it("transfers relationship control with custody of the source entity", async () => {
    const {
      traceForge,
      adminContract,
      organizationAContract,
      organizationBContract,
      tenantId,
      organizationBId,
      roleId,
      sourceEntityId,
      targetEntityId,
      wait,
    } = await prepareRelationshipScenario();

    const linkType = id("CONTAINS");

    await wait(
      await organizationAContract.write.createEntityLink([
        tenantId,
        roleId,
        sourceEntityId,
        targetEntityId,
        linkType,
        id("ENTITY_LINKED"),
        id("LINK_EVIDENCE"),
      ]),
    );

    await wait(await organizationBContract.write.claimCustody([
      tenantId, sourceEntityId, 0n, id("RECEIVED"), id("RECEIPT_EVIDENCE")
    ]));

    const entity =
      await traceForge.read.getEntity([
        tenantId,
        sourceEntityId,
      ]);

    assert.equal(
      entity.currentCustodian,
      organizationBId,
    );

    await assert.rejects(async () => {
      await organizationAContract.write.setEntityLinkActive([
        tenantId,
        roleId,
        sourceEntityId,
        targetEntityId,
        linkType,
        false,
        id("ENTITY_LINK_DISABLED"),
        id("OLD_CUSTODIAN_EVIDENCE"),
      ]);
    });

    await wait(
      await organizationBContract.write.setEntityLinkActive([
        tenantId,
        roleId,
        sourceEntityId,
        targetEntityId,
        linkType,
        false,
        id("ENTITY_LINK_DISABLED"),
        id("NEW_CUSTODIAN_EVIDENCE"),
      ]),
    );

    const link =
      await traceForge.read.getEntityLink([
        tenantId,
        sourceEntityId,
        targetEntityId,
        linkType,
      ]);

    assert.equal(link.active, false);
  });

});
