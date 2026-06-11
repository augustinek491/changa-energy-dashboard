// Changa OneView — pre-demo / ops health check.
//   GET → one JSON verdict: is data flowing from both OEM portals, how fresh
//   are the live readings, and is the email pipeline configured + recently OK?
// Run this an hour before any demo (see DEMO-RUNBOOK.md). No secrets returned.

import { NextResponse } from 'next/server';
import { getDashboardClient } from '@/lib/supabase-dashboard';

export const dynamic = 'force-dynamic';

const minutesAgo = (iso: string | null): number | null =>
  iso ? Math.round((Date.now() - new Date(iso).getTime()) / 60000) : null;

const sastHour = (d: Date): number =>
  Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Johannesburg', hour: 'numeric', hour12: false }).format(d));

export async function GET() {
  const db = getDashboardClient();

  // Last successful poller run per OEM source, optionally per job type.
  async function lastOk(source: string, jobType?: string) {
    let q = db
      .from('refresh_log')
      .select('started_at')
      .eq('source', source)
      .is('error_detail', null);
    if (jobType) q = q.eq('job_type', jobType);
    const { data } = await q.order('started_at', { ascending: false }).limit(1);
    return data?.[0]?.started_at ?? null;
  }

  // Last emailed report/digest outcome (cron sends, not test sends).
  async function lastEmailJob() {
    const { data } = await db
      .from('refresh_log')
      .select('job_type, started_at, error_detail')
      .eq('source', 'email')
      .in('job_type', ['fleet_report', 'alert_digest'])
      .order('started_at', { ascending: false })
      .limit(1);
    return data?.[0] ?? null;
  }

  const [livoltekAt, fusionsolarAt, powerAt, lastEmail, liveRow, recipientsRes] = await Promise.all([
    lastOk('livoltek'),
    lastOk('fusionsolar'),
    lastOk('fusionsolar', 'power'),
    lastEmailJob(),
    db.from('station_live').select('fetched_at').order('fetched_at', { ascending: false }).limit(1),
    db.from('report_recipients').select('*', { count: 'exact', head: true }).eq('active', true),
  ]);

  const lastReadingAt = liveRow.data?.[0]?.fetched_at ?? null;

  // The 5-min live-power sweep only runs 05:00–19:55 SAST (solar is 0 at night).
  const h = sastHour(new Date());
  const powerWindow = h >= 5 && h < 20;

  const checks = {
    livoltek: { lastOkAt: livoltekAt, minutesAgo: minutesAgo(livoltekAt), ok: (minutesAgo(livoltekAt) ?? Infinity) <= 20 },
    fusionsolar: { lastOkAt: fusionsolarAt, minutesAgo: minutesAgo(fusionsolarAt), ok: (minutesAgo(fusionsolarAt) ?? Infinity) <= 45 },
    fusionsolarPower: {
      lastOkAt: powerAt,
      minutesAgo: minutesAgo(powerAt),
      inWindow: powerWindow,
      ok: !powerWindow || (minutesAgo(powerAt) ?? Infinity) <= 15,
    },
    liveData: { lastReadingAt, minutesAgo: minutesAgo(lastReadingAt), ok: (minutesAgo(lastReadingAt) ?? Infinity) <= 45 },
    email: {
      resendConfigured: Boolean(process.env.RESEND_API_KEY),
      activeRecipients: recipientsRes.count ?? 0,
      lastScheduledSend: lastEmail
        ? { job: lastEmail.job_type, at: lastEmail.started_at, ok: !lastEmail.error_detail }
        : null,
      ok: Boolean(process.env.RESEND_API_KEY),
    },
  };

  const ready = checks.livoltek.ok && checks.fusionsolar.ok && checks.fusionsolarPower.ok
    && checks.liveData.ok && checks.email.ok;

  return NextResponse.json({
    verdict: ready ? 'ready' : 'check',
    now: new Date().toISOString(),
    checks,
  });
}
