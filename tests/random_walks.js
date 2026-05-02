#!/usr/bin/env node
'use strict';

// random_walks.js — Monte-Carlo smoke test for end-to-end completability.
//
// Walks the graph from emergence using the same runtime primitives the UI
// uses (FlowPropagation.flowNext, Engine.push, Engine.isEdgeDisabled,
// Engine.isNodeLocked, Engine.templateMatches). At every step:
//
//   * If flowNext returns 'question', pick a random enabled edge for that
//     node (auto-locked nodes commit their forced answer silently, just
//     like the runtime).
//   * If flowNext returns 'stuck', record the path as a stuck dead end —
//     the runtime would wedge here.
//   * If flowNext returns 'open', verify an outcome template matches. No
//     match → record as an "open-but-no-outcome" dead end (same shape as
//     the Lena bug Phase 9 missed earlier in this session).
//
// Catches dead ends that Phase 9 (per-module symbolic enumeration) misses
// because of cross-module interactions or static/runtime drift.
//
// Usage:
//   node tests/random_walks.js              5000 walks, seed 1
//   node tests/random_walks.js --walks 50000 --seed 42
//   node tests/random_walks.js --verbose    log every dead-end stack
//
// Exits 0 on clean (every walk reached an outcome). Exits 1 on any
// dead end, no-edges, or step-cap-exceeded. Outcomes hit are reported
// for coverage visibility.

const fs = require('fs');
const path = require('path');

// ── Browser-shim setup (same pattern as validate.js) ──

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
const NODES = Engine.NODES || Graph.NODES;
const outcomesData = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/outcomes.json'), 'utf8'));
const TEMPLATES = outcomesData.templates;
GraphIO.registerOutcomes(TEMPLATES);

// ── CLI args ──

const args = process.argv.slice(2);
function getArg(flag, fallback) {
    const i = args.indexOf(flag);
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}
const NUM_WALKS = parseInt(getArg('--walks', '5000'), 10);
const SEED = parseInt(getArg('--seed', '1'), 10);
const VERBOSE = args.includes('--verbose');
// Step cap default: 500 has 0 false positives across 250k walks.
// 300 false-positives on ~0.005% of walks (long random rides through the
// escape module's leak-reentry cycle — not actual loops; they complete
// given more steps). Realistic UI play-throughs are 15-25 steps; this
// only matters because random walking can stack many escape re-entries.
const STEP_CAP = parseInt(getArg('--step-cap', '500'), 10);

// ── Seeded RNG (mulberry32) for reproducibility ──

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

// ── Single walk ──

function randomWalk(rand) {
    let stack = Engine.createStack();
    const trace = [];

    for (let step = 0; step < STEP_CAP; step++) {
        const sel = Engine.currentState(stack);
        const parentSlotKey = FlowPropagation.parentSlotKeyFromStack(stack);
        const flow = FlowPropagation.flowNext(sel, parentSlotKey);

        if (flow.kind === 'open') {
            const eff = Engine.resolvedState(sel);
            for (const t of TEMPLATES) {
                if (Engine.templateMatches(t, eff)) {
                    return { kind: 'success', stack, outcome: t.id, trace, sel: eff };
                }
            }
            return { kind: 'no-outcome', stack, sel: eff, trace };
        }

        if (flow.kind === 'stuck') {
            return { kind: 'stuck', stack, sel, slotKey: flow.slotKey, trace };
        }

        if (flow.kind !== 'question') {
            return { kind: 'unknown-flow', stack, flow, trace };
        }

        const node = flow.node;
        const lockedEdgeId = Engine.isNodeLocked(sel, node);
        let edgeId;
        if (lockedEdgeId != null) {
            edgeId = lockedEdgeId;
        } else {
            const enabledEdges = node.edges.filter(e => !Engine.isEdgeDisabled(sel, node, e));
            if (enabledEdges.length === 0) {
                // flowNext said "ask this node" but no edge is enabled —
                // would be a graph bug (Phase 5 normally catches it).
                return { kind: 'no-edges', stack, sel, nodeId: node.id, trace };
            }
            edgeId = enabledEdges[Math.floor(rand() * enabledEdges.length)].id;
        }

        stack = Engine.push(stack, node.id, edgeId);
        trace.push({ nodeId: node.id, edgeId, locked: lockedEdgeId != null });
    }

    return { kind: 'step-cap', stack, trace };
}

// ── Aggregate over N walks ──

function fmtTrace(trace, maxSteps = 30) {
    const fmt = t => `${t.nodeId}=${t.edgeId}${t.locked ? '*' : ''}`;
    if (trace.length <= maxSteps) return trace.map(fmt).join(' → ');
    const head = trace.slice(0, 5).map(fmt).join(' → ');
    const tail = trace.slice(-(maxSteps - 5)).map(fmt).join(' → ');
    return `${head} → … (${trace.length - maxSteps} hidden) … → ${tail}`;
}

function selToUrl(sel) {
    const params = Object.entries(sel)
        .filter(([, v]) => v != null)
        .map(([k, v]) => `${k}=${v}`)
        .join('&');
    return `http://localhost:3000/#/explore${params ? '?' + params : ''}`;
}

const t0 = Date.now();
const rand = mulberry32(SEED);

const counts = { success: 0, 'no-outcome': 0, stuck: 0, 'no-edges': 0, 'step-cap': 0, 'unknown-flow': 0 };
const outcomesHit = new Map(); // outcomeId → count
const deadEnds = new Map();    // signature → { kind, count, sample }

console.log(`Running ${NUM_WALKS.toLocaleString()} random walks (seed=${SEED}, step-cap=${STEP_CAP})...`);

for (let i = 0; i < NUM_WALKS; i++) {
    const r = randomWalk(rand);
    counts[r.kind] = (counts[r.kind] || 0) + 1;

    if (r.kind === 'success') {
        outcomesHit.set(r.outcome, (outcomesHit.get(r.outcome) || 0) + 1);
        continue;
    }

    // Build a stable signature for grouping repeat dead ends.
    let sig;
    if (r.kind === 'stuck') sig = `stuck@${r.slotKey}|${r.trace[r.trace.length - 1]?.nodeId}=${r.trace[r.trace.length - 1]?.edgeId}`;
    else if (r.kind === 'no-outcome') sig = `no-outcome|${Object.entries(r.sel).filter(([, v]) => v != null).sort().map(([k, v]) => `${k}=${v}`).join(',')}`;
    else if (r.kind === 'no-edges') sig = `no-edges@${r.nodeId}|${r.trace[r.trace.length - 1]?.nodeId}=${r.trace[r.trace.length - 1]?.edgeId}`;
    else if (r.kind === 'step-cap') sig = `step-cap|${r.trace.slice(-3).map(t => t.nodeId).join('→')}`;
    else sig = `unknown|${JSON.stringify(r.flow)}`;

    let info = deadEnds.get(sig);
    if (!info) {
        info = { kind: r.kind, count: 0, sample: r };
        deadEnds.set(sig, info);
    }
    info.count++;
}

const elapsed = ((Date.now() - t0) / 1000).toFixed(2);

// ── Report ──

console.log(`\nDone in ${elapsed}s.\n`);

console.log('Results:');
console.log(`  success         : ${counts.success.toLocaleString()}`);
console.log(`  no-outcome      : ${counts['no-outcome']}  ← path exited cleanly but no outcome matches`);
console.log(`  stuck           : ${counts.stuck}  ← flowNext wedged mid-walk`);
console.log(`  no-edges        : ${counts['no-edges']}  ← node had no enabled edges`);
console.log(`  step-cap (${STEP_CAP}): ${counts['step-cap']}  ← walk didn't terminate`);
if (counts['unknown-flow']) console.log(`  unknown-flow    : ${counts['unknown-flow']}`);
console.log();

const totalDead = NUM_WALKS - counts.success;
if (totalDead === 0) {
    console.log(`Outcomes hit (${outcomesHit.size} distinct):`);
    const sorted = [...outcomesHit.entries()].sort((a, b) => b[1] - a[1]);
    for (const [id, c] of sorted) console.log(`  ${id.padEnd(40)} ${c.toLocaleString()}`);
    console.log();
    console.log('PASS — every walk reached an outcome.');
    process.exit(0);
}

// Group dead ends by signature, sorted by count.
console.log(`Dead-end paths (${deadEnds.size} distinct signatures):`);
const sortedDeadEnds = [...deadEnds.entries()].sort((a, b) => b[1].count - a[1].count);
for (const [sig, info] of sortedDeadEnds) {
    const r = info.sample;
    console.log();
    console.log(`  [${info.kind}] x${info.count}`);
    console.log(`    sig: ${sig}`);
    if (r.kind === 'stuck' || r.kind === 'no-edges') {
        console.log(`    slot/node: ${r.slotKey || r.nodeId}`);
    }
    if (r.kind === 'no-outcome') {
        console.log(`    sel: ${selToUrl(r.sel)}`);
    }
    if (VERBOSE || sortedDeadEnds.length <= 10) {
        console.log(`    trace: ${fmtTrace(r.trace)}`);
    }
}
console.log();
console.log(`Outcomes hit (${outcomesHit.size} distinct):`);
const sorted = [...outcomesHit.entries()].sort((a, b) => b[1] - a[1]);
for (const [id, c] of sorted) console.log(`  ${id.padEnd(40)} ${c.toLocaleString()}`);
console.log();
console.log(`FAIL — ${totalDead} of ${NUM_WALKS} walks failed to reach an outcome.`);
process.exit(1);
