'use client';

import { useState, useEffect, useCallback } from 'react';
import { Header } from '@/components/header';
import {
  Mail,
  Plus,
  Trash2,
  Send,
  CheckCircle,
  AlertCircle,
  Zap,
  Sun,
  TrendingUp,
  AlertTriangle,
} from 'lucide-react';

interface Recipient {
  id: string;
  email: string;
  label: string | null;
  active: boolean;
}

interface StationLive {
  pv_power_kw: number | null;
  health_state: number | null;
  status: number | null;
  today_kwh: number | null;
  month_kwh: number | null;
}

interface Station {
  id: string;
  name: string;
  source: string;
  location: string | null;
  live: StationLive | null;
  alarm_count: number;
}

interface FleetSummary {
  total: number;
  online: number;
  alarm: number;
  offline: number;
  open_alarms: number;
  total_pv_kw: number;
  total_today_kwh: number;
  total_month_kwh: number;
  total_lifetime_kwh: number;
}

interface FleetData {
  stations: Station[];
  summary: FleetSummary;
}

type StationStatus = 'online' | 'alarm' | 'offline';

function stationStatus(source: string, health: number | null, status: number | null): StationStatus {
  if (source === 'fusionsolar') {
    if (health === 3) return 'online';
    if (health === 2) return 'alarm';
    return 'offline';
  }
  if (status === 1) return 'online';
  if (status === 4) return 'alarm';
  return 'offline';
}

const STATUS_STYLE: Record<StationStatus, { color: string; bg: string; label: string }> = {
  online:  { color: 'var(--accent)',          bg: 'var(--accent-dim)',         label: 'Online' },
  alarm:   { color: 'var(--status-alarm)',     bg: 'var(--status-alarm-dim)',   label: 'Alarm' },
  offline: { color: 'var(--status-offline)',   bg: 'var(--status-offline-dim)', label: 'Offline' },
};

export default function ReportsPage() {
  const [fleet, setFleet] = useState<FleetData | null>(null);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [fleetLoading, setFleetLoading] = useState(true);
  const [recipientsLoading, setRecipientsLoading] = useState(true);

  const [newEmail, setNewEmail] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [addingRecipient, setAddingRecipient] = useState(false);

  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<{ ok: boolean; message: string } | null>(null);

  const fetchFleet = useCallback(async () => {
    try {
      const res = await fetch('/api/dashboard/fleet');
      if (res.ok) setFleet(await res.json());
    } finally {
      setFleetLoading(false);
    }
  }, []);

  const fetchRecipients = useCallback(async () => {
    try {
      const res = await fetch('/api/reports/recipients');
      if (res.ok) setRecipients(await res.json());
    } finally {
      setRecipientsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchFleet();
    fetchRecipients();
  }, [fetchFleet, fetchRecipients]);

  async function addRecipient() {
    if (!newEmail.trim()) return;
    setAddError(null);
    setAddingRecipient(true);
    try {
      const res = await fetch('/api/reports/recipients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: newEmail.trim(), label: newLabel.trim() || null }),
      });
      const data = await res.json();
      if (!res.ok) { setAddError(data.error ?? 'Failed to add'); return; }
      setRecipients(prev => [...prev, data]);
      setNewEmail('');
      setNewLabel('');
    } finally {
      setAddingRecipient(false);
    }
  }

  async function removeRecipient(id: string) {
    const res = await fetch(`/api/reports/recipients?id=${id}`, { method: 'DELETE' });
    if (res.ok) setRecipients(prev => prev.filter(r => r.id !== id));
  }

  async function sendReport() {
    setSending(true);
    setSendResult(null);
    try {
      const res = await fetch('/api/reports/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (res.ok) {
        setSendResult({
          ok: true,
          message: `Report sent to ${data.sent} recipient${data.sent !== 1 ? 's' : ''}`,
        });
      } else {
        setSendResult({ ok: false, message: data.error ?? 'Failed to send report' });
      }
    } catch {
      setSendResult({ ok: false, message: 'Network error — could not send report' });
    } finally {
      setSending(false);
    }
  }

  const today = new Date().toLocaleDateString('en-ZA', {
    timeZone: 'Africa/Johannesburg',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  const summary = fleet?.summary;
  const activeRecipients = recipients.filter(r => r.active);

  return (
    <>
      <Header title="Reports" subtitle="Send fleet status reports by email" />
      <div className="flex-1 p-6">
        <div className="flex gap-5 items-start">

          {/* ── Left panel ── */}
          <div className="flex flex-col gap-4" style={{ width: 340, flexShrink: 0 }}>

            {/* Recipients card */}
            <div
              className="rounded-xl p-5"
              style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
            >
              <div className="flex items-center gap-2 mb-4">
                <Mail size={14} style={{ color: 'var(--text-secondary)' }} />
                <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                  Recipients
                </span>
                {activeRecipients.length > 0 && (
                  <span
                    className="ml-auto text-xs font-bold px-2 py-0.5 rounded-full"
                    style={{ background: 'var(--accent-dim)', color: 'var(--accent)' }}
                  >
                    {activeRecipients.length}
                  </span>
                )}
              </div>

              {recipientsLoading ? (
                <div className="space-y-2 mb-4">
                  {[1, 2].map(i => (
                    <div key={i} className="h-10 rounded-lg animate-pulse" style={{ background: 'var(--card)' }} />
                  ))}
                </div>
              ) : recipients.length === 0 ? (
                <div className="py-5 text-center mb-3">
                  <Mail size={22} className="mx-auto mb-2" style={{ color: 'var(--text-muted)' }} />
                  <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No recipients yet</p>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>Add an email below</p>
                </div>
              ) : (
                <div className="space-y-1.5 mb-4">
                  {recipients.map(r => (
                    <div
                      key={r.id}
                      className="flex items-center gap-2 px-3 py-2.5 rounded-lg"
                      style={{ background: 'var(--card)' }}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                          {r.email}
                        </p>
                        {r.label && (
                          <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>
                            {r.label}
                          </p>
                        )}
                      </div>
                      <button
                        onClick={() => removeRecipient(r.id)}
                        className="flex-shrink-0 p-1 rounded cursor-pointer transition-opacity hover:opacity-60"
                        style={{ color: 'var(--text-muted)' }}
                        title="Remove"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Add form */}
              <div
                className="pt-3 space-y-2"
                style={{ borderTop: recipients.length > 0 ? '1px solid var(--border)' : undefined }}
              >
                <input
                  type="text"
                  placeholder="Label (e.g. Admin, Client)"
                  value={newLabel}
                  onChange={e => setNewLabel(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg outline-none"
                  style={{
                    background: 'var(--card)',
                    border: '1px solid var(--border)',
                    color: 'var(--text-primary)',
                  }}
                />
                <div className="flex gap-2">
                  <input
                    type="email"
                    placeholder="email@example.com"
                    value={newEmail}
                    onChange={e => { setNewEmail(e.target.value); setAddError(null); }}
                    onKeyDown={e => e.key === 'Enter' && addRecipient()}
                    className="flex-1 px-3 py-2 text-sm rounded-lg outline-none"
                    style={{
                      background: 'var(--card)',
                      border: `1px solid ${addError ? 'var(--status-offline)' : 'var(--border)'}`,
                      color: 'var(--text-primary)',
                    }}
                  />
                  <button
                    onClick={addRecipient}
                    disabled={addingRecipient || !newEmail.trim()}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold cursor-pointer transition-opacity"
                    style={{
                      background: 'var(--accent)',
                      color: '#fff',
                      opacity: addingRecipient || !newEmail.trim() ? 0.4 : 1,
                    }}
                  >
                    <Plus size={14} />
                    Add
                  </button>
                </div>
                {addError && (
                  <p className="text-xs" style={{ color: 'var(--status-offline)' }}>{addError}</p>
                )}
              </div>
            </div>

            {/* Send card */}
            <div
              className="rounded-xl p-5"
              style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
            >
              <div className="flex items-center gap-2 mb-1">
                <Send size={14} style={{ color: 'var(--text-secondary)' }} />
                <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                  Send Report
                </span>
              </div>
              <p className="text-xs mb-4" style={{ color: 'var(--text-muted)' }}>
                {today}
              </p>

              <button
                onClick={sendReport}
                disabled={sending || activeRecipients.length === 0}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold cursor-pointer transition-opacity"
                style={{
                  background: 'var(--accent)',
                  color: '#fff',
                  opacity: sending || activeRecipients.length === 0 ? 0.45 : 1,
                }}
              >
                <Send size={14} />
                {sending
                  ? 'Sending…'
                  : activeRecipients.length === 0
                  ? 'No recipients'
                  : `Send to ${activeRecipients.length} recipient${activeRecipients.length !== 1 ? 's' : ''}`}
              </button>

              {activeRecipients.length === 0 && !sending && (
                <p className="text-xs text-center mt-2" style={{ color: 'var(--text-muted)' }}>
                  Add at least one recipient above
                </p>
              )}

              {sendResult && (
                <div
                  className="mt-3 flex items-start gap-2 px-3 py-2.5 rounded-lg text-sm"
                  style={{
                    background: sendResult.ok ? 'var(--accent-dim)' : 'var(--status-offline-dim)',
                    color: sendResult.ok ? 'var(--accent)' : 'var(--status-offline)',
                  }}
                >
                  {sendResult.ok ? <CheckCircle size={14} className="mt-0.5 shrink-0" /> : <AlertCircle size={14} className="mt-0.5 shrink-0" />}
                  {sendResult.message}
                </div>
              )}
            </div>
          </div>

          {/* ── Right panel: Preview ── */}
          <div
            className="flex-1 rounded-xl overflow-hidden"
            style={{ border: '1px solid var(--border)', minWidth: 0 }}
          >
            <div
              className="px-5 py-3.5 flex items-center gap-2"
              style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}
            >
              <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                Report Preview
              </span>
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                — what recipients will receive
              </span>
            </div>

            {fleetLoading ? (
              <div className="p-6 space-y-3" style={{ background: 'var(--card)' }}>
                {[1, 2, 3, 4].map(i => (
                  <div key={i} className="h-12 rounded-lg animate-pulse" style={{ background: 'var(--surface)' }} />
                ))}
              </div>
            ) : (
              <>
                {/* KPI row */}
                <div
                  className="px-5 py-4"
                  style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}
                >
                  <p
                    className="text-[10px] font-semibold uppercase tracking-widest mb-3"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    Fleet Summary
                  </p>
                  <div className="grid grid-cols-4 gap-3">
                    {[
                      { label: 'Live Output', value: summary ? `${summary.total_pv_kw.toFixed(1)} kW` : '—', icon: <Zap size={13} />, color: 'var(--accent)' },
                      { label: "Today's Yield", value: summary ? `${summary.total_today_kwh.toFixed(1)} kWh` : '—', icon: <Sun size={13} />, color: '#F59E0B' },
                      { label: 'Month', value: summary ? `${(summary.total_month_kwh / 1000).toFixed(1)} MWh` : '—', icon: <TrendingUp size={13} />, color: '#3B82F6' },
                      {
                        label: 'Alarms',
                        value: summary ? String(summary.open_alarms) : '—',
                        icon: <AlertTriangle size={13} />,
                        color: summary && summary.open_alarms > 0 ? 'var(--status-offline)' : 'var(--accent)',
                      },
                    ].map(kpi => (
                      <div
                        key={kpi.label}
                        className="rounded-lg p-3 text-center"
                        style={{ background: 'var(--card)' }}
                      >
                        <div style={{ color: kpi.color }} className="flex justify-center mb-1">
                          {kpi.icon}
                        </div>
                        <p className="text-base font-bold leading-none" style={{ color: kpi.color }}>
                          {kpi.value}
                        </p>
                        <p className="text-[10px] mt-1" style={{ color: 'var(--text-muted)' }}>
                          {kpi.label}
                        </p>
                      </div>
                    ))}
                  </div>
                  {summary && (
                    <p className="text-xs text-center mt-3" style={{ color: 'var(--text-secondary)' }}>
                      {summary.online} online · {summary.alarm} in alarm · {summary.offline} offline · {summary.total} stations
                    </p>
                  )}
                </div>

                {/* Station table */}
                <div style={{ background: 'var(--surface)' }}>
                  <div
                    className="px-5 py-2.5"
                    style={{ borderBottom: '1px solid var(--border)', background: 'var(--card)' }}
                  >
                    <p className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
                      Station Breakdown · {fleet?.stations.length ?? 0} sites
                    </p>
                  </div>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--card)' }}>
                        <th className="px-5 py-2 text-left text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Station</th>
                        <th className="px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Status</th>
                        <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Live kW</th>
                        <th className="px-5 py-2 text-right text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Today kWh</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(fleet?.stations ?? []).map(s => {
                        const st = stationStatus(s.source, s.live?.health_state ?? null, s.live?.status ?? null);
                        const sty = STATUS_STYLE[st];
                        return (
                          <tr key={s.id} style={{ borderBottom: '1px solid var(--border)' }}>
                            <td className="px-5 py-2.5">
                              <p className="text-sm font-medium leading-none" style={{ color: 'var(--text-primary)' }}>
                                {s.name}
                              </p>
                              <p className="text-[10px] uppercase mt-0.5" style={{ color: 'var(--text-muted)' }}>
                                {s.source}
                              </p>
                            </td>
                            <td className="px-3 py-2.5 text-center">
                              <span
                                className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                                style={{ color: sty.color, background: sty.bg }}
                              >
                                {sty.label}
                              </span>
                            </td>
                            <td
                              className="px-3 py-2.5 text-right text-sm font-mono"
                              style={{ color: 'var(--text-primary)' }}
                            >
                              {s.live?.pv_power_kw != null ? s.live.pv_power_kw.toFixed(1) : '—'}
                            </td>
                            <td
                              className="px-5 py-2.5 text-right text-sm font-mono"
                              style={{ color: 'var(--text-primary)' }}
                            >
                              {s.live?.today_kwh != null ? s.live.today_kwh.toFixed(1) : '—'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Alarms footer */}
                <div
                  className="px-5 py-3 text-center text-sm font-medium"
                  style={{
                    background: 'var(--surface)',
                    borderTop: '1px solid var(--border)',
                    color: (summary?.open_alarms ?? 0) > 0 ? 'var(--status-alarm)' : 'var(--accent)',
                  }}
                >
                  {(summary?.open_alarms ?? 0) === 0
                    ? '✓ No active alarms — all systems healthy'
                    : `⚠ ${summary!.open_alarms} active alarm${summary!.open_alarms > 1 ? 's' : ''}`}
                </div>
              </>
            )}
          </div>

        </div>
      </div>
    </>
  );
}
