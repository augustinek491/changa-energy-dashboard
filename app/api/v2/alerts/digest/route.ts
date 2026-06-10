// Changa OneView — alert digest endpoint.
//   GET ?preview=1            → renders the digest HTML (no send) for verification
//   GET (Bearer CRON_SECRET)  → builds + emails the digest to active recipients
// The daily cron points a Vercel schedule at this route with the CRON_SECRET.

import { NextRequest, NextResponse } from 'next/server';
import { getDashboardClient } from '@/lib/supabase-dashboard';
import { buildDigest, sendAlertDigest } from '@/lib/v2/alert-email';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  // Preview path: render the same HTML the email would carry, without sending.
  if (req.nextUrl.searchParams.get('preview') === '1') {
    const { html } = await buildDigest();
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
