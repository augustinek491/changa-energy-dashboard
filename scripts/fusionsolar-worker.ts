/**
 * scripts/fusionsolar-worker.ts
 *
 * Unified FusionSolar background worker — runs on GitHub Actions only.
 * GitHub-hosted runners (Azure IPs) are the ONLY environment Huawei does not
 * IP-block. Vercel and Supabase both receive a disguised 20400 "invalid
 * credentials" response that is actually an IP block.
 *
 * Uses ONLY batched Northbound endpoints (all stations in one call each) — no
 * per-device calls. This makes a full fleet sweep cost ~2-3 API calls total,
 * independent of fleet size, so it scales cleanly to 50-150+ sites.
 *
 *   getStationRealKpi   → day/month/total kWh + health        (live totals)
 *   getKpiStationHour   → 24 hourly PV-yield points / station  (the curve)
 *   getKpiStationDay    → daily PV yield / station             (daily bars)
 *
 * Modes:
 *   --mode live    Fast snapshot. Station totals + health → station_live.
 *                  Today's hourly curve → station_readings. Runs every ~30 min
 *                  during daylight. pv_power_kw is estimated from the latest
 *                  non-null hourly point so the live card isn't blank.
 *
 *   --mode rollup  Self-healing backfill. Re-fetches the FULL hourly curve and
 *                  daily totals for today AND yesterday, so any gaps from missed
 *                  live runs are repaired and yesterday's final figure lands once
 *                  the day closes. Runs 2x/day.
 *
 * Usage:
 *   npx tsx scripts/fusionsolar-worker.ts --mode live
 *   npx tsx scripts/fusionsolar-worker.ts --mode rollup
 *
 * Required env: FUSIONSOLAR_USERNAME, FUSIONSOLAR_PASSWORD,
 *               NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 * Optional env: FUSIONSOLAR_BASE_URL
 */

import {
  FusionSolarClient,
  loadFusionSolarEnv,
  STATIONS,
  CALL_DELAY,
  getStationRealKpis,
  getStationKpiHour,
  getStationKpiDay,
  getAlarms,
} from '../lib/fusionsolar';
import {
  upsertFusionSolarLiveKpi,
  upsertFusionSolarHourlyReadings,
  upsertFusionSolarKpiDay,
  upsertFusionSolarAlarms,
  syncResolvedAlarms,
  logRefresh,
} from '../lib/db';
import type { StationKpiHourRecord } from '../lib/types';

/** Max station codes per batched call — Huawei caps getStation* at 100. */
const CHUNK = 100;

const modeArg = process.argv.indexOf('--mode');
const MODE = (modeArg >= 0 ? process.argv[modeArg + 1] : 'live') as 'live' | 'rollup';

const ALL_CODES = STATIONS.map(s => s.code);

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** Fetch hourly curve for a calendar day across all stations, chunked + paced. */
async function fetchHourly(client: FusionSolarClient, date: Date): Promise<StationKpiHourRecord[]> {
  const all: StationKpiHourRecord[] = [];
  for (const codes of chunk(ALL_CODES, CHUNK)) {
    all.push(...await getStationKpiHour(client, codes, new Date(date)));
    await client.sleep(CALL_DELAY);
  }
  return all;
}

async function runLive(client: FusionSolarClient) {
  // 1. Station totals + health (one batched call per 100 stations)
  const kpiMap = new Map<string, { day_power?: number; month_power?: number; total_power?: number; real_health_state?: number }>();
  for (const codes of chunk(ALL_CODES, CHUNK)) {
    const m = await getStationRealKpis(client, codes);
    for (const [k, v] of m) kpiMap.set(k, v);
    await client.sleep(CALL_DELAY);
  }

  // 2. Today's hourly curve — also gives us a current-power estimate
  const today = new Date();
  const hourly = await fetchHourly(client, today);

  // Latest non-null hourly inverterPower per station ≈ current kW
  const latestPower = new Map<string, number>();
  for (const r of hourly) {
    if (r.inverterPower != null) latestPower.set(r.stationCode, r.inverterPower);
  }

  // 3. Write live snapshot
  const items = ALL_CODES.map(code => {
    const k = kpiMap.get(code) ?? {};
    return {
      stationCode: code,
      pvPowerKw:   latestPower.get(code) ?? null,
      today:       k.day_power ?? null,
      month:       k.month_power ?? null,
      total:       k.total_power ?? null,
      health:      k.real_health_state ?? null,
    };
  });
  const live = await upsertFusionSolarLiveKpi(items);

  // 4. Write today's curve into station_readings
  const hr = await upsertFusionSolarHourlyReadings(hourly);

  // 5. Active alarms. Moved here from the Supabase cron-alarms function, which
  //    can never reach Huawei (IP-blocked, disguised 20400). Non-fatal: an alarm
  //    fetch failure must not sink the live snapshot above.
  let alarmCount = 0;
  try {
    await client.sleep(CALL_DELAY);
    const alarms = await getAlarms(client, ALL_CODES);
    await upsertFusionSolarAlarms(alarms);
    await syncResolvedAlarms('fusionsolar', alarms.map(a => String(a.alarmId)));
    alarmCount = alarms.length;
  } catch (err) {
    console.error('FusionSolar alarms fetch failed (non-fatal):', err instanceof Error ? err.message : String(err));
  }

  console.log(`live — station_live ok:${live.ok} err:${live.errors} | hourly written:${hr.written} skipped:${hr.skipped} | alarms:${alarmCount}`);
  return { ok: live.ok, errors: live.errors };
}

async function runRollup(client: FusionSolarClient) {
  const today = new Date();
  const yesterday = new Date(Date.now() - 86400000);

  let hourlyWritten = 0;
  let dayRows = 0;

  for (const date of [yesterday, today]) {
    // Hourly curve (self-healing — re-fetches the whole day)
    const hourly = await fetchHourly(client, date);
    const hr = await upsertFusionSolarHourlyReadings(hourly);
    hourlyWritten += hr.written;

    // Daily totals
    const dayRecords = [];
    for (const codes of chunk(ALL_CODES, CHUNK)) {
      dayRecords.push(...await getStationKpiDay(client, codes, new Date(date)));
      await client.sleep(CALL_DELAY);
    }
    await upsertFusionSolarKpiDay(dayRecords);
    dayRows += dayRecords.length;
  }

  console.log(`rollup — hourly written:${hourlyWritten} | kpi_day rows:${dayRows}`);
  return { ok: STATIONS.length, errors: 0 };
}

async function main() {
  if (MODE !== 'live' && MODE !== 'rollup') {
    throw new Error(`Unknown --mode "${MODE}" (expected "live" or "rollup")`);
  }

  console.log(`FusionSolar worker — mode=${MODE} — ${STATIONS.length} plants`);
  const startedAt = new Date();

  try {
    const { username, password, baseUrl } = loadFusionSolarEnv();
    const client = new FusionSolarClient(username, password, baseUrl);

    const loginOk = await client.login();
    if (!loginOk) throw new Error('FusionSolar login failed');
    await client.sleep(CALL_DELAY * 2);

    const r = MODE === 'live' ? await runLive(client) : await runRollup(client);

    await logRefresh({
      source:        'fusionsolar',
      jobType:       MODE,
      stationsOk:    r.ok,
      stationsError: r.errors,
      startedAt,
    });

    console.log(`Done — ok:${r.ok} errors:${r.errors}`);
  } catch (err) {
    const cause  = err instanceof Error && (err as NodeJS.ErrnoException).cause;
    const detail = err instanceof Error
      ? `${err.message}${cause ? ` | cause: ${cause}` : ''}`
      : String(err);

    console.error(`FusionSolar worker failed: ${detail}`);

    await logRefresh({
      source:        'fusionsolar',
      jobType:       MODE,
      stationsOk:    0,
      stationsError: STATIONS.length,
      errorDetail:   detail,
      startedAt,
    }).catch(() => {});

    process.exit(1);
  }
}

main();
