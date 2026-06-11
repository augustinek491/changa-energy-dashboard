// Changa OneView — pre-demo / ops health check.
//   GET → one JSON verdict: is data flowing from both OEM portals, how fresh
//   are the live readings, and is the email pipeline configured + recently OK?
// Run this an hour before any demo (see DEMO-RUNBOOK.md). No secrets returned.

import { NextResponse } from 'next/server';
import { getDashboardClient } from '@/lib/supabase-dashboard';

export const dynamic = 'force-dynamic';

const minutesAgo = (iso: string | null): number | null =>
  iso ? Math.round((Date.now() - new Date(iso).getTime()) / 60000) : null;

export async function GET() {
  const db = getDashboardClient();

  // Last successful poller run per OEM source.
  async function lastOk(source: string) {
    const { data } = await db
      .from('refresh_log')
      .select('started_at')
      .eq('source', source)
      .is('error_detail', null)
      .order('started_at', { ascending: false })
      .limit(1);
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

  const [livoltekAt, fusionsolarAt, lastEmail, liveRow, recipientsRes] = await Promise.all([
    lastOk('livoltek'),
    lastOk('fusionsolar'),
    lastEmailJob(),
    db.from('station_live').select('fetched_at').order('fetched_at', { ascending: false }).limit(1),
    db.from('report_recipients').select('*', { count: 'exact', head: true }).eq('active', true),
  ]);

  const lastReadingAt = liveRow.data?.[0]?.fetched_at ?? null;

  const checks = {
    livoltek: { lastOkAt: livoltekAt, minutesAgo: minutesAgo(livoltekAt), ok: (minutesAgo(livoltekAt) ?? Infinity) <= 20 },
    fusionsolar: { lastOkAt: fusionsolarAt, minutesAgo: minutesAgo(fusionsolarAt), ok: (minutesAgo(fusionsolarAt) ?? Infinity) <= 45 },
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

  const ready = checks.livoltek.ok && checks.fusionsolar.ok && checks.liveData.ok && checks.email.ok;

  return NextResponse.json({
    verdict: ready ? 'ready' : 'check',
    now: new Date().toISOString(),
    checks,
  });
}
