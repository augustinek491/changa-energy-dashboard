'use client';

import { Sun, Moon, RefreshCw } from 'lucide-react';
import { useTheme } from '@/components/theme-provider';

interface HeaderProps {
  title: string;
  subtitle?: string;
  lastUpdated?: string | null;
  onRefresh?: () => void;
  refreshing?: boolean;
}

export function Header({ title, subtitle, lastUpdated, onRefresh, refreshing }: HeaderProps) {
  const { theme, toggle } = useTheme();

  return (
    <header
      className="sticky top-0 z-10 flex items-center justify-between px-6 py-4"
      style={{
        background: 'var(--surface)',
        borderBottom: '1px solid var(--border)',
        boxShadow: 'var(--shadow-sm)',
      }}
    >
      <div>
        <h1 className="text-lg font-semibold leading-tight" style={{ color: 'var(--text-primary)' }}>
          {title}
        </h1>
        {subtitle && (
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>{subtitle}</p>
        )}
      </div>

      <div className="flex items-center gap-3">
        {lastUpdated && (
          <span className="text-xs hidden sm:block" style={{ color: 'var(--text-muted)' }}>
            Updated {new Date(lastUpdated).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
        {onRefresh && (
          <button
            onClick={onRefresh}
            disabled={refreshing}
            title="Refresh data"
            className="flex items-center justify-center w-8 h-8 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
            style={{ background: 'var(--card)', color: 'var(--text-secondary)' }}
          >
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
          </button>
        )}
        <button
          onClick={toggle}
          title="Toggle theme"
          className="flex items-center justify-center w-8 h-8 rounded-lg transition-colors cursor-pointer"
          style={{ background: 'var(--card)', color: 'var(--text-secondary)' }}
        >
          {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
        </button>
      </div>
    </header>
  );
}
