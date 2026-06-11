import type { Metadata, Viewport } from 'next';
import { OneViewSidebar } from '@/components/v2/oneview-sidebar';
import { OneViewFilterProvider } from '@/components/v2/filter-context';

// Console pages set a plain title (e.g. 'Command Centre') via their segment
// layout — pages themselves are client components and can't export metadata.
export const metadata: Metadata = {
  title: { default: 'Changa OneView', template: '%s · Changa OneView' },
};

// Tints mobile browser chrome Changa navy across the console.
export const viewport: Viewport = { themeColor: '#0f172a' };

// OneView console shell. The `(app)` route group keeps URLs at /v2/* while
// scoping the sidebar chrome to in-app pages (the /v2 login stays bare).
// The filter provider wraps the shell so a fleet filter set on one page
// (Stations, Fleet Map) carries across the console.
export default function OneViewAppLayout({ children }: { children: React.ReactNode }) {
  return (
    <OneViewFilterProvider>
      <div className="oneview flex h-full min-h-screen" style={{ background: 'var(--bg)' }}>
        <OneViewSidebar />
        <main className="flex-1 flex flex-col min-h-screen ml-64 overflow-auto">
          {children}
        </main>
      </div>
    </OneViewFilterProvider>
  );
}
