'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Header } from '@/components/header';
import { MetricCard } from '@/components/metric-card';
import { PowerChart } from '@/components/charts/power-chart';
import { YieldChart } from '@/components/charts/yield-chart';
import {
  ChevronRight, ChevronLeft, Zap, Sun, TrendingUp,
  Battery, Thermometer, Activity, AlertCircle,
} from 'lucide-react';

type Range = 'day' | 'month' | 'year' | 'all';

const TABS: { key: Range; label: string }[] = [
  { key: 'day',   label: 'Day' },
  { key: 'month', label: 'Month' },
  { key: 'year',  label: 'Year' },
  { key: 'all',   label: 'All Time' },
];

const MIN_DATE = '2026-03-01';
const MIN_YEAR = 2026;

function todayStr()     { return new Date().toISOString().slice(0, 10); }
function yesterdayStr() { return new Date(Date.now() - 86_400_000).toISOString().slice(0, 10); }
function curMonthStr()  { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }
function curYear()      { return new Date().getFullYear(); }

function fmtMonthLabel(yyyymm: string) {
  const [y, m] = yyyymm.split('-');
  return new Date(+y, +m - 1, 1).toLocaleDateString([], { month: 'long', year: 'numeric' });
}

function DataBadge({ granularity, source }: { granularity: string; source: string }) {
  const res   = granularity === '5min' ? '5-min' : granularity === 'hour' ? 'Hourly' : granularity === 'month' ? 'Monthly' : 'Daily';
  const src   = source === 'fusionsolar' ? 'Huawei FusionSolar' : 'LIVOLTEK';
  const color = source === 'fusionsolar' ? '#F59E0B' : '#22C55E';
  return (
    <span
      className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
      style={{ background: `${color}22`, color, border: `1px solid ${color}55` }}
    >
      {res} · {src}
    </span>
  );
}

function statusLabel(source: string, health: number | null, status: number | null) {
  if (source === 'fusionsolar') {
    if (health === 3) return { label: 'Online',  color: 'var(--accent)' };
    if (health === 2) return { label: 'Alarm',   color: 'var(--alarm)' };
    return                    { label: 'Offline', color: 'var(--offline)' };
  }
  if (status === 1) return { label: 'Online',  color: 'var(--accent)' };
  if (status === 4) return { label: 'Alarm',   color: 'var(--alarm)' };
  return                   { label: 'Offline', color: 'var(--offline)' };
}

function fmt(n: number | null, decimals = 1) { return n == null ? '—' : n.toFixed(decimals); }
function fmtKwh(n: number | null) {
  if (n == null) return '—';
  if (n >= 1000) return `${(n / 1000).toFixed(2)} MWh`;
  return `${n.toFixed(1)} kWh`;
}

interface StationData {
  station: { id: string; name: string; source: string; location: string | null; capacity_kw: number | null };
  granularity: '5min' | 'hour' | 'day' | 'month';
  hourlyUnavailable?: boolean;
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
  selectedDate: string;
  selectedMonth: string;
  selectedYear: number;
}

// ── nav button shared style ───────────────────────────────────────────────────
function navBtn(disabled: boolean): React.CSSProperties {
  return {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    width: 30, height: 30, borderRadius: 6, flexShrink: 0,
    background: 'var(--card)', border: '1px solid var(--border)',
    color: disabled ? 'var(--text-muted)' : 'var(--text-secondary)',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.45 : 1,
  };
}

export default function StationDetailPage() {
  const { id }     = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const router     = useRouter();

  // Initialise from URL so the page is bookmarkable
  const initRange  = (searchParams.get('range') as Range) ?? 'day';
  const initDate   = searchParams.get('date')  ?? yesterdayStr();
  const initMonth  = searchParams.get('month') ?? curMonthStr();
  const initYear   = +(searchParams.get('year') ?? curYear());

  const [range,         setRange]         = useState<Range>(initRange);
  const [selectedDate,  setSelectedDate]  = useState(initDate);
  const [selectedMonth, setSelectedMonth] = useState(initMonth);
  const [selectedYear,  setSelectedYear]  = useState(initYear);
  const [data,          setData]          = useState<StationData | null>(null);
  const [loading,       setLoading]       = useState(true);
  const [refreshing,    setRefreshing]    = useState(false);

  // Keep stable refs so the initial effect doesn't need them as deps
  const initRef = useRef({ range: initRange, date: initDate, month: initMonth, year: initYear });

  function apiUrl(r: Range, d: string, m: string, y: number) {
    let u = `/api/dashboard/station/${id}?range=${r}`;
    if (r === 'day')   u += `&date=${d}`;
    if (r === 'month') u += `&month=${m}`;
    if (r === 'year')  u += `&year=${y}`;
    return u;
  }

  function pageUrl(r: Range, d: string, m: string, y: number) {
    let u = `/station/${id}?range=${r}`;
    if (r === 'day')   u += `&date=${d}`;
    if (r === 'month') u += `&month=${m}`;
    if (r === 'year')  u += `&year=${y}`;
    return u;
  }

  const fetchData = useCallback(async (
    r: Range, d: string, m: string, y: number, isRefresh = false,
  ) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    try {
      const res  = await fetch(apiUrl(r, d, m, y));
      if (!res.ok) throw new Error('Failed');
      const json: StationData = await res.json();
      setData(json);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Fetch on mount (and whenever station id changes)
  useEffect(() => {
    const { range: r, date: d, month: m, year: y } = initRef.current;
    fetchData(r, d, m, y);
  }, [fetchData]);

  // ── navigation handlers ───────────────────────────────────────────────────
  function changeRange(r: Range) {
    setRange(r);
    router.replace(pageUrl(r, selectedDate, selectedMonth, selectedYear), { scroll: false });
    fetchData(r, selectedDate, selectedMonth, selectedYear);
  }

  function handleDateChange(newDate: string) {
    if (!newDate || newDate < MIN_DATE || newDate > todayStr()) return;
    setSelectedDate(newDate);
    router.replace(pageUrl('day', newDate, selectedMonth, selectedYear), { scroll: false });
    fetchData('day', newDate, selectedMonth, selectedYear);
  }

  function stepDay(delta: 1 | -1) {
    const d = new Date(selectedDate + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + delta);
    handleDateChange(d.toISOString().slice(0, 10));
  }

  function stepMonth(delta: 1 | -1) {
    const [y, m] = selectedMonth.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    const nm = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    if (nm > curMonthStr() || nm < '2026-03') return;
    setSelectedMonth(nm);
    router.replace(pageUrl('month', selectedDate, nm, selectedYear), { scroll: false });
    fetchData('month', selectedDate, nm, selectedYear);
  }

  function stepYear(delta: 1 | -1) {
    const ny = selectedYear + delta;
    if (ny < MIN_YEAR || ny > curYear()) return;
    setSelectedYear(ny);
    router.replace(pageUrl('year', selectedDate, selectedMonth, ny), { scroll: false });
    fetchData('year', selectedDate, selectedMonth, ny);
  }

  // ── derived ──────────────────────────────────────────────────────────────
  const station  = data?.station;
  const live     = data?.live;
  const stStatus = live ? statusLabel(station?.source ?? '', live.health_state, live.status) : null;
  const showPowerChart = data?.granularity === '5min' || data?.granularity === 'hour';

  function chartTitle() {
    if (range === 'day') {
      if (data?.granularity === '5min') return 'Power Output';
      if (data?.granularity === 'hour') return 'Hourly Power';
      return 'Daily Total';
    }
    if (range === 'month') return 'Daily Yield';
    if (range === 'year')  return 'Monthly Yield';
    return 'All-Time Yield';
  }

  // YieldChart range prop mapping
  const yieldRange = (range === 'year' ? 'year' : range === 'all' ? 'all' : 'month') as 'month' | 'year' | 'all';

  return (
    <>
      <Header
        title={station?.name ?? 'Station Detail'}
        subtitle={station?.location ?? undefined}
        lastUpdated={live?.fetched_at}
        onRefresh={() => fetchData(range, selectedDate, selectedMonth, selectedYear, true)}
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
          <MetricCard label="Today"      value={live ? fmtKwh(live.today_kwh)  : '—'} icon={<Sun size={14} />}        accent="var(--accent)" />
          <MetricCard label="This Month" value={live ? fmtKwh(live.month_kwh)  : '—'} icon={<TrendingUp size={14} />} accent="#3B82F6" />
          <MetricCard label="All Time"   value={live ? fmtKwh(live.total_kwh)  : '—'} icon={<TrendingUp size={14} />} accent="#8B5CF6" />
        </div>

        {/* Chart card */}
        <div
          className="rounded-xl p-5"
          style={{ background: 'var(--surface)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)' }}
        >
          {/* Header: title + badge  |  range tabs */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2 min-w-0">
              <h2 className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
                {chartTitle()}
              </h2>
              {data && <DataBadge granularity={data.granularity} source={data.station.source} />}
            </div>
            <div className="flex rounded-lg overflow-hidden ml-4 shrink-0" style={{ border: '1px solid var(--border)' }}>
              {TABS.map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => changeRange(key)}
                  className="px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer"
                  style={{
                    background:  range === key ? 'var(--accent)' : 'var(--surface)',
                    color:       range === key ? '#fff' : 'var(--text-secondary)',
                    borderRight: key !== 'all' ? '1px solid var(--border)' : undefined,
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* ── Pickers ─────────────────────────────────────────────────────── */}
          {range === 'day' && (
            <div className="flex items-center gap-2 mb-5">
              <button style={navBtn(selectedDate <= MIN_DATE)} onClick={() => stepDay(-1)} disabled={selectedDate <= MIN_DATE}>
                <ChevronLeft size={14} />
              </button>
              <input
                type="date"
                value={selectedDate}
                min={MIN_DATE}
                max={todayStr()}
                onChange={e => handleDateChange(e.target.value)}
                className="text-xs font-medium px-3 py-1.5 rounded-lg cursor-pointer"
                style={{
                  background: 'var(--card)', border: '1px solid var(--border)',
                  color: 'var(--text-primary)', outline: 'none',
                }}
              />
              <button style={navBtn(selectedDate >= todayStr())} onClick={() => stepDay(1)} disabled={selectedDate >= todayStr()}>
                <ChevronRight size={14} />
              </button>
            </div>
          )}

          {range === 'month' && (
            <div className="flex items-center gap-3 mb-5">
              <button style={navBtn(selectedMonth <= '2026-03')} onClick={() => stepMonth(-1)} disabled={selectedMonth <= '2026-03'}>
                <ChevronLeft size={14} />
              </button>
              <span className="text-sm font-medium w-40 text-center select-none" style={{ color: 'var(--text-primary)' }}>
                {fmtMonthLabel(selectedMonth)}
              </span>
              <button style={navBtn(selectedMonth >= curMonthStr())} onClick={() => stepMonth(1)} disabled={selectedMonth >= curMonthStr()}>
                <ChevronRight size={14} />
              </button>
            </div>
          )}

          {range === 'year' && (
            <div className="flex items-center gap-3 mb-5">
              <button style={navBtn(selectedYear <= MIN_YEAR)} onClick={() => stepYear(-1)} disabled={selectedYear <= MIN_YEAR}>
                <ChevronLeft size={14} />
              </button>
              <span className="text-sm font-semibold w-16 text-center select-none" style={{ color: 'var(--text-primary)' }}>
                {selectedYear}
              </span>
              <button style={navBtn(selectedYear >= curYear())} onClick={() => stepYear(1)} disabled={selectedYear >= curYear()}>
                <ChevronRight size={14} />
              </button>
            </div>
          )}

          {/* ── Chart area ──────────────────────────────────────────────────── */}
          {loading ? (
            <div className="h-[300px] rounded-lg animate-pulse" style={{ background: 'var(--card)' }} />
          ) : data?.hourlyUnavailable ? (
            /* FusionSolar day older than 7 days — show notice + daily total */
            <div className="flex flex-col items-center justify-center h-[300px] gap-6">
              <div
                className="flex items-start gap-2.5 rounded-xl px-4 py-3 text-sm max-w-sm text-left"
                style={{ background: '#F59E0B18', border: '1px solid #F59E0B44', color: '#F59E0B' }}
              >
                <AlertCircle size={16} className="mt-0.5 shrink-0" />
                <span>
                  Hourly data is only available for the past 7 days on Huawei FusionSolar plants.
                  Showing the daily total for the selected date instead.
                </span>
              </div>
              {data.readings.length > 0 ? (
                <div className="text-center">
                  <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>Total yield for this day</p>
                  <p className="text-4xl font-bold" style={{ color: 'var(--text-primary)' }}>
                    {fmtKwh((data.readings[0] as { pv_yield_kwh: number }).pv_yield_kwh)}
                  </p>
                </div>
              ) : (
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No data recorded for this date.</p>
              )}
            </div>
          ) : showPowerChart ? (
            <PowerChart
              readings={(data?.readings ?? []) as unknown as Parameters<typeof PowerChart>[0]['readings']}
              range="day"
              granularity={data?.granularity === 'hour' ? 'hour' : '5min'}
            />
          ) : (
            <YieldChart
              data={(data?.readings ?? []) as Record<string, unknown>[]}
              range={yieldRange}
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
                <p style={{ color: 'var(--text-primary)' }}>{station.source === 'fusionsolar' ? 'Huawei FusionSolar' : 'LIVOLTEK'}</p>
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
