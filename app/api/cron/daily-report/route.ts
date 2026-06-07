import { NextRequest, NextResponse } from 'next/server';
import { getDashboardClient } from '@/lib/supabase-dashboard';
import { sendFleetReport } from '@/lib/email-report';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = getDashboardClient();
  const startedAt = new Date().toISOString();

  try {
    const result = await sendFleetReport('daily');

    await db.from('refresh_log').insert({
      source: 'email',
      job_type: 'daily_report',
      stations_ok: result.sent,
      stations_error: 0,
      started_at: startedAt,
    });

    return NextResponse.json({ ok: true, sent: result.sent, id: result.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';

    await db.from('refresh_log').insert({
      source: 'email',
      job_type: 'daily_report',
      stations_ok: 0,
      stations_error: 1,
      error_detail: message,
      started_at: startedAt,
    });

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
