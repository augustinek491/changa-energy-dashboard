'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Wallet, TrendingUp, Zap, Sun, Leaf } from 'lucide-react';
import { OneViewHeader } from '@/components/v2/oneview-header';
import { StatTile } from '@/components/v2/stat-tile';
import { HealthBar } from '@/components/v2/health-bar';
import { AttentionStrip } from '@/components/v2/attention-strip';
import { OemBreakdown } from '@/components/v2/oem-breakdown';
import { OemGroupSection } from '@/components/v2/oem-group';
import { FleetData, groupByOem, fleetMoney } from '@/lib/v2/fleet';
import { randCompact, rand } from '@/lib/v2/brand';

const REFRESH_INTERVAL = 5 * 60 * 1000;

export default function CommandCentre() {
  const [data, setData] = useState<FleetData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastFetched, setLastFetched] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

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

  const summary = data?.summary;
  const stations = data?.stations ?? [];
  const groups = groupByOem(stations);
  const money = summary ? fleetMoney(summary) : null;
  const lifetimeMwh = summary ? summary.total_lifetime_kwh / 1000 : 0;

  return (
    <>
      <OneViewHeader
        title="Command Centre"
        subtitle={summary ? `${summary.total} stations across ${groups.length} manufacturers · ${summary.online} online` : 'Loading fleet…'}
        lastUpdated={lastFetched}
        onRefresh={() => fetchData(true)}
        refreshing={refreshing}
      />

      <div className="flex-1 p-7 space-y-6">
        {/* Money + live band */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatTile
            label="Today's Value"
            value={money ? randCompact(money.today.savings) : '—'}
            tag="est."
            sub="Saved vs Eskom grid @ R2.50/kWh"
            icon={<Wallet size={16} />}
            accent="var(--accent)"
            hero
          />
          <StatTile
            label="Month to Date"
            value={money ? randCompact(money.month.savings) : '—'}
            tag="est."
            sub={new Date().toLocaleDateString([], { month: 'long', year: 'numeric' })}
            icon={<TrendingUp size={16} />}
            accent="var(--money)"
            hero
          />
          <StatTile
            label="Live Generation"
            value={summary ? summary.total_pv_kw.toFixed(1) : '—'}
            unit="kW"
            sub={summary ? `Across ${summary.online} online sites` : ''}
            icon={<Zap size={16} />}
            accent="var(--accent)"
          />
          <StatTile
            label="Today's Yield"
            value={summary ? summary.total_today_kwh.toFixed(0) : '—'}
            unit="kWh"
            sub="Fleet energy so far today"
            icon={<Sun size={16} />}
            accent="#F59E0B"
          />
        </div>

        {/* Lifetime impact ribbon */}
        <div className="ov-card flex flex-wrap items-center gap-x-8 gap-y-3 px-5 py-4">
          <span className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.13em]" style={{ color: 'var(--text-muted)' }}>
            <Leaf size={14} style={{ color: 'var(--accent)' }} /> Lifetime Impact
          </span>
          <Impact label="Energy generated" value={summary ? `${lifetimeMwh.toFixed(1)} MWh` : '—'} />
          <Impact label="Value generated" value={money ? rand(money.lifetime.savings) : '—'} tag="est." />
          <Impact label="CO₂ avoided today" value={money ? `${money.today.carbonKg.toFixed(0)} kg` : '—'} tag="est." />
        </div>

        {/* What needs you */}
        {loading ? <Skeleton h={96} /> : <AttentionStrip stations={stations} />}

        {/* Health + contribution */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {loading || !summary
            ? <><Skeleton h={180} /><Skeleton h={180} className="lg:col-span-2" /></>
            : <>
                <HealthBar online={summary.online} alarm={summary.alarm} offline={summary.offline} />
                <div className="lg:col-span-2"><OemBreakdown groups={groups} /></div>
              </>}
        </div>

        {/* Fleet by manufacturer */}
        <div className="space-y-3">
          <h2 className="text-sm font-bold uppercase tracking-[0.13em]" style={{ color: 'var(--text-secondary)' }}>
            Fleet by Manufacturer
          </h2>
          {loading
            ? <><Skeleton h={64} /><Skeleton h={64} /></>
            : groups.map(g => <OemGroupSection key={g.key} group={g} />)}
        </div>
      </div>
    </>
  );
}

function Impact({ label, value, tag }: { label: string; value: string; tag?: string }) {
  return (
    <div>
      <p className="tnum text-lg font-extrabold leading-none" style={{ color: 'var(--text-primary)' }}>
        {value}{tag && <span className="ml-1 text-[9px] font-bold uppercase" style={{ color: 'var(--text-muted)' }}>{tag}</span>}
      </p>
      <p className="text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>{label}</p>
    </div>
  );
}

function Skeleton({ h, className = '' }: { h: number; className?: string }) {
  return <div className={`ov-card animate-pulse ${className}`} style={{ height: h, background: 'var(--card)' }} />;
}
