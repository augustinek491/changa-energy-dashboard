import { NextRequest, NextResponse } from 'next/server';
import { getDashboardClient } from '@/lib/supabase-dashboard';

export const dynamic = 'force-dynamic';

export async function GET() {
  const db = getDashboardClient();
  const { data, error } = await db
    .from('report_recipients')
    .select('id, email, label, active, created_at')
    .order('created_at');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { email, label } = body as { email?: string; label?: string };
  if (!email?.trim()) return NextResponse.json({ error: 'email required' }, { status: 400 });

  const db = getDashboardClient();
  const { data, error } = await db
    .from('report_recipients')
    .insert({ email: email.trim(), label: label?.trim() || null })
    .select('id, email, label, active, created_at')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const db = getDashboardClient();
  const { error } = await db.from('report_recipients').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
