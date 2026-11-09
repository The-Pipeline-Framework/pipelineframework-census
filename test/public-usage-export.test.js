import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPublicUsageSnapshot } from '../src/public-usage-export.js';
import { latestCompleteWeek } from '../src/weeks.js';

const now = new Date('2026-11-10T00:00:00Z');
const row = (week_start, fields = {}) => ({ week_start,
  statistics_json: JSON.stringify({ week_start, status: 'insufficient_contributors', ...fields }) });
const query = (...results) => [{ success: true, results }];

test('snapshot is twelve ordered weeks including leading and internal gaps', () => {
  const snapshot = buildPublicUsageSnapshot(query(row('2026-10-26'), row('2026-11-02'), row('2026-10-12')), now);
  assert.equal(snapshot.generated_at, '2026-11-10T00:00:00.000Z');
  assert.equal(snapshot.latest_complete_week, '2026-11-02');
  assert.deepEqual(snapshot.weeks.map(week => week.week_start), [
    '2026-08-17', '2026-08-24', '2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21',
    '2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26', '2026-11-02'
  ]);
  assert.deepEqual(snapshot.weeks.filter(week => week.status !== 'missing').map(week => week.week_start), ['2026-10-12', '2026-10-26', '2026-11-02']);
});

test('export rejects a missing latest closed week even if earlier weeks are present', () => {
  assert.throws(() => buildPublicUsageSnapshot(query(row('2026-10-26')), now), /Latest closed week has not been materialised/);
});

test('export rejects empty, stale, malformed, future and identifier-bearing inputs', () => {
  const latest = row('2026-11-02');
  for (const input of [[], [{ success: false, results: [latest] }], query(), query(row('2026-08-10')),
    query(latest, latest), query(row('2026-11-09')), query(row('2026-11-03')), query(row('2026-11-02', { status: 'missing' })),
    query({ ...latest, statistics_json: '{' }), query({ ...latest, installation_id: 'private' }),
    query(row('2026-11-02', { installation_id: 'private' })), query(row('2026-11-02', { week_start: '2026-10-26' }))]) {
    assert.throws(() => buildPublicUsageSnapshot(input, now));
  }
});

test('offline exporter never replaces an existing snapshot', () => {
  const directory = mkdtempSync(join(tmpdir(), 'tpf-usage-export-'));
  try {
    const input = join(directory, 'wrangler.json');
    const output = join(directory, 'snapshot.json');
    const script = fileURLToPath(new URL('../scripts/export-public-usage.js', import.meta.url));
    writeFileSync(output, 'last-good');
    const run = () => spawnSync(process.execPath, [script, input, output], { encoding: 'utf8' });
    writeFileSync(input, JSON.stringify(query()));
    assert.match(run().stderr, /No materialised weeks/);
    assert.equal(readFileSync(output, 'utf8'), 'last-good');
    writeFileSync(input, JSON.stringify(query(row(latestCompleteWeek(new Date())))));
    const existing = run();
    assert.equal(existing.status, 1);
    assert.match(existing.stderr, /EEXIST/);
    assert.equal(readFileSync(output, 'utf8'), 'last-good');
    rmSync(output);
    assert.equal(run().status, 0);
    assert.equal(JSON.parse(readFileSync(output, 'utf8')).weeks.length, 12);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
