'use client';

// Changa OneView — Alert Centre. A live, severity-ranked feed of what needs a
// human right now, derived from the fleet's own readings. Honours the console
// filter, so an on-call engineer can scope to one OEM or province. A daily
// email digest of the same feed ships from /api/v2/alerts/digest.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, WifiOff, Activity, BatteryWarning, Radio, CheckCircle2, Bell, Mail, Send, Loader2 } from 'lucide-react';
import { OneViewHeader } from '@/components/v2/oneview-header';
import { FilterBar } from '@/components/v2/filter-bar';
import { useFleetFilter } from '@/components/v2/filter-context';
import { FleetData } from '@/lib/v2/fleet';
import { applyFilters } from '@/lib/v2/filter';
import {
  Alert, AlertCategory, AlertSeverity, buildAlerts, alertCounts, sinceLabel, CATEGORY_META,
} from '@/lib/v2/alerts';

const REFRESH_INTERVAL = 5 * 60 * 1000;

const CATEGORY_ICON: Record<AlertCategory, typeof AlertTriangle> = {
  offline: WifiOff,
  fault: AlertTriangle,
  performance: Activity,
  battery: BatteryWarning,
  comms: Radio,
};

const SEV_COLOR: Record<AlertSeverity, string> = {
  critical: 'var(--status-offline)',
  warning: 'var(--status-alarm)',
  info: 'var(--text-muted)',
};

type SevFilter = 'all' | 'critical' | 'warning';

export default function AlertCentre() {
  const [data, setData] = useState<FleetData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastFetched, setLastFetched] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const { filter } = useFleetFilter();
  const [sev, setSev] = useState<SevFilter>('all');

  const [testEmail, setTestEmail] = useState('');
  const [sendingKind, setSendingKind] = useState<'digest' | 'alarm' | null>(null);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);

  async function sendTest(kind: 'digest' | 'alarm') {
    const to = testEmail.trim();
    if (!to || sendingKind) return;
    setSendingKind(kind); setTestResult(null);
    try {
      const res = await fetch('/api/v2/alerts/digest', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ to, kind }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) setTestResult({ ok: false, msg: d?.error ?? 'Send failed' });
      else if (kind === 'alarm') setTestResult({ ok: true, msg: `Alarm sent${d.simulated ? ' (simulated — fleet was all clear)' : d.alert ? ` — ${d.alert}` : ''} · check ${to}` });
      else setTestResult({ ok: true, msg: `Digest sent — check ${to}` });
    } catch {
      setTestResult({ ok: false, msg: 'Network error — try again' });
    } finally {
      setSendingKind(null);
    }
  }

  const fetchData = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      const res = await fetch('/api/dashboard/fleet');
      if (!res.ok) throw new Error(await res.text());
      setData(await res.json());
      setLastFetched(new Date().toISOString());
    } catch (e) {
      console.error('Fleet fetch failed:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    timer.current = setInterval(() => fetchData(true), REFRESH_INTERVAL);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [fetchData]);

  const all = useMemo(() => data?.stations ?? [], [data]);
  const stations = useMemo(() => applyFilters(all, filter), [all, filter]);
  const alerts = useMemo(() => buildAlerts(stations), [stations]);
  const counts = useMemo(() => alertCounts(alerts), [alerts]);

  const visible = useMemo(
    () => (sev === 'all' ? alerts : alerts.filter(a => a.severity === sev)),
    [alerts, sev],
  );

  const subtitle = data
    ? counts.total === 0
      ? 'All clear — no active alerts'
      : `${counts.critical} critical · ${counts.warning} warning · ${counts.sites} sites affected`
    : 'Loading fleet…';

  return (
    <>
      <OneViewHeader
        title="Alert Centre"
        subtitle={subtitle}
        lastUpdated={lastFetched}
        onRefresh={() => fetchData(true)}
        refreshing={refreshing}
      />

      <div className="flex-1 p-7 space-y-5">
        <FilterBar stations={all} />

        {/* Summary tiles */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <SummaryTile label="Critical" value={data ? counts.critical : null} color="var(--status-offline)" icon={<AlertTriangle size={16} />} sub="Needs action now" />
          <SummaryTile label="Warning" value={data ? counts.warning : null} color="var(--status-alarm)" icon={<Activity size={16} />} sub="Watch closely" />
          <SummaryTile label="Sites affected" value={data ? counts.sites : null} color="var(--text-secondary)" icon={<Bell size={16} />} sub={`of ${stations.length} in view`} />
          <div className="ov-card flex flex-col justify-center p-5">
            <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.13em]" style={{ color: 'var(--text-secondary)' }}>
              <Mail size={14} style={{ color: 'var(--accent)' }} /> Email alerts
            </p>
            <p className="mt-2 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Digest + alarm notifications</p>
            <p className="mt-1 text-[11px]" style={{ color: 'var(--text-muted)' }}>Try both live — send a test below.</p>
          </div>
        </div>

        {/* Test sends — demo the emails without touching the recipient list */}
        <div className="ov-card p-5">
          <div className="flex flex-col lg:flex-row lg:items-center gap-4 justify-between">
            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-[0.13em]" style={{ color: 'var(--text-secondary)' }}>
                Try the emails live
              </p>
              <p className="mt-1 text-xs leading-relaxed max-w-md" style={{ color: 'var(--text-muted)' }}>
                Send this feed as a digest, or the alarm notification the team would get the moment a
                site trips — to any inbox. The real recipient list is untouched.
              </p>
            </div>
            <div className="flex flex-col sm:flex-row gap-2 shrink-0">
              <input
                type="email" placeholder="name@example.com" value={testEmail}
                onChange={e => setTestEmail(e.target.value)}
                className="sm:w-56 text-sm px-3 py-2 rounded-lg outline-none"
                style={{ background: 'var(--card-hover)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
              />
              <button
                type="button" onClick={() => sendTest('digest')} disabled={!!sendingKind || !testEmail.trim()}
                className="inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-bold cursor-pointer transition-opacity disabled:opacity-50"
                style={{ background: 'var(--accent)', color: '#fff' }}
              >
                {sendingKind === 'digest' ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} Send digest
              </button>
              <button
                type="button" onClick={() => sendTest('alarm')} disabled={!!sendingKind || !testEmail.trim()}
                className="inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-bold cursor-pointer transition-opacity disabled:opacity-50"
                style={{ background: 'var(--status-offline)', color: '#fff' }}
              >
                {sendingKind === 'alarm' ? <Loader2 size={15} className="animate-spin" /> : <AlertTriangle size={15} />} Send test alarm
              </button>
            </div>
          </div>
          {testResult && (
            <p className="mt-3 text-[11px] font-semibold" style={{ color: testResult.ok ? 'var(--accent)' : 'var(--status-offline)' }}>
              {testResult.msg}
            </p>
          )}
        </div>

        {/* Severity filter */}
        <div className="flex items-center gap-2">
          <Chip label="All" n={counts.total} active={sev === 'all'} onClick={() => setSev('all')} />
          <Chip label="Critical" n={counts.critical} color="var(--status-offline)" active={sev === 'critical'} onClick={() => setSev('critical')} />
          <Chip label="Warning" n={counts.warning} color="var(--status-alarm)" active={sev === 'warning'} onClick={() => setSev('warning')} />
        </div>

        {/* Alert feed */}
        {loading ? (
          <div className="space-y-2">
            {[0, 1, 2, 3].map(i => <div key={i} className="ov-card h-16 animate-pulse" style={{ background: 'var(--card)' }} />)}
          </div>
        ) : visible.length === 0 ? (
          <AllClear filtered={counts.total > 0} />
        ) : (
          <div className="space-y-2">
            {visible.map(a => <AlertRow key={a.id} alert={a} />)}
          </div>
        )}
      </div>
    </>
  );
}

function SummaryTile({ label, value, color, icon, sub }: {
  label: string; value: number | null; color: string; icon: React.ReactNode; sub: string;
}) {
  return (
    <div className="ov-card p-5">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-bold uppercase tracking-[0.13em]" style={{ color: 'var(--text-secondary)' }}>{label}</p>
        <div className="flex h-8 w-8 items-center justify-center rounded-lg shrink-0" style={{ background: 'var(--card-hover)', color }}>
          {icon}
        </div>
      </div>
      <p className="tnum mt-3 text-[28px] font-extrabold leading-none" style={{ color: value && value > 0 ? color : 'var(--text-primary)' }}>
        {value == null ? '—' : value}
      </p>
      <p className="mt-1.5 text-xs" style={{ color: 'var(--text-muted)' }}>{sub}</p>
    </div>
  );
}

function Chip({ label, n, color, active, onClick }: {
  label: string; n: number; color?: string; active: boolean; onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-[12px] font-semibold cursor-pointer transition-colors"
      style={{
        background: active ? 'var(--accent-dim)' : 'var(--card)',
        color: active ? 'var(--accent)' : 'var(--text-secondary)',
        border: `1px solid ${active ? 'var(--accent)' : 'transparent'}`,
      }}
    >
      {color && <span className="h-2 w-2 rounded-full" style={{ background: color }} />}
      {label}
      <span className="tnum text-[11px]" style={{ color: active ? 'var(--accent)' : 'var(--text-muted)' }}>{n}</span>
    </button>
  );
}

function AlertRow({ alert: a }: { alert: Alert }) {
  const Icon = CATEGORY_ICON[a.category];
  const color = SEV_COLOR[a.severity];
  return (
    <div className="ov-card flex items-start gap-3.5 p-4" style={{ borderLeft: `3px solid ${color}` }}>
      <div className="flex h-9 w-9 items-center justify-center rounded-lg shrink-0" style={{ background: 'var(--card-hover)', color }}>
        <Icon size={17} />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{a.title}</p>
          <span className="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide" style={{ background: 'var(--card-hover)', color: 'var(--text-muted)' }}>
            {CATEGORY_META[a.category].label}
          </span>
        </div>
        <p className="mt-1 text-xs" style={{ color: 'var(--text-secondary)' }}>{a.detail}</p>
        {a.suggestion && (
          <p className="mt-1 text-[11px]" style={{ color: 'var(--text-muted)' }}>↳ {a.suggestion}</p>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px]" style={{ color: 'var(--text-muted)' }}>
          <span className="flex items-center gap-1.5 font-semibold" style={{ color: 'var(--text-secondary)' }}>
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: a.oemColor }} />
            {a.stationName}
          </span>
          {a.location && <span>· {a.location}</span>}
          <span>· {a.oemLabel}</span>
        </div>
      </div>

      <span className="tnum shrink-0 text-[11px] font-semibold" style={{ color: 'var(--text-muted)' }}>
        {sinceLabel(a.since)}
      </span>
    </div>
  );
}

function AllClear({ filtered }: { filtered: boolean }) {
  return (
    <div className="ov-card flex flex-col items-center justify-center gap-3 py-20 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full" style={{ background: 'var(--accent-dim)' }}>
        <CheckCircle2 size={28} style={{ color: 'var(--accent)' }} />
      </div>
      <p className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>
        {filtered ? 'Nothing at this severity' : 'All clear'}
      </p>
      <p className="max-w-sm text-sm" style={{ color: 'var(--text-muted)' }}>
        {filtered
          ? 'No alerts match this severity in the current view. Try “All”.'
          : 'Every site in view is online and generating as expected. No action needed.'}
      </p>
    </div>
  );
}
