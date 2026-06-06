import { NextRequest, NextResponse } from 'next/server';
import { LivoltkClient, loadLivoltkEnv, getSiteIntraday, ALL_SITE_IDS } from '@/lib/livoltek';
import { getStationIdMap, insertLivoltkIntradayReadings } from '@/lib/db';

// Walk backwards from yesterday to this date
const COMMISSION_DATE = '2026-03-01';

// Sites processed per invocation (1 API call per site per day — keep under 60s budget)
const SITES_PER_RUN = 8;

export const maxDuration = 120;

function verifyCronSecret(req: NextRequest): boolean {
  return req.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`;
}

export async function GET(req: NextRequest) {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);

  // Date cursor: process this single day across SITES_PER_RUN sites
  const dateParam = url.searchParams.get('date') ?? new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  // Site offset cursor within that day
  const siteOffset = parseInt(url.searchParams.get('siteOffset') ?? '0', 10);

  if (dateParam < COMMISSION_DATE) {
    return NextResponse.json({ ok: true, done: true, message: 'Intraday backfill complete — reached commissioning date.' });
  }

  const { email, password } = loadLivoltkEnv();
  // Operator token required for sampleByKeyCommon
  const client = new LivoltkClient(email, password, 'operator');
  const loginOk = await client.login();
  if (!loginOk) {
    return NextResponse.json({ ok: false, error: 'LIVOLTEK operator login failed' }, { status: 500 });
  }

  const idMap = await getStationIdMap('livoltek');
  const batch = ALL_SITE_IDS.slice(siteOffset, siteOffset + SITES_PER_RUN);
  let totalPoints = 0;
  const siteResults: Array<{ siteId: number; points: number; error?: string }> = [];

  for (const siteId of batch) {
    try {
      const intraday = await getSiteIntraday(client, siteId, dateParam);
      const stationId = idMap.get(String(siteId));
      if (!stationId) {
        siteResults.push({ siteId, points: 0, error: 'station not found in DB' });
        continue;
      }
      const points = await insertLivoltkIntradayReadings(stationId, intraday);
      totalPoints += points;
      siteResults.push({ siteId, points });
    } catch (err) {
      siteResults.push({ siteId, points: 0, error: err instanceof Error ? err.message : String(err) });
    }
    // Delay between site calls — portal rate-limits concurrent intraday requests
    await new Promise(r => setTimeout(r, 800));
  }

  const nextSiteOffset = siteOffset + SITES_PER_RUN;
  const moreSites = nextSiteOffset < ALL_SITE_IDS.length;

  let nextCall: string;
  if (moreSites) {
    nextCall = `?date=${dateParam}&siteOffset=${nextSiteOffset}`;
  } else {
    // All sites done for this day — move to previous day
    const prevDay = new Date(new Date(dateParam).getTime() - 86400_000).toISOString().slice(0, 10);
    nextCall = `?date=${prevDay}&siteOffset=0`;
  }

  const done = !moreSites && dateParam <= COMMISSION_DATE;

  return NextResponse.json({
    ok: true,
    done,
    date: dateParam,
    siteOffset,
    totalPoints,
    sites: siteResults,
    nextQuery: done ? null : nextCall,
    message: done
      ? 'LIVOLTEK intraday backfill complete.'
      : `Partial run. Continue with: /api/cron/backfill-livoltek-intraday${nextCall}`,
  });
}
