import { readFileSync, writeFileSync } from 'node:fs';
import { buildPublicUsageSnapshot } from '../src/public-usage-export.js';

try {
  const [, , input, output, extra] = process.argv;
  if (!input || !output || extra) throw new Error('Usage: node scripts/export-public-usage.js wrangler.json new-snapshot.json');

  const body = readFileSync(input, 'utf8');
  let query;
  try { query = JSON.parse(body); }
  catch { throw new Error('Wrangler input is not valid JSON'); }
  const snapshot = buildPublicUsageSnapshot(query);
  writeFileSync(output, `${JSON.stringify(snapshot, null, 2)}\n`, { flag: 'wx' });
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
