-- Identifiers and events are private. Only public_statistics is publishable.
CREATE TABLE observations (
 installation_id TEXT NOT NULL,
 application_instance_id TEXT NOT NULL,
 observed_at TEXT NOT NULL,
 received_day TEXT NOT NULL,
 snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),
 PRIMARY KEY(installation_id, application_instance_id, observed_at)
);
CREATE INDEX observations_expiry ON observations(received_day);
CREATE INDEX observations_period ON observations(observed_at);
CREATE TABLE period_membership (
 period_kind TEXT NOT NULL CHECK(period_kind IN ('week','month')),
 period_start TEXT NOT NULL,
 installation_id TEXT NOT NULL,
 application_instance_id TEXT NOT NULL,
 last_received_day TEXT NOT NULL,
 PRIMARY KEY(period_kind, period_start, installation_id, application_instance_id, last_received_day)
);
CREATE INDEX membership_expiry ON period_membership(last_received_day);
CREATE TABLE public_statistics (
 period_start TEXT PRIMARY KEY,
 generated_day TEXT NOT NULL,
 statistics_json TEXT NOT NULL CHECK(json_valid(statistics_json))
);
-- Requests awaiting backup expiry are replayed after any restoration.
CREATE TABLE privacy_deletions (installation_id TEXT PRIMARY KEY, expires_at TEXT NOT NULL);
