/**
 * cron-monthly — runs daily at midnight UTC
 * 1. FusionSolar monthly KPIs (getKpiStationMonth) → station_kpi_month
 * 2. LIVOLTEK monthly KPIs (derived from live data) → station_kpi_month
 */
import {
  STATIONS, CALL_DELAY, sleep,
  FusionSolarClient, loadFusionSolarEnv, getStationKpiMonth,
  LivoltkClient, loadLivoltkEnv, getAllSitesLive,
  upsertFusionSolarKpiMonth, upsertLivoltkKpiMonth, logRefresh,
} from './_shared/index.ts';

Deno.serve(async (_req: Request) => {
  const startedAt  = new Date();
  const yearMonth  = new Date().toISOString().slice(0, 7); // "YYYY-MM"
  const codes      = STATIONS.map(s => s.code);

  let fsResult = { ok: 0, errors: 0 };
  let lvResult = { ok: 0, errors: 0 };

  // ── FusionSolar monthly KPIs ────────────────────────────────────────────────
  try {
    const { username, password, baseUrl } = loadFusionSolarEnv();
    const client = new FusionSolarClient(username, password, baseUrl);
    await client.login();
    await sleep(CALL_DELAY * 2);

    const records = await getStationKpiMonth(client, codes);
    await upsertFusionSolarKpiMonth(records);
    fsResult = { ok: records.length, errors: 0 };
    await logRefresh({ source: 'fusionsolar', jobType: 'monthly', stationsOk: records.length, stationsError: 0, startedAt });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error('FusionSolar monthly job failed:', detail);
    fsResult = { ok: 0, errors: STATIONS.length };
    await logRefresh({ source: 'fusionsolar', jobType: 'monthly', stationsOk: 0, stationsError: STATIONS.length, errorDetail: detail, startedAt });
  }

  // ── LIVOLTEK monthly KPIs (derived from live data) ──────────────────────────
  try {
    const { email, password, accountType } = loadLivoltkEnv();
    const client  = new LivoltkClient(email, password, accountType);
    const loginOk = await client.login();
    if (!loginOk) throw new Error('LIVOLTEK login failed');

    const sites  = await getAllSitesLive(client);
    await upsertLivoltkKpiMonth(sites, yearMonth);
    const ok     = sites.filter(s => !s._error).length;
    const errors = sites.filter(s =>  s._error).length;
    lvResult = { ok, errors };
    await logRefresh({ source: 'livoltek', jobType: 'monthly', stationsOk: ok, stationsError: errors, startedAt });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error('LIVOLTEK monthly job failed:', detail);
    lvResult = { ok: 0, errors: 16 };
    await logRefresh({ source: 'livoltek', jobType: 'monthly', stationsOk: 0, stationsError: 16, errorDetail: detail, startedAt });
  }

  return new Response(JSON.stringify({ ok: true, fusionsolar: fsResult, livoltek: lvResult }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
