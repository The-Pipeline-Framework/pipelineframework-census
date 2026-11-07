# TPF build census

TPF ecosystem telemetry observes what developers build, never what their applications process.

This repository owns the census protocol and a small Cloudflare Worker/D1 collector. The compiler owns the build-only client. There are no runtime execution observations, source names, schemas, coordinates, endpoints or credentials in the protocol.

**Status:** implemented for local verification. Public ingestion is disabled. The compiler release gate also disables transmission; explicit local preview is available. Deployment, default-on release and public statistics require the approvals in [the privacy runbook](docs/privacy-runbook.md).

## Local verification

```sh
npm ci
npm test
WRANGLER_SEND_METRICS=false npm run check
```

Tests execute actual SQLite statements through Node's SQLite API and run the generated privacy-deletion file against an isolated local D1 database; the production store uses D1. Node 22.13+ supports the test adapter; Node 24+ is recommended. No Cloudflare account or public endpoint is needed for tests or bundling.

Validate a compiler-produced fixture after its test suite:

```sh
node scripts/verify-client-fixture.js ../pipelineframework-compiler/target/census-client-fixture.json
```

The [v1 schema](protocol/v1.schema.json), [protocol](docs/protocol.md), [storage migrations](migrations/0001_census.sql) and [privacy runbook](docs/privacy-runbook.md) are public, inspectable contracts. Runtime observability is independent.

## Deployment boundary

The checked-in Worker configuration intentionally has no production route, a placeholder database ID, and `INGESTION_ENABLED=false`. Create a dedicated D1 database, apply migrations, configure its real binding and the website route, and set `IP_RATE_KEY` through Worker secret storage after the release gates. Never commit credentials. Set `INGESTION_ENABLED=true` only after verifying logging and privacy controls.

The scheduled task runs private monthly aggregation and 90-day expiry. No raw-event endpoint exists. Public statistics are generated into a separate table; publishing that table is a separately approved site change.
