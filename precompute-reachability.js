#!/usr/bin/env node
'use strict';

// precompute-reachability.js — Per-outcome reach sets, keyed by
// (slot, projection) pairs instead of full sels.
//
// Two passes:
//
//   1. OUTER  — FlowPropagation-style topo walk over FLOW_DAG, with
//               masks aggregated per `<slotKey>|o|<projKey>`, where
//               projKey is the pipe-delimited compact projection of
//               the post-edge sel onto the slot's writeDims. Runtime
//               computes the same key from the post-click childSel.
//
//   2. INNER  — per-module DFS visiting every partial internal state.
//               Each visited state contributes a mask under
//               `<moduleId>|i|<projKey>` where projKey covers (module
//               reads ∪ module nodeIds) — captures the input bucket
//               that drove the DFS plus whichever internals have
//               been answered so far. Mask at a state = OR over
//               (terminal exits reachable from it) of the OUTER mask
//               for the corresponding `<slot>|o|<exitProj>`.
//
// Key encoding: `<slot|moduleId>|<i|o>|<v1>|<v2>|...` where values
// are joined with '|' in the dim list's sorted order, empty between
// pipes for unset dims. ~20× smaller than the JSON-array form the
// earlier revision used; produces files that fit GitHub Pages
// without per-outcome multi-hundred-MB raw blobs.
//
// Together these cover every state the runtime gate can land on:
// non-module clicks and module-exit clicks land on outer keys,
// mid-module clicks land on inner keys.
//
// Run: `npm run precompute-reach` (~3 min on a fast laptop, mostly
// in pass 1's `rollout` slot which fans out to ~200k inputs). Bumps
// node's heap limit because the topo pass holds ~4.5M output sels
// in flight. Pre-launch flags: invoke as
//   `node --max-old-space-size=8192 precompute-reachability.js`
// or rely on the wrapper script in `package.json` which sets it.

const fs = require('fs');
const path = require('path');
const { createGzip } = require('zlib');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');

// ─── Browser shim setup (same pattern as validate.js) ─────────────
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

const ROOT = __dirname;
const Graph = require(path.join(ROOT, 'graph.js'));
global.window.Graph = Graph;
const Engine = require(path.join(ROOT, 'engine.js'));
global.window.Engine = Engine;
new Function('window', fs.readFileSync(path.join(ROOT, 'graph-io.js'), 'utf8'))(global.window);
new Function('window', 'document', fs.readFileSync(path.join(ROOT, 'nodes.js'), 'utf8'))(global.window, global.document);
new Function('window', fs.readFileSync(path.join(ROOT, 'flow-propagation.js'), 'utf8'))(global.window);

const GraphIO = global.window.GraphIO;
GraphIO.setStrictTruncation(true);
const FlowPropagation = global.window.FlowPropagation;
const FLOW_DAG = global.window.Nodes.FLOW_DAG;
const NODES = Engine.NODES;
const NODE_MAP = Engine.NODE_MAP;
const MODULES = Engine.MODULES;
const MODULE_MAP = Engine.MODULE_MAP;

const outcomesData = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/outcomes.json'), 'utf8'));
const TEMPLATES = outcomesData.templates;
GraphIO.registerOutcomes(TEMPLATES);

// ─── Outcome entries (variant-aware) ──────────────────────────────
    const entries = [];
for (const t of TEMPLATES) {
    const variantKeys = (t.variants && typeof t.variants === 'object')
        ? Object.keys(t.variants) : [];
    if (variantKeys.length > 0 && t.primaryDimension) {
        for (const vk of variantKeys) {
                entries.push({
                    id: t.id + '--' + vk,
                templateId: t.id,
                primaryDim: t.primaryDimension,
                variantKey: vk,
            });
        }
    } else {
        entries.push({ id: t.id, templateId: t.id });
    }
}
if (entries.length > 31) {
    throw new Error(entries.length + ' entries exceeds 31-bit mask limit');
}

const entryByTemplate = new Map();
for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    e.bit = 1 << i;
    if (!entryByTemplate.has(e.templateId)) entryByTemplate.set(e.templateId, []);
    entryByTemplate.get(e.templateId).push(e);
}

function siphonBitsFor(sel, earlyExitsSet, slotKey, unauthorizedAcc) {
    const hits = GraphIO.matchOutcomes(sel);
    if (!hits.length) return { bits: 0, terminal: false };
    let bits = 0;
    for (const oid of hits) {
        // Annotation gap / clause leak: matchOutcomes hit an oid the
        // slot's earlyExits doesn't authorize. Accumulate per
        // (slotKey, oid) so the precompute can fail loudly at the
        // end — the runtime would still surface this oid (precompute
        // mask includes its bit), but the FLOW_DAG annotation says
        // this slot wasn't designed to terminate at it.
        if (earlyExitsSet && !earlyExitsSet.has(oid)) {
            let perSlot = unauthorizedAcc.get(slotKey);
            if (!perSlot) { perSlot = new Map(); unauthorizedAcc.set(slotKey, perSlot); }
            perSlot.set(oid, (perSlot.get(oid) || 0) + 1);
        }
        const es = entryByTemplate.get(oid);
        if (!es) continue;
        for (const e of es) {
            if (!e.primaryDim) { bits |= e.bit; continue; }
            // primaryDim is always a sel dim — written edge-locally
            // (e.g. ruin_type by the war + collateral_survivors exit
            // plans) so a direct sel lookup suffices.
            const v = sel[e.primaryDim];
            if (v === e.variantKey) bits |= e.bit;
        }
    }
    // terminal=true even when the variant filter zeros every bit:
    // the runtime still siphons at this outcome card and stops the
    // walk, so the static analysis must too.
    return { bits, terminal: true };
}

// Per-slot earlyExits as Set<oid> — populated once, queried per
// output sel by the forward sweep.
const earlyExitsBySlot = new Map();
for (const node of FLOW_DAG.nodes) {
    if (!node || !node.key) continue;
    earlyExitsBySlot.set(node.key, new Set(node.earlyExits || []));
}
const unauthorizedSiphons = new Map(); // slotKey → Map<oid, count>

// ─── Module ownership index ───────────────────────────────────────
// Map each internal node id to the module that owns it. Lets the
// inner pass know which module a node belongs to without scanning
// MODULES every lookup.
const MODULE_OF_NODE = new Map();
for (const m of MODULES) {
    for (const nid of (m.nodeIds || [])) MODULE_OF_NODE.set(nid, m);
}

// ─── Topological order over FLOW_DAG ──────────────────────────────
// Same shape as flow-propagation.js's _buildTopo, inlined so we can
// hook the per-input observation we need without duplicating the
// bulk pass.
const propagateTargets = new Set();
for (const node of FLOW_DAG.nodes) {
    if (!node || !node.key) continue;
    if (node.key === 'emergence') continue;
    if (node.kind === 'outcome' || node.kind === 'deadend') continue;
    propagateTargets.add(node.key);
}

const parentsOf = new Map();
const childrenOf = new Map();
for (const e of FLOW_DAG.edges) {
    const [p, c, kind] = e;
    if (kind === 'placement-outcome' || kind === 'placement-deadend') continue;
    if (kind === 'outcome-link') continue;
    if (String(c).startsWith('outcome:') || c === 'deadend') continue;
    if (!propagateTargets.has(c)) continue;
    if (!parentsOf.has(c)) parentsOf.set(c, []);
    parentsOf.get(c).push(p);
    if (!childrenOf.has(p)) childrenOf.set(p, []);
    childrenOf.get(p).push(c);
}

const allKeys = new Set([...propagateTargets, 'emergence']);
const inDeg = new Map();
for (const k of allKeys) inDeg.set(k, 0);
for (const [c, ps] of parentsOf) {
    inDeg.set(c, ps.filter(p => allKeys.has(p)).length);
}
const order = [];
{
    const queue = ['emergence'];
    while (queue.length) {
        const k = queue.shift();
        order.push(k);
        for (const c of (childrenOf.get(k) || [])) {
            if (!allKeys.has(c)) continue;
            inDeg.set(c, inDeg.get(c) - 1);
            if (inDeg.get(c) === 0) queue.push(c);
        }
    }
}

// ─── Pass 1 — outer (slot-graph) reach ────────────────────────────
//
// Forward: for each slot in topo order, dedup inputs by selKey, then
// run reachableFullSelsFromInputs per-input so we keep the
// (input → outputs) mapping. Each output sel records its
// `<slotKey>|out:<projKey>` provenance immediately; we OR that
// provenance back into a slot-keyed reach map after the backward
// pass.
//
// Backward: reverse topo, mask[selKey]_input = OR over outputs of
// mask[selKey]_output; mask[selKey]_output = siphon bits | mask of
// the same selKey treated as input at its routed-to child. Each
// slot's input sels get dropped after their backward step so the
// 4.5M sel ↦ mask map peaks once and decays during the sweep.

const UNSET = GraphIO.UNSET;
const rowToSel = (row) => {
    const sel = {};
    for (const k of Object.keys(row)) if (row[k] !== UNSET) sel[k] = row[k];
    return sel;
};

const emergenceSlot = FLOW_DAG.nodes.find(n => n.key === 'emergence');
const eW = GraphIO.cartesianWriteRows(emergenceSlot);
const emergenceOutputs = eW.rows.map(rowToSel);

const slotInputs   = new Map(); // slotKey   → Map<inputSelKey, sel>
const inputToOuts  = new Map(); // slotKey   → Map<inputSelKey, Set<outputSelKey>>
const outSiphon    = new Map(); // selKey    → bitmask
const outRouted    = new Map(); // selKey    → childSlotKey
const outProv      = new Map(); // selKey    → string ("<slotKey>|o|<projKey>")
const inputsBySlot = new Map(); // slotKey   → sel[]   (accumulated by parents)

// Set of slot keys that own a module — Pass 2 needs these slots'
// input sels retained past the backward sweep to use as DFS seeds.
// Using the actual upstream-deduped sels (rather than synthesizing
// cart-prod rows) keeps the DFS state space bounded to states
// actually reachable at runtime — no impossible pass-through-dim
// variants — and avoids blowing V8's per-Map size cap on big modules.
const MODULE_SLOT_KEYS = new Set();
for (const n of FLOW_DAG.nodes) {
    if (n && n.kind === 'module') MODULE_SLOT_KEYS.add(n.key);
}
const moduleSlotInputs = new Map(); // slotKey → Map<inputSelKey, sel>

console.log(`Pass 1 (outer): forward over ${order.length} slots…`);
const t0 = Date.now();

for (let oi = 0; oi < order.length; oi++) {
    const slotKey = order[oi];
    const slot = FLOW_DAG.nodes.find(n => n.key === slotKey);
    if (!slot) continue;

    const incomingSels = (slotKey === 'emergence')
        ? emergenceOutputs
        : (inputsBySlot.get(slotKey) || []);

    const inputMap = new Map();
    for (const sel of incomingSels) {
        const k = GraphIO.selKey(sel);
        if (!inputMap.has(k)) inputMap.set(k, sel);
    }
    slotInputs.set(slotKey, inputMap);
    // Drop the parent-accumulated array — we have the deduped map
    // now; the array's entries are pinning sel objects that we
    // can let GC reclaim once they fall out of inputMap (only
    // distinct sels survive).
    inputsBySlot.delete(slotKey);

    if (inputMap.size === 0) continue;
    if (slot.kind === 'outcome' || slot.kind === 'deadend') continue;

    const writeDims  = GraphIO.writeDimsForSlot(slot);

    const childKeys  = childrenOf.get(slotKey) || [];
    const childSlots = childKeys
        .map(k => FLOW_DAG.nodes.find(n => n.key === k))
        .filter(Boolean);

    const outsByInput = new Map();
    inputToOuts.set(slotKey, outsByInput);

    let processed = 0;
    for (const [inputKey, inputSel] of inputMap) {
        processed++;
        const r = GraphIO.reachableFullSelsFromInputs(slot, [inputSel]);
        const outsForInput = new Set();
        outsByInput.set(inputKey, outsForInput);

        for (const o of (r.outputs || [])) {
            const ok = GraphIO.selKey(o);
            outsForInput.add(ok);

            if (!outProv.has(ok)) {
                const pk = GraphIO.compactProjectKey(o, writeDims);
                outProv.set(ok, slotKey + '|o|' + pk);
            }

            // Dedup is keyed by ok across ALL slots, but routing is
            // deterministic from (parentSlot, sel), not sel alone — each
            // slot's children differ, so the best-priority child for the
            // same sel can differ across producing parents. The common
            // "pass-through" case is an edge whose writes are already in
            // sel (e.g. brittle_resolution.sufficient sets
            // alignment='brittle' on an input that already has it): the
            // output sel equals the input sel, and the upstream parent
            // already routed this ok HERE. We must NOT skip — we need to
            // re-route from THIS slot's children. The check
            // `outRouted.get(ok) !== slotKey` lets through exactly that
            // case (and only that case).
            if (outSiphon.has(ok)) continue;
            if (outRouted.has(ok) && outRouted.get(ok) !== slotKey) continue;

            const ee = earlyExitsBySlot.get(slotKey);
            const { bits, terminal } = siphonBitsFor(o, ee, slotKey, unauthorizedSiphons);
            if (terminal) {
                outSiphon.set(ok, bits);
                continue;
            }

            let bestChild = null;
            let bestPri = Infinity;
            for (const child of childSlots) {
                const p = FlowPropagation.slotPickPriority(child, o);
                if (p < bestPri) { bestPri = p; bestChild = child; }
            }
            if (bestChild) {
                outRouted.set(ok, bestChild.key);
                let arr = inputsBySlot.get(bestChild.key);
                if (!arr) { arr = []; inputsBySlot.set(bestChild.key, arr); }
                arr.push(o);
            }
            // No bestChild → dead-end output. Tracked by absence
            // from both `outSiphon` and `outRouted`.
        }
    }

    const seconds = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`  ${slotKey}: ${processed} inputs (cumulative ${seconds}s)`);
}

console.log(`  forward done in ${((Date.now() - t0) / 1000).toFixed(1)}s.`);
console.log(`  distinct output sels: ${outProv.size}`);

// FLOW_DAG.earlyExits ground-truth check. Any matchOutcomes hit at a
// slot whose earlyExits doesn't list the oid is either a clause leak
// (the outcome's reachable clauses are loose enough to match a sel
// produced by a slot not designed to terminate at it) or an
// annotation gap (the slot really should be a terminus and earlyExits
// needs extending). Either way it inflates the reach masks the
// runtime ships and should be fixed before publish.
if (unauthorizedSiphons.size > 0) {
    let total = 0;
    let pairs = 0;
    console.error('\nERROR: unauthorized siphons (oid not in slot.earlyExits):');
    const slotKeys = [...unauthorizedSiphons.keys()].sort();
    for (const sk of slotKeys) {
        const perSlot = unauthorizedSiphons.get(sk);
        const oids = [...perSlot.keys()].sort();
        for (const oid of oids) {
            const c = perSlot.get(oid);
            console.error(`  ${sk}  →  ${oid}   (${c} sel${c === 1 ? '' : 's'})`);
            total += c;
            pairs++;
        }
    }
    console.error(`  ${pairs} (slot, outcome) pair(s); ${total} sel-match(es) total.`);
    console.error('  Resolution: tighten the outcome\'s reachable clauses, or extend');
    console.error('  FLOW_DAG.nodes[<slot>].earlyExits if this slot is a legit terminus.');
    process.exitCode = 1;
}

// Backward sweep — same shape as the previous version, but we drop
// each slot's inputMap as soon as its mask is computed so the peak
// holds at most one slot's worth of sel→mask pairs, not all 4.5M.
console.log('Pass 1 (outer): backward sweep…');
const t1 = Date.now();
const inputMask = new Map(); // selKey → mask, sel-as-input-at-its-slot

// outerReach: `<slotKey>|out:<projKey>` → mask. Aggregated as we go
// so we never need to keep per-selKey OUTPUT masks alive after a
// slot's backward step finishes.
const outerReach = new Map();

for (let oi = order.length - 1; oi >= 0; oi--) {
    const slotKey = order[oi];
    const outsByInput = inputToOuts.get(slotKey);
    if (!outsByInput) continue;
    const inputMap = slotInputs.get(slotKey);
    if (!inputMap) continue;

    for (const [inputKey, _sel] of inputMap) {
        const outs = outsByInput.get(inputKey);
        let m = 0;
        if (outs) {
            for (const ok of outs) {
                const sb = outSiphon.has(ok) ? outSiphon.get(ok) : 0;
                const rt = outRouted.get(ok); // undefined if siphoned/dead
                const childMask = rt ? (inputMask.get(ok) || 0) : 0;
                const om = sb | childMask;
                const prov = outProv.get(ok);
                if (prov) outerReach.set(prov, (outerReach.get(prov) || 0) | om);
                m |= om;
            }
        }
        inputMask.set(inputKey, (inputMask.get(inputKey) || 0) | m);
    }

    // Slot done — drop its per-input output sets. The input map
    // itself is retained ONLY for module slots (Pass 2 seeds the
    // inner DFS from real upstream sels); for non-module slots we
    // drop both maps as before.
    if (MODULE_SLOT_KEYS.has(slotKey)) {
        moduleSlotInputs.set(slotKey, slotInputs.get(slotKey));
    }
    slotInputs.delete(slotKey);
    inputToOuts.delete(slotKey);
}

console.log(`  backward done in ${((Date.now() - t1) / 1000).toFixed(1)}s.`);
console.log(`  outer keys: ${outerReach.size}`);

// Free the largest residual maps before we run the inner pass.
outProv.clear();
outSiphon.clear();
outRouted.clear();
inputMask.clear();

// ─── Pass 2 — inner (per-module) reach ────────────────────────────
//
// For every module M and every input bucket the outer pass touched
// M with, walk the internal-node DFS the engine would walk at run
// time. Each visited partial state is keyed `<M.id>|i|<innerProj>`
// where innerProj projects sel onto innerDimsForSlot (readDims ∪
// nodeIds ∪ writeDims). The per-state mask is the OR over
// (terminal exits reachable from this state) of the outer mask at
// the corresponding `<slot>|o|<exitProj>`.
//
// We seed the DFS from the actual upstream-pass slot inputs (Pass 1
// retains `slotInputs` for module slots in `moduleSlotInputs`).
// These are the deduped set of sels that ACTUALLY arrive at the
// module's entry at runtime — narrower and more correct than a
// synthetic cartesian product, since it never visits impossible
// pass-through-dim variants and never over-counts dead branches.
// emergence is the one exception: it's the root slot whose Pass 1
// "inputs" are actually its own outputs (special-cased upstream),
// so we seed it with the empty sel.
//
// Two-stage dedupe inside Pass 2:
//   1. Seed dedupe by innerDims projection — two upstream sels
//      that agree on all innerDims behave identically through the
//      DFS (innerDims captures every dim that affects DFS branching
//      AND exit projection by construction).
//   2. DFS memoization keyed on innerDims projection (not full
//      selKey) — bounds the per-module memo Map well under V8's
//      ~16.7M-entry cap even for the largest module (escape).
//
// The ordering inside the DFS mirrors `_dfsModuleOutputs` /
// `engine.findNextQ`: pick the highest-priority askable internal
// node, branch on every enabled edge, applyEdgeWrites, recurse. At
// the root of each branch we record the partial state's reach
// before recursing so the recorded mask reflects both the eventual
// terminal exits and any intermediate siphons.

const innerReach = new Map();

console.log('Pass 2 (inner): per-module DFS…');
const t2 = Date.now();

// Inner-DFS pick: delegated to GraphIO.findNextInternalNode so the
// per-module DFS here, graph-io's own _dfsModuleOutputs, and any
// future tooling all share one definition of "what would the engine
// ask next inside this module?". The askability gate inside it
// delegates further to Engine.isAskableInternal — same predicate the
// runtime navigator and FlowPropagation use.

// Shared completion-marker check (engine.js); returns true iff the
// module's marker dim has a value AND that value is in the marker's
// allowed-values list. The runtime gate in index.html uses the same
// helper, so the precompute's outer-vs-inner split mirrors the live
// UI's outer-vs-inner key choice.
const _isModuleDone = (mod, sel) => Engine.isModuleDone(sel, mod.completionMarker);

// applyEdgeWrites — delegates to engine.applyEdgeEffects, the single
// block interpreter shared by runtime push, graph-io._applyEdgeWrites,
// and the UI dry-run. Static and runtime cannot drift because there is
// only one implementation. flavor=null so `move` just drops the dim
// from sel (precompute is a sel-only projection).
function _applyEdgeWrites(sel, node, edge) {
    const next = { ...sel, [node.id]: edge.id };
    Engine.applyEdgeEffects(next, edge, null);
    return next;
}


for (const mod of MODULES) {
    // FLOW_DAG slot.key is NOT the same as mod.id. Most modules are
    // 1:1 (slot.key='decel', id='decel'), but some have a single slot
    // under a different name (alignment_loop → 'alignment',
    // intent_loop → 'intent', war_loop → 'war', early_rollout →
    // 'rollout_early') and `escape` appears as FIVE slots
    // (escape_early/_alt/_late/_re_entry/_after_who). Each slot's
    // outer reach is keyed by its own slot.key during pass 1.
    //
    // For the inner DFS, the module's reads/writes/nodeIds are
    // shared across all its slots (they all wrap the same mod
    // object), so a single DFS pass covers them. But the exit-state
    // reach lookup must OR across every slot's outer reach, since
    // once we're mid-DFS the runtime can't know which FLOW_DAG slot
    // routed us in. The OR is sound (no slot can produce reach the
    // others don't) and conservative (multi-slot modules may light
    // up an option whose downstream only reaches via a different
    // entry — fine for the gate; under-greying beats over-greying).
    const slots = FLOW_DAG.nodes.filter(n =>
        n && n.kind === 'module' && n.id === mod.id);
    if (!slots.length) continue;
    const slot = slots[0];

    // innerDims includes module writeDims so the inner key
    // differentiates pass-through-dim variants (e.g. decel paths that
    // don't write geo_spread inherit it from upstream and need
    // separate inner-keys per geo_spread value to match outer-reach
    // entries precisely). See GraphIO.innerDimsForSlot for the recipe.
    const innerDims = GraphIO.innerDimsForSlot(slot);
    const writeDims = GraphIO.writeDimsForSlot(slot);

    // Seed the DFS from the actual upstream-pass slot inputs (Pass 1
    // collected and deduped these as `<slotKey> → Map<selKey,sel>`).
    // Using real upstream sels keeps the DFS state space bounded to
    // states reachable at runtime — no impossible pass-through-dim
    // combinations — and provides per-variant inputs (e.g.
    // geo_spread=one vs geo_spread=multiple) so the inner DFS visits
    // them as distinct DFS states whose exits land on distinct outer-
    // reach keys. Multi-slot modules (escape) OR over every slot's
    // input set since the runtime can't tell which slot routed the
    // user in.
    //
    // Dedupe seeds by their innerDims projection: two upstream sels
    // that agree on all innerDims behave identically through the DFS
    // (innerDims captures everything that affects DFS traversal AND
    // exit projection by construction — readDims gate condition
    // evaluation, nodeIds carry internal answers, writeDims carry
    // pass-through dims that route the exit). Variation on dims
    // OUTSIDE innerDims contributes nothing, so collapsing to one
    // representative per innerKey halves DFS work for modules whose
    // upstream sels carry lots of orthogonal context.
    //
    // emergence is the root slot — Pass 1 special-cases it by feeding
    // emergence's own *outputs* (cartesianWriteRows) back as its
    // "inputs" so downstream slots see the correct post-exit sels.
    // Those post-exit sels are NOT valid pre-entry seeds for the
    // inner DFS (they'd short-circuit to module-done immediately),
    // so we seed emergence with the empty sel — the actual runtime
    // entry state.
    const seedByInnerKey = new Map();
    if (mod.id === 'emergence') {
        seedByInnerKey.set('', {});
    } else {
        for (const s of slots) {
            const im = moduleSlotInputs.get(s.key);
            if (!im) continue;
            for (const sel of im.values()) {
                const ik = GraphIO.compactProjectKey(sel, innerDims);
                if (!seedByInnerKey.has(ik)) seedByInnerKey.set(ik, sel);
            }
        }
    }
    if (seedByInnerKey.size === 0) continue;

    let visited = 0;
    let withMask = 0;
    // Memoize on the innerDims projection (NOT full selKey). Two DFS
    // states differing only outside innerDims produce identical
    // sub-trees (DFS branching depends only on readDims; exit
    // projection only on writeDims; both are subsets of innerDims).
    // Smaller key set keeps the per-module memo well under V8's
    // ~16.7M-entry per-Map cap for big modules like escape.
    const memoMask = new Map();

    function dfs(sel) {
        const sk = GraphIO.compactProjectKey(sel, innerDims);
        if (memoMask.has(sk)) return memoMask.get(sk);

        let mask = 0;

        // Module just exited — look up the exit's outer mask. The
        // exit projection IS the same projKey
        // cartesianWriteRows.byInput uses, so the lookup hits.
        // OR over every FLOW_DAG slot for this module — see the
        // multi-slot comment at the top of the loop.
        if (_isModuleDone(mod, sel)) {
            const pk = GraphIO.compactProjectKey(sel, writeDims);
            for (const s of slots) {
                mask |= outerReach.get(s.key + '|o|' + pk) || 0;
            }
        } else {
            const n = GraphIO.findNextInternalNode(mod, sel);
            if (n) {
                for (const edge of n.edges) {
                    if (Engine.isEdgeDisabled(sel, n, edge)) continue;
                    mask |= dfs(_applyEdgeWrites(sel, n, edge));
                }
            }
            // No askable internal AND not done = dead-end branch
            // (mirrors _dfsModuleOutputs' silent discard).
        }

        memoMask.set(sk, mask);

        // Inner provenance for this state. Skip if the whole branch
        // is dead — empty masks add no info, and skipping shrinks
        // the reach files.
        if (mask !== 0) {
            const inProj = GraphIO.compactProjectKey(sel, innerDims);
            const innerKey = mod.id + '|i|' + inProj;
            innerReach.set(innerKey, (innerReach.get(innerKey) || 0) | mask);
            withMask++;
        }
        visited++;
        return mask;
    }

    for (const startSel of seedByInnerKey.values()) {
        dfs(startSel);
    }
    // Free this module's input cache before moving on — escape's 287k
    // input sels are the largest concurrent allocation in Pass 2.
    for (const s of slots) moduleSlotInputs.delete(s.key);

    console.log(`  ${mod.id}: visited ${visited} states, ${withMask} non-empty`);
}

console.log(`  inner done in ${((Date.now() - t2) / 1000).toFixed(1)}s.`);
console.log(`  inner keys: ${innerReach.size}`);

// ─── Emit per-outcome reach files (gzip only) ─────────────────────
//
// Only `.json.gz` is emitted. The browser fetches the gzip and
// decompresses with DecompressionStream; shipping raw `.json` made
// `data/reach` 100× larger on disk and in git for no UX gain.
//
// Memory discipline: we sort one shared [key, mask] array across
// all outcomes and stream-filter it per outcome straight into a
// gzip pipeline (no intermediate raw file, no in-flight outcome
// arrays). Peak working set after the DFS phases is bounded by
// the sorted array's size.
const outDir = path.join(ROOT, 'data', 'reach');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

console.log(`\nFlattening reach maps for streaming write…`);
const tFlat = Date.now();
const allEntries = new Array(outerReach.size + innerReach.size);
let idx = 0;
for (const [k, m] of outerReach) allEntries[idx++] = [k, m];
for (const [k, m] of innerReach) allEntries[idx++] = [k, m];
// Free the source maps — we have everything we need in allEntries
// now, and the next phase is the largest concurrent allocation.
outerReach.clear();
innerReach.clear();
allEntries.sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
console.log(`  ${allEntries.length} total entries sorted in ${((Date.now() - tFlat) / 1000).toFixed(1)}s.`);

console.log(`\nWriting ${entries.length} files…`);
const tWrite = Date.now();

let totalGz  = 0;
let totalKeys = 0;

// ~64KB target per gzip write — large enough to amortize the JS↔stream
// crossing (the generator-per-entry shape leaves zlib starved on a
// single CPU at ~30%), small enough to keep the in-flight buffer trim
// across the 4-way worker pool.
const CHUNK_TARGET = 64 * 1024;

async function writeReachFile(entry) {
    const gzPath = path.join(outDir, entry.id + '.json.gz');
    const bit = entry.bit;
    let count = 0;

    // Stream JSON array shape: '[' + key1 + ',' + key2 + ... + ']'.
    // Feed straight into gzip — no raw `.json` ever materialized.
    // Batch entries into ~CHUNK_TARGET-byte string chunks before
    // yielding so the gzip stream consumes one Buffer per ~thousand
    // keys instead of one per key.
    function* jsonChunks() {
        let buf = '[';
        let first = true;
        for (let i = 0; i < allEntries.length; i++) {
            const e = allEntries[i];
            if (!(e[1] & bit)) continue;
            if (first) {
                buf += JSON.stringify(e[0]);
                first = false;
            } else {
                buf += ',' + JSON.stringify(e[0]);
            }
            count++;
            if (buf.length >= CHUNK_TARGET) {
                yield buf;
                buf = '';
            }
        }
        buf += ']';
        if (buf.length) yield buf;
    }

    // Readable.from(generator) defaults to objectMode:true, which
    // gzip refuses (it wants bytes). Force a byte stream by passing
    // { objectMode: false } so each yielded string is emitted as
    // a Buffer chunk on the wire.
    //
    // Default gzip level (6) is used: level 9 spends ~3-4× the CPU
    // for <2% additional compression on this corpus. zlib runs on
    // libuv worker threads, so multiple in-flight gzip streams (see
    // `runPool` below) actually parallelize across cores.
    await pipeline(
        Readable.from(jsonChunks(), { objectMode: false }),
        createGzip(),
            fs.createWriteStream(gzPath)
    );
    const gzSize = fs.statSync(gzPath).size;
    return { gzSize, count };
}

// Bounded-concurrency worker pool. gzip is CPU-bound and Node releases
// the libuv worker between chunks, so 4 in flight saturates a typical
// laptop without thrashing.
async function runPool(items, concurrency, fn) {
    const results = new Array(items.length);
    let next = 0;
    async function worker() {
        while (true) {
            const i = next++;
            if (i >= items.length) return;
            results[i] = await fn(items[i], i);
        }
    }
    const workers = [];
    for (let w = 0; w < concurrency; w++) workers.push(worker());
    await Promise.all(workers);
    return results;
}

(async () => {
    const results = await runPool(entries, 4, async (entry) => {
        const { gzSize, count } = await writeReachFile(entry);
        console.log(`  ${entry.id}: ${count} keys, ${(gzSize / 1024).toFixed(1)}KB gz`);
        return { entry, gzSize, count };
    });
    let zero = 0;
    for (const r of results) {
        totalGz += r.gzSize;
        totalKeys += r.count;
        if (r.count === 0) zero++;
    }
    console.log(`\nDone. ${entries.length} files written in ${((Date.now() - tWrite) / 1000).toFixed(1)}s.`);
    console.log(`  Gzipped total: ${(totalGz / 1024).toFixed(1)}KB across ${totalKeys} key emissions.`);
    if (zero > 0) {
        console.warn(`  WARN: ${zero} entries have empty reach sets — outcome unreachable`);
        process.exitCode = 1;
    }
})().catch(err => {
    console.error('precompute write failed:', err);
    process.exit(1);
});
