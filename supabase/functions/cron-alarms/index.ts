/**
 * cron-alarms — runs every 5 minutes
 * Fetches active LIVOLTEK alarms, upserts new ones and marks resolved ones.
 *
 * NOTE: FusionSolar alarms are NOT fetched here. Huawei IP-blocks Supabase, so
 * FusionSolar alarm fetching now runs in the GitHub Actions worker
 * (scripts/fusionsolar-worker.ts, live mode). Do not add FusionSolar calls back
 * into this function — they will always fail with the disguised 20400 IP-block.
 */
import {
  LivoltkClient, loadLivoltkEnv, getLvAlarms,
  upsertLivoltkAlarms, syncResolvedAlarms,
  getStationNameMap, logRefresh,
} from './_shared/index.ts';

Deno.serve(async (_req: Request) => {
  const startedAt = new Date();
  let livoltek: { alarms: number; resolved: number } | null = null;

  // ── LIVOLTEK alarms ─────────────────────────────────────────────────────────
  try {
    const { email, password, accountType } = loadLivoltkEnv();
    const client = new LivoltkClient(email, password, accountType);
    const alarms = await getLvAlarms(client, 1);

    const nameMap  = await getStationNameMap('livoltek');
    await upsertLivoltkAlarms(alarms, nameMap);

    const activeIds = alarms.map(a => `${a.alarmCode}_${a.originTimeString}`);
    await syncResolvedAlarms('livoltek', activeIds);

    livoltek = { alarms: alarms.length, resolved: 0 };
    await logRefresh({ source: 'livoltek', jobType: 'alarms', stationsOk: alarms.length, stationsError: 0, startedAt });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error('LIVOLTEK alarms job failed:', detail);
    await logRefresh({ source: 'livoltek', jobType: 'alarms', stationsOk: 0, stationsError: 0, errorDetail: detail, startedAt });
  }

  return new Response(JSON.stringify({ ok: true, livoltek }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
