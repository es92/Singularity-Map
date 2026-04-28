#!/usr/bin/env node
'use strict';

// reach_parity.js — Verifies that the runtime key construction in
// `wouldReachOutcome` (index.html) lands on the same Set entries the
// precompute (`precompute-reachability.js`) emitted into
// `data/reach/<outcome>.json.gz`. The browser is unreachable from
// this harness, so we re-implement the key derivation node-side and
// walk a known-reachable outcome path, asserting the post-edge key
// is a member of that outcome's reach Set at every step.
//
// Two failure modes this guards against:
//   1. Precompute emits keys in form X but runtime computes form Y →
//      every UI gate returns false, every post-lock answer is hidden.
//   2. runtime push diverges from _applyEdgeWrites in precompute →
//      a post-edge sel projects to a different bucket than the one
//      the precompute recorded; gate returns false on a real path.
//      (Single shared block interpreter prevents this in practice.)

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

const ROOT = path.resolve(__dirname, '..');
const Graph = require(path.join(ROOT, 'graph.js'));
global.window.Graph = Graph;
const Engine = require(path.join(ROOT, 'engine.js'));
global.window.Engine = Engine;
new Function('window', fs.readFileSync(path.join(ROOT, 'graph-io.js'), 'utf8'))(global.window);
new Function('window', 'document', fs.readFileSync(path.join(ROOT, 'nodes.js'), 'utf8'))(global.window, global.document);
const GraphIO  = global.window.GraphIO;
const FLOW_DAG = global.window.Nodes.FLOW_DAG;

const outcomes = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/outcomes.json'), 'utf8'));
GraphIO.registerOutcomes(outcomes.templates);

// Build the same indexes the runtime gate uses.
const moduleOfNode = new Map();
for (const m of (Engine.MODULES || [])) {
    for (const nid of (m.nodeIds || [])) moduleOfNode.set(nid, m);
}
const slotByKey = new Map();
for (const s of FLOW_DAG.nodes) slotByKey.set(s.key, s);
// FLOW_DAG slot.key ≠ mod.id in several cases (alignment_loop →
// 'alignment', intent_loop → 'intent', war_loop → 'war',
// early_rollout → 'rollout_early') and the escape module appears
// as 5 distinct slots. Pick any matching slot for read/write dim
// derivation — they share the same mod.
const innerDimsByModule = new Map();
for (const m of (Engine.MODULES || [])) {
    const slot = FLOW_DAG.nodes.find(n =>
        n && n.kind === 'module' && n.id === m.id);
    if (!slot) continue;
    const dims = [...new Set([
        ...GraphIO.readDimsForSlot(slot),
        ...(m.nodeIds || []),
    ])].sort();
    innerDimsByModule.set(m.id, dims);
}

// Mirror of `_lightPush` + key construction in index.html.
function lightPush(sel, flavor, nodeId, edgeId) {
    const next = Object.assign({}, sel, { [nodeId]: edgeId });
    const nextFlavor = flavor ? Object.assign({}, flavor) : {};
    const node = Engine.NODE_MAP[nodeId];
    const edge = node && node.edges && node.edges.find(e => e.id === edgeId);
    if (edge) Engine.applyEdgeEffects(next, edge, nextFlavor);
    return { sel: next, flavor: nextFlavor };
}

function reachKey(childSel, nodeId) {
    const owningModule = moduleOfNode.get(nodeId);
    if (owningModule) {
        // Module clicks always use the inner key — exit reach is
        // OR-folded into the inner mask by the precompute, so we
        // don't need a separate `|o|` lookup. See
        // wouldReachOutcome in index.html for the matching shape.
        const innerDims = innerDimsByModule.get(owningModule.id) || [];
        return owningModule.id + '|i|' + GraphIO.compactProjectKey(childSel, innerDims);
    }
    const slot = slotByKey.get(nodeId);
    if (!slot) return null;
    const writeDims = GraphIO.writeDimsForSlot(slot);
    return nodeId + '|o|' + GraphIO.compactProjectKey(childSel, writeDims);
}

// Path adapted from tests/module_primitive.js's escape integration —
// known to land on `the-ruin` (post_catch=ruined, war_survivors=most).
const RUIN_PATH = [
    ['capability', 'singularity'],
    ['agi_threshold', 'few_months'],
    ['asi_threshold', 'few_months'],
    ['takeoff', 'slow'],
    ['governance_window', 'partial'],
    ['open_source', 'six_months'],
    ['distribution', 'monopoly'],
    // geo_spread.one is the only enabled edge under distribution=monopoly
    // (two/several are `disabledWhen: { distribution: ['monopoly'] }`),
    // so the runtime UI auto-locks it before sovereignty becomes
    // askable. tests/module_primitive.js's path elides this — its
    // assertions are downstream of `control_set=yes`, which fires
    // either way — but the parity test here needs the same sel the
    // browser would produce, so we click it explicitly.
    ['geo_spread', 'one'],
    ['sovereignty', 'state'],
    // alignment_loop's internal-node order is
    // [alignment, alignment_durability, containment, gov_action],
    // so the engine asks `alignment` BEFORE `gov_action`. Pick the
    // brittle+holds branch so gov_action's activation gate fires
    // (alignment.robust would disable decelerate; alignment.failed
    // routes through containment which hides gov_action when
    // escaped). decel.action=escapes later overwrites alignment +
    // containment to failed/escaped en route to the-ruin.
    ['alignment', 'brittle'],
    ['alignment_durability', 'holds'],
    ['gov_action', 'decelerate'],
    ['decel_2mo_progress', 'unsolved'],
    ['decel_2mo_action', 'escapes'],
    ['ai_goals', 'paperclip'],
    ['escape_method', 'nanotech'],
    ['escape_timeline', 'days_weeks'],
    ['discovery_timing', 'early_execution'],
    ['response_method', 'physical_strikes'],
    ['response_success', 'yes'],
    ['collateral_impact', 'civilizational'],
    // catch_outcome is gated on who_benefits_set='yes' (graph.js:1511)
    // — the escape pipeline only routes through who_benefits at the
    // late slots. This path is the early-escape route (decel.escapes
    // → escape mid-DFS → discovery / response / collateral), where
    // catch defaults to post_catch=contained via the collateral_impact
    // exit tuple, so we never ask catch_outcome.
    ['collateral_survivors', 'most'],
];

// post_catch=ruined → ruin_type derives 'self_inflicted', not 'war'.
const targetOutcome = 'the-ruin--self_inflicted';
// Reach files ship as `.json.gz` only — runtime decompresses with
// DecompressionStream, this Node test uses zlib.gunzipSync.
const reachArr = JSON.parse(zlib.gunzipSync(fs.readFileSync(
    path.join(ROOT, 'data/reach', targetOutcome + '.json.gz'))).toString());
const reachSet = new Set(reachArr);

let stk = Engine.createStack();
let misses = 0;
const sample = [];
for (const [nid, eid] of RUIN_PATH) {
    const sel = Engine.currentState(stk);
    const flavor = Engine.currentFlavor(stk);
    const { sel: childSel } = lightPush(sel, flavor, nid, eid);
    const key = reachKey(childSel, nid);
    const hit = key && reachSet.has(key);

    // Every internal step on a path that *does* land on the-ruin--war
    // should be flagged "reachable" by the precompute. The terminal
    // step is the exception: post-click sel matches the outcome
    // template, so the runtime gate isn't asked again — but the
    // reach-set still records the post-edge key (since the precompute
    // emits provenance for outputs even when they immediately
    // siphon, so long as the outcome's bit ends up in their mask).
    if (!hit) {
        misses++;
        if (sample.length < 5) sample.push({ nid, eid, key });
    }
    stk = Engine.push(stk, nid, eid);
}

const finalSel = Engine.currentState(stk);
const matched = GraphIO.matchOutcomes(finalSel);
const finalRuinType = Engine.resolvedVal(finalSel, 'ruin_type');

console.log(`Walked ${RUIN_PATH.length} edges → matched outcome(s): ${matched.join(', ')}`);
console.log(`  ruin_type resolves to: ${finalRuinType}`);
console.log(`  reach hits: ${RUIN_PATH.length - misses}/${RUIN_PATH.length}`);
if (misses > 0) {
    console.log(`  MISSES (${misses}):`);
    for (const m of sample) console.log(`    ${m.nid}=${m.eid}  →  key=${m.key}`);
    process.exit(1);
}
console.log(`reach parity (${targetOutcome}): PASS`);
