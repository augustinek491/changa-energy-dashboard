import { NextRequest, NextResponse } from 'next/server';
import { cleanupRefreshLog } from '@/lib/db';

export const maxDuration = 30;

function verifyCronSecret(req: NextRequest): boolean {
  return req.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`;
}

export async function GET(req: NextRequest) {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { deleted } = await cleanupRefreshLog(90);
  return NextResponse.json({ ok: true, deletedRefreshLogRows: deleted });
}
