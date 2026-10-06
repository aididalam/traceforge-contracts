import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { network } from "hardhat";
import { encodeAbiParameters, encodeFunctionData, getContractError, keccak256, stringToHex, zeroHash } from "viem";
import type { BaseError, Hex } from "viem";

const id = (value: string) => keccak256(stringToHex(value));
const maxQuantity = 9_007_199_254_740_991n;
const reason = { Sold: 0, Lost: 1, Damaged: 2, Spoiled: 3, Disposed: 4, Other: 5 } as const;

async function scenario(quantity = 1_000_000n) {
  const { viem } = await network.create();
  const wallets = await viem.getWalletClients();
  const publicClient = await viem.getPublicClient();
  const contract = await viem.deployContract("TraceForge");
  const as = (wallet: typeof wallets[number]) => viem.getContractAt("TraceForge", contract.address, { client: { wallet } });
  const producer = await as(wallets[1]), a = await as(wallets[2]), b = await as(wallets[3]), shop = await as(wallets[4]);
  const outsider = await as(wallets[5]);
  const organizations = [id("PRODUCER"), id("DISTRIBUTOR_A"), id("DISTRIBUTOR_B"), id("SHOP")];
  const clients = [producer, a, b, shop];
  const wait = (hash: Hex) => publicClient.waitForTransactionReceipt({ hash });
  for (let i = 0; i < clients.length; i++) {
    await wait(await clients[i].write.registerBusiness([organizations[i], id("BUSINESS_METADATA")]));
  }
  const tenant = id("PRODUCTION"), role = id("PRODUCER_ROLE"), entity = id("BATCH"), metadata = id("ORIGINAL_METADATA");
  await wait(await producer.write.createBusinessWorkspace([tenant, id("WORKSPACE_METADATA"), role]));
  const registration = await wait(await producer.write.createProduct([tenant, role, entity, metadata, quantity]));
  const product = () => contract.read.getProduct([tenant, entity]);
  const route = (routeId: Hex) => contract.read.getBatchRoute([tenant, entity, routeId]);
  const root = (await product()).rootRouteId;
  const claim = async (client: typeof producer, source: Hex, name: string, count: bigint, version?: bigint) => {
    const routeId = id(name);
    const receipt = await wait(await client.write.claimBatch([tenant, entity, source, routeId,
      version ?? (await route(source)).version, count, id("PHYSICAL_RECEIPT")]));
    return { routeId, receipt };
  };
  const remove = async (client: typeof producer, routeId: Hex, count: bigint, code = reason.Sold as number,
    text = "", version?: bigint) => {
    const expected = version ?? (quantity === 1n ? await contract.read.getCustodyVersion([tenant, entity]) : (await route(routeId)).version);
    return wait(await client.write.removeProduct([tenant, entity, routeId, count, expected, code, text, id("REMOVAL_EVIDENCE")]));
  };
  return { contract, publicClient, wallets, producer, a, b, shop, outsider, organizations, clients,
    wait, tenant, role, entity, metadata, registration, product, route, root, claim, remove };
}
type Scenario = Awaited<ReturnType<typeof scenario>>;

async function conservation(s: Scenario, routeIds: Hex[]) {
  const product = await s.product();
  const routes = await Promise.all(routeIds.map(s.route));
  let available = 0n, removed = 0n;
  for (const route of routes) {
    assert.equal(route.receivedQuantity, route.availableQuantity + route.forwardedQuantity + route.removedQuantity);
    available += route.availableQuantity;
    removed += route.removedQuantity;
  }
  assert.equal(product.availableQuantity, available);
  assert.equal(product.removedQuantity, removed);
  assert.equal(product.initialQuantity, available + removed);
  const totals = await Promise.all(Object.values(reason).map(code => s.contract.read.getRemovalTotal([s.tenant, s.entity, code])));
  assert.equal(totals.reduce((sum, count) => sum + count, 0n), removed);
  const entity = await s.contract.read.getEntity([s.tenant, s.entity]);
  assert.equal(entity.closed, available === 0n);
  assert.equal(entity.currentCustodian, zeroHash);
}

describe("Product registration and immutable quantities", () => {
  it("registers a million-item batch and a scoped root route with original identity", async () => {
    const s = await scenario();
    const product = await s.product(), root = await s.route(s.root);
    assert.equal(product.initialQuantity, 1_000_000n);
    assert.equal(product.registrationMetadataHash, s.metadata);
    assert.equal(product.originOrganizationId, s.organizations[0]);
    assert.equal(root.organizationId, s.organizations[0]);
    assert.equal(root.parentRouteId, zeroHash);
    assert.equal(root.receivedQuantity, 1_000_000n);
    assert.equal(root.version, 0n);
    const expected = keccak256(encodeAbiParameters(
      [{ type: "bytes32" }, { type: "uint256" }, { type: "address" }, { type: "bytes32" }, { type: "bytes32" }],
      [id("TRACEFORGE_ROOT_ROUTE_V1"), BigInt(await s.publicClient.getChainId()), s.contract.address, s.tenant, s.entity]));
    assert.equal(s.root, expected);
    await conservation(s, [s.root]);
    const events = await s.publicClient.getContractEvents({ address: s.contract.address, abi: s.contract.abi,
      eventName: "ProductRegistered", fromBlock: s.registration.blockNumber, toBlock: s.registration.blockNumber });
    assert.equal(events.length, 1);
    assert.equal(events[0].args.initialQuantity, 1_000_000n);
    assert.equal(events[0].args.rootRouteId, s.root);
    assert.equal(events[0].args.registrationMetadataHash, s.metadata);
    assert.equal(events[0].args.actor?.toLowerCase(), s.wallets[1].account.address.toLowerCase());
  });

  it("keeps initial quantity and registration hash after allowed metadata edits", async () => {
    const s = await scenario();
    await s.wait(await s.producer.write.updateEntityMetadata([s.tenant, s.role, s.entity, id("UPDATED"), id("NEW_METADATA"), id("EVIDENCE")]));
    assert.equal((await s.contract.read.getEntity([s.tenant, s.entity])).metadataHash, id("NEW_METADATA"));
    assert.equal((await s.product()).registrationMetadataHash, s.metadata);
    assert.equal((await s.product()).initialQuantity, 1_000_000n);
    await conservation(s, [s.root]);
  });

  it("accepts the exact API-safe integer maximum and rejects zero or greater quantities", async () => {
    const s = await scenario(maxQuantity);
    await conservation(s, [s.root]);
    for (const quantity of [0n, maxQuantity + 1n]) {
      await assert.rejects(() => s.producer.write.createProduct([s.tenant, s.role, id("INVALID"), s.metadata, quantity]), /InvalidQuantity/);
    }
    assert.equal(await s.contract.read.entityExists([s.tenant, id("INVALID")]), false);
  });

  it("conserves the maximum count through partial transfer and removal without rounding", async () => {
    const s = await scenario(maxQuantity);
    const a = await s.claim(s.a, s.root, "LARGE_A", maxQuantity - 1n);
    const b = await s.claim(s.b, s.root, "LAST_ITEM", 1n);
    await s.remove(s.a, a.routeId, maxQuantity - 2n);
    assert.equal((await s.product()).availableQuantity, 2n);
    await conservation(s, [s.root, a.routeId, b.routeId]);
    await s.remove(s.a, a.routeId, 1n);
    await s.remove(s.b, b.routeId, 1n);
    assert.equal((await s.product()).removedQuantity, maxQuantity);
    await conservation(s, [s.root, a.routeId, b.routeId]);
  });

  it("preserves production capability checks and prevents re-registering an entity", async () => {
    const s = await scenario();
    await assert.rejects(() => s.a.write.createProduct([s.tenant, s.role, id("OTHER"), s.metadata, 10n]), /MissingCapability/);
    await assert.rejects(() => s.producer.write.createProduct([s.tenant, s.role, s.entity, s.metadata, 2n]), /EntityAlreadyExists/);
    await assert.rejects(() => s.producer.write.createEntity([s.tenant, s.role, s.entity, id("PRODUCT"), s.metadata, id("STATE")]), /EntityAlreadyExists/);
    await assert.rejects(() => s.contract.read.getProduct([s.tenant, id("UNKNOWN")]), /ProductNotFound/);
  });

  it("keeps roots scoped to the product and cannot borrow a route from another registration", async () => {
    const s = await scenario();
    const other = id("OTHER_PRODUCT");
    await s.wait(await s.producer.write.createProduct([s.tenant, s.role, other, s.metadata, 100n]));
    const product = await s.contract.read.getProduct([s.tenant, other]);
    assert.notEqual(product.rootRouteId, s.root);
    await assert.rejects(() => s.a.write.claimBatch([s.tenant, other, s.root, id("BAD_ROUTE"), 0n, 1n, id("EVIDENCE")]), /RouteNotFound/);
    await assert.rejects(() => s.contract.read.getBatchRoute([s.tenant, other, s.root]), /RouteNotFound/);
    await conservation(s, [s.root]);
  });
});

describe("Direct physical batch receipt and routes", () => {
  it("splits a source across independent businesses without memberships or sender proposals", async () => {
    const s = await scenario();
    assert.equal(await s.contract.read.isActiveTenantMember([s.tenant, s.organizations[1]]), false);
    const first = await s.claim(s.a, s.root, "A_PART", 600_000n);
    await conservation(s, [s.root, first.routeId]);
    const second = await s.claim(s.b, s.root, "B_PART", 400_000n);
    await conservation(s, [s.root, first.routeId, second.routeId]);
    assert.equal((await s.route(s.root)).availableQuantity, 0n);
    assert.equal((await s.route(first.routeId)).availableQuantity, 600_000n);
    assert.equal((await s.route(second.routeId)).availableQuantity, 400_000n);
    assert.equal((await s.product()).removedQuantity, 0n);
    assert.equal((await s.contract.read.getEntity([s.tenant, s.entity])).closed, false);
    const events = await s.publicClient.getContractEvents({ address: s.contract.address, abi: s.contract.abi,
      eventName: "BatchReceived", fromBlock: first.receipt.blockNumber, toBlock: first.receipt.blockNumber });
    assert.equal(events.length, 1);
    assert.equal(events[0].args.sourceRouteId, s.root);
    assert.equal(events[0].args.receivedRouteId, first.routeId);
    assert.equal(events[0].args.fromOrganizationId, s.organizations[0]);
    assert.equal(events[0].args.toOrganizationId, s.organizations[1]);
    assert.equal(events[0].args.quantity, 600_000n);
    assert.equal(events[0].args.sourceAvailableQuantity, 400_000n);
    assert.equal(events[0].args.sourceForwardedQuantity, 600_000n);
    assert.equal(events[0].args.sourceVersion, 1n);
    assert.equal(events[0].args.evidenceHash, id("PHYSICAL_RECEIPT"));
    assert.ok(events[0].args.timestamp! > 0n);
  });

  it("preserves distinct routes into one business and ancestry when products return", async () => {
    const s = await scenario(100n);
    const a = await s.claim(s.a, s.root, "FIRST_A", 60n);
    const b = await s.claim(s.b, s.root, "FIRST_B", 40n);
    const shopA = await s.claim(s.shop, a.routeId, "SHOP_FROM_A", 30n);
    const shopB = await s.claim(s.shop, b.routeId, "SHOP_FROM_B", 20n);
    assert.notEqual(shopA.routeId, shopB.routeId);
    assert.equal((await s.route(shopA.routeId)).parentRouteId, a.routeId);
    assert.equal((await s.route(shopB.routeId)).parentRouteId, b.routeId);
    const back = await s.claim(s.producer, shopA.routeId, "RETURN_TO_PRODUCER", 10n);
    assert.equal((await s.route(back.routeId)).organizationId, s.organizations[0]);
    assert.equal((await s.route(back.routeId)).parentRouteId, shopA.routeId);
    await conservation(s, [s.root, a.routeId, b.routeId, shopA.routeId, shopB.routeId, back.routeId]);
  });

  it("remains a batch when a child receives only one item", async () => {
    const s = await scenario(2n);
    const child = await s.claim(s.a, s.root, "ONE_ITEM", 1n);
    assert.equal((await s.product()).initialQuantity, 2n);
    assert.equal((await s.route(child.routeId)).receivedQuantity, 1n);
    await s.remove(s.a, child.routeId, 1n);
    assert.equal((await s.product()).availableQuantity, 1n);
    assert.equal((await s.contract.read.getEntity([s.tenant, s.entity])).closed, false);
    await conservation(s, [s.root, child.routeId]);
  });

  it("rejects stale competing source debits and preserves other routes' versions", async () => {
    const s = await scenario(100n);
    const a = await s.claim(s.a, s.root, "A", 40n, 0n);
    await assert.rejects(() => s.claim(s.b, s.root, "STALE_B", 20n, 0n), /StaleRoute/);
    const b = await s.claim(s.b, s.root, "B", 20n, 1n);
    assert.equal((await s.route(a.routeId)).version, 0n);
    await s.remove(s.producer, s.root, 10n);
    await assert.rejects(() => s.claim(s.shop, s.root, "STALE_SHOP", 1n, 2n), /StaleRoute/);
    await conservation(s, [s.root, a.routeId, b.routeId]);
  });

  it("rejects receipt by the source owner, zero, overdraw, missing evidence and missing routes", async () => {
    const s = await scenario(100n);
    await assert.rejects(() => s.claim(s.producer, s.root, "SELF", 1n), /InvalidCustodyRecipient/);
    await assert.rejects(() => s.claim(s.a, s.root, "ZERO", 0n), /InvalidQuantity/);
    await assert.rejects(() => s.claim(s.a, s.root, "OVERDRAW", 101n), /InsufficientQuantity/);
    await assert.rejects(() => s.a.write.claimBatch([s.tenant, s.entity, s.root, id("NO_EVIDENCE"), 0n, 1n, zeroHash]), /InvalidEvidenceHash/);
    await assert.rejects(() => s.a.write.claimBatch([s.tenant, s.entity, id("UNKNOWN"), id("MISSING"), 0n, 1n, id("E")]), /RouteNotFound/);
    await conservation(s, [s.root]);
  });

  it("rejects zero or reused child IDs without debiting the source", async () => {
    const s = await scenario(100n);
    await assert.rejects(() => s.a.write.claimBatch([s.tenant, s.entity, s.root, zeroHash, 0n, 1n, id("E")]), /InvalidRouteId/);
    await s.claim(s.a, s.root, "A", 1n);
    await assert.rejects(() => s.claim(s.b, s.root, "A", 1n), /RouteAlreadyExists/);
    assert.equal((await s.route(s.root)).availableQuantity, 99n);
    assert.equal((await s.route(s.root)).version, 1n);
    await conservation(s, [s.root, id("A")]);
  });

  it("cannot receive again from a depleted source while other branches remain open", async () => {
    const s = await scenario(100n);
    const a = await s.claim(s.a, s.root, "ALL_TO_A", 100n);
    await assert.rejects(() => s.claim(s.b, s.root, "EMPTY_SOURCE", 1n), /InsufficientQuantity/);
    assert.equal((await s.contract.read.getEntity([s.tenant, s.entity])).closed, false);
    await conservation(s, [s.root, a.routeId]);
  });

  it("rejects unregistered/disabled receivers and inactive tenants", async () => {
    const s = await scenario();
    await assert.rejects(() => s.claim(s.outsider, s.root, "OUTSIDER", 1n), /WalletNotBound/);
    await s.wait(await s.contract.write.setWalletActive([s.wallets[2].account.address, false]));
    await assert.rejects(() => s.claim(s.a, s.root, "DISABLED", 1n), /WalletNotBound/);
    await s.wait(await s.contract.write.setOrganizationActive([s.organizations[2], false]));
    await assert.rejects(() => s.claim(s.b, s.root, "DISABLED_ORG", 1n), /OrganizationInactive/);
    await s.wait(await s.contract.write.setTenantActive([s.tenant, false]));
    await assert.rejects(() => s.claim(s.shop, s.root, "DISABLED_TENANT", 1n), /TenantInactive/);
    await conservation(s, [s.root]);
  });

  it("blocks legacy whole-product claim/close and custodian-based link bypasses", async () => {
    const s = await scenario();
    await assert.rejects(() => s.a.write.claimCustody([s.tenant, s.entity, 0n, id("RECEIVED"), id("E")]), /BatchOperationRequired/);
    await assert.rejects(() => s.producer.write.closeEntity([s.tenant, zeroHash, s.entity, id("SOLD"), id("E")]), /BatchOperationRequired/);
    await assert.rejects(() => s.contract.read.getCustodyVersion([s.tenant, s.entity]), /BatchOperationRequired/);
    const other = id("LINK_TARGET");
    await s.wait(await s.producer.write.createEntity([s.tenant, s.role, other, id("PRODUCT"), s.metadata, id("STATE")]));
    await assert.rejects(() => s.producer.write.createEntityLink([s.tenant, s.role, s.entity, other, id("LINK"), id("E"), id("E")]), /BatchOperationRequired/);
    await conservation(s, [s.root]);
  });
});

describe("Quantity removal, immutable reasons and termination", () => {
  it("records a bulk sale as one action and preserves other holders' available quantity", async () => {
    const s = await scenario();
    const a = await s.claim(s.a, s.root, "A", 600_000n);
    const b = await s.claim(s.b, s.root, "B", 400_000n);
    const shop = await s.claim(s.shop, a.routeId, "SHOP", 300_000n);
    const receipt = await s.remove(s.shop, shop.routeId, 100_000n);
    const events = await s.publicClient.getContractEvents({ address: s.contract.address, abi: s.contract.abi,
      eventName: "QuantityRemoved", fromBlock: receipt.blockNumber, toBlock: receipt.blockNumber });
    assert.equal(events.length, 1);
    assert.equal(receipt.logs.filter(log => log.address.toLowerCase() === s.contract.address.toLowerCase()).length, 1);
    assert.ok(receipt.gasUsed < 500_000n, "A bulk removal must not perform work per individual item");
    const args = events[0].args;
    assert.equal(args.quantity, 100_000n);
    assert.equal(args.reason, reason.Sold);
    assert.equal(args.reasonText, "");
    assert.equal(args.routeId, shop.routeId);
    assert.equal(args.organizationId, s.organizations[3]);
    assert.equal(args.actor?.toLowerCase(), s.wallets[4].account.address.toLowerCase());
    assert.equal(args.routeAvailableQuantity, 200_000n);
    assert.equal(args.routeRemovedQuantity, 100_000n);
    assert.equal(args.availableQuantity, 900_000n);
    assert.equal(args.removedQuantity, 100_000n);
    assert.equal(args.version, 1n);
    assert.equal(args.evidenceHash, id("REMOVAL_EVIDENCE"));
    assert.ok(args.timestamp! > 0n);
    await s.remove(s.shop, shop.routeId, 200n, reason.Lost, "Lost during handover");
    await s.remove(s.shop, shop.routeId, 500n, reason.Spoiled, "Packaging damaged during storage");
    assert.equal((await s.product()).availableQuantity, 899_300n);
    assert.equal((await s.route(shop.routeId)).availableQuantity, 199_300n);
    assert.equal(await s.contract.read.getRemovalTotal([s.tenant, s.entity, reason.Lost]), 200n);
    assert.equal(await s.contract.read.getRemovalTotal([s.tenant, s.entity, reason.Spoiled]), 500n);
    await conservation(s, [s.root, a.routeId, b.routeId, shop.routeId]);
  });

  it("keeps the batch open when one holder is exhausted and closes only at global zero", async () => {
    const s = await scenario(100n);
    const a = await s.claim(s.a, s.root, "A", 60n), b = await s.claim(s.b, s.root, "B", 40n);
    await s.remove(s.a, a.routeId, 60n);
    assert.equal((await s.product()).availableQuantity, 40n);
    assert.equal((await s.contract.read.getEntity([s.tenant, s.entity])).closed, false);
    await s.remove(s.b, b.routeId, 40n, reason.Damaged, "Container crushed");
    await conservation(s, [s.root, a.routeId, b.routeId]);
    await assert.rejects(() => s.claim(s.shop, b.routeId, "AFTER_CLOSE", 1n), /EntityIsClosed/);
    await assert.rejects(() => s.remove(s.b, b.routeId, 1n), /EntityIsClosed/);
    await assert.rejects(() => s.producer.write.updateEntityMetadata([s.tenant, s.role, s.entity, id("E"), id("NEW"), id("E")]), /EntityIsClosed/);
    assert.equal((await s.route(a.routeId)).receivedQuantity, 60n);
    assert.equal((await s.product()).initialQuantity, 100n);
  });

  it("rejects non-owner, overdraw, zero, stale removal and missing evidence atomically", async () => {
    const s = await scenario(100n);
    const a = await s.claim(s.a, s.root, "A", 20n);
    await assert.rejects(() => s.remove(s.b, a.routeId, 1n), /NotRouteOwner/);
    await assert.rejects(() => s.remove(s.a, a.routeId, 21n), /InsufficientQuantity/);
    await assert.rejects(() => s.remove(s.a, a.routeId, 0n), /InvalidQuantity/);
    await assert.rejects(() => s.a.write.removeProduct([s.tenant, s.entity, a.routeId, 1n, 0n, reason.Sold, "", zeroHash]), /InvalidEvidenceHash/);
    await s.remove(s.a, a.routeId, 5n);
    await assert.rejects(() => s.remove(s.a, a.routeId, 1n, reason.Sold, "", 0n), /StaleRoute/);
    assert.equal((await s.route(a.routeId)).availableQuantity, 15n);
    assert.equal((await s.product()).availableQuantity, 95n);
    await conservation(s, [s.root, a.routeId]);
  });

  it("rejects disabled holders and an inactive tenant for removals", async () => {
    const s = await scenario();
    await assert.rejects(() => s.remove(s.outsider, s.root, 1n), /WalletNotBound/);
    await s.wait(await s.contract.write.setWalletActive([s.wallets[1].account.address, false]));
    await assert.rejects(() => s.remove(s.producer, s.root, 1n), /WalletNotBound/);
    await s.wait(await s.contract.write.setWalletActive([s.wallets[1].account.address, true]));
    await s.wait(await s.contract.write.setOrganizationActive([s.organizations[0], false]));
    await assert.rejects(() => s.remove(s.producer, s.root, 1n), /OrganizationInactive/);
    await s.wait(await s.contract.write.setOrganizationActive([s.organizations[0], true]));
    await s.wait(await s.contract.write.setTenantActive([s.tenant, false]));
    await assert.rejects(() => s.remove(s.producer, s.root, 1n), /TenantInactive/);
    await conservation(s, [s.root]);
  });

  it("requires explanations for non-Sold reasons and rejects control characters or excessive text", async () => {
    const s = await scenario();
    for (const text of ["", " \t\n", "\u00a0\u2003\u3000", "bad\u0000note", "bad\u007fnote", "bad\u0085note", "x".repeat(257), "😀".repeat(257)]) {
      await assert.rejects(() => s.remove(s.producer, s.root, 1n, reason.Other, text), /InvalidRemovalReasonText/);
    }
    await conservation(s, [s.root]);
  });

  it("stores multilingual explanations and accepts the exact character/byte boundary", async () => {
    const s = await scenario();
    const text = "পরিবহনের সময় বোতল ভেঙে গেছে।";
    const receipt = await s.remove(s.producer, s.root, 5n, reason.Damaged, text);
    const events = await s.publicClient.getContractEvents({ address: s.contract.address, abi: s.contract.abi,
      eventName: "QuantityRemoved", fromBlock: receipt.blockNumber, toBlock: receipt.blockNumber });
    assert.equal(events[0].args.reasonText, text);
    await s.remove(s.producer, s.root, 1n, reason.Other, "😀".repeat(256));
    await conservation(s, [s.root]);
  });

  it("rejects malformed UTF-8 passed directly in transaction calldata", async () => {
    const s = await scenario();
    for (const invalid of ["80", "c0af", "eda080", "f4908080", "e282", "c241"]) {
      const data = encodeFunctionData({ abi: s.contract.abi, functionName: "removeProduct",
        args: [s.tenant, s.entity, s.root, 1n, 0n, reason.Other, "x".repeat(invalid.length / 2), id("E")] });
      const hex = data.slice(2);
      const pointer = Number(BigInt("0x" + hex.slice((4 + 6 * 32) * 2, (4 + 7 * 32) * 2)));
      const start = (4 + pointer + 32) * 2;
      const corrupted = ("0x" + hex.slice(0, start) + invalid + hex.slice(start + invalid.length)) as Hex;
      await assert.rejects(async () => {
        try { await s.publicClient.call({ account: s.wallets[1].account.address, to: s.contract.address, data: corrupted }); }
        catch (error) {
          throw getContractError(error as BaseError, { abi: s.contract.abi, address: s.contract.address,
            functionName: "removeProduct", args: [s.tenant, s.entity, s.root, 1n, 0n, reason.Other,
              "x".repeat(invalid.length / 2), id("E")], sender: s.wallets[1].account.address });
        }
      }, /InvalidRemovalReasonText/);
    }
    await conservation(s, [s.root]);
  });

  it("rebuilds ancestry, balances, versions and reason totals from emitted events", async () => {
    const s = await scenario(100n);
    const a = await s.claim(s.a, s.root, "A", 60n), b = await s.claim(s.b, s.root, "B", 40n);
    const shop = await s.claim(s.shop, a.routeId, "SHOP", 30n);
    await s.remove(s.shop, shop.routeId, 7n);
    await s.remove(s.b, b.routeId, 5n, reason.Lost, "Lost on arrival");
    const back = await s.claim(s.a, shop.routeId, "RETURN", 10n);
    const events = await s.publicClient.getContractEvents({ address: s.contract.address, abi: s.contract.abi,
      fromBlock: s.registration.blockNumber, toBlock: "latest" });
    const routes = new Map<Hex, { parent: Hex; owner: Hex; received: bigint; available: bigint; forwarded: bigint; removed: bigint; version: bigint }>();
    const reasons = new Map<number, bigint>();
    let available = 0n, removed = 0n;
    for (const event of events) {
      const args = event.args as Record<string, any>;
      if (args.entityId !== s.entity) continue;
      if (event.eventName === "ProductRegistered") {
        available = args.initialQuantity;
        routes.set(args.rootRouteId, { parent: zeroHash, owner: args.organizationId, received: available, available, forwarded: 0n, removed: 0n, version: 0n });
      } else if (event.eventName === "BatchReceived") {
        const source = routes.get(args.sourceRouteId)!;
        assert.equal(source.owner, args.fromOrganizationId);
        source.available -= args.quantity; source.forwarded += args.quantity; source.version++;
        assert.equal(source.available, args.sourceAvailableQuantity);
        assert.equal(source.forwarded, args.sourceForwardedQuantity);
        assert.equal(source.version, args.sourceVersion);
        routes.set(args.receivedRouteId, { parent: args.sourceRouteId, owner: args.toOrganizationId,
          received: args.quantity, available: args.quantity, forwarded: 0n, removed: 0n, version: 0n });
      } else if (event.eventName === "QuantityRemoved") {
        const route = routes.get(args.routeId)!;
        route.available -= args.quantity; route.removed += args.quantity; route.version++;
        available -= args.quantity; removed += args.quantity;
        reasons.set(args.reason, (reasons.get(args.reason) ?? 0n) + args.quantity);
        assert.equal(route.available, args.routeAvailableQuantity);
        assert.equal(route.removed, args.routeRemovedQuantity);
        assert.equal(route.version, args.version);
        assert.equal(available, args.availableQuantity);
        assert.equal(removed, args.removedQuantity);
      }
    }
    assert.equal(routes.size, 5);
    for (const [routeId, projected] of routes) {
      const route = await s.route(routeId);
      assert.equal(route.parentRouteId, projected.parent);
      assert.equal(route.organizationId, projected.owner);
      assert.equal(route.availableQuantity, projected.available);
      assert.equal(route.receivedQuantity, projected.received);
      assert.equal(route.forwardedQuantity, projected.forwarded);
      assert.equal(route.removedQuantity, projected.removed);
      assert.equal(route.version, projected.version);
    }
    assert.equal((await s.product()).availableQuantity, available);
    for (const code of Object.values(reason)) {
      assert.equal(await s.contract.read.getRemovalTotal([s.tenant, s.entity, code]), reasons.get(code) ?? 0n);
    }
    await conservation(s, [s.root, a.routeId, b.routeId, shop.routeId, back.routeId]);
  });
});

describe("Registered single products retain whole-item custody", () => {
  it("uses quantity one with no batch route and transfers through the existing claim", async () => {
    const s = await scenario(1n);
    assert.equal((await s.product()).rootRouteId, zeroHash);
    await s.wait(await s.a.write.claimCustody([s.tenant, s.entity, 0n, id("RECEIVED"), id("EVIDENCE")]));
    assert.equal((await s.contract.read.getEntity([s.tenant, s.entity])).currentCustodian, s.organizations[1]);
    assert.equal((await s.product()).availableQuantity, 1n);
    await assert.rejects(() => s.a.write.claimBatch([s.tenant, s.entity, zeroHash, id("CHILD"), 0n, 1n, id("E")]), /NotBatchProduct/);
    await assert.rejects(() => s.remove(s.producer, zeroHash, 1n), /NotCurrentCustodian/);
    await assert.rejects(() => s.remove(s.a, zeroHash, 1n, reason.Sold, "", 0n), /StaleCustody/);
    await assert.rejects(() => s.remove(s.a, zeroHash, 2n), /InsufficientQuantity/);
    await assert.rejects(() => s.remove(s.a, id("FAKE_ROUTE"), 1n), /InvalidRouteId/);
    const receipt = await s.remove(s.a, zeroHash, 1n, reason.Lost, "Parcel lost after receipt");
    assert.equal((await s.product()).availableQuantity, 0n);
    assert.equal((await s.product()).removedQuantity, 1n);
    assert.equal((await s.contract.read.getEntity([s.tenant, s.entity])).closed, true);
    assert.equal(await s.contract.read.getRemovalTotal([s.tenant, s.entity, reason.Lost]), 1n);
    const events = await s.publicClient.getContractEvents({ address: s.contract.address, abi: s.contract.abi,
      eventName: "QuantityRemoved", fromBlock: receipt.blockNumber, toBlock: receipt.blockNumber });
    assert.equal(events[0].args.version, 2n);
    assert.equal(events[0].args.reasonText, "Parcel lost after receipt");
    await assert.rejects(() => s.shop.write.claimCustody([s.tenant, s.entity, 2n, id("RECEIVED"), id("E")]), /EntityIsClosed/);
  });

  it("requires the reasoned removal path for registered singles, preventing unaccounted legacy closure", async () => {
    const s = await scenario(1n);
    await assert.rejects(() => s.producer.write.closeEntity([s.tenant, zeroHash, s.entity, id("SOLD"), id("E")]), /ProductRemovalRequired/);
    await s.remove(s.producer, zeroHash, 1n);
    assert.equal((await s.product()).removedQuantity, 1n);
    assert.equal(await s.contract.read.getRemovalTotal([s.tenant, s.entity, reason.Sold]), 1n);
  });
});
