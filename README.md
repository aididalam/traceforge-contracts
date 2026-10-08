# TraceForge Contracts

Smart contract layer for **TraceForge**.

TraceForge Contracts contains the blockchain trust and traceability protocol used by the TraceForge platform.

## Parent Project

This repository is the `contracts/` submodule of
[TraceForge](https://github.com/aididalam/traceforge).
See the parent repository for all components, architecture and setup.

## Responsibilities

- Multi-tenant traceability smart contracts
- Organization and wallet authorization
- Dynamic entity registration
- Dynamic roles and permissions
- Trace events
- Entity state management
- Metadata integrity proofs
- Custody tracking
- Lifecycle and closed-state protection

## Repository

[traceforge-contracts](https://github.com/aididalam/traceforge-contracts)

## Supply flow

`registerBusiness` binds a new business to its caller wallet. `createBusinessWorkspace` creates its own production workspace. Neither requires platform-owner approval.

`claimCustody(tenantId, entityId, expectedVersion, eventType, evidenceHash)` records a receiver's declaration of physical receipt. Any active registered business wallet can receive an open product without a production workspace role or membership. Custody changes immediately and emits `CustodyClaimed`; a monotonically increasing version rejects stale claims.

`closeEntity` allows the active current holder to close a legacy generic entity permanently without a close capability or Shop role. Its retained `roleId` argument is informational for generic client compatibility. New registrations made through `createProduct` use `removeProduct`, including singles, so their quantity, reason and expected version are recorded together. Closed products cannot be claimed again.

Production creation, edits and relationships retain workspace permissions. Capability index 4 is reserved so other permission masks keep their indices; it grants no receiving permission.

## Product quantities and batch routes

The 2026-10-06 contract upgrade implements the parent's
[batch quantity specification](https://github.com/aididalam/traceforge/blob/main/docs/batch-quantity-plan.md).
The matching API/indexer/UI workflows are activated locally on the Pi chain;
see the parent's
[Phase 6 activation](https://github.com/aididalam/traceforge/blob/main/docs/batch-activation-phase6.md).

- `createProduct(tenantId, roleId, entityId, metadataHash, quantity)` requires the
  production create capability. Count is 1 through 9,007,199,254,740,991; one is
  a single, greater than one is a batch. The API defaults omitted count to one
  and validates the required business product/batch ID.
- `getProduct` exposes immutable registration metadata hash, origin, initial
  quantity and current available/removed totals. Later metadata edits do not
  change registration identity or classification.
- `computeRootRouteId` derives the root from chain, contract and product scope.
  Batches have a root route; singles use a zero root ID and ordinary custody.
- `claimBatch(tenantId, entityId, sourceRouteId, receivedRouteId, expectedVersion,
  quantity, evidenceHash)` atomically debits the selected source and creates a
  child owned by the active receiver. Sender approval and workspace membership
  are unnecessary. Source versions reject stale receipt/removal; child IDs
  cannot be zero or reused within that product. A whole-source transfer leaves
  its historical route at zero without closing the batch.
- `getBatchRoute` returns owner, parent, received/available/forwarded/removed
  counts, version and receipt time. Routes into the same business stay separate.
- `removeProduct(tenantId, entityId, routeId, quantity, expectedVersion, reason,
  reasonText, evidenceHash)` allows only that route owner, or the sole custodian
  for a single. Singles use zero route ID and quantity one. It rejects overdraw
  and closes the product only when global available quantity reaches zero.
- `RemovalReason` values are Sold=0, Lost=1, Damaged=2, Spoiled=3, Disposed=4,
  Other=5. Sold permits an empty explanation; other reasons require text. Valid
  UTF-8 is bounded to 256 code points/1,024 bytes, with unsafe controls rejected.
  `QuantityRemoved` contains the actual text, quantities, owner, actor, version,
  time and evidence hash. `getRemovalTotal` exposes counts per reason.

`ProductRegistered`, `BatchReceived` and `QuantityRemoved` contain replayable
balances/ancestry. New receipt/removal emits one quantity business event per
operation. Bulk quantities do not create one record per item. Batch ownership
uses routes; `Entity.currentCustodian` is zero. Legacy `claimCustody`,
`getCustodyVersion`, whole-product closure and source-custodian relationships
cannot bypass batch accounting. Registered singles retain `claimCustody`;
their removal uses the new reasoned operation. Legacy `createEntity` flow stays
compatible for existing generic clients.

The full suite passes 107 tests (82 existing and 25 quantity/route regressions),
including event replay, million-item operations, maximum safe integer counts,
competing source debits, partial exhaustion and direct malformed UTF-8 calldata.
Compiled runtime is 19,135 bytes, below the 24,576-byte limit. CI verifies this
limit and exact generated API/indexer ABI consistency.

```sh
npm ci
npm test
npm run compile
node scripts/deploy.mjs --broadcast
node scripts/verify-deployment.mjs
```

After compiling, run `python3 ops/refresh-contract-abi.py` from the parent checkout
to synchronize API/indexer ABIs, or append `--check` to verify them without edits.
The active deployment is [deployments/9009/TraceForge.json](deployments/9009/TraceForge.json):
`0xf286a8f7bbbe4e5f2337e1701524368794de5672`, chain 9009, block 27861.
The [live operation receipt](deployments/9009/operations/batch-demo.json) records
31 confirmed business operations, including setup, million-item partial receipts,
returns, bulk removals and single-item regressions. Retired receipts remain in
Git history; the old contract remains historical ledger data.

## Docker deployment

The parent repository provides Docker Compose configuration, private persistent
storage, runtime domain settings and backup/recovery commands. See the
[Docker deployment guide](https://github.com/aididalam/traceforge/blob/main/docs/docker-deployment.md).
The contract-tools image is used only for explicit first-chain bootstrap.
Normal application startup reuses the configured deployed contract.
