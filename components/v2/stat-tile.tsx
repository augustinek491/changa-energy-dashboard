interface StatTileProps {
  label: string;
  value: string;
  unit?: string;
  sub?: string;
  icon?: React.ReactNode;
  accent?: string;
  tag?: string;      // e.g. "est."
  hero?: boolean;    // brand-gradient emphasis (money tiles)
}

export function StatTile({ label, value, unit, sub, icon, accent, tag, hero }: StatTileProps) {
  const c = accent ?? 'var(--accent)';
  return (
    <div
      className="ov-card ov-card-hover relative overflow-hidden p-5"
      style={hero ? { background: `linear-gradient(150deg, ${c}14, var(--surface) 55%)`, borderColor: `${c}33` } : undefined}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-bold uppercase tracking-[0.13em]" style={{ color: 'var(--text-secondary)' }}>
          {label}
        </p>
        {icon && (
          <div
            className="flex items-center justify-center w-8 h-8 rounded-lg shrink-0"
            style={{ background: `${c}1f`, color: c }}
          >
            {icon}
          </div>
        )}
      </div>
      <div className="mt-3 flex items-baseline gap-1.5">
        <span className="tnum text-[28px] font-extrabold leading-none" style={{ color: 'var(--text-primary)' }}>
          {value}
        </span>
        {unit && <span className="text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>{unit}</span>}
        {tag && (
          <span
            className="ml-1 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide"
            style={{ background: 'var(--card)', color: 'var(--text-muted)' }}
          >
            {tag}
          </span>
        )}
      </div>
      {sub && <p className="mt-1.5 text-xs" style={{ color: 'var(--text-muted)' }}>{sub}</p>}
    </div>
  );
}
