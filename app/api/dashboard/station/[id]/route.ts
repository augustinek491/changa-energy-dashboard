import { NextRequest, NextResponse } from 'next/server';
import { getDashboardClient } from '@/lib/supabase-dashboard';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type Range = 'day' | 'week' | 'month' | 'year' | 'all';

function rangeStart(range: Range): string {
  const now = new Date();
  switch (range) {
    case 'day':   return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    case 'week':  return new Date(now.getTime() - 7 * 86400_000).toISOString();
    case 'month': return new Date(now.getTime() - 30 * 86400_000).toISOString();
    case 'year':  return new Date(now.getTime() - 365 * 86400_000).toISOString();
    case 'all':   return '2020-01-01T00:00:00.000Z';
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const range = (new URL(req.url).searchParams.get('range') ?? 'day') as Range;
  const db = getDashboardClient();

  const [stationRes, liveRes] = await Promise.all([
    db.from('stations').select('id, name, source, location, capacity_kw').eq('id', id).single(),
    db.from('station_live').select('*').eq('station_id', id).single(),
  ]);

  if (stationRes.error) return NextResponse.json({ error: 'Station not found' }, { status: 404 });

  let readings: unknown[] = [];

  if (range === 'day' || range === 'week') {
    // Raw 5-min readings from station_readings
    const { data } = await db
      .from('station_readings')
      .select('recorded_at, pv_power_kw, load_power_kw, grid_power_kw, battery_soc, battery_power_kw')
      .eq('station_id', id)
      .gte('recorded_at', rangeStart(range))
      .order('recorded_at');
    readings = data ?? [];
  } else if (range === 'month') {
    // Daily KPI for last 30 days
    const from = rangeStart('month').slice(0, 10);
    const { data } = await db
      .from('station_kpi_day')
      .select('date, pv_yield_kwh')
      .eq('station_id', id)
      .gte('date', from)
      .order('date');
    readings = data ?? [];
  } else if (range === 'year') {
    // Monthly KPI for last 12 months
    const from = new Date();
    from.setFullYear(from.getFullYear() - 1);
    const fromStr = `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, '0')}`;
    const { data } = await db
      .from('station_kpi_month')
      .select('year_month, pv_yield_kwh')
      .eq('station_id', id)
      .gte('year_month', fromStr)
      .order('year_month');
    readings = data ?? [];
  } else {
    // All-time monthly KPI
    const { data } = await db
      .from('station_kpi_month')
      .select('year_month, pv_yield_kwh')
      .eq('station_id', id)
      .order('year_month');
    readings = data ?? [];
  }

  return NextResponse.json({
    station: stationRes.data,
    live: liveRes.data ?? null,
    readings,
    range,
  });
}
