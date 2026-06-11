'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ChevronDown } from 'lucide-react';
import { OemGroup, Station, statusOf } from '@/lib/v2/fleet';

const STATUS_COLOR: Record<string, string> = {
  online: 'var(--accent)',
  alarm: 'var(--status-alarm)',
  offline: 'var(--status-offline)',
};

function Pill({ n, color, label }: { n: number; color: string; label: string }) {
  if (!n) return null;
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-semibold" style={{ color: 'var(--text-secondary)' }} title={label}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />
      <span className="tnum">{n}</span>
    </span>
  );
}

function StationRow({ s }: { s: Station }) {
  const st = statusOf(s);
  const pv = s.live?.pv_power_kw ?? 0;
  const today = s.live?.today_kwh ?? 0;
  const soc = s.live?.battery_soc;
  return (
    <Link
      href="/v2/stations"
      className="grid grid-cols-12 items-center gap-2 px-4 py-2.5 transition-colors hover:bg-[var(--card-hover)]"
    >
      <div className="col-span-5 flex items-center gap-2.5 min-w-0">
        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: STATUS_COLOR[st] }} />
        <div className="min-w-0">
          <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{s.name}</p>
          {s.location && <p className="text-[11px] truncate" style={{ color: 'var(--text-muted)' }}>{s.location}</p>}
        </div>
      </div>
      <div className="col-span-3 text-right">
        <p className="tnum text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{pv.toFixed(1)}<span className="text-[11px] font-medium" style={{ color: 'var(--text-muted)' }}> kW</span></p>
      </div>
      <div className="col-span-2 text-right">
        <p className="tnum text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>{today.toFixed(0)}<span className="text-[11px]" style={{ color: 'var(--text-muted)' }}> kWh</span></p>
      </div>
      <div className="col-span-2 text-right">
        {soc != null
          ? <p className="tnum text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>{soc.toFixed(0)}%</p>
          : <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>—</p>}
      </div>
    </Link>
  );
}

export function OemGroupSection({ group }: { group: OemGroup }) {
  // Closed by default: the Command Centre loads with compact summary rows
  // (name, site count, status dots, live kW); a click expands the cards.
  const [open, setOpen] = useState(false);
  return (
    <div className="ov-card overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex w-full items-center gap-3 px-4 py-3.5 cursor-pointer"
        style={{ borderBottom: open ? '1px solid var(--border)' : 'none' }}
      >
        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: group.color }} />
        <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{group.label}</span>
        <span
          className="rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide"
          style={{ background: group.live ? 'var(--accent-dim)' : 'var(--card)', color: group.live ? 'var(--accent)' : 'var(--text-muted)' }}
        >
          {group.live ? 'Live' : 'Pending'}
        </span>
        <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{group.stations.length} sites</span>

        <div className="ml-auto flex items-center gap-3.5">
          <Pill n={group.online} color={STATUS_COLOR.online} label="online" />
          <Pill n={group.alarm} color={STATUS_COLOR.alarm} label="alarm" />
          <Pill n={group.offline} color={STATUS_COLOR.offline} label="offline" />
          <span className="hidden sm:block tnum text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
            {group.pvKw.toFixed(1)}<span className="text-[11px] font-medium" style={{ color: 'var(--text-muted)' }}> kW</span>
          </span>
          <ChevronDown size={16} className="transition-transform" style={{ color: 'var(--text-muted)', transform: open ? 'none' : 'rotate(-90deg)' }} />
        </div>
      </button>

      {open && (
        <div style={{ background: 'var(--surface)' }}>
          <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
            {group.stations.map(s => <StationRow key={s.id} s={s} />)}
          </div>
        </div>
      )}
    </div>
  );
}
