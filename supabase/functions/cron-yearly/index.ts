/**
 * cron-yearly — runs on the 1st of each month at 02:00 UTC
 * 1. FusionSolar yearly KPIs (getKpiStationYear) → station_kpi_year
 * 2. Cleanup refresh_log rows older than 90 days
 */
import {
  STATIONS, CALL_DELAY, sleep,
  FusionSolarClient, loadFusionSolarEnv, getStationKpiYear,
  upsertFusionSolarKpiYear, cleanupRefreshLog, logRefresh,
} from './_shared/index.ts';

Deno.serve(async (_req: Request) => {
  const startedAt = new Date();
  const codes     = STATIONS.map(s => s.code);

  // ── FusionSolar yearly KPIs ─────────────────────────────────────────────────
  let fsResult: { ok: number; errors: number } | null = null;
  try {
    const { username, password, baseUrl } = loadFusionSolarEnv();
    const client = new FusionSolarClient(username, password, baseUrl);
    await client.login();
    await sleep(CALL_DELAY * 2);

    const records = await getStationKpiYear(client, codes);
    await upsertFusionSolarKpiYear(records);
    fsResult = { ok: records.length, errors: 0 };
    await logRefresh({ source: 'fusionsolar', jobType: 'yearly', stationsOk: records.length, stationsError: 0, startedAt });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error('FusionSolar yearly job failed:', detail);
    fsResult = { ok: 0, errors: STATIONS.length };
    await logRefresh({ source: 'fusionsolar', jobType: 'yearly', stationsOk: 0, stationsError: STATIONS.length, errorDetail: detail, startedAt });
  }

  // ── Cleanup old refresh_log rows ────────────────────────────────────────────
  let cleanupResult: { deleted: number } | null = null;
  try {
    cleanupResult = await cleanupRefreshLog(90);
  } catch (err) {
    console.error('Cleanup job failed:', err instanceof Error ? err.message : String(err));
  }

  return new Response(JSON.stringify({ ok: true, fusionsolar: fsResult, cleanup: cleanupResult }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
