/**
 * scripts/fusionsolar-cron.ts
 *
 * Standalone FusionSolar live-data fetcher.
 * Called directly by GitHub Actions — bypasses Vercel entirely.
 * Huawei's API is reachable from GitHub-hosted runners (Azure IPs).
 *
 * Usage:
 *   npx tsx scripts/fusionsolar-cron.ts --batch 0
 *
 * Required env vars:
 *   FUSIONSOLAR_USERNAME, FUSIONSOLAR_PASSWORD
 *   FUSIONSOLAR_BASE_URL  (optional, defaults to intl.fusionsolar.huawei.com)
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

import {
  FusionSolarClient,
  loadFusionSolarEnv,
  STATIONS,
  CALL_DELAY,
  fetchDashboardData,
} from '../lib/fusionsolar';
import { upsertFusionSolarLive, logRefresh } from '../lib/db';

const batchArg   = process.argv.indexOf('--batch');
const batchIndex = batchArg >= 0 ? parseInt(process.argv[batchArg + 1] ?? '0', 10) : 0;
const BATCH_SIZE = 2;

const batchStart    = batchIndex * BATCH_SIZE;
const batchStations = STATIONS.slice(batchStart, batchStart + BATCH_SIZE);

if (batchStations.length === 0) {
  console.log(`Batch ${batchIndex} is out of range (${STATIONS.length} plants, batch size ${BATCH_SIZE}) — nothing to do.`);
  process.exit(0);
}

console.log(`FusionSolar cron — batch ${batchIndex}: ${batchStations.map(s => s.name).join(', ')}`);

const startedAt = new Date();

try {
  const { username, password, baseUrl } = loadFusionSolarEnv();
  const client = new FusionSolarClient(username, password, baseUrl);

  const loginOk = await client.login();
  if (!loginOk) throw new Error('FusionSolar login failed');
  await client.sleep(CALL_DELAY * 2);

  const data  = await fetchDashboardData(client, batchStations);
  const items = data.map((record, i) => ({ stationCode: batchStations[i].code, record }));
  const r     = await upsertFusionSolarLive(items);

  await logRefresh({
    source:        'fusionsolar',
    jobType:       'live',
    stationsOk:    r.ok,
    stationsError: r.errors,
    startedAt,
  });

  console.log(`Done — ok: ${r.ok}, errors: ${r.errors}`);
  process.exit(0);
} catch (err) {
  const cause  = err instanceof Error && (err as NodeJS.ErrnoException).cause;
  const detail = err instanceof Error
    ? `${err.message}${cause ? ` | cause: ${cause}` : ''}`
    : String(err);

  console.error(`FusionSolar cron failed: ${detail}`);

  await logRefresh({
    source:        'fusionsolar',
    jobType:       'live',
    stationsOk:    0,
    stationsError: batchStations.length,
    errorDetail:   detail,
    startedAt,
  }).catch(() => {});

  process.exit(1);
}
