import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const execute = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const installation = '12345678-1234-4234-8234-123456789abc';
const other = 'abcdef12-1234-4234-8234-123456789abc';

test('operator deletion SQL executes on local D1 and preserves unrelated data', { timeout: 60000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tpf-census-deletion-'));
  try {
    const config = join(directory, 'wrangler.toml');
    const initial = join(directory, 'initial.sql');
    const deletion = join(directory, 'deletion.sql');
    await writeFile(config, `name = "census-deletion-test"
compatibility_date = "2026-10-04"
[[d1_databases]]
binding = "CENSUS_DB"
database_name = "census"
database_id = "00000000-0000-0000-0000-000000000000"
`);
    const migrations = join(root, 'migrations');
    const definitions = await Promise.all((await readdir(migrations)).filter(file => file.endsWith('.sql')).sort()
      .map(file => readFile(join(migrations, file), 'utf8')));
    const seed = [installation, other].map(id => `
INSERT INTO observations VALUES ('${id}', '${id}', '2026-10-04', '2026-10-04', '{}');
INSERT INTO period_membership VALUES ('month', '2026-10-01', '${id}', '${id}', '2026-10-04');`).join('\n');
    await writeFile(initial, definitions.join('\n') + seed);
    const options = { cwd: root, env: { ...process.env, WRANGLER_SEND_METRICS: 'false' }, timeout: 25000 };
    const wrangler = join(root, 'node_modules/wrangler/bin/wrangler.js');
    const local = ['d1', 'execute', 'census', '--local', '--config', config,
      '--persist-to', join(directory, 'state'), '--json'];
    await execute(process.execPath, [wrangler, ...local, '--file', initial], options);
    await execute(process.execPath, ['scripts/privacy-delete.js', installation, deletion], options);
    if (process.platform !== 'win32') assert.equal((await stat(deletion)).mode & 0o777, 0o600);
    // Exercise the exact generated file, including syntax and D1's transaction rules.
    await execute(process.execPath, [wrangler, ...local, '--file', deletion], options);
    await execute(process.execPath, [wrangler, ...local, '--file', deletion], options);
    const { stdout } = await execute(process.execPath, [wrangler, ...local, '--command', `
SELECT installation_id FROM observations;
SELECT installation_id FROM period_membership_sets;
SELECT installation_id FROM privacy_deletions;`], options);
    const results = JSON.parse(stdout);
    assert.deepEqual(results[0].results, [{ installation_id: other }]);
    assert.deepEqual(results[1].results, [{ installation_id: other }]);
    assert.deepEqual(results[2].results, [{ installation_id: installation }]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
