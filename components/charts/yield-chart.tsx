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

interface DayPoint { date: string; total_kwh: number }
interface MonthPoint { year_month: string; total_kwh: number }
type DataPoint = DayPoint | MonthPoint;

interface YieldChartProps {
  data: DataPoint[];
  range: 'month' | 'year' | 'all';
  color?: string;
}

function labelFor(d: DataPoint, range: string): string {
  if ('date' in d) {
    const dt = new Date(d.date);
    return range === 'month'
      ? dt.toLocaleDateString([], { month: 'short', day: 'numeric' })
      : d.date;
  }
  const [y, m] = d.year_month.split('-');
  return new Date(+y, +m - 1, 1).toLocaleDateString([], { month: 'short', year: '2-digit' });
}

const TooltipContent = ({ active, payload, label }: {
  active?: boolean;
  payload?: { value: number }[];
  label?: string;
}) => {
  if (!active || !payload?.length) return null;
  return (
    <div
      className="rounded-lg px-3 py-2.5 text-xs shadow-xl"
      style={{ background: 'var(--surface)', border: '1px solid var(--border-strong)' }}
    >
      <p className="font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>{label}</p>
      <p className="font-bold text-sm" style={{ color: 'var(--text-primary)' }}>
        {(payload[0].value ?? 0).toLocaleString()} kWh
      </p>
    </div>
  );
};

export function YieldChart({ data, range, color }: YieldChartProps) {
  if (!data.length) {
    return (
      <div className="flex items-center justify-center h-64" style={{ color: 'var(--text-muted)' }}>
        No yield data available
      </div>
    );
  }

  const accentColor = color ?? 'var(--accent)';

  const chartData = data.map(d => ({
    label: labelFor(d, range),
    kwh: d.total_kwh,
  }));

  const step = Math.max(1, Math.floor(chartData.length / 10));
  const ticks = chartData.filter((_, i) => i % step === 0).map(d => d.label);

  const tickStyle = { fontSize: 11, fill: 'var(--text-muted)' };

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
          <YAxis tick={tickStyle} axisLine={false} tickLine={false} tickFormatter={v => `${v}kWh`} width={60} />
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
      <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }} barSize={range === 'month' ? 12 : 20}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="label" ticks={ticks} tick={tickStyle} axisLine={false} tickLine={false} />
        <YAxis tick={tickStyle} axisLine={false} tickLine={false} tickFormatter={v => `${v}kWh`} width={60} />
        <Tooltip content={<TooltipContent />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
        <Bar dataKey="kwh" name="Yield" fill={accentColor} radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
