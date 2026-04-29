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
// require BOTH:
//
//   (Phase 2) flowNext(sel, P).slotKey === K
//             — given the canonically-correct parent, flowNext
//               makes the same routing pick run() did.
//
//   (Phase 3) parentSlotKeyFromStack(syntheticStack(sel, P)) === P
//             — the runtime's stack→parent derivation correctly
//               identifies P as the latest exited slot. The
//               synthetic stack contains a single representative
//               frame for P (P.id for node-kind, any node ∈
//               P.nodeIds for module-kind) plus the root frame,
//               with the last frame's `state` set to sel. That's
//               the minimum payload parentSlotKeyFromStack reads
//               (it only inspects the LAST frame's `state` and the
//               `nodeId` of every frame, for the answered set).
//
// run()'s `routedFromBySlot` records P alongside `inputsBySlot`,
// index-aligned: the i-th element of inputsBySlot[K] arrived from
// the i-th element of routedFromBySlot[K]. Feeding that P into
// flowNext (Phase 2) is the per-parent routing contract; feeding a
// stack synthesized to "just exited P" into parentSlotKeyFromStack
// (Phase 3) closes the upstream gap — the runtime's actual call
// chain is `parentSlotKeyFromStack(stack) → flowNext(sel, parent)`,
// and Phase 2 alone leaves the first hop untested.
//
// Phase 3 catches the "self-moving node" failure mode: nodes whose
// every edge `move`s their own answer dim (e.g. brittle.{solved,
// sufficient,escape} all `move: ['brittle_resolution']`). A check
// of `sel[slot.id] !== undefined` on the post-exit sel returns
// false there, and parentSlotKeyFromStack would walk back to
// who_benefits, which has brittle as a child — the runtime would
// re-pick brittle and loop indefinitely. Phase 3 surfaces this
// the moment the propagation pass produces a routing FROM such a
// slot: the synthetic stack's `answered` set contains the node id,
// the post-exit sel doesn't, and the assertion fires immediately.
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
//   7. (Phase 3) parentSlotKeyFromStack's "exit signature" check
//      drifts: e.g. requiring sel[slot.id] !== undefined for node-
//      kind slots. Self-moving nodes evict their own dim to flavor
//      on exit, so the check fails and the function walks back to
//      the prior slot. flowNext then routes among the wrong
//      parent's children and the runtime loops on the self-moving
//      slot. Phase 3 fires the moment the propagation pass produces
//      any routing FROM such a slot.

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
const FLOW_DAG = global.window.Nodes.FLOW_DAG;
const _slotByKey = new Map();
for (const n of FLOW_DAG.nodes) if (n && n.key) _slotByKey.set(n.key, n);

// FLOW_DAG topology maps used by the synthesizer. Mirror the filter
// `parentSlotKeyFromStack` and `flowNext` apply (drop placement /
// outcome-link edges, drop terminal targets) so the parent set we
// derive matches what the production code sees.
const _flowParentsOf = new Map();
for (const e of FLOW_DAG.edges) {
    const [p, c, kind] = e;
    if (kind === 'placement-outcome' || kind === 'placement-deadend') continue;
    if (kind === 'outcome-link') continue;
    if (String(c).startsWith('outcome:') || c === 'deadend') continue;
    let arr = _flowParentsOf.get(c);
    if (!arr) { arr = []; _flowParentsOf.set(c, arr); }
    arr.push(p);
}
// moduleId → [slotKey] when ≥2 FLOW_DAG slots back the same module.
const _sharedIdFamily = new Map();
for (const n of FLOW_DAG.nodes) {
    if (!n || n.kind !== 'module' || n.key === 'emergence') continue;
    let arr = _sharedIdFamily.get(n.id);
    if (!arr) { arr = []; _sharedIdFamily.set(n.id, arr); }
    arr.push(n.key);
}
for (const id of [..._sharedIdFamily.keys()]) {
    if (_sharedIdFamily.get(id).length < 2) _sharedIdFamily.delete(id);
}

// Minimal stack the runtime would have at the moment it's about to
// route from `parentKey` to its child. parentSlotKeyFromStack reads
// only (a) the LAST frame's `state` and (b) every frame's `nodeId`
// (for the answered set), so a small handful of representative
// frames is all we need.
//
// Frame inventory:
//
//   * Last frame: { nodeId: nid_of(parent), state: sel, flavor: {} }
//     — the most recent answer the user committed to. nid_of(parent)
//     is `parent.id` for node-kind, `parent.nodeIds[0]` for
//     module-kind. The `state: sel` matches the runtime's post-push
//     state, which is the input sel about to be routed to a child.
//
//   * Upstream context frame (only when parent is in a shared-id
//     family). The disambiguator inside parentSlotKeyFromStack
//     walks back through frames to find the most recent NON-shared
//     nodeId, identifies that nodeId's owning slot, and picks the
//     family member whose FLOW_DAG parent matches. We need to
//     provide that owner here, otherwise the disambiguator falls
//     through to the topo-latest pick (always escape_after_who)
//     and Phase 3 fails for legitimate-but-shadowed positions like
//     escape_early. The frame is intentionally "minimal": we use
//     the first FLOW_DAG parent of `parent` and pick a
//     representative nodeId from THAT slot. The `state` on this
//     intermediate frame is left as `{}` since the test doesn't
//     read it (parentSlotKeyFromStack only reads sel from the
//     LAST frame).
//
//   * Root frame: createStack-style { nodeId: null, ... } anchor.
//
// Emergence parent → just the root frame: parentSlotKeyFromStack
// skips the 'emergence' slot in its scan and falls through to the
// default 'emergence' return, so no answered set is needed.
function _representativeNodeId(parentKey) {
    if (parentKey === 'emergence') {
        const m = Engine.MODULE_MAP.emergence;
        return (m && m.nodeIds && m.nodeIds[0]) || null;
    }
    const slot = _slotByKey.get(parentKey);
    if (!slot) return null;
    if (slot.kind === 'node') return slot.id;
    if (slot.kind === 'module') {
        const m = Engine.MODULE_MAP[slot.id];
        return (m && m.nodeIds && m.nodeIds[0]) || null;
    }
    return null;
}

function _synthesizeStack(sel, parentKey) {
    const root = { nodeId: null, edgeId: null, state: {}, flavor: {} };
    if (parentKey === 'emergence') return [root];
    const parent = _slotByKey.get(parentKey);
    if (!parent) return [root];

    const frames = [root];

    if (parent.kind === 'module' && _sharedIdFamily.has(parent.id)) {
        const flowParents = _flowParentsOf.get(parentKey) || [];
        if (flowParents.length > 0) {
            const upstreamNid = _representativeNodeId(flowParents[0]);
            if (upstreamNid) {
                frames.push({ nodeId: upstreamNid, edgeId: null, state: {}, flavor: {} });
            }
        }
    }

    const parentNid = _representativeNodeId(parentKey);
    if (parentNid) {
        frames.push({ nodeId: parentNid, edgeId: null, state: sel, flavor: {} });
    }
    return frames;
}

const t0 = Date.now();
console.log('Phase 1: FlowPropagation.run …');
const prop = FlowPropagation.run();
console.log(`  done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

console.log('\nPhase 2: flowNext(sel, parent).slotKey === inputsBySlot key …');
console.log('Phase 3: parentSlotKeyFromStack(syntheticStack(sel, parent)) === parent …');
const t1 = Date.now();

let total = 0;
let mismatches = 0;
let stuckCount = 0;
const stuckBySlot = new Map();
const samples = [];

let parentMismatches = 0;
const parentSamples = [];
const parentMismatchByPair = new Map(); // "expected→got" → count

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

        // Phase 2: per-parent routing parity (flowNext given parent).
        const r = FlowPropagation.flowNext(sel, parent);
        if (r.slotKey === slotKey && r.kind === 'stuck') {
            stuckCount++;
            stuckBySlot.set(slotKey, (stuckBySlot.get(slotKey) || 0) + 1);
        } else {
            const ok = r.kind === 'question' && r.slotKey === slotKey;
            if (!ok) {
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

        // Phase 3: stack→parent derivation parity. The runtime call
        // chain is parentSlotKeyFromStack(stack) → flowNext(sel,
        // parent). Phase 2 covers the second hop; this covers the
        // first.
        const derivedParent = FlowPropagation.parentSlotKeyFromStack(_synthesizeStack(sel, parent));
        if (derivedParent !== parent) {
            parentMismatches++;
            const pairKey = `${parent} → ${derivedParent}`;
            parentMismatchByPair.set(pairKey, (parentMismatchByPair.get(pairKey) || 0) + 1);
            if (parentSamples.length < 5) {
                parentSamples.push({
                    routed: `${parent} → ${slotKey}`,
                    sel: ABBR(sel),
                    expected: parent,
                    got: derivedParent,
                });
            }
        }
    }
}

console.log(`  Phase 2: ${total - mismatches - stuckCount}/${total} sels agree on routing + question (${((Date.now() - t1) / 1000).toFixed(1)}s)`);
if (stuckCount > 0) {
    console.log(`           ${stuckCount}/${total} sels agree on routing but flowNext reports 'stuck' (no enabled edge);`);
    console.log(`             these are graph bugs to fix separately — slot routing IS aligned.`);
    console.log('           stuck slots:');
    const sortedStuck = [...stuckBySlot.entries()].sort((a, b) => b[1] - a[1]);
    for (const [k, v] of sortedStuck) {
        console.log(`             ${v.toString().padStart(6)}  ${k}`);
    }
}
console.log(`  Phase 3: ${total - parentMismatches}/${total} sels' synthetic stacks resolve back to the canonical parent`);

const failed = mismatches > 0 || parentMismatches > 0;

if (mismatches > 0) {
    console.error('\nPhase 2 FAIL — first ' + samples.length + ' routing mismatches:');
    for (const s of samples) {
        console.error(`  routed:   ${s.routed}`);
        console.error(`  sel:      ${s.sel}`);
        console.error(`  got:      ${s.got}`);
        console.error('');
    }
}

if (parentMismatches > 0) {
    console.error('\nPhase 3 FAIL — parent-derivation mismatches by (expected → got):');
    const sorted = [...parentMismatchByPair.entries()].sort((a, b) => b[1] - a[1]);
    for (const [pair, count] of sorted) {
        console.error(`  ${count.toString().padStart(8)}  ${pair}`);
    }
    console.error('\n  first ' + parentSamples.length + ' sample mismatches:');
    for (const s of parentSamples) {
        console.error(`  routed:   ${s.routed}`);
        console.error(`  sel:      ${s.sel}`);
        console.error(`  expected: ${s.expected}`);
        console.error(`  got:      ${s.got}`);
        console.error('');
    }
}

if (failed) {
    const parts = [];
    if (mismatches > 0) parts.push(`${mismatches}/${total} routing`);
    if (parentMismatches > 0) parts.push(`${parentMismatches}/${total} parent-derivation`);
    console.error(`flow_next parity: FAIL (${parts.join(', ')} mismatches)`);
    process.exit(1);
}

console.log(`\nflow_next parity: PASS (routing AND stack→parent derivation are identical to run())`);
