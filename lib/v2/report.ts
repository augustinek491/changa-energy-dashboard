// Changa OneView — daily fleet report. The boardroom briefing: one branded
// document that rolls up fleet status, energy yield, the Rand value of that
// energy, a per-manufacturer breakdown, the top-producing sites, and the open
// alerts. Rendered as email-safe HTML (sent daily via Resend) and as a
// print-ready page the browser saves straight to PDF — same data, one template.

import { getDashboardClient } from '@/lib/supabase-dashboard';
import { Resend } from 'resend';
import { loadStations } from './alert-email';
import { Station, statusOf, capacityKw, groupByOem } from './fleet';
import { buildAlerts, alertCounts, SEVERITY_META, CATEGORY_META, sinceLabel, Alert } from './alerts';
import { valueOfEnergy, rand, randCompact, RATES } from './brand';
import { changaLogoSvgDataUri, changaLogoPng } from './logo';

type Mode = 'email' | 'print';

const SEV_HEX: Record<Alert['severity'], string> = {
  critical: '#EF4444',
  warning: '#F59E0B',
  info: '#64748B',
};

function esc(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

function fmtKwh(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)} MWh`;
  return `${Math.round(n)} kWh`;
}

function fmtCO2(kg: number): string {
  return kg >= 1000 ? `${(kg / 1000).toFixed(1)} t` : `${Math.round(kg)} kg`;
}

interface ReportData {
  stations: Station[];
  alerts: Alert[];
  date: string;
  generatedAt: string;
}

function summarise(stations: Station[]) {
  let online = 0, alarm = 0, offline = 0;
  let pvKw = 0, todayKwh = 0, monthKwh = 0, lifetimeKwh = 0;

  for (const s of stations) {
    const st = statusOf(s);
    if (st === 'online') online++;
    else if (st === 'alarm') alarm++;
    else offline++;

    const l = s.live;
    if (l && (st === 'online' || st === 'alarm')) pvKw += l.pv_power_kw ?? 0;
    todayKwh += l?.today_kwh ?? 0;
    monthKwh += l?.month_kwh ?? 0;
    lifetimeKwh += l?.total_kwh ?? 0;
  }

  return {
    total: stations.length, online, alarm, offline,
    pvKw, todayKwh, monthKwh, lifetimeKwh,
    moneyToday: valueOfEnergy(todayKwh),
    moneyMonth: valueOfEnergy(monthKwh),
    moneyLifetime: valueOfEnergy(lifetimeKwh),
  };
}

// ── Email-safe table cells ──────────────────────────────────────────
function kpiCell(value: string, label: string, color: string): string {
  return `
    <td style="padding:14px 12px;text-align:center;vertical-align:top;border-right:1px solid #eef2f7;">
      <div style="font-size:24px;font-weight:800;color:${color};line-height:1;">${esc(value)}</div>
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#94a3b8;margin-top:7px;">${esc(label)}</div>
    </td>`;
}

function sectionTitle(text: string): string {
  return `<tr><td colspan="4" style="padding:22px 22px 8px;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.9px;color:#0f172a;">${esc(text)}</td></tr>`;
}

function renderReportHtml(data: ReportData, mode: Mode, logoSrc: string | null): string {
  const { stations, alerts } = data;
  const s = summarise(stations);
  const c = alertCounts(alerts);
  const oems = groupByOem(stations);

  const topSites = [...stations]
    .filter(st => (st.live?.today_kwh ?? 0) > 0)
    .sort((a, b) => (b.live?.today_kwh ?? 0) - (a.live?.today_kwh ?? 0))
    .slice(0, 5);

  // Executive summary — four headline numbers.
  const summaryRow = `
    <tr><td colspan="4" style="padding:0 22px;">
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;background:#f8fafc;border-radius:12px;border:1px solid #eef2f7;">
        <tr>
          ${kpiCell(`${s.online}/${s.total}`, 'Sites online', '#0f172a')}
          ${kpiCell(fmtKwh(s.todayKwh), 'Energy today', '#F59E0B')}
          ${kpiCell(randCompact(s.moneyToday.savings), 'Saved today', '#10B981')}
          <td style="padding:14px 12px;text-align:center;vertical-align:top;">
            <div style="font-size:24px;font-weight:800;color:${c.total ? '#EF4444' : '#16a34a'};line-height:1;">${c.total}</div>
            <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#94a3b8;margin-top:7px;">Open alerts</div>
          </td>
        </tr>
      </table>
    </td></tr>`;

  // Fleet status + month-to-date strip.
  const statusRow = `
    <tr><td colspan="4" style="padding:14px 22px 4px;">
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">
        <tr>
          <td style="font-size:13px;color:#475569;">
            <span style="display:inline-block;margin-right:14px;"><b style="color:#16a34a;">${s.online}</b> online</span>
            <span style="display:inline-block;margin-right:14px;"><b style="color:#F59E0B;">${s.alarm}</b> alarm</span>
            <span style="display:inline-block;"><b style="color:#EF4444;">${s.offline}</b> offline</span>
          </td>
          <td style="text-align:right;font-size:13px;color:#475569;">
            Month to date: <b style="color:#0f172a;">${esc(fmtKwh(s.monthKwh))}</b> &middot; <b style="color:#10B981;">${esc(randCompact(s.moneyMonth.savings))}</b>
          </td>
        </tr>
      </table>
    </td></tr>`;

  // Financial value — today vs month-to-date.
  const moneyRow = `
    ${sectionTitle('Financial value · estimated')}
    <tr><td colspan="4" style="padding:0 22px 6px;">
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;font-size:13px;">
        <tr style="color:#94a3b8;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;">
          <td style="padding:6px 0;">Stream</td>
          <td style="padding:6px 0;text-align:right;">Today</td>
          <td style="padding:6px 0;text-align:right;">Month to date</td>
        </tr>
        <tr style="border-top:1px solid #eef2f7;">
          <td style="padding:9px 0;color:#0f172a;font-weight:600;">Grid savings <span style="color:#94a3b8;font-weight:500;">@ ${esc(rand(RATES.gridTariff))}/kWh</span></td>
          <td style="padding:9px 0;text-align:right;color:#10B981;font-weight:700;">${esc(rand(s.moneyToday.savings))}</td>
          <td style="padding:9px 0;text-align:right;color:#10B981;font-weight:700;">${esc(rand(s.moneyMonth.savings))}</td>
        </tr>
        <tr style="border-top:1px solid #eef2f7;">
          <td style="padding:9px 0;color:#0f172a;font-weight:600;">PPA revenue <span style="color:#94a3b8;font-weight:500;">@ ${esc(rand(RATES.ppaTariff))}/kWh</span></td>
          <td style="padding:9px 0;text-align:right;color:#475569;font-weight:700;">${esc(rand(s.moneyToday.ppa))}</td>
          <td style="padding:9px 0;text-align:right;color:#475569;font-weight:700;">${esc(rand(s.moneyMonth.ppa))}</td>
        </tr>
        <tr style="border-top:1px solid #eef2f7;">
          <td style="padding:9px 0;color:#0f172a;font-weight:600;">Carbon avoided <span style="color:#94a3b8;font-weight:500;">@ ${RATES.carbonFactor} kg/kWh</span></td>
          <td style="padding:9px 0;text-align:right;color:#475569;font-weight:700;">${esc(fmtCO2(s.moneyToday.carbonKg))}</td>
          <td style="padding:9px 0;text-align:right;color:#475569;font-weight:700;">${esc(fmtCO2(s.moneyMonth.carbonKg))}</td>
        </tr>
      </table>
    </td></tr>`;

  // Generation by manufacturer.
  const oemRows = oems.map(g => `
    <tr style="border-top:1px solid #eef2f7;">
      <td style="padding:9px 0;color:#0f172a;font-weight:600;">
        <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${g.color};margin-right:7px;"></span>${esc(g.label)}
        ${g.live ? '' : '<span style="color:#94a3b8;font-weight:500;font-size:11px;"> · pending</span>'}
      </td>
      <td style="padding:9px 0;text-align:right;color:#475569;">${g.online}/${g.stations.length}</td>
      <td style="padding:9px 0;text-align:right;color:#0f172a;font-weight:700;">${esc(fmtKwh(g.todayKwh))}</td>
      <td style="padding:9px 0;text-align:right;color:#10B981;font-weight:700;">${esc(rand(valueOfEnergy(g.todayKwh).savings))}</td>
    </tr>`).join('');

  const oemSection = `
    ${sectionTitle('Generation by manufacturer · today')}
    <tr><td colspan="4" style="padding:0 22px 6px;">
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;font-size:13px;">
        <tr style="color:#94a3b8;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;">
          <td style="padding:6px 0;">Manufacturer</td>
          <td style="padding:6px 0;text-align:right;">Online</td>
          <td style="padding:6px 0;text-align:right;">Today</td>
          <td style="padding:6px 0;text-align:right;">Saved</td>
        </tr>
        ${oemRows}
      </table>
    </td></tr>`;

  // Top sites.
  const topRows = topSites.map((st, i) => {
    const today = st.live?.today_kwh ?? 0;
    const cap = capacityKw(st);
    return `
    <tr style="border-top:1px solid #eef2f7;">
      <td style="padding:9px 0;color:#0f172a;font-weight:600;">
        <span style="color:#94a3b8;font-weight:700;margin-right:8px;">${i + 1}</span>${esc(st.name)}
        ${st.location ? `<span style="color:#94a3b8;font-weight:500;font-size:11px;"> · ${esc(st.location)}</span>` : ''}
      </td>
      <td style="padding:9px 0;text-align:right;color:#475569;">${cap > 0 ? `${cap.toFixed(0)} kWp` : '—'}</td>
      <td style="padding:9px 0;text-align:right;color:#0f172a;font-weight:700;">${esc(fmtKwh(today))}</td>
    </tr>`;
  }).join('');

  const topSection = topSites.length ? `
    ${sectionTitle('Top performing sites · today')}
    <tr><td colspan="4" style="padding:0 22px 6px;">
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;font-size:13px;">
        <tr style="color:#94a3b8;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;">
          <td style="padding:6px 0;">Site</td>
          <td style="padding:6px 0;text-align:right;">Capacity</td>
          <td style="padding:6px 0;text-align:right;">Today</td>
        </tr>
        ${topRows}
      </table>
    </td></tr>` : '';

  // Alerts.
  const alertItems = alerts.slice(0, 6).map(a => `
    <tr style="border-top:1px solid #eef2f7;">
      <td style="padding:10px 0;vertical-align:top;width:10px;"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${SEV_HEX[a.severity]};"></span></td>
      <td style="padding:10px 8px;vertical-align:top;">
        <div style="font-size:13px;font-weight:700;color:#0f172a;">${esc(a.title)}</div>
        <div style="font-size:11px;color:#94a3b8;margin-top:2px;">${esc(a.stationName)} &middot; ${esc(CATEGORY_META[a.category].label)} &middot; ${esc(sinceLabel(a.since))}</div>
      </td>
      <td style="padding:10px 0;text-align:right;vertical-align:top;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.5px;color:${SEV_HEX[a.severity]};">${esc(SEVERITY_META[a.severity].label)}</td>
    </tr>`).join('');

  const moreAlerts = alerts.length > 6
    ? `<tr><td colspan="4" style="padding:10px 22px;text-align:center;font-size:12px;color:#64748b;">+ ${alerts.length - 6} more in the Alert Centre</td></tr>`
    : '';

  const alertsSection = `
    ${sectionTitle(`Alerts · ${c.critical} critical, ${c.warning} warning`)}
    <tr><td colspan="4" style="padding:0 22px 6px;">
      ${alerts.length === 0
        ? `<div style="padding:16px;text-align:center;color:#16a34a;font-weight:700;font-size:14px;background:#f0fdf4;border-radius:10px;">All clear — every site is online and generating as expected.</div>`
        : `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">${alertItems}</table>`}
    </td></tr>
    ${moreAlerts}`;

  const inner = `
  <div style="max-width:660px;margin:0 auto;padding:24px;">
    <div style="background:#0f172a;border-radius:14px 14px 0 0;padding:24px;">
      ${logoSrc
        ? `<img src="${logoSrc}" width="150" height="41" alt="Changa Energy" style="display:block;border:0;outline:none;height:41px;width:auto;" />`
        : `<div style="color:#fff;font-size:19px;font-weight:800;letter-spacing:.5px;">CHANGA <span style="color:#17a655;">ENERGY</span></div>`}
      <div style="color:#cbd5e1;font-size:13px;margin-top:12px;">Daily Fleet Report &middot; ${esc(data.date)}</div>
    </div>
    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;background:#fff;border-radius:0 0 14px 14px;overflow:hidden;">
      <tr><td colspan="4" style="height:18px;"></td></tr>
      ${summaryRow}
      ${statusRow}
      ${moneyRow}
      ${oemSection}
      ${topSection}
      ${alertsSection}
      <tr><td colspan="4" style="height:10px;"></td></tr>
    </table>
    <div style="color:#94a3b8;font-size:11px;text-align:center;margin-top:18px;line-height:1.6;">
      Generated ${esc(data.generatedAt)} &middot; Changa OneView<br/>
      Energy is metered live from each OEM portal. Rand and carbon figures are labelled estimates.
    </div>
  </div>`;

  const printChrome = mode === 'print' ? `
  <div class="ov-toolbar" style="position:sticky;top:0;z-index:10;background:#0f172a;padding:12px 24px;display:flex;align-items:center;justify-content:space-between;">
    <span style="color:#cbd5e1;font-size:13px;">Use your browser's print dialog to save this report as PDF.</span>
    <button onclick="window.print()" style="background:#17a655;color:#fff;border:0;border-radius:8px;padding:9px 16px;font-size:13px;font-weight:700;cursor:pointer;">Save as PDF</button>
  </div>` : '';

  const printStyle = mode === 'print' ? `
  <style>
    @media print { .ov-toolbar { display:none !important; } body { background:#fff !important; } }
    @page { margin: 14mm; }
  </style>
  <script>window.addEventListener('load', function(){ setTimeout(function(){ window.print(); }, 350); });</script>` : '';

  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Changa Energy — Daily Fleet Report</title>${printStyle}</head>
<body style="margin:0;background:#f1f5f9;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
${printChrome}${inner}
</body></html>`;
}

async function buildData(): Promise<ReportData> {
  const stations = await loadStations();
  const now = new Date();
  const alerts = buildAlerts(stations, now);
  const date = now.toLocaleDateString('en-ZA', { timeZone: 'Africa/Johannesburg', day: 'numeric', month: 'long', year: 'numeric' });
  const generatedAt = now.toLocaleTimeString('en-ZA', { timeZone: 'Africa/Johannesburg', hour: '2-digit', minute: '2-digit' }) + ' SAST';
  return { stations, alerts, date, generatedAt };
}

export async function buildOneViewReport(mode: Mode = 'email') {
  const data = await buildData();
  // Browser-rendered paths (live preview + print-to-PDF) take the crisp vector.
  const html = renderReportHtml(data, mode, changaLogoSvgDataUri());
  return { html, date: data.date, summary: summarise(data.stations), counts: alertCounts(data.alerts) };
}

export async function sendOneViewReport() {
  if (!process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY is not configured');

  const db = getDashboardClient();
  const { data: recipients } = await db
    .from('report_recipients')
    .select('email, label')
    .eq('active', true)
    .order('created_at');

  if (!recipients?.length) throw new Error('No active recipients configured');

  const data = await buildData();
  const s = summarise(data.stations);

  // Inline the Changa logo as a CID attachment — Gmail renders neither SVG nor
  // data-URI images in a message body, so the wordmark must travel as an attached
  // PNG. If rasterising fails, fall back to the text wordmark so the report still goes.
  let logoPng: Buffer | null = null;
  try {
    logoPng = await changaLogoPng();
  } catch {
    logoPng = null;
  }
  const html = renderReportHtml(data, 'email', logoPng ? 'cid:changa-logo' : null);

  const resend = new Resend(process.env.RESEND_API_KEY);
  const from = process.env.RESEND_FROM ?? 'Changa Energy <reports@aksenos.com>';
  const replyTo = process.env.RESEND_REPLY_TO;
  const toList = recipients.map(r => (r.label ? `${r.label} <${r.email}>` : r.email));
  const subject = `Changa Energy — Daily Fleet Report · ${fmtKwh(s.todayKwh)} today, ${randCompact(s.moneyToday.savings)} saved · ${data.date}`;

  const { data: sent, error } = await resend.emails.send({
    from,
    to: toList,
    ...(replyTo ? { reply_to: replyTo } : {}),
    subject,
    html,
    ...(logoPng ? { attachments: [{ filename: 'changa-logo.png', content: logoPng, contentId: 'changa-logo' }] } : {}),
  });

  if (error) throw new Error(error.message);
  return { sent: toList.length, id: sent?.id };
}
