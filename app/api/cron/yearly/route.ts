import { NextRequest, NextResponse } from 'next/server';
import { FusionSolarClient, loadFusionSolarEnv, STATIONS, getStationKpiYear, CALL_DELAY } from '@/lib/fusionsolar';
import { upsertFusionSolarKpiYear, logRefresh } from '@/lib/db';

export const maxDuration = 60;

function verifyCronSecret(req: NextRequest): boolean {
  return req.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`;
}

export async function GET(req: NextRequest) {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const startedAt = new Date();

  try {
    const { username, password, baseUrl } = loadFusionSolarEnv();
    const client = new FusionSolarClient(username, password, baseUrl);
    await client.login();
    await client.sleep(CALL_DELAY * 2);

    const codes = STATIONS.map(s => s.code);
    const records = await getStationKpiYear(client, codes);
    await upsertFusionSolarKpiYear(records);

    await logRefresh({ source: 'fusionsolar', jobType: 'yearly', stationsOk: records.length, stationsError: 0, startedAt });

    return NextResponse.json({ ok: true, fusionsolar: { ok: records.length, errors: 0 } });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error('FusionSolar yearly job failed:', detail);
    await logRefresh({ source: 'fusionsolar', jobType: 'yearly', stationsOk: 0, stationsError: STATIONS.length, errorDetail: detail, startedAt });
    return NextResponse.json({ ok: false, error: detail }, { status: 500 });
  }
}
