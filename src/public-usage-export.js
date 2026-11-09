import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import schema from '../protocol/public-usage-v1.schema.json' with { type: 'json' };
import { isUtcMonday, latestCompleteWeek, shiftUtcDay } from './weeks.js';

const ajv = new Ajv({ strict: true });
addFormats(ajv);
const validateSnapshot = ajv.compile(schema);
const validateWeek = ajv.getSchema(`${schema.$id}#/definitions/week`);
const WEEKS = 12;

export function buildPublicUsageSnapshot(input, now = new Date()) {
  if (!Array.isArray(input) || input.length !== 1 || input[0]?.success !== true || !Array.isArray(input[0].results)) {
    throw new Error('Expected one successful Wrangler JSON query result');
  }
  const rows = input[0].results;
  if (rows.length > WEEKS) throw new Error('Public week query returned too many rows');

  const latest = latestCompleteWeek(now);
  const byWeek = new Map();
  for (const row of rows) {
    if (!row || Object.keys(row).length !== 2 || !isUtcMonday(row.week_start)
      || row.week_start > latest || typeof row.statistics_json !== 'string' || byWeek.has(row.week_start)) {
      throw new Error('Invalid, future or duplicate stored public week');
    }
    let week;
    try { week = JSON.parse(row.statistics_json); }
    catch { throw new Error('Stored public week is not valid JSON'); }
    if (!validateWeek(week) || week.week_start !== row.week_start || week.status === 'missing') {
      throw new Error('Stored public week does not match the public usage schema');
    }
    byWeek.set(row.week_start, week);
  }

  const weeks = Array.from({ length: WEEKS }, (_, index) => {
    const week_start = shiftUtcDay(latest, -7 * (WEEKS - 1 - index));
    return byWeek.get(week_start) ?? { week_start, status: 'missing' };
  });
  if (weeks.every(week => week.status === 'missing')) throw new Error('No materialised weeks in the current export window');
  if (!byWeek.has(latest)) throw new Error('Latest closed week has not been materialised');

  const snapshot = {
    schema_version: 1,
    observation_schema_version: 1,
    generated_at: now.toISOString(),
    latest_complete_week: latest,
    method: 'latest-per-instance-utc-iso-week-rounded-10-min-20-installations',
    weeks
  };
  if (!validateSnapshot(snapshot)) throw new Error('Snapshot does not match the public usage schema');
  return snapshot;
}
