'use client';

// Changa OneView — Station Detail. The deep view behind every fleet row: live
// vitals, a time-series chart (intraday power, then daily/monthly yield), the
// Rand value of what the site is generating, and its nameplate facts. Reuses
// the proven /api/dashboard/station/[id] feed and the shared recharts visuals;
// reskinned in the OneView design language.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ChevronRight, ChevronLeft, Zap, Sun, TrendingUp, Banknote,
  Battery, Thermometer, Activity, AlertCircle, Cable,
} from 'lucide-react';
import { OneViewHeader } from '@/components/v2/oneview-header';
import { StatTile } from '@/components/v2/stat-tile';
import { PowerChart } from '@/components/charts/power-chart';
import { YieldChart } from '@/components/charts/yield-chart';
import { oemMeta, valueOfEnergy, rand, randCompact } from '@/lib/v2/brand';

type Range = 'day' | 'month' | 'year' | 'all';

const TABS: { key: Range; label: string }[] = [
  { key: 'day',   label: 'Day' },
  { key: 'month', label: 'Month' },
  { key: 'year',  label: 'Year' },
  { key: 'all',   label: 'All time' },
];

const MIN_DATE = '2026-03-01';
const MIN_YEAR = 2026;

function todayStr()    { return new Date().toISOString().slice(0, 10); }
function curMonthStr() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }
function curYear()     { return new Date().getFullYear(); }

function fmtMonthLabel(yyyymm: string) {
  const [y, m] = yyyymm.split('-');
  return new Date(+y, +m - 1, 1).toLocaleDateString([], { month: 'long', year: 'numeric' });
}

/** Every month from the project start (March 2026) to the current month. */
function getMonthOptions(): string[] {
  const opts: string[] = [];
  const now = new Date();
  let y = 2026, m = 3;
  while (y < now.getFullYear() || (y === now.getFullYear() && m <= now.getMonth() + 1)) {
    opts.push(`${y}-${String(m).padStart(2, '0')}`);
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return opts;
}

function fmt(n: number | null, decimals = 1) { return n == null ? '—' : n.toFixed(decimals); }
function fmtKwh(n: number | null) {
  if (n == null) return '—';
  if (n >= 1000) return `${(n / 1000).toFixed(2)} MWh`;
  return `${n.toFixed(1)} kWh`;
}

type Status = 'online' | 'alarm' | 'offline';
const STATUS_COLOR: Record<Status, string> = {
  online: 'var(--accent)',
  alarm: 'var(--status-alarm)',
  offline: 'var(--status-offline)',
};
const STATUS_LABEL: Record<Status, string> = {
  online: 'Online', alarm: 'Alarm', offline: 'Offline',
};

function statusOf(source: string, health: number | null, status: number | null): Status {
  if (source === 'fusionsolar') {
    if (health === 3) return 'online';
    if (health === 2) return 'alarm';
    return 'offline';
  }
  if (status === 1) return 'online';
  if (status === 4) return 'alarm';
  return 'offline';
}

interface StationData {
  station: { id: string; name: string; source: string; location: string | null; capacity_kw: number | null };
  granularity: '5min' | 'hour' | 'day' | 'month';
  hourlyUnavailable?: boolean;
  sparseDay?: boolean;
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

function navBtn(disabled: boolean): React.CSSProperties {
  return {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    width: 32, height: 32, borderRadius: 8, flexShrink: 0,
    background: 'var(--card)', border: '1px solid var(--border)',
    color: disabled ? 'var(--text-muted)' : 'var(--text-secondary)',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.45 : 1,
  };
}

function capacityLabel(source: string, capacity_kw: number | null): string {
  if (!capacity_kw) return '—';
  const kwp = source === 'livoltek' && capacity_kw > 1000 ? capacity_kw / 1000 : capacity_kw;
  return `${kwp.toFixed(2)} kWp`;
}

export default function StationDetailV2() {
  const { id } = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();

  const initRange = (searchParams.get('range') as Range) ?? 'day';
  const initDate  = searchParams.get('date')  ?? todayStr();
  const initMonth = searchParams.get('month') ?? curMonthStr();
  const initYear  = +(searchParams.get('year') ?? curYear());

  const [range,        setRange]        = useState<Range>(initRange);
  const [selectedDate, setSelectedDate] = useState(initDate);
  const [selectedMonth, setSelectedMonth] = useState(initMonth);
  const [selectedYear, setSelectedYear] = useState(initYear);
  const [data,         setData]         = useState<StationData | null>(null);
  const [loading,      setLoading]      = useState(true);
  const [refreshing,   setRefreshing]   = useState(false);

  const initRef = useRef({ range: initRange, date: initDate, month: initMonth, year: initYear });

  function apiUrl(r: Range, d: string, m: string, y: number) {
    let u = `/api/dashboard/station/${id}?range=${r}`;
    if (r === 'day')   u += `&date=${d}`;
    if (r === 'month') u += `&month=${m}`;
    if (r === 'year')  u += `&year=${y}`;
    return u;
  }

  function pageUrl(r: Range, d: string, m: string, y: number) {
    let u = `/v2/stations/${id}?range=${r}`;
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
      const res = await fetch(apiUrl(r, d, m, y));
      if (!res.ok) throw new Error('Failed');
      setData(await res.json());
    } catch (e) {
      console.error('Station fetch failed:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    const { range: r, date: d, month: m, year: y } = initRef.current;
    fetchData(r, d, m, y);
  }, [fetchData]);

  function changeRange(r: Range) {
    const newDate  = r === 'day'   ? todayStr()    : selectedDate;
    const newMonth = r === 'month' ? curMonthStr() : selectedMonth;
    const newYear  = r === 'year'  ? curYear()     : selectedYear;
    setRange(r);
    setSelectedDate(newDate);
    setSelectedMonth(newMonth);
    setSelectedYear(newYear);
    router.replace(pageUrl(r, newDate, newMonth, newYear), { scroll: false });
    fetchData(r, newDate, newMonth, newYear);
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

  const station = data?.station;
  const live = data?.live;
  const m = oemMeta(station?.source);
  const status = live ? statusOf(station?.source ?? '', live.health_state, live.status) : null;
  const showPowerChart = data?.granularity === '5min' || data?.granularity === 'hour';
  const yieldRange = (range === 'year' ? 'year' : range === 'all' ? 'all' : 'month') as 'month' | 'year' | 'all';

  // Money: value of energy generated this month (the headline streams to Financials).
  const monthValue = valueOfEnergy(live?.month_kwh ?? 0).savings;
  const lifetimeValue = valueOfEnergy(live?.total_kwh ?? 0).savings;

  function chartTitle() {
    if (range === 'day') {
      if (data?.granularity === '5min') return 'Power output';
      if (data?.granularity === 'hour') return 'Hourly power';
      return 'Daily total';
    }
    if (range === 'month') return 'Daily yield';
    if (range === 'year')  return 'Monthly yield';
    return 'All-time yield';
  }

  const subtitle = station
    ? [station.location, m.label].filter(Boolean).join(' · ')
    : 'Loading station…';

  return (
    <>
      <OneViewHeader
        title={station?.name ?? 'Station Detail'}
        subtitle={subtitle}
        lastUpdated={live?.fetched_at}
        onRefresh={() => fetchData(range, selectedDate, selectedMonth, selectedYear, true)}
        refreshing={refreshing}
      />

      <div className="flex-1 p-7 space-y-5">
        {/* Breadcrumb */}
        <div className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-muted)' }}>
          <Link href="/v2/stations" className="hover:underline cursor-pointer" style={{ color: 'var(--text-secondary)' }}>
            Stations
          </Link>
          <ChevronRight size={12} />
          <span style={{ color: 'var(--text-primary)' }}>{station?.name ?? '…'}</span>
        </div>

        {/* Live vitals strip */}
        <div className="ov-card grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 p-5">
          <Vital label="Status">
            {status ? (
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full" style={{ background: STATUS_COLOR[status], boxShadow: `0 0 5px ${STATUS_COLOR[status]}` }} />
                <span className="text-sm font-bold" style={{ color: STATUS_COLOR[status] }}>{STATUS_LABEL[status]}</span>
              </span>
            ) : <Dash />}
          </Vital>
          <Vital label="PV Power" icon={<Zap size={13} style={{ color: 'var(--accent)' }} />}>
            <Num>{fmt(live?.pv_power_kw ?? null)}</Num><U>kW</U>
            {live?.fetched_at && (
              <span className="block text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                as of {new Date(live.fetched_at).toLocaleTimeString('en-ZA', { timeZone: 'Africa/Johannesburg', hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </Vital>
          <Vital label="Load" icon={<Activity size={13} style={{ color: '#F97316' }} />}>
            <Num>{fmt(live?.load_power_kw ?? null)}</Num><U>kW</U>
          </Vital>
          <Vital label="Grid" icon={<Cable size={13} style={{ color: 'var(--oem-livoltek)' }} />}>
            <Num>{fmt(live?.grid_power_kw ?? null)}</Num><U>kW</U>
          </Vital>
          <Vital label="Battery SOC" icon={<Battery size={13} style={{ color: 'var(--oem-livoltek)' }} />}>
            <Num>{live?.battery_soc != null ? `${Math.round(live.battery_soc)}` : '—'}</Num>{live?.battery_soc != null && <U>%</U>}
          </Vital>
          <Vital label="Temp" icon={<Thermometer size={13} style={{ color: 'var(--oem-fusionsolar)' }} />}>
            {live?.temperature_c != null ? <><Num>{fmt(live.temperature_c)}</Num><U>°C</U></> : <Dash />}
          </Vital>
        </div>

        {/* KPI tiles */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatTile label="Today" value={live ? fmtKwh(live.today_kwh) : '—'} icon={<Sun size={16} />} accent="var(--status-alarm)" sub="Energy generated" />
          <StatTile label="This month" value={live ? fmtKwh(live.month_kwh) : '—'} icon={<TrendingUp size={16} />} accent="var(--accent)" sub="Month to date" />
          <StatTile label="Lifetime" value={live ? fmtKwh(live.total_kwh) : '—'} icon={<TrendingUp size={16} />} accent="var(--oem-fusionsolar)" sub="Since commissioning" />
          <StatTile label="Value this month" value={live ? randCompact(monthValue) : '—'} icon={<Banknote size={16} />} accent="var(--money)" tag="est." sub="Grid savings" hero />
        </div>

        {/* Chart card */}
        <div className="ov-card p-5">
          <div className="flex items-center justify-between gap-4 mb-4 flex-wrap">
            <div className="flex items-center gap-2 min-w-0">
              <h2 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{chartTitle()}</h2>
              {data && <DataBadge granularity={data.granularity} source={data.station.source} />}
            </div>
            <div className="flex rounded-lg overflow-hidden shrink-0" style={{ border: '1px solid var(--border)' }}>
              {TABS.map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => changeRange(key)}
                  className="px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer"
                  style={{
                    background: range === key ? 'var(--accent)' : 'transparent',
                    color: range === key ? '#fff' : 'var(--text-secondary)',
                    borderRight: key !== 'all' ? '1px solid var(--border)' : undefined,
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Pickers */}
          {range === 'day' && (
            <div className="flex items-center gap-2 mb-5 flex-wrap">
              <button style={navBtn(selectedDate <= MIN_DATE)} onClick={() => stepDay(-1)} disabled={selectedDate <= MIN_DATE}>
                <ChevronLeft size={14} />
              </button>
              <input
                type="date" value={selectedDate} min={MIN_DATE} max={todayStr()}
                onChange={e => handleDateChange(e.target.value)}
                className="text-xs font-medium px-3 py-1.5 rounded-lg cursor-pointer"
                style={{ background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--text-primary)', outline: 'none' }}
              />
              <button style={navBtn(selectedDate >= todayStr())} onClick={() => stepDay(1)} disabled={selectedDate >= todayStr()}>
                <ChevronRight size={14} />
              </button>
              {selectedDate === todayStr() ? (
                <span className="text-xs font-semibold px-3 py-1.5 rounded-lg" style={{ background: 'var(--accent-dim)', color: 'var(--accent)' }}>Today</span>
              ) : (
                <button onClick={() => handleDateChange(todayStr())} className="text-xs font-medium px-3 py-1.5 rounded-lg cursor-pointer"
                  style={{ background: 'transparent', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
                  Go to today
                </button>
              )}
            </div>
          )}

          {range === 'month' && (
            <div className="flex items-center gap-3 mb-5">
              <button style={navBtn(selectedMonth <= '2026-03')} onClick={() => stepMonth(-1)} disabled={selectedMonth <= '2026-03'}>
                <ChevronLeft size={14} />
              </button>
              <select
                value={selectedMonth}
                onChange={e => { const nm = e.target.value; setSelectedMonth(nm); router.replace(pageUrl('month', selectedDate, nm, selectedYear), { scroll: false }); fetchData('month', selectedDate, nm, selectedYear); }}
                className="text-xs font-medium px-3 py-1.5 rounded-lg cursor-pointer"
                style={{ background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--text-primary)', outline: 'none' }}
              >
                {getMonthOptions().map(mo => <option key={mo} value={mo}>{fmtMonthLabel(mo)}</option>)}
              </select>
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
              <select
                value={selectedYear}
                onChange={e => { const ny = +e.target.value; setSelectedYear(ny); router.replace(pageUrl('year', selectedDate, selectedMonth, ny), { scroll: false }); fetchData('year', selectedDate, selectedMonth, ny); }}
                className="text-xs font-medium px-3 py-1.5 rounded-lg cursor-pointer"
                style={{ background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--text-primary)', outline: 'none' }}
              >
                {Array.from({ length: curYear() - MIN_YEAR + 1 }, (_, i) => MIN_YEAR + i).map(y => <option key={y} value={y}>{y}</option>)}
              </select>
              <button style={navBtn(selectedYear >= curYear())} onClick={() => stepYear(1)} disabled={selectedYear >= curYear()}>
                <ChevronRight size={14} />
              </button>
            </div>
          )}

          {/* Chart area */}
          {loading ? (
            <div className="h-[300px] rounded-lg animate-pulse" style={{ background: 'var(--card)' }} />
          ) : data?.hourlyUnavailable ? (
            <div className="flex flex-col items-center justify-center h-[300px] gap-6">
              <div className="flex items-start gap-2.5 rounded-xl px-4 py-3 text-sm max-w-sm text-left"
                style={{ background: 'color-mix(in srgb, var(--status-alarm) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--status-alarm) 40%, transparent)', color: 'var(--status-alarm)' }}>
                <AlertCircle size={16} className="mt-0.5 shrink-0" />
                <span>Hourly data is only kept for the past 7 days on Huawei FusionSolar plants. Showing the daily total for this date instead.</span>
              </div>
              {data.readings.length > 0 ? (
                <div className="text-center">
                  <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>Total yield for this day</p>
                  <p className="tnum text-4xl font-extrabold" style={{ color: 'var(--text-primary)' }}>
                    {fmtKwh((data.readings[0] as { pv_yield_kwh: number }).pv_yield_kwh)}
                  </p>
                </div>
              ) : <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No data recorded for this date.</p>}
            </div>
          ) : showPowerChart ? (
            <PowerChart
              readings={(data?.readings ?? []) as unknown as Parameters<typeof PowerChart>[0]['readings']}
              range="day"
              granularity={data?.granularity === 'hour' ? 'hour' : '5min'}
              date={selectedDate}
            />
          ) : (
            <YieldChart data={(data?.readings ?? []) as Record<string, unknown>[]} range={yieldRange} />
          )}

          {!loading && data?.sparseDay && (
            <div className="mt-4 flex items-start gap-2 rounded-xl px-4 py-3 text-xs"
              style={{ background: 'color-mix(in srgb, var(--oem-livoltek) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--oem-livoltek) 40%, transparent)', color: 'var(--oem-livoltek)' }}>
              <AlertCircle size={13} className="mt-0.5 shrink-0" />
              <span>Limited data for this date — fewer than 24 readings. This may be a partial day or the station was briefly offline.</span>
            </div>
          )}
        </div>

        {/* Station info + value */}
        {station && (
          <div className="ov-card p-5">
            <h2 className="text-[11px] font-bold uppercase tracking-[0.13em] mb-4" style={{ color: 'var(--text-secondary)' }}>Station details</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-5">
              <Info label="Manufacturer">
                <span className="inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide" style={{ background: `${m.color}1f`, color: m.color }}>
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: m.color }} />{m.label}
                </span>
              </Info>
              <Info label="Capacity"><span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{capacityLabel(station.source, station.capacity_kw)}</span></Info>
              <Info label="Location"><span className="text-sm" style={{ color: 'var(--text-primary)' }}>{station.location ?? '—'}</span></Info>
              <Info label="Lifetime value"><span className="tnum text-sm font-semibold" style={{ color: 'var(--money)' }}>{randCompact(lifetimeValue)} <span className="text-[9px] font-bold uppercase" style={{ color: 'var(--text-muted)' }}>est.</span></span></Info>
              <Info label="Station ID"><span className="font-mono text-xs" style={{ color: 'var(--text-muted)' }}>{station.id.slice(0, 8)}…</span></Info>
            </div>
            <p className="mt-4 text-[11px]" style={{ color: 'var(--text-muted)' }}>
              Value estimated at {rand(2.5)}/kWh grid tariff. Figures derive from live OEM portal data.
            </p>
          </div>
        )}
      </div>
    </>
  );
}

function Vital({ label, icon, children }: { label: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-[0.13em] font-bold mb-1.5" style={{ color: 'var(--text-muted)' }}>{label}</p>
      <div className="flex items-center gap-1.5">{icon}<span className="flex items-baseline gap-1">{children}</span></div>
    </div>
  );
}
function Num({ children }: { children: React.ReactNode }) {
  return <span className="tnum text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{children}</span>;
}
function U({ children }: { children: React.ReactNode }) {
  return <span className="text-[11px] font-medium" style={{ color: 'var(--text-muted)' }}>{children}</span>;
}
function Dash() { return <span className="text-sm font-bold" style={{ color: 'var(--text-muted)' }}>—</span>; }

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-[0.13em] font-bold mb-1.5" style={{ color: 'var(--text-muted)' }}>{label}</p>
      {children}
    </div>
  );
}

function DataBadge({ granularity, source }: { granularity: string; source: string }) {
  const res = granularity === '5min' ? '5-min' : granularity === 'hour' ? 'Hourly' : granularity === 'month' ? 'Monthly' : 'Daily';
  const m = oemMeta(source);
  return (
    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: `${m.color}1f`, color: m.color, border: `1px solid ${m.color}55` }}>
      {res} · {m.label}
    </span>
  );
}
