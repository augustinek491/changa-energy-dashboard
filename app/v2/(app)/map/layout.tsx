import type { Metadata } from 'next';

// Title-only segment layout: the page is a client component and can't export metadata.
export const metadata: Metadata = { title: 'Fleet Map' };

export default function MapLayout({ children }: { children: React.ReactNode }) {
  return children;
}
