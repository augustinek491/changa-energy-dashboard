/**
 * cron-yearly — runs on the 1st of each month at 02:00 UTC
 * Cleanup refresh_log rows older than 90 days.
 *
 * FusionSolar yearly KPIs were REMOVED July 2026: Huawei IP-blocks Supabase
 * (disguised 20400), so the fetch could never succeed from here — it also
 * silently "passed" because the login() return value was never checked. They
 * now ride along with the GitHub Actions rollup job
 * (scripts/fusionsolar-worker.ts --mode rollup), which runs 2×/day from the
 * only unblocked IP range. Do NOT re-add FusionSolar calls here.
 */
import { cleanupRefreshLog } from './_shared/index.ts';

Deno.serve(async (_req: Request) => {
  // ── Cleanup old refresh_log rows ────────────────────────────────────────────
  let cleanupResult: { deleted: number } | null = null;
  try {
    cleanupResult = await cleanupRefreshLog(90);
  } catch (err) {
    console.error('Cleanup job failed:', err instanceof Error ? err.message : String(err));
  }

  return new Response(JSON.stringify({ ok: true, cleanup: cleanupResult }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
