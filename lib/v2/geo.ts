// Changa OneView — geography for the SA fleet map.
// Stations carry a location string (LIVOLTEK: "<pluscode> <Town>, South Africa";
// FusionSolar: "<Town>, <Province>"). At national zoom, sub-town precision is
// irrelevant, so we resolve each station to its town and cluster sites by town.

import { Station, Status, statusOf, capacityKw } from './fleet';

// Approximate town centres, [lng, lat] (d3-geo order).
const TOWN_COORDS: Record<string, [number, number]> = {
  Randburg: [27.9772, -26.0936],
  Acornhoek: [31.1006, -24.6053],
  Hazyview: [31.1247, -25.0473],
  eNtokozweni: [30.248, -25.668], // Machadodorp
  Hoedspruit: [30.951, -24.352],
  'Thaba Chweu': [30.4424, -25.0952], // Mashishing / Lydenburg seat
  Emakhazeni: [30.0353, -25.6855], // Belfast
};

// Town → province (for the towns LIVOLTEK reports without one).
const TOWN_PROVINCE: Record<string, string> = {
  Randburg: 'Gauteng',
  Acornhoek: 'Mpumalanga',
  Hazyview: 'Mpumalanga',
  eNtokozweni: 'Mpumalanga',
  Hoedspruit: 'Limpopo',
  'Thaba Chweu': 'Mpumalanga',
  Emakhazeni: 'Mpumalanga',
};

// Province centroids, [lng, lat] — fallback when a town is unknown.
const PROVINCE_COORDS: Record<string, [number, number]> = {
  Gauteng: [28.16, -26.27],
  Mpumalanga: [30.2, -25.57],
  Limpopo: [29.47, -23.9],
  'KwaZulu-Natal': [30.89, -28.53],
  'Eastern Cape': [26.5, -32.27],
  'Western Cape': [21.5, -33.5],
  'Northern Cape': [21.86, -29.05],
  'North West': [25.66, -26.66],
  'Free State': [27.5, -28.46],
};

const PLUS_CODE = /^[A-Z0-9]{4,}\+[A-Z0-9]+\s+/;

/** Resolve a station's location string to { town, province }. */
export function parseLocation(location: string | null): { town: string; province: string } {
  if (!location) return { town: 'Unknown', province: 'Unknown' };
  const cleaned = location.replace(/,\s*South Africa\s*$/i, '').trim();
  if (location.includes(',') && !/South Africa/i.test(location)) {
    // "Town, Province"
    const [town, province] = location.split(',').map(s => s.trim());
    return { town, province: province || TOWN_PROVINCE[town] || 'Unknown' };
  }
  // "<pluscode> Town" (South Africa stripped)
  const town = cleaned.replace(PLUS_CODE, '').trim();
  return { town, province: TOWN_PROVINCE[town] || 'Unknown' };
}

/** [lng, lat] for a station, or null if we can't place it. */
export function stationCoord(s: Station): [number, number] | null {
  const { town, province } = parseLocation(s.location);
  return TOWN_COORDS[town] ?? PROVINCE_COORDS[province] ?? null;
}

export type AreaStatus = 'healthy' | 'attention' | 'down';

export interface FleetArea {
  key: string;
  town: string;
  province: string;
  lng: number;
  lat: number;
  stations: Station[];
  online: number;
  alarm: number;
  offline: number;
  pvKw: number;
  todayKwh: number;
  capacityKw: number;
  oems: string[];
  status: AreaStatus;
}

/** Roll an area up to one status: all online = healthy, all offline = down, else attention. */
function areaStatus(online: number, offline: number, total: number): AreaStatus {
  if (total > 0 && offline === total) return 'down';
  if (online === total) return 'healthy';
  return 'attention';
}

/** Cluster stations into map areas (one marker per town). */
export function buildAreas(stations: Station[]): FleetArea[] {
  const map = new Map<string, FleetArea>();
  for (const s of stations) {
    const coord = stationCoord(s);
    if (!coord) continue;
    const { town, province } = parseLocation(s.location);
    let a = map.get(town);
    if (!a) {
      a = {
        key: town, town, province, lng: coord[0], lat: coord[1],
        stations: [], online: 0, alarm: 0, offline: 0,
        pvKw: 0, todayKwh: 0, capacityKw: 0, oems: [], status: 'healthy',
      };
      map.set(town, a);
    }
    a.stations.push(s);
    const st: Status = statusOf(s);
    a[st] += 1;
    a.pvKw += s.live?.pv_power_kw ?? 0;
    a.todayKwh += s.live?.today_kwh ?? 0;
    a.capacityKw += capacityKw(s);
    if (!a.oems.includes(s.source)) a.oems.push(s.source);
  }
  const areas = [...map.values()];
  for (const a of areas) a.status = areaStatus(a.online, a.offline, a.stations.length);
  // Biggest clusters first.
  return areas.sort((x, y) => y.stations.length - x.stations.length);
}

/** Distinct provinces that contain at least one placed station. */
export function activeProvinces(areas: FleetArea[]): Set<string> {
  return new Set(areas.map(a => a.province).filter(p => p && p !== 'Unknown'));
}
