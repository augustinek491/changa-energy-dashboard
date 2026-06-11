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
import { changaLogoSvgDataUri, changaLogoPng } from './logo';
import { oemMeta } from './brand';

const APP_URL = 'https://changaenergydashboard.vercel.app';

type Recipient = { email: string; label?: string | null };

// Shared by digest + alarm emails: the real lockup travels as a CID-attached PNG
// (Gmail renders neither SVG nor data-URI images); browser previews get crisp SVG.
function headerLogo(logoSrc: string | null): string {
  return logoSrc
    ? `<img src="${logoSrc}" width="150" height="41" alt="Changa Energy" style="display:block;border:0;outline:none;height:41px;width:auto;" />`
    : `<div style="color:#fff;font-size:18px;font-weight:800;letter-spacing:.5px;">CHANGA <span style="color:#17a655;">ENERGY</span></div>`;
}

async function logoAttachment(): Promise<{ png: Buffer | null; src: string | null }> {
  try {
    const png = await changaLogoPng();
    return { png, src: 'cid:changa-logo' };
  } catch {
    return { png: null, src: null };
  }
}

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

function renderDigestHtml(alerts: Alert[], opts: { date: string; generatedAt: string }, logoSrc: string | null = null): string {
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
      ${headerLogo(logoSrc)}
      <div style="color:#cbd5e1;font-size:12px;margin-top:10px;">Fleet Alert Digest &middot; ${esc(opts.date)}</div>
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

function nowStamps() {
  const now = new Date();
  const date = now.toLocaleDateString('en-ZA', { timeZone: 'Africa/Johannesburg', day: 'numeric', month: 'long', year: 'numeric' });
  const generatedAt = now.toLocaleTimeString('en-ZA', { timeZone: 'Africa/Johannesburg', hour: '2-digit', minute: '2-digit' }) + ' SAST';
  return { date, generatedAt };
}

export async function buildDigest() {
  const stations = await loadStations();
  const alerts = buildAlerts(stations);
  const { date, generatedAt } = nowStamps();
  // Browser-rendered preview takes the crisp vector logo.
  return { alerts, counts: alertCounts(alerts), html: renderDigestHtml(alerts, { date, generatedAt }, changaLogoSvgDataUri()), date };
}

// `overrideTo` bypasses the report_recipients table for one-off test/demo sends.
export async function sendAlertDigest(overrideTo?: Recipient[]) {
  if (!process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY is not configured');

  let recipients = overrideTo ?? null;
  if (!recipients) {
    const db = getDashboardClient();
    const { data } = await db
      .from('report_recipients')
      .select('email, label')
      .eq('active', true)
      .order('created_at');
    recipients = data ?? [];
  }

  if (!recipients.length) throw new Error('No active recipients configured');

  const stations = await loadStations();
  const alerts = buildAlerts(stations);
  const counts = alertCounts(alerts);
  const { date, generatedAt } = nowStamps();
  const { png, src } = await logoAttachment();
  const html = renderDigestHtml(alerts, { date, generatedAt }, src);

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
    ...(png ? { attachments: [{ filename: 'changa-logo.png', content: png, contentId: 'changa-logo' }] } : {}),
  });

  if (error) throw new Error(error.message);
  return { sent: toList.length, id: sent?.id, counts };
}

// ---------------------------------------------------------------------------
// Single-alarm notification — the email Changa would receive the moment one
// site trips. Used by the demo "send test alarm" button: it carries the most
// severe REAL alert currently active, or a clearly-labelled simulated outage
// when the fleet happens to be all clear.
// ---------------------------------------------------------------------------

function pickTopAlert(alerts: Alert[]): Alert | null {
  if (!alerts.length) return null;
  return [...alerts].sort((a, b) => SEVERITY_META[a.severity].rank - SEVERITY_META[b.severity].rank)[0];
}

function demoAlert(stations: Station[]): Alert {
  const s = stations[0];
  const m = oemMeta(s?.source ?? 'livoltek');
  return {
    id: 'demo:offline',
    severity: 'critical',
    category: 'offline',
    stationId: s?.id ?? '',
    stationName: s?.name ?? 'Demo Site',
    source: s?.source ?? 'livoltek',
    oemLabel: m.label,
    oemColor: m.color,
    location: s?.location ?? null,
    title: 'Site offline',
    detail: 'Not reporting to the portal — possible comms or power loss.',
    since: new Date(Date.now() - 42 * 60 * 1000).toISOString(),
    suggestion: 'Check site connectivity and inverter power.',
  };
}

function renderAlarmHtml(a: Alert, opts: { generatedAt: string; simulated: boolean }, logoSrc: string | null): string {
  const sev = SEV_HEX[a.severity];
  const stationUrl = `${APP_URL}/v2/stations/${encodeURIComponent(a.stationId)}`;
  const facts: [string, string][] = [
    ['Site', a.stationName],
    ...(a.location ? [['Location', a.location] as [string, string]] : []),
    ['Portal', a.oemLabel],
    ['Category', CATEGORY_META[a.category].label],
    ['Since', sinceLabel(a.since)],
  ];

  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;background:#f1f5f9;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:24px;">
    <div style="background:#0f172a;border-radius:14px 14px 0 0;padding:22px 24px;">
      ${headerLogo(logoSrc)}
      <div style="color:#cbd5e1;font-size:12px;margin-top:10px;">Fleet Alarm Notification</div>
    </div>
    <div style="background:${sev};padding:14px 24px;">
      <span style="color:#fff;font-size:13px;font-weight:800;text-transform:uppercase;letter-spacing:1.5px;">&#9888;&nbsp; ${esc(SEVERITY_META[a.severity].label)} &middot; ${esc(a.title)}</span>
    </div>
    <div style="background:#fff;padding:24px;">
      <div style="font-size:20px;font-weight:800;color:#0f172a;">${esc(a.stationName)}</div>
      <div style="color:#475569;font-size:14px;margin-top:8px;line-height:1.5;">${esc(a.detail)}</div>
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin-top:18px;">
        ${facts.map(([k, v]) => `
        <tr>
          <td style="padding:8px 0;border-bottom:1px solid #eef2f7;color:#94a3b8;font-size:12px;text-transform:uppercase;letter-spacing:.5px;width:110px;">${esc(k)}</td>
          <td style="padding:8px 0;border-bottom:1px solid #eef2f7;color:#0f172a;font-size:14px;font-weight:600;">${esc(v)}</td>
        </tr>`).join('')}
      </table>
      ${a.suggestion ? `
      <div style="background:#f8fafc;border-left:3px solid #17a655;border-radius:0 8px 8px 0;padding:12px 16px;margin-top:18px;">
        <div style="color:#475569;font-size:13px;line-height:1.5;"><b style="color:#0f172a;">Suggested action:</b> ${esc(a.suggestion)}</div>
      </div>` : ''}
      <div style="margin-top:24px;">
        <a href="${stationUrl}" style="display:inline-block;background:#17a655;color:#fff;text-decoration:none;font-size:14px;font-weight:700;padding:12px 22px;border-radius:10px;">Open site in OneView &rarr;</a>
      </div>
    </div>
    <div style="background:#fff;border-top:1px solid #eef2f7;border-radius:0 0 14px 14px;padding:14px 24px;color:#94a3b8;font-size:11px;line-height:1.5;">
      Sent ${esc(opts.generatedAt)} &middot; Changa OneView${opts.simulated ? '<br/><b style="color:#F59E0B;">Simulated alarm for demonstration</b> — the fleet was all clear when this test was sent.' : ''}
    </div>
  </div>
</body></html>`;
}

// Renders the alarm notification HTML for browser preview (no send).
export async function buildAlarmNotification() {
  const stations = await loadStations();
  const top = pickTopAlert(buildAlerts(stations));
  const alert = top ?? demoAlert(stations);
  const { generatedAt } = nowStamps();
  const html = renderAlarmHtml(alert, { generatedAt, simulated: !top }, changaLogoSvgDataUri());
  return { html, alert, simulated: !top };
}

export async function sendAlarmNotification(to: Recipient[]) {
  if (!process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY is not configured');
  if (!to.length) throw new Error('No recipient given');

  const stations = await loadStations();
  const top = pickTopAlert(buildAlerts(stations));
  const alert = top ?? demoAlert(stations);
  const simulated = !top;
  const { generatedAt } = nowStamps();
  const { png, src } = await logoAttachment();
  const html = renderAlarmHtml(alert, { generatedAt, simulated }, src);

  const resend = new Resend(process.env.RESEND_API_KEY);
  const from = process.env.RESEND_FROM ?? 'Changa Energy <reports@aksenos.com>';
  const replyTo = process.env.RESEND_REPLY_TO;
  const toList = to.map(r => (r.label ? `${r.label} <${r.email}>` : r.email));
  const subject = `Changa Energy — ${SEVERITY_META[alert.severity].label.toUpperCase()}: ${alert.title} · ${alert.stationName}`;

  const { data: sent, error } = await resend.emails.send({
    from,
    to: toList,
    ...(replyTo ? { reply_to: replyTo } : {}),
    subject,
    html,
    ...(png ? { attachments: [{ filename: 'changa-logo.png', content: png, contentId: 'changa-logo' }] } : {}),
  });

  if (error) throw new Error(error.message);
  return { sent: toList.length, id: sent?.id, simulated, alertTitle: `${alert.title} — ${alert.stationName}` };
}
