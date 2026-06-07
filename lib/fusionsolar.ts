/**
 * Changa Energy — Huawei FusionSolar Northbound API Client (TypeScript)
 * ======================================================================
 * Ported from refresh_dashboard_data.py and test_fusionsolar_api.py.
 * All 5 Hoyo Hoyo plants confirmed working.
 * Runtime: Node.js 18+ (global fetch).
 *
 * TECHNICAL NOTES:
 *   1. Auth: POST /login → xsrf-token in response headers (set on all subsequent requests)
 *   2. Rate limit: Huawei enforces ~1 req/sec. Use CALL_DELAY = 1500ms between calls.
 *      failCode 407 = throttled. Retry with exponential backoff.
 *   3. Live inverter power: must be fetched per-station (getDevList → getDevRealKpi).
 *      Station KPIs (getStationRealKpi) are batched (all stations in one call).
 *   4. Health state: 1=disconnected, 2=faulty, 3=healthy
 *   5. EMI devices (typeId=10): Environmental Monitoring Instrument — weather/irradiance sensors.
 *      Provides ambient temperature, PV panel temperature, and solar irradiance.
 *      NOT a power meter — does NOT measure load/grid/battery power.
 *   6. Historical data:
 *      getKpiStationDay   — last ~5 completed days, all stations in one call
 *      getKpiStationMonth — last ~6 months, all stations in one call
 *      getKpiStationYear  — all years since commissioning, all stations in one call
 *   7. Alarms: getAlarmList returns all active alarms (empty when all plants healthy)
 *
 * BASE URL: https://intl.fusionsolar.huawei.com/thirdData
 */

import type {
  StationDef,
  StationRealKpi,
  DeviceEntry,
  DeviceRealKpi,
  StationListEntry,
  StationDashboardRecord,
  StationWeather,
  SmartMeterKpi,
  BatteryKpi,
  StationKpiDayRecord,
  StationKpiHourRecord,
  StationKpiMonthRecord,
  StationKpiYearRecord,
  FusionSolarAlarm,
  FusionSolarResponse,
} from '@/lib/types';

// ── Constants ──────────────────────────────────────────────────────────────────

/** ms between API calls — Huawei throttles at ~1 req/sec; 1500ms gives a comfortable buffer */
export const CALL_DELAY = 1500;

/** All 5 Changa Energy FusionSolar plants */
export const STATIONS: StationDef[] = [
  { code: 'NE=63896844', name: 'Hoyo Hoyo Khozeni',      location: 'Hoedspruit, Limpopo' },
  { code: 'NE=63899048', name: 'Hoyo Hoyo Khozeni 2',    location: 'Hoedspruit, Limpopo' },
  { code: 'NE=66423560', name: 'Hoyo Hoyo – Angelsview', location: 'Thaba Chweu, Mpumalanga' },
  { code: 'NE=65438276', name: 'Hoyo Hoyo Machado',      location: 'Emakhazeni, Mpumalanga' },
  { code: 'NE=65385858', name: 'Hoyo Hoyo – Acorn',      location: 'Hoedspruit, Limpopo' },
];

/** Known failCodes */
const FAIL_CODES: Record<number, string> = {
  305:   'Account locked — too many failed logins. Contact Huawei support.',
  306:   'Wrong password.',
  407:   'Too many concurrent requests — rate limited.',
  401:   'Session token expired — re-login required.',
  20001: 'Insufficient permissions for this endpoint.',
};

// ── Env loader ─────────────────────────────────────────────────────────────────

export function loadFusionSolarEnv(): {
  username: string;
  password: string;
  baseUrl: string;
} {
  const username = process.env.FUSIONSOLAR_USERNAME;
  const password = process.env.FUSIONSOLAR_PASSWORD;
  const baseUrl  = process.env.FUSIONSOLAR_BASE_URL ?? 'https://intl.fusionsolar.huawei.com/thirdData';

  if (!username || !password) {
    throw new Error('Missing FUSIONSOLAR_USERNAME or FUSIONSOLAR_PASSWORD environment variables');
  }

  return { username, password, baseUrl };
}

// ── Client class ───────────────────────────────────────────────────────────────

export class FusionSolarClient {
  private username: string;
  private password: string;
  readonly baseUrl: string;
  private xsrfToken: string | null = null;

  constructor(username: string, password: string, baseUrl: string) {
    this.username = username;
    this.password = password;
    this.baseUrl  = baseUrl;
  }

  sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /** POST to the FusionSolar Northbound API with retry on 407 (rate limit). */
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

      // Capture xsrf-token if present
      const newToken = res.headers.get('xsrf-token');
      if (newToken) {
        this.xsrfToken = newToken;
        headers['xsrf-token'] = newToken;
      }

      const result = await res.json() as FusionSolarResponse<T>;

      if (result.failCode === 407) {
        const wait = CALL_DELAY * (attempt + 2);
        console.log(`  [rate limited on /${endpoint}] waiting ${wait}ms before retry...`);
        await this.sleep(wait);
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
      const body = await res.json() as FusionSolarResponse;
      const code = body.failCode ?? -1;
      console.error(`Login failed: ${FAIL_CODES[code] ?? `failCode=${code}`}`);
      return false;
    }

    this.xsrfToken = token;
    console.log(`  Token acquired: ${token.slice(0, 10)}...`);
    return true;
  }
}

// ── API functions ──────────────────────────────────────────────────────────────

/**
 * Fetch station list (paginated, first 100).
 * Returns array of { stationCode, stationName, capacity, ... }
 */
export async function getStationList(
  client: FusionSolarClient,
): Promise<StationListEntry[]> {
  const res = await client.apiPost<{ list?: StationListEntry[] } | StationListEntry[]>(
    'getStationList',
    { pageNo: 1, pageSize: 100 },
  );

  if (!res.data) return [];
  if (Array.isArray(res.data)) return res.data;
  return res.data.list ?? [];
}

/**
 * Batch fetch real-time KPIs for all stations in one API call.
 * Returns: Map<stationCode, StationRealKpi>
 */
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
    if (entry && entry.stationCode) {
      kpiMap.set(entry.stationCode, entry.dataItemMap ?? {});
    }
  }
  return kpiMap;
}

/**
 * Get device list for a station.
 * Returns array of device entries; use devTypeId === 1 to filter inverters.
 */
export async function getDevList(
  client: FusionSolarClient,
  stationCode: string,
): Promise<DeviceEntry[]> {
  const res = await client.apiPost<DeviceEntry[]>('getDevList', { stationCodes: stationCode });
  return res.data ?? [];
}

/**
 * Get real-time KPIs for one or more devices.
 * devIds: comma-separated device ID string (e.g. "12345,67890")
 */
export async function getDevRealKpi(
  client: FusionSolarClient,
  devIds: string,
  devTypeId = 1,
): Promise<Array<{ devId: number; dataItemMap: DeviceRealKpi }>> {
  const res = await client.apiPost<Array<{ devId: number; dataItemMap: DeviceRealKpi }>>(
    'getDevRealKpi',
    { devIds, devTypeId },
  );
  return res.data ?? [];
}

// ── Extended API functions ─────────────────────────────────────────────────────

/** Convert unix ms timestamp to "YYYY-MM-DD" string */
function msToDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Normalize a field that may be a number, numeric string, or "N/A" */
function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === 'N/A' || v === '') return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

/**
 * Get weather/irradiance data from the EMI device (typeId=10) at a station.
 */
export async function getWeatherData(
  client: FusionSolarClient,
  stationCode: string,
): Promise<StationWeather | null> {
  const devices = await getDevList(client, stationCode);
  const emi = devices.find(d => d.devTypeId === 10);
  if (!emi) return null;

  await client.sleep(CALL_DELAY);

  const res = await client.apiPost<Array<{ devId: number; dataItemMap: Record<string, unknown> }>>(
    'getDevRealKpi',
    { devIds: String(emi.id), devTypeId: 10 },
  );

  const entry = res.data?.[0];
  if (!entry) return null;
  const m = entry.dataItemMap ?? {};

  return {
    stationCode,
    devId:           entry.devId,
    temperature:     numOrNull(m['temperature']),
    pvTemperature:   numOrNull(m['pv_temperature']),
    irradianceLive:  numOrNull(m['radiant_line']),
    irradianceTotal: numOrNull(m['radiant_total']),
    runState:        Number(m['run_state'] ?? 0),
  };
}

/**
 * Daily PV yield history for one or more stations — single API call.
 * Returns ~5 recent completed days per station.
 */
export async function getStationKpiDay(
  client: FusionSolarClient,
  stationCodes: string[],
  date?: Date,
): Promise<StationKpiDayRecord[]> {
  const anchor = date ?? new Date(Date.now() - 86400000);
  anchor.setHours(12, 0, 0, 0);

  const res = await client.apiPost<Array<{
    collectTime: number;
    stationCode: string;
    dataItemMap: Record<string, unknown>;
  }>>(
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

/**
 * Hourly PV yield history for one or more stations — single API call.
 *
 * Undocumented Northbound endpoint discovered via live probe (June 2026).
 * Returns 24 records per station for the calendar day containing `date`.
 * The `collectTime` anchor must be a unix-ms timestamp (integer) — string
 * dates return failCode=None (HTTP error). Same sliding-window rules as
 * getKpiStationDay apply: anchor must be within ~90 days of today.
 *
 * inverterPower: kWh generated during that hour (null at night / missing).
 *                Numerically equals average kW for that hour.
 * radiationIntensity: kWh/m² solar irradiance (from EMI sensor if present).
 */
export async function getStationKpiHour(
  client: FusionSolarClient,
  stationCodes: string[],
  date?: Date,
): Promise<StationKpiHourRecord[]> {
  const anchor = date ?? new Date(Date.now() - 86400000);
  anchor.setHours(12, 0, 0, 0);

  const res = await client.apiPost<Array<{
    collectTime: number;
    stationCode: string;
    dataItemMap: Record<string, unknown>;
  }>>(
    'getKpiStationHour',
    { stationCodes: stationCodes.join(','), collectTime: anchor.getTime() },
  );

  return (res.data ?? []).map(entry => {
    const m = entry.dataItemMap ?? {};
    const raw = m['inverter_power'];
    const rad = m['radiation_intensity'];
    return {
      collectTime:       entry.collectTime,
      hour:              new Date(entry.collectTime).toISOString(),
      stationCode:       entry.stationCode,
      inverterPower:     raw !== null && raw !== undefined ? Number(raw) : null,
      radiationIntensity: rad !== null && rad !== undefined ? Number(rad) : null,
    };
  }).sort((a, b) => a.collectTime - b.collectTime);
}

/**
 * Monthly PV yield history for one or more stations — single API call.
 * Returns ~6 recent completed months per station.
 */
export async function getStationKpiMonth(
  client: FusionSolarClient,
  stationCodes: string[],
  date?: Date,
): Promise<StationKpiMonthRecord[]> {
  const anchor = date ?? new Date();
  anchor.setDate(1);
  anchor.setHours(12, 0, 0, 0);

  const res = await client.apiPost<Array<{
    collectTime: number;
    stationCode: string;
    dataItemMap: Record<string, unknown>;
  }>>(
    'getKpiStationMonth',
    { stationCodes: stationCodes.join(','), collectTime: anchor.getTime() },
  );

  return (res.data ?? []).map(entry => {
    const m = entry.dataItemMap ?? {};
    return {
      collectTime:        entry.collectTime,
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

/**
 * Annual PV yield history for one or more stations — single API call.
 * Returns all calendar years since plant commissioning.
 */
export async function getStationKpiYear(
  client: FusionSolarClient,
  stationCodes: string[],
  date?: Date,
): Promise<StationKpiYearRecord[]> {
  const anchor = date ?? new Date();
  anchor.setMonth(0, 1);
  anchor.setHours(12, 0, 0, 0);

  const res = await client.apiPost<Array<{
    collectTime: number;
    stationCode: string;
    dataItemMap: Record<string, unknown>;
  }>>(
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

/**
 * Fetch active alarms for one or more stations.
 * Returns an empty array when all plants are healthy.
 */
export async function getAlarms(
  client: FusionSolarClient,
  stationCodes: string[],
): Promise<FusionSolarAlarm[]> {
  const res = await client.apiPost<FusionSolarAlarm[]>(
    'getAlarmList',
    { stationCodes: stationCodes.join(','), language: 'en' },
  );
  return res.data ?? [];
}

/**
 * Fetch real-time grid meter data from a Huawei smart meter (devTypeId=17).
 * Returns null immediately if no meter is registered at the station.
 */
export async function getSmartMeterData(
  client: FusionSolarClient,
  stationCode: string,
  devices?: DeviceEntry[],
): Promise<SmartMeterKpi | null> {
  const devList = devices ?? await getDevList(client, stationCode);
  const meter   = devList.find(d => d.devTypeId === 17);
  if (!meter) return null;

  await client.sleep(CALL_DELAY);
  const res = await client.apiPost<Array<{ devId: number; dataItemMap: SmartMeterKpi }>>(
    'getDevRealKpi',
    { devIds: String(meter.id), devTypeId: 17 },
  );
  return res.data?.[0]?.dataItemMap ?? null;
}

/**
 * Fetch real-time battery / ESS data from a Huawei LUNA2000 battery (devTypeId=39).
 * Returns null immediately if no battery is registered at the station.
 */
export async function getBatteryData(
  client: FusionSolarClient,
  stationCode: string,
  devices?: DeviceEntry[],
): Promise<BatteryKpi | null> {
  const devList = devices ?? await getDevList(client, stationCode);
  const battery = devList.find(d => d.devTypeId === 39);
  if (!battery) return null;

  await client.sleep(CALL_DELAY);
  const res = await client.apiPost<Array<{ devId: number; dataItemMap: BatteryKpi }>>(
    'getDevRealKpi',
    { devIds: String(battery.id), devTypeId: 39 },
  );
  return res.data?.[0]?.dataItemMap ?? null;
}

// ── Dashboard data assembler ───────────────────────────────────────────────────

/**
 * Fetch all data needed for the dashboard:
 *   1. Station KPIs (batched — one call)
 *   2. Live inverter power per station (sequential with delays to avoid 407)
 *
 * Returns array of StationDashboardRecord, one per station, in same order as stations param.
 * CRITICAL: getStationRealKpis MUST be called before any per-station device calls.
 */
export async function fetchDashboardData(
  client: FusionSolarClient,
  stations: StationDef[] = STATIONS,
): Promise<StationDashboardRecord[]> {
  // Step 1: station KPIs (single batch call)
  console.log('Fetching station KPIs...');
  const codes = stations.map(s => s.code);
  const kpiMap = await getStationRealKpis(client, codes);
  await client.sleep(CALL_DELAY);

  // Step 2: live inverter power + EMI weather data per station
  console.log('Fetching live inverter power and weather data for each station...');
  const livePower   = new Map<string, number | null>();
  const weatherMap  = new Map<string, StationWeather | null>();
  const meterMap    = new Map<string, SmartMeterKpi | null>();
  const batteryMap  = new Map<string, BatteryKpi | null>();

  for (const station of stations) {
    process.stdout.write(`  ${station.name}... `);

    // Get device list — one call covers inverters, EMI, meter, battery
    const devices    = await getDevList(client, station.code);
    const inverters  = devices.filter(d => d.devTypeId === 1);
    const emiDevice  = devices.find(d => d.devTypeId === 10) ?? null;
    const meterDev   = devices.find(d => d.devTypeId === 17) ?? null;
    const batteryDev = devices.find(d => d.devTypeId === 39) ?? null;
    await client.sleep(CALL_DELAY);

    // Live inverter power
    if (inverters.length === 0) {
      livePower.set(station.code, null);
      process.stdout.write('no inverters | ');
    } else {
      const ids  = inverters.map(d => String(d.id)).join(',');
      const kpis = await getDevRealKpi(client, ids, 1);
      if (kpis.length > 0) {
        const total = kpis.reduce((sum, k) => {
          const power = Number(k.dataItemMap?.active_power ?? 0);
          return sum + (isNaN(power) ? 0 : power);
        }, 0);
        livePower.set(station.code, Math.round(total * 100) / 100);
        process.stdout.write(`${total.toFixed(2)} kW | `);
      } else {
        livePower.set(station.code, null);
        process.stdout.write('no inverter data | ');
      }
      await client.sleep(CALL_DELAY);
    }

    // EMI weather data
    if (!emiDevice) {
      weatherMap.set(station.code, null);
      console.log('no EMI sensor');
    } else {
      const emiRes = await client.apiPost<Array<{ devId: number; dataItemMap: Record<string, unknown> }>>(
        'getDevRealKpi',
        { devIds: String(emiDevice.id), devTypeId: 10 },
      );
      const emiEntry = emiRes.data?.[0];
      if (emiEntry) {
        const m = emiEntry.dataItemMap ?? {};
        const weather: StationWeather = {
          stationCode:     station.code,
          devId:           emiEntry.devId,
          temperature:     numOrNull(m['temperature']),
          pvTemperature:   numOrNull(m['pv_temperature']),
          irradianceLive:  numOrNull(m['radiant_line']),
          irradianceTotal: numOrNull(m['radiant_total']),
          runState:        Number(m['run_state'] ?? 0),
        };
        weatherMap.set(station.code, weather);
        console.log(`${weather.temperature ?? '?'}°C | ${weather.irradianceLive ?? '?'} W/m²`);
      } else {
        weatherMap.set(station.code, null);
        console.log('no EMI data');
      }
      await client.sleep(CALL_DELAY);
    }

    // Smart meter (grid power) — no-op if no meter registered
    if (!meterDev) {
      meterMap.set(station.code, null);
    } else {
      const mRes = await client.apiPost<Array<{ devId: number; dataItemMap: SmartMeterKpi }>>(
        'getDevRealKpi',
        { devIds: String(meterDev.id), devTypeId: 17 },
      );
      meterMap.set(station.code, mRes.data?.[0]?.dataItemMap ?? null);
      await client.sleep(CALL_DELAY);
    }

    // Battery (LUNA2000 ESS) — no-op if no battery registered
    if (!batteryDev) {
      batteryMap.set(station.code, null);
    } else {
      const bRes = await client.apiPost<Array<{ devId: number; dataItemMap: BatteryKpi }>>(
        'getDevRealKpi',
        { devIds: String(batteryDev.id), devTypeId: 39 },
      );
      batteryMap.set(station.code, bRes.data?.[0]?.dataItemMap ?? null);
      await client.sleep(CALL_DELAY);
    }
  }

  // Assemble results
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
      name:         station.name,
      loc:          station.location,
      day:          Math.round((Number(kpi.day_power   ?? 0)) * 100) / 100,
      total:        Math.round((Number(kpi.total_power ?? 0)) * 100) / 100,
      month:        Math.round((Number(kpi.month_power ?? 0)) * 100) / 100,
      health:       Number(kpi.real_health_state ?? 3),
      live:         pvLive,
      temperature:  weather?.temperature    ?? null,
      irradiance:   weather?.irradianceLive ?? null,
      gridPower,
      loadPower,
      batterySOC:   battery?.battery_soc          !== undefined ? Math.round(battery.battery_soc) : null,
      batteryPower: battery?.ch_discharge_power    !== undefined ? Math.round(battery.ch_discharge_power * 100) / 100 : null,
    };
  });
}
