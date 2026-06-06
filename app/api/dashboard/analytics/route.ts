import { NextResponse } from 'next/server';
import { getDashboardClient } from '@/lib/supabase-dashboard';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  const db = getDashboardClient();

  // Last 30 days daily totals
  const day30Start = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
  // Last 12 months
  const now = new Date();
  const month12Start = new Date(now.getFullYear() - 1, now.getMonth(), 1);
  const month12Str = `${month12Start.getFullYear()}-${String(month12Start.getMonth() + 1).padStart(2, '0')}`;

  const [dailyRes, monthlyRes, lifetimeRes, stationsRes] = await Promise.all([
    db.from('station_kpi_day')
      .select('date, pv_yield_kwh')
      .gte('date', day30Start)
      .order('date'),
    db.from('station_kpi_month')
      .select('year_month, pv_yield_kwh')
      .gte('year_month', month12Str)
      .order('year_month'),
    db.from('station_kpi_month')
      .select('pv_yield_kwh'),
    db.from('stations')
      .select(`
        id, name,
        station_kpi_month ( pv_yield_kwh )
      `),
  ]);

  // Aggregate daily
  const dailyMap = new Map<string, number>();
  for (const r of dailyRes.data ?? []) {
    dailyMap.set(r.date, (dailyMap.get(r.date) ?? 0) + (r.pv_yield_kwh ?? 0));
  }
  const daily = Array.from(dailyMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, total_kwh]) => ({ date, total_kwh: Math.round(total_kwh * 10) / 10 }));

  // Aggregate monthly
  const monthMap = new Map<string, number>();
  for (const r of monthlyRes.data ?? []) {
    monthMap.set(r.year_month, (monthMap.get(r.year_month) ?? 0) + (r.pv_yield_kwh ?? 0));
  }
  const monthly = Array.from(monthMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([year_month, total_kwh]) => ({ year_month, total_kwh: Math.round(total_kwh * 10) / 10 }));

  // Lifetime total
  const lifetimeKwh = (lifetimeRes.data ?? []).reduce((s, r) => s + (r.pv_yield_kwh ?? 0), 0);

  // Per-station totals
  type StationRow = { id: string; name: string; station_kpi_month: { pv_yield_kwh: number | null }[] };
  const byStation = ((stationsRes.data ?? []) as StationRow[])
    .map(s => ({
      station_id: s.id,
      station_name: s.name,
      total_kwh: Math.round(
        s.station_kpi_month.reduce((sum, r) => sum + (r.pv_yield_kwh ?? 0), 0) * 10,
      ) / 10,
    }))
    .sort((a, b) => b.total_kwh - a.total_kwh);

  // Today aggregate from daily table
  const today = new Date().toISOString().slice(0, 10);
  const todayKwh = dailyMap.get(today) ?? 0;

  // This month
  const thisMonthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const thisMonthKwh = monthMap.get(thisMonthStr) ?? 0;

  const CO2_KG_PER_KWH = 0.9;
  const co2SavedT = Math.round((lifetimeKwh * CO2_KG_PER_KWH) / 1000 * 10) / 10;

  return NextResponse.json({
    kpi: {
      today_kwh: Math.round(todayKwh * 10) / 10,
      month_kwh: Math.round(thisMonthKwh * 10) / 10,
      lifetime_kwh: Math.round(lifetimeKwh * 10) / 10,
      co2_saved_t: co2SavedT,
    },
    daily,
    monthly,
    by_station: byStation,
  });
}
