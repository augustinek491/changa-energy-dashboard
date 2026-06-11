// Guard rails for the demo "send test email" endpoints. The dashboard has no
// login, so these endpoints are publicly reachable — the guard caps abuse:
// at most TEST_SEND_LIMIT test emails per rolling hour across all kinds,
// counted from refresh_log (each test send logs its job_type there).

import type { SupabaseClient } from '@supabase/supabase-js';

export const TEST_JOB_TYPES = ['test_report', 'test_digest', 'test_alarm'] as const;
export const TEST_SEND_LIMIT = 10; // per rolling hour, shared across kinds

export function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s) && s.length <= 254;
}

export async function testSendsRemaining(db: SupabaseClient): Promise<number> {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count } = await db
    .from('refresh_log')
    .select('*', { count: 'exact', head: true })
    .in('job_type', [...TEST_JOB_TYPES])
    .gte('started_at', oneHourAgo);
  return Math.max(0, TEST_SEND_LIMIT - (count ?? 0));
}
