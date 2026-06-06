'use client';

import Link from 'next/link';
import { Battery, Zap, TrendingUp, MapPin, AlertCircle } from 'lucide-react';

interface StationLive {
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

interface StationCardProps {
  id: string;
  name: string;
  source: string;
  location: string | null;
  capacity_kw: number | null;
  live: StationLive | null;
  alarm_count: number;
}

export function stationStatus(source: string, health: number | null, status: number | null): 'online' | 'alarm' | 'offline' {
  if (source === 'fusionsolar') {
    if (health === 3) return 'online';
    if (health === 2) return 'alarm';
    return 'offline';
  }
  if (status === 1) return 'online';
  if (status === 4) return 'alarm';
  return 'offline';
}

const STATUS_STYLES = {
  online:  { color: 'var(--accent)',   bg: 'var(--accent-dim)',   label: 'Online' },
  alarm:   { color: 'var(--alarm)',    bg: 'var(--alarm-dim)',    label: 'Alarm' },
  offline: { color: 'var(--offline)', bg: 'var(--offline-dim)', label: 'Offline' },
};

function fmt(n: number | null, decimals = 1) {
  if (n == null) return '—';
  return n.toFixed(decimals);
}

export function StationCard({ id, name, source, location, capacity_kw, live, alarm_count }: StationCardProps) {
  const st = live
    ? stationStatus(source, live.health_state, live.status)
    : 'offline';
  const style = STATUS_STYLES[st];

  return (
    <Link
      href={`/station/${id}`}
      className="block rounded-xl p-5 transition-all duration-200 cursor-pointer group"
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        boxShadow: 'var(--shadow-sm)',
      }}
      onMouseEnter={e => (e.currentTarget.style.boxShadow = 'var(--shadow-md)')}
      onMouseLeave={e => (e.currentTarget.style.boxShadow = 'var(--shadow-sm)')}
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="min-w-0">
          <p className="font-semibold text-sm truncate leading-snug" style={{ color: 'var(--text-primary)' }}>
            {name}
          </p>
          {location && (
            <div className="flex items-center gap-1 mt-0.5">
              <MapPin size={10} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
              <p className="text-[11px] truncate" style={{ color: 'var(--text-muted)' }}>{location}</p>
            </div>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {alarm_count > 0 && (
            <div
              className="flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold"
              style={{ background: 'var(--alarm-dim)', color: 'var(--alarm)' }}
            >
              <AlertCircle size={9} />
              {alarm_count}
            </div>
          )}
          <div
            className="flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-semibold"
            style={{ background: style.bg, color: style.color }}
          >
            <span
              className="w-1.5 h-1.5 rounded-full"
              style={{
                background: style.color,
                boxShadow: st === 'online' ? `0 0 4px ${style.color}` : 'none',
              }}
            />
            {style.label}
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-2">
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-1" style={{ color: 'var(--text-muted)' }}>
            <Zap size={11} />
            <span className="text-[10px] font-medium">Live</span>
          </div>
          <span className="text-sm font-semibold" style={{ color: st === 'online' ? 'var(--accent)' : 'var(--text-secondary)' }}>
            {live ? `${fmt(live.pv_power_kw)} kW` : '—'}
          </span>
        </div>
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-1" style={{ color: 'var(--text-muted)' }}>
            <TrendingUp size={11} />
            <span className="text-[10px] font-medium">Today</span>
          </div>
          <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            {live ? `${fmt(live.today_kwh)} kWh` : '—'}
          </span>
        </div>
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-1" style={{ color: 'var(--text-muted)' }}>
            <Battery size={11} />
            <span className="text-[10px] font-medium">SOC</span>
          </div>
          {live?.battery_soc != null ? (
            <div className="flex items-center gap-1.5">
              <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--card)' }}>
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${Math.min(100, live.battery_soc)}%`,
                    background: live.battery_soc > 20 ? 'var(--accent)' : 'var(--alarm)',
                  }}
                />
              </div>
              <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
                {Math.round(live.battery_soc)}%
              </span>
            </div>
          ) : (
            <span className="text-sm font-semibold" style={{ color: 'var(--text-muted)' }}>—</span>
          )}
        </div>
      </div>

      {/* Capacity tag */}
      {capacity_kw && (
        <div className="mt-3 pt-3" style={{ borderTop: '1px solid var(--border)' }}>
          <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
            {/* LIVOLTEK stores pvCapacity in Wp; FusionSolar uses kW */}
            {source === 'livoltek'
              ? `${(capacity_kw / 1000).toFixed(2)} kWp`
              : `${capacity_kw} kWp`}
            {' · '}
            {source === 'fusionsolar' ? 'FusionSolar' : 'LIVOLTEK'}
          </span>
        </div>
      )}
    </Link>
  );
}
