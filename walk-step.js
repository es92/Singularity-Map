// walk-step.js — single-step runtime navigation primitive.
//
// Extracts the `flowNext → locked? → enabled-edge` decision tree
// previously open-coded in three near-identical loops:
//
//   * tests/random_walks.js          (random pick over enabled)
//   * tests/random_walks_locked.js   (reach-gated pick + per-slot DFS memo)
//   * tests/runtime_cache_parity.js  (slot-exit cache assertions)
//
// `nextAction(stack, deps)` returns *what the runtime would do next*
// without performing the push, so each driver decides:
//   * how to handle terminal kinds ('open' / 'stuck' / 'unknown-flow')
//   * how to pick from `enabled` (random / reach-gated / etc.)
//   * what to track around the push (trace / slot-exit asserts / memo)
//
// Returned shapes:
//   { kind: 'open',          sel, flow }
//   { kind: 'stuck',         sel, flow }
//   { kind: 'unknown-flow',  sel, flow }
//   { kind: 'auto-locked',   sel, flow, node, edgeId }     // single edge survives
//   { kind: 'question',      sel, flow, node, enabled }    // caller picks
//
// `deps` carries the runtime objects so this file makes no assumptions
// about how the test loaded them (node-runtime.js, direct require, etc.).

'use strict';

function nextAction(stack, deps) {
    const { Engine, FlowPropagation } = deps;
    const sel = Engine.currentState(stack);
    const parentSlotKey = FlowPropagation.parentSlotKeyFromStack(stack);
    const flow = FlowPropagation.flowNext(sel, parentSlotKey);

    if (flow.kind === 'open')   return { kind: 'open',   sel, flow };
    if (flow.kind === 'stuck')  return { kind: 'stuck',  sel, flow };
    if (flow.kind !== 'question') return { kind: 'unknown-flow', sel, flow };

    const node = flow.node;
    const lockedEdgeId = Engine.isNodeLocked(sel, node);
    if (lockedEdgeId != null) {
        return { kind: 'auto-locked', sel, flow, node, edgeId: lockedEdgeId };
    }

    const enabled = node.edges.filter(e => !Engine.isEdgeDisabled(sel, node, e));
    return { kind: 'question', sel, flow, node, enabled };
}

module.exports = { nextAction };
