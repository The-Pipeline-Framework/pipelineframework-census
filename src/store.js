import { snapshot, periodStarts } from './protocol.js';
export const INSERT_OBSERVATION = `INSERT OR IGNORE INTO observations
 (installation_id, application_instance_id, observed_at, received_day, snapshot_json)
 SELECT ?, ?, ?, ?, ? WHERE
 (SELECT count(*) FROM observations WHERE installation_id = ? AND received_day = ?) < 128
 AND NOT EXISTS (SELECT 1 FROM privacy_deletions WHERE installation_id = ?)`;
const SELECT = 'SELECT snapshot_json FROM observations WHERE installation_id = ? AND application_instance_id = ? AND observed_at = ?';
export async function ingest(db, event, today) {
  const { installation_id: installation, application_instance_id: application, observed_at: day } = event;
  const value = snapshot(event);
  const periods = periodStarts(day);
  const statements = [db.prepare(INSERT_OBSERVATION).bind(installation, application, day, today, value, installation, today, installation)];
  for (const [kind, start] of Object.entries(periods)) statements.push(db.prepare(`INSERT OR IGNORE INTO period_membership
    SELECT ?, ?, installation_id, application_instance_id, received_day FROM observations
    WHERE installation_id = ? AND application_instance_id = ? AND observed_at = ?`)
    .bind(kind, start, installation, application, day));
  await db.batch(statements);
  const stored = await db.prepare(SELECT).bind(installation, application, day).first();
  if (!stored) return 429;
  // Compare semantic JSON, independent of property order in the sender's envelope.
  // Values were strictly validated; explicit comparison handles nested object order.
  const equal = (a, b) => typeof a !== 'object' || a === null ? a === b
    : Object.keys(a).length === Object.keys(b).length && Object.keys(a).every(key => equal(a[key], b[key]));
  return equal(JSON.parse(stored.snapshot_json), JSON.parse(value)) ? 204 : 409;
}
export async function prune(db, now = new Date()) {
  const cutoff = new Date(now.getTime() - 90 * 86400000).toISOString().slice(0, 10);
  const today = now.toISOString().slice(0, 10);
  await db.batch([
    db.prepare('DELETE FROM observations WHERE received_day < ? OR installation_id IN (SELECT installation_id FROM privacy_deletions)').bind(cutoff),
    db.prepare('DELETE FROM period_membership WHERE last_received_day < ? OR installation_id IN (SELECT installation_id FROM privacy_deletions)').bind(cutoff),
    db.prepare('DELETE FROM privacy_deletions WHERE expires_at < ?').bind(today)
  ]);
}
