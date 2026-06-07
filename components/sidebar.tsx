'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Bell,
  BarChart3,
  Zap,
  Mail,
} from 'lucide-react';

const nav = [
  { href: '/', label: 'Fleet Overview', icon: LayoutDashboard },
  { href: '/alarms', label: 'Alarms & Alerts', icon: Bell },
  { href: '/analytics', label: 'Analytics', icon: BarChart3 },
  { href: '/reports', label: 'Reports', icon: Mail },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside
      className="fixed left-0 top-0 h-full w-60 flex flex-col z-20"
      style={{ background: 'var(--surface)', borderRight: '1px solid var(--border)' }}
    >
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-5 py-5" style={{ borderBottom: '1px solid var(--border)' }}>
        <div
          className="flex items-center justify-center w-8 h-8 rounded-lg"
          style={{ background: 'var(--accent)' }}
        >
          <Zap size={16} color="#fff" strokeWidth={2.5} />
        </div>
        <div>
          <div className="font-bold text-sm leading-tight tracking-wide" style={{ color: 'var(--text-primary)' }}>
            CHANGA
          </div>
          <div className="text-xs leading-tight" style={{ color: 'var(--text-secondary)' }}>
            Solar Monitor
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5">
        <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
          Navigation
        </p>
        {nav.map(({ href, label, icon: Icon }) => {
          const isActive = href === '/'
            ? pathname === '/' || pathname.startsWith('/station')
            : pathname === href;
          return (
            <Link
              key={href}
              href={href}
              className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 cursor-pointer"
              style={{
                background: isActive ? 'var(--accent-dim)' : 'transparent',
                color: isActive ? 'var(--accent)' : 'var(--text-secondary)',
              }}
            >
              <Icon size={16} strokeWidth={isActive ? 2.5 : 2} />
              {label}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="px-5 py-4" style={{ borderTop: '1px solid var(--border)' }}>
        <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
          21 stations monitored
        </p>
        <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
          Changa Energy © 2026
        </p>
      </div>
    </aside>
  );
}
