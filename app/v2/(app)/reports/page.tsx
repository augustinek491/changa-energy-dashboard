'use client';

// Changa OneView — Reports. The boardroom deliverable: a branded daily fleet
// report that goes out by email at close of day (19:30 SAST, once the solar
// day is complete) and exports to PDF on demand. This page is the control
// surface — it previews exactly what the next report will contain (live),
// opens the full report, exports the PDF, manages who receives the daily
// email, and can send a one-off test to any inbox for demos.

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FileText, Download, ExternalLink, Mail, Plus, Trash2, Clock,
  Sun, Banknote, Bell, Activity, CheckCircle2, Loader2, Send,
} from 'lucide-react';
import { OneViewHeader } from '@/components/v2/oneview-header';
import { StatTile } from '@/components/v2/stat-tile';
import { FleetData } from '@/lib/v2/fleet';
import { buildAlerts, alertCounts } from '@/lib/v2/alerts';
import { valueOfEnergy, randCompact } from '@/lib/v2/brand';

interface Recipient { id: string; email: string; label: string | null; active: boolean }

const SECTIONS = [
  'Executive summary — sites online, energy & savings today, open alerts',
  'Fleet status — online / alarm / offline, month-to-date totals',
  'Financial value — grid savings, PPA revenue, carbon avoided',
  'Generation by manufacturer — per-OEM yield and value',
  'Top performing sites — the day’s highest producers',
  'Alerts — every site that needs a human, by severity',
];

function fmtKwh(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)} MWh` : `${Math.round(n)} kWh`;
}

export default function ReportsPage() {
  const [fleet, setFleet] = useState<FleetData | null>(null);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [email, setEmail] = useState('');
  const [label, setLabel] = useState('');
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const loadFleet = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      const res = await fetch('/api/dashboard/fleet');
      if (res.ok) setFleet(await res.json());
    } catch (e) {
      console.error('Fleet fetch failed:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const loadRecipients = useCallback(async () => {
    try {
      const res = await fetch('/api/reports/recipients');
      if (res.ok) setRecipients(await res.json());
    } catch (e) {
      console.error('Recipients fetch failed:', e);
    }
  }, []);

  useEffect(() => { loadFleet(); loadRecipients(); }, [loadFleet, loadRecipients]);

  const snapshot = useMemo(() => {
    if (!fleet) return null;
    const today = fleet.summary.total_today_kwh ?? 0;
    const alerts = alertCounts(buildAlerts(fleet.stations));
    return {
      online: fleet.summary.online,
      total: fleet.summary.total,
      todayKwh: today,
      savings: valueOfEnergy(today).savings,
      alerts: alerts.total,
      critical: alerts.critical,
    };
  }, [fleet]);

  const activeCount = recipients.filter(r => r.active).length;

  async function addRecipient(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setAdding(true); setErr(null);
    try {
      const res = await fetch('/api/reports/recipients', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), label: label.trim() || undefined }),
      });
      if (!res.ok) { setErr((await res.json().catch(() => ({})))?.error ?? 'Could not add recipient'); return; }
      setEmail(''); setLabel('');
      await loadRecipients();
    } finally {
      setAdding(false);
    }
  }

  async function removeRecipient(id: string) {
    setRecipients(rs => rs.filter(r => r.id !== id)); // optimistic
    await fetch(`/api/reports/recipients?id=${id}`, { method: 'DELETE' });
    loadRecipients();
  }

  const [testEmail, setTestEmail] = useState('');
  const [sendingTest, setSendingTest] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);

  async function sendTest(e: React.FormEvent) {
    e.preventDefault();
    const to = testEmail.trim();
    if (!to) return;
    setSendingTest(true); setTestResult(null);
    try {
      const res = await fetch('/api/v2/reports', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ to }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setTestResult({ ok: false, msg: data?.error ?? 'Send failed' });
      else { setTestResult({ ok: true, msg: `Sent — check the inbox at ${to}` }); setTestEmail(''); }
    } catch {
      setTestResult({ ok: false, msg: 'Network error — try again' });
    } finally {
      setSendingTest(false);
    }
  }

  const openReport = () => window.open('/api/v2/reports?preview=1', '_blank', 'noopener');
  const downloadPdf = () => window.open('/api/v2/reports?pdf=1', '_blank', 'noopener');

  const subtitle = `Daily fleet briefing · ${activeCount} recipient${activeCount === 1 ? '' : 's'} · auto-sends 19:30 SAST`;

  return (
    <>
      <OneViewHeader
        title="Reports"
        subtitle={subtitle}
        lastUpdated={null}
        onRefresh={() => loadFleet(true)}
        refreshing={refreshing}
      />

      <div className="flex-1 p-7 space-y-5">
        {/* Hero — the report + actions */}
        <div className="ov-card p-6" style={{ background: 'linear-gradient(150deg, color-mix(in srgb, var(--accent) 10%, var(--surface)) 0%, var(--surface) 60%)' }}>
          <div className="flex flex-col lg:flex-row lg:items-center gap-6 justify-between">
            <div className="flex items-start gap-4 min-w-0">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl" style={{ background: 'var(--accent-dim)', color: 'var(--accent)' }}>
                <FileText size={22} />
              </span>
              <div className="min-w-0">
                <h2 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Daily Fleet Report</h2>
                <p className="mt-1 text-sm leading-relaxed max-w-xl" style={{ color: 'var(--text-secondary)' }}>
                  One branded briefing across every OEM — fleet status, energy yield, the Rand value of that
                  energy, and open alerts. Emailed at close of day with the full day&apos;s numbers, and
                  exportable to PDF on demand.
                </p>
                <div className="mt-3 flex items-center gap-2 text-[11px] font-semibold" style={{ color: 'var(--text-muted)' }}>
                  <Clock size={13} /> Auto-sends daily at 19:30 SAST — after the solar day ends
                </div>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row lg:flex-col gap-2.5 shrink-0">
              <button
                onClick={openReport}
                className="inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-bold cursor-pointer transition-opacity hover:opacity-90"
                style={{ background: 'var(--accent)', color: '#fff' }}
              >
                <ExternalLink size={15} /> Open report
              </button>
              <button
                onClick={downloadPdf}
                className="inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-bold cursor-pointer transition-colors hover:bg-[var(--card-hover)]"
                style={{ background: 'transparent', color: 'var(--text-primary)', border: '1px solid var(--border-strong)' }}
              >
                <Download size={15} /> Download PDF
              </button>
            </div>
          </div>

          {/* Test send — demo the email without touching the recipient list */}
          <form onSubmit={sendTest} className="mt-5 border-t pt-4" style={{ borderColor: 'var(--border)' }}>
            <div className="flex flex-col sm:flex-row sm:items-center gap-2.5">
              <p className="text-[11px] font-semibold sm:w-64 leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                Email a one-off test of today&apos;s report to any inbox — live data, recipient list untouched.
              </p>
              <input
                type="email" required placeholder="name@example.com" value={testEmail}
                onChange={e => setTestEmail(e.target.value)}
                className="flex-1 text-sm px-3 py-2 rounded-lg outline-none"
                style={{ background: 'var(--card-hover)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
              />
              <button
                type="submit" disabled={sendingTest || !testEmail.trim()}
                className="inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-bold cursor-pointer transition-opacity disabled:opacity-50"
                style={{ background: 'var(--accent)', color: '#fff' }}
              >
                {sendingTest ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} Send test report
              </button>
            </div>
            {testResult && (
              <p className="mt-2 text-[11px] font-semibold" style={{ color: testResult.ok ? 'var(--accent)' : 'var(--status-offline)' }}>
                {testResult.msg}
              </p>
            )}
          </form>
        </div>

        {/* Live snapshot — what the next report will carry */}
        <div>
          <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.13em]" style={{ color: 'var(--text-muted)' }}>
            In the next report
          </p>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatTile label="Sites online" value={snapshot ? `${snapshot.online}/${snapshot.total}` : '—'} icon={<Activity size={16} />} accent="var(--accent)" sub="Reporting now" />
            <StatTile label="Energy today" value={snapshot ? fmtKwh(snapshot.todayKwh) : '—'} icon={<Sun size={16} />} accent="var(--status-alarm)" sub="Fleet generation" />
            <StatTile label="Saved today" value={snapshot ? randCompact(snapshot.savings) : '—'} icon={<Banknote size={16} />} accent="var(--money)" tag="est." sub="Grid savings" hero />
            <StatTile label="Open alerts" value={snapshot ? String(snapshot.alerts) : '—'} icon={<Bell size={16} />} accent={snapshot?.critical ? 'var(--status-offline)' : 'var(--accent)'} sub={snapshot?.critical ? `${snapshot.critical} critical` : 'All clear'} />
          </div>
        </div>

        {/* What's inside + Recipients */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* What's inside */}
          <div className="ov-card p-5">
            <p className="text-[11px] font-bold uppercase tracking-[0.13em] mb-4" style={{ color: 'var(--text-secondary)' }}>
              What’s inside
            </p>
            <ul className="space-y-3">
              {SECTIONS.map(s => (
                <li key={s} className="flex items-start gap-2.5 text-sm" style={{ color: 'var(--text-secondary)' }}>
                  <CheckCircle2 size={15} className="mt-0.5 shrink-0" style={{ color: 'var(--accent)' }} />
                  <span>{s}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Recipients */}
          <div className="ov-card p-5">
            <div className="flex items-center justify-between mb-4">
              <p className="text-[11px] font-bold uppercase tracking-[0.13em]" style={{ color: 'var(--text-secondary)' }}>
                Email recipients
              </p>
              <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold" style={{ color: 'var(--text-muted)' }}>
                <Mail size={12} /> {activeCount} active
              </span>
            </div>

            {/* List */}
            <div className="space-y-2 mb-4">
              {recipients.length === 0 ? (
                <p className="py-3 text-sm" style={{ color: 'var(--text-muted)' }}>
                  No recipients yet. Add one below to start the daily email.
                </p>
              ) : recipients.map(r => (
                <div key={r.id} className="flex items-center justify-between gap-3 rounded-lg px-3 py-2" style={{ background: 'var(--card-hover)' }}>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
                      {r.label || r.email}
                    </p>
                    {r.label && <p className="text-[11px] truncate" style={{ color: 'var(--text-muted)' }}>{r.email}</p>}
                  </div>
                  <button
                    onClick={() => removeRecipient(r.id)}
                    className="shrink-0 rounded-md p-1.5 cursor-pointer transition-colors hover:bg-[var(--card)]"
                    style={{ color: 'var(--text-muted)' }}
                    aria-label={`Remove ${r.email}`}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>

            {/* Add form */}
            <form onSubmit={addRecipient} className="space-y-2.5 border-t pt-4" style={{ borderColor: 'var(--border)' }}>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="email" required placeholder="name@changaenergy.com" value={email}
                  onChange={e => setEmail(e.target.value)}
                  className="flex-1 text-sm px-3 py-2 rounded-lg outline-none"
                  style={{ background: 'var(--card-hover)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
                />
                <input
                  type="text" placeholder="Name (optional)" value={label}
                  onChange={e => setLabel(e.target.value)}
                  className="sm:w-36 text-sm px-3 py-2 rounded-lg outline-none"
                  style={{ background: 'var(--card-hover)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
                />
              </div>
              {err && <p className="text-[11px]" style={{ color: 'var(--status-offline)' }}>{err}</p>}
              <button
                type="submit" disabled={adding || !email.trim()}
                className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-bold cursor-pointer transition-opacity disabled:opacity-50"
                style={{ background: 'var(--accent)', color: '#fff' }}
              >
                {adding ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />} Add recipient
              </button>
            </form>
          </div>
        </div>

        <p className="text-[11px] text-center" style={{ color: 'var(--text-muted)' }}>
          Energy is metered live from each OEM portal. Rand and carbon figures are labelled estimates.
        </p>
      </div>
    </>
  );
}
