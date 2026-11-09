# Privacy and collector operations

## Before public release

Keep ingestion and the compiler public reporting gate disabled until a named owner records legal approval for default-on reporting and local identifier storage, terminal-storage/ePrivacy applicability, lawful basis, processors, international transfers, access rights and retention. Confirm website/account authority and assign an operator and privacy-request contact. This code is not evidence of legal compliance.

Identifiers are persistent pseudonyms. Coarse feature combinations can still be distinctive. Developers may opt out with `TPF_TELEMETRY_DISABLED=true`; any disabling JVM or compiler option also wins. Known CI/containers without an explicit retained-state declaration do not report.

Verify the deployment's CDN/WAF/security processing separately. Disable invocation/request/body logging and Logpush for this route, including rejected requests. The Worker sets `observability.enabled=false` and never logs requests, bodies, IPs, identifiers or schema failures. The edge sees IP addresses; they are transient inputs to an hourly HMAC limiter key using `IP_RATE_KEY`, not census data. Keep access to that secret restricted. Document provider retention rather than promising zero infrastructure IP processing.

Validate the database's region, backup terms and access policy. Use a dedicated database and least-privilege operator credentials. Do not join observations to accounts, Cloud applications, authentication systems, release registries or marketing records.

## Retention and restoration

The scheduled task removes raw observations and period membership older than 90 days before attempting aggregation, so an aggregation read or write failure cannot defer expiry. Public aggregate rows contain no identifiers. D1 backup/recovery history can retain deleted data for up to a further 30 days; disclose the actual configured/provider retention.

Before restoring any backup, securely export the current privacy-deletion tombstones and record any withdrawn public releases. Restore into a private environment with `INGESTION_ENABLED=false` and `PUBLIC_STATISTICS_ENABLED=false`. Verify both settings on the active Worker and wait for any scheduled run started with statistics enabled to finish before restoring its database. Cron still runs expiry and deletion cleanup with both flags off.

After restoring, reapply the tombstones, run expiry and deletion cleanup, and verify the affected rows are gone from observations and period membership. Check both the monthly and weekly statistics tables for withdrawn public releases. Keep both flags off until these checks pass. Tombstones expire after 31 days. Retain deletion requests independently until all recoverable backups containing their data expire.

If a monthly row was generated before cleanup, keep `PUBLIC_STATISTICS_ENABLED=false` and withdraw that month from public distribution. Verify the affected `period_start` and its `generated_day` in the dedicated database, then have the operator review and delete only that row by its `period_start` key. Confirm the row is gone. Regenerate it only if a complete corrected sample remains and the normal schedule still covers that month. After regeneration, check the released counts and suppression before republishing. Otherwise keep that month withdrawn and record the withdrawal for future restores.

Use the same correction workflow for an affected weekly row. In `public_weekly_statistics`, verify `week_start` and `generated_at`, and delete only the reviewed row by its `week_start` key. Withdraw the affected static snapshot from public distribution through the site publication process. Cron can regenerate only the latest eligible week. Keep a record of the withdrawal for future restores.

For a privacy request, obtain the locally inspectable installation ID, verify the request through the approved privacy workflow, and generate a private SQL file with `node scripts/privacy-delete.js UUID request.sql`. Review and apply it using operator credentials, preserve the tombstone during the backup window, verify observation and membership removal, and destroy the temporary SQL file. There is deliberately no unauthenticated public deletion endpoint. New observations from a deletion-tombstoned identity are rejected during this window. Local reset creates new identities; it does not erase server data.

Apply the reviewed file with `wrangler d1 execute census --remote --file request.sql` against the confirmed dedicated database. D1 does not accept explicit SQL transaction wrappers. The file writes the tombstone before deleting rows and is safe to reapply. If execution is interrupted after that first statement, ingestion remains blocked for the identity and the next scheduled cleanup completes deletion; verify both private tables rather than assuming completion from the tombstone alone. Local tests exercise the generated file against D1 without an account or remote database.

## Statistics and abuse

The endpoint is unauthenticated and identities can be fabricated. Use the 1,000/minute transient edge limit, the atomic 128 observations/installation/day quota, and aggregate anomaly review. These are census estimates, not authenticated market-share figures. Never inspect or export raw data for public reporting.

Enable `PUBLIC_STATISTICS_ENABLED=true` only after approval and a complete reporting period. Monthly aggregates wait until the third UTC day after month-end to admit yesterday's final sample. An instance contributes once using its latest sample. Require 20 contributing installations and round counts to tens. If any cell in a marginal dimension is below the threshold, suppress that entire dimension to prevent complementary disclosure. No arbitrary cross-filters or private row API exists. This reduces disclosure risk; it is not a formal anonymity guarantee.

Monitor only aggregate acceptance/rejection/storage/cron health, without event bodies or identifiers. On an incident, disable ingestion; builds remain unaffected. Restore into a private environment and run synthetic tests before reopening. Do not remotely request additional census fields.

## Weekly public usage export

Weekly materialisation requires `PUBLIC_STATISTICS_ENABLED=true` and `PUBLIC_WEEKLY_FIRST_MONDAY=YYYY-MM-DD`. Choose the first Monday at 00:00 UTC from which approved collection covered a full week. Leave the date empty until then. A Sunday-ending week closes on Tuesday at 00:00 UTC so Monday can still admit late Sunday observations. Each run considers only the latest closed week on or after the configured start. Empty weeks stay missing, and previously materialised rows remain fixed.

The weekly job takes the latest accepted daily sample per installation and application instance. It rounds counts to tens. A week with fewer than 20 contributing installations has no counts. If any occupied bin has fewer than 20 distinct contributing installations, the entire dimension is suppressed. The job reads at most 5,001 observations to detect and reject a week above the 5,000-row processing limit. An oversized week remains missing until an operator reviews the failure.

After rollout approval, run the reviewed read-only query against the confirmed dedicated database. The query selects only the weekly public statistics table. Use a new output path for each export.

```sh
export_dir=$(mktemp -d)
WRANGLER_SEND_METRICS=false npx wrangler d1 execute census --remote \
  --file scripts/select-public-usage.sql --json > "$export_dir/wrangler.json"
node scripts/export-public-usage.js "$export_dir/wrangler.json" "$export_dir/usage-v1.json"
```

The offline exporter checks the independently versioned [public usage schema](../protocol/public-usage-v1.schema.json) and produces 12 consecutive UTC ISO weeks ending at the latest closed week. Earlier missing slots remain explicit. The latest closed week must have a materialised result, which can report insufficient contributors. An invalid input or missing latest week fails before writing. The exporter exclusively creates a new file, so retries cannot replace an existing snapshot. Review the export before handing it to the site operator. Keep the last approved site snapshot when export or verification fails.
