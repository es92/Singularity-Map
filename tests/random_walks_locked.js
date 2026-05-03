#!/usr/bin/env node
'use strict';

// random_walks_locked.js — Reach-constrained walk verifier (v4).
//
// For every outcome (and outcome variant) registered in
// data/explore-cache/_meta.json, run N random walks that obey the
// PER-OUTCOME reach bundle the browser fetches on lock. At every
// node, gate the enabled edges through the per-outcome checker
// (boolean Set lookup + live in-module DFS), then pick randomly
// among the surviving edges.
//
// This is the same code path the browser runs in locked mode —
// loading data/reach/<entryId>.bin.gz, building a Set<selKey> per
// slot, and asking `checker.couldReach(slotKey, childSel)` per edge.
// A failure here means a real browser regression.
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
//     GraphIO.findNextInternalNode / Engine.templateMatches must
//     agree between this script, the precompute pipeline, and the
//     bundle splitter. Any drift surfaces as 100% wrong-outcome /
//     no-reachable-edges for some entry.
//   * per-outcome bundle integrity — paired with per_outcome_parity
//     (which checks structural equivalence to the slot cache) this
//     test certifies the bundle drives correct gate decisions on
//     real walks.
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

// ── Per-outcome checker loader ──
//
// Each locked entry has its own data/reach/<entryId>.bin.gz file.
// We lazy-load the checker on first use per entry — matches what
// the browser does on lock — and cache it for the entry's full walk
// batch. Loading is cheap (~80 KB gzipped per outcome, ~50 ms to
// parse + build the index).

const zlib = require('zlib');
const REACH_DIR = path.join(ROOT, 'data', 'reach');

const reachMeta = (() => {
    const p = path.join(REACH_DIR, '_meta.json');
    if (!fs.existsSync(p)) {
        console.error(`random_walks_locked: ${p} missing — run \`node bundle-reach-binaries.js\` after precompute.`);
        process.exit(2);
    }
    return JSON.parse(fs.readFileSync(p, 'utf8'));
})();

const _checkerCache = new Map();
function loadCheckerFor(entry) {
    const cached = _checkerCache.get(entry.id);
    if (cached) return cached;
    const fp = path.join(REACH_DIR, entry.id + '.bin.gz');
    if (!fs.existsSync(fp)) {
        throw new Error(`random_walks_locked: per-outcome file missing: ${fp}`);
    }
    const view = Cache.openOutcomeFromBuffer(zlib.gunzipSync(fs.readFileSync(fp)));
    const idx = ReachChecker.buildOutcomeIndexFromView({
        outcomeView: view, MODULES, FLOW_DAG,
    });
    const checker = ReachChecker.createOutcomeChecker(idx, {
        GraphIO, Engine,
        template: TEMPLATE_BY_ID.get(entry.templateId),
    });
    _checkerCache.set(entry.id, checker);
    return checker;
}

// Build entry list from the per-outcome bundle's _meta — same set
// the precompute writer chose, no risk of drift with hand-rolled
// variant enumeration.
const entries = reachMeta.outcomeEntries.map(e => ({
    id: e.id,
    templateId: e.templateId,
    primaryDim: e.primaryDim,
    variantKey: e.variantKey,
    bit: e.bit | 0,
}));
console.log(`Loaded ${entries.length} outcome entries from data/reach/_meta.json.\n`);

// ── Light-push helper (mirrors index.html `_lightPushSel`) ──

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

function reachWalk(rand, entry, checker) {
    const template = TEMPLATE_BY_ID.get(entry.templateId);
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
                return checker.couldReach(flow.slotKey, childSel, {
                    dfsMemo,
                });
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

    // Load checker once per entry — every walk in this batch
    // shares it (the per-outcome Sets are immutable post-build).
    const checker = loadCheckerFor(entry);

    for (let i = 0; i < NUM_WALKS; i++) {
        const r = reachWalk(rand, entry, checker);
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
