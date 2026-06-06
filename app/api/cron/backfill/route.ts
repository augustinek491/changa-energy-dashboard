import { NextRequest, NextResponse } from 'next/server';
import { FusionSolarClient, loadFusionSolarEnv, STATIONS, getStationKpiDay, CALL_DELAY } from '@/lib/fusionsolar';
import { upsertFusionSolarKpiDay } from '@/lib/db';

// Commissioning date — walk backwards from today to this date
const COMMISSION_DATE = new Date('2026-03-01');

// Days per FusionSolar sliding window call
const WINDOW_DAYS = 5;

// Max seconds to spend per invocation before returning a cursor
const MAX_RUN_MS = 50_000;

export const maxDuration = 120;

function verifyCronSecret(req: NextRequest): boolean {
  return req.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`;
}

export async function GET(req: NextRequest) {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  const dateParam = url.searchParams.get('date');

  // Start from yesterday if no cursor provided
  const startAnchor = dateParam
    ? new Date(dateParam)
    : new Date(Date.now() - 86400000);

  const { username, password, baseUrl } = loadFusionSolarEnv();
  const client = new FusionSolarClient(username, password, baseUrl);

  const loginOk = await client.login();
  if (!loginOk) {
    return NextResponse.json({ ok: false, error: 'FusionSolar login failed' }, { status: 500 });
  }
  await client.sleep(CALL_DELAY * 2);

  const codes = STATIONS.map(s => s.code);
  let anchor = new Date(startAnchor);
  let totalRecords = 0;
  let batches = 0;
  const runStart = Date.now();

  while (anchor >= COMMISSION_DATE && Date.now() - runStart < MAX_RUN_MS) {
    anchor.setHours(12, 0, 0, 0);

    const records = await getStationKpiDay(client, codes, new Date(anchor));
    await upsertFusionSolarKpiDay(records);
    totalRecords += records.length;
    batches++;

    // Slide anchor back by WINDOW_DAYS days
    anchor = new Date(anchor.getTime() - WINDOW_DAYS * 86400000);

    await client.sleep(CALL_DELAY);
  }

  const done = anchor < COMMISSION_DATE;
  const nextDate = done ? null : anchor.toISOString().slice(0, 10);

  return NextResponse.json({
    ok: true,
    done,
    nextDate,
    batches,
    totalRecords,
    message: done
      ? 'Backfill complete — all FusionSolar history loaded.'
      : `Partial run. Call again with ?date=${nextDate} to continue.`,
  });
}
