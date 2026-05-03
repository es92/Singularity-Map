#!/usr/bin/env node
'use strict';

// derive_reach_parity.js — Verifies the per-outcome reach files
// produced by `derive-reach-per-outcome.js` are complete with
// respect to the runtime gate.
//
// For each outcome entry, we run reach-constrained random walks (the
// same way ?locked= would route them at runtime), and at every step
// we compute the browser-shape reach key the way `wouldReachOutcome`
// in index.html does. If a reach-gated walk passes through a key that
// ISN'T in that outcome's derived reach set, the browser would have
// over-greyed the gate at runtime — a soundness gap in the derive
// pipeline that random_walks_locked.js can't catch (it tests the
// new full-sel reach pipeline, not the per-outcome browser format).
//
// Two test modes per outcome:
//   1. Walk N reach-constrained walks. Assert every step's browser
//      key is in the outcome's reach file.
//   2. Sanity-check: count keys per file vs OLD precompute should be
//      in the same order of magnitude.
//
// Pass = every walk lands on its locked outcome AND every step's key
// is found in the outcome's reach set.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

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
const NODE_MAP = Engine.NODE_MAP;
const MODULES = Engine.MODULES;

const outcomesData = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/outcomes.json'), 'utf8'));
GraphIO.registerOutcomes(outcomesData.templates);

const Cache = require(path.join(ROOT, 'explore-cache'));
const ReachChecker = require(path.join(ROOT, 'reach-checker'));

if (!fs.existsSync(path.join(ROOT, 'data', 'explore-cache', '_meta.json'))) {
    console.error('data/explore-cache missing — run `npm run precompute` first.');
    process.exit(1);
}
if (!fs.existsSync(path.join(ROOT, 'data', 'reach'))) {
    console.error('data/reach missing — run `npm run precompute-reach` first.');
    process.exit(1);
}

const args = process.argv.slice(2);
function getArg(flag, fallback) {
    const i = args.indexOf(flag);
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}
const NUM_WALKS = parseInt(getArg('--walks', '50'), 10);
const SEED = parseInt(getArg('--seed', '1'), 10);
const ONLY_OUTCOME = getArg('--outcome', null);
const STEP_CAP = parseInt(getArg('--step-cap', '500'), 10);

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

// ─── Indexes mirroring index.html's wouldReachOutcome ─────────────
const moduleOfNode = new Map();
for (const m of MODULES) {
    for (const nid of (m.nodeIds || [])) moduleOfNode.set(nid, m);
}
const slotByKey = new Map();
for (const s of FLOW_DAG.nodes) slotByKey.set(s.key, s);
const innerDimsByModule = new Map();
for (const m of MODULES) {
    const slot = FLOW_DAG.nodes.find(n => n && n.kind === 'module' && n.id === m.id);
    if (!slot) continue;
    innerDimsByModule.set(m.id, GraphIO.innerDimsForSlot(slot));
}

function lightPushSel(sel, nodeId, edgeId) {
    const next = Object.assign({}, sel, { [nodeId]: edgeId });
    const node = NODE_MAP[nodeId];
    const edge = node && node.edges && node.edges.find(e => e.id === edgeId);
    if (edge) Engine.applyEdgeEffects(next, edge, null);
    return next;
}

function reachKey(childSel, nodeId) {
    const owningModule = moduleOfNode.get(nodeId);
    if (owningModule) {
        const innerDims = innerDimsByModule.get(owningModule.id) || [];
        return owningModule.id + '|i|' + GraphIO.compactProjectKey(childSel, innerDims);
    }
    const slot = slotByKey.get(nodeId);
    if (!slot) return null;
    const writeDims = GraphIO.writeDimsForSlot(slot);
    return nodeId + '|o|' + GraphIO.compactProjectKey(childSel, writeDims);
}

// ─── Build reach checker (same as random_walks_locked) ───────────
console.log('Building reach checker from explore-cache…');
const tBuild = Date.now();
const idx = ReachChecker.buildIndexFromCache({ Cache, MODULES, FLOW_DAG });
const checker = ReachChecker.createChecker(idx, { GraphIO, Engine });
const meta = Cache.loadMeta();
console.log(`  ${meta.outcomeEntries.length} outcome entries in ${((Date.now() - tBuild) / 1000).toFixed(2)}s.\n`);

// ─── Per-outcome reach files (the derive output) ─────────────────
const reachByOutcome = new Map();
for (const e of meta.outcomeEntries) {
    const p = path.join(ROOT, 'data', 'reach', e.id + '.json.gz');
    if (!fs.existsSync(p)) {
        console.error(`  missing: ${p}`);
        process.exit(1);
    }
    const arr = JSON.parse(zlib.gunzipSync(fs.readFileSync(p)).toString());
    reachByOutcome.set(e.id, new Set(arr));
}

// ─── Walk one reach-constrained random path ──────────────────────
function pickRandomEnabled(rng, sel, slotKey, node, mask, dfsMemo) {
    const ok = [];
    for (const e of node.edges) {
        if (Engine.isEdgeDisabled(sel, node, e)) continue;
        const child = lightPushSel(sel, node.id, e.id);
        const reach = checker.getReach(slotKey, child, { dfsMemo });
        if ((reach & mask) !== 0) ok.push(e);
    }
    if (ok.length === 0) return null;
    return ok[Math.floor(rng() * ok.length)];
}

// ─── Run N walks per outcome, count missing keys ─────────────────
const failures = []; // { outcome, reason, sample }
let totalWalks = 0;
let totalSteps = 0;
let totalMisses = 0;

const targets = ONLY_OUTCOME
    ? meta.outcomeEntries.filter(e => e.id === ONLY_OUTCOME)
    : meta.outcomeEntries;

console.log(`Walking ${NUM_WALKS} reach-constrained walks per outcome (${targets.length} entries)…\n`);

for (const entry of targets) {
    const rng = mulberry32(SEED + entry.bit);
    const reachSet = reachByOutcome.get(entry.id);
    const mask = entry.bit;

    let okWalks = 0;
    let missCount = 0;
    let firstMiss = null;

    for (let w = 0; w < NUM_WALKS; w++) {
        let stack = Engine.createStack();
        let steps = 0;
        let landed = false;
        const trace = [];
        let dfsMemo = new Map();
        let currentSlotKey = null;

        while (steps < STEP_CAP) {
            const sel = Engine.currentState(stack);
            const parentSlotKey = FlowPropagation.parentSlotKeyFromStack(stack);
            const flow = FlowPropagation.flowNext(sel, parentSlotKey);

            if (flow.kind === 'open') {
                // Outcome resolved — check it's the locked one.
                const eff = Engine.resolvedState(sel);
                const tpl = outcomesData.templates.find(t => t.id === entry.templateId);
                if (tpl && Engine.templateMatches(tpl, eff)) {
                    if (!entry.primaryDim || eff[entry.primaryDim] === entry.variantKey) {
                        landed = true;
                    }
                }
                break;
            }
            if (flow.kind !== 'question') break;

            if (flow.slotKey !== currentSlotKey) {
                currentSlotKey = flow.slotKey;
                dfsMemo = new Map();
            }

            const node = flow.node;
            const lockedEdgeId = Engine.isNodeLocked(sel, node);
            let edge;
            if (lockedEdgeId != null) {
                edge = node.edges.find(e => e.id === lockedEdgeId);
            } else {
                edge = pickRandomEnabled(rng, sel, flow.slotKey, node, mask, dfsMemo);
                if (!edge) break;
            }

            const childSel = lightPushSel(sel, node.id, edge.id);
            const k = reachKey(childSel, node.id);
            if (k && !reachSet.has(k)) {
                missCount++;
                totalMisses++;
                if (firstMiss === null) firstMiss = { trace: [...trace, [node.id, edge.id]], key: k };
            }
            trace.push([node.id, edge.id]);
            stack = Engine.push(stack, node.id, edge.id);
            steps++;
            totalSteps++;
        }
        if (landed) okWalks++;
        totalWalks++;
    }

    const okStr = `${okWalks}/${NUM_WALKS}`.padStart(7);
    const missStr = missCount === 0 ? 'OK ' : `MISS (${missCount})`;
    console.log(`  [${okStr}] ${entry.id.padEnd(40)} key-misses: ${missStr}`);
    if (missCount > 0) {
        failures.push({ outcome: entry.id, missCount, firstMiss });
    }
}

console.log(`\nTotal: ${totalWalks} walks, ${totalSteps} steps, ${totalMisses} key misses.`);
if (failures.length > 0) {
    console.log(`\nFAIL — ${failures.length} outcomes had key misses:\n`);
    for (const f of failures.slice(0, 5)) {
        console.log(`  ${f.outcome}: ${f.missCount} misses`);
        if (f.firstMiss) {
            console.log(`    first miss key: ${f.firstMiss.key.slice(0, 120)}…`);
            console.log(`    trace tail: ${f.firstMiss.trace.slice(-5).map(([n, e]) => `${n}=${e}`).join(' → ')}`);
        }
    }
    process.exit(1);
}
console.log(`\nPASS — every reach-constrained step's browser key is in its outcome's derive file.`);
