import type { MetadataRoute } from 'next';

// Served at /manifest.webmanifest. "Add to Home Screen" installs the console
// as a standalone app named Changa OneView, opening on the Command Centre.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Changa OneView',
    short_name: 'OneView',
    description: 'Solar fleet console for Changa Energy — every site, every OEM, one place.',
    start_url: '/v2/overview',
    display: 'standalone',
    background_color: '#0f172a',
    theme_color: '#0f172a',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
