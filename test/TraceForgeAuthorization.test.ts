import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { network } from "hardhat";
import { keccak256, stringToHex } from "viem";

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

async function prepareTenantOrganization() {
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

  return {
    ...context,
    adminContract,
    tenantId,
    organizationId,
  };
}

describe("TraceForge authorization foundation", () => {
  it("allows a tenant admin to create a dynamic role", async () => {
    const {
      adminContract,
      traceForge,
      tenantId,
      wait,
    } = await prepareTenantOrganization();

    const roleId = id("LOGISTICS");
    const metadataHash =
      id("LOGISTICS_METADATA");

    await wait(
      await adminContract.write.createRole([
        tenantId,
        roleId,
        metadataHash,
      ]),
    );

    const role =
      await traceForge.read.getRole([
        tenantId,
        roleId,
      ]);

    assert.equal(role.exists, true);
    assert.equal(role.active, true);
    assert.equal(
      role.metadataHash,
      metadataHash,
    );
    assert.equal(role.capabilityMask, 0n);
  });

  it("rejects role creation by a non-tenant-admin", async () => {
    const {
      traceForge,
      outsider,
      tenantId,
      asWallet,
    } = await prepareTenantOrganization();

    const outsiderContract =
      await asWallet(outsider);

    await assert.rejects(async () => {
      await outsiderContract.write.createRole([
        tenantId,
        id("LOGISTICS"),
        id("ROLE_METADATA"),
      ]);
    });

    await assert.rejects(async () => {
      await traceForge.read.getRole([
        tenantId,
        id("LOGISTICS"),
      ]);
    });
  });

  it("rejects duplicate role IDs inside the same tenant", async () => {
    const {
      adminContract,
      tenantId,
      wait,
    } = await prepareTenantOrganization();

    const roleId = id("LOGISTICS");

    await wait(
      await adminContract.write.createRole([
        tenantId,
        roleId,
        id("ROLE_METADATA_V1"),
      ]),
    );

    await assert.rejects(async () => {
      await adminContract.write.createRole([
        tenantId,
        roleId,
        id("ROLE_METADATA_V2"),
      ]);
    });
  });

  it("allows the same role ID to exist independently in different tenants", async () => {
    const {
      traceForge,
      tenantAdmin,
      wait,
      asWallet,
    } = await setup();

    const tenantA = id("TENANT_A");
    const tenantB = id("TENANT_B");
    const roleId = id("ROLE_01");

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

    const adminContract =
      await asWallet(tenantAdmin);

    await wait(
      await adminContract.write.createRole([
        tenantA,
        roleId,
        id("ROLE_A_METADATA"),
      ]),
    );

    await wait(
      await adminContract.write.createRole([
        tenantB,
        roleId,
        id("ROLE_B_METADATA"),
      ]),
    );

    const roleA =
      await traceForge.read.getRole([
        tenantA,
        roleId,
      ]);

    const roleB =
      await traceForge.read.getRole([
        tenantB,
        roleId,
      ]);

    assert.equal(
      roleA.metadataHash,
      id("ROLE_A_METADATA"),
    );

    assert.equal(
      roleB.metadataHash,
      id("ROLE_B_METADATA"),
    );
  });

  it("grants and revokes a capability dynamically", async () => {
    const {
      adminContract,
      traceForge,
      tenantId,
      wait,
    } = await prepareTenantOrganization();

    const roleId = id("LOGISTICS");

    await wait(
      await adminContract.write.createRole([
        tenantId,
        roleId,
        id("ROLE_METADATA"),
      ]),
    );

    assert.equal(
      await traceForge.read.roleHasCapability([
        tenantId,
        roleId,
        CAPABILITY.CUSTODY_TRANSFER,
      ]),
      false,
    );

    await wait(
      await adminContract.write.setRoleCapability([
        tenantId,
        roleId,
        CAPABILITY.CUSTODY_TRANSFER,
        true,
      ]),
    );

    assert.equal(
      await traceForge.read.roleHasCapability([
        tenantId,
        roleId,
        CAPABILITY.CUSTODY_TRANSFER,
      ]),
      true,
    );

    await wait(
      await adminContract.write.setRoleCapability([
        tenantId,
        roleId,
        CAPABILITY.CUSTODY_TRANSFER,
        false,
      ]),
    );

    assert.equal(
      await traceForge.read.roleHasCapability([
        tenantId,
        roleId,
        CAPABILITY.CUSTODY_TRANSFER,
      ]),
      false,
    );
  });

  it("requires active tenant membership before assigning a role", async () => {
    const {
      traceForge,
      tenantAdmin,
      wait,
      asWallet,
    } = await setup();

    const tenantId = id("TENANT_A");
    const organizationId = id("ORG_A");
    const roleId = id("LOGISTICS");

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

    const adminContract =
      await asWallet(tenantAdmin);

    await wait(
      await adminContract.write.createRole([
        tenantId,
        roleId,
        id("ROLE_METADATA"),
      ]),
    );

    await assert.rejects(async () => {
      await adminContract.write.assignRoleToOrganization([
        tenantId,
        organizationId,
        roleId,
      ]);
    });
  });

  it("allows an organization to hold multiple roles", async () => {
    const {
      adminContract,
      traceForge,
      tenantId,
      organizationId,
      wait,
    } = await prepareTenantOrganization();

    const logisticsRole = id("LOGISTICS");
    const warehouseRole = id("WAREHOUSE");

    await wait(
      await adminContract.write.createRole([
        tenantId,
        logisticsRole,
        id("LOGISTICS_METADATA"),
      ]),
    );

    await wait(
      await adminContract.write.createRole([
        tenantId,
        warehouseRole,
        id("WAREHOUSE_METADATA"),
      ]),
    );

    await wait(
      await adminContract.write.assignRoleToOrganization([
        tenantId,
        organizationId,
        logisticsRole,
      ]),
    );

    await wait(
      await adminContract.write.assignRoleToOrganization([
        tenantId,
        organizationId,
        warehouseRole,
      ]),
    );

    const logisticsAssignment =
      await traceForge.read.getOrganizationRoleAssignment([
        tenantId,
        organizationId,
        logisticsRole,
      ]);

    const warehouseAssignment =
      await traceForge.read.getOrganizationRoleAssignment([
        tenantId,
        organizationId,
        warehouseRole,
      ]);

    assert.equal(
      logisticsAssignment.active,
      true,
    );

    assert.equal(
      warehouseAssignment.active,
      true,
    );
  });

  it("grants capability only after the role is assigned to the organization", async () => {
    const {
      adminContract,
      traceForge,
      organizationWallet,
      tenantId,
      organizationId,
      wait,
    } = await prepareTenantOrganization();

    const roleId = id("LOGISTICS");

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
        CAPABILITY.CUSTODY_TRANSFER,
        true,
      ]),
    );

    assert.equal(
      await traceForge.read.hasCapability([
        tenantId,
        organizationWallet.account.address,
        roleId,
        CAPABILITY.CUSTODY_TRANSFER,
      ]),
      false,
    );

    await wait(
      await adminContract.write.assignRoleToOrganization([
        tenantId,
        organizationId,
        roleId,
      ]),
    );

    assert.equal(
      await traceForge.read.hasCapability([
        tenantId,
        organizationWallet.account.address,
        roleId,
        CAPABILITY.CUSTODY_TRANSFER,
      ]),
      true,
    );
  });

  it("an inactive role grants no capability", async () => {
    const {
      adminContract,
      traceForge,
      organizationWallet,
      tenantId,
      organizationId,
      wait,
    } = await prepareTenantOrganization();

    const roleId = id("LOGISTICS");

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

    assert.equal(
      await traceForge.read.hasCapability([
        tenantId,
        organizationWallet.account.address,
        roleId,
        CAPABILITY.TRACE_RECORD,
      ]),
      true,
    );

    await wait(
      await adminContract.write.setRoleActive([
        tenantId,
        roleId,
        false,
      ]),
    );

    assert.equal(
      await traceForge.read.hasCapability([
        tenantId,
        organizationWallet.account.address,
        roleId,
        CAPABILITY.TRACE_RECORD,
      ]),
      false,
    );
  });

  it("a disabled organization-role assignment grants no capability", async () => {
    const {
      adminContract,
      traceForge,
      organizationWallet,
      tenantId,
      organizationId,
      wait,
    } = await prepareTenantOrganization();

    const roleId = id("LOGISTICS");

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

    await wait(
      await adminContract.write.setOrganizationRoleActive([
        tenantId,
        organizationId,
        roleId,
        false,
      ]),
    );

    assert.equal(
      await traceForge.read.hasCapability([
        tenantId,
        organizationWallet.account.address,
        roleId,
        CAPABILITY.TRACE_RECORD,
      ]),
      false,
    );
  });

  it("an inactive wallet grants no capability", async () => {
    const {
      adminContract,
      traceForge,
      organizationWallet,
      tenantId,
      organizationId,
      wait,
    } = await prepareTenantOrganization();

    const roleId = id("LOGISTICS");

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

    await wait(
      await traceForge.write.setWalletActive([
        organizationWallet.account.address,
        false,
      ]),
    );

    assert.equal(
      await traceForge.read.hasCapability([
        tenantId,
        organizationWallet.account.address,
        roleId,
        CAPABILITY.TRACE_RECORD,
      ]),
      false,
    );
  });

  it("an inactive organization grants no capability", async () => {
    const {
      adminContract,
      traceForge,
      organizationWallet,
      tenantId,
      organizationId,
      wait,
    } = await prepareTenantOrganization();

    const roleId = id("LOGISTICS");

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

    await wait(
      await traceForge.write.setOrganizationActive([
        organizationId,
        false,
      ]),
    );

    assert.equal(
      await traceForge.read.hasCapability([
        tenantId,
        organizationWallet.account.address,
        roleId,
        CAPABILITY.TRACE_RECORD,
      ]),
      false,
    );
  });

  it("an inactive tenant membership grants no capability", async () => {
    const {
      adminContract,
      traceForge,
      organizationWallet,
      tenantId,
      organizationId,
      wait,
    } = await prepareTenantOrganization();

    const roleId = id("LOGISTICS");

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

    await wait(
      await adminContract.write.setTenantMembershipActive([
        tenantId,
        organizationId,
        false,
      ]),
    );

    assert.equal(
      await traceForge.read.hasCapability([
        tenantId,
        organizationWallet.account.address,
        roleId,
        CAPABILITY.TRACE_RECORD,
      ]),
      false,
    );
  });

  it("an inactive tenant grants no capability", async () => {
    const {
      adminContract,
      traceForge,
      organizationWallet,
      tenantId,
      organizationId,
      wait,
    } = await prepareTenantOrganization();

    const roleId = id("LOGISTICS");

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

    await wait(
      await traceForge.write.setTenantActive([
        tenantId,
        false,
      ]),
    );

    assert.equal(
      await traceForge.read.hasCapability([
        tenantId,
        organizationWallet.account.address,
        roleId,
        CAPABILITY.TRACE_RECORD,
      ]),
      false,
    );
  });
});
