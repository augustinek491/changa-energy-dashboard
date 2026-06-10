import Link from 'next/link';
import { ShieldCheck, WifiOff, AlertTriangle, CloudOff, ChevronRight } from 'lucide-react';
import { Station, statusOf, needsAttention } from '@/lib/v2/fleet';
import { oemMeta } from '@/lib/v2/brand';

function reasonFor(s: Station) {
  const st = statusOf(s);
  const hour = new Date().getHours();
  const daylight = hour >= 7 && hour <= 17;
  if (st === 'offline') return { icon: WifiOff, text: 'Offline · no recent data', color: 'var(--status-offline)' };
  if (s.alarm_count > 0) return { icon: AlertTriangle, text: `${s.alarm_count} active alarm${s.alarm_count > 1 ? 's' : ''}`, color: 'var(--status-alarm)' };
  if (st === 'alarm') return { icon: AlertTriangle, text: 'In alarm state', color: 'var(--status-alarm)' };
  if (daylight && (s.live?.pv_power_kw ?? 0) <= 0.05) return { icon: CloudOff, text: 'Zero output in daylight', color: 'var(--status-alarm)' };
  return { icon: AlertTriangle, text: 'Needs review', color: 'var(--status-alarm)' };
}

export function AttentionStrip({ stations }: { stations: Station[] }) {
  const items = needsAttention(stations);

  if (items.length === 0) {
    return (
      <div className="ov-card flex items-center gap-3 p-5">
        <div className="flex items-center justify-center w-10 h-10 rounded-xl" style={{ background: 'var(--accent-dim)', color: 'var(--accent)' }}>
          <ShieldCheck size={20} />
        </div>
        <div>
          <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>All systems nominal</p>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Every station is online and generating. Nothing needs your attention.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="ov-card p-5">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[11px] font-bold uppercase tracking-[0.13em]" style={{ color: 'var(--text-secondary)' }}>
          Needs Attention
        </p>
        <span
          className="tnum rounded-md px-2 py-0.5 text-[11px] font-bold"
          style={{ background: 'var(--status-offline-dim)', color: 'var(--status-offline)' }}
        >
          {items.length}
        </span>
      </div>

      <div className="flex gap-3 overflow-x-auto pb-1">
        {items.map(s => {
          const r = reasonFor(s);
          const Icon = r.icon;
          const m = oemMeta(s.source);
          return (
            <Link
              key={s.id}
              href="/v2/stations"
              className="ov-card-hover group flex w-60 shrink-0 items-center gap-3 rounded-xl p-3.5"
              style={{ background: 'var(--card)', border: `1px solid ${r.color}33` }}
            >
              <div className="flex items-center justify-center w-9 h-9 rounded-lg shrink-0" style={{ background: `${r.color}1f`, color: r.color }}>
                <Icon size={17} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold truncate" style={{ color: 'var(--text-primary)' }}>{s.name}</p>
                <p className="text-[11px] truncate" style={{ color: r.color }}>{r.text}</p>
                <span className="mt-1 inline-flex items-center gap-1 text-[10px] font-semibold" style={{ color: 'var(--text-muted)' }}>
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: m.color }} />
                  {m.label}
                </span>
              </div>
              <ChevronRight size={15} className="shrink-0 opacity-40 transition-opacity group-hover:opacity-80" style={{ color: 'var(--text-muted)' }} />
            </Link>
          );
        })}
      </div>
    </div>
  );
}
