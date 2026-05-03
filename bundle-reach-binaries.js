#!/usr/bin/env node
'use strict';

// bundle-reach-binaries.js — Final step of the precompute pipeline.
// Splits the per-slot reach masks in data/explore-cache/*.full.bin
// into per-outcome binaries the browser fetches on lock.
//
// One file per outcome entry (28 currently): for each outcome, every
// (slot, sel) whose precomputed forward-reach mask had that outcome's
// bit set is dumped as a dense byte row, with predecessors + reach
// mask + outcome metadata stripped (the runtime gate doesn't need
// them — see reach-checker.js docs).
//
// Layout matches `ExploreCache.openOutcomeFromBuffer`:
//
//   [u32 LE: headerLen]
//   [headerLen bytes: JSON header, UTF-8]
//   [body: contiguous per-slot dense sel rows]
//
// Header shape:
//   {
//     v: 1,
//     entryId, templateId, primaryDim, variantKey, bit,
//     values:  [string, …]                  shared dictionary; [0] = "" (UNSET)
//     slots:   [{ key, kind, id, dims, selCount, byteOff }]
//   }
//
// Why per-outcome instead of per-slot? Two compounding wins:
//   * Drop predecessors — they're precompute-only, never read by the
//     runtime checker. Strips ~75% of every slot file.
//   * Drop unrelated outcomes — most outcomes reach a small fraction
//     of the global reach DAG. Filtering to one bit drops another
//     ~10–20× of the per-outcome bundle size.
//
// Net: ~50–200 KB gzipped per outcome (vs 4 MB for the prior all-
// slots-all-outcomes bundle). Browsers fetch only the locked outcome.

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

const metaPath = path.join(SRC_DIR, '_meta.json');
if (!fs.existsSync(metaPath)) {
    console.error('bundle-reach-binaries: data/explore-cache/_meta.json '
        + 'missing — backprop pass did not complete.');
    process.exit(1);
}

const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
if (!Array.isArray(meta.outcomeEntries) || !meta.outcomeEntries.length) {
    console.error('bundle-reach-binaries: _meta.json has no outcomeEntries.');
    process.exit(1);
}

// Use the same loader the runtime tests use so dim/value vocab and
// byte encoding stay byte-identical with the pass-2 binary the
// runtime sees on disk.
const Cache = require('./explore-cache');

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

// Wipe stale artifacts (per-slot binaries from the previous bundle
// scheme, old per-outcome JSON sets, manifests). Per-outcome files
// are fully regenerated each run — partial overwrites would leave
// dead bytes shipped on the next deploy.
for (const f of fs.readdirSync(OUT_DIR)) {
    if (f === '.' || f === '..') continue;
    fs.unlinkSync(path.join(OUT_DIR, f));
}

// Copy outcome-entry metadata; the browser uses it to map a locked
// templateId+variantKey → entryId (the per-outcome filename) without
// having to recompute the bit assignment.
fs.writeFileSync(path.join(OUT_DIR, '_meta.json'),
    JSON.stringify({
        v: 2,
        outcomeEntries: meta.outcomeEntries.map(e => ({
            id: e.id, templateId: e.templateId,
            primaryDim: e.primaryDim, variantKey: e.variantKey,
            bit: e.bit | 0,
        })),
    }, null, 2));

// ── Pass 1: load every slot's full-sel view ────────────────────────
// We load all slots upfront, walk each (sel, mask) once per slot,
// and demux into per-outcome buckets. O(slotCount × selCount × outcomeCount)
// in the worst case but each step is a bitmask test → cheap.

const slotFiles = fs.readdirSync(SRC_DIR)
    .filter(f => f.endsWith('.full.bin'))
    .sort();

const slotViews = [];
for (const f of slotFiles) {
    const slotKey = f.slice(0, -'.full.bin'.length);
    const v = Cache.openFullSels(slotKey);
    if (!v) continue;
    slotViews.push(v);
}

// ── Pass 2: per-outcome demux ──────────────────────────────────────
// For each outcome bit, walk every slot's sels once and collect
// matching row indices. Stored as Uint32Array per (outcome, slot)
// bucket for compactness.

const outcomes = meta.outcomeEntries;
// rowIdxsByOutcome[i] : Map<slotKey, Uint32Array(selRowIdxs)>
const rowIdxsByOutcome = outcomes.map(() => new Map());

for (const sv of slotViews) {
    // Pre-allocate growable typed arrays per outcome (start small,
    // double on overflow) to skip the JS Array → Uint32Array
    // conversion overhead at the end.
    const buckets = outcomes.map(() => ({ buf: new Uint32Array(64), n: 0 }));

    for (let i = 0; i < sv.selCount; i++) {
        const mask = sv.getReach(i) | 0;
        if (!mask) continue;
        for (let oi = 0; oi < outcomes.length; oi++) {
            if ((mask & outcomes[oi].bit) === 0) continue;
            const b = buckets[oi];
            if (b.n === b.buf.length) {
                const grown = new Uint32Array(b.buf.length * 2);
                grown.set(b.buf);
                b.buf = grown;
            }
            b.buf[b.n++] = i;
        }
    }

    for (let oi = 0; oi < outcomes.length; oi++) {
        const b = buckets[oi];
        if (b.n === 0) continue;
        rowIdxsByOutcome[oi].set(sv.slotKey, b.buf.subarray(0, b.n));
    }
}

// ── Pass 3: write each per-outcome binary ──────────────────────────
//
// Per-outcome files share a single `values` dictionary (the union
// across every slot's vocab) so the JSON header is small even for
// outcomes that span many slots. selBytes is the dominant payload —
// `selCount × dimsLen` for every (slot, outcome) bucket.

const manifest = { v: 2, entries: [] };
let totalRaw = 0;
let totalGz = 0;

for (let oi = 0; oi < outcomes.length; oi++) {
    const entry = outcomes[oi];
    const rowsBySlot = rowIdxsByOutcome[oi];
    if (rowsBySlot.size === 0) {
        // No (slot, sel) pair in the entire reach DAG can reach this
        // outcome — this would mean the precompute considers it
        // unreachable. Surface as a hard error: the random-walks
        // test would catch it later, but bundle-time is cheaper.
        throw new Error('bundle-reach-binaries: outcome '
            + entry.id + ' has zero reachable (slot, sel) entries '
            + '— precompute soundness gap or unreachable variant.');
    }

    // Build a unified value dictionary across every slot in this
    // outcome. Each slot's view has its own dim+value indexing in
    // its source .full.bin; we re-index here so the per-outcome
    // file has one shared values[] (smaller header, simpler parser).
    // values[0] is reserved for "" (UNSET) per the dense-byte
    // encoding contract.
    const valueSet = new Map();
    valueSet.set('', 0);
    function valueIdx(v) {
        if (valueSet.has(v)) return valueSet.get(v);
        const idx = valueSet.size;
        valueSet.set(v, idx);
        return idx;
    }

    // Slot bodies + dim arrays.
    const slotBlobs = []; // { key, kind, id, dims, selCount, bytes }
    for (const sv of slotViews) {
        const idxs = rowsBySlot.get(sv.slotKey);
        if (!idxs) continue;
        const dims = sv.dims;
        const dimsLen = dims.length;
        const bytes = new Uint8Array(idxs.length * dimsLen);
        for (let r = 0; r < idxs.length; r++) {
            const srcRow = idxs[r];
            for (let j = 0; j < dimsLen; j++) {
                const srcVi = sv.getSelValueIdx(srcRow, j);
                if (srcVi === 0) {
                    bytes[r * dimsLen + j] = 0;
                } else {
                    bytes[r * dimsLen + j] = valueIdx(sv.values[srcVi]);
                }
            }
        }
        slotBlobs.push({
            key: sv.slotKey, kind: sv.slotKind, id: sv.slotId,
            dims, selCount: idxs.length, bytes,
        });
    }

    const values = new Array(valueSet.size);
    for (const [v, i] of valueSet) values[i] = v;

    // Compute byteOff for each slot before serializing the header
    // (header records absolute offsets relative to the body start;
    // bodies are concatenated in slot order).
    let byteOff = 0;
    const headerSlots = slotBlobs.map(s => {
        const off = byteOff;
        byteOff += s.bytes.byteLength;
        return {
            key: s.key, kind: s.kind, id: s.id,
            dims: s.dims, selCount: s.selCount, byteOff: off,
        };
    });

    const headerObj = {
        v: 1,
        entryId: entry.id,
        templateId: entry.templateId,
        primaryDim: entry.primaryDim,
        variantKey: entry.variantKey,
        bit: entry.bit | 0,
        values,
        slots: headerSlots,
    };
    const headerJson = Buffer.from(JSON.stringify(headerObj), 'utf8');
    const headerLen = headerJson.byteLength;
    const bodyLen = byteOff;

    const out = Buffer.allocUnsafe(4 + headerLen + bodyLen);
    out.writeUInt32LE(headerLen, 0);
    headerJson.copy(out, 4);
    let off = 4 + headerLen;
    for (const s of slotBlobs) {
        Buffer.from(s.bytes.buffer, s.bytes.byteOffset, s.bytes.byteLength).copy(out, off);
        off += s.bytes.byteLength;
    }

    // Level 9 — written once per precompute, served on every lock;
    // an extra second per outcome shaves ~5% off wire size.
    const gz = zlib.gzipSync(out, { level: 9 });
    fs.writeFileSync(path.join(OUT_DIR, entry.id + '.bin.gz'), gz);

    const totalSels = slotBlobs.reduce((a, s) => a + s.selCount, 0);
    manifest.entries.push({
        id: entry.id,
        slots: slotBlobs.length,
        sels: totalSels,
        raw: out.byteLength,
        gz: gz.byteLength,
    });
    totalRaw += out.byteLength;
    totalGz += gz.byteLength;
}

fs.writeFileSync(path.join(OUT_DIR, '_manifest.json'),
    JSON.stringify(manifest, null, 2));

const fmt = (n) => (n / 1024 / 1024).toFixed(2) + ' MB';
const fmtKb = (n) => (n / 1024).toFixed(1) + ' KB';
console.log(`bundle-reach-binaries: wrote ${outcomes.length} per-outcome binaries.`);
console.log(`  raw=${fmt(totalRaw)}  gz=${fmt(totalGz)}  ratio=${(totalRaw / totalGz).toFixed(1)}×`);

// Summary table — sorted by gz desc, helps spot outcomes whose reach
// data is unexpectedly fat (often a sign of an underconstrained
// `reachable` clause).
const sorted = manifest.entries.slice().sort((a, b) => b.gz - a.gz);
console.log('  ─── per-outcome ───');
for (const e of sorted) {
    console.log('    ' + e.id.padEnd(45)
        + 'sels=' + String(e.sels).padStart(7)
        + '  gz=' + fmtKb(e.gz).padStart(9));
}
console.log(`  out=${path.relative(ROOT, OUT_DIR)}/`);
