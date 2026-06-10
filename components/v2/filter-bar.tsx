'use client';

// Changa OneView — global fleet filter bar. Search + multi-select menus
// (Status, OEM, Province) + a capacity band, with removable active-filter
// pills. Reads/writes the console-wide filter context, so it stays in sync
// across the Stations directory and the Fleet Map.

import { useEffect, useMemo, useRef, useState, ReactNode } from 'react';
import { Search, ChevronDown, Check, X } from 'lucide-react';
import { useFleetFilter } from './filter-context';
import { Station } from '@/lib/v2/fleet';
import {
  computeFacets, activeFilterCount, EMPTY_FILTER, CAPACITY_BANDS, CapacityBand,
} from '@/lib/v2/filter';

export function FilterBar({ stations }: { stations: Station[] }) {
  const { filter, patch, setFilter } = useFleetFilter();
  const facets = useMemo(() => computeFacets(stations), [stations]);
  const count = activeFilterCount(filter);

  const toggle = (key: 'oem' | 'status' | 'province', val: string) => {
    const arr = filter[key] as string[];
    patch({ [key]: arr.includes(val) ? arr.filter(v => v !== val) : [...arr, val] });
  };

  const capLabel = CAPACITY_BANDS.find(b => b.key === filter.capacity)?.label ?? 'Any size';

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-2">
        {/* Search */}
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
          <input
            value={filter.search}
            onChange={e => patch({ search: e.target.value })}
            placeholder="Search stations or location…"
            className="w-60 rounded-lg pl-8 pr-3 py-1.5 text-sm outline-none transition-colors"
            style={{ background: 'var(--card)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
          />
        </div>

        <Menu label="Status" active={filter.status.length}>
          {facets.status.map(o => (
            <Opt key={o.key} checked={filter.status.includes(o.key)} onClick={() => toggle('status', o.key)} dot={o.color} label={o.label} n={o.count} />
          ))}
        </Menu>

        <Menu label="OEM" active={filter.oem.length}>
          {facets.oems.map(o => (
            <Opt key={o.key} checked={filter.oem.includes(o.key)} onClick={() => toggle('oem', o.key)} dot={o.color} label={o.label} n={o.count} />
          ))}
        </Menu>

        <Menu label="Province" active={filter.province.length} disabled={facets.provinces.length === 0}>
          {facets.provinces.map(o => (
            <Opt key={o.key} checked={filter.province.includes(o.key)} onClick={() => toggle('province', o.key)} label={o.label} n={o.count} />
          ))}
        </Menu>

        <Menu label={filter.capacity === 'all' ? 'Capacity' : capLabel} active={filter.capacity !== 'all' ? 1 : 0}>
          {CAPACITY_BANDS.map(b => (
            <Opt
              key={b.key}
              radio
              checked={filter.capacity === b.key}
              onClick={() => patch({ capacity: b.key as CapacityBand })}
              label={b.label}
            />
          ))}
        </Menu>

        {count > 0 && (
          <button
            type="button"
            onClick={() => setFilter(EMPTY_FILTER)}
            className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[12px] font-semibold cursor-pointer transition-colors hover:bg-[var(--card-hover)]"
            style={{ color: 'var(--text-muted)' }}
          >
            <X size={13} /> Clear all
          </button>
        )}
      </div>

      {count > 0 && <ActivePills facets={facets} />}
    </div>
  );
}

function Menu({ label, active, disabled, children }: { label: string; active: number; disabled?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  const on = active > 0 || open;
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(o => !o)}
        className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-semibold cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        style={{
          background: active > 0 ? 'var(--accent-dim)' : 'var(--card)',
          color: on ? 'var(--accent)' : 'var(--text-secondary)',
          border: `1px solid ${active > 0 ? 'var(--accent)' : 'transparent'}`,
        }}
      >
        {label}
        {active > 0 && <span className="tnum rounded px-1 text-[10px]" style={{ background: 'var(--accent)', color: '#fff' }}>{active}</span>}
        <ChevronDown size={13} className="transition-transform" style={{ transform: open ? 'rotate(180deg)' : 'none' }} />
      </button>

      {open && (
        <div
          className="absolute left-0 z-30 mt-1.5 min-w-[210px] rounded-xl p-1.5"
          style={{ background: 'var(--surface)', border: '1px solid var(--border-strong)', boxShadow: 'var(--shadow-lg)' }}
        >
          {children}
        </div>
      )}
    </div>
  );
}

function Opt({ checked, onClick, label, n, dot, radio }: {
  checked: boolean; onClick: () => void; label: string; n?: number; dot?: string; radio?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm cursor-pointer transition-colors hover:bg-[var(--card-hover)]"
    >
      <span
        className={`flex h-4 w-4 shrink-0 items-center justify-center ${radio ? 'rounded-full' : 'rounded'}`}
        style={{
          background: checked ? 'var(--accent)' : 'transparent',
          border: `1.5px solid ${checked ? 'var(--accent)' : 'var(--border-strong)'}`,
          color: '#fff',
        }}
      >
        {checked && <Check size={12} />}
      </span>
      {dot && <span className="w-2 h-2 rounded-full shrink-0" style={{ background: dot }} />}
      <span className="flex-1 text-left" style={{ color: 'var(--text-primary)' }}>{label}</span>
      {n != null && <span className="tnum text-[11px]" style={{ color: 'var(--text-muted)' }}>{n}</span>}
    </button>
  );
}

function ActivePills({ facets }: { facets: ReturnType<typeof computeFacets> }) {
  const { filter, patch } = useFleetFilter();
  const remove = (key: 'oem' | 'status' | 'province', val: string) =>
    patch({ [key]: (filter[key] as string[]).filter(v => v !== val) });

  const pills: { label: string; onRemove: () => void; color?: string }[] = [];
  if (filter.search.trim()) pills.push({ label: `“${filter.search.trim()}”`, onRemove: () => patch({ search: '' }) });
  filter.status.forEach(s => {
    const m = facets.status.find(x => x.key === s);
    pills.push({ label: m?.label ?? s, color: m?.color, onRemove: () => remove('status', s) });
  });
  filter.oem.forEach(o => {
    const m = facets.oems.find(x => x.key === o);
    pills.push({ label: m?.label ?? o, color: m?.color, onRemove: () => remove('oem', o) });
  });
  filter.province.forEach(p => pills.push({ label: p, onRemove: () => remove('province', p) }));
  if (filter.capacity !== 'all') {
    const m = CAPACITY_BANDS.find(b => b.key === filter.capacity);
    pills.push({ label: m?.label ?? filter.capacity, onRemove: () => patch({ capacity: 'all' }) });
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {pills.map((p, i) => (
        <span
          key={i}
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-semibold"
          style={{ background: 'var(--card)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
        >
          {p.color && <span className="w-1.5 h-1.5 rounded-full" style={{ background: p.color }} />}
          {p.label}
          <button type="button" onClick={p.onRemove} className="cursor-pointer transition-colors hover:text-[var(--text-primary)]" style={{ color: 'var(--text-muted)' }}>
            <X size={12} />
          </button>
        </span>
      ))}
    </div>
  );
}
