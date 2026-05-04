// walk-step.js — single-step runtime navigation primitives.
//
// Centralizes the per-edge-walk vocabulary every runtime walker uses
// (the runtime UI in index.html, the LLM-driven evaluator in
// tests/evaluate.js, the seeded random/reach-gated/parity walks in
// tests/random_walks*.js + tests/runtime_cache_parity.js, and the
// reach-checker's mid-module DFS).
//
// Three layered primitives:
//
//   flowStep(stack, deps)
//     The irreducible 3-line "ask FlowPropagation where to go next"
//     call every walker leads with. Returns { sel, parentSlotKey, flow }.
//
//   nextAction(stack, deps)
//     flowStep + locked-detect + enabled-filter, returning a tagged
//     action so the caller's outer loop can dispatch on `kind`:
//       { kind: 'open',          sel, parentSlotKey, flow }
//       { kind: 'stuck',         sel, parentSlotKey, flow }
//       { kind: 'unknown-flow',  sel, parentSlotKey, flow }
//       { kind: 'auto-locked',   sel, parentSlotKey, flow, node, edgeId }
//       { kind: 'question',      sel, parentSlotKey, flow, node, enabled }
//
//   lightPushSel(sel, node, edge, deps) / lightPushSelById(sel, nodeId, edgeId, deps)
//     Sel-only edge application — stamps `sel[node.id]=edge.id` then
//     runs `applyEdgeEffects` on a fresh copy. Used by the reach
//     checker's in-module DFS and by every "would this edge keep the
//     locked outcome reachable?" probe. Sel-only because flavor isn't
//     observed by `templateMatches`, so it doesn't affect reach.
//
// `deps = { Engine, FlowPropagation }` is passed in so this module
// makes no assumption about how the caller bootstrapped the runtime
// (node-runtime.js for tests, plain script tags in the browser).
//
// Dual-mode: `require('./walk-step')` in Node, `window.WalkStep` in
// the browser.

(function () {
    'use strict';

    function flowStep(stack, deps) {
        const sel = deps.Engine.currentState(stack);
        const parentSlotKey = deps.FlowPropagation.parentSlotKeyFromStack(stack);
        const flow = deps.FlowPropagation.flowNext(sel, parentSlotKey);
        return { sel, parentSlotKey, flow };
    }

    function nextAction(stack, deps) {
        const { sel, parentSlotKey, flow } = flowStep(stack, deps);

        if (flow.kind === 'open')   return { kind: 'open',   sel, parentSlotKey, flow };
        if (flow.kind === 'stuck')  return { kind: 'stuck',  sel, parentSlotKey, flow };
        if (flow.kind !== 'question') return { kind: 'unknown-flow', sel, parentSlotKey, flow };

        const node = flow.node;
        const lockedEdgeId = deps.Engine.isNodeLocked(sel, node);
        if (lockedEdgeId != null) {
            return { kind: 'auto-locked', sel, parentSlotKey, flow, node, edgeId: lockedEdgeId };
        }

        const enabled = node.edges.filter(e => !deps.Engine.isEdgeDisabled(sel, node, e));
        return { kind: 'question', sel, parentSlotKey, flow, node, enabled };
    }

    function lightPushSel(sel, node, edge, deps) {
        const next = Object.assign({}, sel, { [node.id]: edge.id });
        deps.Engine.applyEdgeEffects(next, edge, null);
        return next;
    }

    function lightPushSelById(sel, nodeId, edgeId, deps) {
        // Defensive lookup variant — callers that hold (nodeId, edgeId)
        // strings (URL-replay path in index.html, by-name walks) get
        // a stable fallback when the node/edge has been renamed. Reach
        // queries that follow will simply see the id stamped without
        // edge effects; templateMatches is sel-only and tolerates this.
        const Engine = deps.Engine;
        const node = Engine.NODE_MAP && Engine.NODE_MAP[nodeId];
        if (!node) return Object.assign({}, sel, { [nodeId]: edgeId });
        const edge = node.edges && node.edges.find(e => e.id === edgeId);
        const next = Object.assign({}, sel, { [nodeId]: edgeId });
        if (edge) Engine.applyEdgeEffects(next, edge, null);
        return next;
    }

    const api = { flowStep, nextAction, lightPushSel, lightPushSelById };
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (typeof window !== 'undefined') {
        window.WalkStep = api;
    }
})();
