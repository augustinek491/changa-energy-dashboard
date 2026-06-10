// Changa OneView — alert email digest. Server-side: pulls the same live fleet
// rows the dashboard uses, runs the shared buildAlerts() rules, and renders a
// brand-styled HTML email. Sends via the existing Resend setup + report
// recipients. A preview (no-send) path renders the HTML for verification.

import { getDashboardClient } from '@/lib/supabase-dashboard';
import { Resend } from 'resend';
import { Station } from './fleet';
import {
  Alert, buildAlerts, alertCounts, SEVERITY_META, CATEGORY_META, sinceLabel,
} from './alerts';

export async function loadStations(): Promise<Station[]> {
  const db = getDashboardClient();

  const { data: stations } = await db
    .from('stations')
    .select('id, name, source, location, capacity_kw')
    .order('name');

  const ids = (stations ?? []).map(s => s.id);

  const { data: live } = await db
    .from('station_live')
    .select('station_id, pv_power_kw, load_power_kw, battery_soc, health_state, status, today_kwh, month_kwh, total_kwh, fetched_at')
    .in('station_id', ids);

  const { data: openAlarms } = await db
    .from('alarms')
    .select('station_id')
    .is('resolved_at', null)
    .in('station_id', ids);

  const liveMap = new Map((live ?? []).map(l => [l.station_id, l]));
  const alarmMap = new Map<string, number>();
  for (const a of openAlarms ?? []) alarmMap.set(a.station_id, (alarmMap.get(a.station_id) ?? 0) + 1);

  return (stations ?? []).map(s => ({
    ...s,
    live: liveMap.get(s.id) ?? null,
    alarm_count: alarmMap.get(s.id) ?? 0,
  })) as unknown as Station[];
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

const SEV_HEX: Record<Alert['severity'], string> = {
  critical: '#EF4444',
  warning: '#F59E0B',
  info: '#64748B',
};

function renderDigestHtml(alerts: Alert[], opts: { date: string; generatedAt: string }): string {
  const c = alertCounts(alerts);

  const rows = alerts.map(a => `
    <tr>
      <td style="padding:12px 14px;border-bottom:1px solid #eef2f7;vertical-align:top;width:10px;">
        <span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${SEV_HEX[a.severity]};"></span>
      </td>
      <td style="padding:12px 14px;border-bottom:1px solid #eef2f7;vertical-align:top;">
        <div style="font-weight:700;color:#0f172a;font-size:14px;">${esc(a.title)}</div>
        <div style="color:#475569;font-size:12px;margin-top:3px;line-height:1.4;">${esc(a.detail)}</div>
        <div style="color:#94a3b8;font-size:11px;margin-top:5px;">${esc(a.stationName)}${a.location ? ' &middot; ' + esc(a.location) : ''} &middot; ${esc(a.oemLabel)}</div>
      </td>
      <td style="padding:12px 14px;border-bottom:1px solid #eef2f7;vertical-align:top;text-align:right;white-space:nowrap;">
        <span style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.5px;color:${SEV_HEX[a.severity]};">${SEVERITY_META[a.severity].label}</span>
        <div style="color:#94a3b8;font-size:11px;margin-top:3px;">${esc(CATEGORY_META[a.category].label)} &middot; ${esc(sinceLabel(a.since))}</div>
      </td>
    </tr>`).join('');

  const allClear = `<tr><td colspan="3" style="padding:40px 24px;text-align:center;color:#16a34a;font-weight:700;font-size:15px;">All clear — every site is online and generating as expected.</td></tr>`;

  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;background:#f1f5f9;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:640px;margin:0 auto;padding:24px;">
    <div style="background:#0f172a;border-radius:14px 14px 0 0;padding:22px 24px;">
      <div style="color:#fff;font-size:18px;font-weight:800;letter-spacing:.5px;">CHANGA <span style="color:#17a655;">ENERGY</span></div>
      <div style="color:#cbd5e1;font-size:12px;margin-top:3px;">Fleet Alert Digest &middot; ${esc(opts.date)}</div>
    </div>
    <div style="background:#fff;padding:18px 24px;border-bottom:1px solid #eef2f7;">
      <span style="display:inline-block;margin-right:18px;font-size:13px;color:#475569;"><b style="color:#EF4444;font-size:19px;">${c.critical}</b> critical</span>
      <span style="display:inline-block;margin-right:18px;font-size:13px;color:#475569;"><b style="color:#F59E0B;font-size:19px;">${c.warning}</b> warning</span>
      <span style="display:inline-block;font-size:13px;color:#475569;"><b style="color:#0f172a;font-size:19px;">${c.sites}</b> sites affected</span>
    </div>
    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;background:#fff;border-radius:0 0 14px 14px;overflow:hidden;">
      ${alerts.length ? rows : allClear}
    </table>
    <div style="color:#94a3b8;font-size:11px;text-align:center;margin-top:18px;line-height:1.5;">
      Generated ${esc(opts.generatedAt)} &middot; Changa OneView<br/>Figures derived from live OEM portal data. Rand values are estimates.
    </div>
  </div>
</body></html>`;
}

export async function buildDigest() {
  const stations = await loadStations();
  const alerts = buildAlerts(stations);
  const now = new Date();
  const date = now.toLocaleDateString('en-ZA', { timeZone: 'Africa/Johannesburg', day: 'numeric', month: 'long', year: 'numeric' });
  const generatedAt = now.toLocaleTimeString('en-ZA', { timeZone: 'Africa/Johannesburg', hour: '2-digit', minute: '2-digit' }) + ' SAST';
  return { alerts, counts: alertCounts(alerts), html: renderDigestHtml(alerts, { date, generatedAt }), date };
}

export async function sendAlertDigest() {
  if (!process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY is not configured');

  const db = getDashboardClient();
  const { data: recipients } = await db
    .from('report_recipients')
    .select('email, label')
    .eq('active', true)
    .order('created_at');

  if (!recipients?.length) throw new Error('No active recipients configured');

  const { html, counts, date } = await buildDigest();

  const resend = new Resend(process.env.RESEND_API_KEY);
  const from = process.env.RESEND_FROM ?? 'Changa Energy <reports@aksenos.com>';
  const replyTo = process.env.RESEND_REPLY_TO;
  const toList = recipients.map(r => (r.label ? `${r.label} <${r.email}>` : r.email));
  const subject = counts.total === 0
    ? `Changa Energy — Fleet all clear · ${date}`
    : `Changa Energy — ${counts.critical} critical, ${counts.warning} warning · ${date}`;

  const { data: sent, error } = await resend.emails.send({
    from,
    to: toList,
    ...(replyTo ? { reply_to: replyTo } : {}),
    subject,
    html,
  });

  if (error) throw new Error(error.message);
  return { sent: toList.length, id: sent?.id, counts };
}
