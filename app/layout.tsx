import type { Metadata } from 'next';
import { Plus_Jakarta_Sans, Montserrat } from 'next/font/google';
import { ThemeProvider } from '@/components/theme-provider';
import './globals.css';

const jakartaSans = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  variable: '--font-jakarta',
  display: 'swap',
});

// Changa brand typeface (changaenergy.com) — used by the OneView v2 console.
const montserrat = Montserrat({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-montserrat',
  display: 'swap',
});

export const metadata: Metadata = {
  metadataBase: new URL('https://changaenergydashboard.vercel.app'),
  applicationName: 'Changa OneView',
  title: 'Changa Energy — Solar Dashboard',
  description: 'Real-time solar monitoring for Changa Energy fleet',
  // Internal fleet console with live client power data — keep out of search engines.
  robots: { index: false, follow: false },
  openGraph: {
    type: 'website',
    siteName: 'Changa OneView',
    title: 'Changa Energy — Solar Fleet Console',
    description: 'Every site, every OEM, one console. Live monitoring for the Changa Energy solar fleet.',
    locale: 'en_ZA',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Changa Energy — Solar Fleet Console',
    description: 'Every site, every OEM, one console. Live monitoring for the Changa Energy solar fleet.',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${jakartaSans.variable} ${montserrat.variable} h-full`} suppressHydrationWarning>
      <body className="h-full antialiased">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
