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
    await publicClient.waitForTransactionReceipt({
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

async function prepareEntityActor() {
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
  const roleId = id("MANUFACTURER");

  await wait(
    await traceForge.write.createTenant([
      tenantId,
      id("TENANT_A_METADATA"),
      tenantAdmin.account.address,
    ]),
  );

  await wait(
    await traceForge.write.registerOrganization([
      organizationId,
      id("ORG_A_METADATA"),
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
      id("MANUFACTURER_METADATA"),
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

  return {
    ...context,
    adminContract,
    organizationContract,
    tenantId,
    organizationId,
    roleId,
  };
}

describe("TraceForge generic entity foundation", () => {
  it("allows an authorized organization wallet to create an entity", async () => {
    const {
      traceForge,
      organizationContract,
      organizationWallet,
      tenantId,
      organizationId,
      roleId,
      wait,
    } = await prepareEntityActor();

    const entityId = id("ITEM_001");
    const entityType = id("PRODUCT");
    const metadataHash = id("ITEM_001_METADATA");
    const initialState = id("MANUFACTURED");

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

    const entity =
      await traceForge.read.getEntity([
        tenantId,
        entityId,
      ]);

    assert.equal(entity.exists, true);
    assert.equal(entity.closed, false);

    assert.equal(
      entity.entityType,
      entityType,
    );

    assert.equal(
      entity.metadataHash,
      metadataHash,
    );

    assert.equal(
      entity.currentState,
      initialState,
    );

    assert.equal(
      entity.currentCustodian,
      organizationId,
    );

    assert.equal(
      entity.createdAt,
      entity.updatedAt,
    );

    assert.equal(
      await traceForge.read.entityExists([
        tenantId,
        entityId,
      ]),
      true,
    );

    assert.equal(
      organizationWallet.account.address.length,
      42,
    );
  });

  it("rejects entity creation without ENTITY_CREATE capability", async () => {
    const {
      traceForge,
      tenantAdmin,
      organizationWallet,
      wait,
      asWallet,
    } = await setup();

    const tenantId = id("TENANT_A");
    const organizationId = id("ORG_A");
    const roleId = id("OBSERVER");

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
        id("ROLE_METADATA"),
      ]),
    );

    await wait(
      await adminContract.write.setRoleCapability([
        tenantId,
        roleId,
        CAPABILITY.TRACE_RECORD,
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

    await assert.rejects(async () => {
      await organizationContract.write.createEntity([
        tenantId,
        roleId,
        id("ITEM_001"),
        id("PRODUCT"),
        id("ITEM_METADATA"),
        id("MANUFACTURED"),
      ]);
    });

    assert.equal(
      await traceForge.read.entityExists([
        tenantId,
        id("ITEM_001"),
      ]),
      false,
    );
  });

  it("rejects duplicate entity IDs inside the same tenant", async () => {
    const {
      organizationContract,
      tenantId,
      roleId,
      wait,
    } = await prepareEntityActor();

    const entityId = id("ITEM_001");

    await wait(
      await organizationContract.write.createEntity([
        tenantId,
        roleId,
        entityId,
        id("PRODUCT"),
        id("METADATA_V1"),
        id("MANUFACTURED"),
      ]),
    );

    await assert.rejects(async () => {
      await organizationContract.write.createEntity([
        tenantId,
        roleId,
        entityId,
        id("PRODUCT"),
        id("METADATA_V2"),
        id("PACKAGED"),
      ]);
    });
  });

  it("allows the same entity ID to exist independently in different tenants", async () => {
    const {
      traceForge,
      tenantAdmin,
      organizationWallet,
      wait,
      asWallet,
    } = await setup();

    const tenantA = id("TENANT_A");
    const tenantB = id("TENANT_B");
    const organizationId = id("ORG_A");
    const roleId = id("MANUFACTURER");
    const entityId = id("ITEM_001");

    await wait(
      await traceForge.write.createTenant([
        tenantA,
        id("TENANT_A_METADATA"),
        tenantAdmin.account.address,
      ]),
    );

    await wait(
      await traceForge.write.createTenant([
        tenantB,
        id("TENANT_B_METADATA"),
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

    for (const tenantId of [tenantA, tenantB]) {
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
          id("ROLE_METADATA"),
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
    }

    const organizationContract =
      await asWallet(organizationWallet);

    await wait(
      await organizationContract.write.createEntity([
        tenantA,
        roleId,
        entityId,
        id("PRODUCT"),
        id("TENANT_A_ITEM_METADATA"),
        id("MANUFACTURED"),
      ]),
    );

    await wait(
      await organizationContract.write.createEntity([
        tenantB,
        roleId,
        entityId,
        id("MEDICINE"),
        id("TENANT_B_ITEM_METADATA"),
        id("REGISTERED"),
      ]),
    );

    const entityA =
      await traceForge.read.getEntity([
        tenantA,
        entityId,
      ]);

    const entityB =
      await traceForge.read.getEntity([
        tenantB,
        entityId,
      ]);

    assert.equal(
      entityA.entityType,
      id("PRODUCT"),
    );

    assert.equal(
      entityB.entityType,
      id("MEDICINE"),
    );
  });

  it("derives initial custody from the caller organization", async () => {
    const {
      traceForge,
      organizationContract,
      tenantId,
      organizationId,
      roleId,
      wait,
    } = await prepareEntityActor();

    const entityId = id("ITEM_001");

    await wait(
      await organizationContract.write.createEntity([
        tenantId,
        roleId,
        entityId,
        id("PRODUCT"),
        id("ITEM_METADATA"),
        id("MANUFACTURED"),
      ]),
    );

    const entity =
      await traceForge.read.getEntity([
        tenantId,
        entityId,
      ]);

    assert.equal(
      entity.currentCustodian,
      organizationId,
    );
  });

  it("rejects entity creation from an inactive wallet", async () => {
    const {
      traceForge,
      organizationContract,
      organizationWallet,
      tenantId,
      roleId,
      wait,
    } = await prepareEntityActor();

    await wait(
      await traceForge.write.setWalletActive([
        organizationWallet.account.address,
        false,
      ]),
    );

    await assert.rejects(async () => {
      await organizationContract.write.createEntity([
        tenantId,
        roleId,
        id("ITEM_001"),
        id("PRODUCT"),
        id("ITEM_METADATA"),
        id("MANUFACTURED"),
      ]);
    });
  });

  it("rejects entity creation from an inactive organization", async () => {
    const {
      traceForge,
      organizationContract,
      tenantId,
      organizationId,
      roleId,
      wait,
    } = await prepareEntityActor();

    await wait(
      await traceForge.write.setOrganizationActive([
        organizationId,
        false,
      ]),
    );

    await assert.rejects(async () => {
      await organizationContract.write.createEntity([
        tenantId,
        roleId,
        id("ITEM_001"),
        id("PRODUCT"),
        id("ITEM_METADATA"),
        id("MANUFACTURED"),
      ]);
    });
  });

  it("rejects entity creation with an inactive tenant membership", async () => {
    const {
      adminContract,
      organizationContract,
      tenantId,
      organizationId,
      roleId,
      wait,
    } = await prepareEntityActor();

    await wait(
      await adminContract.write.setTenantMembershipActive([
        tenantId,
        organizationId,
        false,
      ]),
    );

    await assert.rejects(async () => {
      await organizationContract.write.createEntity([
        tenantId,
        roleId,
        id("ITEM_001"),
        id("PRODUCT"),
        id("ITEM_METADATA"),
        id("MANUFACTURED"),
      ]);
    });
  });

  it("rejects entity creation through an inactive role", async () => {
    const {
      adminContract,
      organizationContract,
      tenantId,
      roleId,
      wait,
    } = await prepareEntityActor();

    await wait(
      await adminContract.write.setRoleActive([
        tenantId,
        roleId,
        false,
      ]),
    );

    await assert.rejects(async () => {
      await organizationContract.write.createEntity([
        tenantId,
        roleId,
        id("ITEM_001"),
        id("PRODUCT"),
        id("ITEM_METADATA"),
        id("MANUFACTURED"),
      ]);
    });
  });

  it("rejects entity creation through a disabled role assignment", async () => {
    const {
      adminContract,
      organizationContract,
      tenantId,
      organizationId,
      roleId,
      wait,
    } = await prepareEntityActor();

    await wait(
      await adminContract.write.setOrganizationRoleActive([
        tenantId,
        organizationId,
        roleId,
        false,
      ]),
    );

    await assert.rejects(async () => {
      await organizationContract.write.createEntity([
        tenantId,
        roleId,
        id("ITEM_001"),
        id("PRODUCT"),
        id("ITEM_METADATA"),
        id("MANUFACTURED"),
      ]);
    });
  });

  it("rejects entity creation when ENTITY_CREATE capability is revoked", async () => {
    const {
      adminContract,
      organizationContract,
      tenantId,
      roleId,
      wait,
    } = await prepareEntityActor();

    await wait(
      await adminContract.write.setRoleCapability([
        tenantId,
        roleId,
        CAPABILITY.ENTITY_CREATE,
        false,
      ]),
    );

    await assert.rejects(async () => {
      await organizationContract.write.createEntity([
        tenantId,
        roleId,
        id("ITEM_001"),
        id("PRODUCT"),
        id("ITEM_METADATA"),
        id("MANUFACTURED"),
      ]);
    });
  });

  it("rejects entity creation in an inactive tenant", async () => {
    const {
      traceForge,
      organizationContract,
      tenantId,
      roleId,
      wait,
    } = await prepareEntityActor();

    await wait(
      await traceForge.write.setTenantActive([
        tenantId,
        false,
      ]),
    );

    await assert.rejects(async () => {
      await organizationContract.write.createEntity([
        tenantId,
        roleId,
        id("ITEM_001"),
        id("PRODUCT"),
        id("ITEM_METADATA"),
        id("MANUFACTURED"),
      ]);
    });
  });

  it("rejects zero entity identity fields", async () => {
    const {
      organizationContract,
      tenantId,
      roleId,
    } = await prepareEntityActor();

    await assert.rejects(async () => {
      await organizationContract.write.createEntity([
        tenantId,
        roleId,
        zeroHash,
        id("PRODUCT"),
        id("ITEM_METADATA"),
        id("MANUFACTURED"),
      ]);
    });

    await assert.rejects(async () => {
      await organizationContract.write.createEntity([
        tenantId,
        roleId,
        id("ITEM_001"),
        zeroHash,
        id("ITEM_METADATA"),
        id("MANUFACTURED"),
      ]);
    });

    await assert.rejects(async () => {
      await organizationContract.write.createEntity([
        tenantId,
        roleId,
        id("ITEM_002"),
        id("PRODUCT"),
        zeroHash,
        id("MANUFACTURED"),
      ]);
    });

    await assert.rejects(async () => {
      await organizationContract.write.createEntity([
        tenantId,
        roleId,
        id("ITEM_003"),
        id("PRODUCT"),
        id("ITEM_METADATA"),
        zeroHash,
      ]);
    });
  });
});
