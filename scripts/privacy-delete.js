// Produce a reviewed SQL request for the operator; never contacts a service itself.
import { writeFileSync } from 'node:fs';
const [installation, output] = process.argv.slice(2);
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(installation ?? '') || !output)
  throw new Error('Usage: privacy-delete.js UUID output.sql');
const expiry = new Date(Date.now() + 31 * 86400000).toISOString().slice(0, 10);
// D1 rejects explicit SQL transaction statements. Install the tombstone first:
// even an interrupted operator execution then blocks ingestion and lets prune
// finish deletion. Reapplying this file is safe.
writeFileSync(output, `INSERT OR REPLACE INTO privacy_deletions VALUES ('${installation}', '${expiry}');\nDELETE FROM observations WHERE installation_id = '${installation}';\nDELETE FROM period_membership WHERE installation_id = '${installation}';\n`, { mode: 0o600, flag: 'wx' });
console.log('Private deletion SQL prepared; follow the privacy runbook before execution.');
