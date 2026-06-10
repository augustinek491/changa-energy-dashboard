// Changa OneView — daily fleet report endpoint.
//   GET ?preview=1            → renders the report HTML (no send) for verification
//   GET ?pdf=1                → renders the print-ready page (auto-opens print → Save as PDF)
//   GET (Bearer CRON_SECRET)  → builds + emails the report to active recipients
// The daily cron points a Vercel schedule at this route with the CRON_SECRET.

import { NextRequest, NextResponse } from 'next/server';
import { getDashboardClient } from '@/lib/supabase-dashboard';
import { buildOneViewReport, sendOneViewReport } from '@/lib/v2/report';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;

  // Preview / PDF paths: render the same HTML the email carries, without sending.
  if (params.get('preview') === '1' || params.get('pdf') === '1') {
    const { html } = await buildOneViewReport(params.get('pdf') === '1' ? 'print' : 'email');
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
    const result = await sendOneViewReport();

    await db.from('refresh_log').insert({
      source: 'email',
      job_type: 'fleet_report',
      stations_ok: result.sent,
      stations_error: 0,
      started_at: startedAt,
    });

    return NextResponse.json({ ok: true, sent: result.sent, id: result.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';

    await db.from('refresh_log').insert({
      source: 'email',
      job_type: 'fleet_report',
      stations_ok: 0,
      stations_error: 1,
      error_detail: message,
      started_at: startedAt,
    });

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
