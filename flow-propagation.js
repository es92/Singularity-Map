// flow-propagation.js — DAG-level driver that composes graph-io's
// per-slot primitives into a topological propagation pass over
// FLOW_DAG, starting from emergence.
//
// This is the engine that powers both:
//   * validate.js Phase 2+    — invariant checks (dead ends, gate vs.
//                                internals, edge coverage, outcome
//                                reachability).
//   * precompute-reachability — per-outcome reach tables shipped to
//                                the browser.
//
// Both callers want the same pass; they differ only in what they
// observe as it runs. Callers register optional hooks (onSlotOutput,
// onOutcomeMatch) and read the aggregate result for everything else.
//
// Loaded as an IIFE that attaches to window.FlowPropagation. Node
// callers shim window the same way validate.js does (graph.js +
// engine.js as CommonJS, graph-io.js + nodes.js + this file as
// IIFEs into the shim).
//
// Public API:
//
//   FlowPropagation.run(opts) → {
//     inputsBySlot   Map<slotKey, sel[]>      sels routed INTO each slot
//     routedBySlot   Map<slotKey, sel[]>      parent outputs that found a child
//     deadBySlot     Map<slotKey, sel[]>      parent outputs no child accepts
//     routedToChild  Map<parentKey, Map<childKey, count>>
//     acceptedBySlot Map<slotKey, number>     inputs accepted by slot
//     matchedBySlot  Map<slotKey, number>     outputs siphoned to outcomes
//     outcomeAgg     Map<oid, number>         outputs siphoned to each outcome
//     parentsOf      Map<slotKey, slotKey[]>
//     childrenOf     Map<slotKey, slotKey[]>
//     order          slotKey[]                topo order
//   }
//
//   opts:
//     propagateTargets?   Set<slotKey>        defaults to every non-
//                                              outcome/deadend slot in
//                                              FLOW_DAG except emergence.
//                                              Override only if you need
//                                              to scope the walk.
//     onSlotOutput?       (slotKey, sel) => void
//                                              called for every continuing
//                                              output produced by a slot
//                                              (i.e. didn't siphon to an
//                                              outcome). Use to capture
//                                              per-slot, per-sel data
//                                              without storing it all in
//                                              the result object.
//     onOutcomeMatch?     (outcomeId, sel, slotKey) => void
//                                              called once per (sel,
//                                              outcome) pair when a sel
//                                              produced by `slotKey` is
//                                              siphoned to `outcomeId`.
//                                              For sels matching multiple
//                                              outcomes, fires once per
//                                              outcome.
//
// Dependencies (read off `window` lazily so load-order is forgiving):
//   window.GraphIO     — cartesianWriteRows, reachableFullSelsFromInputs,
//                        matchOutcomes, UNSET
//   window.Engine      — NODE_MAP, MODULE_MAP, matchCondition
//   window.Nodes       — FLOW_DAG (nodes + edges)

(function () {
    'use strict';

    function _GraphIO() { return (typeof window !== 'undefined' && window.GraphIO) || null; }
    function _Engine()  { return (typeof window !== 'undefined' && window.Engine)  || null; }
    function _FlowDag() {
        const N = (typeof window !== 'undefined' && window.Nodes) || null;
        return N && N.FLOW_DAG ? N.FLOW_DAG : null;
    }

    // Default propagation set: every FLOW_DAG slot that isn't terminal
    // and isn't the emergence seed. Derived from the live graph so it
    // can't drift relative to the slot inventory.
    function _defaultPropagateTargets(flowDag) {
        const out = new Set();
        for (const node of flowDag.nodes) {
            if (!node || !node.key) continue;
            if (node.key === 'emergence') continue;
            if (node.kind === 'outcome' || node.kind === 'deadend') continue;
            out.add(node.key);
        }
        return out;
    }

    // ─── Slot priority pick ─────────────────────────────────────────
    // Mirrors the navigator's runtime behavior: the next slot for a
    // sel is the one whose lowest-priority askable internal node has
    // the smallest priority value. Modules whose completionMarker is
    // already set are ineligible (they're "done"). Outcome / deadend
    // slots aren't candidates here — outcomes are siphoned by
    // GraphIO.matchOutcomes upstream.
    //
    // Askability for individual nodes is delegated to
    // Engine.isAskableInternal (the same predicate the runtime priority
    // gate and graph-io's module DFS use), so the three callers stay
    // in lockstep on the definition.
    function _slotPickPriority(Engine, slot, sel) {
        if (!slot || slot.kind === 'outcome' || slot.kind === 'deadend') return Infinity;
        if (slot.kind === 'node') {
            const n = Engine.NODE_MAP[slot.id];
            if (!Engine.isAskableInternal(sel, n)) return Infinity;
            return n.priority !== undefined ? n.priority : 0;
        }
        if (slot.kind === 'module') {
            const m = Engine.MODULE_MAP[slot.id];
            if (!m) return Infinity;
            if (m.completionMarker && sel[m.completionMarker] !== undefined) return Infinity;
            const aw = m.activateWhen, hw = m.hideWhen;
            if (aw && aw.length && !aw.some(c => Engine.matchCondition(sel, c))) return Infinity;
            if (hw && hw.length && hw.some(c => Engine.matchCondition(sel, c))) return Infinity;
            let minP = Infinity;
            for (const nid of (m.nodeIds || [])) {
                const n = Engine.NODE_MAP[nid];
                if (!Engine.isAskableInternal(sel, n)) continue;
                const p = n.priority !== undefined ? n.priority : 0;
                if (p < minP) minP = p;
            }
            return minP;
        }
        return Infinity;
    }

    // ─── Topological order over the propagation set ─────────────────
    function _buildTopo(flowDag, propagateTargets) {
        const parentsOf = new Map();
        const childrenOf = new Map();
        for (const e of flowDag.edges) {
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
        for (const [c, ps] of parentsOf) inDeg.set(c, ps.filter(p => allKeys.has(p)).length);
        const order = [];
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
        return { parentsOf, childrenOf, order };
    }

    // ─── Main ───────────────────────────────────────────────────────
    function run(opts) {
        opts = opts || {};
        const GraphIO = _GraphIO();
        const Engine  = _Engine();
        const flowDag = _FlowDag();
        if (!GraphIO || !Engine || !flowDag) {
            throw new Error('FlowPropagation.run: GraphIO/Engine/Nodes not loaded yet');
        }

        const propagateTargets = opts.propagateTargets || _defaultPropagateTargets(flowDag);
        const onSlotOutput   = typeof opts.onSlotOutput   === 'function' ? opts.onSlotOutput   : null;
        const onOutcomeMatch = typeof opts.onOutcomeMatch === 'function' ? opts.onOutcomeMatch : null;

        const { parentsOf, childrenOf, order } = _buildTopo(flowDag, propagateTargets);

        // Convert UNSET-aware cart-product rows into plain sels.
        const UNSET = GraphIO.UNSET;
        const rowToSel = (row) => {
            const sel = {};
            for (const k of Object.keys(row)) if (row[k] !== UNSET) sel[k] = row[k];
            return sel;
        };

        // Emergence seed: cartesianWriteRows on the emergence slot
        // produces every starting sel the rest of the DAG sees.
        const emergence = flowDag.nodes.find(n => n.key === 'emergence');
        const eW = GraphIO.cartesianWriteRows(emergence);
        const emergenceOutputs = eW.rows.map(rowToSel);

        const inputsBySlot   = new Map();
        const routedBySlot   = new Map();
        const deadBySlot     = new Map();
        const routedToChild  = new Map();
        const acceptedBySlot = new Map();
        const matchedBySlot  = new Map();
        const outcomeAgg     = new Map();

        for (const slotKey of order) {
            const slot = flowDag.nodes.find(n => n.key === slotKey);
            if (!slot) continue;

            let outputs;
            if (slotKey === 'emergence') {
                outputs = emergenceOutputs;
            } else {
                const upstream = inputsBySlot.get(slotKey);
                if (!upstream || !upstream.length) continue;
                const full = GraphIO.reachableFullSelsFromInputs(slot, upstream);
                if (!full) continue;
                acceptedBySlot.set(slotKey, full.acceptedInputs.length);
                outputs = full.outputs;
            }

            const childKeys = childrenOf.get(slotKey) || [];
            const childSlots = childKeys
                .map(k => flowDag.nodes.find(n => n.key === k))
                .filter(Boolean);

            const routedHere   = [];
            const deadHere     = [];
            const perChildCnt  = new Map();
            let matched = 0;

            for (const sel of outputs) {
                if (onSlotOutput) onSlotOutput(slotKey, sel);

                const hits = GraphIO.matchOutcomes(sel);
                if (hits.length > 0) {
                    matched++;
                    for (const oid of hits) {
                        outcomeAgg.set(oid, (outcomeAgg.get(oid) || 0) + 1);
                        if (onOutcomeMatch) onOutcomeMatch(oid, sel, slotKey);
                    }
                    continue;
                }

                let bestChild = null;
                let bestPri = Infinity;
                for (const child of childSlots) {
                    const p = _slotPickPriority(Engine, child, sel);
                    if (p < bestPri) { bestPri = p; bestChild = child; }
                }
                if (bestChild) {
                    let arr = inputsBySlot.get(bestChild.key);
                    if (!arr) { arr = []; inputsBySlot.set(bestChild.key, arr); }
                    arr.push(sel);
                    routedHere.push(sel);
                    perChildCnt.set(bestChild.key, (perChildCnt.get(bestChild.key) || 0) + 1);
                } else {
                    deadHere.push(sel);
                }
            }
            matchedBySlot.set(slotKey, matched);
            routedBySlot.set(slotKey, routedHere);
            if (deadHere.length) deadBySlot.set(slotKey, deadHere);
            routedToChild.set(slotKey, perChildCnt);
        }

        return {
            inputsBySlot, routedBySlot, deadBySlot, routedToChild,
            acceptedBySlot, matchedBySlot, outcomeAgg,
            parentsOf, childrenOf, order,
        };
    }

    // Exposed for callers that need to mirror the same priority pick
    // outside the propagation pass (e.g. browser runtime checks). Pure
    // function of (Engine, slot, sel); doesn't touch propagation
    // state.
    function slotPickPriority(slot, sel) {
        const Engine = _Engine();
        if (!Engine) return Infinity;
        return _slotPickPriority(Engine, slot, sel);
    }

    if (typeof window !== 'undefined') {
        window.FlowPropagation = { run, slotPickPriority };
    }
})();
