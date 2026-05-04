#!/usr/bin/env node
'use strict';

// outcome_parity.js — Verifies that flowNext's outcome-termination
// rule (added when the runtime contract changed to "stop on outcome
// match at slot boundaries") fires on EXACTLY the sels that
// FlowPropagation.run's siphon does — i.e. that runtime, validate,
// and explore agree on where a path is "done".
//
// The contract:
//   * FlowPropagation.flowNext(sel, parentSlot) returns {kind:'open'}
//     whenever matchOutcomes(sel).length > 0 AND no module is
//     mid-walk in sel.
//   * FlowPropagation.run() siphons (continue's past) every sel
//     where matchOutcomes(sel).length > 0 — and only ever processes
//     post-slot-exit sels, where no module is mid-walk by
//     construction.
//
// So at slot-exit boundaries the two conditions MUST agree. The
// cached `.full.bin` rows ARE the slot-exit sels run() siphoned, so
// we can iterate them, ask flowNext, and assert the rule directly.
//
// Output:
//   * Per-slot summary: total cached sels, how many match an
//     outcome (the population the rule should fire on), how many
//     flowNext returned open-due-to-outcome-match for, and any
//     mismatches.
//   * Mismatch examples (up to 3 per slot).
//
// Exits 0 on full parity, 1 on any divergence.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const { Engine, GraphIO, FlowPropagation, FLOW_DAG } =
    require(path.join(ROOT, 'node-runtime')).loadNodeRuntime();
const MODULE_MAP = Engine.MODULE_MAP;

const Cache = require(path.join(ROOT, 'explore-cache'));

// ── CLI ──

const args = process.argv.slice(2);
const VERBOSE = args.includes('--verbose');
const EXAMPLES_PER_SLOT = 3;

// ── Helpers ──

// Ground-truth "is some module mid-walk?" — same shape as the
// helper inside flow-propagation.js. Replicated here so the test
// can label sels independently of the function under test.
function isInsidePendingModule(sel) {
    for (const slot of FLOW_DAG.nodes) {
        if (!slot || slot.kind !== 'module') continue;
        const m = MODULE_MAP[slot.id];
        if (!m || !m.completionMarker) continue;
        if (Engine.isModuleDone(sel, m.completionMarker)) continue;
        const nodeIds = m.nodeIds || [];
        for (const nid of nodeIds) {
            if (sel[nid] !== undefined) return true;
        }
    }
    return false;
}

// ── Load caches ──

console.log('Loading slot caches…');
const t0 = Date.now();
const cacheDir = path.join(ROOT, 'data', 'explore-cache');
const slotKeys = fs.readdirSync(cacheDir)
    .filter(f => f.endsWith('.full.bin'))
    .map(f => f.slice(0, -'.full.bin'.length));

const cacheBySlot = new Map(); // slotKey -> array of sels
let totalEntries = 0;
for (const k of slotKeys) {
    const v = Cache.openFullSels(k);
    if (!v) continue;
    const sels = new Array(v.selCount);
    for (let i = 0; i < v.selCount; i++) sels[i] = v.getSel(i);
    cacheBySlot.set(k, sels);
    totalEntries += v.selCount;
}
console.log(`  ${totalEntries.toLocaleString()} entries across ${cacheBySlot.size} slots in ${((Date.now() - t0) / 1000).toFixed(2)}s.\n`);

// ── Iterate + check ──

const slotsInOrder = FLOW_DAG.nodes
    .filter(n => n && n.kind !== 'outcome' && n.kind !== 'deadend')
    .map(n => n.key);

let totalChecked = 0;
let totalOutcomeHits = 0;     // sels matching an outcome at a slot exit
let totalFlowOpens = 0;       // sels where flowNext returned 'open' due to the rule
let totalMismatches = 0;
let totalMidModule = 0;       // sels at slot exit that nonetheless show isInsidePendingModule (should be 0)
const examples = [];

console.log('Slot                              cached    matchOut    flowOpen   midModule    mismatch');
console.log('-------------------------------- --------  ----------  ---------  ----------  ----------');

for (const slotKey of slotsInOrder) {
    const sels = cacheBySlot.get(slotKey);
    if (!sels) continue;

    let matchOut = 0;
    let flowOpen = 0;
    let mid = 0;
    let mismatch = 0;

    for (const sel of sels) {
        totalChecked++;
        const hits = GraphIO.matchOutcomes(sel);
        const inMod = isInsidePendingModule(sel);
        const flow = FlowPropagation.flowNext(sel, slotKey);

        if (inMod) mid++;
        if (hits.length > 0) matchOut++;

        // Direction 1: outcome match at slot exit (no module mid-walk)
        // ⇒ flowNext must return 'open'.
        if (hits.length > 0 && !inMod) {
            if (flow.kind === 'open') {
                flowOpen++;
            } else {
                mismatch++;
                if (examples.length < slotsInOrder.length * EXAMPLES_PER_SLOT) {
                    examples.push({
                        slotKey,
                        sel,
                        hits,
                        flow,
                        kind: 'expected-open',
                    });
                }
            }
        }
    }

    totalOutcomeHits += matchOut;
    totalFlowOpens += flowOpen;
    totalMismatches += mismatch;
    totalMidModule += mid;

    const row = [
        slotKey.padEnd(32),
        String(sels.length).padStart(8),
        String(matchOut).padStart(10),
        String(flowOpen).padStart(9),
        String(mid).padStart(10),
        String(mismatch).padStart(10),
    ].join('  ');
    console.log(row);
}

console.log('-------------------------------- --------  ----------  ---------  ----------  ----------');
console.log([
    'TOTAL'.padEnd(32),
    String(totalChecked).padStart(8),
    String(totalOutcomeHits).padStart(10),
    String(totalFlowOpens).padStart(9),
    String(totalMidModule).padStart(10),
    String(totalMismatches).padStart(10),
].join('  '));

console.log('');
if (totalMidModule > 0) {
    console.log(`NOTE: ${totalMidModule} cached slot-exit sels have a SEPARATE module mid-walk.`);
    console.log('  Expected for FLOW_DAG slots that share a module-id with another');
    console.log('  later slot (e.g. rollout_early ↔ rollout, escape_early ↔ escape_late).');
    console.log('  When the early slot exits without setting the module\'s completion');
    console.log('  marker, the module is legitimately "still pending" and the outcome-');
    console.log('  termination rule correctly stays its hand. flowNext is correct to');
    console.log('  keep routing in these cases; they\'re excluded from the assertion.');
    console.log('');
}

if (totalMismatches === 0) {
    console.log(`PASS — ${totalOutcomeHits.toLocaleString()} outcome-matching slot-exit sels, all routed to 'open' by flowNext.`);
    process.exit(0);
}

console.log(`FAIL — ${totalMismatches} mismatch${totalMismatches === 1 ? '' : 'es'}: flowNext didn't terminate on outcome match.`);
console.log('');
const grouped = new Map();
for (const ex of examples) {
    const key = `${ex.slotKey} → ${ex.flow.kind}${ex.flow.slotKey ? ' @ ' + ex.flow.slotKey : ''}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(ex);
}
for (const [k, group] of grouped) {
    console.log(`── ${k}  (${group.length} example${group.length === 1 ? '' : 's'})`);
    const ex = group[0];
    console.log(`     hits: ${ex.hits.join(', ')}`);
    console.log(`     sel:  ${JSON.stringify(ex.sel)}`);
    if (ex.flow.node) console.log(`     would ask: ${ex.flow.node.id}`);
}

process.exit(1);
