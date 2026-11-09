import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import schema from '../protocol/v1.schema.json' with { type: 'json' };
const ajv = new Ajv({ strict: true, allErrors: false });
addFormats(ajv);
const validate = ajv.compile(schema);
export const BODY_LIMIT = 16 * 1024;
export function validObservation(value, now = new Date()) {
  if (!validate(value)) return false;
  const today = now.toISOString().slice(0, 10);
  const yesterday = new Date(now.getTime() - 86400000).toISOString().slice(0, 10);
  return value.observed_at === today || value.observed_at === yesterday;
}
export function snapshot(event) {
  const { installation_id, application_instance_id, observed_at, ...values } = event;
  return JSON.stringify(values);
}
export function periodStarts(day) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
  return { week: date.toISOString().slice(0, 10), month: `${day.slice(0, 7)}-01` };
}
export async function boundedJson(request) {
  if (!request.body) throw new Error('invalid');
  const reader = request.body.getReader();
  const chunks = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > BODY_LIMIT) { await reader.cancel(); throw new Error('oversize'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}
