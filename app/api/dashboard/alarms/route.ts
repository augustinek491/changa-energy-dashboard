import { NextRequest, NextResponse } from 'next/server';
import { getDashboardClient } from '@/lib/supabase-dashboard';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const showResolved = url.searchParams.get('resolved') === 'true';
  const page = parseInt(url.searchParams.get('page') ?? '1', 10);
  const limit = parseInt(url.searchParams.get('limit') ?? '50', 10);
  const offset = (page - 1) * limit;

  const db = getDashboardClient();

  let query = db
    .from('alarms')
    .select(`
      id,
      alarm_name,
      alarm_code,
      severity,
      cause,
      repair_suggestion,
      raised_at,
      resolved_at,
      stations!inner ( id, name, source )
    `, { count: 'exact' });

  if (!showResolved) {
    query = query.is('resolved_at', null);
  }

  const { data, count, error } = await query
    .order('raised_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const alarms = (data ?? []).map((a: Record<string, unknown>) => {
    const station = a.stations as { id: string; name: string; source: string } | null;
    return {
      id: a.id,
      station_id: station?.id ?? null,
      station_name: station?.name ?? 'Unknown',
      station_source: station?.source ?? null,
      alarm_name: a.alarm_name,
      alarm_code: a.alarm_code,
      severity: a.severity,
      cause: a.cause,
      repair_suggestion: a.repair_suggestion,
      raised_at: a.raised_at,
      resolved_at: a.resolved_at,
    };
  });

  return NextResponse.json({ alarms, total: count ?? 0, page, limit });
}
