/**
 * cron-live — runs every 5 minutes
 * Fetches live power telemetry from LIVOLTEK only.
 * FusionSolar live is handled by Vercel cron (Huawei blocks Supabase EU West IPs).
 */
import {
  LivoltkClient, loadLivoltkEnv, getAllSitesLive,
  upsertLivoltkLive, logRefresh,
} from './_shared/index.ts';

Deno.serve(async (_req: Request) => {
  const startedAt = new Date();

  try {
    const { email, password, accountType } = loadLivoltkEnv();
    const client  = new LivoltkClient(email, password, accountType);
    const loginOk = await client.login();
    if (!loginOk) throw new Error('LIVOLTEK login failed');

    const data = await getAllSitesLive(client);
    const r    = await upsertLivoltkLive(data);
    await logRefresh({ source: 'livoltek', jobType: 'live', stationsOk: r.ok, stationsError: r.errors, startedAt });

    return new Response(JSON.stringify({ ok: true, livoltek: r }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error('LIVOLTEK live job failed:', detail);
    await logRefresh({ source: 'livoltek', jobType: 'live', stationsOk: 0, stationsError: 16, errorDetail: detail, startedAt });

    return new Response(JSON.stringify({ ok: false, error: detail }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
