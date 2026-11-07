# Privacy and collector operations

## Before public release

Keep ingestion and the compiler public reporting gate disabled until a named owner records legal approval for default-on reporting and local identifier storage, terminal-storage/ePrivacy applicability, lawful basis, processors, international transfers, access rights and retention. Confirm website/account authority and assign an operator and privacy-request contact. This code is not evidence of legal compliance.

Identifiers are persistent pseudonyms. Coarse feature combinations can still be distinctive. Developers may opt out with `TPF_TELEMETRY_DISABLED=true`; any disabling JVM or compiler option also wins. Known CI/containers without an explicit retained-state declaration do not report.

Verify the deployment's CDN/WAF/security processing separately. Disable invocation/request/body logging and Logpush for this route, including rejected requests. The Worker sets `observability.enabled=false` and never logs requests, bodies, IPs, identifiers or schema failures. The edge sees IP addresses; they are transient inputs to an hourly HMAC limiter key using `IP_RATE_KEY`, not census data. Keep access to that secret restricted. Document provider retention rather than promising zero infrastructure IP processing.

Validate the database's region, backup terms and access policy. Use a dedicated database and least-privilege operator credentials. Do not join observations to accounts, Cloud applications, authentication systems, release registries or marketing records.

## Retention and restoration

The scheduled task removes raw observations and period membership older than 90 days before attempting aggregation, so an aggregation read or write failure cannot defer expiry. Public aggregate rows contain no identifiers. D1 backup/recovery history can retain deleted data for up to a further 30 days; disclose the actual configured/provider retention.

Before restoring any backup, export the current privacy-deletion tombstones securely. Restore, reapply those tombstones, run expiry/deletion cleanup, and verify before allowing ingestion or aggregate generation. Tombstones expire after 31 days. A deletion request must be retained independently until all recoverable backups containing its data expire. Do not restore public releases that were explicitly withdrawn.

For a privacy request, obtain the locally inspectable installation ID, verify the request through the approved privacy workflow, and generate a private SQL file with `node scripts/privacy-delete.js UUID request.sql`. Review and apply it using operator credentials, preserve the tombstone during the backup window, verify observation and membership removal, and destroy the temporary SQL file. There is deliberately no unauthenticated public deletion endpoint. New observations from a deletion-tombstoned identity are rejected during this window. Local reset creates new identities; it does not erase server data.

Apply the reviewed file with `wrangler d1 execute census --remote --file request.sql` against the confirmed dedicated database. D1 does not accept explicit SQL transaction wrappers. The file writes the tombstone before deleting rows and is safe to reapply. If execution is interrupted after that first statement, ingestion remains blocked for the identity and the next scheduled cleanup completes deletion; verify both private tables rather than assuming completion from the tombstone alone. Local tests exercise the generated file against D1 without an account or remote database.

## Statistics and abuse

The endpoint is unauthenticated and identities can be fabricated. Use the 1,000/minute transient edge limit, the atomic 128 observations/installation/day quota, and aggregate anomaly review. These are census estimates, not authenticated market-share figures. Never inspect or export raw data for public reporting.

Monthly aggregates wait until the third UTC day after month-end to admit yesterday's final sample. An instance contributes once using its latest sample. Require 20 contributing installations and round counts to tens. If any cell in a marginal dimension is below the threshold, suppress that entire dimension to prevent complementary disclosure. No arbitrary cross-filters or private row API exists. This reduces disclosure risk; it is not a formal anonymity guarantee.

Monitor only aggregate acceptance/rejection/storage/cron health, without event bodies or identifiers. On an incident, disable ingestion; builds remain unaffected. Restore into a private environment and run synthetic tests before reopening. Do not remotely request additional census fields.
