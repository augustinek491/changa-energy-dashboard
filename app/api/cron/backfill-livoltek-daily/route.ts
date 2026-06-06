import { NextRequest, NextResponse } from 'next/server';
import { LivoltkClient, loadLivoltkEnv, ALL_SITE_IDS } from '@/lib/livoltek';
import { getStationIdMap, upsertLivoltkKpiDayFromYield } from '@/lib/db';
import type { NamedSeries } from '@/lib/types';

// Walk backwards from yesterday to commissioning date
const COMMISSION_DATE = '2026-03-01';

// Sites processed per invocation (1 API call per site)
const SITES_PER_RUN = 4;

// Days covered per barChat window (portal returns up to 90 days at once)
const WINDOW_DAYS = 60;

export const maxDuration = 120;

function verifyCronSecret(req: NextRequest): boolean {
  return req.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`;
}

export async function GET(req: NextRequest) {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  const siteOffset = parseInt(url.searchParams.get('siteOffset') ?? '0', 10);
  const endDateParam = url.searchParams.get('endDate') ?? new Date(Date.now() - 86400000).toISOString().slice(0, 10);

  const { email, password } = loadLivoltkEnv();
  // Customer token suffices — barChat endpoint works without operator privilege
  const client = new LivoltkClient(email, password, 'customer');
  const loginOk = await client.login();
  if (!loginOk) {
    return NextResponse.json({ ok: false, error: 'LIVOLTEK customer login failed' }, { status: 500 });
  }

  const idMap = await getStationIdMap('livoltek');

  const endDate = new Date(endDateParam);
  const startDate = new Date(Math.max(
    endDate.getTime() - WINDOW_DAYS * 86400_000,
    new Date(COMMISSION_DATE).getTime(),
  ));
  const startStr = startDate.toISOString().slice(0, 10);
  const endStr   = endDate.toISOString().slice(0, 10);

  const batch = ALL_SITE_IDS.slice(siteOffset, siteOffset + SITES_PER_RUN);
  let totalRows = 0;
  const siteResults: Array<{ siteId: number; rows: number; error?: string }> = [];

  for (const siteId of batch) {
    try {
      // barChat with siteId + objectType '1' returns NamedSeries[] for daily PV yield + load.
      // First series ("ETotal toGrid") = daily PV generation. Works with customer token.
      const resp = await client.postJson('/endUser/data/barChat', {
        startTime:  `${startStr} 00:00:00`,
        endTime:    `${endStr} 23:59:59`,
        timeType:   1,
        objectType: '1',
        id:         siteId,
      });
      const series = (resp.data as NamedSeries[] | undefined) ?? [];

      const stationId = idMap.get(String(siteId));
      if (!stationId) {
        siteResults.push({ siteId, rows: 0, error: 'station not found in DB' });
        continue;
      }
      const rows = await upsertLivoltkKpiDayFromYield(stationId, series);
      totalRows += rows;
      siteResults.push({ siteId, rows });
    } catch (err) {
      siteResults.push({ siteId, rows: 0, error: err instanceof Error ? err.message : String(err) });
    }
    await new Promise(r => setTimeout(r, 500));
  }

  const nextSiteOffset = siteOffset + SITES_PER_RUN;
  const moreSites = nextSiteOffset < ALL_SITE_IDS.length;
  const moreWindowsBack = startDate > new Date(COMMISSION_DATE);

  let nextCall: string | null = null;
  if (moreSites) {
    nextCall = `?siteOffset=${nextSiteOffset}&endDate=${endStr}`;
  } else if (moreWindowsBack) {
    const prevEnd = new Date(startDate.getTime() - 86400_000).toISOString().slice(0, 10);
    nextCall = `?siteOffset=0&endDate=${prevEnd}`;
  }

  const done = !moreSites && !moreWindowsBack;

  return NextResponse.json({
    ok: true,
    done,
    window: { startStr, endStr },
    siteOffset,
    totalRows,
    sites: siteResults,
    nextQuery: nextCall,
    message: done
      ? 'LIVOLTEK daily backfill complete — all sites and windows covered.'
      : `Partial run. Continue with: /api/cron/backfill-livoltek-daily${nextCall}`,
  });
}
