import { boundedJson, validObservation } from './protocol.js';
import { ingest } from './store.js';
import { aggregate } from './aggregate.js';
const response = status => new Response(null, { status, headers: { 'cache-control': 'no-store' } });
export function createWorker(clock = () => new Date()) {
  return {
    async fetch(request, env) {
      const url = new URL(request.url);
      if (url.pathname !== '/api/census/v1/observations' || url.search) return response(404);
      if (request.method !== 'POST') return response(405);
      if (env.INGESTION_ENABLED !== 'true') return response(503);
      if (!env.CENSUS_DB || !env.IP_LIMITER || !env.IP_RATE_KEY) return response(503);
      if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return response(415);
      const now = clock();
      try {
        const ip = request.headers.get('CF-Connecting-IP') ?? 'unavailable';
        const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.IP_RATE_KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
        const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${now.toISOString().slice(0, 13)}|${ip}`));
        const rateKey = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
        if (!(await env.IP_LIMITER.limit({ key: rateKey })).success) return response(429);
      } catch { return response(503); }
      let event;
      try { event = await boundedJson(request); } catch (error) { return response(error.message === 'oversize' ? 413 : 400); }
      if (!validObservation(event, now)) return response(400);
      try { return response(await ingest(env.CENSUS_DB, event, now.toISOString().slice(0, 10))); }
      catch { return response(503); }
    },
    async scheduled(_event, env) {
      if (env.CENSUS_DB) await aggregate(env.CENSUS_DB, clock());
    }
  };
}
export default createWorker();
