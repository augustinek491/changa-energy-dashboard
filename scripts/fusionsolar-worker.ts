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
 *   --mode power   True real-time inverter power (getDevRealKpi, ~5-min fresh on
 *                  Huawei's side) → station_live.pv_power_kw ONLY. Runs every
 *                  5 min during daylight. This mode OWNS pv_power_kw; no other
 *                  mode writes it. Inverter IDs come from the fusionsolar_devices
 *                  cache (self-healing); the Huawei session token is shared via
 *                  fusionsolar_session so most sweeps skip login entirely.
 *
 *   --mode live    KPI snapshot. Station totals + health → station_live (NOT
 *                  pv_power_kw). Today's hourly curve → station_readings.
 *                  Alarms. Runs every 15 min daylight / hourly night.
 *
 *   --mode rollup  Self-healing backfill. Re-fetches the FULL hourly curve and
 *                  daily totals for today AND yesterday, so any gaps from missed
 *                  live runs are repaired and yesterday's final figure lands once
 *                  the day closes. Also refreshes monthly + yearly KPIs (absorbed
 *                  from the IP-blocked Supabase cron-monthly/cron-yearly edge
 *                  functions) and the device cache. Runs 2x/day.
 *                  Optional --dates YYYY-MM-DD[,YYYY-MM-DD...] overrides the
 *                  [yesterday, today] window to backfill exact days after an
 *                  outage (used by the fusionsolar-backfill workflow).
 *
 * Usage:
 *   npx tsx scripts/fusionsolar-worker.ts --mode power
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
  getStationKpiMonth,
  getStationKpiYear,
  getDevList,
  getAlarms,
} from '../lib/fusionsolar';
import {
  upsertFusionSolarLiveKpi,
  upsertFusionSolarHourlyReadings,
  upsertFusionSolarKpiDay,
  upsertFusionSolarKpiMonth,
  upsertFusionSolarKpiYear,
  upsertFusionSolarAlarms,
  syncResolvedAlarms,
  updateFusionSolarLivePower,
  getFusionSolarLivePower,
  getFusionSolarDeviceCache,
  saveFusionSolarDeviceCache,
  loadFusionSolarSession,
  saveFusionSolarSession,
  logRefresh,
} from '../lib/db';
import type { StationKpiHourRecord, DeviceRealKpi } from '../lib/types';

/** Max station codes per batched call — Huawei caps getStation* at 100. */
const CHUNK = 100;

/** Reuse a stored Huawei token while younger than this (tokens live ~30 min). */
const TOKEN_MAX_AGE_MIN = 25;

const modeArg = process.argv.indexOf('--mode');
const MODE = (modeArg >= 0 ? process.argv[modeArg + 1] : 'live') as 'live' | 'rollup' | 'power';

// Optional --dates 2026-06-29,2026-06-30 (rollup mode only): backfill these
// exact calendar days instead of the default [yesterday, today]. Used by the
// fusionsolar-backfill workflow to repair gaps after an outage.
const datesArg = process.argv.indexOf('--dates');
const DATES: Date[] | null = datesArg >= 0
  ? process.argv[datesArg + 1].split(',').map(s => {
      const t = s.trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) throw new Error(`--dates: bad date "${t}" (expected YYYY-MM-DD)`);
      return new Date(t + 'T12:00:00Z'); // noon UTC — safely inside the day in any TZ
    })
  : null;

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

// ── Shared Huawei session ────────────────────────────────────────────────────
// FusionSolarClient keeps its xsrf token TypeScript-private; the client file is
// reverse-engineered and must not be modified, so the worker reads/writes the
// token through a cast (TS-private is compile-time only). apiPost already
// captures rotated tokens from response headers into the same field.

function getToken(client: FusionSolarClient): string | null {
  return (client as unknown as { xsrfToken: string | null }).xsrfToken;
}

function setToken(client: FusionSolarClient, token: string): void {
  (client as unknown as { xsrfToken: string | null }).xsrfToken = token;
}

/** Login and persist the new token for other runs/jobs to reuse. */
async function freshLogin(client: FusionSolarClient): Promise<void> {
  // client.login() prints "Login failed: failCode=<n>" immediately before
  // returning false. Restate the likely meaning here so the diagnosis also
  // lands in refresh_log.error_detail (what the dashboard staleness alert
  // reads) instead of an opaque "login failed".
  if (!await client.login()) {
    throw new Error(
      'FusionSolar login rejected by Huawei (see the "Login failed: failCode=..." ' +
      'line logged just above for the exact code). Common causes — ' +
      '20003: Northbound API account / third-party system EXPIRED → renew its ' +
      'validity period in the FusionSolar Management System; ' +
      '20002: third-party system disabled; 306: wrong password; ' +
      '305: account locked (too many failed logins); 20400: IP blocked.',
    );
  }
  const t = getToken(client);
  if (t) await saveFusionSolarSession(t).catch(() => {}); // persistence is best-effort
  await client.sleep(CALL_DELAY * 2);
}

/** Adopt a stored session if it is fresh enough; otherwise login. */
async function ensureSession(client: FusionSolarClient): Promise<'reused' | 'fresh'> {
  const s = await loadFusionSolarSession().catch(() => null);
  if (s && Date.now() - s.obtainedAt.getTime() < TOKEN_MAX_AGE_MIN * 60_000) {
    setToken(client, s.token);
    return 'reused';
  }
  await freshLogin(client);
  return 'fresh';
}

// ── power mode ───────────────────────────────────────────────────────────────

/** Device cache, self-healing: populated via getDevList when empty. */
async function ensureDeviceCache(client: FusionSolarClient) {
  let devs = await getFusionSolarDeviceCache();
  if (devs.length) return devs;

  console.log('  device cache empty — fetching device lists');
  const fetched = [];
  for (const s of STATIONS) {
    fetched.push(...await getDevList(client, s.code));
    await client.sleep(CALL_DELAY);
  }
  await saveFusionSolarDeviceCache(fetched);
  devs = fetched.map(d => ({ dev_id: String(d.id), station_code: d.stationCode, dev_type_id: d.devTypeId }));
  if (!devs.length) throw new Error('getDevList returned no devices for any station');
  return devs;
}

type Inverter = { dev_id: string; station_code: string; dev_type_id: number };

/** One batched getDevRealKpi over the given inverters → summed active_power per
 *  station_code. Handles an expired-session relogin. A station whose inverters
 *  return no numeric active_power simply doesn't appear in the map (not 0). */
async function fetchInverterPower(client: FusionSolarClient, inverters: Inverter[]): Promise<Map<string, number>> {
  const byStation = new Map<string, number>();
  for (const group of chunk(inverters, 100)) {
    const devIds = group.map(d => d.dev_id).join(',');
    let res = await client.apiPost<Array<{ devId: number; dataItemMap: DeviceRealKpi }>>(
      'getDevRealKpi', { devIds, devTypeId: 1 },
    );

    // 305/401 = session no longer valid (stored token outlived Huawei's side).
    if (res.failCode === 305 || res.failCode === 401) {
      console.log(`  stored session rejected (failCode=${res.failCode}) — logging in fresh`);
      await freshLogin(client);
      res = await client.apiPost<Array<{ devId: number; dataItemMap: DeviceRealKpi }>>(
        'getDevRealKpi', { devIds, devTypeId: 1 },
      );
    }
    if (res.failCode !== 0 && res.failCode !== undefined) {
      throw new Error(`getDevRealKpi failCode=${res.failCode} ${res.message ?? ''}`);
    }

    const idToStation = new Map(group.map(d => [Number(d.dev_id), d.station_code]));
    for (const e of res.data ?? []) {
      const st = idToStation.get(e.devId);
      if (!st) continue;
      const p = e.dataItemMap?.active_power;
      if (p != null && !Number.isNaN(Number(p))) {
        byStation.set(st, (byStation.get(st) ?? 0) + Number(p));
      }
    }
    await client.sleep(CALL_DELAY);
  }
  return byStation;
}

/** Keep the previous reading rather than flicker to 0 when a healthy site misses
 *  a sweep — but only while it's this fresh, so a genuinely-down site still surfaces. */
const PRESERVE_MAX_AGE_MS = 30 * 60 * 1000;

async function runPower(client: FusionSolarClient) {
  const reuse = await ensureSession(client);
  console.log(`  session: ${reuse}`);

  const devices = await ensureDeviceCache(client);
  const inverters: Inverter[] = devices.filter(d => d.dev_type_id === 1);
  if (!inverters.length) throw new Error('Device cache holds no inverters (dev_type_id=1)');

  // First sweep over all inverters.
  const byStation = await fetchInverterPower(client, inverters);

  // Huawei's getDevRealKpi intermittently omits active_power for an inverter.
  // Retry once for just the stations that came back empty before giving up.
  let missing = ALL_CODES.filter(c => !byStation.has(c) && inverters.some(d => d.station_code === c));
  if (missing.length) {
    console.log(`  retrying ${missing.length} station(s) with no inverter reading: ${missing.join(', ')}`);
    await client.sleep(CALL_DELAY);
    const retry = await fetchInverterPower(client, inverters.filter(d => missing.includes(d.station_code)));
    for (const [st, kw] of retry) byStation.set(st, kw);
    missing = missing.filter(c => !byStation.has(c));
  }

  // Persist whatever token we hold now (apiPost may have rotated it).
  const t = getToken(client);
  if (t) await saveFusionSolarSession(t).catch(() => {});

  // Stations STILL without a reading: keep the last value if it's recent (don't
  // wipe a real reading with a transient blank); fall back to null only once it's
  // stale, so a genuinely-down site surfaces and the staleness alert can fire.
  const preserve = new Set<string>();
  if (missing.length) {
    const snap = await getFusionSolarLivePower().catch(() => new Map());
    const now = Date.now();
    for (const c of missing) {
      const s = snap.get(c);
      if (s && s.kw != null && s.fetchedAt && now - new Date(s.fetchedAt).getTime() < PRESERVE_MAX_AGE_MS) {
        preserve.add(c);
      }
    }
  }

  // Write real values + explicit null for stale-missing; skip preserved stations.
  const items = ALL_CODES
    .filter(c => !preserve.has(c))
    .map(c => ({ stationCode: c, powerKw: byStation.has(c) ? Math.round(byStation.get(c)! * 1000) / 1000 : null }));
  const r = await updateFusionSolarLivePower(items);

  const filled = ALL_CODES.filter(c => byStation.has(c)).length;
  console.log(`power — with-power:${filled}/${ALL_CODES.length} preserved:${preserve.size} | inverters:${inverters.length}`);
  return { ok: r.ok, errors: r.errors };
}

async function runLive(client: FusionSolarClient) {
  // 1. Station totals + health (one batched call per 100 stations)
  const kpiMap = new Map<string, { day_power?: number; month_power?: number; total_power?: number; real_health_state?: number }>();
  for (const codes of chunk(ALL_CODES, CHUNK)) {
    const m = await getStationRealKpis(client, codes);
    for (const [k, v] of m) kpiMap.set(k, v);
    await client.sleep(CALL_DELAY);
  }

  // 2. Today's hourly curve (energy per hour — the charts' canonical series).
  //    NOTE: live PV power is NOT derived here any more — the 5-min power job
  //    owns station_live.pv_power_kw (see runPower / updateFusionSolarLivePower).
  const today = new Date();
  const hourly = await fetchHourly(client, today);

  // 3. Write KPI snapshot (everything except pv_power_kw)
  const items = ALL_CODES.map(code => {
    const k = kpiMap.get(code) ?? {};
    return {
      stationCode: code,
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
  const days = DATES ?? [yesterday, today];
  if (DATES) console.log(`  backfill dates: ${DATES.map(d => d.toISOString().slice(0, 10)).join(', ')}`);

  let hourlyWritten = 0;
  let dayRows = 0;

  for (const date of days) {
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

  // Monthly + yearly KPIs. Absorbed from the Supabase cron-monthly/cron-yearly
  // edge functions, which can never reach Huawei (IP-blocked, disguised 20400) —
  // GitHub runners are the only unblocked path. Rollup runs 2×/day, ample for
  // month/year granularity. Logged as their own refresh_log entries so the
  // monthly/yearly log streams continue uninterrupted. Non-fatal.
  try {
    const mStart = new Date();
    await client.sleep(CALL_DELAY);
    const months = await getStationKpiMonth(client, ALL_CODES);
    await upsertFusionSolarKpiMonth(months);
    await logRefresh({ source: 'fusionsolar', jobType: 'monthly', stationsOk: months.length, stationsError: 0, startedAt: mStart });
    const yStart = new Date();
    await client.sleep(CALL_DELAY);
    const years = await getStationKpiYear(client, ALL_CODES);
    await upsertFusionSolarKpiYear(years);
    await logRefresh({ source: 'fusionsolar', jobType: 'yearly', stationsOk: years.length, stationsError: 0, startedAt: yStart });
    console.log(`rollup — kpi_month rows:${months.length} | kpi_year rows:${years.length}`);
  } catch (err) {
    console.error('rollup — month/year KPI refresh failed (non-fatal):', err instanceof Error ? err.message : String(err));
  }

  // Refresh the device cache so the power job survives inverter swaps.
  // Non-fatal: a cache refresh failure must not sink the rollup itself.
  try {
    const fetched = [];
    for (const s of STATIONS) {
      await client.sleep(CALL_DELAY);
      fetched.push(...await getDevList(client, s.code));
    }
    const saved = await saveFusionSolarDeviceCache(fetched);
    console.log(`rollup — device cache refreshed: ${saved} devices`);
  } catch (err) {
    console.error('rollup — device cache refresh failed (non-fatal):', err instanceof Error ? err.message : String(err));
  }

  console.log(`rollup — hourly written:${hourlyWritten} | kpi_day rows:${dayRows}`);
  return { ok: STATIONS.length, errors: 0 };
}

async function main() {
  if (MODE !== 'live' && MODE !== 'rollup' && MODE !== 'power') {
    throw new Error(`Unknown --mode "${MODE}" (expected "power", "live" or "rollup")`);
  }

  console.log(`FusionSolar worker — mode=${MODE} — ${STATIONS.length} plants`);
  const startedAt = new Date();

  try {
    const { username, password, baseUrl } = loadFusionSolarEnv();
    const client = new FusionSolarClient(username, password, baseUrl);

    // power mode manages its own session (reuses the stored token when fresh);
    // live/rollup login here and persist the token so power runs can adopt it.
    if (MODE !== 'power') {
      await freshLogin(client);
    }

    const r = MODE === 'power' ? await runPower(client)
            : MODE === 'live'  ? await runLive(client)
            :                    await runRollup(client);

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
