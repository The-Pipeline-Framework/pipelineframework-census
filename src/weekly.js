import { publicStatistics } from './aggregate.js';
import { isUtcMonday, latestCompleteWeek, shiftUtcDay } from './weeks.js';

const OBSERVATION_LIMIT = 5000;

export async function aggregateWeekly(db, now, firstMonday) {
  if (firstMonday === undefined || firstMonday === '') return;
  if (!isUtcMonday(firstMonday)) throw new Error('PUBLIC_WEEKLY_FIRST_MONDAY must be a UTC Monday');

  const week_start = latestCompleteWeek(now);
  if (week_start < firstMonday) return;
  const existing = await db.prepare('SELECT 1 FROM public_weekly_statistics WHERE week_start = ?').bind(week_start).first();
  if (existing) return;

  const { results } = await db.prepare(`SELECT installation_id, application_instance_id, observed_at, snapshot_json
    FROM observations WHERE observed_at >= ? AND observed_at < ? LIMIT ?`)
    .bind(week_start, shiftUtcDay(week_start, 7), OBSERVATION_LIMIT + 1).all();
  // The extra row distinguishes an exactly full sample from an incomplete one.
  if (results.length > OBSERVATION_LIMIT) throw new Error('Weekly statistics observation limit exceeded');
  if (results.length === 0) return;

  const latest = new Map();
  for (const row of results) {
    const key = `${row.installation_id}/${row.application_instance_id}`;
    const previous = latest.get(key);
    if (!previous || previous.observed_at < row.observed_at) latest.set(key, row);
  }

  const stats = publicStatistics([...latest.values()], week_start);
  const week = { week_start, status: stats.status };
  if (stats.status === 'published') {
    const bins = stats.distributions;
    week.reporting_installations = stats.reporting_installations;
    week.reporting_application_instances = stats.reporting_application_instances;
    week.distributions = {
      compiler_version: bins.compiler_version,
      contracts_version: bins.contracts_version,
      transport: bins.transport,
      platform: bins.platform,
      runtime_layout: bins.runtime_layout,
      java_major: bins.java_major,
      sizes: {
        pipelines: bins['sizes.pipelines'],
        steps: bins['sizes.steps'],
        types: bins['sizes.types'],
        blocks: bins['sizes.blocks']
      },
      feature_counts: {
        nested_invocation: bins['feature_counts.nested_invocation'],
        one_to_many: bins['feature_counts.one_to_many'],
        many_to_one: bins['feature_counts.many_to_one'],
        query: bins['feature_counts.query'],
        command: bins['feature_counts.command'],
        await: bins['feature_counts.await']
      }
    };
  }

  await db.prepare('INSERT OR IGNORE INTO public_weekly_statistics VALUES (?, ?, ?)')
    .bind(week_start, now.toISOString(), JSON.stringify(week)).run();
}
