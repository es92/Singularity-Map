#!/usr/bin/env node
'use strict';

// precompute-reach-direct.js — Stage 2 of the reach pipeline.
//
// Reads each `<slotKey>.full.bin` produced by precompute-explore.js
// pass 2, iterates every full sel, and sets that sel's reach mask
// from the sentinel `-1` to `0 | (bits for any outcome entries the
// sel directly satisfies)`. No back-propagation: a sel only siphons
// to outcomes whose `reachable` clause matches it right now (via
// `Engine.templateMatches` / `GraphIO.matchOutcomes`), with the
// matching variant chosen by the template's `primaryDimension` value
// in the sel.
//
// After this script runs every reach entry is ≥ 0 (a 31-bit subset
// of the bits defined in `_meta.json` → `outcomeEntries`). A later
// back-propagation pass will OR in indirect reach.
//
// Run: `node precompute-reach-direct.js`. Quick — dominated by
// `matchOutcomes` per sel; ~1.88M sels finish in seconds.

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const { GraphIO } = require('./node-runtime').loadNodeRuntime({ flowPropagation: false });

const Cache = require(path.join(ROOT, 'explore-cache'));

// ─── Load outcome-entry → bit table from meta ─────────────────────
const meta = Cache.loadMeta();
if (!meta || !Array.isArray(meta.outcomeEntries)) {
    throw new Error('precompute-reach-direct: data/explore-cache/_meta.json missing — run precompute-explore.js first.');
}

// Group entries by templateId for the variant lookup. Reads the
// persisted meta so this script (and downstream consumers) doesn't
// re-enumerate templates itself.
const entryByTemplate = new Map();
for (const e of meta.outcomeEntries) {
    if (!entryByTemplate.has(e.templateId)) entryByTemplate.set(e.templateId, []);
    entryByTemplate.get(e.templateId).push(e);
}

function siphonBitsFor(sel) {
    const hits = GraphIO.matchOutcomes(sel);
    let bits = 0;
    for (const oid of hits) {
        const es = entryByTemplate.get(oid);
        if (!es) continue;
        for (const e of es) {
            if (!e.primaryDim) { bits |= e.bit; continue; }
            // primaryDim is always a sel dim (written edge-locally).
            // UNSET / missing → no variant bit fires; the sel hasn't
            // committed to a variant yet.
            if (sel[e.primaryDim] === e.variantKey) bits |= e.bit;
        }
    }
    return bits;
}

// ─── Iterate every slot's full sels, set reach masks ──────────────
const cacheDir = Cache.cacheDir();
const slotKeys = fs.readdirSync(cacheDir)
    .filter(f => f.endsWith('.full.bin'))
    .map(f => f.slice(0, -'.full.bin'.length))
    .sort();

console.log(`Direct-match pass over ${slotKeys.length} slots…\n`);
console.log('slot                          uniqSels   matched  matchPct  bitsSet  ms');
console.log('----------------------------- --------  --------  --------  -------  ----');

let totalSels = 0;
let totalMatched = 0;
let totalMs = 0;
const totalsByBit = new Array(meta.outcomeEntries.length).fill(0);

for (const slotKey of slotKeys) {
    const t0 = Date.now();
    const v = Cache.openFullSels(slotKey);
    if (!v) { console.log(`${slotKey.padEnd(29)} (load failed)`); continue; }

    let matched = 0;
    let unionBits = 0;
    for (let i = 0; i < v.selCount; i++) {
        const sel = v.getSel(i);
        const bits = siphonBitsFor(sel);
        // The sentinel was -1 ("no pass run"). After the pass every
        // entry is ≥ 0; `0 | bits` is just `bits`, but writing it
        // explicitly mirrors the user's framing: "set them to
        // 0 | (bit for outcome)".
        v.setReach(i, 0 | bits);
        if (bits !== 0) {
            matched++;
            unionBits |= bits;
            for (const e of meta.outcomeEntries) if (bits & e.bit) totalsByBit[Math.log2(e.bit) | 0]++;
        }
    }
    v.writeReach();

    const ms = Date.now() - t0;
    totalMs += ms;
    totalSels += v.selCount;
    totalMatched += matched;

    const pct = ((matched / v.selCount) * 100).toFixed(1) + '%';
    const bitCount = (unionBits.toString(2).match(/1/g) || []).length;
    console.log(
        `${slotKey.padEnd(29)} ${String(v.selCount).padStart(8)}  ${String(matched).padStart(8)}  ${pct.padStart(8)}  ${String(bitCount).padStart(7)}  ${String(ms).padStart(4)}`);
}

console.log(`\nTotal: ${totalSels.toLocaleString()} sels, ${totalMatched.toLocaleString()} matched (${((totalMatched / totalSels) * 100).toFixed(1)}%), ${(totalMs / 1000).toFixed(1)}s.`);

console.log('\nPer-outcome match counts:');
const sorted = meta.outcomeEntries
    .map(e => ({ id: e.id, count: totalsByBit[Math.log2(e.bit) | 0] }))
    .sort((a, b) => b.count - a.count);
for (const { id, count } of sorted) {
    if (count === 0) continue;
    console.log(`  ${id.padEnd(35)} ${count.toLocaleString().padStart(10)}`);
}
const zero = sorted.filter(s => s.count === 0);
if (zero.length) {
    console.log(`\n  (${zero.length} outcome entries had zero direct matches: ${zero.map(s => s.id).join(', ')})`);
}
