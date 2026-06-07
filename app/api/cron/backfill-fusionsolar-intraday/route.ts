import { NextRequest, NextResponse } from 'next/server';
import {
  FusionSolarClient,
  loadFusionSolarEnv,
  STATIONS,
  getStationKpiHour,
  CALL_DELAY,
} from '@/lib/fusionsolar';
import { upsertFusionSolarHourlyReadings } from '@/lib/db';

// Earliest date with confirmed FusionSolar data (commissioning)
const COMMISSION_DATE = new Date('2026-03-01T00:00:00Z');

// Budget: ~50s per invocation at 1.5s/call — leave headroom for login + DB writes
const MAX_RUN_MS = 45_000;

export const maxDuration = 120;

function verifyCronSecret(req: NextRequest): boolean {
  return req.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`;
}

export async function GET(req: NextRequest) {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url    = new URL(req.url);
  const dateParam = url.searchParams.get('date');

  // Start from yesterday if no cursor provided
  const startAnchor = dateParam
    ? new Date(dateParam + 'T12:00:00Z')
    : new Date(Date.now() - 86_400_000);
  startAnchor.setUTCHours(12, 0, 0, 0);

  const { username, password, baseUrl } = loadFusionSolarEnv();
  const client = new FusionSolarClient(username, password, baseUrl);

  const loginOk = await client.login();
  if (!loginOk) {
    return NextResponse.json({ ok: false, error: 'FusionSolar login failed' }, { status: 500 });
  }
  await client.sleep(CALL_DELAY * 2);

  const codes    = STATIONS.map(s => s.code);
  let anchor     = new Date(startAnchor);
  let totalRows  = 0;
  let daysProcessed = 0;
  const runStart = Date.now();

  while (anchor >= COMMISSION_DATE && Date.now() - runStart < MAX_RUN_MS) {
    const records = await getStationKpiHour(client, codes, new Date(anchor));
    if (records.length > 0) {
      const { written } = await upsertFusionSolarHourlyReadings(records);
      totalRows += written;
    }
    daysProcessed++;

    // Step back one day
    anchor = new Date(anchor.getTime() - 86_400_000);
    anchor.setUTCHours(12, 0, 0, 0);

    await client.sleep(CALL_DELAY);
  }

  const done     = anchor < COMMISSION_DATE;
  const nextDate = done ? null : anchor.toISOString().slice(0, 10);

  return NextResponse.json({
    ok: true,
    done,
    nextDate,
    daysProcessed,
    totalRows,
    message: done
      ? `Backfill complete — all FusionSolar hourly history loaded (${totalRows} rows).`
      : `Partial run (${daysProcessed} days, ${totalRows} rows). Call again with ?date=${nextDate} to continue.`,
  });
}
