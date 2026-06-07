#!/usr/bin/env node
/**
 * scripts/cron-local.js
 * Local development cron runner — mirrors the Vercel schedule against localhost:3000.
 *
 * Usage:  npm run cron:local
 *
 * Schedule (matches vercel.json):
 *   Every 5 min  → /api/cron/live, /api/cron/alarms
 *   Every 60 min → /api/cron/daily, /api/cron/sync-fusionsolar-hourly
 *   (monthly/yearly/cleanup are too infrequent for local dev — run manually if needed)
 */

const fs   = require('fs');
const path = require('path');

// ── Load .env.local so CRON_SECRET is available ─────────────────────────────
try {
  const envPath = path.join(__dirname, '..', '.env.local');
  const lines   = fs.readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (!(key in process.env)) process.env[key] = val;
  }
} catch {
  // .env.local not found — rely on existing environment variables
}

const BASE   = process.env.CRON_BASE_URL ?? 'http://localhost:3000';
const SECRET = process.env.CRON_SECRET;

if (!SECRET) {
  console.error('❌  CRON_SECRET is not set. Add it to .env.local or export it before running.');
  process.exit(1);
}

const HEADERS = { Authorization: `Bearer ${SECRET}` };

// ── Helper ───────────────────────────────────────────────────────────────────
async function hit(path) {
  const ts = new Date().toISOString().slice(11, 19);
  try {
    const res  = await fetch(`${BASE}${path}`, { headers: HEADERS });
    const json = await res.json();
    const ok   = json.ok !== false && res.ok;
    if (ok) {
      console.log(`✅  [${ts}] ${path}`);
    } else {
      console.warn(`⚠️   [${ts}] ${path}`, JSON.stringify(json).slice(0, 120));
    }
  } catch (e) {
    console.error(`❌  [${ts}] ${path} — ${e.message}`);
  }
}

// ── Job groups ───────────────────────────────────────────────────────────────
async function runFiveMin() {
  await hit('/api/cron/live');
  await hit('/api/cron/alarms');
}

async function runHourly() {
  await hit('/api/cron/daily');
  await hit('/api/cron/sync-fusionsolar-hourly');
}

// ── Start ────────────────────────────────────────────────────────────────────
console.log(`🌞  Changa local cron runner — targeting ${BASE}`);
console.log('    5-min  → live, alarms');
console.log('    60-min → daily KPIs, FusionSolar hourly readings');
console.log('    Press Ctrl+C to stop.\n');

// Run both immediately so data is fresh on startup
runFiveMin();
runHourly();

// Schedule recurring
setInterval(runFiveMin,  5  * 60 * 1000);   //  5 minutes
setInterval(runHourly,  60 * 60 * 1000);   // 60 minutes
