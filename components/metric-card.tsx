interface MetricCardProps {
  label: string;
  value: string | number;
  unit?: string;
  sub?: string;
  icon?: React.ReactNode;
  accent?: string;
  trend?: 'up' | 'down' | 'neutral';
}

export function MetricCard({ label, value, unit, sub, icon, accent, trend }: MetricCardProps) {
  return (
    <div
      className="rounded-xl p-5 flex flex-col gap-3"
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        boxShadow: 'var(--shadow-sm)',
      }}
    >
      <div className="flex items-start justify-between">
        <p className="text-xs font-medium uppercase tracking-widest" style={{ color: 'var(--text-secondary)' }}>
          {label}
        </p>
        {icon && (
          <div
            className="flex items-center justify-center w-8 h-8 rounded-lg"
            style={{ background: accent ? `${accent}18` : 'var(--card)', color: accent ?? 'var(--accent)' }}
          >
            {icon}
          </div>
        )}
      </div>
      <div>
        <div className="flex items-baseline gap-1.5">
          <span className="text-2xl font-bold leading-none" style={{ color: 'var(--text-primary)' }}>
            {typeof value === 'number' ? value.toLocaleString() : value}
          </span>
          {unit && (
            <span className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>{unit}</span>
          )}
        </div>
        {sub && (
          <p className="text-xs mt-1.5" style={{ color: 'var(--text-muted)' }}>{sub}</p>
        )}
      </div>
    </div>
  );
}
