'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard, Map, Building2, Wallet,
  Gauge, Bell, FileText, ArrowLeft,
} from 'lucide-react';
import { BrandLogo } from './brand-logo';
import { OEMS } from '@/lib/v2/brand';

type NavItem = { href: string; label: string; icon: typeof LayoutDashboard };

const sections: { title: string; items: NavItem[] }[] = [
  {
    title: 'Monitor',
    items: [
      { href: '/v2/overview', label: 'Command Centre', icon: LayoutDashboard },
      { href: '/v2/map', label: 'Fleet Map', icon: Map },
      { href: '/v2/stations', label: 'Stations', icon: Building2 },
    ],
  },
  {
    title: 'Insights',
    items: [
      { href: '/v2/financials', label: 'Financials', icon: Wallet },
      { href: '/v2/performance', label: 'Performance', icon: Gauge },
    ],
  },
  {
    title: 'Operations',
    items: [
      { href: '/v2/alerts', label: 'Alert Centre', icon: Bell },
      { href: '/v2/reports', label: 'Reports', icon: FileText },
    ],
  },
];

export function OneViewSidebar() {
  const pathname = usePathname();
  const connected = Object.values(OEMS).filter(o => o.live);

  return (
    <aside
      className="fixed left-0 top-0 h-full w-64 flex flex-col z-20"
      style={{ background: 'var(--surface)', borderRight: '1px solid var(--border)' }}
    >
      {/* Brand */}
      <div className="px-5 py-5" style={{ borderBottom: '1px solid var(--border)' }}>
        <BrandLogo width={140} />
        <div
          className="mt-2.5 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-[0.18em]"
          style={{ background: 'var(--accent-dim)', color: 'var(--accent)' }}
        >
          OneView
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
        {sections.map(section => (
          <div key={section.title}>
            <p
              className="px-3 pb-2 text-[10px] font-bold uppercase tracking-[0.16em]"
              style={{ color: 'var(--text-muted)' }}
            >
              {section.title}
            </p>
            <div className="space-y-0.5">
              {section.items.map(({ href, label, icon: Icon }) => {
                const active = pathname === href || pathname.startsWith(href + '/');
                return (
                  <Link
                    key={href}
                    href={href}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-semibold transition-all duration-150"
                    style={{
                      background: active ? 'var(--accent-dim)' : 'transparent',
                      color: active ? 'var(--accent)' : 'var(--text-secondary)',
                    }}
                  >
                    <Icon size={17} strokeWidth={active ? 2.5 : 2} />
                    {label}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Connected OEMs — the unify story, made visible */}
      <div className="px-5 py-4 space-y-3" style={{ borderTop: '1px solid var(--border)' }}>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] mb-2" style={{ color: 'var(--text-muted)' }}>
            Connected OEMs
          </p>
          <div className="flex flex-wrap gap-1.5">
            {connected.map(o => (
              <span
                key={o.key}
                className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-semibold"
                style={{ background: 'var(--card)', color: 'var(--text-secondary)' }}
              >
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: o.color }} />
                {o.label}
              </span>
            ))}
          </div>
        </div>
        <Link
          href="/"
          className="flex items-center gap-2 text-[11px] font-medium transition-colors"
          style={{ color: 'var(--text-muted)' }}
        >
          <ArrowLeft size={12} />
          Classic dashboard
        </Link>
      </div>
    </aside>
  );
}
