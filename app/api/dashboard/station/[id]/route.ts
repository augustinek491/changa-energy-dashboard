import { NextRequest, NextResponse } from 'next/server';
import { getDashboardClient } from '@/lib/supabase-dashboard';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type Range = 'day' | 'month' | 'year' | 'all';

function todayStr()        { return new Date().toISOString().slice(0, 10); }
function currentMonthStr() { return new Date().toISOString().slice(0, 7); }
function currentYearStr()  { return String(new Date().getFullYear()); }

/** Zero-fill every day of the month up to today so the chart always shows a full month grid. */
function padMonthDays(
  data: { date: string; pv_yield_kwh: number }[],
  year: number,
  month: number,   // 1-based
): { date: string; pv_yield_kwh: number }[] {
  const today = todayStr();
  const daysInMonth = new Date(year, month, 0).getDate();
  const map = new Map(data.map(r => [r.date, r.pv_yield_kwh]));
  const out: { date: string; pv_yield_kwh: number }[] = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const ds = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    if (ds > today) break;
    out.push({ date: ds, pv_yield_kwh: map.get(ds) ?? 0 });
  }
  return out;
}

/** Zero-fill every month of the year up to the current month so the chart always shows a full year grid. */
function padYearMonths(
  data: { year_month: string; pv_yield_kwh: number }[],
  year: number,
): { year_month: string; pv_yield_kwh: number }[] {
  const currentYm = new Date().toISOString().slice(0, 7);
  const map = new Map(data.map(r => [r.year_month, r.pv_yield_kwh]));
  const out: { year_month: string; pv_yield_kwh: number }[] = [];
  for (let m = 1; m <= 12; m++) {
    const ym = `${year}-${String(m).padStart(2, '0')}`;
    if (ym > currentYm) break;
    out.push({ year_month: ym, pv_yield_kwh: map.get(ym) ?? 0 });
  }
  return out;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const url     = new URL(req.url);
  const range   = (url.searchParams.get('range') ?? 'day') as Range;
  // Fix: default to today, not yesterday
  const dateParam  = url.searchParams.get('date')  ?? todayStr();
  const monthParam = url.searchParams.get('month') ?? currentMonthStr();
  const yearParam  = url.searchParams.get('year')  ?? currentYearStr();
  const db = getDashboardClient();

  const [stationRes, liveRes] = await Promise.all([
    db.from('stations').select('id, name, source, location, capacity_kw').eq('id', id).single(),
    db.from('station_live').select('*').eq('station_id', id).single(),
  ]);

  if (stationRes.error) return NextResponse.json({ error: 'Station not found' }, { status: 404 });

  let readings: unknown[] = [];
  let granularity: '5min' | 'hour' | 'day' | 'month' = '5min';
  let hourlyUnavailable = false;
  let sparseDay = false;
  const source = stationRes.data.source;

  if (range === 'day') {
    // Use SAST (UTC+2) day boundaries — all stations are in South Africa.
    // Querying UTC midnight would return the wrong window for any viewer
    // not in UTC, causing morning data to be missing and overnight data
    // to spill into the wrong day's chart.
    const dayStart = `${dateParam}T00:00:00.000+02:00`;
    const dayEnd   = `${dateParam}T23:59:59.999+02:00`;

    if (source === 'livoltek') {
      const { data } = await db
        .from('station_readings')
        .select('recorded_at, pv_power_kw, load_power_kw, grid_power_kw, battery_soc, battery_power_kw')
        .eq('station_id', id)
        .gte('recorded_at', dayStart)
        .lte('recorded_at', dayEnd)
        .order('recorded_at');
      const rawReadings = data ?? [];
      readings = rawReadings;
      granularity = '5min';
      // Sparse: historical day with < 24 readings (< 2 hours of data)
      const isToday = dateParam === todayStr();
      sparseDay = !isToday && rawReadings.length > 0 && rawReadings.length < 24;
    } else {
      // FusionSolar: hourly data only retained for ~7 days by the API
      const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000);
      sevenDaysAgo.setUTCHours(0, 0, 0, 0);

      if (new Date(dayStart) >= sevenDaysAgo) {
        const { data, count } = await db
          .from('station_readings')
          .select('recorded_at, pv_power_kw', { count: 'exact' })
          .eq('station_id', id)
          .gte('recorded_at', dayStart)
          .lte('recorded_at', dayEnd)
          .order('recorded_at');

        if ((count ?? 0) >= 8) {
          readings = data ?? [];
          granularity = 'hour';
        } else {
          // Recent but sparse — show daily total bar
          const { data: kpi } = await db
            .from('station_kpi_day')
            .select('date, pv_yield_kwh')
            .eq('station_id', id)
            .eq('date', dateParam);
          readings = kpi ?? [];
          granularity = 'day';
        }
      } else {
        // Older than 7 days — hourly data not available from API
        const { data: kpi } = await db
          .from('station_kpi_day')
          .select('date, pv_yield_kwh')
          .eq('station_id', id)
          .eq('date', dateParam);
        readings = kpi ?? [];
        granularity = 'day';
        hourlyUnavailable = true;
      }
    }
  } else if (range === 'month') {
    const [y, m] = monthParam.split('-').map(Number);
    const firstDay = `${monthParam}-01`;
    const lastDay  = new Date(y, m, 0).toISOString().slice(0, 10);
    const { data } = await db
      .from('station_kpi_day')
      .select('date, pv_yield_kwh')
      .eq('station_id', id)
      .gte('date', firstDay)
      .lte('date', lastDay)
      .order('date');
    readings = padMonthDays(data ?? [], y, m);
    granularity = 'day';
  } else if (range === 'year') {
    const { data } = await db
      .from('station_kpi_month')
      .select('year_month, pv_yield_kwh')
      .eq('station_id', id)
      .gte('year_month', `${yearParam}-01`)
      .lte('year_month', `${yearParam}-12`)
      .order('year_month');
    readings = padYearMonths(data ?? [], parseInt(yearParam));
    granularity = 'month';
  } else {
    // all time
    const { data } = await db
      .from('station_kpi_month')
      .select('year_month, pv_yield_kwh')
      .eq('station_id', id)
      .order('year_month');
    readings = data ?? [];
    granularity = 'month';
  }

  return NextResponse.json({
    station: stationRes.data,
    live:    liveRes.data ?? null,
    readings,
    range,
    granularity,
    hourlyUnavailable,
    sparseDay,
    selectedDate:  dateParam,
    selectedMonth: monthParam,
    selectedYear:  parseInt(yearParam),
  });
}
