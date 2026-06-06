'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Header } from '@/components/header';
import { MetricCard } from '@/components/metric-card';
import { StationCard } from '@/components/station-card';
import { Zap, Sun, TrendingUp, AlertTriangle, RefreshCw } from 'lucide-react';

type StatusFilter = 'all' | 'online' | 'alarm' | 'offline';

interface FleetData {
  stations: {
    id: string;
    name: string;
    source: string;
    location: string | null;
    capacity_kw: number | null;
    live: {
      pv_power_kw: number | null;
      load_power_kw: number | null;
      battery_soc: number | null;
      health_state: number | null;
      status: number | null;
      today_kwh: number | null;
      month_kwh: number | null;
      total_kwh: number | null;
      fetched_at: string;
    } | null;
    alarm_count: number;
  }[];
  summary: {
    total: number;
    online: number;
    alarm: number;
    offline: number;
    open_alarms: number;
    total_pv_kw: number;
    total_today_kwh: number;
    total_month_kwh: number;
    total_lifetime_kwh: number;
  };
}

function stStatus(source: string, health: number | null, status: number | null) {
  if (source === 'fusionsolar') {
    if (health === 3) return 'online';
    if (health === 2) return 'alarm';
    return 'offline';
  }
  if (status === 1) return 'online';
  if (status === 4) return 'alarm';
  return 'offline';
}

const REFRESH_INTERVAL = 5 * 60 * 1000; // 5 minutes

export default function FleetOverviewPage() {
  const [data, setData] = useState<FleetData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastFetched, setLastFetched] = useState<string | null>(null);
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [search, setSearch] = useState('');
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchData = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      const res = await fetch('/api/dashboard/fleet');
      if (!res.ok) throw new Error(await res.text());
      const json: FleetData = await res.json();
      setData(json);
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
    timerRef.current = setInterval(() => fetchData(true), REFRESH_INTERVAL);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [fetchData]);

  const filtered = (data?.stations ?? []).filter(s => {
    const st = s.live ? stStatus(s.source, s.live.health_state, s.live.status) : 'offline';
    if (filter !== 'all' && st !== filter) return false;
    if (search && !s.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const summary = data?.summary;

  return (
    <>
      <Header
        title="Fleet Overview"
        subtitle={summary ? `${summary.total} stations — ${summary.online} online` : undefined}
        lastUpdated={lastFetched}
        onRefresh={() => fetchData(true)}
        refreshing={refreshing}
      />

      <div className="flex-1 p-6 space-y-6">
        {/* Summary metric cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard
            label="Live Generation"
            value={summary ? summary.total_pv_kw.toFixed(1) : '—'}
            unit="kW"
            sub="Combined fleet output"
            icon={<Zap size={15} />}
            accent="var(--accent)"
          />
          <MetricCard
            label="Today's Yield"
            value={summary ? summary.total_today_kwh.toFixed(1) : '—'}
            unit="kWh"
            sub="Fleet total so far"
            icon={<Sun size={15} />}
            accent="#F59E0B"
          />
          <MetricCard
            label="Month Yield"
            value={summary ? (summary.total_month_kwh / 1000).toFixed(1) : '—'}
            unit="MWh"
            sub={new Date().toLocaleDateString([], { month: 'long', year: 'numeric' })}
            icon={<TrendingUp size={15} />}
            accent="#3B82F6"
          />
          <MetricCard
            label="Active Alarms"
            value={summary ? summary.open_alarms : '—'}
            sub={summary ? `${summary.online} online · ${summary.alarm} in alarm · ${summary.offline} offline` : ''}
            icon={<AlertTriangle size={15} />}
            accent={summary && (summary.open_alarms > 0) ? '#EF4444' : 'var(--accent)'}
          />
        </div>

        {/* Filters + search */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex rounded-lg overflow-hidden" style={{ border: '1px solid var(--border)' }}>
            {(['all', 'online', 'alarm', 'offline'] as StatusFilter[]).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className="px-3.5 py-2 text-xs font-semibold capitalize transition-colors cursor-pointer"
                style={{
                  background: filter === f ? 'var(--accent)' : 'var(--surface)',
                  color: filter === f ? '#fff' : 'var(--text-secondary)',
                  borderRight: f !== 'offline' ? '1px solid var(--border)' : undefined,
                }}
              >
                {f === 'all' ? `All (${summary?.total ?? 0})` :
                 f === 'online' ? `Online (${summary?.online ?? 0})` :
                 f === 'alarm' ? `Alarm (${summary?.alarm ?? 0})` :
                 `Offline (${summary?.offline ?? 0})`}
              </button>
            ))}
          </div>
          <input
            type="search"
            placeholder="Search stations…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="px-3 py-2 text-sm rounded-lg outline-none"
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              color: 'var(--text-primary)',
              width: 200,
            }}
          />
        </div>

        {/* Station grid */}
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className="rounded-xl h-40 animate-pulse"
                style={{ background: 'var(--card)' }}
              />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div
            className="flex flex-col items-center justify-center py-24 rounded-xl"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
          >
            <RefreshCw size={32} style={{ color: 'var(--text-muted)' }} />
            <p className="mt-3 text-sm" style={{ color: 'var(--text-secondary)' }}>No stations match your filter</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filtered.map(s => (
              <StationCard
                key={s.id}
                id={s.id}
                name={s.name}
                source={s.source}
                location={s.location}
                capacity_kw={s.capacity_kw}
                live={s.live}
                alarm_count={s.alarm_count}
              />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
