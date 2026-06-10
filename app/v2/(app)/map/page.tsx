'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MapPin, Building2, Zap } from 'lucide-react';
import { OneViewHeader } from '@/components/v2/oneview-header';
import { FilterBar } from '@/components/v2/filter-bar';
import { useFleetFilter } from '@/components/v2/filter-context';
import { FleetMap } from '@/components/v2/fleet-map';
import { FleetData, statusOf } from '@/lib/v2/fleet';
import { buildAreas, activeProvinces } from '@/lib/v2/geo';
import { applyFilters } from '@/lib/v2/filter';

const REFRESH_INTERVAL = 5 * 60 * 1000;

export default function FleetMapPage() {
  const [data, setData] = useState<FleetData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastFetched, setLastFetched] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const { filter } = useFleetFilter();

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
  const areas = useMemo(() => buildAreas(stations), [stations]);
  const provinces = useMemo(() => activeProvinces(areas), [areas]);

  const view = useMemo(() => ({
    total: stations.length,
    online: stations.filter(s => statusOf(s) === 'online').length,
    pvKw: stations.reduce((n, s) => n + (s.live?.pv_power_kw ?? 0), 0),
  }), [stations]);

  const filtered = stations.length !== all.length;
  const subtitle = data
    ? `${view.total}${filtered ? ` of ${all.length}` : ''} sites · ${areas.length} locations · ${provinces.size} provinces`
    : 'Loading fleet…';

  return (
    <>
      <OneViewHeader
        title="Fleet Map"
        subtitle={subtitle}
        lastUpdated={lastFetched}
        onRefresh={() => fetchData(true)}
        refreshing={refreshing}
      />

      <div className="flex-1 p-7 space-y-5">
        <FilterBar stations={all} />

        {/* Summary strip */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Stat icon={<Building2 size={16} />} label="Sites monitored" value={data ? String(view.total) : '—'} />
          <Stat icon={<MapPin size={16} />} label="Locations" value={String(areas.length || '—')} sub={`${provinces.size} provinces`} />
          <Stat icon={<Zap size={16} />} label="Live generation" value={data ? view.pvKw.toFixed(1) : '—'} unit="kW" />
          <Stat
            icon={<span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: 'var(--accent)' }} />}
            label="Online now"
            value={data ? `${view.online}/${view.total}` : '—'}
          />
        </div>

        {loading ? (
          <div className="ov-card animate-pulse" style={{ height: 520, background: 'var(--card)' }} />
        ) : areas.length === 0 ? (
          <div className="ov-card flex flex-col items-center justify-center gap-2 py-20 text-center">
            <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>No sites match your filters</p>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Adjust the filter to see sites on the map.</p>
          </div>
        ) : (
          <FleetMap stations={stations} />
        )}
      </div>
    </>
  );
}

function Stat({
  icon, label, value, unit, sub,
}: {
  icon: React.ReactNode; label: string; value: string; unit?: string; sub?: string;
}) {
  return (
    <div className="ov-card px-4 py-3.5">
      <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.12em]" style={{ color: 'var(--text-muted)' }}>
        <span style={{ color: 'var(--accent)' }}>{icon}</span>
        {label}
      </div>
      <p className="tnum mt-1.5 text-2xl font-extrabold leading-none" style={{ color: 'var(--text-primary)' }}>
        {value}
        {unit && <span className="ml-1 text-sm font-semibold" style={{ color: 'var(--text-muted)' }}>{unit}</span>}
      </p>
      {sub && <p className="mt-1 text-[11px]" style={{ color: 'var(--text-muted)' }}>{sub}</p>}
    </div>
  );
}
