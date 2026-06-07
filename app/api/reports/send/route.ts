import { NextResponse } from 'next/server';
import { sendFleetReport } from '@/lib/email-report';

export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    const result = await sendFleetReport('snapshot');
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
