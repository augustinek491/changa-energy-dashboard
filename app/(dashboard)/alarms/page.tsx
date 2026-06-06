'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Header } from '@/components/header';
import { Bell, CheckCircle, AlertTriangle, AlertCircle, Info, ChevronRight } from 'lucide-react';

interface Alarm {
  id: string;
  station_id: string | null;
  station_name: string;
  station_source: string | null;
  alarm_name: string;
  alarm_code: string | null;
  severity: number | null;
  cause: string | null;
  repair_suggestion: string | null;
  raised_at: string;
  resolved_at: string | null;
}

interface AlarmsData {
  alarms: Alarm[];
  total: number;
  page: number;
  limit: number;
}

const SEVERITY = {
  1: { label: 'Critical', color: '#EF4444', icon: AlertCircle },
  2: { label: 'Major',    color: '#F97316', icon: AlertTriangle },
  3: { label: 'Minor',    color: '#F59E0B', icon: AlertTriangle },
  4: { label: 'Warning',  color: '#3B82F6', icon: Info },
};

function SeverityBadge({ severity }: { severity: number | null }) {
  const s = SEVERITY[severity as keyof typeof SEVERITY] ?? { label: 'Unknown', color: 'var(--text-muted)', icon: Info };
  const Icon = s.icon;
  return (
    <div
      className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-semibold"
      style={{ background: `${s.color}18`, color: s.color }}
    >
      <Icon size={10} />
      {s.label}
    </div>
  );
}

function timeAgo(ts: string) {
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function AlarmsPage() {
  const [data, setData] = useState<AlarmsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showResolved, setShowResolved] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const fetchData = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      const res = await fetch(`/api/dashboard/alarms?resolved=${showResolved}`);
      if (!res.ok) throw new Error('Failed to fetch alarms');
      const json: AlarmsData = await res.json();
      setData(json);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [showResolved]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const alarms = data?.alarms ?? [];
  const active = alarms.filter(a => !a.resolved_at);
  const critical = active.filter(a => a.severity === 1).length;

  return (
    <>
      <Header
        title="Alarms & Alerts"
        subtitle={data ? `${data.total} ${showResolved ? 'total' : 'active'} alarms` : undefined}
        onRefresh={() => fetchData(true)}
        refreshing={refreshing}
      />

      <div className="flex-1 p-6 space-y-5">
        {/* Summary row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: 'Active', value: data?.total ?? 0, color: '#EF4444' },
            { label: 'Critical', value: critical, color: '#EF4444' },
            { label: 'Major / Minor', value: active.filter(a => a.severity === 2 || a.severity === 3).length, color: '#F59E0B' },
            { label: 'Warnings', value: active.filter(a => a.severity === 4).length, color: '#3B82F6' },
          ].map(stat => (
            <div
              key={stat.label}
              className="rounded-xl p-4 flex items-center gap-3"
              style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
            >
              <div className="w-2 h-8 rounded-full flex-shrink-0" style={{ background: stat.color }} />
              <div>
                <p className="text-lg font-bold leading-none" style={{ color: 'var(--text-primary)' }}>{stat.value}</p>
                <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>{stat.label}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Toggle resolved */}
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            {showResolved ? 'All Alarms' : 'Active Alarms'}
          </h2>
          <button
            onClick={() => setShowResolved(v => !v)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer"
            style={{ background: 'var(--card)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
          >
            {showResolved ? <Bell size={12} /> : <CheckCircle size={12} />}
            {showResolved ? 'Show Active Only' : 'Show Resolved'}
          </button>
        </div>

        {/* Alarms list */}
        <div
          className="rounded-xl overflow-hidden"
          style={{ border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)' }}
        >
          {/* Table header */}
          <div
            className="grid px-5 py-3 text-[10px] uppercase tracking-widest font-semibold"
            style={{
              background: 'var(--card)',
              color: 'var(--text-muted)',
              gridTemplateColumns: '120px 1fr 140px 100px 90px 40px',
            }}
          >
            <span>Severity</span>
            <span>Alarm</span>
            <span>Station</span>
            <span>Raised</span>
            <span>Status</span>
            <span />
          </div>

          {loading ? (
            <div className="p-6 space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-12 rounded animate-pulse" style={{ background: 'var(--card)' }} />
              ))}
            </div>
          ) : alarms.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16">
              <CheckCircle size={32} style={{ color: 'var(--accent)' }} />
              <p className="mt-3 text-sm" style={{ color: 'var(--text-secondary)' }}>No active alarms — all clear!</p>
            </div>
          ) : (
            alarms.map(alarm => (
              <div key={alarm.id}>
                <div
                  className="grid items-center px-5 py-3.5 cursor-pointer transition-colors"
                  style={{
                    gridTemplateColumns: '120px 1fr 140px 100px 90px 40px',
                    borderTop: '1px solid var(--border)',
                    background: expanded === alarm.id ? 'var(--card)' : 'var(--surface)',
                  }}
                  onClick={() => setExpanded(expanded === alarm.id ? null : alarm.id)}
                  onMouseEnter={e => { if (expanded !== alarm.id) e.currentTarget.style.background = 'var(--card)'; }}
                  onMouseLeave={e => { if (expanded !== alarm.id) e.currentTarget.style.background = 'var(--surface)'; }}
                >
                  <SeverityBadge severity={alarm.severity} />
                  <span className="text-sm font-medium truncate pr-4" style={{ color: 'var(--text-primary)' }}>
                    {alarm.alarm_name}
                  </span>
                  {alarm.station_id ? (
                    <Link
                      href={`/station/${alarm.station_id}`}
                      className="text-xs truncate hover:underline"
                      style={{ color: 'var(--accent)' }}
                      onClick={e => e.stopPropagation()}
                    >
                      {alarm.station_name}
                    </Link>
                  ) : (
                    <span className="text-xs truncate" style={{ color: 'var(--text-secondary)' }}>{alarm.station_name}</span>
                  )}
                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{timeAgo(alarm.raised_at)}</span>
                  <span
                    className="text-[10px] font-semibold px-2 py-1 rounded-full"
                    style={{
                      background: alarm.resolved_at ? 'var(--accent-dim)' : 'var(--offline-dim)',
                      color: alarm.resolved_at ? 'var(--accent)' : 'var(--offline)',
                    }}
                  >
                    {alarm.resolved_at ? 'Resolved' : 'Active'}
                  </span>
                  <ChevronRight
                    size={14}
                    style={{
                      color: 'var(--text-muted)',
                      transform: expanded === alarm.id ? 'rotate(90deg)' : 'none',
                      transition: 'transform 150ms',
                    }}
                  />
                </div>

                {expanded === alarm.id && (
                  <div
                    className="px-5 py-4 text-sm space-y-2"
                    style={{ background: 'var(--card)', borderTop: '1px solid var(--border)' }}
                  >
                    {alarm.cause && (
                      <div>
                        <p className="text-[10px] uppercase tracking-widest font-semibold mb-1" style={{ color: 'var(--text-muted)' }}>Cause</p>
                        <p style={{ color: 'var(--text-primary)' }}>{alarm.cause}</p>
                      </div>
                    )}
                    {alarm.repair_suggestion && (
                      <div>
                        <p className="text-[10px] uppercase tracking-widest font-semibold mb-1" style={{ color: 'var(--text-muted)' }}>Repair Suggestion</p>
                        <p style={{ color: 'var(--text-primary)' }}>{alarm.repair_suggestion}</p>
                      </div>
                    )}
                    {alarm.alarm_code && (
                      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Code: {alarm.alarm_code}</p>
                    )}
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      Raised: {new Date(alarm.raised_at).toLocaleString()}
                      {alarm.resolved_at && ` · Resolved: ${new Date(alarm.resolved_at).toLocaleString()}`}
                    </p>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}
