'use client';

// Changa OneView — Performance. Benchmarks the fleet on the metrics the data
// actually supports: availability (uptime) now, per-OEM reliability, and a yield
// leaderboard that ranks every site against its peers. Specific yield (kWh/kWp)
// is surfaced where nameplate capacity is on file, with an honest coverage note
// — a real metric ready to scale as capacities are filled in. Honours the
// console-wide fleet filter like every other page.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, Zap, Sun, AlertTriangle, Gauge } from 'lucide-react';
import { OneViewHeader } from '@/components/v2/oneview-header';
import { FilterBar } from '@/components/v2/filter-bar';
import { StatTile } from '@/components/v2/stat-tile';
import { HealthBar } from '@/components/v2/health-bar';
import { useFleetFilter } from '@/components/v2/filter-context';
import { FleetData, Station, statusOf, capacityKw, groupByOem } from '@/lib/v2/fleet';
import { applyFilters } from '@/lib/v2/filter';
import { parseLocation } from '@/lib/v2/geo';

const REFRESH_INTERVAL = 5 * 60 * 1000;

type Metric = 'month' | 'today' | 'live';
const METRICS: { key: Metric; label: string; unit: string }[] = [
  { key: 'month', label: 'This month', unit: 'kWh' },
  { key: 'today', label: 'Today', unit: 'kWh' },
  { key: 'live', label: 'Live now', unit: 'kW' },
];

function metricOf(s: Station, m: Metric): number {
  const l = s.live;
  if (!l) return 0;
  if (m === 'live') return l.pv_power_kw ?? 0;
  if (m === 'today') return l.today_kwh ?? 0;
  return l.month_kwh ?? 0;
}

function fmtVal(n: number, unit: string): string {
  if (unit === 'kWh' && n >= 1000) return `${(n / 1000).toFixed(2)} MWh`;
  return `${n.toFixed(unit === 'kW' ? 1 : 0)} ${unit}`;
}

export default function PerformancePage() {
  const [data, setData] = useState<FleetData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastFetched, setLastFetched] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const { filter } = useFleetFilter();
  const [metric, setMetric] = useState<Metric>('month');

  const fetchData = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      const res = await fetch('/api/dashboard/fleet');
      if (!res.ok) throw new Error(await res.text());
      setData(await res.json());
      setLastFetched(new Date().toISOString());
    } catch (e) {
      console.error('Fleet fetch failed:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    timer.current = setInterval(() => fetchData(true), REFRESH_INTERVAL);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [fetchData]);

  const all = useMemo(() => data?.stations ?? [], [data]);
  const stations = useMemo(() => applyFilters(all, filter), [all, filter]);

  const counts = useMemo(() => {
    let online = 0, alarm = 0, offline = 0;
    for (const s of stations) {
      const st = statusOf(s);
      if (st === 'online') online++;
      else if (st === 'alarm') alarm++;
      else offline++;
    }
    return { online, alarm, offline };
  }, [stations]);

  const availability = stations.length ? (counts.online / stations.length) * 100 : 0;
  const liveKw = useMemo(() => stations.reduce((n, s) => n + (s.live?.pv_power_kw ?? 0), 0), [stations]);
  const todayKwh = useMemo(() => stations.reduce((n, s) => n + (s.live?.today_kwh ?? 0), 0), [stations]);
  const avgYield = counts.online ? todayKwh / counts.online : 0;
  const attention = counts.alarm + counts.offline;

  const oemGroups = useMemo(() => groupByOem(stations), [stations]);

  const unit = METRICS.find(m => m.key === metric)!.unit;
  const ranked = useMemo(
    () => [...stations].sort((a, b) => metricOf(b, metric) - metricOf(a, metric)),
    [stations, metric],
  );
  const maxMetric = Math.max(...ranked.map(s => metricOf(s, metric)), 0.001);

  // Specific yield (kWh/kWp) — only where nameplate capacity is on file.
  const withCap = useMemo(() => stations.filter(s => capacityKw(s) > 0), [stations]);

  const subtitle = data
    ? `${availability.toFixed(0)}% available · ${counts.online}/${stations.length} sites online`
    : 'Loading fleet…';

  return (
    <>
      <OneViewHeader
        title="Performance"
        subtitle={subtitle}
        lastUpdated={lastFetched}
        onRefresh={() => fetchData(true)}
        refreshing={refreshing}
      />

      <div className="flex-1 p-7 space-y-5">
        <FilterBar stations={all} />

        {/* Hero band */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatTile
            label="Fleet availability"
            value={data ? `${availability.toFixed(0)}%` : '—'}
            sub={`${counts.online} of ${stations.length} sites online`}
            icon={<Activity size={16} />}
            accent="var(--accent)"
            hero
          />
          <StatTile
            label="Live generation"
            value={data ? liveKw.toFixed(1) : '—'}
            unit="kW"
            sub={`Across ${counts.online} online sites`}
            icon={<Zap size={16} />}
            accent="var(--accent)"
          />
          <StatTile
            label="Avg yield / site"
            value={data ? avgYield.toFixed(0) : '—'}
            unit="kWh"
            sub="Energy today ÷ online sites"
            icon={<Sun size={16} />}
            accent="#F59E0B"
          />
          <StatTile
            label="Need attention"
            value={data ? String(attention) : '—'}
            sub="Offline or in alarm"
            icon={<AlertTriangle size={16} />}
            accent={attention > 0 ? 'var(--status-alarm)' : 'var(--accent)'}
          />
        </div>

        {/* Fleet status + per-OEM reliability */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {loading ? (
            <><Skeleton h={180} /><Skeleton h={180} className="lg:col-span-2" /></>
          ) : (
            <>
              <HealthBar online={counts.online} alarm={counts.alarm} offline={counts.offline} />
              <div className="lg:col-span-2">
                <div className="ov-card p-5">
                  <p className="text-[11px] font-bold uppercase tracking-[0.13em] mb-4" style={{ color: 'var(--text-secondary)' }}>
                    Availability by manufacturer
                  </p>
                  {oemGroups.length === 0 ? (
                    <p className="py-6 text-center text-sm" style={{ color: 'var(--text-muted)' }}>No sites match your filters.</p>
                  ) : (
                    <div className="space-y-3.5">
                      {oemGroups.map(g => {
                        const total = g.stations.length;
                        const up = total ? (g.online / total) * 100 : 0;
                        return (
                          <div key={g.key}>
                            <div className="mb-1.5 flex items-center justify-between">
                              <span className="flex items-center gap-2 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                                <span className="h-2 w-2 rounded-full" style={{ background: g.color }} />
                                {g.label}
                              </span>
                              <span className="tnum text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
                                {g.online}/{total} up · {up.toFixed(0)}%
                              </span>
                            </div>
                            <div className="h-2 w-full overflow-hidden rounded-full" style={{ background: 'var(--card)' }}>
                              <div className="h-full rounded-full transition-all" style={{ width: `${up}%`, background: up >= 80 ? 'var(--accent)' : up >= 50 ? 'var(--status-alarm)' : 'var(--status-offline)' }} />
                            </div>
                            <p className="mt-1 tnum text-[11px]" style={{ color: 'var(--text-muted)' }}>
                              {g.alarm > 0 && `${g.alarm} alarm · `}{g.offline > 0 ? `${g.offline} offline` : 'all reporting'}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Benchmark leaderboard */}
        <div className="ov-card p-5">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <p className="text-[11px] font-bold uppercase tracking-[0.13em]" style={{ color: 'var(--text-secondary)' }}>
              Yield benchmark · best to worst
            </p>
            <Segmented value={metric} onChange={setMetric} />
          </div>

          {loading ? (
            <div className="space-y-2">
              {[0, 1, 2, 3].map(i => <div key={i} className="h-9 animate-pulse rounded-lg" style={{ background: 'var(--card)' }} />)}
            </div>
          ) : ranked.length === 0 ? (
            <p className="py-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>No sites match your filters.</p>
          ) : (
            <div className="space-y-1.5">
              {ranked.map((s, i) => {
                const v = metricOf(s, metric);
                const loc = parseLocation(s.location);
                const locLabel = loc.province !== 'Unknown' && loc.province !== loc.town
                  ? `${loc.town}, ${loc.province}` : loc.town;
                const st = statusOf(s);
                const dot = st === 'online' ? 'var(--accent)' : st === 'alarm' ? 'var(--status-alarm)' : 'var(--status-offline)';
                return (
                  <div key={s.id} className="flex items-center gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-[var(--card-hover)]">
                    <span className="tnum w-6 shrink-0 text-center text-xs font-bold" style={{ color: i < 3 ? 'var(--accent)' : 'var(--text-muted)' }}>{i + 1}</span>
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: dot }} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{s.name}</p>
                      <p className="truncate text-[11px]" style={{ color: 'var(--text-muted)' }}>{locLabel}</p>
                    </div>
                    <div className="hidden sm:block w-40 shrink-0">
                      <div className="h-1.5 w-full overflow-hidden rounded-full" style={{ background: 'var(--card)' }}>
                        <div className="h-full rounded-full" style={{ width: `${(v / maxMetric) * 100}%`, background: 'var(--accent)' }} />
                      </div>
                    </div>
                    <span className="tnum w-24 shrink-0 text-right text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{fmtVal(v, unit)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Specific yield — capacity-aware, honest coverage */}
        <div className="ov-card p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.13em]" style={{ color: 'var(--text-secondary)' }}>
                <Gauge size={14} style={{ color: 'var(--accent)' }} /> Specific yield · kWh/kWp
              </p>
              <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
                The fairest cross-site benchmark — energy per installed kWp. Needs nameplate capacity.
              </p>
            </div>
            <span className="tnum shrink-0 rounded-lg px-2.5 py-1 text-xs font-bold" style={{ background: 'var(--card-hover)', color: 'var(--text-secondary)' }}>
              {withCap.length}/{stations.length} sites
            </span>
          </div>

          {withCap.length === 0 ? (
            <p className="mt-4 text-sm" style={{ color: 'var(--text-muted)' }}>
              No nameplate capacity on file for the current selection. Add capacity to unlock specific-yield benchmarking.
            </p>
          ) : (
            <div className="mt-4 space-y-1.5">
              {withCap
                .map(s => ({ s, cap: capacityKw(s), today: s.live?.today_kwh ?? 0 }))
                .sort((a, b) => (b.today / b.cap) - (a.today / a.cap))
                .map(({ s, cap, today }) => {
                  const sy = cap > 0 ? today / cap : 0;
                  return (
                    <div key={s.id} className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{s.name}</p>
                        <p className="tnum truncate text-[11px]" style={{ color: 'var(--text-muted)' }}>{cap.toFixed(1)} kWp installed</p>
                      </div>
                      <span className="tnum shrink-0 text-right text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
                        {sy.toFixed(2)} <span className="text-[11px] font-semibold" style={{ color: 'var(--text-muted)' }}>kWh/kWp</span>
                      </span>
                    </div>
                  );
                })}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function Segmented({ value, onChange }: { value: Metric; onChange: (m: Metric) => void }) {
  return (
    <div className="inline-flex rounded-lg p-0.5" style={{ background: 'var(--card-hover)', border: '1px solid var(--border)' }}>
      {METRICS.map(m => {
        const on = m.key === value;
        return (
          <button
            key={m.key}
            type="button"
            onClick={() => onChange(m.key)}
            className="rounded-md px-3 py-1.5 text-[12px] font-semibold cursor-pointer transition-colors"
            style={{ background: on ? 'var(--accent)' : 'transparent', color: on ? '#fff' : 'var(--text-secondary)' }}
          >
            {m.label}
          </button>
        );
      })}
    </div>
  );
}

function Skeleton({ h, className = '' }: { h: number; className?: string }) {
  return <div className={`ov-card animate-pulse ${className}`} style={{ height: h, background: 'var(--card)' }} />;
}
