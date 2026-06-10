'use client';

// Changa OneView — Stations directory. The detailed per-station counterpart to
// the Fleet Map: the global FilterBar narrows the fleet, columns sort any way,
// rows expand for full detail. Consumes /api/dashboard/fleet (unchanged).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { OneViewHeader } from '@/components/v2/oneview-header';
import { FilterBar } from '@/components/v2/filter-bar';
import { useFleetFilter } from '@/components/v2/filter-context';
import { StationsTable, SortKey, SortState } from '@/components/v2/stations-table';
import {
  FleetData, Station, Status, statusOf, capacityKw, loadFactor,
} from '@/lib/v2/fleet';
import { oemMeta } from '@/lib/v2/brand';
import { applyFilters } from '@/lib/v2/filter';

const REFRESH_INTERVAL = 5 * 60 * 1000;

const STATUS_RANK: Record<Status, number> = { offline: 0, alarm: 1, online: 2 };

function defaultDir(key: SortKey): 'asc' | 'desc' {
  return key === 'name' || key === 'oem' || key === 'status' ? 'asc' : 'desc';
}

function compare(a: Station, b: Station, s: SortState): number {
  const mul = s.dir === 'asc' ? 1 : -1;
  switch (s.key) {
    case 'name': return a.name.localeCompare(b.name) * mul;
    case 'oem': return oemMeta(a.source).label.localeCompare(oemMeta(b.source).label) * mul;
    case 'status': return (STATUS_RANK[statusOf(a)] - STATUS_RANK[statusOf(b)]) * mul || a.name.localeCompare(b.name);
    case 'live': return ((a.live?.pv_power_kw ?? 0) - (b.live?.pv_power_kw ?? 0)) * mul;
    case 'today': return ((a.live?.today_kwh ?? 0) - (b.live?.today_kwh ?? 0)) * mul;
    case 'capacity': return (capacityKw(a) - capacityKw(b)) * mul;
    case 'perf': return ((loadFactor(a) ?? -1) - (loadFactor(b) ?? -1)) * mul;
    default: return 0;
  }
}

export default function StationsPage() {
  const [data, setData] = useState<FleetData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastFetched, setLastFetched] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const { filter, reset } = useFleetFilter();
  const [sort, setSort] = useState<SortState>({ key: 'status', dir: 'asc' });

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

  const stations = useMemo(() => data?.stations ?? [], [data]);

  const visible = useMemo(
    () => applyFilters(stations, filter).sort((a, b) => compare(a, b, sort)),
    [stations, filter, sort],
  );

  const onSort = (key: SortKey) =>
    setSort(prev => (prev.key === key
      ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
      : { key, dir: defaultDir(key) }));

  const online = useMemo(() => stations.filter(s => statusOf(s) === 'online').length, [stations]);
  const subtitle = data
    ? `Showing ${visible.length} of ${stations.length} stations · ${online} online`
    : 'Loading fleet…';

  return (
    <>
      <OneViewHeader
        title="Stations"
        subtitle={subtitle}
        lastUpdated={lastFetched}
        onRefresh={() => fetchData(true)}
        refreshing={refreshing}
      />

      <div className="flex-1 p-7 space-y-4">
        <FilterBar stations={stations} />

        {loading ? (
          <div className="ov-card animate-pulse" style={{ height: 420, background: 'var(--card)' }} />
        ) : visible.length === 0 ? (
          <div className="ov-card flex flex-col items-center justify-center gap-2 py-16 text-center">
            <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>No stations match your filters</p>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Try widening the search or clearing a filter.</p>
            <button type="button" onClick={reset} className="mt-1 text-xs font-semibold cursor-pointer" style={{ color: 'var(--accent)' }}>
              Clear all filters
            </button>
          </div>
        ) : (
          <StationsTable stations={visible} sort={sort} onSort={onSort} />
        )}
      </div>
    </>
  );
}
