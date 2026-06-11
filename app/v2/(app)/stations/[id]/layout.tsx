import type { Metadata } from 'next';

// Title-only segment layout: the page is a client component and can't export metadata.
export const metadata: Metadata = { title: 'Station Detail' };

export default function StationDetailLayout({ children }: { children: React.ReactNode }) {
  return children;
}
