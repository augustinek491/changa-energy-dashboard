/**
 * Changa Energy — LIVOLTEK Portal API Client (TypeScript)
 * ========================================================
 * Ported from livoltek_portal_api.py — all endpoints confirmed working 2026-06-05.
 * Runtime: Node.js 18+ (global fetch, node:crypto for MD5).
 *
 * KEY TECHNICAL NOTES:
 *   1. Two-step auth: NBP login (JSON + MD5 password) → ctrller-manager session (form-urlencoded)
 *   2. Most endpoints: POST application/x-www-form-urlencoded
 *   3. Select endpoints: POST application/json (findAllByCustomer, barChat, sampleByKeyCommon, etc.)
 *   4. CRITICAL HEADERS:
 *      - "timeZone": "Africa/Kampala"  (capital Z, NOT "timezone: UTC")
 *      - "language": "en"
 *      - "Referer": "https://evs.livoltek-portal.com/"
 *      Sending wrong timezone causes sampleByKeyCommon to return null values throughout.
 *   5. sampleByKeyCommon: timeType MUST be 0 (not 1 or 2), objectType: 1
 *   6. findOne: POST with URL query params ?id=<siteId>&isUseChangeUnit=true
 *
 * ACCOUNT NOTE:
 *   Customer token: sufficient for findOne, findAllByCustomer, barChat, stationStateEnergy, etc.
 *   Operator token: required for sampleByKeyCommon (intraday) and getToBSample (per-site yield).
 */

import * as crypto from 'node:crypto';

import type {
  FleetLive,
  FleetCounts,
  FleetKpi,
  SiteSummary,
  SiteLive,
  NamedSeries,
  IntradayData,
  Alarm,
  LivoltkLoginResponse,
} from '@/lib/types';

// ── Constants ──────────────────────────────────────────────────────────────────

const NBP_BASE  = 'https://evs.livoltek-portal.com/nbp';
const CTRL_BASE = 'https://evs.livoltek-portal.com/ctrller-manager';
const REFERER   = 'https://evs.livoltek-portal.com/';

/**
 * CRITICAL: capital Z, Africa/Kampala (UTC+3).
 * The portal sends this header with every request.
 * Using lowercase "timezone: UTC" causes sampleByKeyCommon to return null values.
 */
const PORTAL_TIMEZONE = 'Africa/Kampala';

/** Exact channel name strings the portal uses for sampleByKeyCommon */
export const INTRADAY_KEYS = [
  'Battery power',
  'PV Power',
  'Load Power',
  'SM_Activepower',
  'Battery SOC',
] as const;

/** All 16 Changa Energy LIVOLTEK site IDs */
export const ALL_SITE_IDS = [
  24164, 24728, 26205, 26231, 26236, 26255, 26260, 26269,
  26386, 26387, 26388, 26389, 26390, 26415, 26431, 28964,
];

// ── Env loader ─────────────────────────────────────────────────────────────────

export function loadLivoltkEnv(): {
  email: string;
  password: string;
  accountType: string;
} {
  const email       = process.env.LIVOLTEK_PORTAL_EMAIL;
  const password    = process.env.LIVOLTEK_PORTAL_PASSWORD;
  const accountType = process.env.LIVOLTEK_ACCOUNT_TYPE ?? 'customer';

  if (!email || !password) {
    throw new Error('Missing LIVOLTEK_PORTAL_EMAIL or LIVOLTEK_PORTAL_PASSWORD environment variables');
  }

  return { email, password, accountType };
}

// ── Client class ───────────────────────────────────────────────────────────────

export class LivoltkClient {
  private email: string;
  private password: string;
  private accountType: string;
  private token: string | null = null;
  private tokenExpiry = 0;

  /** Persistent headers sent with every request — matches browser exactly */
  private baseHeaders: Record<string, string> = {
    language:   'en',
    timeZone:   PORTAL_TIMEZONE,
    Referer:    REFERER,
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  };

  constructor(email: string, password: string, accountType = 'customer') {
    this.email       = email;
    this.password    = password;
    this.accountType = accountType;
  }

  private md5(s: string): string {
    return crypto.createHash('md5').update(s).digest('hex');
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async login(): Promise<boolean> {
    // Step 1: NBP login — JSON body, MD5-hashed password
    const nbpBody = JSON.stringify({
      login_account: this.email,
      password:      this.md5(this.password),
      account_type:  'account',
      language:      'en',
      device_type:   0,
    });

    const nbpRes = await fetch(`${NBP_BASE}/login/${this.accountType}`, {
      method: 'POST',
      headers: {
        ...this.baseHeaders,
        'Content-Type': 'application/json',
      },
      body: nbpBody,
    });

    const nbpData = await nbpRes.json() as LivoltkLoginResponse;
    if (nbpData.msg_code !== 'operate.success' || !nbpData.data?.access_token) {
      console.error('NBP login failed:', nbpData);
      return false;
    }

    this.token = nbpData.data.access_token;
    const expiryMs = nbpData.data.session_expiry_time ?? 0;
    this.tokenExpiry = expiryMs
      ? expiryMs / 1000 - 3600
      : Date.now() / 1000 + 86400 * 29;

    this.baseHeaders['Authorization'] = `Bearer ${this.token}`;

    // Step 2: ctrller-manager session login — form-urlencoded, no body
    const ctrlRes = await fetch(`${CTRL_BASE}/login/login`, {
      method: 'POST',
      headers: {
        ...this.baseHeaders,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: '',
    });

    const ctrlData = await ctrlRes.json() as { msg_code: string };
    if (ctrlData.msg_code !== 'operate.success') {
      console.error('ctrller-manager login failed:', ctrlData);
      return false;
    }

    console.log(`✓ Login successful — account: ${this.accountType}`);
    return true;
  }

  async ensureAuth(): Promise<void> {
    if (!this.token || Date.now() / 1000 > this.tokenExpiry) {
      const ok = await this.login();
      if (!ok) throw new Error('LIVOLTEK authentication failed');
    }
  }

  /**
   * POST with application/x-www-form-urlencoded.
   * params: appended as URL query string (e.g. ?id=28964&isUseChangeUnit=true)
   * data:   form body fields (most endpoints take no body)
   */
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
      headers: {
        ...this.baseHeaders,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: bodyStr,
    });

    return res.json() as Promise<Record<string, unknown>>;
  }

  /**
   * POST with application/json body.
   * Used by: findAllByCustomer, barChat, sampleByKeyCommon, findAllFilter, getToBSample, etc.
   */
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
      headers: {
        ...this.baseHeaders,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    return res.json() as Promise<Record<string, unknown>>;
  }
}

// ── Data fetchers ──────────────────────────────────────────────────────────────

/**
 * Fleet live power and energy totals.
 * POST /powerstation/stationStateEnergy (form-urlencoded, no body).
 */
export async function getFleetLive(client: LivoltkClient): Promise<FleetLive> {
  const resp = await client.postForm('/powerstation/stationStateEnergy');
  return (resp.data ?? {}) as FleetLive;
}

/**
 * Fleet device counts.
 */
export async function getFleetCounts(client: LivoltkClient): Promise<FleetCounts> {
  const resp = await client.postForm('/powerstation/totalCount');
  return (resp.data ?? {}) as FleetCounts;
}

/**
 * Fleet KPI summary cards.
 */
export async function getFleetKpis(client: LivoltkClient): Promise<FleetKpi[]> {
  const resp = await client.postForm('/customer/customerData');
  return (resp.data as FleetKpi[]) ?? [];
}

/**
 * All 16 sites with per-site summary data.
 * POST /powerstation/findAllByCustomer (JSON body).
 */
export async function getAllSites(client: LivoltkClient): Promise<SiteSummary[]> {
  const resp = await client.postJson(
    '/powerstation/findAllByCustomer',
    { start: 1, pageSize: 100, name: '' },
    { isUseChangeUnit: 'false' }, // base units only — see getSiteLive note
  );
  return (resp.data as SiteSummary[]) ?? [];
}

/**
 * Daily energy time series for the fleet (30-day chart).
 * POST /endUser/data/barChat (JSON body).
 */
export async function getEnergyChart(
  client: LivoltkClient,
  startDate?: string,
  endDate?: string,
): Promise<NamedSeries[]> {
  if (!startDate) {
    const today = new Date();
    startDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;
    endDate = today.toISOString().slice(0, 10);
  }
  const resp = await client.postJson('/endUser/data/barChat', {
    startTime: `${startDate} 00:00:00`,
    endTime:   `${endDate} 23:59:59`,
    timeType:  1,
    objectType: '1',
  });
  return (resp.data as NamedSeries[]) ?? [];
}

/**
 * Per-site daily solar yield time series.
 * REQUIRES OPERATOR TOKEN — returns empty with customer token.
 */
export async function getSiteYield(
  client: LivoltkClient,
  siteId: number,
  startDate?: string,
  endDate?: string,
): Promise<NamedSeries[]> {
  if (!startDate) {
    const today = new Date();
    startDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;
    endDate = today.toISOString().slice(0, 10);
  }
  const resp = await client.postJson('/homePage/getToBSample', {
    timeType: 1,
    id: siteId,
    objectType: 2,
    startTime: `${startDate} 00:00:00`,
    endTime:   `${endDate} 23:59:59`,
  });
  const data = resp.data as NamedSeries[][] | undefined;
  return (data && data[0]) ? data[0] : [];
}

/**
 * Per-site daily battery charge and discharge energy (kWh).
 */
export async function getSiteBatteryChart(
  client: LivoltkClient,
  siteId: number,
  startDate?: string,
  endDate?: string,
): Promise<NamedSeries[]> {
  if (!startDate) {
    const today = new Date();
    startDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;
    endDate = today.toISOString().slice(0, 10);
  }
  const resp = await client.postJson('/endUser/data/barChat', {
    startTime: `${startDate} 00:00:00`,
    endTime:   `${endDate} 23:59:59`,
    timeType:  1,
    objectType: '2',
    id: siteId,
  });
  return (resp.data as NamedSeries[]) ?? [];
}

/**
 * Per-site live telemetry — THE definitive per-site live data endpoint.
 * POST /powerstation/findOne?id=<siteId>&isUseChangeUnit=true (form-urlencoded, no body).
 * Works with CUSTOMER token.
 */
export async function getSiteLive(
  client: LivoltkClient,
  siteId: number,
): Promise<SiteLive> {
  const resp = await client.postForm('/powerstation/findOne', {
    id: siteId,
    // 'false' = stable base units (kWh/kW/kWp). 'true' auto-rescales month &
    // lifetime to MWh and ships the unit in a separate field, which the
    // ingestion ignores — storing values 1000x too small. See _shared/index.ts.
    isUseChangeUnit: 'false',
  });
  return (resp.data ?? { id: siteId }) as SiteLive;
}

/**
 * Fetch live telemetry for all sites concurrently using getSiteLive().
 * Uses Promise.allSettled — individual site failures don't abort the batch.
 */
export async function getAllSitesLive(
  client: LivoltkClient,
  siteIds: number[] = ALL_SITE_IDS,
): Promise<SiteLive[]> {
  const results = await Promise.allSettled(
    siteIds.map(id => getSiteLive(client, id))
  );

  return results.map((result, i) => {
    if (result.status === 'fulfilled') return result.value;
    return { id: siteIds[i], _error: String(result.reason) } as SiteLive;
  });
}

/**
 * Intraday 5-minute time series for a site — 5 channels.
 * REQUIRES OPERATOR TOKEN.
 * CRITICAL: timeType MUST be 0. timeZone header MUST be Africa/Kampala.
 */
export async function getSiteIntraday(
  client: LivoltkClient,
  siteId: number,
  date?: string,
  keys: readonly string[] = INTRADAY_KEYS,
): Promise<IntradayData> {
  if (!date) {
    const now = new Date();
    const joburg = new Date(now.getTime() + 2 * 60 * 60 * 1000);
    date = joburg.toISOString().slice(0, 10);
  }

  const resp = await client.postJson('/sample/sampleByKeyCommon', {
    id:         siteId,
    startTime:  `${date} 00:00:00`,
    endTime:    `${date} 23:59:59`,
    timeType:   0,          // CRITICAL: must be 0, not 1 or 2
    objectType: 1,
    keys:       [...keys],
  });

  const result: IntradayData = {};
  const data = resp.data as Array<{ key?: string; value?: Array<{ value: number | null; datetime: string; original?: boolean }> }> | undefined;

  for (const series of data ?? []) {
    const key = series.key;
    if (!key) continue;
    result[key] = (series.value ?? []).filter(pt => pt.value !== null && pt.value !== undefined);
  }

  return result;
}

/**
 * All alarms within the last N days.
 * POST /alarm/findAllFilter (JSON body).
 */
export async function getAlarms(
  client: LivoltkClient,
  days = 1,
): Promise<Alarm[]> {
  const now = new Date();
  const start = new Date(now.getTime() - days * 86400 * 1000);
  const fmt = (d: Date) => d.toISOString().replace('Z', '').slice(0, 23) + '.000Z';

  const resp = await client.postJson('/alarm/findAllFilter', {
    powerStationFilter: [],
    filterTime: [fmt(start), fmt(now)],
    pageSize: 100,
    start: 1,
  });

  return (resp.data as Alarm[]) ?? [];
}
