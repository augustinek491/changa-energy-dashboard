'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Header } from '@/components/header';
import { MetricCard } from '@/components/metric-card';
import { PowerChart } from '@/components/charts/power-chart';
import { YieldChart } from '@/components/charts/yield-chart';
import { ChevronRight, Zap, Sun, TrendingUp, Battery, Thermometer, Activity } from 'lucide-react';

type Range = 'day' | 'week' | 'month' | 'year' | 'all';

const RANGES: { key: Range; label: string }[] = [
  { key: 'day',   label: 'Today' },
  { key: 'week',  label: '7 Days' },
  { key: 'month', label: '30 Days' },
  { key: 'year',  label: '12 Months' },
  { key: 'all',   label: 'All Time' },
];

interface StationData {
  station: { id: string; name: string; source: string; location: string | null; capacity_kw: number | null };
  live: {
    pv_power_kw: number | null;
    load_power_kw: number | null;
    grid_power_kw: number | null;
    battery_soc: number | null;
    battery_power_kw: number | null;
    health_state: number | null;
    status: number | null;
    today_kwh: number | null;
    month_kwh: number | null;
    total_kwh: number | null;
    temperature_c: number | null;
    fetched_at: string;
  } | null;
  readings: Record<string, unknown>[];
  range: Range;
}

function statusLabel(source: string, health: number | null, status: number | null) {
  if (source === 'fusionsolar') {
    if (health === 3) return { label: 'Online', color: 'var(--accent)' };
    if (health === 2) return { label: 'Alarm', color: 'var(--alarm)' };
    return { label: 'Offline', color: 'var(--offline)' };
  }
  if (status === 1) return { label: 'Online', color: 'var(--accent)' };
  if (status === 4) return { label: 'Alarm', color: 'var(--alarm)' };
  return { label: 'Offline', color: 'var(--offline)' };
}

function fmt(n: number | null, decimals = 1) {
  if (n == null) return '—';
  return n.toFixed(decimals);
}

function fmtKwh(n: number | null) {
  if (n == null) return '—';
  if (n >= 1000) return `${(n / 1000).toFixed(2)} MWh`;
  return `${n.toFixed(1)} kWh`;
}

export default function StationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [range, setRange] = useState<Range>('day');
  const [data, setData] = useState<StationData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async (r: Range, isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      const res = await fetch(`/api/dashboard/station/${id}?range=${r}`);
      if (!res.ok) throw new Error('Failed to load station');
      const json: StationData = await res.json();
      setData(json);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [id]);

  useEffect(() => { fetchData(range); }, [range, fetchData]);

  const station = data?.station;
  const live = data?.live;
  const stStatus = live ? statusLabel(station?.source ?? '', live.health_state, live.status) : null;

  const showPowerChart = range === 'day' || range === 'week';

  return (
    <>
      <Header
        title={station?.name ?? 'Station Detail'}
        subtitle={station?.location ?? undefined}
        lastUpdated={live?.fetched_at}
        onRefresh={() => fetchData(range, true)}
        refreshing={refreshing}
      />

      <div className="flex-1 p-6 space-y-6">
        {/* Breadcrumb */}
        <div className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-muted)' }}>
          <Link href="/" className="hover:underline cursor-pointer" style={{ color: 'var(--text-secondary)' }}>
            Fleet
          </Link>
          <ChevronRight size={12} />
          <span style={{ color: 'var(--text-primary)' }}>{station?.name ?? '…'}</span>
        </div>

        {/* Live status bar */}
        {live && stStatus && (
          <div
            className="rounded-xl p-5 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
          >
            <div>
              <p className="text-[10px] uppercase tracking-widest font-semibold mb-1" style={{ color: 'var(--text-muted)' }}>Status</p>
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full" style={{ background: stStatus.color, boxShadow: `0 0 4px ${stStatus.color}` }} />
                <span className="text-sm font-bold" style={{ color: stStatus.color }}>{stStatus.label}</span>
              </div>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-widest font-semibold mb-1" style={{ color: 'var(--text-muted)' }}>PV Power</p>
              <div className="flex items-center gap-1">
                <Zap size={13} style={{ color: 'var(--accent)' }} />
                <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{fmt(live.pv_power_kw)} kW</span>
              </div>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-widest font-semibold mb-1" style={{ color: 'var(--text-muted)' }}>Load</p>
              <div className="flex items-center gap-1">
                <Activity size={13} style={{ color: '#F97316' }} />
                <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{fmt(live.load_power_kw)} kW</span>
              </div>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-widest font-semibold mb-1" style={{ color: 'var(--text-muted)' }}>Grid</p>
              <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{fmt(live.grid_power_kw)} kW</span>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-widest font-semibold mb-1" style={{ color: 'var(--text-muted)' }}>Battery SOC</p>
              <div className="flex items-center gap-1.5">
                <Battery size={13} style={{ color: '#3B82F6' }} />
                <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
                  {live.battery_soc != null ? `${Math.round(live.battery_soc)}%` : '—'}
                </span>
              </div>
            </div>
            {live.temperature_c != null && (
              <div>
                <p className="text-[10px] uppercase tracking-widest font-semibold mb-1" style={{ color: 'var(--text-muted)' }}>Temp</p>
                <div className="flex items-center gap-1">
                  <Thermometer size={13} style={{ color: '#8B5CF6' }} />
                  <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{fmt(live.temperature_c, 1)}°C</span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* KPI row */}
        <div className="grid grid-cols-3 gap-4">
          <MetricCard
            label="Today"
            value={live ? fmtKwh(live.today_kwh) : '—'}
            icon={<Sun size={14} />}
            accent="var(--accent)"
          />
          <MetricCard
            label="This Month"
            value={live ? fmtKwh(live.month_kwh) : '—'}
            icon={<TrendingUp size={14} />}
            accent="#3B82F6"
          />
          <MetricCard
            label="All Time"
            value={live ? fmtKwh(live.total_kwh) : '—'}
            icon={<TrendingUp size={14} />}
            accent="#8B5CF6"
          />
        </div>

        {/* Chart section */}
        <div
          className="rounded-xl p-5"
          style={{ background: 'var(--surface)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)' }}
        >
          {/* Range tabs */}
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
              {showPowerChart ? 'Power Output' : 'Energy Yield'}
            </h2>
            <div className="flex rounded-lg overflow-hidden" style={{ border: '1px solid var(--border)' }}>
              {RANGES.map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setRange(key)}
                  className="px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer"
                  style={{
                    background: range === key ? 'var(--accent)' : 'var(--surface)',
                    color: range === key ? '#fff' : 'var(--text-secondary)',
                    borderRight: key !== 'all' ? '1px solid var(--border)' : undefined,
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <div className="h-[300px] rounded-lg animate-pulse" style={{ background: 'var(--card)' }} />
          ) : showPowerChart ? (
            <PowerChart
              readings={(data?.readings ?? []) as unknown as Parameters<typeof PowerChart>[0]['readings']}
              range={range as 'day' | 'week'}
            />
          ) : (
            <YieldChart
              data={(data?.readings ?? []) as unknown as Parameters<typeof YieldChart>[0]['data']}
              range={range as 'month' | 'year' | 'all'}
            />
          )}
        </div>

        {/* Station info */}
        {station && (
          <div
            className="rounded-xl p-5"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
          >
            <h2 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>Station Info</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
              <div>
                <p className="text-[10px] uppercase tracking-widest font-semibold mb-1" style={{ color: 'var(--text-muted)' }}>Source</p>
                <p style={{ color: 'var(--text-primary)' }}>{station.source === 'fusionsolar' ? 'FusionSolar' : 'LIVOLTEK'}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-widest font-semibold mb-1" style={{ color: 'var(--text-muted)' }}>Capacity</p>
                <p style={{ color: 'var(--text-primary)' }}>
                  {station.capacity_kw
                    ? station.source === 'livoltek'
                      ? `${(station.capacity_kw / 1000).toFixed(2)} kWp`
                      : `${station.capacity_kw} kWp`
                    : '—'}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-widest font-semibold mb-1" style={{ color: 'var(--text-muted)' }}>Location</p>
                <p style={{ color: 'var(--text-primary)' }}>{station.location ?? '—'}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-widest font-semibold mb-1" style={{ color: 'var(--text-muted)' }}>Station ID</p>
                <p className="font-mono text-xs" style={{ color: 'var(--text-muted)' }}>{station.id.slice(0, 8)}…</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
