import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { network } from "hardhat";
import { keccak256, stringToHex, zeroHash } from "viem";
const id = (value: string) => keccak256(stringToHex(value));
async function scenario() {
  const { viem } = await network.create();
  const [owner, producer, distributor, shop, outsider] = await viem.getWalletClients();
  const publicClient = await viem.getPublicClient();
  const contract = await viem.deployContract("TraceForge");
  const as = async (wallet: typeof owner) => viem.getContractAt("TraceForge", contract.address, { client: { wallet } });
  const a = await as(producer), b = await as(distributor), c = await as(shop), unknown = await as(outsider);
  const tenant = id("PRODUCTION"), role = id("PRODUCER"), entity = id("BOTTLE");
  const orgA = id("COCA_COLA"), orgB = id("WORLD_SHIPMENT"), orgC = id("SHOP");
  const wait = (hash: `0x${string}`) => publicClient.waitForTransactionReceipt({ hash });
  for (const [client, org] of [[a, orgA], [b, orgB], [c, orgC]] as const) {
    await wait(await client.write.registerBusiness([org, id("BUSINESS_METADATA")]));
  }
  await wait(await a.write.createBusinessWorkspace([tenant, id("WORKSPACE_METADATA"), role]));
  await wait(await a.write.createEntity([tenant, role, entity, id("PRODUCT"), id("PRODUCT_METADATA"), id("PRODUCED")]));
  const claim = (client: typeof a, version = 0n) => client.write.claimCustody([tenant, entity, version, id("RECEIVED"), id("PHYSICAL_RECEIPT")]);
  const close = (client: typeof a) => client.write.closeEntity([tenant, zeroHash, entity, id("DAMAGED"), id("CLOSE_EVIDENCE")]);
  return { contract, publicClient, producer, distributor, a, b, c, unknown, wait, claim, close, tenant, role, entity, orgA, orgB, orgC };
}
describe("Independent businesses and direct physical receipt", () => {
  it("registers businesses without owner approval; recipient has no workspace membership or receiving role", async () => {
    const s = await scenario();
    assert.equal((await s.contract.read.getOrganization([s.orgB])).active, true);
    assert.equal(await s.contract.read.isActiveTenantMember([s.tenant, s.orgB]), false);
    assert.equal(await s.contract.read.hasCapability([s.tenant, s.distributor.account.address, s.role, 4]), false);
  });
  it("changes custody immediately on the receiver's claim", async () => {
    const s = await scenario(); await s.wait(await s.claim(s.b));
    assert.equal((await s.contract.read.getEntity([s.tenant, s.entity])).currentCustodian, s.orgB);
    assert.equal(await s.contract.read.getCustodyVersion([s.tenant, s.entity]), 1n);
  });
  it("supports an unplanned chain, including returning to an earlier holder", async () => {
    const s = await scenario(); await s.wait(await s.claim(s.b)); await s.wait(await s.claim(s.c, 1n)); await s.wait(await s.claim(s.a, 2n));
    assert.equal((await s.contract.read.getEntity([s.tenant, s.entity])).currentCustodian, s.orgA);
    assert.equal(await s.contract.read.getCustodyVersion([s.tenant, s.entity]), 3n);
  });
  it("rejects stale competing claims, including after custody returns to the same business", async () => {
    const s = await scenario(); await s.wait(await s.claim(s.b));
    await assert.rejects(() => s.claim(s.c), /StaleCustody/);
    await s.wait(await s.claim(s.a, 1n)); await assert.rejects(() => s.claim(s.c), /StaleCustody/);
  });
  it("rejects receipt by the current holder", async () => {
    const s = await scenario(); await assert.rejects(() => s.claim(s.a), /InvalidCustodyRecipient/);
  });
  it("rejects unregistered wallets", async () => {
    const s = await scenario(); await assert.rejects(() => s.claim(s.unknown), /WalletNotBound/);
  });
  it("rejects disabled wallets and businesses", async () => {
    const s = await scenario(); await s.wait(await s.contract.write.setWalletActive([s.distributor.account.address, false]));
    await assert.rejects(() => s.claim(s.b), /WalletNotBound/);
    await s.wait(await s.contract.write.setWalletActive([s.distributor.account.address, true]));
    await s.wait(await s.contract.write.setOrganizationActive([s.orgB, false]));
    await assert.rejects(() => s.claim(s.b), /OrganizationInactive/);
  });
  it("requires nonzero event type and physical receipt evidence", async () => {
    const s = await scenario();
    await assert.rejects(() => s.b.write.claimCustody([s.tenant, s.entity, 0n, zeroHash, id("E")]), /InvalidEventType/);
    await assert.rejects(() => s.b.write.claimCustody([s.tenant, s.entity, 0n, id("RECEIVED"), zeroHash]), /InvalidEvidenceHash/);
  });
  it("records previous/new business, actor, time, version and evidence", async () => {
    const s = await scenario(), receipt = await s.wait(await s.claim(s.b));
    const events = await s.publicClient.getContractEvents({ address: s.contract.address, abi: s.contract.abi, eventName: "CustodyClaimed", fromBlock: receipt.blockNumber, toBlock: receipt.blockNumber });
    assert.equal(events.length, 1); assert.equal(events[0].args.fromOrganizationId, s.orgA); assert.equal(events[0].args.toOrganizationId, s.orgB);
    assert.equal(events[0].args.actor?.toLowerCase(), s.distributor.account.address.toLowerCase()); assert.equal(events[0].args.custodyVersion, 1n);
    assert.equal(events[0].args.evidenceHash, id("PHYSICAL_RECEIPT")); assert.ok(events[0].args.timestamp! > 0n);
    const traces = await s.publicClient.getContractEvents({ address: s.contract.address, abi: s.contract.abi, eventName: "TraceRecorded", fromBlock: receipt.blockNumber, toBlock: receipt.blockNumber });
    assert.equal(traces[0].args.roleId, zeroHash); assert.equal(traces[0].args.organizationId, s.orgB);
  });
  it("allows a distributor without workspace membership to close; closed products stay closed", async () => {
    const s = await scenario(); await s.wait(await s.claim(s.b)); await assert.rejects(() => s.close(s.a), /NotCurrentCustodian/);
    await s.wait(await s.close(s.b)); assert.equal((await s.contract.read.getEntity([s.tenant, s.entity])).closed, true);
    await assert.rejects(() => s.claim(s.c, 2n), /EntityIsClosed/); await assert.rejects(() => s.close(s.b), /EntityIsClosed/);
  });
  it("prevents duplicate identities and reuse of a registered wallet", async () => {
    const s = await scenario(); await assert.rejects(() => s.unknown.write.registerBusiness([s.orgA, id("META")]), /OrganizationAlreadyExists/);
    await assert.rejects(() => s.a.write.registerBusiness([id("SECOND_ORG"), id("META")]), /WalletAlreadyBound/);
  });
  it("preserves permissions for creating products and workspace ownership", async () => {
    const s = await scenario();
    await assert.rejects(() => s.b.write.createEntity([s.tenant, s.role, id("OTHER_PRODUCT"), id("PRODUCT"), id("META"), id("ACTIVE")]), /MissingCapability/);
    await assert.rejects(() => s.b.write.createBusinessWorkspace([s.tenant, id("META"), id("OTHER_ROLE")]), /TenantAlreadyExists/);
  });
});
