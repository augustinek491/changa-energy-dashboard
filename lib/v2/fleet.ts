// Changa OneView — fleet data shape + derivations.
// Consumes the existing /api/dashboard/fleet response (unchanged) and adds
// status classification, OEM grouping, and money rollups for the console.

import { OemKey, oemMeta, valueOfEnergy } from './brand';

export interface StationLive {
  pv_power_kw: number | null;
  load_power_kw: number | null;
  battery_soc: number | null;
  health_state: number | null;
  status: number | null;
  today_kwh: number | null;
  month_kwh: number | null;
  total_kwh: number | null;
  fetched_at: string;
}

export interface Station {
  id: string;
  name: string;
  source: string;
  location: string | null;
  capacity_kw: number | null;
  live: StationLive | null;
  alarm_count: number;
}

export interface FleetSummary {
  total: number;
  online: number;
  alarm: number;
  offline: number;
  open_alarms: number;
  total_pv_kw: number;
  total_today_kwh: number;
  total_month_kwh: number;
  total_lifetime_kwh: number;
}

export interface FleetData {
  stations: Station[];
  summary: FleetSummary;
}

export type Status = 'online' | 'alarm' | 'offline';

/** Normalise OEM-specific health codes into one status vocabulary. */
export function statusOf(s: Pick<Station, 'source' | 'live'>): Status {
  const l = s.live;
  if (!l) return 'offline';
  if (s.source === 'fusionsolar') {
    if (l.health_state === 3) return 'online';
    if (l.health_state === 2) return 'alarm';
    return 'offline';
  }
  // livoltek + others
  if (l.status === 1) return 'online';
  if (l.status === 4) return 'alarm';
  return 'offline';
}

/** Capacity in kW. LIVOLTEK reports Wp (÷1000); FusionSolar already kW. */
export function capacityKw(s: Station): number {
  const c = s.capacity_kw ?? 0;
  if (c <= 0) return 0;
  return s.source === 'livoltek' && c > 1000 ? c / 1000 : c;
}

/** Performance ratio proxy: live kW ÷ capacity kW (0–1+, clamped display). */
export function loadFactor(s: Station): number | null {
  const cap = capacityKw(s);
  const pv = s.live?.pv_power_kw ?? null;
  if (!cap || pv == null) return null;
  return pv / cap;
}

export interface OemGroup {
  key: OemKey | string;
  label: string;
  color: string;
  live: boolean;
  stations: Station[];
  online: number;
  alarm: number;
  offline: number;
  pvKw: number;
  todayKwh: number;
  capacityKw: number;
}

/** Group stations by manufacturer with per-group rollups. */
export function groupByOem(stations: Station[]): OemGroup[] {
  const map = new Map<string, OemGroup>();
  for (const s of stations) {
    const m = oemMeta(s.source);
    let g = map.get(m.key);
    if (!g) {
      g = {
        key: m.key, label: m.label, color: m.color, live: m.live,
        stations: [], online: 0, alarm: 0, offline: 0,
        pvKw: 0, todayKwh: 0, capacityKw: 0,
      };
      map.set(m.key, g);
    }
    g.stations.push(s);
    const st = statusOf(s);
    g[st] += 1;
    g.pvKw += s.live?.pv_power_kw ?? 0;
    g.todayKwh += s.live?.today_kwh ?? 0;
    g.capacityKw += capacityKw(s);
  }
  // Live integrations first, then by station count
  return [...map.values()].sort(
    (a, b) => Number(b.live) - Number(a.live) || b.stations.length - a.stations.length,
  );
}

/** Stations needing a human: offline, in alarm, or zero-gen during daylight. */
export function needsAttention(stations: Station[]): Station[] {
  const hour = new Date().getHours();
  const daylight = hour >= 7 && hour <= 17;
  return stations
    .filter(s => {
      const st = statusOf(s);
      if (st !== 'online') return true;
      if (s.alarm_count > 0) return true;
      if (daylight && (s.live?.pv_power_kw ?? 0) <= 0.05) return true;
      return false;
    })
    .sort((a, b) => {
      const rank = (s: Station) => (statusOf(s) === 'offline' ? 0 : statusOf(s) === 'alarm' ? 1 : 2);
      return rank(a) - rank(b) || b.alarm_count - a.alarm_count;
    });
}

/** Money rollups for a period's energy (today / month). */
export function fleetMoney(summary: FleetSummary) {
  return {
    today: valueOfEnergy(summary.total_today_kwh),
    month: valueOfEnergy(summary.total_month_kwh),
    lifetime: valueOfEnergy(summary.total_lifetime_kwh),
  };
}
