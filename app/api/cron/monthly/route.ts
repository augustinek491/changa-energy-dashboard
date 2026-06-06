import { NextRequest, NextResponse } from 'next/server';
import { FusionSolarClient, loadFusionSolarEnv, STATIONS, getStationKpiMonth, CALL_DELAY } from '@/lib/fusionsolar';
import { LivoltkClient, loadLivoltkEnv, getAllSitesLive } from '@/lib/livoltek';
import { upsertFusionSolarKpiMonth, upsertLivoltkKpiMonth, logRefresh } from '@/lib/db';

export const maxDuration = 120;

function verifyCronSecret(req: NextRequest): boolean {
  return req.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`;
}

export async function GET(req: NextRequest) {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const startedAt = new Date();
  const yearMonth = new Date().toISOString().slice(0, 7);

  // ── FusionSolar monthly KPIs ──────────────────────────────────────────────────
  let fsResult = { ok: 0, errors: 0 };
  try {
    const { username, password, baseUrl } = loadFusionSolarEnv();
    const client = new FusionSolarClient(username, password, baseUrl);
    await client.login();
    await client.sleep(CALL_DELAY * 2);

    const codes = STATIONS.map(s => s.code);
    const records = await getStationKpiMonth(client, codes);
    await upsertFusionSolarKpiMonth(records);
    fsResult = { ok: records.length, errors: 0 };

    await logRefresh({ source: 'fusionsolar', jobType: 'monthly', stationsOk: records.length, stationsError: 0, startedAt });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error('FusionSolar monthly job failed:', detail);
    fsResult = { ok: 0, errors: STATIONS.length };
    await logRefresh({ source: 'fusionsolar', jobType: 'monthly', stationsOk: 0, stationsError: STATIONS.length, errorDetail: detail, startedAt });
  }

  // ── LIVOLTEK monthly KPIs (derived from live data) ────────────────────────────
  let lvResult = { ok: 0, errors: 0 };
  try {
    const { email, password, accountType } = loadLivoltkEnv();
    const client = new LivoltkClient(email, password, accountType);
    const loginOk = await client.login();
    if (!loginOk) throw new Error('LIVOLTEK login failed');
    const sites = await getAllSitesLive(client);
    await upsertLivoltkKpiMonth(sites, yearMonth);
    const ok = sites.filter(s => !s._error).length;
    const errors = sites.filter(s => s._error).length;
    lvResult = { ok, errors };

    await logRefresh({ source: 'livoltek', jobType: 'monthly', stationsOk: ok, stationsError: errors, startedAt });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error('LIVOLTEK monthly job failed:', detail);
    lvResult = { ok: 0, errors: 16 };
    await logRefresh({ source: 'livoltek', jobType: 'monthly', stationsOk: 0, stationsError: 16, errorDetail: detail, startedAt });
  }

  return NextResponse.json({ ok: true, fusionsolar: fsResult, livoltek: lvResult });
}
