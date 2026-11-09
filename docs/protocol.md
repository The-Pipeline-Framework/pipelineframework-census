# Build census protocol v1

POST `https://pipelineframework.org/api/census/v1/observations` with `Content-Type: application/json`. The complete field vocabulary is [the JSON Schema](../protocol/v1.schema.json). Extra fields at every level are rejected. The body is limited to 16 KiB, including streamed requests. UTF-8 decoding is strict.

The observation describes one root configuration within one retained installation. Counts refer to reachable logical definitions and authored step locations, not generated classes, repeated invocation expansions or execution activity. Canonical types include contributed declarations. Linked Block packages count once. Counts use `0`, `1`, `2–5`, `6–10`, `11–25`, `26–50`, `51–100`, `101+`, and `unknown`. Missing compiler evidence is not zero.

`java_major` describes the compiler JVM. Versions are official numeric release versions, optionally suffixed `-dev`, or `unknown`. The contracts version is read from the contracts API artifact's packaged metadata; older artifacts report unknown. No application version is collected.

The client sends one sample on first use, on changed report values, or on its first build of a new ISO UTC week. It attempts at most once per instance per UTC day. The structure digest stays local and hashes only the already-minimised summary. Identical structures have independent random instance IDs; configuration/version migration preserves identity.

The collector accepts today or yesterday in UTC. An immutable key consists of installation ID, application instance ID, and observation date. Equal duplicates receive 204. Conflicting duplicates receive 409; they never replace the first sample. Durably accepted observations receive 204. Invalid/schema failures receive 400, oversized requests 413, unsupported media 415, rate/quota limits 429, and unavailable ingestion/storage 503. Clients drop all failures; future builds can produce fresh samples. No redirects, automatic retries, credentials, cookies or trace context are used.

Active weekly/monthly installations and application instances are distinct reporting IDs in those periods. Monthly counts are unions, never sums of weekly counts. A configuration distribution uses the latest daily sample for each instance in the month. Migration can be analysed across dates within private retention; no attempt/build counter exists.

The private `period_membership` table retains immutable dated evidence for expiry. Its `period_membership_sets` view deduplicates each installation/application pair within each week or month. Private activity queries count rows in that view for application instances and distinct installation IDs for installations, filtered by `period_kind` and `period_start`. Calendar-month membership comes directly from month rows, since weeks may overlap month boundaries. Neither surface is public.

The initial event has no Connector/provider catalogue, persistence, compensation or runtime-orchestrator mode fields. A separately reviewed schema version may add public allowlisted adoption tokens. Raw arbitrary provider or package identities will never be accepted.
