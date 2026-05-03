#!/usr/bin/env node
'use strict';

// module_no_repeat_questions.js — Asserts every module asks each
// internal nodeId at most ONCE per walk through the module.
//
// Triggers when an edge's `effects.move` clears a dim that's still
// in the module's `nodeIds` set: the runtime's findNextInternalNode
// loop then re-offers the same question. UX-visible as the same
// modal appearing twice (e.g. proliferation_outcome=leaks_public
// moving proliferation_control out → proliferation_control re-asked).
//
// Method: per module, DFS from every input bucket recorded in the
// explore-cache predecessor sels (so disabledWhen / requires /
// activateWhen predicates fire as they do at runtime). Track the
// nodeIds answered along the current path; if findNextInternalNode
// ever returns a nodeId already in the set, flag the violation.
//
// emergence is the root slot (no upstream pred sels in the cache),
// seeded with the empty sel — same special-case the reach precompute
// uses.
//
// Memo key: (selKey, sortedAnsweredKey). Two paths converging to the
// same sel via different answered sets can still differ on what
// findNextInternalNode does next (one may re-ask a moved-out dim
// the other never answered), so we can't dedupe by sel alone.

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

const ROOT = path.join(__dirname, '..');
const Graph = require(path.join(ROOT, 'graph.js'));
global.window.Graph = Graph;
const Engine = require(path.join(ROOT, 'engine.js'));
global.window.Engine = Engine;
new Function('window', fs.readFileSync(path.join(ROOT, 'graph-io.js'), 'utf8'))(global.window);
new Function('window', 'document', fs.readFileSync(path.join(ROOT, 'nodes.js'), 'utf8'))(global.window, global.document);

const GraphIO = global.window.GraphIO;
const FLOW_DAG = global.window.Nodes.FLOW_DAG;
const MODULES = Engine.MODULES;

const outcomesData = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/outcomes.json'), 'utf8'));
GraphIO.registerOutcomes(outcomesData.templates);

const Cache = require(path.join(ROOT, 'explore-cache'));

if (!fs.existsSync(path.join(ROOT, 'data', 'explore-cache', '_meta.json'))) {
    console.error('data/explore-cache missing — run `npm run precompute` first.');
    process.exit(1);
}

const DEPTH_CAP = 50; // Modules are ≤ ~10 internal dims; 50 is generous.

const violations = [];

function dfs(sel, mod, slotKey, answered, memo, depth, trace) {
    if (depth > DEPTH_CAP) return;

    if (mod.completionMarker && Engine.isModuleDone(sel, mod.completionMarker)) return;

    const node = GraphIO.findNextInternalNode(mod, sel);
    if (!node) return;

    if (answered.has(node.id)) {
        violations.push({
            modId: mod.id,
            slotKey,
            repeatedNode: node.id,
            answered: [...answered],
            sel: { ...sel },
            trace: [...trace],
        });
        return;
    }

    // Memo: skip equivalent (sel, answered) revisits. Sorted answered
    // keys keep the memo hash stable across different visit orders.
    const memoKey = GraphIO.selKey(sel) + '\x01' + [...answered].sort().join(',');
    if (memo.has(memoKey)) return;
    memo.add(memoKey);

    const newAnswered = new Set(answered);
    newAnswered.add(node.id);

    for (const edge of node.edges) {
        if (Engine.isEdgeDisabled(sel, node, edge)) continue;
        const next = Object.assign({}, sel, { [node.id]: edge.id });
        Engine.applyEdgeEffects(next, edge, null);
        trace.push(node.id + '=' + edge.id);
        dfs(next, mod, slotKey, newAnswered, memo, depth + 1, trace);
        trace.pop();
    }
}

console.log('Walking modules…');
const t0 = Date.now();

for (const mod of MODULES) {
    const slots = FLOW_DAG.nodes.filter(n => n && n.kind === 'module' && n.id === mod.id);
    if (!slots.length) continue;

    // Seed sels: every predecessor full sel of every wrapping slot,
    // deduped by readDims projection (same as derive-reach-per-outcome's
    // seeding; states agreeing on read dims branch identically through
    // the module). emergence is the root slot — no upstream — seeded
    // with the empty sel.
    const slot = slots[0];
    const readDims = GraphIO.readDimsForSlot(slot);
    const seedByReadKey = new Map();

    if (mod.id === 'emergence') {
        seedByReadKey.set('', {});
    } else {
        for (const s of slots) {
            const v = Cache.openFullSels(s.key);
            if (!v) continue;
            for (let i = 0; i < v.selCount; i++) {
                v.iteratePreds(i, predSel => {
                    const k = GraphIO.compactProjectKey(predSel, readDims);
                    if (!seedByReadKey.has(k)) seedByReadKey.set(k, predSel);
                });
            }
        }
    }
    if (seedByReadKey.size === 0) continue;

    const memo = new Set();
    const before = violations.length;
    for (const seed of seedByReadKey.values()) {
        dfs(seed, mod, slot.key, new Set(), memo, 0, []);
    }
    const added = violations.length - before;
    console.log(`  ${mod.id.padEnd(20)} ${seedByReadKey.size.toString().padStart(6)} seeds, ${memo.size.toString().padStart(7)} states explored${added > 0 ? `  → ${added} violation(s)` : ''}`);
}

const dt = ((Date.now() - t0) / 1000).toFixed(2);
console.log(`\nDone in ${dt}s.`);

if (violations.length === 0) {
    console.log('PASS — every module asks each internal node at most once per walk.');
    process.exit(0);
}

// Group by (modId, repeatedNode) so we get one diagnostic per
// distinct violation pattern instead of per state.
const grouped = new Map();
for (const v of violations) {
    const key = v.modId + '|' + v.repeatedNode;
    if (!grouped.has(key)) {
        grouped.set(key, { modId: v.modId, repeatedNode: v.repeatedNode, samples: [] });
    }
    const g = grouped.get(key);
    if (g.samples.length < 3) g.samples.push(v);
}

console.log(`\nFAIL — ${grouped.size} distinct repeat-question pattern(s) across ${violations.length} state(s):\n`);
for (const g of grouped.values()) {
    console.log(`  module=${g.modId}  repeatedNode=${g.repeatedNode}  (${violations.filter(v => v.modId === g.modId && v.repeatedNode === g.repeatedNode).length} states)`);
    for (const s of g.samples) {
        console.log(`    trace: ${s.trace.join(' → ')}`);
        console.log(`    sel at re-ask: ${JSON.stringify(s.sel)}`);
        console.log(`    answered already: [${s.answered.join(', ')}]`);
    }
    console.log();
}
process.exit(1);
