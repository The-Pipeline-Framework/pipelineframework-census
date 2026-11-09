import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { createWorker } from '../src/worker.js';
import { ingest, prune } from '../src/store.js';
import { publicStatistics } from '../src/aggregate.js';
import { validObservation, periodStarts } from '../src/protocol.js';
import { buildPublicUsageSnapshot } from '../src/public-usage-export.js';
import { latestCompleteWeek } from '../src/weeks.js';
const now = new Date('2026-10-04T12:00:00Z');
function event(overrides = {}) {
  return { schema_version: 1, installation_id: randomUUID(), application_instance_id: randomUUID(), observed_at: '2026-10-04',
    compiler_version: '26.9.4-dev', contracts_version: 'unknown', java_major: 21,
    sizes: { pipelines: '1', steps: '2–5', types: 'unknown', blocks: '0' },
    feature_counts: { nested_invocation: '0', one_to_many: '0', many_to_one: '0', query: '1', command: '0', await: '0' },
    transport: 'REST', platform: 'COMPUTE', runtime_layout: 'MODULAR', ...overrides };
}
class D1 {
  constructor() {
    this.sql = new DatabaseSync(':memory:');
    const directory = new URL('../migrations/', import.meta.url);
    for (const file of readdirSync(directory).filter(file => file.endsWith('.sql')).sort())
      this.sql.exec(readFileSync(new URL(file, directory), 'utf8'));
  }
  prepare(query) {
    const statement = this.sql.prepare(query); let parameters = [];
    const api = { bind(...args) { parameters = args; return api; },
      async first() { return statement.get(...parameters); },
      async all() { return { results: statement.all(...parameters) }; },
      async run() { return statement.run(...parameters); } };
    return api;
  }
  async batch(statements) {
    this.sql.exec('BEGIN');
    try { const result = []; for (const statement of statements) result.push(await statement.run()); this.sql.exec('COMMIT'); return result; }
    catch (error) { this.sql.exec('ROLLBACK'); throw error; }
  }
}
const env = db => ({ CENSUS_DB: db, INGESTION_ENABLED: 'true', IP_RATE_KEY: 'test-only-rate-salt', IP_LIMITER: { limit: async () => ({ success: true }) } });
const request = (body, type = 'application/json') => new Request('https://pipelineframework.org/api/census/v1/observations', {
  method: 'POST', headers: { 'content-type': type }, body: typeof body === 'string' ? body : JSON.stringify(body) });
test('schema and dates reject prohibited and malformed values', () => {
  assert.equal(validObservation(event(), now), true);
  for (const values of [{ endpoint: 'https://secret.invalid' }, { compiler_version: 'private-project' }, { observed_at: '2026-10-05' },
    { observed_at: '2026-10-02' }, { java_major: 0 }, { sizes: { pipelines: '1', steps: 3, types: '0', blocks: '0' } }])
    assert.equal(validObservation(event(values), now), false);
  assert.equal(periodStarts('2027-01-01').week, '2026-12-28');
});
test('ingestion is durable, idempotent, and immutable', async () => {
  const db = new D1(); const sample = event(); const worker = createWorker(() => now);
  assert.equal((await worker.fetch(request(sample), env(db))).status, 204);
  assert.equal((await worker.fetch(request(sample), env(db))).status, 204);
  assert.equal((await worker.fetch(request({ ...sample, java_major: 25 }), env(db))).status, 409);
  assert.equal(db.sql.prepare('SELECT count(*) AS n FROM observations').get().n, 1);
  assert.equal(db.sql.prepare('SELECT count(*) AS n FROM period_membership').get().n, 2);
});
test('quotas allow duplicates but no new observations above the limit', async () => {
  const db = new D1(); const installation = randomUUID(); const samples = [];
  for (let i = 0; i < 128; i++) { samples.push(event({ installation_id: installation })); assert.equal(await ingest(db, samples[i], '2026-10-04'), 204); }
  assert.equal(await ingest(db, event({ installation_id: installation }), '2026-10-04'), 429);
  assert.equal(await ingest(db, samples[0], '2026-10-04'), 204);
});
test('body, transport, rollout and database failures fail closed without logging bodies', async () => {
  const worker = createWorker(() => now); const db = new D1();
  assert.equal((await worker.fetch(request(event()), {})).status, 503);
  assert.equal((await worker.fetch(request(event(), 'text/plain'), env(db))).status, 415);
  assert.equal((await worker.fetch(request('{'), env(db))).status, 400);
  assert.equal((await worker.fetch(request('x'.repeat(17000)), env(db))).status, 413);
  assert.equal((await worker.fetch(request(event()), { ...env(db), IP_LIMITER: { limit: async () => ({ success: false }) } })).status, 429);
  assert.equal((await worker.fetch(request(event()), env({ batch: async () => { throw new Error('storage unavailable'); } }))).status, 503);
});
test('monthly counts use distinct instances and latest samples, not builds', async () => {
  const db = new D1();
  for (let i = 0; i < 20; i++) {
    const sample = event({ observed_at: '2026-09-01' });
    await ingest(db, sample, '2026-09-01');
    await ingest(db, { ...sample, observed_at: '2026-09-28', java_major: 25 }, '2026-09-28');
  }
  await createWorker(() => now).scheduled({}, { CENSUS_DB: db, PUBLIC_STATISTICS_ENABLED: 'true' });
  const stats = JSON.parse(db.sql.prepare('SELECT statistics_json FROM public_statistics').get().statistics_json);
  assert.equal(stats.reporting_application_instances, 20); assert.equal(stats.reporting_installations, 20);
  assert.deepEqual(stats.distributions.java_major.counts, { 25: 20 });
  assert.equal(JSON.stringify(stats).includes('installation_id'), false);
});
test('rare cells suppress their whole marginal dimension', () => {
  const rows = Array.from({ length: 21 }, (_, i) => {
    const sample = event({ java_major: i === 0 ? 25 : 21 });
    return { installation_id: sample.installation_id, snapshot_json: JSON.stringify(sample) };
  });
  assert.deepEqual(publicStatistics(rows, '2026-09-01').distributions.java_major, { status: 'suppressed' });
  assert.equal(publicStatistics(rows.slice(0, 19), '2026-09-01').status, 'insufficient_contributors');
});
test('retention and privacy tombstones remove private events and memberships', async () => {
  const db = new D1(); const old = event({ observed_at: '2026-01-01' }); const current = event();
  await ingest(db, old, '2026-01-01'); await ingest(db, current, '2026-10-04');
  db.sql.prepare('INSERT INTO privacy_deletions VALUES (?, ?)').run(current.installation_id, '2026-11-04');
  await prune(db, now);
  assert.equal(db.sql.prepare('SELECT count(*) AS n FROM observations').get().n, 0);
  assert.equal(db.sql.prepare('SELECT count(*) AS n FROM period_membership').get().n, 0);
  assert.equal(await ingest(db, current, '2026-10-04'), 429);
});

test('cron prunes restored private data while monthly statistics are disabled', async () => {
  for (const statistics of [{}, { PUBLIC_STATISTICS_ENABLED: 'false' }]) {
    const db = new D1();
    const expired = event({ observed_at: '2026-01-01' });
    const restored = event({ observed_at: '2026-09-28' });
    await ingest(db, expired, expired.observed_at);
    await ingest(db, restored, restored.observed_at);
    await createWorker(() => now).scheduled({}, { CENSUS_DB: db, INGESTION_ENABLED: 'false', ...statistics });
    assert.deepEqual(db.sql.prepare('SELECT installation_id FROM observations').all().map(row => row.installation_id), [restored.installation_id]);
    assert.equal(db.sql.prepare('SELECT count(*) AS n FROM period_membership').get().n, 2);
    assert.equal(db.sql.prepare('SELECT count(*) AS n FROM public_statistics').get().n, 0);
  }
});

for (const failure of ['read', 'write']) test(`retention completes before aggregate ${failure} failure`, async () => {
  const db = new D1();
  const expired = event({ observed_at: '2026-01-01' });
  const deleted = event();
  const retained = event({ observed_at: '2026-09-28' });
  await ingest(db, expired, '2026-01-01');
  await ingest(db, deleted, '2026-10-04');
  await ingest(db, retained, '2026-09-28');
  db.sql.prepare('INSERT INTO privacy_deletions VALUES (?, ?)').run(deleted.installation_id, '2026-11-04');
  const prepare = db.prepare.bind(db);
  db.prepare = query => {
    const statement = prepare(query);
    if (failure === 'read' && query.startsWith('SELECT o.*'))
      statement.all = async () => { throw new Error('aggregate read unavailable'); };
    if (failure === 'write' && query.startsWith('INSERT OR IGNORE INTO public_statistics'))
      statement.run = async () => { throw new Error('aggregate write unavailable'); };
    return statement;
  };
  const scheduled = createWorker(() => now).scheduled({}, { CENSUS_DB: db, PUBLIC_STATISTICS_ENABLED: 'true' });
  await assert.rejects(scheduled, new RegExp(`aggregate ${failure} unavailable`));
  assert.deepEqual(db.sql.prepare('SELECT installation_id FROM observations').all().map(row => row.installation_id), [retained.installation_id]);
  assert.equal(db.sql.prepare('SELECT count(*) AS n FROM period_membership_sets').get().n, 2);
  assert.equal(db.sql.prepare('SELECT count(*) AS n FROM public_statistics').get().n, 0);
});

test('private membership sets deduplicate days and union weeks across calendar months', async () => {
  const db = new D1();
  const first = event(); const second = event();
  const anotherInstance = { ...first, application_instance_id: randomUUID() };
  for (const [sample, day] of [[first, '2026-09-28'], [first, '2026-09-30'], [first, '2026-10-01'],
    [first, '2026-10-05'], [second, '2026-10-01'], [anotherInstance, '2026-10-05']])
    await ingest(db, { ...sample, observed_at: day }, day);
  const count = (kind, start) => db.sql.prepare(`SELECT count(DISTINCT installation_id) AS installations, count(*) AS instances
    FROM period_membership_sets WHERE period_kind = ? AND period_start = ?`).get(kind, start);
  assert.deepEqual({ ...count('week', '2026-09-28') }, { installations: 2, instances: 2 });
  assert.deepEqual({ ...count('week', '2026-10-05') }, { installations: 1, instances: 2 });
  assert.deepEqual({ ...count('month', '2026-09-01') }, { installations: 1, instances: 1 });
  assert.deepEqual({ ...count('month', '2026-10-01') }, { installations: 2, instances: 3 });
  // Monthly installations are a union: summing October-active weeks would give 3.
  assert.notEqual(count('month', '2026-10-01').installations,
    count('week', '2026-09-28').installations + count('week', '2026-10-05').installations);
  assert.equal(db.sql.prepare("SELECT count(*) AS n FROM period_membership WHERE period_kind='month' AND period_start='2026-10-01'").get().n, 4);
});

const weeklyStart = '2026-11-02';
const weeklyClose = new Date('2026-11-10T00:00:00.000Z');
const weeklyEnv = db => ({ CENSUS_DB: db, PUBLIC_STATISTICS_ENABLED: 'true', PUBLIC_WEEKLY_FIRST_MONDAY: weeklyStart });
const weeklyRows = db => db.sql.prepare('SELECT * FROM public_weekly_statistics ORDER BY week_start').all();

test('weekly closure waits until Tuesday UTC and honours both publication settings', async () => {
  const db = new D1();
  await ingest(db, event({ observed_at: weeklyStart }), weeklyStart);
  await ingest(db, event({ observed_at: '2026-10-26' }), '2026-10-26');
  const justBefore = new Date('2026-11-09T23:59:59.999Z');
  assert.equal(latestCompleteWeek(justBefore), '2026-10-26');
  assert.equal(latestCompleteWeek(weeklyClose), weeklyStart);
  assert.equal(latestCompleteWeek(new Date('2027-01-05T00:00:00Z')), '2026-12-28');
  const scheduled = settings => createWorker(() => weeklyClose).scheduled({}, { ...weeklyEnv(db), ...settings });
  await createWorker(() => justBefore).scheduled({}, weeklyEnv(db));
  await scheduled({ PUBLIC_STATISTICS_ENABLED: 'false' });
  await scheduled({ PUBLIC_WEEKLY_FIRST_MONDAY: '' });
  await scheduled({ PUBLIC_WEEKLY_FIRST_MONDAY: '2026-11-09' });
  await assert.rejects(scheduled({ PUBLIC_WEEKLY_FIRST_MONDAY: '2026-11-03' }), /must be a UTC Monday/);
  assert.equal(weeklyRows(db).length, 0);
  await scheduled({ PUBLIC_WEEKLY_FIRST_MONDAY: '2026-10-26' });
  assert.deepEqual(weeklyRows(db).map(row => JSON.parse(row.statistics_json)), [
    { week_start: weeklyStart, status: 'insufficient_contributors' }
  ]);
});

test('weekly materialisation uses latest observations and suppresses marginal bins by installation', async () => {
  const db = new D1();
  const samples = Array.from({ length: 24 }, () => event({ observed_at: weeklyStart }));
  for (const sample of samples) {
    await ingest(db, sample, weeklyStart);
    await ingest(db, { ...sample, observed_at: '2026-11-08', java_major: 25 }, '2026-11-09');
  }
  await ingest(db, { ...samples[0], observed_at: '2026-11-09', java_major: 99 }, '2026-11-09');
  for (let i = 0; i < 25; i++) {
    const sample = event({ installation_id: samples[0].installation_id, observed_at: weeklyStart, transport: 'GRPC', java_major: 25 });
    await ingest(db, sample, weeklyStart);
  }
  const scheduled = () => createWorker(() => weeklyClose).scheduled({}, weeklyEnv(db));
  await scheduled();
  const [row] = weeklyRows(db);
  const week = JSON.parse(row.statistics_json);
  assert.equal(row.generated_at, weeklyClose.toISOString());
  assert.equal(week.reporting_installations, 20);
  assert.equal(week.reporting_application_instances, 50);
  assert.deepEqual(week.distributions.transport, { status: 'suppressed' });
  assert.deepEqual(week.distributions.java_major, { status: 'published', counts: { 25: 50 } });
  assert.deepEqual(week.distributions.sizes.steps, { status: 'published', counts: { '2–5': 50 } });
  assert.equal(row.statistics_json.includes(samples[0].installation_id), false);
  assert.equal(row.statistics_json.includes(samples[0].application_instance_id), false);
  const select = readFileSync(new URL('../scripts/select-public-usage.sql', import.meta.url), 'utf8');
  const snapshot = buildPublicUsageSnapshot([{ success: true, results: db.sql.prepare(select).all() }], weeklyClose);
  assert.deepEqual(snapshot.weeks.at(-1), week);
  db.sql.exec('DELETE FROM observations');
  await createWorker(() => new Date('2026-11-11T03:17:00Z')).scheduled({}, weeklyEnv(db));
  assert.deepEqual(weeklyRows(db), [row]);
});

test('an empty weekly sample stays missing and an oversized sample fails closed', async () => {
  const db = new D1();
  const scheduled = () => createWorker(() => weeklyClose).scheduled({}, weeklyEnv(db));
  await scheduled();
  assert.equal(weeklyRows(db).length, 0);
  db.sql.exec(`WITH RECURSIVE fixture(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM fixture WHERE n < 5001)
    INSERT INTO observations SELECT 'test-only', printf('%d', n), '${weeklyStart}', '${weeklyStart}', '{}' FROM fixture`);
  await assert.rejects(scheduled(), /Weekly statistics observation limit exceeded/);
  assert.equal(weeklyRows(db).length, 0);
});
