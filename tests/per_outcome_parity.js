#!/usr/bin/env node
'use strict';

// per_outcome_parity.js — Structural parity between the per-outcome
// browser bundle (data/reach/<entryId>.bin.gz) and the bit-filtered
// projection of the slot-level cache (data/explore-cache/*.full.bin).
//
// For every outcome entry, asserts:
//
//   per_outcome[entryId].slots[k].sels  ==  { sel | slotCache[k].mask(sel) & entry.bit ≠ 0 }
//
// in BOTH directions (no missing, no extras). Catches:
//
//   * bundle script dropping the wrong sels (off-by-one bit, wrong
//     slot ordering, dim-vocab drift between source and per-outcome
//     re-encoding)
//   * runtime gate seeing a sel the precompute thought was unreachable
//     (would surface as a "no extras" failure)
//
// Cheap: no walks, no DFS — pure set-difference per outcome.
// Runs in seconds across all 28 outcomes.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const assert = require('assert');

const ROOT = path.resolve(__dirname, '..');
const Cache = require(path.join(ROOT, 'explore-cache'));
const ReachChecker = require(path.join(ROOT, 'reach-checker'));

const meta = Cache.loadMeta();
if (!meta || !Array.isArray(meta.outcomeEntries)) {
    console.error('per_outcome_parity: data/explore-cache/_meta.json missing — '
        + 'run `npm run precompute` first.');
    process.exit(2);
}

const REACH_DIR = path.join(ROOT, 'data', 'reach');
if (!fs.existsSync(path.join(REACH_DIR, '_meta.json'))) {
    console.error('per_outcome_parity: data/reach/_meta.json missing — '
        + 'run `node bundle-reach-binaries.js` after precompute.');
    process.exit(2);
}

// ── Build expected: { entryId → { slotKey → Set<selKey> } } ────
//
// Source of truth is the slot-level cache. For each outcome bit,
// walk every slot's (sel, mask) and add selKey to the bucket when
// mask & bit ≠ 0. Reuses ReachChecker._selKey so the canonical
// string format stays in sync with both the runtime gate and the
// per-outcome view's getSelKey().

console.log('Building expected sets from data/explore-cache…');
const expected = new Map();
for (const e of meta.outcomeEntries) expected.set(e.id, new Map());

const slotFiles = fs.readdirSync(Cache.cacheDir())
    .filter(f => f.endsWith('.full.bin'))
    .sort();

for (const f of slotFiles) {
    const slotKey = f.slice(0, -'.full.bin'.length);
    const v = Cache.openFullSels(slotKey);
    if (!v) continue;
    for (let i = 0; i < v.selCount; i++) {
        const mask = v.getReach(i) | 0;
        if (!mask) continue;
        const sel = v.getSel(i);
        const sk = ReachChecker._selKey(sel);
        for (const e of meta.outcomeEntries) {
            if ((mask & e.bit) === 0) continue;
            const slotMap = expected.get(e.id);
            let s = slotMap.get(slotKey);
            if (!s) { s = new Set(); slotMap.set(slotKey, s); }
            s.add(sk);
        }
    }
}

let totalExpected = 0;
for (const slotMap of expected.values()) {
    for (const s of slotMap.values()) totalExpected += s.size;
}
console.log(`  ${totalExpected.toLocaleString()} (entry, slot, sel) bindings expected.`);

// ── Build actual: { entryId → { slotKey → Set<selKey> } } ─────
//
// Source of comparison is the per-outcome bundle the browser fetches.
// Each outcome file is parsed, then each slot's getSelKey is materialized
// into a Set for direct difference against expected.

console.log('\nReading per-outcome bundle from data/reach…');
const failures = [];
let totalActual = 0;

for (const e of meta.outcomeEntries) {
    const fp = path.join(REACH_DIR, e.id + '.bin.gz');
    if (!fs.existsSync(fp)) {
        failures.push({ entryId: e.id, kind: 'missing-file', path: fp });
        continue;
    }
    const view = Cache.openOutcomeFromBuffer(zlib.gunzipSync(fs.readFileSync(fp)));

    if (view.entryId !== e.id) {
        failures.push({
            entryId: e.id, kind: 'header-id-mismatch',
            headerId: view.entryId,
        });
        continue;
    }
    if ((view.bit | 0) !== (e.bit | 0)) {
        failures.push({
            entryId: e.id, kind: 'header-bit-mismatch',
            headerBit: view.bit, expectedBit: e.bit,
        });
    }

    const expectedSlots = expected.get(e.id);
    const seenSlots = new Set();
    for (const slot of view.slots) {
        const exp = expectedSlots.get(slot.key);
        if (!exp) {
            failures.push({
                entryId: e.id, kind: 'extra-slot',
                slotKey: slot.key, count: slot.selCount,
            });
            // We still walk the rows so totalActual is right.
        }
        const got = new Set();
        for (let i = 0; i < slot.selCount; i++) got.add(slot.getSelKey(i));
        totalActual += got.size;
        seenSlots.add(slot.key);

        if (!exp) continue;

        // Set difference: missing = exp \ got, extras = got \ exp.
        // We bound each direction's sample at 5 to keep failure
        // dumps tractable even when entire slots drift.
        const missing = [];
        for (const sk of exp) {
            if (!got.has(sk) && missing.length < 5) missing.push(sk);
        }
        const extras = [];
        for (const sk of got) {
            if (!exp.has(sk) && extras.length < 5) extras.push(sk);
        }

        if (got.size !== exp.size || missing.length || extras.length) {
            failures.push({
                entryId: e.id, kind: 'slot-set-mismatch',
                slotKey: slot.key,
                expected: exp.size, actual: got.size,
                missingSamples: missing,
                extraSamples: extras,
            });
        }
    }

    // Slots present in expected but missing from the per-outcome file.
    for (const [slotKey, exp] of expectedSlots) {
        if (!seenSlots.has(slotKey)) {
            failures.push({
                entryId: e.id, kind: 'missing-slot',
                slotKey, expectedSels: exp.size,
            });
        }
    }
}

console.log(`  ${totalActual.toLocaleString()} (entry, slot, sel) bindings actual.`);

// ── Verdict ────────────────────────────────────────────────────

if (failures.length === 0) {
    assert.strictEqual(totalActual, totalExpected,
        'per-outcome bundle total binding count must equal slot-cache bit-filtered count');
    console.log(`\nPASS — per-outcome bundle is byte-perfect bit-projection of slot cache `
        + `(${totalExpected.toLocaleString()} bindings across ${meta.outcomeEntries.length} outcomes).`);
    process.exit(0);
}

console.log(`\nFAIL — ${failures.length} parity issue(s):\n`);
const byKind = new Map();
for (const f of failures) {
    if (!byKind.has(f.kind)) byKind.set(f.kind, []);
    byKind.get(f.kind).push(f);
}
for (const [kind, group] of byKind) {
    console.log(`── ${kind} (${group.length}) ──`);
    for (const f of group.slice(0, 8)) {
        const { kind: _k, ...rest } = f;
        console.log('  ' + JSON.stringify(rest));
    }
    if (group.length > 8) console.log(`  …${group.length - 8} more`);
    console.log();
}
process.exit(1);
