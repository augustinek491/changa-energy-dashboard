/**
 * cron-daily — runs every hour
 * 1. FusionSolar daily KPIs (getKpiStationDay) → station_kpi_day
 * 2. FusionSolar hourly readings for today + yesterday → station_readings
 * 3. LIVOLTEK daily KPIs (derived from live data) → station_kpi_day
 */
import {
  STATIONS, CALL_DELAY, sleep,
  FusionSolarClient, loadFusionSolarEnv,
  getStationKpiDay, getStationKpiHour,
  LivoltkClient, loadLivoltkEnv, getAllSitesLive,
  upsertFusionSolarKpiDay, upsertFusionSolarHourlyReadings,
  upsertLivoltkKpiDay, logRefresh,
  ALL_SITE_IDS, getStationIdMap,
  getLivoltkSiteIntraday, upsertLivoltkIntradayReadings,
} from './_shared/index.ts';

Deno.serve(async (_req: Request) => {
  const startedAt = new Date();
  const today     = new Date().toISOString().slice(0, 10);
  const codes     = STATIONS.map(s => s.code);

  let fsResult = { ok: 0, errors: 0 };
  let lvResult = { ok: 0, errors: 0 };

  // ── FusionSolar daily KPIs ──────────────────────────────────────────────────
  try {
    const { username, password, baseUrl } = loadFusionSolarEnv();
    const client = new FusionSolarClient(username, password, baseUrl);
    await client.login();
    await sleep(CALL_DELAY * 2);

    // Daily KPIs
    const dayRecords = await getStationKpiDay(client, codes);
    await upsertFusionSolarKpiDay(dayRecords);
    fsResult = { ok: dayRecords.length, errors: 0 };
    await logRefresh({ source: 'fusionsolar', jobType: 'daily', stationsOk: dayRecords.length, stationsError: 0, startedAt });

    // Hourly readings: today + yesterday (seamless midnight transition)
    await sleep(CALL_DELAY);
    for (const date of [new Date(), new Date(Date.now() - 86_400_000)]) {
      const hourRecords = await getStationKpiHour(client, codes, date);
      if (hourRecords.length > 0) await upsertFusionSolarHourlyReadings(hourRecords);
      await sleep(CALL_DELAY);
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error('FusionSolar daily job failed:', detail);
    fsResult = { ok: 0, errors: STATIONS.length };
    await logRefresh({ source: 'fusionsolar', jobType: 'daily', stationsOk: 0, stationsError: STATIONS.length, errorDetail: detail, startedAt });
  }

  // ── LIVOLTEK daily KPIs (derived from live data) ────────────────────────────
  try {
    const { email, password, accountType } = loadLivoltkEnv();
    const client  = new LivoltkClient(email, password, accountType);
    const loginOk = await client.login();
    if (!loginOk) throw new Error('LIVOLTEK login failed');

    const sites  = await getAllSitesLive(client);
    await upsertLivoltkKpiDay(sites, today);
    const ok     = sites.filter(s => !s._error).length;
    const errors = sites.filter(s =>  s._error).length;
    lvResult = { ok, errors };
    await logRefresh({ source: 'livoltek', jobType: 'daily', stationsOk: ok, stationsError: errors, startedAt });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error('LIVOLTEK daily job failed:', detail);
    lvResult = { ok: 0, errors: 16 };
    await logRefresh({ source: 'livoltek', jobType: 'daily', stationsOk: 0, stationsError: 16, errorDetail: detail, startedAt });
  }

  // ── LIVOLTEK intraday self-heal (operator token, full day upsert) ────────────
  // Heals today AND yesterday on every hourly run so any readings missed by
  // cron-live (gaps, cold starts, overnight downtime) are automatically filled.
  let intradayResult = { ok: 0, errors: 0, points: 0 };
  try {
    const { email, password } = loadLivoltkEnv();
    const opClient = new LivoltkClient(email, password, 'operator');
    const loginOk  = await opClient.login();
    if (!loginOk) throw new Error('LIVOLTEK operator login failed');

    const idMap = await getStationIdMap('livoltek');

    // Heal today + yesterday (Johannesburg local dates, UTC+2)
    const joburgNow = new Date(Date.now() + 2 * 60 * 60 * 1000);
    const healDates = [
      joburgNow.toISOString().slice(0, 10),
      new Date(joburgNow.getTime() - 86_400_000).toISOString().slice(0, 10),
    ];

    for (const healDate of healDates) {
      for (const siteId of ALL_SITE_IDS) {
        const stationId = idMap.get(String(siteId));
        if (!stationId) continue;
        try {
          const data   = await getLivoltkSiteIntraday(opClient, siteId, healDate);
          const points = await upsertLivoltkIntradayReadings(stationId, data);
          intradayResult.ok++;
          intradayResult.points += points;
        } catch (err) {
          console.error(`Intraday failed siteId=${siteId} date=${healDate}:`, err instanceof Error ? err.message : String(err));
          intradayResult.errors++;
        }
        await sleep(250); // 250ms — portal rate limit is lenient for historical queries
      }
    }

    await logRefresh({
      source: 'livoltek', jobType: 'intraday',
      stationsOk: intradayResult.ok, stationsError: intradayResult.errors,
      startedAt,
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error('LIVOLTEK intraday job failed:', detail);
    await logRefresh({
      source: 'livoltek', jobType: 'intraday',
      stationsOk: 0, stationsError: ALL_SITE_IDS.length,
      errorDetail: detail, startedAt,
    });
  }

  return new Response(JSON.stringify({ ok: true, fusionsolar: fsResult, livoltek: lvResult, livoltek_intraday: intradayResult }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
