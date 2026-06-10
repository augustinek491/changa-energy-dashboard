'use client';

// Changa OneView — sortable, expandable per-station directory.
// Presentational: receives already-filtered/sorted stations plus the active
// sort state, and emits header clicks. Rows expand to an inline detail panel
// so the demo has depth before the full Station Detail page (Week 4).

import { useState } from 'react';
import Link from 'next/link';
import { ArrowDown, ArrowUp, ChevronDown, ArrowUpRight } from 'lucide-react';
import {
  Station, Status, statusOf, capacityKw, loadFactor,
} from '@/lib/v2/fleet';
import { oemMeta, rand, valueOfEnergy } from '@/lib/v2/brand';

export type SortKey = 'name' | 'oem' | 'status' | 'live' | 'today' | 'capacity' | 'perf';
export interface SortState { key: SortKey; dir: 'asc' | 'desc' }

const STATUS_COLOR: Record<Status, string> = {
  online: 'var(--accent)',
  alarm: 'var(--status-alarm)',
  offline: 'var(--status-offline)',
};
const STATUS_LABEL: Record<Status, string> = {
  online: 'Online',
  alarm: 'Alarm',
  offline: 'Offline',
};

interface Col {
  key: SortKey;
  label: string;
  align: 'left' | 'right';
  cls: string; // width + responsive visibility
}

// Fixed-width numeric columns; Station flexes to fill. Some hide on narrow.
const COLS: Col[] = [
  { key: 'name',     label: 'Station',     align: 'left',  cls: 'flex-1 min-w-0' },
  { key: 'oem',      label: 'OEM',         align: 'left',  cls: 'w-28 hidden lg:block' },
  { key: 'capacity', label: 'Capacity',    align: 'right', cls: 'w-24 hidden md:block' },
  { key: 'live',     label: 'Live',        align: 'right', cls: 'w-24' },
  { key: 'today',    label: 'Today',       align: 'right', cls: 'w-24 hidden sm:block' },
  { key: 'perf',     label: 'Performance', align: 'right', cls: 'w-36' },
];

function num(n: number, d = 1) { return n.toFixed(d); }
function fmtEnergy(kwh: number) {
  return kwh >= 1000 ? `${(kwh / 1000).toFixed(2)} MWh` : `${Math.round(kwh)} kWh`;
}

export function StationsTable({
  stations, sort, onSort,
}: {
  stations: Station[];
  sort: SortState;
  onSort: (key: SortKey) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);

  return (
    <div className="ov-card overflow-hidden">
      {/* Header */}
      <div
        className="flex items-center gap-3 px-4 py-2.5 text-[11px] font-bold uppercase tracking-[0.1em]"
        style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--border)' }}
      >
        {COLS.map(c => {
          const active = sort.key === c.key;
          return (
            <button
              key={c.key}
              type="button"
              onClick={() => onSort(c.key)}
              className={`${c.cls} flex items-center gap-1 cursor-pointer transition-colors hover:text-[var(--text-secondary)] ${c.align === 'right' ? 'justify-end' : ''}`}
              style={{ color: active ? 'var(--accent)' : undefined }}
            >
              {c.align === 'right' && active && (sort.dir === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
              {c.label}
              {c.align === 'left' && active && (sort.dir === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
            </button>
          );
        })}
        <span className="w-5 shrink-0" />
      </div>

      {/* Rows */}
      <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
        {stations.map(s => (
          <Row key={s.id} s={s} open={open === s.id} onToggle={() => setOpen(o => (o === s.id ? null : s.id))} />
        ))}
      </div>
    </div>
  );
}

function Row({ s, open, onToggle }: { s: Station; open: boolean; onToggle: () => void }) {
  const st = statusOf(s);
  const pv = s.live?.pv_power_kw ?? 0;
  const today = s.live?.today_kwh ?? 0;
  const cap = capacityKw(s);
  const perf = loadFactor(s);
  const m = oemMeta(s.source);

  return (
    <div style={{ background: open ? 'var(--card-hover)' : 'transparent' }}>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--card-hover)]"
      >
        {/* Station */}
        <div className="flex-1 min-w-0 flex items-center gap-2.5">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: STATUS_COLOR[st] }} title={STATUS_LABEL[st]} />
          <div className="min-w-0">
            <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{s.name}</p>
            {s.location && <p className="text-[11px] truncate" style={{ color: 'var(--text-muted)' }}>{s.location}</p>}
          </div>
        </div>

        {/* OEM */}
        <div className="w-28 hidden lg:block">
          <span
            className="inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide"
            style={{ background: `${m.color}1f`, color: m.color }}
          >
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: m.color }} />
            {m.label}
          </span>
        </div>

        {/* Capacity */}
        <div className="w-24 hidden md:block text-right">
          {cap > 0
            ? <p className="tnum text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>{num(cap)}<span className="text-[11px]" style={{ color: 'var(--text-muted)' }}> kWp</span></p>
            : <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>—</p>}
        </div>

        {/* Live */}
        <div className="w-24 text-right">
          <p className="tnum text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{num(pv)}<span className="text-[11px] font-medium" style={{ color: 'var(--text-muted)' }}> kW</span></p>
        </div>

        {/* Today */}
        <div className="w-24 hidden sm:block text-right">
          <p className="tnum text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>{num(today, 0)}<span className="text-[11px]" style={{ color: 'var(--text-muted)' }}> kWh</span></p>
        </div>

        {/* Performance */}
        <div className="w-36 flex items-center justify-end gap-2">
          <PerfBar perf={perf} />
        </div>

        <ChevronDown size={15} className="w-5 shrink-0 transition-transform" style={{ color: 'var(--text-muted)', transform: open ? 'none' : 'rotate(-90deg)' }} />
      </button>

      {open && <Detail s={s} />}
    </div>
  );
}

function PerfBar({ perf }: { perf: number | null }) {
  if (perf == null) return <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>—</span>;
  const pct = Math.max(0, Math.min(100, perf * 100));
  return (
    <>
      <span className="h-1.5 w-16 overflow-hidden rounded-full" style={{ background: 'var(--card)' }}>
        <span className="block h-full rounded-full" style={{ width: `${pct}%`, background: 'var(--accent)' }} />
      </span>
      <span className="tnum text-[12px] font-semibold w-9 text-right" style={{ color: 'var(--text-secondary)' }}>{pct.toFixed(0)}%</span>
    </>
  );
}

function Detail({ s }: { s: Station }) {
  const l = s.live;
  const cap = capacityKw(s);
  const perf = loadFactor(s);
  const today = l?.today_kwh ?? 0;
  const value = valueOfEnergy(today).savings;

  const items: { label: string; value: string; tag?: string }[] = [
    { label: 'Capacity', value: cap > 0 ? `${num(cap)} kWp` : '—' },
    { label: 'Performance', value: perf != null ? `${(perf * 100).toFixed(0)}%` : '—' },
    { label: 'Today', value: `${num(today, 0)} kWh` },
    { label: 'This month', value: l?.month_kwh != null ? fmtEnergy(l.month_kwh) : '—' },
    { label: 'Lifetime', value: l?.total_kwh != null ? fmtEnergy(l.total_kwh) : '—' },
    { label: 'Value today', value: rand(value), tag: 'est.' },
    { label: 'Battery', value: l?.battery_soc != null ? `${l.battery_soc.toFixed(0)}%` : '—' },
    { label: 'Open alarms', value: String(s.alarm_count) },
  ];

  return (
    <div className="px-4 pb-4 pt-1" style={{ borderTop: '1px solid var(--border)' }}>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-3 pt-3">
        {items.map(it => (
          <div key={it.label}>
            <p className="tnum text-sm font-bold leading-none" style={{ color: 'var(--text-primary)' }}>
              {it.value}{it.tag && <span className="ml-1 text-[9px] font-bold uppercase" style={{ color: 'var(--text-muted)' }}>{it.tag}</span>}
            </p>
            <p className="text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>{it.label}</p>
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center justify-between gap-3">
        {l?.fetched_at ? (
          <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
            Last reading {new Date(l.fetched_at).toLocaleString([], { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' })}
          </p>
        ) : <span />}
        <Link
          href={`/v2/stations/${s.id}`}
          className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-[12px] font-bold transition-colors"
          style={{ background: 'var(--accent-dim)', color: 'var(--accent)' }}
        >
          View full detail
          <ArrowUpRight size={13} />
        </Link>
      </div>
    </div>
  );
}
