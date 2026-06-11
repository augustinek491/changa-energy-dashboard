// Generates every Changa brand asset that Next.js picks up by file convention:
//
//   app/favicon.ico            16+32+48 PNG-in-ICO (legacy /favicon.ico requests)
//   app/icon.svg               vector favicon for modern browsers
//   app/apple-icon.png         180×180, navy tile (iOS home screen)
//   public/icons/icon-192.png  Android / web-app-manifest icon
//   public/icons/icon-512.png  Android / web-app-manifest icon
//   app/opengraph-image.png    1200×630 social-share card (WhatsApp/LinkedIn/Slack)
//   app/twitter-image.png      same card for Twitter/X
//
// Run once after changing the brand artwork:  node scripts/generate-brand-assets.mjs
// Outputs are committed as static files — production never runs this.

import sharp from 'sharp';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const NAVY = '#0f172a'; // report/header dark navy, used as tile + card background

// The circular Changa emblem — the first six shapes of the brand lockup
// (dark disc, two green arcs, grey C-ring, grey bar, lightning bolt).
// The wordmark starts at x≈49 in the full SVG; everything below is < x=43.
// Self-contained dark disc, so it reads correctly on light AND dark surfaces.
const EMBLEM_SHAPES = `
	<path fill="#303642" d="M42.435,21.307c0,11.66-9.452,21.109-21.111,21.109c-11.66,0-21.112-9.449-21.112-21.109c0-11.661,9.452-21.111,21.112-21.111C32.983,0.195,42.435,9.646,42.435,21.307"/>
	<path fill="#00A651" d="M6.317,13.783l-0.182,0.373C8.837,7.984,14.999,3.673,22.167,3.673c5.004,0,9.512,2.1,12.698,5.467l-1.997,2.107c-2.667-2.873-6.474-4.674-10.701-4.674c-5.366,0-10.055,2.896-12.591,7.21H6.317z"/>
	<path fill="#00A651" d="M35.435,32.57c-3.206,3.732-7.959,6.096-13.268,6.096c-7.437,0-13.791-4.641-16.321-11.188l1.678-2.113l0.493-0.619c1.593,6.334,7.324,11.02,14.15,11.02c4.35,0,8.256-1.904,10.931-4.926L35.435,32.57z"/>
	<path fill="#D1D3D4" d="M31.752,29.232c-2.269,2.641-5.633,4.312-9.386,4.312c-6.486,0-11.807-4.988-12.331-11.34l0.982-1.238l1.101-1.385h-2.029c0.779-6.085,5.979-10.789,12.277-10.789c3.538,0,6.728,1.487,8.982,3.865l-1.414,1.496c-1.885-2.035-4.578-3.307-7.568-3.307c-5.154,0-9.425,3.774-10.199,8.708c-0.081,0.525-0.125,1.064-0.125,1.612c0,0.271,0.011,0.539,0.03,0.807c0.411,5.324,4.861,9.52,10.294,9.52c3.078,0,5.84-1.35,7.729-3.484L31.752,29.232z"/>
	<polygon fill="#D1D3D4" points="29.263,19.556 29.263,21.975 10.168,21.975 10.168,20.967 11.321,19.582 10.168,19.582 10.168,19.556 "/>
	<polyline fill="#D1D3D4" points="1.954,22.715 6.134,14.157 6.318,13.783 10.765,13.783 7.824,19.583 12.119,19.583 11.018,20.967 10.036,22.205 8.016,24.746 7.524,25.365 5.845,27.479 3.531,30.395 5.268,25.717 6.472,22.48 "/>`;

const emblemSvg = (size) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 42.611 42.611">${EMBLEM_SHAPES}\n</svg>`;

// Render the emblem to a square transparent PNG at an exact pixel size.
const emblemPng = (px) =>
  sharp(Buffer.from(emblemSvg(px)), { density: 300 })
    .resize(px, px, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

// Emblem centred on a navy tile (Apple + Android icons must not be transparent).
async function tilePng(px, emblemRatio) {
  const inner = Math.round(px * emblemRatio);
  const emblem = await emblemPng(inner);
  return sharp({ create: { width: px, height: px, channels: 4, background: NAVY } })
    .composite([{ input: emblem, gravity: 'centre' }])
    .png()
    .toBuffer();
}

// Pack PNG buffers into a .ico container (PNG-in-ICO, supported by every
// modern browser and by Windows since Vista).
function pngsToIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(entries.length, 4);

  const dir = [];
  const blobs = [];
  let offset = 6 + 16 * entries.length;
  for (const { size, buf } of entries) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0); // width  (0 = 256)
    e.writeUInt8(size >= 256 ? 0 : size, 1); // height
    e.writeUInt16LE(1, 4); // colour planes
    e.writeUInt16LE(32, 6); // bits per pixel
    e.writeUInt32LE(buf.length, 8);
    e.writeUInt32LE(offset, 12);
    dir.push(e);
    blobs.push(buf);
    offset += buf.length;
  }
  return Buffer.concat([header, ...dir, ...blobs]);
}

// 1200×630 social-share card: navy field, soft green glow, white lockup, tagline.
function ogSvg() {
  // The full white lockup ships in public/ — reuse its inner markup verbatim.
  const lockup = readFileSync(join(root, 'public/changa-logo-white.svg'), 'utf8')
    .replace(/^[\s\S]*?<svg[^>]*>/, '')
    .replace(/<\/svg>\s*$/, '');
  // 620px-wide lockup keeps the original 156.158:42.611 aspect (≈ 620×169).
  // The nested <svg> needs BOTH width and height — librsvg defaults a missing
  // height to 100% of the canvas and mis-centres the artwork.
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <radialGradient id="glow" cx="0.5" cy="0.40" r="0.85">
      <stop offset="0" stop-color="#17a655" stop-opacity="0.18"/>
      <stop offset="0.55" stop-color="#17a655" stop-opacity="0.05"/>
      <stop offset="1" stop-color="#17a655" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1200" height="630" fill="${NAVY}"/>
  <rect width="1200" height="630" fill="url(#glow)"/>
  <svg x="290" y="180" width="620" height="169.2" viewBox="0 0 156.158 42.611">${lockup}</svg>
  <rect x="560" y="412" width="80" height="5" rx="2.5" fill="#17a655"/>
  <text x="594" y="474" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="30" letter-spacing="12" fill="#94a3b8">SOLAR FLEET CONSOLE</text>
</svg>`;
}

const out = (rel, buf) => {
  const p = join(root, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, buf);
  console.log(`wrote ${rel}  (${buf.length} bytes)`);
};

const ico = pngsToIco([
  { size: 16, buf: await emblemPng(16) },
  { size: 32, buf: await emblemPng(32) },
  { size: 48, buf: await emblemPng(48) },
]);
out('app/favicon.ico', ico);

out('app/icon.svg', Buffer.from(emblemSvg(42.611)));

out('app/apple-icon.png', await tilePng(180, 0.64));
out('public/icons/icon-192.png', await tilePng(192, 0.62));
out('public/icons/icon-512.png', await tilePng(512, 0.62));

const og = await sharp(Buffer.from(ogSvg()), { density: 144 })
  .resize(1200, 630)
  .png()
  .toBuffer();
out('app/opengraph-image.png', og);
out('app/twitter-image.png', og);

console.log('done');
