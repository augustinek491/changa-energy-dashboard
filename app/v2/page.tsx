import type { Viewport } from 'next';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { BrandLogo } from '@/components/v2/brand-logo';

export const metadata = {
  title: 'Changa OneView — Fleet Console',
  description: 'One console for the entire Changa Energy solar fleet.',
};

// Match the mobile browser chrome to the dark login backdrop.
export const viewport: Viewport = { themeColor: '#0f172a' };

// No-auth entry shell. A single CTA opens the Command Centre.
export default function OneViewLogin() {
  return (
    <div
      className="oneview relative flex min-h-screen items-center justify-center overflow-hidden px-6"
      style={{ background: 'var(--bg)' }}
    >
      {/* Ambient brand glow */}
      <div className="pointer-events-none absolute inset-0" style={{ background: 'var(--hero-grad)' }} />
      <div
        className="pointer-events-none absolute -bottom-40 -right-40 h-[480px] w-[480px] rounded-full opacity-40 blur-3xl"
        style={{ background: 'radial-gradient(circle, var(--accent-dim), transparent 70%)' }}
      />

      <div
        className="ov-card relative w-full max-w-md p-9 text-center"
        style={{ boxShadow: 'var(--shadow-lg)' }}
      >
        <div className="flex justify-center">
          <BrandLogo width={168} />
        </div>

        <div
          className="mt-5 inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.18em]"
          style={{ background: 'var(--accent-dim)', color: 'var(--accent)' }}
        >
          OneView
        </div>

        <h1 className="mt-6 text-2xl font-bold leading-snug" style={{ color: 'var(--text-primary)' }}>
          One console for your<br />entire solar fleet.
        </h1>
        <p className="mt-3 text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
          Every site, every manufacturer, every Rand generated — unified in a
          single live view. No more juggling separate OEM portals.
        </p>

        <Link
          href="/v2/overview"
          className="mt-7 inline-flex w-full items-center justify-center gap-2 rounded-xl px-5 py-3.5 text-sm font-bold transition-transform duration-150 hover:scale-[1.02]"
          style={{ background: 'var(--accent)', color: '#fff', boxShadow: 'var(--shadow-md)' }}
        >
          Enter Command Centre
          <ArrowRight size={17} strokeWidth={2.5} />
        </Link>

        <p className="mt-6 text-[11px]" style={{ color: 'var(--text-muted)' }}>
          21 stations · 2 manufacturers unified · Changa Energy Fleet Operations
        </p>
      </div>
    </div>
  );
}
