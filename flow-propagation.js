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
//     routedFromBySlot
//                    Map<slotKey, slotKey[]>  index-aligned with inputsBySlot:
//                                              for each sel that arrived at K,
//                                              records the parent slotKey that
//                                              produced it. Lets flowNext (and
//                                              the parity test) recover the
//                                              walk's parent context — the
//                                              same sel value can arrive from
//                                              multiple parents (e.g.
//                                              brittle.sufficient leaves the
//                                              sel value identical to its
//                                              input, so the same sel ends up
//                                              in inputsBySlot[brittle] from
//                                              who_benefits AND in
//                                              inputsBySlot[rollout] from
//                                              brittle, with different
//                                              routedFrom entries).
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
        // Index-aligned with inputsBySlot: for each sel routed into a
        // child K, record the parent slotKey that produced it. Same
        // shape (Map<slotKey, slotKey[]>); the i-th entry of
        // routedFromBySlot.get(K) is the parent of inputsBySlot.get(K)[i].
        const routedFromBySlot   = new Map();
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
                    let parents = routedFromBySlot.get(bestChild.key);
                    if (!parents) { parents = []; routedFromBySlot.set(bestChild.key, parents); }
                    parents.push(slotKey);
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
            inputsBySlot, routedFromBySlot,
            routedBySlot, deadBySlot, stuckBySlot, routedToChild,
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
    // ─── Topology-aware pick (matches run()) ───────────────────────
    // run() routes each parent's outputs to ONE of that parent's
    // children — the child whose _slotPickPriority is lowest. flowNext
    // mirrors this in two passes:
    //
    //   1. TOPOLOGY pass — identify the "current parent" (the latest
    //      FLOW_DAG slot whose exit signature is in sel) and restrict
    //      the pick to that parent's children. This matches run()
    //      exactly when the parent can be uniquely identified from
    //      sel.
    //
    //   2. GLOBAL fallback — if no child of the topology-identified
    //      parent accepts the sel, fall through to a global lowest-
    //      priority scan. This handles two distinct shadowing cases:
    //
    //      • Pre-set markers — plateau_bd / auto_bd write
    //        `who_benefits_set='yes'` to skip who_benefits on
    //        capability=plateau / agi paths (`effects.set:
    //        { who_benefits_set: 'yes' }`). After plateau_bd's own
    //        dim is moved to flavor (effects.move), the post-walk
    //        sel has `who_benefits_set='yes'` and NO
    //        plateau_benefit_distribution — the topology pass
    //        misidentifies who_benefits as the parent. who_benefits's
    //        children (inert_stays / brittle / rollout /
    //        escape_after_who) all gate on capability=asi, so none
    //        accept; the fallback then finds rollout_early
    //        (plateau_bd's actual child) globally.
    //
    //      • Side-effect markers — concentration_type='ai_itself'
    //        writes `inert_stays='no'` as an edge effect even when
    //        inert_stays slot itself never walked. The topology
    //        pass picks inert_stays as the parent (newest exit
    //        signature) but inert_stays' children (escape_re_entry,
    //        rollout) and escape_after_who (the actual run() target)
    //        all share the ESCAPE_MODULE — so they surface the SAME
    //        question (ai_goals). The slotKey reported differs from
    //        run() but the user-facing question is identical. The
    //        flow_next_parity test checks question-equivalence
    //        (rather than slotKey-equivalence) for exactly this
    //        reason — see tests/flow_next_parity.js.
    //
    // Without the topology restriction, flowNext would always do a
    // global scan and could shortcut past topology — e.g. a sel
    // produced by `decel` (whose only child is `proliferation`)
    // could shortcut to `escape_early` (a sibling of decel via
    // alignment), because both accept the sel and escape_early
    // appears first in FLOW_DAG. Restricting to decel's children
    // blocks that.
    //
    // "Exit signature" is the slot's terminal write into sel:
    //   * node-kind:   sel[slot.id] !== undefined
    //   * module-kind: Engine.isModuleDone(sel, m.completionMarker)
    //
    // For modules that share a completionMarker (escape_early /
    // escape_early_alt / escape_late / escape_re_entry /
    // escape_after_who all have id='escape', so `escape_set` trips
    // isModuleDone for all of them simultaneously), reverse-topo
    // picks the LATEST in FLOW_DAG.nodes order. This is correct: by
    // construction, only the latest-positioned escape slot can be
    // the one a sel just exited (earlier escape slots are reachable
    // only via paths that subsequently traverse later structures
    // first), and the parent-children edge restriction filters out
    // any spurious sibling matches downstream.
    //
    // ─── Module atomicity ──────────────────────────────────────────
    // If a child of the current parent is a module that's been
    // ENTERED (≥1 internal answered) but not yet EXITED (completion
    // marker unset), it owns the next pick exclusively — no other
    // child can preempt. This prevents mid-module interruption when
    // a sibling's gate happens to activate on a value the current
    // module just wrote. (E.g. who_benefits writes `concentration_
    // type=ai_itself`, which also satisfies escape's gate; without
    // this rule, escape_after_who would steal the next question
    // before who_benefits asks `power_use`.) Mirrors run(), which
    // is inherently atomic per-slot via the inner DFS in
    // reachableFullSelsFromInputs.
    //
    // The atomicity check runs in BOTH passes (topology first, then
    // global) because the global fallback is only entered when no
    // topology-pass child accepts; if a mid-flow module exists at
    // all, it's accepting.
    //
    // ─── Tie-break ─────────────────────────────────────────────────
    // When two children tie on priority, FLOW_DAG.edges declaration
    // order is the tie-breaker (first declared wins). This matches
    // run()'s `for (const child of childSlots)` iteration order,
    // which is built from the edge list.

    // Lazy caches built from FLOW_DAG on first flowNext call (FLOW_DAG
    // isn't loaded at this file's IIFE time).
    //
    //   _childrenOf — parentKey → [childKey], in FLOW_DAG.edges
    //                 declaration order. Excludes outcome / deadend /
    //                 outcome-link edges (flowNext doesn't route to
    //                 those, matching run()).
    //   _slotByKey  — slotKey → slot object, for O(1) lookup.
    let _childrenOf = null;
    let _slotByKey = null;
    function _buildTopoCaches(flowDag) {
        const ch = new Map();
        for (const e of flowDag.edges) {
            const [p, c, kind] = e;
            if (kind === 'placement-outcome' || kind === 'placement-deadend') continue;
            if (kind === 'outcome-link') continue;
            if (String(c).startsWith('outcome:') || c === 'deadend') continue;
            let arr = ch.get(p);
            if (!arr) { arr = []; ch.set(p, arr); }
            arr.push(c);
        }
        const sm = new Map();
        for (const n of flowDag.nodes) if (n && n.key) sm.set(n.key, n);
        _childrenOf = ch;
        _slotByKey = sm;
    }

    // ─── Sub-routines ──────────────────────────────────────────────
    // Pick the next render-target across a candidate set of slots.
    // Used by both the topology pass and the global fallback. Returns
    // a flowNext-shaped result (question / stuck / null). Atomicity
    // is checked first: any mid-flow module in the candidate set
    // owns the pick exclusively.
    function _pickFromCandidates(Engine, GraphIO, candidateSlots, sel) {
        for (const slot of candidateSlots) {
            if (!slot || slot.kind !== 'module') continue;
            const m = Engine.MODULE_MAP[slot.id];
            if (!m) continue;
            if (m.completionMarker && Engine.isModuleDone(sel, m.completionMarker)) continue;
            let entered = false;
            for (const nid of (m.nodeIds || [])) {
                if (sel[nid] !== undefined) { entered = true; break; }
            }
            if (!entered) continue;
            const next = GraphIO.findNextInternalNode(m, sel);
            if (next) return { kind: 'question', node: next, slotKey: slot.key };
            if (m.completionMarker) return { kind: 'stuck', slotKey: slot.key };
        }

        let bestSlot = null;
        let bestP = Infinity;
        for (const slot of candidateSlots) {
            if (!slot) continue;
            if (slot.kind === 'outcome' || slot.kind === 'deadend') continue;
            const p = _slotPickPriority(Engine, slot, sel);
            if (p === Infinity) continue;
            if (p < bestP) { bestSlot = slot; bestP = p; }
        }
        if (!bestSlot) return null;

        if (bestSlot.kind === 'node') {
            const n = Engine.NODE_MAP[bestSlot.id];
            return { kind: 'question', node: n, slotKey: bestSlot.key };
        }
        if (bestSlot.kind === 'module') {
            const m = Engine.MODULE_MAP[bestSlot.id];
            if (!m) return { kind: 'stuck', slotKey: bestSlot.key };
            const next = GraphIO.findNextInternalNode(m, sel);
            if (next) return { kind: 'question', node: next, slotKey: bestSlot.key };
            return { kind: 'stuck', slotKey: bestSlot.key };
        }
        return null;
    }

    // ─── flowNext(sel, parentSlotKey?) ──────────────────────────────
    //
    // Single-step navigator. With an explicit `parentSlotKey`, this is
    // a strict mirror of run()'s per-parent routing — the SAME pick
    // run() makes when it routes from `parentSlotKey` to one of its
    // children for `sel`. With no parent argument, it falls back to a
    // sel-only heuristic (reverse-topo for latest exit signature, plus
    // global fallback) for callers that don't track walk context.
    //
    // ─── Why parentSlotKey is the canonical disambiguator ───────────
    //
    // run() routes by parent in topological order. The same sel value
    // can legitimately arrive at multiple slots from different parents
    // (e.g. brittle.sufficient leaves the sel value identical to its
    // input, so the same sel ends up routed who_benefits→brittle AND
    // brittle→rollout). Sel-only flowNext can't tell these apart —
    // which routing is "right" depends on which parent is currently
    // dispatching. parentSlotKey collapses that ambiguity.
    //
    // It also sidesteps the side-effect-marker problem: dims like
    // `inert_stays='no'` can be written either by walking the
    // inert_stays slot (user-pick) or by a concentration_type=
    // 'ai_itself' edge effect (no walk). Parent context tells us
    // unambiguously which case it is, where sel does not.
    //
    // The parity test (tests/flow_next_parity.js) feeds the parent
    // recorded in run()'s `routedFromBySlot` so it can assert exact
    // slotKey equality against `inputsBySlot`.
    function flowNext(sel, parentSlotKey) {
        const Engine = _Engine();
        const flowDag = _FlowDag();
        const GraphIO = _GraphIO();
        if (!Engine || !flowDag || !GraphIO) return { kind: 'open' };
        if (!_childrenOf) _buildTopoCaches(flowDag);

        // EMERGENCE is the entry module: no FLOW_DAG parent, never a
        // child of any other slot. Until it completes, its internals
        // own the pick — the runtime analogue of run()'s
        // `cartesianWriteRows(emergence)` seed pass. Without this
        // short-circuit, parentSlotKey='emergence' (the default both
        // parentSlotKeyFromStack and the sel-only heuristic produce
        // at game start) would skip past the module and try to route
        // an empty sel to plateau_bd/auto_bd/control — none of which
        // accept until `capability` is set.
        const emergenceSlot = _slotByKey.get('emergence');
        if (emergenceSlot && emergenceSlot.kind === 'module') {
            const m = Engine.MODULE_MAP[emergenceSlot.id];
            const done = m && m.completionMarker
                && Engine.isModuleDone(sel, m.completionMarker);
            if (m && !done) {
                const next = GraphIO.findNextInternalNode(m, sel);
                if (next) return { kind: 'question', node: next, slotKey: emergenceSlot.key };
                if (m.completionMarker) return { kind: 'stuck', slotKey: emergenceSlot.key };
            }
        }

        if (parentSlotKey != null) {
            // Definitive parent context — restrict the pick to that
            // parent's children. No fallback: if the caller asserts a
            // parent and none of its children accept, the answer is
            // genuinely 'open' (sel has cleared FLOW_DAG).
            const childKeys = _childrenOf.get(parentSlotKey) || [];
            const childSlots = childKeys.map(k => _slotByKey.get(k)).filter(Boolean);
            const result = _pickFromCandidates(Engine, GraphIO, childSlots, sel);
            return result || { kind: 'open' };
        }

        // ─── Sel-only heuristic (no parent context) ────────────────
        // Pass 1: TOPOLOGY pick — find the latest-exited slot in
        // FLOW_DAG topological order. Default 'emergence' covers the
        // empty-sel case (game start).
        let parentKey = 'emergence';
        for (let i = flowDag.nodes.length - 1; i >= 0; i--) {
            const slot = flowDag.nodes[i];
            if (!slot || slot.key === 'emergence') continue;
            if (slot.kind === 'outcome' || slot.kind === 'deadend') continue;
            let exited = false;
            if (slot.kind === 'node') {
                exited = sel[slot.id] !== undefined;
            } else if (slot.kind === 'module') {
                const m = Engine.MODULE_MAP[slot.id];
                if (m && m.completionMarker && Engine.isModuleDone(sel, m.completionMarker)) {
                    exited = true;
                }
            }
            if (exited) { parentKey = slot.key; break; }
        }

        const childKeys = _childrenOf.get(parentKey) || [];
        const childSlots = childKeys.map(k => _slotByKey.get(k)).filter(Boolean);
        const topoResult = _pickFromCandidates(Engine, GraphIO, childSlots, sel);
        if (topoResult) return topoResult;

        // Pass 2: GLOBAL fallback — no child of the topology-
        // identified parent accepts the sel. Identification was
        // likely shadowed by an upstream pre-set (effects.set sharing
        // a marker with the pre-set slot's completion). Fall through
        // to a global lowest-priority scan over every non-emergence
        // slot.
        const globalSlots = [];
        for (const slot of flowDag.nodes) {
            if (!slot || slot.key === 'emergence') continue;
            if (slot.kind === 'outcome' || slot.kind === 'deadend') continue;
            globalSlots.push(slot);
        }
        const globalResult = _pickFromCandidates(Engine, GraphIO, globalSlots, sel);
        return globalResult || { kind: 'open' };
    }

    // ─── parentSlotKeyFromStack(stack) ──────────────────────────────
    //
    // Derive the latest fully-exited FLOW_DAG slot from the runtime's
    // answer history. Used by index.html findNextQuestion to feed
    // flowNext's parent argument so runtime navigation matches run()
    // exactly (otherwise sel-only heuristics misroute when a slot
    // moves its own gate dim — the canonical case is brittle.sufficient,
    // which leaves sel unchanged but moves brittle_resolution to flavor;
    // sel-only flowNext then re-asks brittle in a loop).
    //
    // A slot S counts as exited iff:
    //   1. S's exit signature is set in the current sel (node-kind:
    //      sel[S.id] !== undefined; module-kind: completion marker
    //      set), AND
    //   2. The user actually answered one of S's nodes in stack —
    //      this distinguishes S "walked" (user pick) from S
    //      "side-effect-set" (an upstream edge wrote S's marker
    //      without S's nodes ever being asked, e.g.
    //      concentration_type='ai_itself' writes inert_stays='no').
    //
    // Returns the latest such S in FLOW_DAG.nodes order. Defaults to
    // 'emergence' (game start, no slot has exited yet).
    //
    // For shared completionMarker modules (escape_*: all id='escape'
    // sharing 'escape_set'), the LATEST in topo order wins —
    // matches run()'s parent identification (escape_late ⊃
    // escape_after_who in topo, etc.).
    function parentSlotKeyFromStack(stack) {
        const Engine = _Engine();
        const flowDag = _FlowDag();
        if (!Engine || !flowDag || !Array.isArray(stack) || stack.length === 0) {
            return 'emergence';
        }
        const sel = stack[stack.length - 1].state || {};
        const answered = new Set();
        for (const frame of stack) {
            if (frame && frame.nodeId) answered.add(frame.nodeId);
        }

        let lastExited = 'emergence';
        for (let i = flowDag.nodes.length - 1; i >= 0; i--) {
            const slot = flowDag.nodes[i];
            if (!slot || slot.key === 'emergence') continue;
            if (slot.kind === 'outcome' || slot.kind === 'deadend') continue;

            let exited = false;
            if (slot.kind === 'node') {
                if (sel[slot.id] !== undefined && answered.has(slot.id)) exited = true;
            } else if (slot.kind === 'module') {
                const m = Engine.MODULE_MAP[slot.id];
                if (m && m.completionMarker && Engine.isModuleDone(sel, m.completionMarker)) {
                    for (const nid of (m.nodeIds || [])) {
                        if (answered.has(nid)) { exited = true; break; }
                    }
                }
            }
            if (exited) { lastExited = slot.key; break; }
        }
        return lastExited;
    }

    if (typeof window !== 'undefined') {
        window.FlowPropagation = { run, slotPickPriority, flowNext, parentSlotKeyFromStack };
    }
})();
