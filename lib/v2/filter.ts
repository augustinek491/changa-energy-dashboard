// Changa OneView — fleet filter model shared by the Stations directory and the
// Fleet Map. One FilterState drives both views via a console-wide context, so a
// filter set on Stations carries over to the Map (and back).

import { Station, Status, statusOf, capacityKw } from './fleet';
import { oemMeta } from './brand';
import { parseLocation } from './geo';

export type CapacityBand = 'all' | 'lt5' | 'b5_20' | 'b20_50' | 'gt50';

export interface FilterState {
  search: string;
  oem: string[];      // oem keys; empty = all
  status: Status[];   // empty = all
  province: string[]; // province names; empty = all
  capacity: CapacityBand;
}

export const EMPTY_FILTER: FilterState = {
  search: '', oem: [], status: [], province: [], capacity: 'all',
};

export const STATUS_META: { key: Status; label: string; color: string }[] = [
  { key: 'online', label: 'Online', color: 'var(--accent)' },
  { key: 'alarm', label: 'Alarm', color: 'var(--status-alarm)' },
  { key: 'offline', label: 'Offline', color: 'var(--status-offline)' },
];

export const CAPACITY_BANDS: { key: CapacityBand; label: string }[] = [
  { key: 'all', label: 'Any size' },
  { key: 'lt5', label: 'Under 5 kWp' },
  { key: 'b5_20', label: '5 – 20 kWp' },
  { key: 'b20_50', label: '20 – 50 kWp' },
  { key: 'gt50', label: 'Over 50 kWp' },
];

function inBand(kw: number, band: CapacityBand): boolean {
  switch (band) {
    case 'lt5': return kw > 0 && kw < 5;
    case 'b5_20': return kw >= 5 && kw < 20;
    case 'b20_50': return kw >= 20 && kw < 50;
    case 'gt50': return kw >= 50;
    default: return true;
  }
}

/** Province a station resolves to (reuses the map's location parser). */
export function stationProvince(s: Station): string {
  return parseLocation(s.location).province;
}

export function applyFilters(stations: Station[], f: FilterState): Station[] {
  const q = f.search.trim().toLowerCase();
  return stations.filter(s => {
    if (f.status.length && !f.status.includes(statusOf(s))) return false;
    if (f.oem.length && !f.oem.includes(oemMeta(s.source).key)) return false;
    if (f.province.length && !f.province.includes(stationProvince(s))) return false;
    if (f.capacity !== 'all' && !inBand(capacityKw(s), f.capacity)) return false;
    if (q && !`${s.name} ${s.location ?? ''}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

export function activeFilterCount(f: FilterState): number {
  return f.oem.length + f.status.length + f.province.length
    + (f.capacity !== 'all' ? 1 : 0) + (f.search.trim() ? 1 : 0);
}

export function isFilterActive(f: FilterState): boolean {
  return activeFilterCount(f) > 0;
}

export interface Facets {
  total: number;
  status: { key: Status; label: string; color: string; count: number }[];
  oems: { key: string; label: string; color: string; count: number }[];
  provinces: { key: string; label: string; count: number }[];
}

/** Fleet-wide counts per facet, for the filter menus. */
export function computeFacets(stations: Station[]): Facets {
  const status: Record<Status, number> = { online: 0, alarm: 0, offline: 0 };
  const oem = new Map<string, { label: string; color: string; count: number }>();
  const prov = new Map<string, number>();
  for (const s of stations) {
    status[statusOf(s)] += 1;
    const m = oemMeta(s.source);
    const e = oem.get(m.key) ?? { label: m.label, color: m.color, count: 0 };
    e.count += 1;
    oem.set(m.key, e);
    const p = stationProvince(s);
    if (p && p !== 'Unknown') prov.set(p, (prov.get(p) ?? 0) + 1);
  }
  return {
    total: stations.length,
    status: STATUS_META.map(m => ({ ...m, count: status[m.key] })),
    oems: [...oem.entries()].map(([key, v]) => ({ key, ...v })).sort((a, b) => b.count - a.count),
    provinces: [...prov.entries()].map(([key, count]) => ({ key, label: key, count })).sort((a, b) => b.count - a.count),
  };
}
