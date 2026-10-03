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
    outsider,
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
    owner,
    tenantAdmin,
    organizationAWallet,
    organizationBWallet,
    outsider,
    publicClient,
    traceForge,
    wait,
    asWallet,
  };
}

async function prepareCustodyScenario() {
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

  const organizationAId =
    id("ORG_A");

  const organizationBId =
    id("ORG_B");

  const roleId =
    id("CUSTODY_OPERATOR");

  const entityId =
    id("ITEM_001");

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
      id("CUSTODY_ROLE_METADATA"),
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
      CAPABILITY.CUSTODY_TRANSFER,
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
      entityId,
      id("PRODUCT"),
      id("ITEM_METADATA"),
      id("MANUFACTURED"),
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
  };
}

describe("TraceForge two-step custody transfer", () => {
  it("creates a pending transfer without changing current custody", async () => {
    const {
      traceForge,
      organizationAContract,
      tenantId,
      organizationAId,
      organizationBId,
      roleId,
      entityId,
      wait,
    } = await prepareCustodyScenario();

    await wait(
      await organizationAContract.write.proposeCustodyTransfer([
        tenantId,
        roleId,
        entityId,
        organizationBId,
        id("CUSTODY_OFFERED"),
        id("TRANSFER_OFFER_EVIDENCE"),
      ]),
    );

    const entity =
      await traceForge.read.getEntity([
        tenantId,
        entityId,
      ]);

    assert.equal(
      entity.currentCustodian,
      organizationAId,
    );

    const transfer =
      await traceForge.read.getPendingCustodyTransfer([
        tenantId,
        entityId,
      ]);

    assert.equal(
      transfer.exists,
      true,
    );

    assert.equal(
      transfer.fromOrganizationId,
      organizationAId,
    );

    assert.equal(
      transfer.toOrganizationId,
      organizationBId,
    );

    assert.equal(
      await traceForge.read.hasPendingCustodyTransfer([
        tenantId,
        entityId,
      ]),
      true,
    );
  });

  it("changes custody only after the target organization accepts", async () => {
    const {
      traceForge,
      organizationAContract,
      organizationBContract,
      tenantId,
      organizationBId,
      roleId,
      entityId,
      wait,
    } = await prepareCustodyScenario();

    await wait(
      await organizationAContract.write.proposeCustodyTransfer([
        tenantId,
        roleId,
        entityId,
        organizationBId,
        id("CUSTODY_OFFERED"),
        id("OFFER_EVIDENCE"),
      ]),
    );

    await wait(
      await organizationBContract.write.acceptCustodyTransfer([
        tenantId,
        roleId,
        entityId,
        id("CUSTODY_ACCEPTED"),
        id("ACCEPTANCE_EVIDENCE"),
      ]),
    );

    const entity =
      await traceForge.read.getEntity([
        tenantId,
        entityId,
      ]);

    assert.equal(
      entity.currentCustodian,
      organizationBId,
    );

    assert.equal(
      await traceForge.read.hasPendingCustodyTransfer([
        tenantId,
        entityId,
      ]),
      false,
    );

    await assert.rejects(async () => {
      await traceForge.read.getPendingCustodyTransfer([
        tenantId,
        entityId,
      ]);
    });
  });

  it("rejects a transfer proposal from a non-custodian organization", async () => {
    const {
      organizationBContract,
      tenantId,
      organizationAId,
      roleId,
      entityId,
    } = await prepareCustodyScenario();

    await assert.rejects(async () => {
      await organizationBContract.write.proposeCustodyTransfer([
        tenantId,
        roleId,
        entityId,
        organizationAId,
        id("CUSTODY_OFFERED"),
        id("OFFER_EVIDENCE"),
      ]);
    });
  });

  it("rejects a custody transfer to the current custodian itself", async () => {
    const {
      organizationAContract,
      tenantId,
      organizationAId,
      roleId,
      entityId,
    } = await prepareCustodyScenario();

    await assert.rejects(async () => {
      await organizationAContract.write.proposeCustodyTransfer([
        tenantId,
        roleId,
        entityId,
        organizationAId,
        id("CUSTODY_OFFERED"),
        id("OFFER_EVIDENCE"),
      ]);
    });
  });

  it("rejects an inactive recipient organization", async () => {
    const {
      traceForge,
      organizationAContract,
      tenantId,
      organizationBId,
      roleId,
      entityId,
      wait,
    } = await prepareCustodyScenario();

    await wait(
      await traceForge.write.setOrganizationActive([
        organizationBId,
        false,
      ]),
    );

    await assert.rejects(async () => {
      await organizationAContract.write.proposeCustodyTransfer([
        tenantId,
        roleId,
        entityId,
        organizationBId,
        id("CUSTODY_OFFERED"),
        id("OFFER_EVIDENCE"),
      ]);
    });
  });

  it("rejects a recipient without active tenant membership", async () => {
    const {
      adminContract,
      organizationAContract,
      tenantId,
      organizationBId,
      roleId,
      entityId,
      wait,
    } = await prepareCustodyScenario();

    await wait(
      await adminContract.write.setTenantMembershipActive([
        tenantId,
        organizationBId,
        false,
      ]),
    );

    await assert.rejects(async () => {
      await organizationAContract.write.proposeCustodyTransfer([
        tenantId,
        roleId,
        entityId,
        organizationBId,
        id("CUSTODY_OFFERED"),
        id("OFFER_EVIDENCE"),
      ]);
    });
  });

  it("rejects a second proposal while another transfer is pending", async () => {
    const {
      organizationAContract,
      tenantId,
      organizationBId,
      roleId,
      entityId,
      wait,
    } = await prepareCustodyScenario();

    await wait(
      await organizationAContract.write.proposeCustodyTransfer([
        tenantId,
        roleId,
        entityId,
        organizationBId,
        id("CUSTODY_OFFERED"),
        id("OFFER_EVIDENCE_V1"),
      ]),
    );

    await assert.rejects(async () => {
      await organizationAContract.write.proposeCustodyTransfer([
        tenantId,
        roleId,
        entityId,
        organizationBId,
        id("CUSTODY_OFFERED_AGAIN"),
        id("OFFER_EVIDENCE_V2"),
      ]);
    });
  });

  it("allows only the intended recipient organization to accept", async () => {
    const {
      organizationAContract,
      tenantId,
      organizationBId,
      roleId,
      entityId,
      wait,
    } = await prepareCustodyScenario();

    await wait(
      await organizationAContract.write.proposeCustodyTransfer([
        tenantId,
        roleId,
        entityId,
        organizationBId,
        id("CUSTODY_OFFERED"),
        id("OFFER_EVIDENCE"),
      ]),
    );

    await assert.rejects(async () => {
      await organizationAContract.write.acceptCustodyTransfer([
        tenantId,
        roleId,
        entityId,
        id("CUSTODY_ACCEPTED"),
        id("ACCEPTANCE_EVIDENCE"),
      ]);
    });
  });

  it("requires the recipient to have active CUSTODY_TRANSFER authorization", async () => {
    const {
      adminContract,
      organizationAContract,
      organizationBContract,
      tenantId,
      organizationBId,
      roleId,
      entityId,
      wait,
    } = await prepareCustodyScenario();

    await wait(
      await organizationAContract.write.proposeCustodyTransfer([
        tenantId,
        roleId,
        entityId,
        organizationBId,
        id("CUSTODY_OFFERED"),
        id("OFFER_EVIDENCE"),
      ]),
    );

    await wait(
      await adminContract.write.setOrganizationRoleActive([
        tenantId,
        organizationBId,
        roleId,
        false,
      ]),
    );

    await assert.rejects(async () => {
      await organizationBContract.write.acceptCustodyTransfer([
        tenantId,
        roleId,
        entityId,
        id("CUSTODY_ACCEPTED"),
        id("ACCEPTANCE_EVIDENCE"),
      ]);
    });
  });

  it("allows the originating custodian to cancel a pending transfer", async () => {
    const {
      traceForge,
      organizationAContract,
      tenantId,
      organizationAId,
      organizationBId,
      roleId,
      entityId,
      wait,
    } = await prepareCustodyScenario();

    await wait(
      await organizationAContract.write.proposeCustodyTransfer([
        tenantId,
        roleId,
        entityId,
        organizationBId,
        id("CUSTODY_OFFERED"),
        id("OFFER_EVIDENCE"),
      ]),
    );

    await wait(
      await organizationAContract.write.cancelCustodyTransfer([
        tenantId,
        roleId,
        entityId,
        id("CUSTODY_CANCELLED"),
        id("CANCELLATION_EVIDENCE"),
      ]),
    );

    const entity =
      await traceForge.read.getEntity([
        tenantId,
        entityId,
      ]);

    assert.equal(
      entity.currentCustodian,
      organizationAId,
    );

    assert.equal(
      await traceForge.read.hasPendingCustodyTransfer([
        tenantId,
        entityId,
      ]),
      false,
    );
  });

  it("does not allow the recipient to cancel the sender's proposal", async () => {
    const {
      organizationAContract,
      organizationBContract,
      tenantId,
      organizationBId,
      roleId,
      entityId,
      wait,
    } = await prepareCustodyScenario();

    await wait(
      await organizationAContract.write.proposeCustodyTransfer([
        tenantId,
        roleId,
        entityId,
        organizationBId,
        id("CUSTODY_OFFERED"),
        id("OFFER_EVIDENCE"),
      ]),
    );

    await assert.rejects(async () => {
      await organizationBContract.write.cancelCustodyTransfer([
        tenantId,
        roleId,
        entityId,
        id("CUSTODY_CANCELLED"),
        id("CANCELLATION_EVIDENCE"),
      ]);
    });
  });

  it("emits custody and trace evidence for proposal and acceptance", async () => {
    const {
      traceForge,
      publicClient,
      organizationAContract,
      organizationBContract,
      organizationAWallet,
      organizationBWallet,
      tenantId,
      organizationAId,
      organizationBId,
      roleId,
      entityId,
      wait,
    } = await prepareCustodyScenario();

    const proposalEvidence =
      id("PROPOSAL_EVIDENCE");

    const proposalReceipt =
      await wait(
        await organizationAContract.write.proposeCustodyTransfer([
          tenantId,
          roleId,
          entityId,
          organizationBId,
          id("CUSTODY_OFFERED"),
          proposalEvidence,
        ]),
      );

    const proposalEvents =
      await publicClient.getContractEvents({
        address: traceForge.address,
        abi: traceForge.abi,
        eventName: "CustodyTransferProposed",
        fromBlock: proposalReceipt.blockNumber,
        toBlock: proposalReceipt.blockNumber,
      });

    assert.equal(
      proposalEvents.length,
      1,
    );

    assert.equal(
      proposalEvents[0].args.fromOrganizationId,
      organizationAId,
    );

    assert.equal(
      proposalEvents[0].args.toOrganizationId,
      organizationBId,
    );

    assert.equal(
      proposalEvents[0].args.evidenceHash,
      proposalEvidence,
    );

    assert.equal(
      proposalEvents[0].args.actor?.toLowerCase(),
      organizationAWallet.account.address.toLowerCase(),
    );

    const proposalTraceEvents =
      await publicClient.getContractEvents({
        address: traceForge.address,
        abi: traceForge.abi,
        eventName: "TraceRecorded",
        fromBlock: proposalReceipt.blockNumber,
        toBlock: proposalReceipt.blockNumber,
      });

    assert.equal(
      proposalTraceEvents.length,
      1,
    );

    const acceptanceEvidence =
      id("ACCEPTANCE_EVIDENCE");

    const acceptanceReceipt =
      await wait(
        await organizationBContract.write.acceptCustodyTransfer([
          tenantId,
          roleId,
          entityId,
          id("CUSTODY_ACCEPTED"),
          acceptanceEvidence,
        ]),
      );

    const custodyEvents =
      await publicClient.getContractEvents({
        address: traceForge.address,
        abi: traceForge.abi,
        eventName: "CustodyTransferred",
        fromBlock: acceptanceReceipt.blockNumber,
        toBlock: acceptanceReceipt.blockNumber,
      });

    assert.equal(
      custodyEvents.length,
      1,
    );

    assert.equal(
      custodyEvents[0].args.fromOrganizationId,
      organizationAId,
    );

    assert.equal(
      custodyEvents[0].args.toOrganizationId,
      organizationBId,
    );

    assert.equal(
      custodyEvents[0].args.evidenceHash,
      acceptanceEvidence,
    );

    assert.equal(
      custodyEvents[0].args.actor?.toLowerCase(),
      organizationBWallet.account.address.toLowerCase(),
    );

    const acceptanceTraceEvents =
      await publicClient.getContractEvents({
        address: traceForge.address,
        abi: traceForge.abi,
        eventName: "TraceRecorded",
        fromBlock: acceptanceReceipt.blockNumber,
        toBlock: acceptanceReceipt.blockNumber,
      });

    assert.equal(
      acceptanceTraceEvents.length,
      1,
    );

    assert.equal(
      acceptanceTraceEvents[0].args.organizationId,
      organizationBId,
    );

    assert.equal(
      acceptanceTraceEvents[0].args.evidenceHash,
      acceptanceEvidence,
    );
  });

  it("allows tenant admin to clear a stuck pending custody transfer", async () => {
    const {
      traceForge,
      publicClient,
      adminContract,
      organizationAContract,
      organizationBContract,
      tenantAdmin,
      tenantId,
      organizationAId,
      organizationBId,
      roleId,
      entityId,
      wait,
    } = await prepareCustodyScenario();

    await wait(
      await organizationAContract.write.proposeCustodyTransfer([
        tenantId,
        roleId,
        entityId,
        organizationBId,
        id("CUSTODY_OFFERED"),
        id("OFFER_EVIDENCE"),
      ]),
    );

    await wait(
      await adminContract.write.setOrganizationRoleActive([
        tenantId,
        organizationAId,
        roleId,
        false,
      ]),
    );

    await wait(
      await adminContract.write.setOrganizationRoleActive([
        tenantId,
        organizationBId,
        roleId,
        false,
      ]),
    );

    await assert.rejects(async () => {
      await organizationAContract.write.cancelCustodyTransfer([
        tenantId,
        roleId,
        entityId,
        id("CUSTODY_CANCELLED"),
        id("NORMAL_CANCEL_EVIDENCE"),
      ]);
    });

    await assert.rejects(async () => {
      await organizationBContract.write.acceptCustodyTransfer([
        tenantId,
        roleId,
        entityId,
        id("CUSTODY_ACCEPTED"),
        id("ACCEPTANCE_EVIDENCE"),
      ]);
    });

    const evidenceHash =
      id("ADMIN_RECOVERY_EVIDENCE");

    const receipt = await wait(
      await adminContract.write.cancelCustodyTransferAsTenantAdmin([
        tenantId,
        entityId,
        id("ADMIN_CUSTODY_CANCELLED"),
        evidenceHash,
      ]),
    );

    assert.equal(
      await traceForge.read.hasPendingCustodyTransfer([
        tenantId,
        entityId,
      ]),
      false,
    );

    const entity =
      await traceForge.read.getEntity([
        tenantId,
        entityId,
      ]);

    assert.equal(
      entity.currentCustodian,
      organizationAId,
    );

    const events =
      await publicClient.getContractEvents({
        address: traceForge.address,
        abi: traceForge.abi,
        eventName: "CustodyTransferCancelledByAdmin",
        fromBlock: receipt.blockNumber,
        toBlock: receipt.blockNumber,
      });

    assert.equal(events.length, 1);

    assert.equal(
      events[0].args.fromOrganizationId,
      organizationAId,
    );

    assert.equal(
      events[0].args.toOrganizationId,
      organizationBId,
    );

    assert.equal(
      events[0].args.evidenceHash,
      evidenceHash,
    );

    assert.equal(
      events[0].args.admin?.toLowerCase(),
      tenantAdmin.account.address.toLowerCase(),
    );
  });

});
