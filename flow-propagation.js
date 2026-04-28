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
//     stuckBySlot    Map<slotKey, sel[]>      inputs the slot accepted but whose
//                                              own DFS yielded zero outputs
//                                              (runtime would render the slot
//                                              with nothing to advance into).
//     routedToChild  Map<parentKey, Map<childKey, count>>
//     acceptedBySlot Map<slotKey, number>     inputs accepted by slot
//     matchedBySlot  Map<slotKey, number>     outputs siphoned to outcomes
//     outcomeAgg     Map<oid, number>         outputs siphoned to each outcome
//     unauthorizedBySlot
//                    Map<slotKey, Map<oid, count>>
//                                              matchOutcomes hits at
//                                              slotKey for outcomes
//                                              NOT in slot.earlyExits.
//                                              Non-empty = clause leak
//                                              or missing annotation.
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
//     onUnauthorizedSiphon? (outcomeId, sel, slotKey) => void
//                                              called when matchOutcomes
//                                              hits at `slotKey` but
//                                              the slot's `earlyExits`
//                                              doesn't list `outcomeId`.
//                                              The sel is still siphoned
//                                              (routing semantics are
//                                              unchanged); this hook
//                                              exists purely to flag
//                                              annotation gaps or
//                                              clause leaks (the
//                                              outcome's clause matches
//                                              at a slot that wasn't
//                                              meant to terminate at it).
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
        const onSlotOutput        = typeof opts.onSlotOutput        === 'function' ? opts.onSlotOutput        : null;
        const onOutcomeMatch      = typeof opts.onOutcomeMatch      === 'function' ? opts.onOutcomeMatch      : null;
        const onUnauthorizedSiphon = typeof opts.onUnauthorizedSiphon === 'function' ? opts.onUnauthorizedSiphon : null;

        // Per-slot earlyExits as Set<oid> for O(1) membership tests.
        // Slots without earlyExits get an empty set — every match at
        // such a slot is unauthorized.
        const earlyExitsBySlot = new Map();
        for (const node of flowDag.nodes) {
            if (!node || !node.key) continue;
            earlyExitsBySlot.set(node.key, new Set(node.earlyExits || []));
        }

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

        const inputsBySlot       = new Map();
        const routedBySlot       = new Map();
        const deadBySlot         = new Map();
        const stuckBySlot        = new Map();
        const routedToChild      = new Map();
        const acceptedBySlot     = new Map();
        const matchedBySlot      = new Map();
        const outcomeAgg         = new Map();
        // Per-(slotKey, oid) counts of matches that fired but weren't
        // listed in slot.earlyExits and therefore weren't siphoned.
        // Surfaces clause leaks and annotation gaps.
        const unauthorizedBySlot = new Map();

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
                if (full.stuckInputs && full.stuckInputs.length) {
                    stuckBySlot.set(slotKey, full.stuckInputs);
                }
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

            const ee = earlyExitsBySlot.get(slotKey) || new Set();

            for (const sel of outputs) {
                if (onSlotOutput) onSlotOutput(slotKey, sel);

                // Siphon every matchOutcomes hit (routing semantics
                // unchanged). For each hit additionally check whether
                // the slot's `earlyExits` lists the outcome; if not,
                // bookkeep + fire onUnauthorizedSiphon so callers
                // (precompute, validate, this-test) can surface the
                // annotation gap / clause leak.
                const hits = GraphIO.matchOutcomes(sel);
                if (hits.length > 0) {
                    matched++;
                    for (const oid of hits) {
                        outcomeAgg.set(oid, (outcomeAgg.get(oid) || 0) + 1);
                        if (onOutcomeMatch) onOutcomeMatch(oid, sel, slotKey);
                        if (!ee.has(oid)) {
                            let perSlot = unauthorizedBySlot.get(slotKey);
                            if (!perSlot) { perSlot = new Map(); unauthorizedBySlot.set(slotKey, perSlot); }
                            perSlot.set(oid, (perSlot.get(oid) || 0) + 1);
                            if (onUnauthorizedSiphon) onUnauthorizedSiphon(oid, sel, slotKey);
                        }
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
            inputsBySlot, routedBySlot, deadBySlot, stuckBySlot, routedToChild,
            acceptedBySlot, matchedBySlot, outcomeAgg, unauthorizedBySlot,
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

    // ─── Single-step navigation (runtime + static unified) ──────────
    //
    // Given a sel, returns what the user-facing engine should do next:
    //
    //   { kind: 'question', node, slotKey }
    //       Render this node as the current question. Outcomes are
    //       suppressed because some FLOW_DAG slot still owns the sel.
    //
    //   { kind: 'stuck', slotKey }
    //       A FLOW_DAG slot accepts the sel but no internal node is
    //       runtime-askable (TIGHT — has activate/hide passing AND at
    //       least one enabled edge). The engine has nothing to ask
    //       AND outcomes are suppressed. This is always a graph bug
    //       (validate.js Phase 6 reports it). Browser callers should
    //       fall through to a "stuck" UI; they shouldn't fire an
    //       outcome here because static analysis didn't grant one.
    //
    //   { kind: 'open' }
    //       No FLOW_DAG slot owns the sel. The engine should attempt
    //       outcome matching. If no outcome matches, the sel is at a
    //       terminal but unmapped state — also a graph bug, but a
    //       different category.
    //
    // This is the single source of truth for "what does the navigator
    // do next?". Used by:
    //   * index.html findNextQuestion() — runtime UI driver.
    //   * validate.js (indirectly via FlowPropagation.run) — same
    //     slot-pick semantics drive the propagation pass.
    //   * /explore — same slot-pick semantics drive the visual graph.
    //   * precompute-reachability.js — same.
    //
    // Slot ownership uses LOOSE askability (Engine.isAskableInternal,
    // 4-check) — mirroring how FLOW_DAG was designed (modules are
    // contiguous; "module owns this sel" = "any internal could
    // conceivably answer"). Within an owning module, the next render
    // node is picked using TIGHT askability (4-check + at-least-one
    // enabled edge) and lowest-priority-wins (matching what the
    // user-facing engine surfaces).
    //
    // ─── Module atomicity ──────────────────────────────────────────
    // If any module has been ENTERED (≥1 internal answered) and not
    // yet EXITED (completion marker unset), it owns the next pick
    // exclusively — no other slot can preempt. This prevents
    // mid-module interruption when a downstream module's gate happens
    // to activate on a value just written by the current module. (E.g.
    // who_benefits writes `concentration_type=ai_itself`, which also
    // satisfies escape's gate; without this rule, escape would steal
    // the next question before who_benefits asks `power_use`.) Mirrors
    // FlowPropagation.run, which is inherently atomic per-slot via
    // the inner-DFS in `reachableFullSelsFromInputs`.
    //
    // If two modules are simultaneously mid-flow (rare; can only
    // happen via legacy state captured before this rule existed), the
    // FIRST in FLOW_DAG order wins.
    //
    // ─── Cross-slot pick (no module mid-flow) ──────────────────────
    // The owning slot is the one whose _slotPickPriority is lowest —
    // the same signal FlowPropagation.run uses to route a parent's
    // outputs to one of its children. This makes runtime (flowNext)
    // and static analysis (run) agree on a single criterion. When two
    // slots tie on priority, FLOW_DAG.nodes order is the tie-breaker
    // (first wins). Because FLOW_DAG.nodes is hand-authored in
    // topological order, this matches the parent-edge-decl tie-break
    // in run() in every case where one parent has multiple
    // equally-prioritized accepting children.
    function flowNext(sel) {
        const Engine = _Engine();
        const flowDag = _FlowDag();
        if (!Engine || !flowDag) return { kind: 'open' };

        for (const slot of flowDag.nodes) {
            if (!slot || slot.kind !== 'module' || slot.key === 'emergence') continue;
            const m = Engine.MODULE_MAP[slot.id];
            if (!m) continue;
            if (m.completionMarker && sel[m.completionMarker] !== undefined) continue;
            let entered = false;
            for (const nid of (m.nodeIds || [])) {
                if (sel[nid] !== undefined) { entered = true; break; }
            }
            if (!entered) continue;
            const next = _pickModuleInternal(Engine, m, sel);
            if (next) return { kind: 'question', node: next, slotKey: slot.key };
            // No askable internal. With a completionMarker, this is a
            // stuck state (the marker should have been set by an exit
            // edge but wasn't — graph bug; validate.js's stuck-inputs
            // phase surfaces it). Without a marker, the module simply
            // ran out of questions — that IS its terminal state, so
            // fall through to the global pick.
            if (m.completionMarker) return { kind: 'stuck', slotKey: slot.key };
        }

        let bestSlot = null;
        let bestP = Infinity;
        for (const slot of flowDag.nodes) {
            if (!slot || slot.key === 'emergence') continue;
            if (slot.kind === 'outcome' || slot.kind === 'deadend') continue;
            const p = _slotPickPriority(Engine, slot, sel);
            if (p === Infinity) continue;
            if (p < bestP) { bestSlot = slot; bestP = p; }
        }
        if (!bestSlot) return { kind: 'open' };

        if (bestSlot.kind === 'node') {
            const n = Engine.NODE_MAP[bestSlot.id];
            return { kind: 'question', node: n, slotKey: bestSlot.key };
        }
        if (bestSlot.kind === 'module') {
            const m = Engine.MODULE_MAP[bestSlot.id];
            if (!m) return { kind: 'stuck', slotKey: bestSlot.key };
            const next = _pickModuleInternal(Engine, m, sel);
            if (next) return { kind: 'question', node: next, slotKey: bestSlot.key };
            return { kind: 'stuck', slotKey: bestSlot.key };
        }
        return { kind: 'open' };
    }

    // Lowest-priority TIGHT-askable internal of `mod` for this `sel`.
    // Shared between the module-atomicity override above and the
    // cross-slot fallback below it.
    function _pickModuleInternal(Engine, mod, sel) {
        let bestNode = null;
        let bestNodeP = Infinity;
        for (const nid of (mod.nodeIds || [])) {
            const n = Engine.NODE_MAP[nid];
            if (!Engine.isAskableInternal(sel, n)) continue;
            if (!n.edges || !n.edges.some(e => !Engine.isEdgeDisabled(sel, n, e))) continue;
            const p = n.priority == null ? 0 : n.priority;
            if (p < bestNodeP) { bestNode = n; bestNodeP = p; }
        }
        return bestNode;
    }

    if (typeof window !== 'undefined') {
        window.FlowPropagation = { run, slotPickPriority, flowNext };
    }
})();
