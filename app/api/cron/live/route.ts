import { NextRequest, NextResponse } from 'next/server';
import {
  FusionSolarClient,
  loadFusionSolarEnv,
  STATIONS,
  fetchDashboardData,
  CALL_DELAY,
} from '@/lib/fusionsolar';
import { LivoltkClient, loadLivoltkEnv, getAllSitesLive } from '@/lib/livoltek';
import {
  upsertFusionSolarLive,
  upsertLivoltkLive,
  logRefresh,
} from '@/lib/db';

// FusionSolar live job takes ~45–60 seconds. Requires Pro plan on Vercel for >10s.
export const maxDuration = 120;

function verifyCronSecret(req: NextRequest): boolean {
  const auth = req.headers.get('authorization');
  return auth === `Bearer ${process.env.CRON_SECRET}`;
}

export async function GET(req: NextRequest) {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const startedAt = new Date();
  const results: {
    fusionsolar: { ok: number; errors: number } | null;
    livoltek: { ok: number; errors: number } | null;
  } = { fusionsolar: null, livoltek: null };

  // ── FusionSolar live job ──────────────────────────────────────────────────────
  try {
    const { username, password, baseUrl } = loadFusionSolarEnv();
    const client = new FusionSolarClient(username, password, baseUrl);

    const loginOk = await client.login();
    if (!loginOk) throw new Error('FusionSolar login failed');

    // Extra pause after login to clear residual throttle
    await client.sleep(CALL_DELAY * 2);

    // fetchDashboardData handles the mandatory call order internally:
    // getStationRealKpis (batch) → per-station device loop
    const data = await fetchDashboardData(client, STATIONS);

    const items = data.map((record, i) => ({
      stationCode: STATIONS[i].code,
      record,
    }));

    const r = await upsertFusionSolarLive(items);
    results.fusionsolar = r;

    await logRefresh({
      source: 'fusionsolar',
      jobType: 'live',
      stationsOk: r.ok,
      stationsError: r.errors,
      startedAt,
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error('FusionSolar live job failed:', detail);
    results.fusionsolar = { ok: 0, errors: STATIONS.length };
    await logRefresh({
      source: 'fusionsolar',
      jobType: 'live',
      stationsOk: 0,
      stationsError: STATIONS.length,
      errorDetail: detail,
      startedAt,
    });
  }

  // ── LIVOLTEK live job ─────────────────────────────────────────────────────────
  try {
    const { email, password, accountType } = loadLivoltkEnv();
    const client = new LivoltkClient(email, password, accountType);

    // Pre-login once before concurrent calls — getAllSitesLive fires 16 requests
    // simultaneously; without this each would race to call ensureAuth and trigger
    // 16 concurrent logins, causing the portal to rate-limit most of them.
    const loginOk = await client.login();
    if (!loginOk) throw new Error('LIVOLTEK login failed');

    const data = await getAllSitesLive(client);
    const r = await upsertLivoltkLive(data);
    results.livoltek = r;

    await logRefresh({
      source: 'livoltek',
      jobType: 'live',
      stationsOk: r.ok,
      stationsError: r.errors,
      startedAt,
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error('LIVOLTEK live job failed:', detail);
    results.livoltek = { ok: 0, errors: 16 };
    await logRefresh({
      source: 'livoltek',
      jobType: 'live',
      stationsOk: 0,
      stationsError: 16,
      errorDetail: detail,
      startedAt,
    });
  }

  return NextResponse.json({ ok: true, ...results });
}
