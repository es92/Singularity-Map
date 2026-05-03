#!/usr/bin/env node
'use strict';

// bundle-reach-binaries.js — Final step of the precompute pipeline.
// Gzips every per-slot reach binary from data/explore-cache/ into
// data/reach/, plus copies _meta.json. The browser fetches these
// directly and feeds them to ReachChecker via openFullSelsFromBuffer
// + buildIndexFromViews (mirroring the Node-side test path).
//
// Replaces derive-reach-per-outcome.js — the projection-keyed
// per-outcome JSON sets it produced were lossy (write/innerDims
// projection collapsed unrelated full sels into the same bucket,
// causing soundness false-positives on locked-mode gates). Shipping
// the slot-keyed full reach mask lets the browser run the same
// composite checker the Node tests use, eliminating the projection
// step entirely.
//
// Output layout (committed; data/reach/ is gitignored only for
// pre-migration .json files):
//   data/reach/_meta.json
//   data/reach/<slotKey>.full.bin.gz
//
// Total wire size: ~5 MB across ~20 slots (raw .full.bin total is
// ~50 MB; gzip ratio ~10× because predecessor sel arrays are highly
// repetitive). Fetched in parallel on entering locked mode.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = __dirname;
const SRC_DIR = path.join(ROOT, 'data', 'explore-cache');
const OUT_DIR = path.join(ROOT, 'data', 'reach');

if (!fs.existsSync(SRC_DIR)) {
    console.error('bundle-reach-binaries: data/explore-cache/ not found — '
        + 'run the precompute pipeline first.');
    process.exit(1);
}

const meta = path.join(SRC_DIR, '_meta.json');
if (!fs.existsSync(meta)) {
    console.error('bundle-reach-binaries: data/explore-cache/_meta.json '
        + 'missing — backprop pass did not complete.');
    process.exit(1);
}

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

// Wipe any leftover artifacts (old per-outcome .json.gz files,
// stale slot binaries from a prior schema). The bundle is fully
// regenerated each run; partial overwrites would leave dead files
// in the committed tree.
for (const f of fs.readdirSync(OUT_DIR)) {
    if (f === '.' || f === '..') continue;
    fs.unlinkSync(path.join(OUT_DIR, f));
}

fs.copyFileSync(meta, path.join(OUT_DIR, '_meta.json'));

const slotFiles = fs.readdirSync(SRC_DIR)
    .filter(f => f.endsWith('.full.bin'))
    .sort();

const manifest = { slots: [] };
let totalRaw = 0;
let totalGz = 0;

for (const f of slotFiles) {
    const slotKey = f.slice(0, -'.full.bin'.length);
    const src = path.join(SRC_DIR, f);
    const raw = fs.readFileSync(src);
    // Level 9 — these files are written once per precompute and
    // shipped to every viewer; the extra second per slot is well
    // worth shaving ~5% off the wire size.
    const gz = zlib.gzipSync(raw, { level: 9 });
    const out = path.join(OUT_DIR, slotKey + '.full.bin.gz');
    fs.writeFileSync(out, gz);

    manifest.slots.push({
        slotKey,
        raw: raw.length,
        gz: gz.length,
    });
    totalRaw += raw.length;
    totalGz += gz.length;
}

// Manifest lets the browser fetch only the slot list it needs without
// having to enumerate the directory (no listing on static hosts).
fs.writeFileSync(
    path.join(OUT_DIR, '_manifest.json'),
    JSON.stringify(manifest, null, 2)
);

const fmt = (n) => (n / 1024 / 1024).toFixed(2) + ' MB';
console.log(`bundle-reach-binaries: wrote ${slotFiles.length} slot binaries.`);
console.log(`  raw=${fmt(totalRaw)}  gz=${fmt(totalGz)}  ratio=${(totalRaw / totalGz).toFixed(1)}×`);
console.log(`  out=${path.relative(ROOT, OUT_DIR)}/`);
