# TraceForge Contracts

Part of [TraceForge](https://github.com/aididalam/traceforge). See the parent repository for setup and deployment.

Defines business registration, owner-approved product receipts and ownership.
Records product metadata hashes, batch routes, quantities and removal reasons.
Only the source holder signs `approveReceipt`; receiver identity, quantity, expiry,
version and replay guards prevent unsolicited stock transfers. `ReceiptApproved`
records both wallets alongside the movement events consumed by the indexer.

Run `npm ci && npm test` for authorization, quantity, replay and lifecycle tests.
This contract replaces the v0.2 receipt interface and requires a new deployment.

## License

Licensed under the [MIT License](LICENSE), as part of TraceForge.
Third-party dependencies retain their own licenses.
