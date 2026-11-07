const MIN_INSTALLATIONS = 20;
const round = count => Math.round(count / 10) * 10;
export function publicStatistics(rows, period) {
  const installations = new Set(rows.map(row => row.installation_id));
  if (installations.size < MIN_INSTALLATIONS) return { period, status: 'insufficient_contributors' };
  const result = { period, status: 'published', definitions: 'reporting application instances; latest sampled configuration',
    reporting_installations: round(installations.size), reporting_application_instances: round(rows.length), distributions: {} };
  const dimensions = ['compiler_version','contracts_version','java_major','transport','platform','runtime_layout',
    ...['pipelines','steps','types','blocks'].map(key => `sizes.${key}`),
    ...['nested_invocation','one_to_many','many_to_one','query','command','await'].map(key => `feature_counts.${key}`)];
  for (const dimension of dimensions) {
    const bins = new Map();
    for (const row of rows) {
      const sample = JSON.parse(row.snapshot_json);
      const value = dimension.split('.').reduce((value, key) => value[key], sample);
      if (!bins.has(value)) bins.set(value, { count: 0, installations: new Set() });
      bins.get(value).count++; bins.get(value).installations.add(row.installation_id);
    }
    // Whole-dimension suppression prevents deriving a hidden cell from its complement.
    result.distributions[dimension] = [...bins.values()].some(bin => bin.installations.size < MIN_INSTALLATIONS)
      ? { status: 'suppressed' }
      : { status: 'published', counts: Object.fromEntries([...bins].map(([value, bin]) => [value, round(bin.count)])) };
  }
  return result;
}
export async function aggregate(db, now = new Date()) {
  const current = now.toISOString().slice(0, 10);
  if (now.getUTCDate() >= 3) {
    const end = `${current.slice(0, 7)}-01`;
    const previous = new Date(`${end}T00:00:00Z`); previous.setUTCMonth(previous.getUTCMonth() - 1);
    const start = previous.toISOString().slice(0, 10);
    const { results } = await db.prepare(`SELECT o.* FROM observations o JOIN
      (SELECT installation_id, application_instance_id, max(observed_at) AS latest FROM observations
       WHERE observed_at >= ? AND observed_at < ? GROUP BY installation_id, application_instance_id) latest
      ON o.installation_id = latest.installation_id AND o.application_instance_id = latest.application_instance_id
      AND o.observed_at = latest.latest`).bind(start, end).all();
    await db.prepare('INSERT OR IGNORE INTO public_statistics VALUES (?, ?, ?)')
      .bind(start, current, JSON.stringify(publicStatistics(results, start))).run();
  }
}
