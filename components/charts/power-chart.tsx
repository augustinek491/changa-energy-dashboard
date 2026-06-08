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

/**
 * Convert a UTC ISO timestamp to a Date object anchored in SAST (UTC+2).
 * All Changa Energy stations are in South Africa — we always display data
 * in South African Standard Time regardless of the viewer's browser timezone.
 */
function toSAST(ts: string): Date {
  return new Date(new Date(ts).getTime() + 2 * 60 * 60 * 1000);
}

function formatTime(ts: string, range: 'day' | 'week') {
  const sast = toSAST(ts);
  const h = String(sast.getUTCHours()).padStart(2, '0');
  const m = String(sast.getUTCMinutes()).padStart(2, '0');
  if (range === 'day') return `${h}:${m}`;
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return `${days[sast.getUTCDay()]} ${h}:${m}`;
}

/**
 * Snap a UTC ISO timestamp to the nearest grid slot label in SAST (UTC+2).
 * Returns "HH:MM" rounded down to the nearest 5-min or 1-hour boundary.
 */
function snapToSlot(ts: string, granularity: '5min' | 'hour'): string {
  const sast = toSAST(ts);
  const h = sast.getUTCHours();
  const m = sast.getUTCMinutes();
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
 * SAST and merge real readings into the matching slots. The X-axis always spans
 * the whole day; missing slots stay null (rendered as a gap, not a zero).
 *
 * PV power gets special, generation-aware treatment so the green curve reflects
 * reality cleanly:
 *
 *   • "Daylight window" = the span between the first and last slot that actually
 *     produced power (> 0). This is derived from the data itself, so it adjusts
 *     per site, per day, per season — no hard-coded sunrise/sunset.
 *
 *   • OUTSIDE the window (night, before sunrise / after sunset): PV is hidden
 *     entirely. Both a real 0 and a missing reading become a gap, so the curve
 *     only appears while the panels were genuinely working. This is what stops
 *     the misleading flat-zero stub appearing before 06:00.
 *
 *   • INSIDE the window (daytime): PV is shown as-is, including a real 0 — which
 *     dives the line to the floor and makes a mid-day inverter fault obvious.
 *     A null inside the window stays a gap, so a genuine data outage is still
 *     visually distinct from a confirmed-zero fault.
 *
 * Load / Grid / Battery are unaffected — they keep their plain null-is-a-gap
 * behaviour, since those are meaningful at night too.
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

  // Raw PV value per slot (number | null), in chronological order.
  const pvRaw: (number | null)[] = slots.map(t => {
    const v = map.get(t)?.pv_power_kw;
    return typeof v === 'number' ? v : null;
  });

  // Daylight window = first..last slot that produced power (> 0).
  let firstGen = -1;
  let lastGen = -1;
  for (let i = 0; i < pvRaw.length; i++) {
    const v = pvRaw[i];
    if (v !== null && v > 0) {
      if (firstGen === -1) firstGen = i;
      lastGen = i;
    }
  }

  return slots.map((t, i) => {
    const r = map.get(t);
    const inDaylight = firstGen !== -1 && i >= firstGen && i <= lastGen;
    return {
      t,
      // Inside daylight: show the value (incl. a real 0 = fault dip); null stays a
      // gap. Outside daylight: hide PV entirely so night is clean.
      pv_power_kw:      inDaylight ? pvRaw[i] : null,
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
              connectNulls={false}
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
