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

`closeEntity` allows the active current holder to close permanently without a close capability or Shop role. Its retained `roleId` argument is informational for generic client compatibility, not an authorization gate. Closed products cannot be claimed again.

Production creation, edits and relationships retain workspace permissions. Capability index 4 is reserved so other permission masks keep their indices; it grants no receiving permission.

```sh
npm ci
npm test
npm run compile
node scripts/deploy.mjs --broadcast
node scripts/verify-deployment.mjs
```

After compiling, run `python3 ops/refresh-contract-abi.py` from the parent checkout to synchronize API/indexer ABIs. Active deployment records are in `deployments/9009`; retired sandbox operations are removed. Contract tests and isolated API integration cover the new receipt/lifecycle flow.
