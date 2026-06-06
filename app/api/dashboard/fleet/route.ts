import { NextResponse } from 'next/server';
import { getDashboardClient } from '@/lib/supabase-dashboard';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  const db = getDashboardClient();

  const { data: stations, error: stErr } = await db
    .from('stations')
    .select('id, name, source, location, capacity_kw')
    .order('name');

  if (stErr) return NextResponse.json({ error: stErr.message }, { status: 500 });

  const stationIds = (stations ?? []).map(s => s.id);

  const { data: live, error: liveErr } = await db
    .from('station_live')
    .select('station_id, pv_power_kw, load_power_kw, grid_power_kw, battery_soc, battery_power_kw, health_state, status, today_kwh, month_kwh, total_kwh, fetched_at')
    .in('station_id', stationIds);

  if (liveErr) return NextResponse.json({ error: liveErr.message }, { status: 500 });

  // Open alarms count per station
  const { data: alarmCounts } = await db
    .from('alarms')
    .select('station_id')
    .is('resolved_at', null)
    .in('station_id', stationIds);

  const alarmMap = new Map<string, number>();
  for (const a of alarmCounts ?? []) {
    alarmMap.set(a.station_id, (alarmMap.get(a.station_id) ?? 0) + 1);
  }

  const liveMap = new Map((live ?? []).map(l => [l.station_id, l]));

  const rows = (stations ?? []).map(s => ({
    ...s,
    live: liveMap.get(s.id) ?? null,
    alarm_count: alarmMap.get(s.id) ?? 0,
  }));

  // Fleet summary
  let totalPvKw = 0;
  let totalTodayKwh = 0;
  let totalMonthKwh = 0;
  let totalLifetimeKwh = 0;
  let onlineCount = 0;
  let alarmCount = 0;
  let offlineCount = 0;

  for (const row of rows) {
    const l = row.live;
    if (!l) { offlineCount++; continue; }

    const isOnline = row.source === 'fusionsolar'
      ? l.health_state === 3
      : l.status === 1;
    const isAlarm = row.source === 'fusionsolar'
      ? l.health_state === 2
      : l.status === 4;

    if (isOnline || isAlarm) {
      totalPvKw += l.pv_power_kw ?? 0;
      totalTodayKwh += l.today_kwh ?? 0;
    }
    totalMonthKwh += l.month_kwh ?? 0;
    totalLifetimeKwh += l.total_kwh ?? 0;

    if (isOnline) onlineCount++;
    else if (isAlarm) alarmCount++;
    else offlineCount++;
  }

  const summary = {
    total: rows.length,
    online: onlineCount,
    alarm: alarmCount,
    offline: offlineCount,
    open_alarms: alarmCounts?.length ?? 0,
    total_pv_kw: Math.round(totalPvKw * 10) / 10,
    total_today_kwh: Math.round(totalTodayKwh * 10) / 10,
    total_month_kwh: Math.round(totalMonthKwh * 10) / 10,
    total_lifetime_kwh: Math.round(totalLifetimeKwh * 10) / 10,
  };

  return NextResponse.json({ stations: rows, summary });
}
