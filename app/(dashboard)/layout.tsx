import { Sidebar } from '@/components/sidebar';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full">
      <Sidebar />
      <div className="flex-1 flex flex-col min-h-full ml-60 overflow-auto" style={{ background: 'var(--bg)' }}>
        {children}
      </div>
    </div>
  );
}
