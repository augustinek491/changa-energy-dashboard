// FusionSolar live data cron
//
// WHY THIS IS ON VERCEL AND NOT SUPABASE:
// Huawei's API blocks Supabase EU West (Ireland) IPs at the application layer.
// It returns HTTP 200 with failCode=20400 ("user_or_value_invalid") — a
// deliberately misleading response that is actually an IP block. The same
// credentials work fine from local machines and Vercel (AWS IPs).
// LIVOLTEK is unaffected and stays on Supabase Edge Functions.
//
// ─────────────────────────────────────────────────────────────────────────────
// BATCHING PATTERN
// ─────────────────────────────────────────────────────────────────────────────
// Huawei enforces ~1 req/sec per account. Each plant needs 4–5 sequential API
// calls with 1.5s delays → ~7–8 seconds per plant. Measured: 2 plants ≈ 20s,
// 4 plants ≈ 104s (exceeds Vercel Hobby's 60s limit). Default BATCH_SIZE=2.
//
// Each batch is a separate Vercel cron entry in vercel.json, staggered by
// 2 minutes so back-to-back batches don't overlap and hit Huawei's rate limit.
//
// ─────────────────────────────────────────────────────────────────────────────
// SCALING GUIDE — how to add a new plant
// ─────────────────────────────────────────────────────────────────────────────
// 1. Add the new station to STATIONS in lib/fusionsolar.ts (append to end).
//    Order determines batch assignment — do not reorder existing stations.
//
// 2. Check if a new batch is needed:
//      new_batch_index = Math.floor((STATIONS.length - 1) / BATCH_SIZE)
//    If that batch index already has a cron entry → done, no config change.
//    If it's a new batch index → add a new entry to vercel.json.
//
// 3. Cron schedule formula (stagger = batchIndex × 2 minutes):
//
//    batch 0  → "*/15 * * * *"        runs at :00, :15, :30, :45
//    batch 1  → "2-59/15 * * * *"     runs at :02, :17, :32, :47
//    batch 2  → "4-59/15 * * * *"     runs at :04, :19, :34, :49
//    batch 3  → "6-59/15 * * * *"     runs at :06, :21, :36, :51
//    batch N  → "{N*2}-59/15 * * * *"  (N=0 → "*/15 * * * *" as special case)
//
//    NOTE: in vercel.json, write batch 0 as "*/15 * * * *" — the N*2 formula
//    only applies from batch 1 onwards.
//
// CAPACITY at 15-min cycle (BATCH_SIZE=2, Hobby plan):
//   7 batches × 2 plants = 14 plants max
//   If on Vercel Pro (300s limit): raise BATCH_SIZE to 4 → 7 batches × 4 = 28 plants
//   For 28+ plants on Pro: change ALL schedules to every 30 min → 14 batches × 4 = 56 plants
//
// CURRENT SETUP (June 2026):
//   5 plants → 3 batches (batch 0: plants 0–1, batch 1: plants 2–3, batch 2: plant 4)
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import {
  FusionSolarClient,
  loadFusionSolarEnv,
  STATIONS,
  CALL_DELAY,
  fetchDashboardData,
} from '@/lib/fusionsolar';
import { upsertFusionSolarLive, logRefresh } from '@/lib/db';

export const maxDuration = 55; // Vercel Hobby-safe (Hobby cap = 60s; 4 plants ≈ 32s)

const BATCH_SIZE = parseInt(process.env.FUSIONSOLAR_BATCH_SIZE ?? '2', 10);

function verifyCronSecret(req: NextRequest): boolean {
  return req.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`;
}

export async function GET(req: NextRequest) {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const batch         = Math.max(0, parseInt(req.nextUrl.searchParams.get('batch') ?? '0', 10));
  const batchStart    = batch * BATCH_SIZE;
  const batchStations = STATIONS.slice(batchStart, batchStart + BATCH_SIZE);

  if (batchStations.length === 0) {
    return NextResponse.json({
      ok:      true,
      skipped: true,
      reason:  `batch ${batch} out of range (${STATIONS.length} plants, batch size ${BATCH_SIZE})`,
    });
  }

  const startedAt = new Date();

  try {
    const { username, password, baseUrl } = loadFusionSolarEnv();
    const client = new FusionSolarClient(username, password, baseUrl);

    const loginOk = await client.login();
    if (!loginOk) throw new Error('FusionSolar login failed');
    await client.sleep(CALL_DELAY * 2);

    const data  = await fetchDashboardData(client, batchStations);
    const items = data.map((record, i) => ({ stationCode: batchStations[i].code, record }));
    const r     = await upsertFusionSolarLive(items);

    await logRefresh({
      source:        'fusionsolar',
      jobType:       'live',
      stationsOk:    r.ok,
      stationsError: r.errors,
      startedAt,
    });

    return NextResponse.json({
      ok:        true,
      batch,
      stations:  batchStations.map(s => s.name),
      ok_count:  r.ok,
      err_count: r.errors,
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    await logRefresh({
      source:        'fusionsolar',
      jobType:       'live',
      stationsOk:    0,
      stationsError: batchStations.length,
      errorDetail:   detail,
      startedAt,
    });
    return NextResponse.json({ ok: false, batch, error: detail }, { status: 500 });
  }
}
