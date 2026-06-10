interface Props {
  online: number;
  alarm: number;
  offline: number;
}

const SEGS = [
  { key: 'online', label: 'Online', color: 'var(--accent)' },
  { key: 'alarm', label: 'Alarm', color: 'var(--status-alarm)' },
  { key: 'offline', label: 'Offline', color: 'var(--status-offline)' },
] as const;

export function HealthBar({ online, alarm, offline }: Props) {
  const total = Math.max(online + alarm + offline, 1);
  const counts = { online, alarm, offline };
  const uptime = Math.round((online / total) * 100);

  return (
    <div className="ov-card p-5">
      <div className="flex items-end justify-between">
        <p className="text-[11px] font-bold uppercase tracking-[0.13em]" style={{ color: 'var(--text-secondary)' }}>
          Fleet Health
        </p>
        <p className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
          <span className="tnum text-base font-extrabold" style={{ color: 'var(--accent)' }}>{uptime}%</span> online
        </p>
      </div>

      <div className="mt-3 flex h-2.5 w-full overflow-hidden rounded-full" style={{ background: 'var(--card)' }}>
        {SEGS.map(s => {
          const v = counts[s.key];
          if (!v) return null;
          return <div key={s.key} style={{ width: `${(v / total) * 100}%`, background: s.color }} />;
        })}
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2">
        {SEGS.map(s => (
          <div key={s.key} className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: s.color }} />
            <div className="min-w-0">
              <p className="tnum text-lg font-extrabold leading-none" style={{ color: 'var(--text-primary)' }}>{counts[s.key]}</p>
              <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{s.label}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
