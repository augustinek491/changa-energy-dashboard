// Changa OneView — alert engine. Derives a unified, severity-ranked alert feed
// from live fleet data (no extra API): outages, inverter faults, zero generation
// in daylight, low battery, and stale comms. Pure + environment-agnostic so the
// same rules drive the in-app Alert Centre and the emailed digest.

import { Station, statusOf } from './fleet';
import { oemMeta } from './brand';

export type AlertSeverity = 'critical' | 'warning' | 'info';
export type AlertCategory = 'offline' | 'fault' | 'performance' | 'battery' | 'comms';

export interface Alert {
  id: string;
  severity: AlertSeverity;
  category: AlertCategory;
  stationId: string;
  stationName: string;
  source: string;
  oemLabel: string;
  oemColor: string;
  location: string | null;
  title: string;
  detail: string;
  since: string | null;       // ISO timestamp of the reading that triggered it
  suggestion?: string;
}

export const SEVERITY_META: Record<AlertSeverity, { label: string; color: string; rank: number }> = {
  critical: { label: 'Critical', color: 'var(--status-offline)', rank: 0 },
  warning:  { label: 'Warning',  color: 'var(--status-alarm)',   rank: 1 },
  info:     { label: 'Info',     color: 'var(--text-muted)',     rank: 2 },
};

export const CATEGORY_META: Record<AlertCategory, { label: string }> = {
  offline:     { label: 'Outage' },
  fault:       { label: 'Fault' },
  performance: { label: 'Performance' },
  battery:     { label: 'Battery' },
  comms:       { label: 'Comms' },
};

const STALE_MS = 30 * 60 * 1000;

function ts(iso: string | null): number {
  return iso ? new Date(iso).getTime() : 0;
}

/** Build the alert feed for a set of stations. `now` is injectable for tests. */
export function buildAlerts(stations: Station[], now: Date = new Date()): Alert[] {
  const hour = now.getHours();
  const daylight = hour >= 7 && hour <= 17;
  const out: Alert[] = [];

  for (const s of stations) {
    const m = oemMeta(s.source);
    const base = {
      stationId: s.id,
      stationName: s.name,
      source: s.source,
      oemLabel: m.label,
      oemColor: m.color,
      location: s.location,
      since: s.live?.fetched_at ?? null,
    };
    const st = statusOf(s);

    // Offline implies stale/unreliable readings — emit only the outage.
    if (st === 'offline') {
      out.push({
        ...base, id: `${s.id}:offline`, severity: 'critical', category: 'offline',
        title: 'Site offline',
        detail: 'Not reporting to the portal — possible comms or power loss.',
        suggestion: 'Check site connectivity and inverter power.',
      });
      continue;
    }

    // Inverter fault / alarm state.
    if (st === 'alarm' || s.alarm_count > 0) {
      const n = s.alarm_count;
      out.push({
        ...base, id: `${s.id}:fault`, severity: 'critical', category: 'fault',
        title: n > 0 ? `${n} active alarm${n > 1 ? 's' : ''}` : 'Inverter alarm',
        detail: 'Device is reporting a fault state.',
        suggestion: 'Review the device alarm log in the OEM portal.',
      });
    }

    // Online but producing nothing during daylight → likely string/inverter issue.
    const pv = s.live?.pv_power_kw ?? 0;
    if (daylight && pv <= 0.05) {
      out.push({
        ...base, id: `${s.id}:perf`, severity: 'warning', category: 'performance',
        title: 'No generation in daylight',
        detail: 'Online but producing ~0 kW while the sun is up.',
        suggestion: 'Inspect strings and inverter; check for a trip or heavy shading.',
      });
    }

    // Battery state of charge critically low.
    const soc = s.live?.battery_soc ?? null;
    if (soc != null && soc < 20) {
      out.push({
        ...base, id: `${s.id}:battery`, severity: 'warning', category: 'battery',
        title: `Battery low · ${soc.toFixed(0)}%`,
        detail: 'State of charge is below 20%.',
      });
    }

    // Reading is stale even though the site is nominally online.
    const fa = ts(s.live?.fetched_at ?? null);
    if (fa && now.getTime() - fa > STALE_MS) {
      const mins = Math.round((now.getTime() - fa) / 60000);
      out.push({
        ...base, id: `${s.id}:comms`, severity: 'warning', category: 'comms',
        title: 'Stale data',
        detail: `Last reading ${mins} min ago — data feed may be lagging.`,
      });
    }
  }

  return out.sort(
    (a, b) => SEVERITY_META[a.severity].rank - SEVERITY_META[b.severity].rank || ts(b.since) - ts(a.since),
  );
}

export interface AlertCounts {
  total: number;
  critical: number;
  warning: number;
  info: number;
  sites: number;            // distinct affected stations
}

export function alertCounts(alerts: Alert[]): AlertCounts {
  const sites = new Set(alerts.map(a => a.stationId));
  return {
    total: alerts.length,
    critical: alerts.filter(a => a.severity === 'critical').length,
    warning: alerts.filter(a => a.severity === 'warning').length,
    info: alerts.filter(a => a.severity === 'info').length,
    sites: sites.size,
  };
}

/** Short relative-time label for an ISO timestamp. */
export function sinceLabel(iso: string | null, now: Date = new Date()): string {
  if (!iso) return '—';
  const ms = now.getTime() - new Date(iso).getTime();
  if (ms < 0) return 'just now';
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  return `${d}d ago`;
}
