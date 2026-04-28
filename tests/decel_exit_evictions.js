#!/usr/bin/env node
'use strict';

// Verifies that gov_action + open_source are evicted to flavor on every
// DECEL exit, and that the post-DECEL sel projection no longer carries
// either dim. Three tests:
//   1. Static — every DECEL exit tuple's effects.move includes both dims.
//   2. Live — push through the decelerate→escapes path; assert post-exit
//      sel/flavor state matches the eviction contract.
//   3. Live — push through the accelerate path (DECEL skipped); assert
//      gov_action.accelerate's effects.setFlavor / move write the
//      expected flavor values.

const fs = require('fs');
const path = require('path');

global.window = {
    location: { search: '', hash: '' },
    requestAnimationFrame: () => 0,
    addEventListener: () => {},
    Graph: require('../graph.js'),
    Engine: require('../engine.js'),
};
global.document = {
    addEventListener: () => {},
    readyState: 'complete',
    getElementById: () => null,
    querySelector: () => null,
};
const ROOT = path.resolve(__dirname, '..');
new Function('window', fs.readFileSync(path.join(ROOT, 'graph-io.js'), 'utf8'))(global.window);
new Function('window', 'document', fs.readFileSync(path.join(ROOT, 'nodes.js'), 'utf8'))(global.window, global.document);

const Engine = global.window.Engine;
const MODULE_MAP = Engine.MODULE_MAP;

// ─── Test 1: every DECEL exit tuple's installed effects block
// includes gov_action + open_source in its move list.

const decel = MODULE_MAP.decel;
const NODE_MAP = Engine.NODE_MAP;

let tupleCount = 0;
let badTuples = [];
for (const tuple of decel.exitPlan) {
    tupleCount++;
    const node = NODE_MAP[tuple.nodeId];
    if (!node || !node.edges) continue;
    const edge = node.edges.find(e => e.id === tuple.edgeId);
    if (!edge || !edge.effects) continue;
    const blocks = Array.isArray(edge.effects) ? edge.effects : [edge.effects];
    // Find the block matching this tuple's `when` — the one that should
    // include our flavor-move.
    let found = false;
    for (const b of blocks) {
        if (!b || !b.move) continue;
        if (b.move.includes('gov_action') && b.move.includes('open_source')) {
            found = true;
            break;
        }
    }
    if (!found) badTuples.push(`${tuple.nodeId}.${tuple.edgeId} (when=${JSON.stringify(tuple.when)})`);
}
console.log(`Test 1: ${tupleCount} DECEL exit tuples`);
if (badTuples.length === 0) {
    console.log(`  PASS — every tuple's effects.move includes gov_action + open_source`);
} else {
    console.log(`  FAIL — ${badTuples.length} tuples missing the flavor-move:`);
    for (const t of badTuples) console.log(`    ${t}`);
    process.exit(1);
}

// ─── Test 2: live push through a representative DECEL path.
// Decelerate → continue → escapes — exits via decel_2mo_action.escapes.

let stk = Engine.createStack();
const decelEscapesPath = [
    ['capability', 'singularity'],
    ['agi_threshold', 'few_months'],
    ['asi_threshold', 'few_months'],
    ['takeoff', 'slow'],
    ['governance_window', 'partial'],
    ['open_source', 'twelve_months'],
    ['distribution', 'monopoly'],
    ['sovereignty', 'state'],
    ['gov_action', 'decelerate'],
    ['decel_2mo_progress', 'unsolved'],
    ['decel_2mo_action', 'escapes'],
];
for (const [nid, eid] of decelEscapesPath) stk = Engine.push(stk, nid, eid);
const sel = Engine.currentState(stk);
const flavor = Engine.currentFlavor(stk);

console.log(`\nTest 2: live push through DECEL on decelerate→escapes path`);
let okCount = 0, failCount = 0;
function check(label, cond) {
    if (cond) { okCount++; }
    else { failCount++; console.log(`  FAIL — ${label}`); }
}
check('sel.gov_action is undefined post-DECEL', sel.gov_action === undefined);
check(`flavor.gov_action === 'decelerate'`, flavor.gov_action === 'decelerate');
check('sel.open_source is undefined post-DECEL', sel.open_source === undefined);
check(`flavor.open_source === 'twelve_months'`, flavor.open_source === 'twelve_months');
// alignment is committed by DECEL_EXIT_CELLS for (escapes, *) → 'failed'.
check(`sel.alignment === 'failed' (DECEL exit cell write)`, sel.alignment === 'failed');
check(`sel.containment === 'escaped' (DECEL exit cell write)`, sel.containment === 'escaped');
// governance is set by DECEL_EXIT_CELLS for escapes → 'slowdown'; this
// dim is in DECEL.internalMarkers, so it auto-evicts to flavor.
check(`flavor.governance === 'slowdown'`, flavor.governance === 'slowdown');
check(`sel.governance is undefined`, sel.governance === undefined);

if (failCount === 0) console.log(`  PASS — ${okCount}/${okCount} assertions`);
else { console.log(`  ${failCount} FAILED of ${okCount + failCount}`); process.exit(1); }

// ─── Test 3: gov_action.accelerate writes governance='race' to flavor.
// Accelerate → DECEL skipped → gov_action stays in sel → the accelerate
// edge's effects.setFlavor writes governance='race' (replaces
// the prior governance.deriveWhen rule keyed on gov_action='accelerate').

let stk2 = Engine.createStack();
const accelPath = [
    ['capability', 'singularity'],
    ['agi_threshold', 'few_months'],
    ['asi_threshold', 'few_months'],
    ['takeoff', 'slow'],
    ['governance_window', 'partial'],
    ['open_source', 'twelve_months'],
    ['distribution', 'monopoly'],
    ['sovereignty', 'state'],
    ['gov_action', 'accelerate'],
];
for (const [nid, eid] of accelPath) stk2 = Engine.push(stk2, nid, eid);
const sel2 = Engine.currentState(stk2);
const flavor2 = Engine.currentFlavor(stk2);

console.log(`\nTest 3: live push through alignment_loop on accelerate path (DECEL skipped)`);
let ok2 = 0, fail2 = 0;
function check2(label, cond) {
    if (cond) { ok2++; }
    else { fail2++; console.log(`  FAIL — ${label}`); }
}
check2(`sel.gov_action === 'accelerate' (NOT moved on accelerate edge)`, sel2.gov_action === 'accelerate');
check2(`flavor.open_source === 'twelve_months' (moved on accelerate edge)`, flavor2.open_source === 'twelve_months');
check2(`sel.open_source is undefined (moved on accelerate edge)`, sel2.open_source === undefined);
check2(`flavor.governance === 'race' (set by gov_action.accelerate)`, flavor2.governance === 'race');
check2(`sel.governance is undefined (written to flavor only)`, sel2.governance === undefined);

if (fail2 === 0) console.log(`  PASS — ${ok2}/${ok2} assertions`);
else { console.log(`  ${fail2} FAILED of ${ok2 + fail2}`); process.exit(1); }

console.log(`\nAll DECEL exit-eviction tests PASS.`);
