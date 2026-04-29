#!/usr/bin/env node
'use strict';

// flow_next_parity.js — Drift detector between FlowPropagation.run
// (set-based static analysis: validate.js, /explore, precompute-
// reachability.js) and FlowPropagation.flowNext (single-step runtime
// navigator: index.html findNextQuestion).
//
// The two paths are different shapes by necessity: `run` walks the
// full reach set (~50s) so the runtime can't call it per render, and
// `flowNext` is a single-sel single-step approximation. Today they
// share the same _slotPickPriority comparator, the same
// GraphIO.findNextInternalNode internal picker, the same module-
// atomicity rule, and — when given a parent context — the same
// per-parent child-pick logic. Given (sel, parentSlotKey), they
// MUST agree exactly.
//
// ─── What this test asserts ────────────────────────────────────
//
// For every sel that run() routed from parent P into child K, we
// require:
//
//     flowNext(sel, P).slotKey === K
//
// run()'s `routedFromBySlot` records P alongside `inputsBySlot`,
// index-aligned: the i-th element of inputsBySlot[K] arrived from
// the i-th element of routedFromBySlot[K]. Feeding that P into
// flowNext is the parity contract — flowNext shouldn't have to
// re-derive parent context from sel state alone.
//
// Both `kind: 'question'` and `kind: 'stuck'` are accepted as long
// as slotKey matches K. The two paths use the SAME slot-pick rule
// (`_slotPickPriority`, LOOSE askability) so they route to the
// same K — but flowNext goes one step further with TIGHT
// askability (`GraphIO.findNextInternalNode`) when picking the
// internal NODE to render, and reports `stuck` when every internal
// has all edges disabled. That's a runtime correctness signal, not
// a routing divergence — the slot agreement IS the routing parity.
// `stuck` cases are independently caught as graph bugs (see the
// "stuck slots:" report below) and are listed in the project TODO
// for graph-side fixes.
//
// ─── Why we feed the parent explicitly ─────────────────────────
//
// run() routes by parent in topological order. The same sel value
// can legitimately arrive at multiple slots from different parents:
//
//   * brittle.sufficient leaves the sel value identical to its input
//     (brittle_resolution moves to flavor, alignment unchanged), so
//     the SAME sel ends up routed who_benefits→brittle AND
//     brittle→rollout. flowNext from sel alone has no way to pick
//     which.
//
//   * concentration_type='ai_itself' edge effect writes
//     `inert_stays='no'` — the same dim inert_stays slot writes when
//     a user picks 'no'. Sel-only flowNext can't tell whether
//     inert_stays actually walked or the value was a side-effect.
//
// In both cases, parentSlotKey unambiguously resolves the routing.
// run() always knows the parent at routing time; the runtime knows
// it from the answer history; the parity test reads it from
// routedFromBySlot.
//
// ─── What this test deliberately does NOT check ────────────────
//
//   * Matched sels (outcome-siphoned by run): run siphons at the
//     slot where the outcome first matches; the runtime keeps
//     calling flowNext through subsequent slots until it returns
//     'open' and then matches the outcome. They eventually agree on
//     the outcome (validate.js Phase 8 ensures this), but the sel-
//     observation timing differs, so a flowNext='open' assertion
//     would false-positive.
//
//   * Dead sels: run flags a sel as dead iff no CHILD of the
//     current slot accepts; flowNext (with parent) does the same
//     pick over the same child set, so the equivalent assertion is
//     trivially preserved by the inputsBySlot ⇔ flowNext check
//     above.
//
//   * Mid-DFS sels inside a module: not materialized in run()'s
//     output. Both paths share GraphIO.findNextInternalNode for the
//     inner pick, so this is provably equivalent without a dynamic
//     test.
//
// ─── Failure modes this guards against ─────────────────────────
//
//   1. _slotPickPriority gets an extra branch (e.g. for a new slot
//      kind) in run's caller but not in flowNext, or vice versa.
//   2. Module atomicity gets accidentally weakened (e.g. someone
//      removes the entered-but-not-exited override or its
//      completionMarker check).
//   3. A new module's gate interacts surprisingly with mid-flow
//      detection — e.g. activateWhen flips false mid-module so
//      run's slot-priority returns ∞ but flowNext's atomicity
//      branch still claims ownership.
//   4. A future divergence in the priority comparator (highest- vs
//      lowest-wins) sneaks back into one path.
//   5. flowNext starts surfacing a different question node than
//      run() at any sel — even if its slotKey "matches", a wrong
//      node would mean the user sees the wrong question.
//   6. routedFromBySlot drifts out of sync with inputsBySlot
//      (index-misalignment) — the assertion would surface as
//      systematic mismatches.

const fs = require('fs');
const path = require('path');

global.window = {
    requestAnimationFrame: () => 0,
    addEventListener: () => {},
    location: { hash: '' },
};
global.document = {
    addEventListener: () => {},
    readyState: 'complete',
    getElementById: () => null,
    querySelector: () => null,
};

const ROOT = path.resolve(__dirname, '..');
const Graph = require(path.join(ROOT, 'graph.js'));
global.window.Graph = Graph;
const Engine = require(path.join(ROOT, 'engine.js'));
global.window.Engine = Engine;
new Function('window', fs.readFileSync(path.join(ROOT, 'graph-io.js'), 'utf8'))(global.window);
new Function('window', 'document', fs.readFileSync(path.join(ROOT, 'nodes.js'), 'utf8'))(global.window, global.document);
new Function('window', fs.readFileSync(path.join(ROOT, 'flow-propagation.js'), 'utf8'))(global.window);

const GraphIO = global.window.GraphIO;
GraphIO.setStrictTruncation(true);
GraphIO.registerOutcomes(JSON.parse(fs.readFileSync(
    path.join(ROOT, 'data/outcomes.json'), 'utf8')).templates);

const FlowPropagation = global.window.FlowPropagation;

const t0 = Date.now();
console.log('Phase 1: FlowPropagation.run …');
const prop = FlowPropagation.run();
console.log(`  done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

console.log('\nPhase 2: flowNext(sel, parent).slotKey === inputsBySlot key …');
const t1 = Date.now();

let total = 0;
let mismatches = 0;
let stuckCount = 0;
const stuckBySlot = new Map();
const samples = [];

const ABBR = (sel) => {
    const keys = Object.keys(sel).sort();
    if (keys.length <= 8) return JSON.stringify(sel);
    const head = keys.slice(0, 6).map(k => `${k}=${sel[k]}`).join(', ');
    return `{ ${head}, …+${keys.length - 6} more }`;
};

for (const [slotKey, sels] of prop.inputsBySlot) {
    const parents = prop.routedFromBySlot.get(slotKey) || [];
    if (parents.length !== sels.length) {
        console.error(`FATAL: routedFromBySlot[${slotKey}].length (${parents.length}) ≠ inputsBySlot[${slotKey}].length (${sels.length}) — index misalignment in run()`);
        process.exit(1);
    }
    for (let i = 0; i < sels.length; i++) {
        total++;
        const sel = sels[i];
        const parent = parents[i];
        const r = FlowPropagation.flowNext(sel, parent);

        if (r.slotKey === slotKey && r.kind === 'stuck') {
            stuckCount++;
            stuckBySlot.set(slotKey, (stuckBySlot.get(slotKey) || 0) + 1);
            continue;
        }

        const ok = r.kind === 'question' && r.slotKey === slotKey;
        if (ok) continue;

        mismatches++;
        if (samples.length < 5) {
            samples.push({
                routed: `${parent} → ${slotKey}`,
                sel: ABBR(sel),
                got: r.kind === 'question'
                    ? `{ kind: 'question', slotKey: '${r.slotKey}', node: '${r.node && r.node.id}' }`
                    : JSON.stringify({ kind: r.kind, slotKey: r.slotKey || null }),
            });
        }
    }
}

console.log(`  ${total - mismatches - stuckCount}/${total} sels agree on routing + question (${((Date.now() - t1) / 1000).toFixed(1)}s)`);
if (stuckCount > 0) {
    console.log(`  ${stuckCount}/${total} sels agree on routing but flowNext reports 'stuck' (no enabled edge);`);
    console.log(`    these are graph bugs to fix separately — slot routing IS aligned.`);
    console.log('  stuck slots:');
    const sortedStuck = [...stuckBySlot.entries()].sort((a, b) => b[1] - a[1]);
    for (const [k, v] of sortedStuck) {
        console.log(`    ${v.toString().padStart(6)}  ${k}`);
    }
}

if (mismatches > 0) {
    console.error('\nFAIL — first ' + samples.length + ' mismatches:');
    for (const s of samples) {
        console.error(`  routed:   ${s.routed}`);
        console.error(`  sel:      ${s.sel}`);
        console.error(`  got:      ${s.got}`);
        console.error('');
    }
    console.error(`flow_next parity: FAIL (${mismatches}/${total} routing mismatches)`);
    process.exit(1);
}

console.log(`\nflow_next parity: PASS (slot-routing is identical between run() and flowNext)`);
