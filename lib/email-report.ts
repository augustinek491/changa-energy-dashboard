import { createElement } from 'react';
import { getDashboardClient } from '@/lib/supabase-dashboard';
import { Resend } from 'resend';
import { render } from '@react-email/render';
import { DailyReport, type ReportStation, type ReportAlarm } from '@/emails/daily-report';

export type ReportMode = 'snapshot' | 'daily';

function stationStatus(source: string, health: number | null, status: number | null) {
  if (source === 'fusionsolar') {
    if (health === 3) return 'online' as const;
    if (health === 2) return 'alarm' as const;
    return 'offline' as const;
  }
  if (status === 1) return 'online' as const;
  if (status === 4) return 'alarm' as const;
  return 'offline' as const;
}

export async function sendFleetReport(mode: ReportMode = 'snapshot') {
  if (!process.env.RESEND_API_KEY) {
    throw new Error('RESEND_API_KEY is not configured');
  }

  const db = getDashboardClient();

  const [{ data: stations }, { data: liveRows }, { data: alarmRows }, { data: recipients }] =
    await Promise.all([
      db.from('stations').select('id, name, source, location').order('name'),
      db.from('station_live').select(
        'station_id, pv_power_kw, health_state, status, today_kwh, month_kwh, total_kwh',
      ),
      db.from('alarms')
        .select('alarm_name, severity, raised_at, stations!inner(name)')
        .is('resolved_at', null)
        .order('raised_at', { ascending: false })
        .limit(20),
      db.from('report_recipients')
        .select('email, label')
        .eq('active', true)
        .order('created_at'),
    ]);

  if (!recipients?.length) {
    throw new Error('No active recipients configured');
  }

  const liveMap = new Map((liveRows ?? []).map(l => [l.station_id, l]));

  let totalPvKw = 0, totalTodayKwh = 0, totalMonthKwh = 0, totalLifetimeKwh = 0;
  let onlineCount = 0, alarmCount = 0, offlineCount = 0;

  const reportStations: ReportStation[] = (stations ?? []).map(s => {
    const l = liveMap.get(s.id);
    const st = stationStatus(s.source, l?.health_state ?? null, l?.status ?? null);

    if (l && (st === 'online' || st === 'alarm')) {
      totalPvKw += l.pv_power_kw ?? 0;
      totalTodayKwh += l.today_kwh ?? 0;
    }
    totalMonthKwh += l?.month_kwh ?? 0;
    totalLifetimeKwh += l?.total_kwh ?? 0;

    if (st === 'online') onlineCount++;
    else if (st === 'alarm') alarmCount++;
    else offlineCount++;

    return {
      name: s.name,
      source: s.source,
      location: s.location,
      status: st,
      pv_power_kw: mode === 'daily' ? null : (l?.pv_power_kw ?? null),
      today_kwh: l?.today_kwh ?? null,
      month_kwh: l?.month_kwh ?? null,
    };
  });

  const reportAlarms: ReportAlarm[] = (alarmRows ?? []).map(a => {
    const raw = a as unknown as Record<string, unknown>;
    const st = raw.stations;
    const stationName = Array.isArray(st)
      ? (st as { name: string }[])[0]?.name
      : (st as { name: string } | null)?.name;
    return {
      station_name: stationName ?? 'Unknown',
      alarm_name: raw.alarm_name as string | null,
      severity: raw.severity as string | null,
      raised_at: raw.raised_at as string,
    };
  });

  const now = new Date();
  const date = now.toLocaleDateString('en-ZA', {
    timeZone: 'Africa/Johannesburg',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  const generatedAt =
    now.toLocaleTimeString('en-ZA', {
      timeZone: 'Africa/Johannesburg',
      hour: '2-digit',
      minute: '2-digit',
    }) + ' SAST';

  const summary = {
    total: reportStations.length,
    online: onlineCount,
    alarm: alarmCount,
    offline: offlineCount,
    open_alarms: reportAlarms.length,
    total_pv_kw: Math.round(totalPvKw * 10) / 10,
    total_today_kwh: Math.round(totalTodayKwh * 10) / 10,
    total_month_kwh: Math.round(totalMonthKwh * 10) / 10,
    total_lifetime_kwh: Math.round(totalLifetimeKwh * 10) / 10,
  };

  const subjectLabel = mode === 'daily' ? 'Daily Generation Report' : 'Fleet Status Report';
  const kwhLabel = mode === 'daily' ? 'Today kWh' : 'Today kWh';

  const html = await render(
    createElement(DailyReport, {
      date,
      generatedAt,
      summary,
      stations: reportStations,
      alarms: reportAlarms,
      kwhLabel,
    }),
  );

  const resend = new Resend(process.env.RESEND_API_KEY);
  const from = process.env.RESEND_FROM ?? 'Changa Energy <reports@aksenos.com>';
  const replyTo = process.env.RESEND_REPLY_TO;
  const toList = recipients.map(r => (r.label ? `${r.label} <${r.email}>` : r.email));

  const { data: sent, error } = await resend.emails.send({
    from,
    to: toList,
    ...(replyTo ? { reply_to: replyTo } : {}),
    subject: `Changa Energy — ${subjectLabel} · ${date}`,
    html,
  });

  if (error) throw new Error(error.message);

  return { sent: toList.length, recipients: toList, id: sent?.id };
}
