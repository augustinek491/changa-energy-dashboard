/**
 * scripts/check-huawei-latest.ts  — READ ONLY
 *
 * Logs into Huawei FusionSolar locally and prints the latest published hourly
 * point per station for TODAY. Does NOT touch the database. Used to see whether
 * Huawei has published newer hours than what's currently in station_readings.
 *
 * Run: node --env-file=.env.local --import tsx scripts/check-huawei-latest.ts
 */

import {
  FusionSolarClient,
  loadFusionSolarEnv,
  STATIONS,
  CALL_DELAY,
  getStationRealKpis,
  getStationKpiHour,
} from '../lib/fusionsolar';

function sast(ms: number): string {
  const d = new Date(ms + 2 * 3_600_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

async function main() {
  const { username, password, baseUrl } = loadFusionSolarEnv();
  const client = new FusionSolarClient(username, password, baseUrl);

  const nowMs = Date.now();
  console.log(`Local now (SAST): ${sast(nowMs)}\n`);

  if (!(await client.login())) {
    console.error('Login failed — aborting.');
    process.exit(1);
  }

  const codes = STATIONS.map(s => s.code);

  // REQUIRED call order: batched station KPI first, before any other call.
  const kpiMap = await getStationRealKpis(client, codes);
  await client.sleep(CALL_DELAY);

  // Today's hourly curve for all stations in one call.
  const hours = await getStationKpiHour(client, codes, new Date(nowMs));

  // Group hourly points by station; keep only points that actually have power.
  const byStation = new Map<string, { collectTime: number; power: number }[]>();
  for (const h of hours) {
    if (h.inverterPower == null) continue;
    const arr = byStation.get(h.stationCode) ?? [];
    arr.push({ collectTime: h.collectTime, power: h.inverterPower });
    byStation.set(h.stationCode, arr);
  }

  console.log('Latest published HOURLY point per station (Huawei, today):\n');
  for (const s of STATIONS) {
    const pts = (byStation.get(s.code) ?? []).sort((a, b) => a.collectTime - b.collectTime);
    const latest = pts[pts.length - 1];
    const dayKwh = kpiMap.get(s.code)?.day_power ?? '—';
    if (!latest) {
      console.log(`  ${s.name.padEnd(24)}  no non-zero hourly points yet   | day total: ${dayKwh} kWh`);
    } else {
      console.log(
        `  ${s.name.padEnd(24)}  latest hour ${sast(latest.collectTime)} SAST = ${latest.power} kW` +
        `  (${pts.length} pts today) | day total: ${dayKwh} kWh`,
      );
    }
  }
}

main().catch(err => {
  console.error('check failed:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
