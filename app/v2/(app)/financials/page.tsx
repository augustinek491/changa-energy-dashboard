'use client';

// Changa OneView — Financials. Turns real fleet energy (kWh) into Rand using a
// configurable South-African rate model: grid savings, PPA revenue, export, and
// carbon avoided, over any period. Honours the console-wide fleet filter, so the
// money figures can be sliced by OEM / province / status like every other page.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Sun, Wallet, Banknote, Leaf, RotateCcw } from 'lucide-react';
import { OneViewHeader } from '@/components/v2/oneview-header';
import { FilterBar } from '@/components/v2/filter-bar';
import { StatTile } from '@/components/v2/stat-tile';
import { useFleetFilter } from '@/components/v2/filter-context';
import { FleetData, Station } from '@/lib/v2/fleet';
import { applyFilters } from '@/lib/v2/filter';
import { oemMeta, RATES, rand, randCompact } from '@/lib/v2/brand';

const REFRESH_INTERVAL = 5 * 60 * 1000;

type Period = 'today' | 'month' | 'lifetime';
const PERIODS: { key: Period; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'month', label: 'This month' },
  { key: 'lifetime', label: 'Lifetime' },
];

function energyOf(s: Station, p: Period): number {
  const l = s.live;
  if (!l) return 0;
  if (p === 'today') return l.today_kwh ?? 0;
  if (p === 'month') return l.month_kwh ?? 0;
  return l.total_kwh ?? 0;
}

function fmtEnergy(kwh: number): string {
  return kwh >= 1000 ? `${(kwh / 1000).toFixed(2)} MWh` : `${Math.round(kwh)} kWh`;
}

function fmtCO2(kg: number): string {
  return kg >= 1000 ? `${(kg / 1000).toFixed(1)} t` : `${Math.round(kg)} kg`;
}

export default function FinancialsPage() {
  const [data, setData] = useState<FleetData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastFetched, setLastFetched] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const { filter } = useFleetFilter();
  const [period, setPeriod] = useState<Period>('month');

  // Rate model — seeded from the locked SA defaults, editable for scenarios.
  // Kept as strings so the inputs accept partial values ("2.", "") while typing.
  const [rateStr, setRateStr] = useState({
    grid: String(RATES.gridTariff),
    ppa: String(RATES.ppaTariff),
    export: String(RATES.exportTariff),
  });
  const rates = {
    grid: parseFloat(rateStr.grid) || 0,
    ppa: parseFloat(rateStr.ppa) || 0,
    export: parseFloat(rateStr.export) || 0,
  };
  const edited =
    rates.grid !== RATES.gridTariff ||
    rates.ppa !== RATES.ppaTariff ||
    rates.export !== RATES.exportTariff;
  const resetRates = () =>
    setRateStr({ grid: String(RATES.gridTariff), ppa: String(RATES.ppaTariff), export: String(RATES.exportTariff) });

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
  const filtered = stations.length !== all.length;

  const kwh = useMemo(() => stations.reduce((n, s) => n + energyOf(s, period), 0), [stations, period]);
  const savings = kwh * rates.grid;
  const ppa = kwh * rates.ppa;
  const carbonKg = kwh * RATES.carbonFactor;

  const byOem = useMemo(() => {
    const map = new Map<string, { key: string; label: string; color: string; kwh: number }>();
    for (const s of stations) {
      const m = oemMeta(s.source);
      const g = map.get(m.key) ?? { key: m.key, label: m.label, color: m.color, kwh: 0 };
      g.kwh += energyOf(s, period);
      map.set(m.key, g);
    }
    return [...map.values()].sort((a, b) => b.kwh - a.kwh);
  }, [stations, period]);

  const periodWord = period === 'today' ? 'today' : period === 'month' ? 'this month' : 'all-time';
  const subtitle = data
    ? `${randCompact(savings)} saved ${periodWord} · ${stations.length}${filtered ? ` of ${all.length}` : ''} sites`
    : 'Loading fleet…';

  return (
    <>
      <OneViewHeader
        title="Financials"
        subtitle={subtitle}
        lastUpdated={lastFetched}
        onRefresh={() => fetchData(true)}
        refreshing={refreshing}
      />

      <div className="flex-1 p-7 space-y-5">
        <FilterBar stations={all} />

        {/* Period selector */}
        <div className="flex items-center justify-between gap-3">
          <Segmented value={period} onChange={setPeriod} />
          <p className="hidden sm:block text-[11px]" style={{ color: 'var(--text-muted)' }}>
            Real energy · estimated Rand
          </p>
        </div>

        {/* Hero value band */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatTile
            label="Energy generated"
            value={data ? (kwh >= 1000 ? (kwh / 1000).toFixed(1) : Math.round(kwh).toString()) : '—'}
            unit={kwh >= 1000 ? 'MWh' : 'kWh'}
            sub={`Fleet output ${periodWord}`}
            icon={<Sun size={16} />}
            accent="#F59E0B"
          />
          <StatTile
            label="Grid savings"
            value={data ? randCompact(savings) : '—'}
            tag="est."
            sub={`Saved vs Eskom @ ${rand(rates.grid)}/kWh`}
            icon={<Wallet size={16} />}
            accent="var(--accent)"
            hero
          />
          <StatTile
            label="PPA revenue"
            value={data ? randCompact(ppa) : '—'}
            tag="est."
            sub={`If sold @ ${rand(rates.ppa)}/kWh`}
            icon={<Banknote size={16} />}
            accent="var(--money)"
            hero
          />
          <StatTile
            label="Carbon avoided"
            value={data ? fmtCO2(carbonKg) : '—'}
            tag="est."
            sub={`CO₂ @ ${RATES.carbonFactor} kg/kWh`}
            icon={<Leaf size={16} />}
            accent="var(--accent)"
          />
        </div>

        {/* Rate model + value streams */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Configurable rate model */}
          <div className="ov-card p-5">
            <div className="flex items-start justify-between gap-3 mb-4">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.13em]" style={{ color: 'var(--text-secondary)' }}>
                  Rate model
                </p>
                <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
                  Rand per kWh. Adjust to model tariff scenarios.
                </p>
              </div>
              {edited && (
                <button
                  type="button"
                  onClick={resetRates}
                  className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold cursor-pointer transition-colors hover:bg-[var(--card-hover)]"
                  style={{ color: 'var(--text-muted)' }}
                >
                  <RotateCcw size={12} /> Reset
                </button>
              )}
            </div>

            <div className="space-y-2.5">
              <RateInput label="Grid tariff" hint="Eskom savings" color="var(--accent)" value={rateStr.grid} onChange={v => setRateStr(r => ({ ...r, grid: v }))} />
              <RateInput label="PPA tariff" hint="Power purchase agreement" color="var(--money)" value={rateStr.ppa} onChange={v => setRateStr(r => ({ ...r, ppa: v }))} />
              <RateInput label="Export tariff" hint="Feed-in surplus" color="var(--text-secondary)" value={rateStr.export} onChange={v => setRateStr(r => ({ ...r, export: v }))} />
            </div>

            <p className="mt-4 text-[11px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
              Energy is metered from each OEM portal. Rand figures are estimates for illustration and carry an “est.” tag throughout.
            </p>
          </div>

          {/* Value streams — transparent kWh × rate math */}
          <div className="ov-card p-5">
            <p className="text-[11px] font-bold uppercase tracking-[0.13em]" style={{ color: 'var(--text-secondary)' }}>
              Value streams · {periodWord}
            </p>
            <div className="mt-4 space-y-3.5">
              <Stream label="Grid savings" kwh={kwh} rate={rates.grid} color="var(--accent)" />
              <Stream label="PPA revenue" kwh={kwh} rate={rates.ppa} color="var(--money)" />
              <Stream label="Export earnings" kwh={kwh} rate={rates.export} color="var(--status-offline)" />
            </div>
            <div className="mt-4 flex items-center justify-between border-t pt-3" style={{ borderColor: 'var(--border)' }}>
              <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
                Energy basis
              </span>
              <span className="tnum text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
                {fmtEnergy(kwh)}
              </span>
            </div>
          </div>
        </div>

        {/* Value by manufacturer */}
        <div className="ov-card p-5">
          <div className="flex items-end justify-between mb-4">
            <p className="text-[11px] font-bold uppercase tracking-[0.13em]" style={{ color: 'var(--text-secondary)' }}>
              Grid savings by manufacturer · {periodWord}
            </p>
            <p className="tnum text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
              {rand(savings)} total
            </p>
          </div>

          {loading ? (
            <div className="space-y-3.5">
              {[0, 1].map(i => <div key={i} className="h-10 animate-pulse rounded-lg" style={{ background: 'var(--card)' }} />)}
            </div>
          ) : byOem.length === 0 ? (
            <p className="py-6 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
              No sites match your filters.
            </p>
          ) : (
            <div className="space-y-3.5">
              {byOem.map(g => {
                const v = g.kwh * rates.grid;
                const max = Math.max(...byOem.map(x => x.kwh), 0.001);
                const share = savings > 0 ? (g.kwh * rates.grid) / savings * 100 : 0;
                return (
                  <div key={g.key}>
                    <div className="mb-1.5 flex items-center justify-between">
                      <span className="flex items-center gap-2 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                        <span className="h-2 w-2 rounded-full" style={{ background: g.color }} />
                        {g.label}
                      </span>
                      <span className="tnum text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
                        {rand(v)} · {share.toFixed(0)}%
                      </span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full" style={{ background: 'var(--card)' }}>
                      <div className="h-full rounded-full transition-all" style={{ width: `${(g.kwh / max) * 100}%`, background: g.color }} />
                    </div>
                    <p className="mt-1 tnum text-[11px]" style={{ color: 'var(--text-muted)' }}>
                      {fmtEnergy(g.kwh)} generated
                    </p>
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

function Segmented({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  return (
    <div className="inline-flex rounded-lg p-0.5" style={{ background: 'var(--card-hover)', border: '1px solid var(--border)' }}>
      {PERIODS.map(p => {
        const on = p.key === value;
        return (
          <button
            key={p.key}
            type="button"
            onClick={() => onChange(p.key)}
            className="rounded-md px-3 py-1.5 text-[12px] font-semibold cursor-pointer transition-colors"
            style={{ background: on ? 'var(--accent)' : 'transparent', color: on ? '#fff' : 'var(--text-secondary)' }}
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}

function RateInput({ label, hint, value, onChange, color }: {
  label: string; hint: string; value: string; onChange: (v: string) => void; color: string;
}) {
  return (
    <label className="flex items-center justify-between gap-3">
      <span>
        <span className="block text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{label}</span>
        <span className="block text-[11px]" style={{ color: 'var(--text-muted)' }}>{hint}</span>
      </span>
      <span
        className="inline-flex items-center rounded-lg px-2.5 py-1.5"
        style={{ background: 'var(--card-hover)', border: '1px solid var(--border)' }}
      >
        <span className="mr-1 text-sm font-bold" style={{ color }}>R</span>
        <input
          type="number"
          inputMode="decimal"
          step="0.1"
          min="0"
          value={value}
          onChange={e => onChange(e.target.value)}
          className="tnum w-14 bg-transparent text-right text-sm font-bold outline-none"
          style={{ color: 'var(--text-primary)' }}
        />
        <span className="ml-1 text-[11px]" style={{ color: 'var(--text-muted)' }}>/kWh</span>
      </span>
    </label>
  );
}

function Stream({ label, kwh, rate, color }: { label: string; kwh: number; rate: number; color: string }) {
  const v = kwh * rate;
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="flex items-center gap-2">
        <span className="h-2 w-2 rounded-full" style={{ background: color }} />
        <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{label}</span>
      </span>
      <span className="text-right">
        <span className="tnum block text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
          {rand(v)}
          <span className="ml-1 text-[9px] font-bold uppercase" style={{ color: 'var(--text-muted)' }}>est.</span>
        </span>
        <span className="tnum block text-[11px]" style={{ color: 'var(--text-muted)' }}>
          {fmtEnergy(kwh)} × {rand(rate)}
        </span>
      </span>
    </div>
  );
}
