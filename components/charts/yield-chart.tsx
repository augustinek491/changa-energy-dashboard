'use client';

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
} from 'recharts';

// Accepts both analytics shape (total_kwh) and station-detail shape (pv_yield_kwh)
type DataPoint = Record<string, unknown>;

interface YieldChartProps {
  data: DataPoint[];
  range: 'month' | 'year' | 'all';
  color?: string;
}

function getKwh(d: DataPoint): number {
  return (d.total_kwh ?? d.pv_yield_kwh ?? 0) as number;
}

function labelFor(d: DataPoint, range: string): string {
  const date = d.date as string | undefined;
  const yearMonth = d.year_month as string | undefined;

  if (date) {
    const dt = new Date(date);
    if (isNaN(dt.getTime())) return date;
    return range === 'month'
      ? dt.toLocaleDateString([], { month: 'short', day: 'numeric' })
      : date;
  }

  if (!yearMonth) return '';
  const parts = yearMonth.split('-');
  if (parts.length < 2) return yearMonth;
  const [y, m] = parts;
  const dt = new Date(+y, +m - 1, 1);
  if (isNaN(dt.getTime())) return yearMonth;
  return dt.toLocaleDateString([], { month: 'short', year: '2-digit' });
}

const TooltipContent = ({ active, payload, label }: {
  active?: boolean;
  payload?: { value: number }[];
  label?: string;
}) => {
  if (!active || !payload?.length) return null;
  const val = payload[0].value ?? 0;
  return (
    <div
      className="rounded-lg px-3 py-2.5 text-xs shadow-xl"
      style={{ background: 'var(--surface)', border: '1px solid var(--border-strong)' }}
    >
      <p className="font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>{label}</p>
      <p className="font-bold text-sm" style={{ color: 'var(--text-primary)' }}>
        {val >= 1000
          ? `${(val / 1000).toFixed(2)} MWh`
          : `${val.toLocaleString(undefined, { maximumFractionDigits: 1 })} kWh`}
      </p>
    </div>
  );
};

export function YieldChart({ data, range, color }: YieldChartProps) {
  if (!data.length) {
    return (
      <div className="flex items-center justify-center h-64" style={{ color: 'var(--text-muted)' }}>
        No yield data available for this period
      </div>
    );
  }

  const accentColor = color ?? 'var(--accent)';

  const chartData = data.map(d => ({
    label: labelFor(d, range),
    kwh: getKwh(d),
  }));

  const step = Math.max(1, Math.floor(chartData.length / 10));
  const ticks = chartData.filter((_, i) => i % step === 0).map(d => d.label);
  const tickStyle = { fontSize: 11, fill: 'var(--text-muted)' };

  const yFormatter = (v: number) =>
    v >= 1000 ? `${(v / 1000).toFixed(1)}MWh` : `${v}kWh`;

  if (range === 'all' && data.length > 6) {
    return (
      <ResponsiveContainer width="100%" height={300}>
        <AreaChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="yield-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={accentColor} stopOpacity={0.3} />
              <stop offset="95%" stopColor={accentColor} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" ticks={ticks} tick={tickStyle} axisLine={false} tickLine={false} />
          <YAxis tick={tickStyle} axisLine={false} tickLine={false} tickFormatter={yFormatter} width={64} />
          <Tooltip content={<TooltipContent />} />
          <Area
            type="monotone"
            dataKey="kwh"
            name="Yield"
            stroke={accentColor}
            strokeWidth={2}
            fill="url(#yield-grad)"
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart
        data={chartData}
        margin={{ top: 4, right: 8, left: 0, bottom: 0 }}
        barSize={range === 'month' ? 12 : 20}
      >
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="label" ticks={ticks} tick={tickStyle} axisLine={false} tickLine={false} />
        <YAxis tick={tickStyle} axisLine={false} tickLine={false} tickFormatter={yFormatter} width={64} />
        <Tooltip content={<TooltipContent />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
        <Bar dataKey="kwh" name="Yield" fill={accentColor} radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
