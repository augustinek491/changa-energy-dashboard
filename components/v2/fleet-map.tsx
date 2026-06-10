'use client';

// Changa OneView — South Africa fleet map (d3-geo, React 19-safe).
// Plots every station clustered by town as one sized marker, over a simplified
// 9-province outline. Hover a marker or a list row to sync the highlight.

import { useMemo, useState } from 'react';
import { geoMercator, geoPath } from 'd3-geo';
import saProvinces from '@/lib/v2/sa-provinces.json';
import { Station } from '@/lib/v2/fleet';
import { buildAreas, activeProvinces, AreaStatus } from '@/lib/v2/geo';
import { oemMeta } from '@/lib/v2/brand';

const STATUS_COLOR: Record<AreaStatus, string> = {
  healthy: '#1fb964',
  attention: '#fb923c',
  down: '#64748b',
};
const STATUS_LABEL: Record<AreaStatus, string> = {
  healthy: 'All online',
  attention: 'Needs a look',
  down: 'Offline',
};

const PAD = 30;
const FIT_W = 760;

export function FleetMap({ stations }: { stations: Station[] }) {
  const [hovered, setHovered] = useState<string | null>(null);

  const areas = useMemo(() => buildAreas(stations), [stations]);
  const active = useMemo(() => activeProvinces(areas), [areas]);

  // Fit SA into a tight viewBox with uniform padding, no letterbox bands.
  const { projection, vbW, vbH } = useMemo(() => {
    const geo = saProvinces as unknown as Parameters<ReturnType<typeof geoPath>>[0];
    const proj = geoMercator().fitWidth(FIT_W - 2 * PAD, geo as any);
    const b0 = geoPath(proj).bounds(geo as any);
    const [tx, ty] = proj.translate();
    proj.translate([tx + PAD - b0[0][0], ty + PAD - b0[0][1]]);
    const b1 = geoPath(proj).bounds(geo as any);
    return {
      projection: proj,
      vbW: Math.ceil(b1[1][0] + PAD),
      vbH: Math.ceil(b1[1][1] + PAD),
    };
  }, []);

  const path = useMemo(() => geoPath(projection), [projection]);

  const placed = useMemo(
    () =>
      areas.map(a => {
        const xy = projection([a.lng, a.lat]) ?? [0, 0];
        return { a, x: xy[0], y: xy[1], r: 9 + Math.sqrt(a.stations.length) * 3.6 };
      }),
    [areas, projection],
  );

  const hoverArea = placed.find(p => p.a.key === hovered) ?? null;

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
      {/* Map */}
      <div className="ov-card p-3 sm:p-4">
        <div className="relative w-full" style={{ aspectRatio: `${vbW} / ${vbH}` }}>
          <svg
            viewBox={`0 0 ${vbW} ${vbH}`}
            className="h-full w-full"
            role="img"
            aria-label="South Africa fleet map"
          >
            {/* Provinces */}
            <g>
              {(saProvinces as any).features.map((f: any, i: number) => {
                const on = active.has(f.properties.province);
                return (
                  <path
                    key={f.properties.province ?? i}
                    d={path(f as any) ?? ''}
                    className="ov-prov"
                    data-active={on ? 'true' : 'false'}
                  />
                );
              })}
            </g>

            {/* Connection halo for hovered area */}
            {hoverArea && (
              <circle
                cx={hoverArea.x}
                cy={hoverArea.y}
                r={hoverArea.r + 10}
                fill="none"
                stroke={STATUS_COLOR[hoverArea.a.status]}
                strokeOpacity={0.35}
                strokeWidth={1.5}
              />
            )}

            {/* Area markers */}
            <g>
              {placed.map(({ a, x, y, r }) => {
                const color = STATUS_COLOR[a.status];
                const isHover = hovered === a.key;
                const pulse = a.status !== 'healthy';
                return (
                  <g
                    key={a.key}
                    transform={`translate(${x} ${y})`}
                    onMouseEnter={() => setHovered(a.key)}
                    onMouseLeave={() => setHovered(null)}
                    style={{ cursor: 'pointer' }}
                  >
                    {pulse && (
                      <circle r={r} fill={color} className="ov-marker-pulse" />
                    )}
                    <circle r={r + 6} fill={color} opacity={0.16} />
                    <circle
                      r={isHover ? r + 2 : r}
                      fill={color}
                      stroke="var(--surface)"
                      strokeWidth={2.5}
                      style={{ transition: 'r 120ms ease' }}
                    />
                    <text
                      textAnchor="middle"
                      dominantBaseline="central"
                      className="ov-marker-count"
                      fill="#fff"
                    >
                      {a.stations.length}
                    </text>
                  </g>
                );
              })}
            </g>
          </svg>

          {/* Tooltip overlay (aligned to viewBox via %) */}
          {hoverArea && (
            <div
              className="ov-map-tip"
              style={{
                left: `${(hoverArea.x / vbW) * 100}%`,
                top: `${(hoverArea.y / vbH) * 100}%`,
              }}
            >
              <div className="flex items-center gap-2">
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ background: STATUS_COLOR[hoverArea.a.status] }}
                />
                <span className="font-semibold">{hoverArea.a.town}</span>
                <span className="text-[11px] text-[var(--text-muted)]">
                  {hoverArea.a.province}
                </span>
              </div>
              <div className="mt-1 text-[11px] text-[var(--text-muted)]">
                {STATUS_LABEL[hoverArea.a.status]} ·{' '}
                {hoverArea.a.stations.length} site
                {hoverArea.a.stations.length > 1 ? 's' : ''}
              </div>
              <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[12px]">
                <span className="text-[var(--text-muted)]">Live</span>
                <span className="tnum text-right font-semibold">
                  {hoverArea.a.pvKw.toFixed(1)} kW
                </span>
                <span className="text-[var(--text-muted)]">Today</span>
                <span className="tnum text-right font-semibold">
                  {Math.round(hoverArea.a.todayKwh).toLocaleString()} kWh
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                {hoverArea.a.oems.map(o => {
                  const m = oemMeta(o);
                  return (
                    <span
                      key={o}
                      className="rounded px-1.5 py-0.5 text-[10px] font-medium"
                      style={{ background: `${m.color}22`, color: m.color }}
                    >
                      {m.label}
                    </span>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Legend */}
        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 px-1 text-[12px] text-[var(--text-muted)]">
          {(['healthy', 'attention', 'down'] as AreaStatus[]).map(s => (
            <span key={s} className="flex items-center gap-1.5">
              <span
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ background: STATUS_COLOR[s] }}
              />
              {STATUS_LABEL[s]}
            </span>
          ))}
          <span className="ml-auto flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full bg-[var(--text-muted)] opacity-50" />
            <span className="inline-block h-3.5 w-3.5 rounded-full bg-[var(--text-muted)] opacity-50" />
            bubble size = number of sites
          </span>
        </div>
      </div>

      {/* Synced area list */}
      <div className="ov-card flex flex-col p-4">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
          Sites by location
        </div>
        <div className="mt-2 flex flex-col">
          {areas.map(a => {
            const isHover = hovered === a.key;
            return (
              <button
                key={a.key}
                type="button"
                onMouseEnter={() => setHovered(a.key)}
                onMouseLeave={() => setHovered(null)}
                className="ov-area-row flex items-center gap-3 rounded-lg px-2 py-2 text-left"
                data-hover={isHover ? 'true' : 'false'}
              >
                <span
                  className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ background: STATUS_COLOR[a.status] }}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium">
                    {a.town}
                  </span>
                  <span className="block truncate text-[11px] text-[var(--text-muted)]">
                    {a.province} · {a.stations.length} site
                    {a.stations.length > 1 ? 's' : ''}
                  </span>
                </span>
                <span className="tnum shrink-0 text-right text-[12px] font-semibold">
                  {a.pvKw.toFixed(1)}
                  <span className="ml-0.5 text-[10px] font-normal text-[var(--text-muted)]">
                    kW
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
