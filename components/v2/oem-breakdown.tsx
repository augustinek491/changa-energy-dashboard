import { OemGroup } from '@/lib/v2/fleet';
import { rand, valueOfEnergy } from '@/lib/v2/brand';

// Live generation contribution per manufacturer — the "one place for every
// OEM" story expressed as share of current fleet output.
export function OemBreakdown({ groups }: { groups: OemGroup[] }) {
  const totalKw = groups.reduce((a, g) => a + g.pvKw, 0);
  const totalToday = groups.reduce((a, g) => a + g.todayKwh, 0);
  const max = Math.max(...groups.map(g => g.pvKw), 0.001);

  return (
    <div className="ov-card p-5">
      <div className="flex items-end justify-between mb-4">
        <p className="text-[11px] font-bold uppercase tracking-[0.13em]" style={{ color: 'var(--text-secondary)' }}>
          Generation by Manufacturer
        </p>
        <p className="tnum text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
          {totalKw.toFixed(1)} kW live
        </p>
      </div>

      <div className="space-y-3.5">
        {groups.map(g => {
          const share = totalKw > 0 ? (g.pvKw / totalKw) * 100 : 0;
          return (
            <div key={g.key}>
              <div className="flex items-center justify-between mb-1.5">
                <span className="flex items-center gap-2 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                  <span className="w-2 h-2 rounded-full" style={{ background: g.color }} />
                  {g.label}
                </span>
                <span className="tnum text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
                  {g.pvKw.toFixed(1)} kW · {share.toFixed(0)}%
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full" style={{ background: 'var(--card)' }}>
                <div className="h-full rounded-full transition-all" style={{ width: `${(g.pvKw / max) * 100}%`, background: g.color }} />
              </div>
              <p className="mt-1 tnum text-[11px]" style={{ color: 'var(--text-muted)' }}>
                {g.todayKwh.toFixed(0)} kWh today · {g.stations.length} sites
              </p>
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex items-center justify-between border-t pt-3" style={{ borderColor: 'var(--border)' }}>
        <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
          PPA revenue today
        </span>
        <span className="tnum text-sm font-bold" style={{ color: 'var(--money)' }}>
          {rand(valueOfEnergy(totalToday).ppa)}
          <span className="ml-1 text-[9px] font-bold uppercase" style={{ color: 'var(--text-muted)' }}>est.</span>
        </span>
      </div>
    </div>
  );
}
