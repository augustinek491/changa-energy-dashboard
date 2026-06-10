'use client';

import { Sun, Moon, RefreshCw } from 'lucide-react';
import { useTheme } from '@/components/theme-provider';

interface Props {
  title: string;
  subtitle?: string;
  lastUpdated?: string | null;
  onRefresh?: () => void;
  refreshing?: boolean;
  children?: React.ReactNode; // optional toolbar slot (filters etc.)
}

export function OneViewHeader({ title, subtitle, lastUpdated, onRefresh, refreshing, children }: Props) {
  const { theme, toggle } = useTheme();

  return (
    <header
      className="sticky top-0 z-10 flex items-center justify-between gap-4 px-7 py-4"
      style={{
        background: 'color-mix(in srgb, var(--surface) 88%, transparent)',
        borderBottom: '1px solid var(--border)',
        backdropFilter: 'blur(8px)',
      }}
    >
      <div className="min-w-0">
        <h1 className="text-xl font-bold leading-tight truncate" style={{ color: 'var(--text-primary)' }}>
          {title}
        </h1>
        {subtitle && (
          <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--text-secondary)' }}>{subtitle}</p>
        )}
      </div>

      <div className="flex items-center gap-3 shrink-0">
        {children}
        {lastUpdated && (
          <span
            className="hidden md:inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-[11px] font-medium"
            style={{ background: 'var(--card)', color: 'var(--text-secondary)' }}
          >
            <span className="relative flex w-2 h-2">
              <span className="absolute inline-flex w-full h-full rounded-full opacity-60 animate-ping" style={{ background: 'var(--accent)' }} />
              <span className="relative inline-flex w-2 h-2 rounded-full" style={{ background: 'var(--accent)' }} />
            </span>
            Live · {new Date(lastUpdated).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
        {onRefresh && (
          <button
            onClick={onRefresh}
            disabled={refreshing}
            title="Refresh data"
            className="flex items-center justify-center w-9 h-9 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
            style={{ background: 'var(--card)', color: 'var(--text-secondary)' }}
          >
            <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />
          </button>
        )}
        <button
          onClick={toggle}
          title="Toggle theme"
          className="flex items-center justify-center w-9 h-9 rounded-lg transition-colors cursor-pointer"
          style={{ background: 'var(--card)', color: 'var(--text-secondary)' }}
        >
          {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
        </button>
      </div>
    </header>
  );
}
