'use client';

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';

interface Reading {
  recorded_at: string;
  pv_power_kw: number | null;
  load_power_kw: number | null;
  grid_power_kw: number | null;
  battery_soc: number | null;
  battery_power_kw: number | null;
}

interface PowerChartProps {
  readings: Reading[];
  range: 'day' | 'week';
  granularity?: '5min' | 'hour';
  /** YYYY-MM-DD in local time. When provided, zero-fills a full 00:00–23:59 day grid. */
  date?: string;
}

const SERIES = [
  { key: 'pv_power_kw',      name: 'PV Power',      color: '#22C55E', dashed: false },
  { key: 'load_power_kw',    name: 'Load Power',    color: '#F97316', dashed: false },
  { key: 'grid_power_kw',    name: 'Grid',          color: '#3B82F6', dashed: true  },
  { key: 'battery_power_kw', name: 'Battery',       color: '#8B5CF6', dashed: true  },
];

function formatTime(ts: string, range: 'day' | 'week') {
  const d = new Date(ts);
  if (range === 'day') {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });
}

/**
 * Snap a UTC ISO timestamp to the nearest grid slot label in browser-local time.
 * Returns "HH:MM" rounded down to the nearest 5-min or 1-hour boundary.
 */
function snapToSlot(ts: string, granularity: '5min' | 'hour'): string {
  const d = new Date(ts);
  const h = d.getHours();
  const m = d.getMinutes();
  if (granularity === 'hour') {
    return `${String(h).padStart(2, '0')}:00`;
  }
  const snappedM = Math.floor(m / 5) * 5;
  return `${String(h).padStart(2, '0')}:${String(snappedM).padStart(2, '0')}`;
}

type ChartPoint = {
  t: string;
  pv_power_kw: number | null;
  load_power_kw: number | null;
  grid_power_kw: number | null;
  battery_power_kw: number | null;
};

/**
 * Build a full 00:00–23:59 day skeleton (288 × 5-min or 24 × 1-hour slots) in
 * browser-local time and merge real readings into the matching slots.
 *
 * PV power defaults to 0 for empty slots (genuinely no generation at night).
 * Load / Grid / Battery stay null when the inverter is off so those series
 * show a gap rather than a misleading flat zero.
 */
function buildDayGrid(granularity: '5min' | 'hour', readings: Reading[]): ChartPoint[] {
  const map = new Map<string, Reading>();
  for (const r of readings) {
    map.set(snapToSlot(r.recorded_at, granularity), r);
  }

  const slots: string[] = granularity === '5min'
    ? Array.from({ length: 288 }, (_, i) => {
        const h = Math.floor(i / 12);
        const m = (i % 12) * 5;
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      })
    : Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, '0')}:00`);

  return slots.map(t => {
    const r = map.get(t);
    return {
      t,
      pv_power_kw:      r?.pv_power_kw      ?? 0,    // 0 = no solar at night
      load_power_kw:    r?.load_power_kw    ?? null,  // null = unknown when inverter off
      grid_power_kw:    r?.grid_power_kw    ?? null,
      battery_power_kw: r?.battery_power_kw ?? null,
    };
  });
}

function hasData(readings: Reading[], key: string) {
  return readings.some(r => (r as unknown as Record<string, unknown>)[key] != null);
}

const TooltipContent = ({ active, payload, label, unit }: {
  active?: boolean;
  payload?: { name: string; value: number; color: string }[];
  label?: string;
  unit?: string;
}) => {
  if (!active || !payload?.length) return null;
  const u = unit ?? 'kW';
  return (
    <div
      className="rounded-lg px-3 py-2.5 text-xs shadow-xl"
      style={{ background: 'var(--surface)', border: '1px solid var(--border-strong)' }}
    >
      <p className="font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>{label}</p>
      {payload.map(p => (
        <div key={p.name} className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full" style={{ background: p.color }} />
            <span style={{ color: 'var(--text-secondary)' }}>{p.name}</span>
          </div>
          <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>
            {p.value != null ? `${p.value.toFixed(2)} ${u}` : '—'}
          </span>
        </div>
      ))}
    </div>
  );
};

export function PowerChart({ readings, range, granularity = '5min', date }: PowerChartProps) {
  if (!readings.length) {
    return (
      <div className="flex items-center justify-center h-64" style={{ color: 'var(--text-muted)' }}>
        No readings available for this period
      </div>
    );
  }

  const unit = granularity === 'hour' ? 'kWh' : 'kW';

  // Full 24h grid for day view so the X-axis always spans 00:00–23:59.
  // For any other view just map readings directly.
  const chartData: ChartPoint[] = (date && range === 'day')
    ? buildDayGrid(granularity, readings)
    : readings.map(r => ({
        t:                formatTime(r.recorded_at, range),
        pv_power_kw:      r.pv_power_kw,
        load_power_kw:    r.load_power_kw,
        grid_power_kw:    r.grid_power_kw,
        battery_power_kw: r.battery_power_kw,
      }));

  // Show ~12 tick labels regardless of granularity
  const step  = Math.max(1, Math.floor(chartData.length / 12));
  const ticks = chartData.filter((_, i) => i % step === 0).map(d => d.t);

  return (
    <div>
      <ResponsiveContainer width="100%" height={300}>
        <AreaChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <defs>
            {SERIES.map(s => (
              <linearGradient key={s.key} id={`grad-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={s.color} stopOpacity={0.2} />
                <stop offset="95%" stopColor={s.color} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="t"
            ticks={ticks}
            tick={{ fontSize: 11, fill: 'var(--text-muted)' }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 11, fill: 'var(--text-muted)' }}
            axisLine={false}
            tickLine={false}
            tickFormatter={v => `${v}${unit}`}
            width={52}
          />
          <Tooltip content={<TooltipContent unit={unit} />} />
          <Legend
            wrapperStyle={{ fontSize: 12, paddingTop: 12, color: 'var(--text-secondary)' }}
          />
          {/* hasData checks original readings so the series list reflects actual sensor availability */}
          {SERIES.filter(s => hasData(readings, s.key)).map(s => (
            <Area
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.name}
              stroke={s.color}
              strokeWidth={2}
              strokeDasharray={s.dashed ? '4 3' : undefined}
              fill={`url(#grad-${s.key})`}
              dot={false}
              connectNulls
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
      {granularity === 'hour' && (
        <p className="text-center mt-2 text-[11px]" style={{ color: 'var(--text-muted)' }}>
          PV generation only · Load, Grid &amp; Battery data unavailable for Huawei FusionSolar plants
        </p>
      )}
    </div>
  );
}
