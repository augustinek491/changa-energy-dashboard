// Changa OneView — brand + finance constants.
// Single source of truth for OEM identity, money rates, and formatting
// used across the v2 console (overview, map, stations, financials, alerts).

export type OemKey = 'livoltek' | 'fusionsolar' | 'goodwe' | 'atess';

export interface OemMeta {
  key: OemKey;
  label: string;
  color: string;       // matches CSS --oem-* tokens
  live: boolean;       // integration confirmed working
}

export const OEMS: Record<OemKey, OemMeta> = {
  livoltek:    { key: 'livoltek',    label: 'LIVOLTEK',    color: '#3B82F6', live: true },
  fusionsolar: { key: 'fusionsolar', label: 'FusionSolar', color: '#8B5CF6', live: true },
  goodwe:      { key: 'goodwe',      label: 'GoodWe',      color: '#F59E0B', live: false },
  atess:       { key: 'atess',       label: 'Atess',       color: '#EC4899', live: false },
};

export function oemMeta(source: string | null | undefined): OemMeta {
  const k = (source ?? '').toLowerCase() as OemKey;
  return OEMS[k] ?? { key: k, label: source ?? 'Unknown', color: '#64748B', live: false };
}

// ── Money model (South African labelled estimates) ──────────────────
// Real energy (kWh) × these rates. All figures surfaced in the UI carry
// an "est." tag. Confirmed defaults from project brief.
export const RATES = {
  gridTariff: 2.5,    // R / kWh — savings vs grid (Eskom-blended)
  ppaTariff: 1.8,     // R / kWh — PPA revenue
  exportTariff: 0,    // R / kWh — export earnings (disabled for now)
  carbonFactor: 0.95, // kg CO₂ avoided / kWh (SA grid intensity)
};

const zar = new Intl.NumberFormat('en-ZA', {
  style: 'currency',
  currency: 'ZAR',
  maximumFractionDigits: 0,
});
const zar2 = new Intl.NumberFormat('en-ZA', {
  style: 'currency',
  currency: 'ZAR',
  maximumFractionDigits: 2,
});

/** Format Rands. Under R100 keep 2 decimals, else whole Rands. */
export function rand(value: number): string {
  if (!isFinite(value)) return 'R 0';
  return Math.abs(value) < 100 ? zar2.format(value) : zar.format(value);
}

/** Compact Rands for hero tiles: R 1.2k / R 3.4M. */
export function randCompact(value: number): string {
  if (!isFinite(value)) return 'R 0';
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `R ${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `R ${(value / 1_000).toFixed(1)}k`;
  return `R ${Math.round(value)}`;
}

/** kWh → money + carbon, using the labelled SA rates. */
export function valueOfEnergy(kwh: number) {
  return {
    savings: kwh * RATES.gridTariff,
    ppa: kwh * RATES.ppaTariff,
    export: kwh * RATES.exportTariff,
    carbonKg: kwh * RATES.carbonFactor,
  };
}
