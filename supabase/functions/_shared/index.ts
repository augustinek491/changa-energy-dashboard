/**
 * _shared/index.ts
 * Shared code for all Changa Energy cron Edge Functions (Deno runtime).
 *
 * Differences from the Next.js lib/ versions:
 *   - process.env.X  →  Deno.env.get('X')
 *   - process.stdout.write  →  console.log
 *   - node:crypto available via Deno Node compat
 *   - npm:@supabase/supabase-js@2 import specifier
 *   - SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY auto-injected by Supabase runtime
 */

import { createClient } from 'npm:@supabase/supabase-js@2';
import { createHash } from 'node:crypto';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface StationDef {
  code: string;
  name: string;
  location: string;
}

export interface StationRealKpi {
  day_power?: number;
  month_power?: number;
  total_power?: number;
  real_health_state?: number;
}

export interface DeviceEntry {
  id: number;
  devTypeId: number;
}

export interface DeviceRealKpi {
  active_power?: number;
}

export interface StationWeather {
  stationCode: string;
  devId: number;
  temperature: number | null;
  pvTemperature: number | null;
  irradianceLive: number | null;
  irradianceTotal: number | null;
  runState: number;
}

export interface SmartMeterKpi {
  active_power?: number;
}

export interface BatteryKpi {
  battery_soc?: number;
  ch_discharge_power?: number;
}

export interface StationDashboardRecord {
  name: string;
  loc: string;
  day: number;
  total: number;
  month: number;
  health: number;
  live: number | null;
  temperature: number | null;
  irradiance: number | null;
  gridPower: number | null;
  loadPower: number | null;
  batterySOC: number | null;
  batteryPower: number | null;
}

export interface StationKpiDayRecord {
  collectTime: number;
  date: string;
  stationCode: string;
  pvYield: number;
  radiationIntensity: number;
  inverterPower: number;
  co2Reduction: number;
  coalReduction: number;
  treeEquivalent: number;
}

export interface StationKpiHourRecord {
  collectTime: number;
  hour: string;
  stationCode: string;
  inverterPower: number | null;
  radiationIntensity: number | null;
}

export interface StationKpiMonthRecord {
  collectTime: number;
  yearMonth: string;
  stationCode: string;
  pvYield: number;
  radiationIntensity: number;
  co2Reduction: number;
  coalReduction: number;
  treeEquivalent: number;
}

export interface StationKpiYearRecord {
  collectTime: number;
  year: string;
  stationCode: string;
  pvYield: number;
  radiationIntensity: number;
  co2Reduction: number;
  coalReduction: number;
  treeEquivalent: number;
}

export interface FusionSolarAlarm {
  alarmId: number;
  alarmCode: number;
  alarmName: string;
  alarmCause: string;
  repairSuggestion: string;
  stationCode: string;
  lv: number;
  raiseTime: number;
}

export interface FusionSolarResponse<T = unknown> {
  success?: boolean;
  failCode?: number;
  message?: string;
  data?: T;
}

export interface SiteLive {
  id: number;
  _error?: string;
  pvPower?: number | null;
  loadPower?: number | null;
  gridActivePower?: number | null;
  batterySOC?: number | null;
  batteryPower?: number | null;
  status?: string | null;
  todayPowerGeneration?: number | null;
  monthPowerGeneration?: number | null;
  totalPowerGeneration?: number | null;
}

export interface LvAlarm {
  alarmCode: string;
  originTimeString: string;
  powerStaitionName: string;  // note: typo matches the API
  title: string;
  level: number;
  content: string;
}

interface LivoltkLoginResponse {
  msg_code?: string;
  data?: { access_token?: string; session_expiry_time?: number };
}

// ── Constants ─────────────────────────────────────────────────────────────────

export const CALL_DELAY = 1500; // ms between FusionSolar API calls

export const STATIONS: StationDef[] = [
  { code: 'NE=63896844', name: 'Hoyo Hoyo Khozeni',      location: 'Hoedspruit, Limpopo' },
  { code: 'NE=63899048', name: 'Hoyo Hoyo Khozeni 2',    location: 'Hoedspruit, Limpopo' },
  { code: 'NE=66423560', name: 'Hoyo Hoyo – Angelsview', location: 'Thaba Chweu, Mpumalanga' },
  { code: 'NE=65438276', name: 'Hoyo Hoyo Machado',      location: 'Emakhazeni, Mpumalanga' },
  { code: 'NE=65385858', name: 'Hoyo Hoyo – Acorn',      location: 'Hoedspruit, Limpopo' },
];

export const ALL_SITE_IDS = [
  24164, 24728, 26205, 26231, 26236, 26255, 26260, 26269,
  26386, 26387, 26388, 26389, 26390, 26415, 26431, 28964,
];

const NBP_BASE  = 'https://evs.livoltek-portal.com/nbp';
const CTRL_BASE = 'https://evs.livoltek-portal.com/ctrller-manager';
const PORTAL_TIMEZONE = 'Africa/Kampala';
const REFERER = 'https://evs.livoltek-portal.com/';

// ── Utilities ─────────────────────────────────────────────────────────────────

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === 'N/A' || v === '') return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

function msToDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

// ── Database helpers ──────────────────────────────────────────────────────────

function getDbClient() {
  // SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are auto-injected by Supabase Edge runtime
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );
}

function to5MinSlot(d: Date): string {
  const ms = Math.floor(d.getTime() / (5 * 60 * 1000)) * (5 * 60 * 1000);
  return new Date(ms).toISOString();
}

/**
 * Snap a timestamp down to the top of its UTC hour. Returns null if unparseable.
 * Write-side guard so FusionSolar only ever lands on-the-hour rows in
 * station_readings (FusionSolar curve is hourly; sub-hour rows break the chart).
 */
function toHourSlot(input: string | Date): string | null {
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCMinutes(0, 0, 0);
  return d.toISOString();
}

async function insertReadings(rows: Record<string, unknown>[]): Promise<void> {
  if (rows.length === 0) return;
  const db = getDbClient();
  const { error } = await db
    .from('station_readings')
    .upsert(rows, { onConflict: 'station_id,recorded_at' });
  if (error) throw new Error(`insertReadings: ${error.message}`);
}

export async function getStationIdMap(
  source: 'fusionsolar' | 'livoltek',
): Promise<Map<string, string>> {
  const db = getDbClient();
  const { data, error } = await db
    .from('stations')
    .select('id, source_code')
    .eq('source', source);
  if (error) throw new Error(`getStationIdMap(${source}): ${error.message}`);
  const map = new Map<string, string>();
  for (const row of data ?? []) map.set(String(row.source_code), String(row.id));
  return map;
}

export async function getStationNameMap(
  source: 'fusionsolar' | 'livoltek',
): Promise<Map<string, string>> {
  const db = getDbClient();
  const { data, error } = await db
    .from('stations')
    .select('id, name')
    .eq('source', source);
  if (error) throw new Error(`getStationNameMap(${source}): ${error.message}`);
  const map = new Map<string, string>();
  for (const row of data ?? []) map.set(String(row.name), String(row.id));
  return map;
}

export async function logRefresh(entry: {
  source: string;
  jobType: string;
  stationsOk: number;
  stationsError: number;
  errorDetail?: string;
  startedAt: Date;
}): Promise<void> {
  const db = getDbClient();
  const { error } = await db.from('refresh_log').insert({
    source:         entry.source,
    job_type:       entry.jobType,
    stations_ok:    entry.stationsOk,
    stations_error: entry.stationsError,
    error_detail:   entry.errorDetail ?? null,
    started_at:     entry.startedAt.toISOString(),
    completed_at:   new Date().toISOString(),
  });
  if (error) console.error('logRefresh failed:', error.message);
}

export async function cleanupRefreshLog(retainDays = 90): Promise<{ deleted: number }> {
  const db = getDbClient();
  const cutoff = new Date(Date.now() - retainDays * 86400_000).toISOString();
  const { data, error } = await db
    .from('refresh_log')
    .delete()
    .lt('started_at', cutoff)
    .select('id');
  if (error) throw new Error(`cleanupRefreshLog: ${error.message}`);
  return { deleted: (data ?? []).length };
}

// ── DB write helpers ──────────────────────────────────────────────────────────

export async function upsertFusionSolarLive(
  items: Array<{ stationCode: string; record: StationDashboardRecord }>,
): Promise<{ ok: number; errors: number }> {
  const db = getDbClient();
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
    const { error } = await db.from('station_live').upsert(rows, { onConflict: 'station_id' });
    if (error) throw new Error(`upsertFusionSolarLive: ${error.message}`);
    // GUARD: do NOT dual-write FusionSolar to station_readings here. This used to
    // insert a 5-min snapshot per run, polluting the hourly FusionSolar curve with
    // sub-hour rows and breaking the chart line. The canonical FusionSolar
    // time-series is the hourly curve from upsertFusionSolarHourlyReadings.
    // This function is retained for station_live writes only and must never
    // touch station_readings.
  }
  return { ok: rows.length, errors };
}

export async function upsertLivoltkLive(
  records: SiteLive[],
): Promise<{ ok: number; errors: number }> {
  const db = getDbClient();
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
    const { error } = await db.from('station_live').upsert(rows, { onConflict: 'station_id' });
    if (error) throw new Error(`upsertLivoltkLive: ${error.message}`);
    const slot = to5MinSlot(new Date());
    await insertReadings(rows.map(r => ({
      station_id:       r.station_id,
      recorded_at:      slot,
      pv_power_kw:      r.pv_power_kw,
      load_power_kw:    r.load_power_kw,
      grid_power_kw:    r.grid_power_kw,
      battery_soc:      r.battery_soc,
      battery_power_kw: r.battery_power_kw,
      today_kwh:        r.today_kwh,
      month_kwh:        r.month_kwh,
      total_kwh:        r.total_kwh,
    })));
  }
  return { ok: rows.length, errors };
}

export async function upsertFusionSolarKpiDay(records: StationKpiDayRecord[]): Promise<void> {
  const db = getDbClient();
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
  const { error } = await db.from('station_kpi_day').upsert(rows, { onConflict: 'station_id,date' });
  if (error) throw new Error(`upsertFusionSolarKpiDay: ${error.message}`);
}

export async function upsertFusionSolarHourlyReadings(
  records: StationKpiHourRecord[],
): Promise<{ written: number; skipped: number }> {
  const db = getDbClient();
  const idMap = await getStationIdMap('fusionsolar');
  const rows = records
    .map(r => {
      const stationId = idMap.get(r.stationCode);
      if (!stationId) return null;
      // GUARD: snap recorded_at to the top of the hour so a malformed collectTime
      // can never write a sub-hour row into the hourly FusionSolar curve. Skip
      // unparseable timestamps.
      const onHour = toHourSlot(r.hour);
      if (!onHour) return null;
      return {
        station_id:       stationId,
        recorded_at:      onHour,
        pv_power_kw:      r.inverterPower,
        load_power_kw:    null,
        grid_power_kw:    null,
        battery_soc:      null,
        battery_power_kw: null,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);
  if (rows.length === 0) return { written: 0, skipped: records.length };
  const { error } = await db.from('station_readings').upsert(rows, { onConflict: 'station_id,recorded_at' });
  if (error) throw new Error(`upsertFusionSolarHourlyReadings: ${error.message}`);
  return { written: rows.length, skipped: records.length - rows.length };
}

export async function upsertFusionSolarKpiMonth(records: StationKpiMonthRecord[]): Promise<void> {
  const db = getDbClient();
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
  const { error } = await db.from('station_kpi_month').upsert(rows, { onConflict: 'station_id,year_month' });
  if (error) throw new Error(`upsertFusionSolarKpiMonth: ${error.message}`);
}

export async function upsertFusionSolarKpiYear(records: StationKpiYearRecord[]): Promise<void> {
  const db = getDbClient();
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
  const { error } = await db.from('station_kpi_year').upsert(rows, { onConflict: 'station_id,year' });
  if (error) throw new Error(`upsertFusionSolarKpiYear: ${error.message}`);
}

export async function upsertLivoltkKpiDay(records: SiteLive[], date: string): Promise<void> {
  const db = getDbClient();
  const idMap = await getStationIdMap('livoltek');
  const rows = records
    .filter(r => !r._error && r.todayPowerGeneration !== null)
    .map(r => {
      const stationId = idMap.get(String(r.id));
      if (!stationId) return null;
      return { station_id: stationId, date, pv_yield_kwh: r.todayPowerGeneration };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);
  if (rows.length === 0) return;
  const { error } = await db.from('station_kpi_day').upsert(rows, { onConflict: 'station_id,date' });
  if (error) throw new Error(`upsertLivoltkKpiDay: ${error.message}`);
}

export async function upsertLivoltkKpiMonth(records: SiteLive[], yearMonth: string): Promise<void> {
  const db = getDbClient();
  const idMap = await getStationIdMap('livoltek');
  const rows = records
    .filter(r => !r._error && r.monthPowerGeneration !== null)
    .map(r => {
      const stationId = idMap.get(String(r.id));
      if (!stationId) return null;
      return { station_id: stationId, year_month: yearMonth, pv_yield_kwh: r.monthPowerGeneration };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);
  if (rows.length === 0) return;
  const { error } = await db.from('station_kpi_month').upsert(rows, { onConflict: 'station_id,year_month' });
  if (error) throw new Error(`upsertLivoltkKpiMonth: ${error.message}`);
}

export async function upsertFusionSolarAlarms(alarms: FusionSolarAlarm[]): Promise<void> {
  if (alarms.length === 0) return;
  const db = getDbClient();
  const idMap = await getStationIdMap('fusionsolar');
  const rows = alarms
    .map(a => {
      const stationId = idMap.get(a.stationCode);
      if (!stationId) return null;
      return {
        station_id:        stationId,
        source_alarm_id:   String(a.alarmId),
        alarm_name:        a.alarmName,
        alarm_code:        String(a.alarmCode),
        severity:          a.lv,
        cause:             a.alarmCause,
        repair_suggestion: a.repairSuggestion,
        raised_at:         new Date(a.raiseTime).toISOString(),
        resolved_at:       null,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);
  if (rows.length === 0) return;
  const { error } = await db.from('alarms').upsert(rows, { onConflict: 'station_id,source_alarm_id', ignoreDuplicates: true });
  if (error) throw new Error(`upsertFusionSolarAlarms: ${error.message}`);
}

export async function upsertLivoltkAlarms(
  alarms: LvAlarm[],
  stationNameMap: Map<string, string>,
): Promise<void> {
  if (alarms.length === 0) return;
  const db = getDbClient();
  const rows = alarms
    .map(a => {
      const stationId = stationNameMap.get(a.powerStaitionName);
      if (!stationId) return null;
      return {
        station_id:        stationId,
        source_alarm_id:   `${a.alarmCode}_${a.originTimeString}`,
        alarm_name:        a.title,
        alarm_code:        a.alarmCode,
        severity:          a.level,
        cause:             a.content,
        repair_suggestion: null,
        raised_at:         new Date(a.originTimeString).toISOString(),
        resolved_at:       null,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);
  if (rows.length === 0) return;
  const { error } = await db.from('alarms').upsert(rows, { onConflict: 'station_id,source_alarm_id', ignoreDuplicates: true });
  if (error) throw new Error(`upsertLivoltkAlarms: ${error.message}`);
}

export async function syncResolvedAlarms(
  source: 'fusionsolar' | 'livoltek',
  activeSourceAlarmIds: string[],
): Promise<void> {
  const db = getDbClient();
  const idMap = await getStationIdMap(source);
  const stationIds = Array.from(idMap.values());
  if (stationIds.length === 0) return;

  const { data: openAlarms, error: fetchErr } = await db
    .from('alarms')
    .select('id, source_alarm_id')
    .is('resolved_at', null)
    .in('station_id', stationIds);

  if (fetchErr) { console.error('syncResolvedAlarms fetch:', fetchErr.message); return; }
  if (!openAlarms?.length) return;

  const activeSet = new Set(activeSourceAlarmIds);
  const toResolve = openAlarms.filter(a => !activeSet.has(a.source_alarm_id)).map(a => a.id);
  if (toResolve.length === 0) return;

  const { error: updateErr } = await db
    .from('alarms')
    .update({ resolved_at: new Date().toISOString() })
    .in('id', toResolve);
  if (updateErr) console.error('syncResolvedAlarms update:', updateErr.message);
}

// ── FusionSolar API client ────────────────────────────────────────────────────

export class FusionSolarClient {
  private xsrfToken: string | null = null;

  constructor(
    private username: string,
    private password: string,
    public baseUrl: string,
  ) {}

  async apiPost<T = unknown>(
    endpoint: string,
    body: Record<string, unknown>,
    retries = 3,
  ): Promise<FusionSolarResponse<T>> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.xsrfToken) headers['xsrf-token'] = this.xsrfToken;

    for (let attempt = 0; attempt < retries; attempt++) {
      const res = await fetch(`${this.baseUrl}/${endpoint}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
      const newToken = res.headers.get('xsrf-token');
      if (newToken) { this.xsrfToken = newToken; headers['xsrf-token'] = newToken; }
      const result = await res.json() as FusionSolarResponse<T>;
      if (result.failCode === 407) {
        console.log(`[rate limited on /${endpoint}] retry ${attempt + 1}/${retries}...`);
        await sleep(CALL_DELAY * (attempt + 2));
        continue;
      }
      return result;
    }
    return { failCode: 407, message: 'RATE_LIMITED_AFTER_RETRIES' };
  }

  async login(): Promise<boolean> {
    const res = await fetch(`${this.baseUrl}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userName: this.username, systemCode: this.password }),
    });
    const token = res.headers.get('xsrf-token');
    if (!token) {
      let detail = `status=${res.status}`;
      try {
        const body = await res.json() as { failCode?: number; message?: string };
        detail += ` failCode=${body.failCode ?? 'none'} message=${body.message ?? ''}`;
      } catch { /* ignore */ }
      console.error(`FusionSolar login failed: ${detail}`);
      throw new Error(`FusionSolar login failed: ${detail}`);
    }
    this.xsrfToken = token;
    return true;
  }
}

export function loadFusionSolarEnv(): { username: string; password: string; baseUrl: string } {
  const username = Deno.env.get('FUSIONSOLAR_USERNAME');
  const password = Deno.env.get('FUSIONSOLAR_PASSWORD');
  const baseUrl  = Deno.env.get('FUSIONSOLAR_BASE_URL') ?? 'https://intl.fusionsolar.huawei.com/thirdData';
  if (!username || !password) throw new Error('Missing FUSIONSOLAR_USERNAME or FUSIONSOLAR_PASSWORD');
  return { username, password, baseUrl };
}

export async function getStationRealKpis(
  client: FusionSolarClient,
  stationCodes: string[],
): Promise<Map<string, StationRealKpi>> {
  const res = await client.apiPost<Array<{ stationCode: string; dataItemMap: StationRealKpi }>>(
    'getStationRealKpi',
    { stationCodes: stationCodes.join(',') },
  );
  const kpiMap = new Map<string, StationRealKpi>();
  for (const entry of res.data ?? []) {
    if (entry?.stationCode) kpiMap.set(entry.stationCode, entry.dataItemMap ?? {});
  }
  return kpiMap;
}

export async function fetchDashboardData(
  client: FusionSolarClient,
  stations: StationDef[] = STATIONS,
): Promise<StationDashboardRecord[]> {
  const codes  = stations.map(s => s.code);
  const kpiMap = await getStationRealKpis(client, codes);
  await sleep(CALL_DELAY);

  const livePower  = new Map<string, number | null>();
  const weatherMap = new Map<string, StationWeather | null>();
  const meterMap   = new Map<string, SmartMeterKpi | null>();
  const batteryMap = new Map<string, BatteryKpi | null>();

  for (const station of stations) {
    console.log(`  Fetching devices for ${station.name}...`);

    const devRes  = await client.apiPost<DeviceEntry[]>('getDevList', { stationCodes: station.code });
    const devices = devRes.data ?? [];
    const inverters  = devices.filter(d => d.devTypeId === 1);
    const emiDevice  = devices.find(d => d.devTypeId === 10) ?? null;
    const meterDev   = devices.find(d => d.devTypeId === 17) ?? null;
    const batteryDev = devices.find(d => d.devTypeId === 39) ?? null;
    await sleep(CALL_DELAY);

    // Live inverter power
    if (inverters.length === 0) {
      livePower.set(station.code, null);
    } else {
      const ids  = inverters.map(d => String(d.id)).join(',');
      const kpis = await client.apiPost<Array<{ devId: number; dataItemMap: DeviceRealKpi }>>(
        'getDevRealKpi', { devIds: ids, devTypeId: 1 },
      );
      if ((kpis.data ?? []).length > 0) {
        const total = (kpis.data ?? []).reduce((sum, k) => {
          const power = Number(k.dataItemMap?.active_power ?? 0);
          return sum + (isNaN(power) ? 0 : power);
        }, 0);
        livePower.set(station.code, Math.round(total * 100) / 100);
      } else {
        livePower.set(station.code, null);
      }
      await sleep(CALL_DELAY);
    }

    // EMI weather
    if (!emiDevice) {
      weatherMap.set(station.code, null);
    } else {
      const emiRes = await client.apiPost<Array<{ devId: number; dataItemMap: Record<string, unknown> }>>(
        'getDevRealKpi', { devIds: String(emiDevice.id), devTypeId: 10 },
      );
      const emiEntry = emiRes.data?.[0];
      if (emiEntry) {
        const m = emiEntry.dataItemMap ?? {};
        weatherMap.set(station.code, {
          stationCode:    station.code,
          devId:          emiEntry.devId,
          temperature:    numOrNull(m['temperature']),
          pvTemperature:  numOrNull(m['pv_temperature']),
          irradianceLive: numOrNull(m['radiant_line']),
          irradianceTotal:numOrNull(m['radiant_total']),
          runState:       Number(m['run_state'] ?? 0),
        });
      } else {
        weatherMap.set(station.code, null);
      }
      await sleep(CALL_DELAY);
    }

    // Smart meter
    if (!meterDev) {
      meterMap.set(station.code, null);
    } else {
      const mRes = await client.apiPost<Array<{ devId: number; dataItemMap: SmartMeterKpi }>>(
        'getDevRealKpi', { devIds: String(meterDev.id), devTypeId: 17 },
      );
      meterMap.set(station.code, mRes.data?.[0]?.dataItemMap ?? null);
      await sleep(CALL_DELAY);
    }

    // Battery
    if (!batteryDev) {
      batteryMap.set(station.code, null);
    } else {
      const bRes = await client.apiPost<Array<{ devId: number; dataItemMap: BatteryKpi }>>(
        'getDevRealKpi', { devIds: String(batteryDev.id), devTypeId: 39 },
      );
      batteryMap.set(station.code, bRes.data?.[0]?.dataItemMap ?? null);
      await sleep(CALL_DELAY);
    }
  }

  return stations.map(station => {
    const kpi     = kpiMap.get(station.code) ?? {};
    const weather = weatherMap.get(station.code) ?? null;
    const meter   = meterMap.get(station.code)   ?? null;
    const battery = batteryMap.get(station.code) ?? null;
    const pvLive  = livePower.get(station.code)  ?? null;
    const gridPower = meter?.active_power !== undefined
      ? Math.round(meter.active_power * 100) / 100
      : null;
    let loadPower: number | null = null;
    if (pvLive !== null && gridPower !== null) {
      loadPower = Math.round((pvLive + gridPower) * 100) / 100;
      if (loadPower < 0) loadPower = 0;
    }
    return {
      name: station.name, loc: station.location,
      day:   Math.round((Number(kpi.day_power   ?? 0)) * 100) / 100,
      total: Math.round((Number(kpi.total_power ?? 0)) * 100) / 100,
      month: Math.round((Number(kpi.month_power ?? 0)) * 100) / 100,
      health: Number(kpi.real_health_state ?? 3),
      live: pvLive,
      temperature: weather?.temperature    ?? null,
      irradiance:  weather?.irradianceLive ?? null,
      gridPower,
      loadPower,
      batterySOC:   battery?.battery_soc       !== undefined ? Math.round(battery.battery_soc) : null,
      batteryPower: battery?.ch_discharge_power !== undefined ? Math.round(battery.ch_discharge_power * 100) / 100 : null,
    };
  });
}

export async function getStationKpiDay(
  client: FusionSolarClient,
  stationCodes: string[],
  date?: Date,
): Promise<StationKpiDayRecord[]> {
  const anchor = date ?? new Date(Date.now() - 86400000);
  anchor.setHours(12, 0, 0, 0);
  const res = await client.apiPost<Array<{ collectTime: number; stationCode: string; dataItemMap: Record<string, unknown> }>>(
    'getKpiStationDay',
    { stationCodes: stationCodes.join(','), collectTime: anchor.getTime() },
  );
  return (res.data ?? []).map(entry => {
    const m = entry.dataItemMap ?? {};
    return {
      collectTime:        entry.collectTime,
      date:               msToDate(entry.collectTime),
      stationCode:        entry.stationCode,
      pvYield:            Number(m['PVYield']              ?? 0),
      radiationIntensity: Number(m['radiation_intensity']  ?? 0),
      inverterPower:      Number(m['inverter_power']       ?? 0),
      co2Reduction:       Number(m['reduction_total_co2']  ?? 0),
      coalReduction:      Number(m['reduction_total_coal'] ?? 0),
      treeEquivalent:     Number(m['reduction_total_tree'] ?? 0),
    };
  }).sort((a, b) => a.collectTime - b.collectTime);
}

export async function getStationKpiHour(
  client: FusionSolarClient,
  stationCodes: string[],
  date?: Date,
): Promise<StationKpiHourRecord[]> {
  const anchor = date ?? new Date(Date.now() - 86400000);
  anchor.setHours(12, 0, 0, 0);
  const res = await client.apiPost<Array<{ collectTime: number; stationCode: string; dataItemMap: Record<string, unknown> }>>(
    'getKpiStationHour',
    { stationCodes: stationCodes.join(','), collectTime: anchor.getTime() },
  );
  return (res.data ?? []).map(entry => {
    const m   = entry.dataItemMap ?? {};
    const raw = m['inverter_power'];
    const rad = m['radiation_intensity'];
    return {
      collectTime:        entry.collectTime,
      hour:               new Date(entry.collectTime).toISOString(),
      stationCode:        entry.stationCode,
      inverterPower:      raw !== null && raw !== undefined ? Number(raw) : null,
      radiationIntensity: rad !== null && rad !== undefined ? Number(rad) : null,
    };
  }).sort((a, b) => a.collectTime - b.collectTime);
}

export async function getStationKpiMonth(
  client: FusionSolarClient,
  stationCodes: string[],
  date?: Date,
): Promise<StationKpiMonthRecord[]> {
  const anchor = date ?? new Date();
  anchor.setDate(1);
  anchor.setHours(12, 0, 0, 0);
  const res = await client.apiPost<Array<{ collectTime: number; stationCode: string; dataItemMap: Record<string, unknown> }>>(
    'getKpiStationMonth',
    { stationCodes: stationCodes.join(','), collectTime: anchor.getTime() },
  );
  return (res.data ?? []).map(entry => {
    const m = entry.dataItemMap ?? {};
    return {
      collectTime:        entry.collectTime,
      // +2h offset: collectTime is midnight SAST (UTC+2); .toISOString() gives UTC
      // which shifts to previous month. Add 2h to stay in the correct month.
      yearMonth:          new Date(entry.collectTime + 2 * 3_600_000).toISOString().slice(0, 7),
      stationCode:        entry.stationCode,
      pvYield:            Number(m['PVYield']              ?? 0),
      radiationIntensity: Number(m['radiation_intensity']  ?? 0),
      co2Reduction:       Number(m['reduction_total_co2']  ?? 0),
      coalReduction:      Number(m['reduction_total_coal'] ?? 0),
      treeEquivalent:     Number(m['reduction_total_tree'] ?? 0),
    };
  }).sort((a, b) => a.collectTime - b.collectTime);
}

export async function getStationKpiYear(
  client: FusionSolarClient,
  stationCodes: string[],
  date?: Date,
): Promise<StationKpiYearRecord[]> {
  const anchor = date ?? new Date();
  anchor.setMonth(0, 1);
  anchor.setHours(12, 0, 0, 0);
  const res = await client.apiPost<Array<{ collectTime: number; stationCode: string; dataItemMap: Record<string, unknown> }>>(
    'getKpiStationYear',
    { stationCodes: stationCodes.join(','), collectTime: anchor.getTime() },
  );
  return (res.data ?? []).map(entry => {
    const m = entry.dataItemMap ?? {};
    return {
      collectTime:        entry.collectTime,
      year:               new Date(entry.collectTime).getFullYear().toString(),
      stationCode:        entry.stationCode,
      pvYield:            Number(m['PVYield']              ?? 0),
      radiationIntensity: Number(m['radiation_intensity']  ?? 0),
      co2Reduction:       Number(m['reduction_total_co2']  ?? 0),
      coalReduction:      Number(m['reduction_total_coal'] ?? 0),
      treeEquivalent:     Number(m['reduction_total_tree'] ?? 0),
    };
  }).sort((a, b) => a.collectTime - b.collectTime);
}

export async function getFsAlarms(
  client: FusionSolarClient,
  stationCodes: string[],
): Promise<FusionSolarAlarm[]> {
  const res = await client.apiPost<FusionSolarAlarm[]>(
    'getAlarmList',
    { stationCodes: stationCodes.join(','), language: 'en' },
  );
  return res.data ?? [];
}

// ── LIVOLTEK API client ───────────────────────────────────────────────────────

export class LivoltkClient {
  private token: string | null = null;
  private tokenExpiry = 0;
  private baseHeaders: Record<string, string> = {
    language:     'en',
    timeZone:     PORTAL_TIMEZONE,
    Referer:      REFERER,
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  };

  constructor(
    private email: string,
    private password: string,
    private accountType = 'customer',
  ) {}

  private md5(s: string): string {
    return createHash('md5').update(s).digest('hex');
  }

  async login(): Promise<boolean> {
    const nbpRes = await fetch(`${NBP_BASE}/login/${this.accountType}`, {
      method: 'POST',
      headers: { ...this.baseHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        login_account: this.email,
        password:      this.md5(this.password),
        account_type:  'account',
        language:      'en',
        device_type:   0,
      }),
    });
    const nbpData = await nbpRes.json() as LivoltkLoginResponse;
    if (nbpData.msg_code !== 'operate.success' || !nbpData.data?.access_token) {
      console.error('LIVOLTEK NBP login failed:', nbpData.msg_code);
      return false;
    }
    this.token = nbpData.data.access_token;
    const expiryMs = nbpData.data.session_expiry_time ?? 0;
    this.tokenExpiry = expiryMs
      ? expiryMs / 1000 - 3600
      : Date.now() / 1000 + 86400 * 29;
    this.baseHeaders['Authorization'] = `Bearer ${this.token}`;

    const ctrlRes = await fetch(`${CTRL_BASE}/login/login`, {
      method: 'POST',
      headers: { ...this.baseHeaders, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: '',
    });
    const ctrlData = await ctrlRes.json() as { msg_code: string };
    if (ctrlData.msg_code !== 'operate.success') {
      console.error('LIVOLTEK ctrller-manager login failed:', ctrlData.msg_code);
      return false;
    }
    return true;
  }

  async ensureAuth(): Promise<void> {
    if (!this.token || Date.now() / 1000 > this.tokenExpiry) {
      const ok = await this.login();
      if (!ok) throw new Error('LIVOLTEK authentication failed');
    }
  }

  async postForm(
    urlPath: string,
    params?: Record<string, string | number | boolean>,
    data?: Record<string, string | number | boolean>,
  ): Promise<Record<string, unknown>> {
    await this.ensureAuth();
    let url = `${CTRL_BASE}${urlPath}`;
    if (params && Object.keys(params).length > 0) {
      url += '?' + new URLSearchParams(
        Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)]))
      ).toString();
    }
    const bodyStr = data
      ? new URLSearchParams(
          Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)]))
        ).toString()
      : '';
    const res = await fetch(url, {
      method: 'POST',
      headers: { ...this.baseHeaders, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: bodyStr,
    });
    return res.json() as Promise<Record<string, unknown>>;
  }

  async postJson(
    urlPath: string,
    body: Record<string, unknown>,
    params?: Record<string, string>,
  ): Promise<Record<string, unknown>> {
    await this.ensureAuth();
    let url = `${CTRL_BASE}${urlPath}`;
    if (params && Object.keys(params).length > 0) {
      url += '?' + new URLSearchParams(params).toString();
    }
    const res = await fetch(url, {
      method: 'POST',
      headers: { ...this.baseHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return res.json() as Promise<Record<string, unknown>>;
  }
}

export function loadLivoltkEnv(): { email: string; password: string; accountType: string } {
  const email       = Deno.env.get('LIVOLTEK_PORTAL_EMAIL');
  const password    = Deno.env.get('LIVOLTEK_PORTAL_PASSWORD');
  const accountType = Deno.env.get('LIVOLTEK_ACCOUNT_TYPE') ?? 'customer';
  if (!email || !password) throw new Error('Missing LIVOLTEK_PORTAL_EMAIL or LIVOLTEK_PORTAL_PASSWORD');
  return { email, password, accountType };
}

export async function getAllSitesLive(
  client: LivoltkClient,
  siteIds: number[] = ALL_SITE_IDS,
): Promise<SiteLive[]> {
  const results = await Promise.allSettled(
    siteIds.map(id => client.postForm('/powerstation/findOne', { id, isUseChangeUnit: 'true' }))
  );
  return results.map((result, i) => {
    if (result.status === 'fulfilled') return (result.value.data ?? { id: siteIds[i] }) as SiteLive;
    return { id: siteIds[i], _error: String(result.reason) } as SiteLive;
  });
}

export async function getLvAlarms(
  client: LivoltkClient,
  days = 1,
): Promise<LvAlarm[]> {
  const now   = new Date();
  const start = new Date(now.getTime() - days * 86400 * 1000);
  const fmt   = (d: Date) => d.toISOString().replace('Z', '').slice(0, 23) + '.000Z';
  const resp  = await client.postJson('/alarm/findAllFilter', {
    powerStationFilter: [],
    filterTime: [fmt(start), fmt(now)],
    pageSize: 100,
    start: 1,
  });
  return (resp.data as LvAlarm[]) ?? [];
}

// ─── LIVOLTEK intraday 5-min self-heal ────────────────────────────────────────

const INTRADAY_KEYS = [
  'Battery power', 'PV Power', 'Load Power', 'SM_Activepower', 'Battery SOC',
];

type IntradayPoint  = { value: number | null; datetime: string };
type IntradayResult = Record<string, IntradayPoint[]>;

/**
 * Fetch a full day's 5-min intraday data for one LIVOLTEK site via sampleByKeyCommon.
 * Requires operator token. Date defaults to today in Africa/Johannesburg (UTC+2).
 *
 * Critical: timeType MUST be 0. The portal returns timestamps in Africa/Kampala (UTC+3).
 */
export async function getLivoltkSiteIntraday(
  client: LivoltkClient,
  siteId: number,
  date?: string,
): Promise<IntradayResult> {
  if (!date) {
    // Use Johannesburg local date (UTC+2)
    const joburg = new Date(Date.now() + 2 * 60 * 60 * 1000);
    date = joburg.toISOString().slice(0, 10);
  }
  const resp = await client.postJson('/sample/sampleByKeyCommon', {
    id:         siteId,
    startTime:  `${date} 00:00:00`,
    endTime:    `${date} 23:59:59`,
    timeType:   0,       // MUST be 0 — 1 or 2 return operate.failure
    objectType: 1,
    keys:       [...INTRADAY_KEYS],
  });
  const result: IntradayResult = {};
  const series = resp.data as Array<{ key?: string; value?: IntradayPoint[] }> | undefined;
  for (const s of series ?? []) {
    if (!s.key) continue;
    result[s.key] = (s.value ?? []).filter(pt => pt.value != null);
  }
  return result;
}

/**
 * Convert LIVOLTEK intraday data (portal timestamps in Africa/Kampala, UTC+3) to UTC
 * and upsert all rows into station_readings. Returns number of rows written.
 */
export async function upsertLivoltkIntradayReadings(
  stationId: string,
  intradayData: IntradayResult,
): Promise<number> {
  const merged = new Map<string, Record<string, unknown>>();

  const toUtc = (dt: string): string =>
    new Date(dt.replace(' ', 'T') + '+03:00').toISOString();

  for (const [key, points] of Object.entries(intradayData)) {
    for (const pt of points) {
      if (pt.value == null) continue;
      const utc = toUtc(pt.datetime);
      if (!merged.has(utc)) merged.set(utc, { station_id: stationId, recorded_at: utc });
      const row = merged.get(utc)!;
      switch (key) {
        case 'PV Power':       row.pv_power_kw      = pt.value; break;
        case 'Load Power':     row.load_power_kw    = pt.value; break;
        case 'SM_Activepower': row.grid_power_kw    = pt.value; break;
        case 'Battery power':  row.battery_power_kw = pt.value; break;
        case 'Battery SOC':    row.battery_soc      = pt.value; break;
      }
    }
  }

  const rows = Array.from(merged.values());
  if (rows.length === 0) return 0;
  await insertReadings(rows);
  return rows.length;
}
