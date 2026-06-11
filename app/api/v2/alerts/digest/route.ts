// Changa OneView — alert digest endpoint.
//   GET ?preview=1            → renders the digest HTML (no send) for verification
//   GET ?preview=alarm        → renders the single-alarm notification HTML (no send)
//   GET (Bearer CRON_SECRET)  → builds + emails the digest to active recipients
//   POST {to, kind}           → demo/test send to ONE address only; kind 'digest'
//                               or 'alarm' (single-alarm notification email);
//                               rate-limited, never touches the recipient list
// The daily cron points a Vercel schedule at this route with the CRON_SECRET.

import { NextRequest, NextResponse } from 'next/server';
import { getDashboardClient } from '@/lib/supabase-dashboard';
import { buildDigest, sendAlertDigest, buildAlarmNotification, sendAlarmNotification } from '@/lib/v2/alert-email';
import { isValidEmail, testSendsRemaining, TEST_SEND_LIMIT } from '@/lib/v2/test-send-guard';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  // Preview paths: render the same HTML the emails would carry, without sending.
  const preview = req.nextUrl.searchParams.get('preview');
  if (preview === '1' || preview === 'alarm') {
    const { html } = preview === 'alarm' ? await buildAlarmNotification() : await buildDigest();
    return new NextResponse(html, {
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  }

  // Send path: guarded by the shared cron secret.
  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = getDashboardClient();
  const startedAt = new Date().toISOString();

  try {
    const result = await sendAlertDigest();

    await db.from('refresh_log').insert({
      source: 'email',
      job_type: 'alert_digest',
      stations_ok: result.sent,
      stations_error: 0,
      started_at: startedAt,
    });

    return NextResponse.json({ ok: true, sent: result.sent, id: result.id, counts: result.counts });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';

    await db.from('refresh_log').insert({
      source: 'email',
      job_type: 'alert_digest',
      stations_ok: 0,
      stations_error: 1,
      error_detail: message,
      started_at: startedAt,
    });

    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const to = typeof body?.to === 'string' ? body.to.trim() : '';
  const kind = body?.kind === 'alarm' ? 'alarm' : 'digest';
  if (!isValidEmail(to)) {
    return NextResponse.json({ error: 'Enter a valid email address' }, { status: 400 });
  }

  const db = getDashboardClient();
  if ((await testSendsRemaining(db)) <= 0) {
    return NextResponse.json(
      { error: `Test-send limit reached (${TEST_SEND_LIMIT}/hour). Try again later.` },
      { status: 429 },
    );
  }

  const startedAt = new Date().toISOString();
  const jobType = kind === 'alarm' ? 'test_alarm' : 'test_digest';
  try {
    const result = kind === 'alarm'
      ? await sendAlarmNotification([{ email: to }])
      : await sendAlertDigest([{ email: to }]);

    await db.from('refresh_log').insert({
      source: 'email',
      job_type: jobType,
      stations_ok: 1,
      stations_error: 0,
      started_at: startedAt,
    });

    return NextResponse.json({
      ok: true,
      id: result.id,
      ...('simulated' in result ? { simulated: result.simulated, alert: result.alertTitle } : {}),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';

    await db.from('refresh_log').insert({
      source: 'email',
      job_type: jobType,
      stations_ok: 0,
      stations_error: 1,
      error_detail: message,
      started_at: startedAt,
    });

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
