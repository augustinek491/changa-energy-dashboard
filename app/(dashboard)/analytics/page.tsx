'use client';

import { useCallback, useEffect, useState } from 'react';
import { Header } from '@/components/header';
import { MetricCard } from '@/components/metric-card';
import { YieldChart } from '@/components/charts/yield-chart';
import { Sun, Leaf, TrendingUp, BarChart3, Calendar } from 'lucide-react';

type Period = 'daily' | 'monthly';

interface AnalyticsData {
  kpi: {
    today_kwh: number;
    month_kwh: number;
    lifetime_kwh: number;
    co2_saved_t: number;
  };
  daily: { date: string; total_kwh: number }[];
  monthly: { year_month: string; total_kwh: number }[];
  by_station: { station_id: string; station_name: string; total_kwh: number }[];
}

export default function AnalyticsPage() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [period, setPeriod] = useState<Period>('daily');

  const fetchData = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      const res = await fetch('/api/dashboard/analytics');
      if (!res.ok) throw new Error('Failed to fetch analytics');
      const json: AnalyticsData = await res.json();
      setData(json);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const kpi = data?.kpi;
  const chartData = period === 'daily' ? data?.daily : data?.monthly;

  const topStation = data?.by_station[0];
  const fleetTotal = data?.by_station.reduce((s, r) => s + r.total_kwh, 0) ?? 1;

  return (
    <>
      <Header
        title="Analytics"
        subtitle="Fleet-wide energy production overview"
        onRefresh={() => fetchData(true)}
        refreshing={refreshing}
      />

      <div className="flex-1 p-6 space-y-6">
        {/* KPI cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard
            label="Today's Yield"
            value={kpi ? kpi.today_kwh.toFixed(1) : '—'}
            unit="kWh"
            sub="All stations combined"
            icon={<Sun size={14} />}
            accent="var(--accent)"
          />
          <MetricCard
            label="This Month"
            value={kpi ? (kpi.month_kwh / 1000).toFixed(2) : '—'}
            unit="MWh"
            sub={new Date().toLocaleDateString([], { month: 'long', year: 'numeric' })}
            icon={<Calendar size={14} />}
            accent="#3B82F6"
          />
          <MetricCard
            label="Lifetime Generation"
            value={kpi ? (kpi.lifetime_kwh / 1000).toFixed(1) : '—'}
            unit="MWh"
            sub="Since commissioning"
            icon={<TrendingUp size={14} />}
            accent="#8B5CF6"
          />
          <MetricCard
            label="CO₂ Avoided"
            value={kpi ? kpi.co2_saved_t.toFixed(1) : '—'}
            unit="tonnes"
            sub="at 0.9 kg CO₂/kWh"
            icon={<Leaf size={14} />}
            accent="#10B981"
          />
        </div>

        {/* Yield chart */}
        <div
          className="rounded-xl p-5"
          style={{ background: 'var(--surface)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)' }}
        >
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Energy Yield</h2>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                {period === 'daily' ? 'Last 30 days' : 'Last 12 months'}
              </p>
            </div>
            <div className="flex rounded-lg overflow-hidden" style={{ border: '1px solid var(--border)' }}>
              {(['daily', 'monthly'] as Period[]).map(p => (
                <button
                  key={p}
                  onClick={() => setPeriod(p)}
                  className="px-3.5 py-1.5 text-xs font-semibold capitalize transition-colors cursor-pointer"
                  style={{
                    background: period === p ? 'var(--accent)' : 'var(--surface)',
                    color: period === p ? '#fff' : 'var(--text-secondary)',
                    borderRight: p === 'daily' ? '1px solid var(--border)' : undefined,
                  }}
                >
                  {p === 'daily' ? 'Daily' : 'Monthly'}
                </button>
              ))}
            </div>
          </div>

          {loading || !chartData ? (
            <div className="h-[300px] rounded-lg animate-pulse" style={{ background: 'var(--card)' }} />
          ) : (
            <YieldChart
              data={period === 'daily' ? (chartData as { date: string; total_kwh: number }[]) : (chartData as { year_month: string; total_kwh: number }[])}
              range={period === 'daily' ? 'month' : 'year'}
            />
          )}
        </div>

        {/* Per-station breakdown */}
        <div
          className="rounded-xl overflow-hidden"
          style={{ border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)' }}
        >
          <div className="flex items-center gap-2 px-5 py-4" style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface)' }}>
            <BarChart3 size={15} style={{ color: 'var(--accent)' }} />
            <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
              Per-Station Lifetime Yield
            </h2>
          </div>

          {loading ? (
            <div className="p-6 space-y-3">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="h-10 rounded animate-pulse" style={{ background: 'var(--card)' }} />
              ))}
            </div>
          ) : (
            <div style={{ background: 'var(--surface)' }}>
              {(data?.by_station ?? []).map((s, i) => {
                const pct = fleetTotal > 0 ? (s.total_kwh / fleetTotal) * 100 : 0;
                return (
                  <div
                    key={s.station_id}
                    className="flex items-center gap-4 px-5 py-3.5"
                    style={{ borderTop: i > 0 ? '1px solid var(--border)' : undefined }}
                  >
                    <span className="text-xs w-5 text-right flex-shrink-0 font-medium" style={{ color: 'var(--text-muted)' }}>
                      {i + 1}
                    </span>
                    <span className="text-sm flex-1 truncate" style={{ color: 'var(--text-primary)' }}>
                      {s.station_name}
                    </span>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <div className="w-32 h-2 rounded-full overflow-hidden" style={{ background: 'var(--card)' }}>
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{
                            width: `${pct}%`,
                            background: i < 3 ? 'var(--accent)' : 'var(--text-muted)',
                          }}
                        />
                      </div>
                      <span className="text-xs w-20 text-right font-semibold" style={{ color: 'var(--text-primary)' }}>
                        {s.total_kwh >= 1000
                          ? `${(s.total_kwh / 1000).toFixed(1)} MWh`
                          : `${s.total_kwh.toFixed(0)} kWh`}
                      </span>
                    </div>
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
