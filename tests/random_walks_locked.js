#!/usr/bin/env node
'use strict';

// random_walks_locked.js — Reach-constrained walk verifier (v3).
//
// For every outcome (and outcome variant) registered in
// data/explore-cache/_meta.json, run N random walks that obey the
// precomputed reachability data the same way the runtime UI does
// when ?locked=<oid> is set: at every node, gate the enabled edges
// through `reach-checker`'s composite cache + live in-module DFS,
// then pick randomly among the surviving edges.
//
// Catches:
//   * reach-data soundness — checker says edge X reaches outcome Y,
//     but continuing on reach-gated edges actually lands on a
//     different outcome (or no outcome).
//   * reach-data completeness — every legal continuation gets
//     greyed (no edge survives the gate) yet the locked outcome
//     IS still reachable. The runtime would refuse to advance
//     even though the graph permits it.
//   * key derivation drift — Engine.applyEdgeEffects /
//     GraphIO.findNextInternalNode / GraphIO.matchOutcomes must
//     agree between this script and the precompute pipeline. Any
//     drift surfaces as 100% wrong-outcome / no-reachable-edges
//     for some entry.
//
// Single backend: the v3 explore-cache + reach-checker. The old
// v1/v2 reach files (data/reach/, data/reach-v2/) and slot-level
// walker are gone; reach-checker subsumes them.
//
// Usage:
//   node tests/random_walks_locked.js                  default (200 walks/entry)
//   node tests/random_walks_locked.js --walks 500      heavier sweep
//   node tests/random_walks_locked.js --outcome the-flourishing--gradual
//   node tests/random_walks_locked.js --verbose
//
// Exits 0 on clean (every walk reached its locked outcome). Exits
// 1 on any failure with a sample trace per failure mode.

const fs = require('fs');
const path = require('path');

// ── Browser-shim setup ──

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

const ROOT = path.join(__dirname, '..');
const Graph = require(path.join(ROOT, 'graph.js'));
global.window.Graph = Graph;
const Engine = require(path.join(ROOT, 'engine.js'));
global.window.Engine = Engine;
new Function('window', fs.readFileSync(path.join(ROOT, 'graph-io.js'), 'utf8'))(global.window);
new Function('window', 'document', fs.readFileSync(path.join(ROOT, 'nodes.js'), 'utf8'))(global.window, global.document);
new Function('window', fs.readFileSync(path.join(ROOT, 'flow-propagation.js'), 'utf8'))(global.window);

const GraphIO = global.window.GraphIO;
const FlowPropagation = global.window.FlowPropagation;
const FLOW_DAG = global.window.Nodes.FLOW_DAG;
const NODES = Engine.NODES || Graph.NODES;
const NODE_MAP = {};
for (const n of NODES) NODE_MAP[n.id] = n;
const MODULES = Engine.MODULES || Graph.MODULES;
const outcomesData = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/outcomes.json'), 'utf8'));
const TEMPLATES = outcomesData.templates;
const TEMPLATE_BY_ID = new Map();
for (const t of TEMPLATES) TEMPLATE_BY_ID.set(t.id, t);
GraphIO.registerOutcomes(TEMPLATES);

const Cache = require(path.join(ROOT, 'explore-cache'));
const ReachChecker = require(path.join(ROOT, 'reach-checker'));

// ── CLI args ──

const args = process.argv.slice(2);
function getArg(flag, fallback) {
    const i = args.indexOf(flag);
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}
const NUM_WALKS = parseInt(getArg('--walks', '200'), 10);
const SEED = parseInt(getArg('--seed', '1'), 10);
const ONLY_OUTCOME = getArg('--outcome', null);
const VERBOSE = args.includes('--verbose');
const STEP_CAP = parseInt(getArg('--step-cap', '500'), 10);

// ── Seeded RNG (mulberry32) ──

function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// ── Build reach index + checker ──

console.log('Building reach index from data/explore-cache…');
const indexT0 = Date.now();
const reachIndex = ReachChecker.buildIndexFromCache({ Cache, MODULES, FLOW_DAG });
const checker = ReachChecker.createChecker(reachIndex, { GraphIO, Engine });
const indexMs = Date.now() - indexT0;
let totalSels = 0;
for (const m of reachIndex.reachBySlot.values()) totalSels += m.size;
console.log(`  ${totalSels.toLocaleString()} (slot, sel) entries across ${reachIndex.reachBySlot.size} slots, ${reachIndex.outcomeEntries.length} outcome entries, ${(indexMs / 1000).toFixed(2)}s.\n`);

// Build entry list from the cache's _meta — same set the
// precompute writer chose, no risk of drift with hand-rolled
// variant enumeration.
const entries = reachIndex.outcomeEntries.map(e => ({
    id: e.id,
    templateId: e.templateId,
    primaryDim: e.primaryDim,
    variantKey: e.variantKey,
    bit: e.bit | 0,
}));

// ── Light-push helper (mirrors index.html `_lightPush`) ──

function lightPushSel(sel, nodeId, edgeId) {
    const next = Object.assign({}, sel, { [nodeId]: edgeId });
    const node = NODE_MAP[nodeId];
    const edge = node && node.edges && node.edges.find(e => e.id === edgeId);
    if (edge) Engine.applyEdgeEffects(next, edge, null);
    return next;
}

// ── Single reach-constrained walk ──
//
// Walks the engine's findNextQuestion loop. At every askable node,
// reach-checker decides which enabled edges keep the locked outcome
// reachable. If none survive → 'no-reachable-edges' (a completeness
// failure). Picks uniformly among survivors and pushes onto the stack.

function reachWalk(rand, entry) {
    const template = TEMPLATE_BY_ID.get(entry.templateId);
    const targetMask = entry.bit | 0;
    let stack = Engine.createStack();
    const trace = [];
    // DFS memo is per-slot: when we cross a slot boundary the
    // mid-module sels in scope change, so clearing on boundary
    // keeps the memo cheap (O(internal-sels) per module) while
    // still amortizing across the gate's per-edge probes within
    // one click.
    let dfsMemo = new Map();
    let currentSlotKey = null;

    for (let step = 0; step < STEP_CAP; step++) {
        const sel = Engine.currentState(stack);
        const parentSlotKey = FlowPropagation.parentSlotKeyFromStack(stack);
        const flow = FlowPropagation.flowNext(sel, parentSlotKey);

        if (flow.kind === 'open') {
            const eff = Engine.resolvedState(sel);
            if (Engine.templateMatches(template, eff)) {
                if (entry.variantKey != null && eff[entry.primaryDim] !== entry.variantKey) {
                    return { kind: 'wrong-variant', actualPrimary: eff[entry.primaryDim], trace, sel: eff };
                }
                return { kind: 'success', trace };
            }
            for (const t of TEMPLATES) {
                if (Engine.templateMatches(t, eff)) {
                    return { kind: 'wrong-outcome', actualOutcome: t.id, trace, sel: eff };
                }
            }
            return { kind: 'no-outcome', trace, sel: eff };
        }
        if (flow.kind === 'stuck') {
            return { kind: 'stuck', slotKey: flow.slotKey, trace, sel };
        }
        if (flow.kind !== 'question') {
            return { kind: 'unknown-flow', flow, trace };
        }

        // Slot-boundary crossing — clear the per-slot DFS memo.
        if (flow.slotKey !== currentSlotKey) {
            currentSlotKey = flow.slotKey;
            dfsMemo = new Map();
        }

        const node = flow.node;
        const lockedEdgeId = Engine.isNodeLocked(sel, node);
        let edgeId;
        if (lockedEdgeId != null) {
            // Auto-locked: runtime auto-pushes without a gate
            // (only one edge survives anyway). If the precompute
            // missed this transition, it'll surface as a
            // wrong-outcome / wrong-variant downstream.
            edgeId = lockedEdgeId;
        } else {
            const enabled = node.edges.filter(e => !Engine.isEdgeDisabled(sel, node, e));
            const reachable = enabled.filter(e => {
                const childSel = lightPushSel(sel, node.id, e.id);
                // Pass the active slotKey from flowNext so the
                // checker's per-slot lookup distinguishes reach
                // at this slot's exit boundary from the same
                // selKey at any other slot's exit (escape × 5,
                // brittle/sufficient pass-through, etc.).
                const mask = checker.getReach(flow.slotKey, childSel, {
                    dfsMemo,
                });
                return (mask & targetMask) !== 0;
            });
            if (reachable.length === 0) {
                return {
                    kind: 'no-reachable-edges',
                    nodeId: node.id,
                    enabledIds: enabled.map(e => e.id),
                    trace,
                    sel,
                };
            }
            edgeId = reachable[Math.floor(rand() * reachable.length)].id;
        }

        stack = Engine.push(stack, node.id, edgeId);
        trace.push({ nodeId: node.id, edgeId, locked: lockedEdgeId != null });
    }

    return { kind: 'step-cap', trace };
}

// ── Helpers ──

function fmtTrace(trace, maxSteps = 30) {
    const fmt = t => `${t.nodeId}=${t.edgeId}${t.locked ? '*' : ''}`;
    if (trace.length <= maxSteps) return trace.map(fmt).join(' → ');
    const head = trace.slice(0, 5).map(fmt).join(' → ');
    const tail = trace.slice(-(maxSteps - 5)).map(fmt).join(' → ');
    return `${head} → … (${trace.length - maxSteps} hidden) … → ${tail}`;
}

function selToUrl(sel, lockedId) {
    const params = Object.entries(sel)
        .filter(([, v]) => v != null)
        .map(([k, v]) => `${k}=${v}`);
    if (lockedId) params.push('locked=' + lockedId);
    return `http://localhost:3000/#/map?${params.join('&')}`;
}

// ── Main loop ──

const targetEntries = ONLY_OUTCOME
    ? entries.filter(e => e.id === ONLY_OUTCOME)
    : entries;

if (ONLY_OUTCOME && targetEntries.length === 0) {
    console.error(`Unknown outcome id: ${ONLY_OUTCOME}`);
    console.error(`Available: ${entries.map(e => e.id).join(', ')}`);
    process.exit(2);
}

const t0 = Date.now();
const rand = mulberry32(SEED);

console.log(`Running ${NUM_WALKS} reach-constrained walks per outcome (seed=${SEED}, ${targetEntries.length} entries)…\n`);

const perEntryStats = [];
const failureSamples = []; // { entryId, kind, sample }

for (const entry of targetEntries) {
    const stats = {
        id: entry.id,
        success: 0,
        'wrong-outcome': 0,
        'wrong-variant': 0,
        'no-outcome': 0,
        'no-reachable-edges': 0,
        'stuck': 0,
        'step-cap': 0,
        'unknown-flow': 0,
    };

    for (let i = 0; i < NUM_WALKS; i++) {
        const r = reachWalk(rand, entry);
        stats[r.kind] = (stats[r.kind] || 0) + 1;
        if (r.kind !== 'success') {
            failureSamples.push({ entryId: entry.id, kind: r.kind, sample: r });
        }
    }

    perEntryStats.push(stats);

    const failed = NUM_WALKS - stats.success;
    const tag = failed === 0 ? 'OK  ' : 'FAIL';
    const detail = failed === 0
        ? `${stats.success}/${NUM_WALKS}`
        : `${stats.success}/${NUM_WALKS}  ` + Object.entries(stats)
            .filter(([k, v]) => k !== 'success' && k !== 'id' && v > 0)
            .map(([k, v]) => `${k}=${v}`).join(' ');
    console.log(`  [${tag}] ${entry.id.padEnd(45)}  ${detail}`);
}

const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
console.log(`\nDone in ${elapsed}s.`);

const totalWalks   = perEntryStats.reduce((a) => a + NUM_WALKS, 0);
const totalSuccess = perEntryStats.reduce((a, s) => a + s.success, 0);
const totalFailed  = totalWalks - totalSuccess;

if (totalFailed === 0) {
    console.log(`\nPASS — all ${totalWalks.toLocaleString()} walks reached their locked outcome.`);
    process.exit(0);
}

// ── Failure dive ──

console.log(`\nFAIL — ${totalFailed} of ${totalWalks.toLocaleString()} walks failed.\n`);

const byKind = new Map();
for (const f of failureSamples) {
    if (!byKind.has(f.kind)) byKind.set(f.kind, []);
    byKind.get(f.kind).push(f);
}

for (const [kind, group] of byKind) {
    console.log(`\n── ${kind} (${group.length}) ──`);
    const seenEntries = new Set();
    let shown = 0;
    for (const f of group) {
        if (shown >= 5 && !VERBOSE) break;
        if (seenEntries.has(f.entryId) && !VERBOSE) continue;
        seenEntries.add(f.entryId);
        shown++;
        const r = f.sample;
        console.log(`\n  locked=${f.entryId}`);
        if (r.kind === 'wrong-outcome') console.log(`    actual outcome: ${r.actualOutcome}`);
        if (r.kind === 'wrong-variant') console.log(`    actual variant: ${r.actualPrimary}`);
        if (r.kind === 'no-reachable-edges') {
            console.log(`    node: ${r.nodeId}  enabled: [${r.enabledIds.join(', ')}]`);
            console.log(`    repro: ${selToUrl(r.sel, f.entryId)}`);
        }
        if (r.kind === 'stuck') console.log(`    stuck at slot: ${r.slotKey}`);
        if (r.kind === 'step-cap') console.log(`    walk did not terminate within ${STEP_CAP} steps`);
        if (r.sel && r.kind !== 'no-reachable-edges') {
            console.log(`    repro: ${selToUrl(r.sel, f.entryId)}`);
        }
        console.log(`    trace: ${fmtTrace(r.trace)}`);
    }
    if (!VERBOSE && group.length > shown) {
        console.log(`\n  …${group.length - shown} more (use --verbose to see all)`);
    }
}

process.exit(1);
