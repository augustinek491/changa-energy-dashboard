import { createClient } from '@supabase/supabase-js';
import type {
  StationDashboardRecord,
  SiteLive,
  StationKpiDayRecord,
  StationKpiHourRecord,
  StationKpiMonthRecord,
  StationKpiYearRecord,
  FusionSolarAlarm,
  Alarm,
} from '@/lib/types';

/** Round a Date down to the nearest 5-minute boundary (for consistent recorded_at slots). */
function to5MinSlot(d: Date): string {
  const ms = Math.floor(d.getTime() / (5 * 60 * 1000)) * (5 * 60 * 1000);
  return new Date(ms).toISOString();
}

/**
 * Snap a timestamp down to the top of its UTC hour. Returns null if unparseable.
 * Used as a write-side guard so FusionSolar only ever lands on-the-hour rows in
 * station_readings (the FusionSolar curve is hourly; sub-hour rows break the chart).
 */
function toHourSlot(input: string | Date): string | null {
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCMinutes(0, 0, 0);
  return d.toISOString();
}

/** Bulk-upsert rows into station_readings. Conflicts on (station_id, recorded_at) update the metrics. */
async function insertReadings(rows: Record<string, unknown>[]): Promise<void> {
  if (rows.length === 0) return;
  const supabase = getClient();
  const { error } = await supabase
    .from('station_readings')
    .upsert(rows, { onConflict: 'station_id,recorded_at' });
  if (error) throw new Error(`insertReadings: ${error.message}`);
}

function getClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false }, realtime: { params: { eventsPerSecond: -1 } } },
  );
}

/** Returns a Map<source_code, station_id> for the given source */
export async function getStationIdMap(
  source: 'fusionsolar' | 'livoltek',
): Promise<Map<string, string>> {
  const supabase = getClient();
  const { data, error } = await supabase
    .from('stations')
    .select('id, source_code')
    .eq('source', source);

  if (error) throw new Error(`getStationIdMap(${source}): ${error.message}`);

  const map = new Map<string, string>();
  for (const row of data ?? []) {
    map.set(String(row.source_code), String(row.id));
  }
  return map;
}

/**
 * Upsert live FusionSolar data.
 * Items must be in the same order as the STATIONS array — stationCode is required
 * because StationDashboardRecord doesn't carry it.
 */
export async function upsertFusionSolarLive(
  items: Array<{ stationCode: string; record: StationDashboardRecord }>,
): Promise<{ ok: number; errors: number }> {
  const supabase = getClient();
  const idMap = await getStationIdMap('fusionsolar');

  const rows: Record<string, unknown>[] = [];
  let errors = 0;

  for (const { stationCode, record } of items) {
    const stationId = idMap.get(stationCode);
    if (!stationId) { errors++; continue; }
    rows.push({
      station_id:       stationId,
      fetched_at:       new Date().toISOString(),
      pv_power_kw:      record.live,
      load_power_kw:    record.loadPower,
      grid_power_kw:    record.gridPower,
      battery_soc:      record.batterySOC,
      battery_power_kw: record.batteryPower,
      health_state:     record.health,
      status:           null,
      temperature_c:    record.temperature,
      irradiance_wm2:   record.irradiance,
      today_kwh:        record.day,
      month_kwh:        record.month,
      total_kwh:        record.total,
    });
  }

  if (rows.length > 0) {
    const { error } = await supabase
      .from('station_live')
      .upsert(rows, { onConflict: 'station_id' });
    if (error) throw new Error(`upsertFusionSolarLive: ${error.message}`);

    // GUARD: do NOT dual-write FusionSolar to station_readings here. This used to
    // insert a 5-min snapshot per run, which polluted the hourly FusionSolar curve
    // with sub-hour rows and broke the chart line. The canonical FusionSolar
    // time-series is the hourly curve from upsertFusionSolarHourlyReadings; live KPI
    // now flows through upsertFusionSolarLiveKpi (station_live only). This function
    // is retained for station_live writes only and must never touch station_readings.
  }

  return { ok: rows.length, errors };
}

/**
 * Upsert live FusionSolar data from the BATCHED station-KPI endpoint only.
 * Used by the GitHub Actions worker — no per-device calls, so power data
 * (load/grid/battery/temperature/irradiance) is unavailable. pv_power_kw is an
 * estimate derived from the most recent non-null hourly reading.
 *
 * Unlike upsertFusionSolarLive, this does NOT dual-write to station_readings:
 * the canonical FusionSolar time-series is the hourly curve written by
 * upsertFusionSolarHourlyReadings. Mixing 5-min snapshots with hourly points
 * would corrupt the chart's granularity detection.
 */
export async function upsertFusionSolarLiveKpi(
  items: Array<{
    stationCode: string;
    today: number | null;
    month: number | null;
    total: number | null;
    health: number | null;
  }>,
): Promise<{ ok: number; errors: number }> {
  const supabase = getClient();
  const idMap = await getStationIdMap('fusionsolar');

  const rows: Record<string, unknown>[] = [];
  let errors = 0;

  for (const it of items) {
    const stationId = idMap.get(it.stationCode);
    if (!stationId) { errors++; continue; }
    // pv_power_kw is deliberately NOT written here — the 5-minute power job
    // (worker --mode power) owns that column. Writing it from this upsert would
    // overwrite fresh real-time kW with a stale hourly-curve estimate (or null).
    rows.push({
      station_id:       stationId,
      fetched_at:       new Date().toISOString(),
      load_power_kw:    null,
      grid_power_kw:    null,
      battery_soc:      null,
      battery_power_kw: null,
      health_state:     it.health,
      status:           null,
      temperature_c:    null,
      irradiance_wm2:   null,
      today_kwh:        it.today,
      month_kwh:        it.month,
      total_kwh:        it.total,
    });
  }

  if (rows.length > 0) {
    const { error } = await supabase
      .from('station_live')
      .upsert(rows, { onConflict: 'station_id' });
    if (error) throw new Error(`upsertFusionSolarLiveKpi: ${error.message}`);
  }

  return { ok: rows.length, errors };
}

/**
 * Write ONLY live PV power for FusionSolar stations — the 5-minute power job's
 * single write. Partial upsert: untouched columns (today/month/total, health,
 * curve data) keep whatever the 15-minute KPI job last wrote.
 */
export async function updateFusionSolarLivePower(
  items: Array<{ stationCode: string; powerKw: number | null }>,
): Promise<{ ok: number; errors: number }> {
  const supabase = getClient();
  const idMap = await getStationIdMap('fusionsolar');

  const rows: Record<string, unknown>[] = [];
  let errors = 0;
  for (const it of items) {
    const stationId = idMap.get(it.stationCode);
    if (!stationId) { errors++; continue; }
    rows.push({
      station_id:  stationId,
      fetched_at:  new Date().toISOString(),
      pv_power_kw: it.powerKw,
    });
  }

  if (rows.length > 0) {
    const { error } = await supabase
      .from('station_live')
      .upsert(rows, { onConflict: 'station_id' });
    if (error) throw new Error(`updateFusionSolarLivePower: ${error.message}`);
  }

  return { ok: rows.length, errors };
}

/** Cached FusionSolar device inventory (see fusionsolar_devices migration). */
export async function getFusionSolarDeviceCache(): Promise<
  Array<{ dev_id: string; station_code: string; dev_type_id: number }>
> {
  const supabase = getClient();
  const { data, error } = await supabase
    .from('fusionsolar_devices')
    .select('dev_id, station_code, dev_type_id');
  if (error) throw new Error(`getFusionSolarDeviceCache: ${error.message}`);
  return data ?? [];
}

export async function saveFusionSolarDeviceCache(
  devices: Array<{ id: number; stationCode: string; devTypeId: number; devName: string }>,
): Promise<number> {
  if (!devices.length) return 0; // never wipe the cache with an empty fetch
  const supabase = getClient();
  const rows = devices.map(d => ({
    dev_id:       String(d.id),
    station_code: d.stationCode,
    dev_type_id:  d.devTypeId,
    dev_name:     d.devName,
    refreshed_at: new Date().toISOString(),
  }));
  const { error } = await supabase
    .from('fusionsolar_devices')
    .upsert(rows, { onConflict: 'dev_id' });
  if (error) throw new Error(`saveFusionSolarDeviceCache: ${error.message}`);
  return rows.length;
}

/** Shared Huawei session token (single row) — lets the 5-min power job skip login. */
export async function loadFusionSolarSession(): Promise<{ token: string; obtainedAt: Date } | null> {
  const supabase = getClient();
  const { data } = await supabase
    .from('fusionsolar_session')
    .select('token, obtained_at')
    .eq('id', 1)
    .maybeSingle();
  if (!data?.token) return null;
  return { token: data.token, obtainedAt: new Date(data.obtained_at) };
}

export async function saveFusionSolarSession(token: string): Promise<void> {
  const supabase = getClient();
  const { error } = await supabase
    .from('fusionsolar_session')
    .upsert({ id: 1, token, obtained_at: new Date().toISOString() }, { onConflict: 'id' });
  if (error) throw new Error(`saveFusionSolarSession: ${error.message}`);
}

/** Upsert live LIVOLTEK data. SiteLive.id is the numeric site ID = source_code. */
export async function upsertLivoltkLive(
  records: SiteLive[],
): Promise<{ ok: number; errors: number }> {
  const supabase = getClient();
  const idMap = await getStationIdMap('livoltek');

  const rows: Record<string, unknown>[] = [];
  let errors = 0;

  for (const record of records) {
    if (record._error) { errors++; continue; }
    const stationId = idMap.get(String(record.id));
    if (!stationId) { errors++; continue; }
    rows.push({
      station_id:       stationId,
      fetched_at:       new Date().toISOString(),
      pv_power_kw:      record.pvPower,
      load_power_kw:    record.loadPower,
      grid_power_kw:    record.gridActivePower,
      battery_soc:      record.batterySOC,
      battery_power_kw: record.batteryPower,
      health_state:     null,
      status:           record.status,
      temperature_c:    null,
      irradiance_wm2:   null,
      today_kwh:        record.todayPowerGeneration,
      month_kwh:        record.monthPowerGeneration,
      total_kwh:        record.totalPowerGeneration,
    });
  }

  if (rows.length > 0) {
    const { error } = await supabase
      .from('station_live')
      .upsert(rows, { onConflict: 'station_id' });
    if (error) throw new Error(`upsertLivoltkLive: ${error.message}`);

    // Dual-write to time-series table
    const slot = to5MinSlot(new Date());
    await insertReadings(rows.map(r => ({
      station_id:      r.station_id,
      recorded_at:     slot,
      pv_power_kw:     r.pv_power_kw,
      load_power_kw:   r.load_power_kw,
      grid_power_kw:   r.grid_power_kw,
      battery_soc:     r.battery_soc,
      battery_power_kw: r.battery_power_kw,
      today_kwh:       r.today_kwh,
      month_kwh:       r.month_kwh,
      total_kwh:       r.total_kwh,
    })));
  }

  return { ok: rows.length, errors };
}

/** Upsert FusionSolar daily KPI records. */
export async function upsertFusionSolarKpiDay(
  records: StationKpiDayRecord[],
): Promise<void> {
  const supabase = getClient();
  const idMap = await getStationIdMap('fusionsolar');

  const rows = records
    .map(r => {
      const stationId = idMap.get(r.stationCode);
      if (!stationId) return null;
      return {
        station_id:       stationId,
        date:             r.date,
        pv_yield_kwh:     r.pvYield,
        radiation_kwh_m2: r.radiationIntensity,
        co2_reduction_t:  r.co2Reduction,
        coal_reduction_t: r.coalReduction,
        tree_equivalent:  r.treeEquivalent,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  if (rows.length === 0) return;

  const { error } = await supabase
    .from('station_kpi_day')
    .upsert(rows, { onConflict: 'station_id,date' });
  if (error) throw new Error(`upsertFusionSolarKpiDay: ${error.message}`);
}

/**
 * Write FusionSolar hourly readings into station_readings.
 * Each record becomes one row keyed on (station_id, recorded_at) where
 * recorded_at is the exact hour boundary from the API's collectTime.
 * pv_power_kw stores kWh/hour ≈ average kW for that hour.
 */
export async function upsertFusionSolarHourlyReadings(
  records: StationKpiHourRecord[],
): Promise<{ written: number; skipped: number }> {
  const supabase = getClient();
  const idMap = await getStationIdMap('fusionsolar');

  const rows = records
    .map(r => {
      const stationId = idMap.get(r.stationCode);
      if (!stationId) return null;
      // GUARD: FusionSolar curve is hourly-only. Snap recorded_at to the top of
      // the hour so a malformed collectTime can never write a sub-hour row.
      // Mixing 5-min snapshots with hourly points corrupts chart granularity and
      // breaks the line under connectNulls={false}. Skip unparseable timestamps.
      const onHour = toHourSlot(r.hour);
      if (!onHour) return null;
      return {
        station_id:   stationId,
        recorded_at:  onHour,
        pv_power_kw:  r.inverterPower,   // kWh/h ≈ avg kW; null at night
        load_power_kw:    null,
        grid_power_kw:    null,
        battery_soc:      null,
        battery_power_kw: null,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  if (rows.length === 0) return { written: 0, skipped: records.length };

  const { error } = await supabase
    .from('station_readings')
    .upsert(rows, { onConflict: 'station_id,recorded_at' });
  if (error) throw new Error(`upsertFusionSolarHourlyReadings: ${error.message}`);

  return { written: rows.length, skipped: records.length - rows.length };
}

/** Upsert FusionSolar monthly KPI records. */
export async function upsertFusionSolarKpiMonth(
  records: StationKpiMonthRecord[],
): Promise<void> {
  const supabase = getClient();
  const idMap = await getStationIdMap('fusionsolar');

  const rows = records
    .map(r => {
      const stationId = idMap.get(r.stationCode);
      if (!stationId) return null;
      return {
        station_id:       stationId,
        year_month:       r.yearMonth,
        pv_yield_kwh:     r.pvYield,
        radiation_kwh_m2: r.radiationIntensity,
        co2_reduction_t:  r.co2Reduction,
        coal_reduction_t: r.coalReduction,
        tree_equivalent:  r.treeEquivalent,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  if (rows.length === 0) return;

  const { error } = await supabase
    .from('station_kpi_month')
    .upsert(rows, { onConflict: 'station_id,year_month' });
  if (error) throw new Error(`upsertFusionSolarKpiMonth: ${error.message}`);
}

/** Upsert FusionSolar yearly KPI records. */
export async function upsertFusionSolarKpiYear(
  records: StationKpiYearRecord[],
): Promise<void> {
  const supabase = getClient();
  const idMap = await getStationIdMap('fusionsolar');

  const rows = records
    .map(r => {
      const stationId = idMap.get(r.stationCode);
      if (!stationId) return null;
      return {
        station_id:       stationId,
        year:             r.year,
        pv_yield_kwh:     r.pvYield,
        radiation_kwh_m2: r.radiationIntensity,
        co2_reduction_t:  r.co2Reduction,
        coal_reduction_t: r.coalReduction,
        tree_equivalent:  r.treeEquivalent,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  if (rows.length === 0) return;

  const { error } = await supabase
    .from('station_kpi_year')
    .upsert(rows, { onConflict: 'station_id,year' });
  if (error) throw new Error(`upsertFusionSolarKpiYear: ${error.message}`);
}

/**
 * Upsert LIVOLTEK daily KPI from live data.
 * Uses todayPowerGeneration from SiteLive since customer token lacks historical endpoint.
 */
export async function upsertLivoltkKpiDay(
  records: SiteLive[],
  date: string,
): Promise<void> {
  const supabase = getClient();
  const idMap = await getStationIdMap('livoltek');

  const rows = records
    .filter(r => !r._error && r.todayPowerGeneration !== null)
    .map(r => {
      const stationId = idMap.get(String(r.id));
      if (!stationId) return null;
      return {
        station_id:   stationId,
        date,
        pv_yield_kwh: r.todayPowerGeneration,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  if (rows.length === 0) return;

  const { error } = await supabase
    .from('station_kpi_day')
    .upsert(rows, { onConflict: 'station_id,date' });
  if (error) throw new Error(`upsertLivoltkKpiDay: ${error.message}`);
}

/**
 * Upsert LIVOLTEK monthly KPI from live data.
 * Uses monthPowerGeneration from SiteLive.
 */
export async function upsertLivoltkKpiMonth(
  records: SiteLive[],
  yearMonth: string,
): Promise<void> {
  const supabase = getClient();
  const idMap = await getStationIdMap('livoltek');

  const rows = records
    .filter(r => !r._error && r.monthPowerGeneration !== null)
    .map(r => {
      const stationId = idMap.get(String(r.id));
      if (!stationId) return null;
      return {
        station_id:   stationId,
        year_month:   yearMonth,
        pv_yield_kwh: r.monthPowerGeneration,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  if (rows.length === 0) return;

  const { error } = await supabase
    .from('station_kpi_month')
    .upsert(rows, { onConflict: 'station_id,year_month' });
  if (error) throw new Error(`upsertLivoltkKpiMonth: ${error.message}`);
}

/** Upsert FusionSolar alarms. Inserts new, ignores existing (upsert by station_id+source_alarm_id). */
export async function upsertFusionSolarAlarms(
  alarms: FusionSolarAlarm[],
): Promise<void> {
  if (alarms.length === 0) return;
  const supabase = getClient();
  const idMap = await getStationIdMap('fusionsolar');

  const rows = alarms
    .map(a => {
      const stationId = idMap.get(a.stationCode);
      if (!stationId) return null;
      return {
        station_id:       stationId,
        source_alarm_id:  String(a.alarmId),
        alarm_name:       a.alarmName,
        alarm_code:       String(a.alarmCode),
        severity:         a.lv,
        cause:            a.alarmCause,
        repair_suggestion: a.repairSuggestion,
        raised_at:        new Date(a.raiseTime).toISOString(),
        resolved_at:      null,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  if (rows.length === 0) return;

  const { error } = await supabase
    .from('alarms')
    .upsert(rows, { onConflict: 'station_id,source_alarm_id', ignoreDuplicates: true });
  if (error) throw new Error(`upsertFusionSolarAlarms: ${error.message}`);
}

/** Upsert LIVOLTEK alarms. Matches station by name since Alarm type has powerStaitionName. */
export async function upsertLivoltkAlarms(
  alarms: Alarm[],
  stationNameMap: Map<string, string>,
): Promise<void> {
  if (alarms.length === 0) return;
  const supabase = getClient();

  const rows = alarms
    .map(a => {
      const stationId = stationNameMap.get(a.powerStaitionName);
      if (!stationId) return null;
      const sourceAlarmId = `${a.alarmCode}_${a.originTimeString}`;
      return {
        station_id:       stationId,
        source_alarm_id:  sourceAlarmId,
        alarm_name:       a.title,
        alarm_code:       a.alarmCode,
        severity:         a.level,
        cause:            a.content,
        repair_suggestion: null,
        raised_at:        new Date(a.originTimeString).toISOString(),
        resolved_at:      null,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  if (rows.length === 0) return;

  const { error } = await supabase
    .from('alarms')
    .upsert(rows, { onConflict: 'station_id,source_alarm_id', ignoreDuplicates: true });
  if (error) throw new Error(`upsertLivoltkAlarms: ${error.message}`);
}

/**
 * Mark open alarms as resolved if they are no longer in the active alarm list.
 * Fetches all open alarms for the source, diffs against activeSourceAlarmIds.
 */
export async function syncResolvedAlarms(
  source: 'fusionsolar' | 'livoltek',
  activeSourceAlarmIds: string[],
): Promise<void> {
  const supabase = getClient();
  const idMap = await getStationIdMap(source);
  const stationIds = Array.from(idMap.values());
  if (stationIds.length === 0) return;

  const { data: openAlarms, error: fetchErr } = await supabase
    .from('alarms')
    .select('id, source_alarm_id')
    .is('resolved_at', null)
    .in('station_id', stationIds);

  if (fetchErr) { console.error('syncResolvedAlarms fetch:', fetchErr.message); return; }
  if (!openAlarms?.length) return;

  const activeSet = new Set(activeSourceAlarmIds);
  const toResolve = openAlarms
    .filter(a => !activeSet.has(a.source_alarm_id))
    .map(a => a.id);

  if (toResolve.length === 0) return;

  const { error: updateErr } = await supabase
    .from('alarms')
    .update({ resolved_at: new Date().toISOString() })
    .in('id', toResolve);

  if (updateErr) console.error('syncResolvedAlarms update:', updateErr.message);
}

/** Log a data refresh attempt. */
export async function logRefresh(entry: {
  source: string;
  jobType: string;
  stationsOk: number;
  stationsError: number;
  errorDetail?: string;
  startedAt: Date;
}): Promise<void> {
  const supabase = getClient();
  const { error } = await supabase.from('refresh_log').insert({
    source:          entry.source,
    job_type:        entry.jobType,
    stations_ok:     entry.stationsOk,
    stations_error:  entry.stationsError,
    error_detail:    entry.errorDetail ?? null,
    started_at:      entry.startedAt.toISOString(),
    completed_at:    new Date().toISOString(),
  });
  if (error) console.error('logRefresh failed:', error.message);
}

/** Delete refresh_log rows older than retainDays (default: 90). */
export async function cleanupRefreshLog(retainDays = 90): Promise<{ deleted: number }> {
  const supabase = getClient();
  const cutoff = new Date(Date.now() - retainDays * 86400_000).toISOString();
  const { data, error } = await supabase
    .from('refresh_log')
    .delete()
    .lt('started_at', cutoff)
    .select('id');
  if (error) throw new Error(`cleanupRefreshLog: ${error.message}`);
  return { deleted: (data ?? []).length };
}

/**
 * Upsert per-site daily yield from LIVOLTEK getSiteYield() response.
 * Each NamedSeries entry maps to one day's pv_yield_kwh for the given station.
 * Uses the first series from the response (the PV yield series).
 */
export async function upsertLivoltkKpiDayFromYield(
  stationId: string,
  series: Array<{ name?: string; key?: string; value: Array<{ datetime: string; value?: number | null; avgValue?: number | null }> }>,
): Promise<number> {
  if (series.length === 0) return 0;
  const supabase = getClient();

  // Use the first series; each TimeSeriesPoint has a date string + numeric value
  const src = series[0];
  if (!src?.value || !Array.isArray(src.value)) return 0;
  const rows = src.value
    .filter(pt => pt.value != null || pt.avgValue != null)
    .map(pt => ({
      station_id:   stationId,
      date:         pt.datetime.slice(0, 10),
      pv_yield_kwh: pt.value ?? pt.avgValue ?? 0,
    }));

  if (rows.length === 0) return 0;

  const { error } = await supabase
    .from('station_kpi_day')
    .upsert(rows, { onConflict: 'station_id,date' });
  if (error) throw new Error(`upsertLivoltkKpiDayFromYield: ${error.message}`);
  return rows.length;
}

/**
 * Bulk-insert intraday 5-minute readings from getSiteIntraday() into station_readings.
 * intradayData: key = channel name, value = array of {datetime, value} points.
 * The datetime strings are in Africa/Kampala local time (UTC+3) — we shift to UTC.
 */
export async function insertLivoltkIntradayReadings(
  stationId: string,
  intradayData: Record<string, Array<{ datetime: string; value?: number | null }>>,
): Promise<number> {
  const merged = new Map<string, Record<string, unknown>>();

  const toUtc = (dt: string): string => {
    // Portal returns "YYYY-MM-DD HH:MM:SS" in Africa/Kampala (UTC+3)
    const localMs = new Date(dt.replace(' ', 'T') + '+03:00').getTime();
    return new Date(localMs).toISOString();
  };

  for (const [key, points] of Object.entries(intradayData)) {
    for (const pt of points) {
      if (pt.value == null) continue;
      const utc = toUtc(pt.datetime);
      if (!merged.has(utc)) {
        merged.set(utc, { station_id: stationId, recorded_at: utc });
      }
      const row = merged.get(utc)!;
      switch (key) {
        case 'PV Power':      row.pv_power_kw = pt.value; break;
        case 'Load Power':    row.load_power_kw = pt.value; break;
        case 'SM_Activepower': row.grid_power_kw = pt.value; break;
        case 'Battery power': row.battery_power_kw = pt.value; break;
        case 'Battery SOC':   row.battery_soc = pt.value; break;
      }
    }
  }

  const rows = Array.from(merged.values());
  if (rows.length === 0) return 0;
  await insertReadings(rows);
  return rows.length;
}

/** Get a Map<station_name, station_id> for a given source — used for LIVOLTEK alarm matching. */
export async function getStationNameMap(
  source: 'fusionsolar' | 'livoltek',
): Promise<Map<string, string>> {
  const supabase = getClient();
  const { data, error } = await supabase
    .from('stations')
    .select('id, name')
    .eq('source', source);

  if (error) throw new Error(`getStationNameMap(${source}): ${error.message}`);

  const map = new Map<string, string>();
  for (const row of data ?? []) {
    map.set(String(row.name), String(row.id));
  }
  return map;
}
