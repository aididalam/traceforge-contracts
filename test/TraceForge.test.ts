import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { network } from "hardhat";
import { keccak256, stringToHex } from "viem";

function id(value: string) {
  return keccak256(stringToHex(value));
}

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

  return {
    viem,
    owner,
    tenantAdmin,
    outsider,
    organizationWallet,
    publicClient,
    traceForge,
    wait,
  };
}

describe("TraceForge identity foundation", () => {
  it("allows the platform owner to create a tenant", async () => {
    const {
      traceForge,
      tenantAdmin,
      wait,
    } = await setup();

    const tenantId = id("TENANT_A");
    const metadataHash = id("TENANT_A_METADATA");

    await wait(
      await traceForge.write.createTenant([
        tenantId,
        metadataHash,
        tenantAdmin.account.address,
      ]),
    );

    const tenant =
      await traceForge.read.getTenant([
        tenantId,
      ]);

    assert.equal(tenant.exists, true);
    assert.equal(tenant.active, true);
    assert.equal(
      tenant.metadataHash,
      metadataHash,
    );

    assert.equal(
      await traceForge.read.isTenantAdmin([
        tenantId,
        tenantAdmin.account.address,
      ]),
      true,
    );
  });

  it("rejects tenant creation by a non-owner", async () => {
    const {
      viem,
      traceForge,
      outsider,
      tenantAdmin,
    } = await setup();

    const outsiderContract =
      await viem.getContractAt(
        "TraceForge",
        traceForge.address,
        {
          client: {
            wallet: outsider,
          },
        },
      );

    await assert.rejects(async () => {
      await outsiderContract.write.createTenant([
        id("TENANT_A"),
        id("TENANT_A_METADATA"),
        tenantAdmin.account.address,
      ]);
    });
  });

  it("rejects a duplicate tenant ID", async () => {
    const {
      traceForge,
      tenantAdmin,
      wait,
    } = await setup();

    const tenantId = id("TENANT_A");

    await wait(
      await traceForge.write.createTenant([
        tenantId,
        id("METADATA_V1"),
        tenantAdmin.account.address,
      ]),
    );

    await assert.rejects(async () => {
      await traceForge.write.createTenant([
        tenantId,
        id("METADATA_V2"),
        tenantAdmin.account.address,
      ]);
    });
  });

  it("registers an organization and binds a wallet", async () => {
    const {
      traceForge,
      organizationWallet,
      wait,
    } = await setup();

    const organizationId = id("ORG_C");

    await wait(
      await traceForge.write.registerOrganization([
        organizationId,
        id("ORG_C_METADATA"),
      ]),
    );

    await wait(
      await traceForge.write.bindWallet([
        organizationId,
        organizationWallet.account.address,
      ]),
    );

    const organization =
      await traceForge.read.getOrganization([
        organizationId,
      ]);

    assert.equal(organization.exists, true);
    assert.equal(organization.active, true);

    const binding =
      await traceForge.read.getWalletBinding([
        organizationWallet.account.address,
      ]);

    assert.equal(
      binding.organizationId,
      organizationId,
    );

    assert.equal(binding.active, true);
  });

  it("does not allow a wallet to be rebound to another organization", async () => {
    const {
      traceForge,
      organizationWallet,
      wait,
    } = await setup();

    const organizationA = id("ORG_A");
    const organizationB = id("ORG_B");

    await wait(
      await traceForge.write.registerOrganization([
        organizationA,
        id("ORG_A_METADATA"),
      ]),
    );

    await wait(
      await traceForge.write.registerOrganization([
        organizationB,
        id("ORG_B_METADATA"),
      ]),
    );

    await wait(
      await traceForge.write.bindWallet([
        organizationA,
        organizationWallet.account.address,
      ]),
    );

    await assert.rejects(async () => {
      await traceForge.write.bindWallet([
        organizationB,
        organizationWallet.account.address,
      ]);
    });

    const binding =
      await traceForge.read.getWalletBinding([
        organizationWallet.account.address,
      ]);

    assert.equal(
      binding.organizationId,
      organizationA,
    );
  });

  it("allows a tenant admin to add an organization to the tenant", async () => {
    const {
      viem,
      traceForge,
      tenantAdmin,
      wait,
    } = await setup();

    const tenantId = id("TENANT_A");
    const organizationId = id("ORG_C");

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
      await viem.getContractAt(
        "TraceForge",
        traceForge.address,
        {
          client: {
            wallet: tenantAdmin,
          },
        },
      );

    await wait(
      await adminContract.write.addOrganizationToTenant([
        tenantId,
        organizationId,
      ]),
    );

    assert.equal(
      await traceForge.read.isActiveTenantMember([
        tenantId,
        organizationId,
      ]),
      true,
    );
  });

  it("rejects tenant membership changes by a non-admin", async () => {
    const {
      viem,
      traceForge,
      tenantAdmin,
      outsider,
      wait,
    } = await setup();

    const tenantId = id("TENANT_A");
    const organizationId = id("ORG_C");

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

    const outsiderContract =
      await viem.getContractAt(
        "TraceForge",
        traceForge.address,
        {
          client: {
            wallet: outsider,
          },
        },
      );

    await assert.rejects(async () => {
      await outsiderContract.write.addOrganizationToTenant([
        tenantId,
        organizationId,
      ]);
    });
  });

  it("allows the same organization to join multiple tenants", async () => {
    const {
      viem,
      traceForge,
      tenantAdmin,
      wait,
    } = await setup();

    const tenantA = id("TENANT_A");
    const tenantB = id("TENANT_B");
    const organizationId = id("ORG_C");

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
        id("ORG_C_METADATA"),
      ]),
    );

    const adminContract =
      await viem.getContractAt(
        "TraceForge",
        traceForge.address,
        {
          client: {
            wallet: tenantAdmin,
          },
        },
      );

    await wait(
      await adminContract.write.addOrganizationToTenant([
        tenantA,
        organizationId,
      ]),
    );

    await wait(
      await adminContract.write.addOrganizationToTenant([
        tenantB,
        organizationId,
      ]),
    );

    assert.equal(
      await traceForge.read.isActiveTenantMember([
        tenantA,
        organizationId,
      ]),
      true,
    );

    assert.equal(
      await traceForge.read.isActiveTenantMember([
        tenantB,
        organizationId,
      ]),
      true,
    );
  });

  it("blocks a new membership when the organization is inactive", async () => {
    const {
      viem,
      traceForge,
      tenantAdmin,
      wait,
    } = await setup();

    const tenantId = id("TENANT_A");
    const organizationId = id("ORG_C");

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
      await traceForge.write.setOrganizationActive([
        organizationId,
        false,
      ]),
    );

    const adminContract =
      await viem.getContractAt(
        "TraceForge",
        traceForge.address,
        {
          client: {
            wallet: tenantAdmin,
          },
        },
      );

    await assert.rejects(async () => {
      await adminContract.write.addOrganizationToTenant([
        tenantId,
        organizationId,
      ]);
    });
  });

  it("blocks a new membership when the tenant is inactive", async () => {
    const {
      viem,
      traceForge,
      tenantAdmin,
      wait,
    } = await setup();

    const tenantId = id("TENANT_A");
    const organizationId = id("ORG_C");

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
      await traceForge.write.setTenantActive([
        tenantId,
        false,
      ]),
    );

    const adminContract =
      await viem.getContractAt(
        "TraceForge",
        traceForge.address,
        {
          client: {
            wallet: tenantAdmin,
          },
        },
      );

    await assert.rejects(async () => {
      await adminContract.write.addOrganizationToTenant([
        tenantId,
        organizationId,
      ]);
    });
  });

  it("preserves wallet identity when the wallet is deactivated and reactivated", async () => {
    const {
      traceForge,
      organizationWallet,
      wait,
    } = await setup();

    const organizationId = id("ORG_C");
    const wallet =
      organizationWallet.account.address;

    await wait(
      await traceForge.write.registerOrganization([
        organizationId,
        id("ORG_METADATA"),
      ]),
    );

    await wait(
      await traceForge.write.bindWallet([
        organizationId,
        wallet,
      ]),
    );

    await wait(
      await traceForge.write.setWalletActive([
        wallet,
        false,
      ]),
    );

    const inactiveBinding =
      await traceForge.read.getWalletBinding([
        wallet,
      ]);

    assert.equal(
      inactiveBinding.organizationId,
      organizationId,
    );

    assert.equal(
      inactiveBinding.active,
      false,
    );

    assert.equal(
      await traceForge.read.isActiveWalletForOrganization([
        wallet,
        organizationId,
      ]),
      false,
    );

    await wait(
      await traceForge.write.setWalletActive([
        wallet,
        true,
      ]),
    );

    const activeBinding =
      await traceForge.read.getWalletBinding([
        wallet,
      ]);

    assert.equal(
      activeBinding.organizationId,
      organizationId,
    );

    assert.equal(
      activeBinding.active,
      true,
    );

    assert.equal(
      await traceForge.read.isActiveWalletForOrganization([
        wallet,
        organizationId,
      ]),
      true,
    );
  });
});
