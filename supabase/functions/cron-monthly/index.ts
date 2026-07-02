/**
 * cron-monthly — runs daily at midnight UTC
 * LIVOLTEK monthly KPIs (derived from live data) → station_kpi_month
 *
 * FusionSolar monthly KPIs were REMOVED July 2026: Huawei IP-blocks Supabase
 * (disguised 20400 "invalid credentials"), so the fetch failed every night.
 * They now ride along with the GitHub Actions rollup job
 * (scripts/fusionsolar-worker.ts --mode rollup), which runs 2×/day from the
 * only unblocked IP range. Do NOT re-add FusionSolar calls here.
 */
import {
  LivoltkClient, loadLivoltkEnv, getAllSitesLive,
  upsertLivoltkKpiMonth, logRefresh,
} from './_shared/index.ts';

Deno.serve(async (_req: Request) => {
  const startedAt  = new Date();
  const yearMonth  = new Date().toISOString().slice(0, 7); // "YYYY-MM"

  let lvResult = { ok: 0, errors: 0 };

  // ── LIVOLTEK monthly KPIs (derived from live data) ──────────────────────────
  try {
    const { email, password, accountType } = loadLivoltkEnv();
    const client  = new LivoltkClient(email, password, accountType);
    const loginOk = await client.login();
    if (!loginOk) throw new Error('LIVOLTEK login failed');

    const sites  = await getAllSitesLive(client);
    await upsertLivoltkKpiMonth(sites, yearMonth);
    const ok     = sites.filter(s => !s._error).length;
    const errors = sites.filter(s =>  s._error).length;
    lvResult = { ok, errors };
    await logRefresh({ source: 'livoltek', jobType: 'monthly', stationsOk: ok, stationsError: errors, startedAt });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error('LIVOLTEK monthly job failed:', detail);
    lvResult = { ok: 0, errors: 16 };
    await logRefresh({ source: 'livoltek', jobType: 'monthly', stationsOk: 0, stationsError: 16, errorDetail: detail, startedAt });
  }

  return new Response(JSON.stringify({ ok: true, livoltek: lvResult }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
