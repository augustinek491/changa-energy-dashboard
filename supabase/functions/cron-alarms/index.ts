/**
 * cron-alarms — runs every 5 minutes
 * Fetches active alarms from FusionSolar and LIVOLTEK,
 * upserts new alarms and marks resolved ones.
 */
import {
  STATIONS, CALL_DELAY, sleep,
  FusionSolarClient, loadFusionSolarEnv, getFsAlarms,
  LivoltkClient, loadLivoltkEnv, getLvAlarms,
  upsertFusionSolarAlarms, upsertLivoltkAlarms,
  syncResolvedAlarms, getStationNameMap, logRefresh,
} from './_shared/index.ts';

Deno.serve(async (_req: Request) => {
  const startedAt = new Date();
  const results: {
    fusionsolar: { alarms: number; resolved: number } | null;
    livoltek:    { alarms: number; resolved: number } | null;
  } = { fusionsolar: null, livoltek: null };

  // ── FusionSolar alarms ──────────────────────────────────────────────────────
  try {
    const { username, password, baseUrl } = loadFusionSolarEnv();
    const client = new FusionSolarClient(username, password, baseUrl);
    await client.login();
    await sleep(CALL_DELAY * 2);

    const codes  = STATIONS.map(s => s.code);
    const alarms = await getFsAlarms(client, codes);
    await upsertFusionSolarAlarms(alarms);
    await syncResolvedAlarms('fusionsolar', alarms.map(a => String(a.alarmId)));

    results.fusionsolar = { alarms: alarms.length, resolved: 0 };
    await logRefresh({ source: 'fusionsolar', jobType: 'alarms', stationsOk: alarms.length, stationsError: 0, startedAt });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error('FusionSolar alarms job failed:', detail);
    await logRefresh({ source: 'fusionsolar', jobType: 'alarms', stationsOk: 0, stationsError: 0, errorDetail: detail, startedAt });
  }

  // ── LIVOLTEK alarms ─────────────────────────────────────────────────────────
  try {
    const { email, password, accountType } = loadLivoltkEnv();
    const client = new LivoltkClient(email, password, accountType);
    const alarms = await getLvAlarms(client, 1);

    const nameMap  = await getStationNameMap('livoltek');
    await upsertLivoltkAlarms(alarms, nameMap);

    const activeIds = alarms.map(a => `${a.alarmCode}_${a.originTimeString}`);
    await syncResolvedAlarms('livoltek', activeIds);

    results.livoltek = { alarms: alarms.length, resolved: 0 };
    await logRefresh({ source: 'livoltek', jobType: 'alarms', stationsOk: alarms.length, stationsError: 0, startedAt });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error('LIVOLTEK alarms job failed:', detail);
    await logRefresh({ source: 'livoltek', jobType: 'alarms', stationsOk: 0, stationsError: 0, errorDetail: detail, startedAt });
  }

  return new Response(JSON.stringify({ ok: true, ...results }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
