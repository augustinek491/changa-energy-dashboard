import { OneViewSidebar } from '@/components/v2/oneview-sidebar';
import { OneViewFilterProvider } from '@/components/v2/filter-context';

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
