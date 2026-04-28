// Singularity Map — Engine
// Interprets the declarative graph rules defined in graph.js.
// Handles derivations, activation, locking, state management, and template matching.

(function() {

const { SCENARIO, NODES, NODE_MAP, MODULES, MODULE_MAP } = (typeof module !== 'undefined' && module.exports)
    ? require('./graph.js') : window.Graph;

// ════════════════════════════════════════════════════════
// Condition pre-compilation
// ════════════════════════════════════════════════════════
//
// Conditions (activateWhen / hideWhen / disabledWhen / requires /
// collapseToFlavor.when / template `reachable`) are pre-compiled to a
// flat (keys, types, vals) triple so matchCondition's hot path is a
// switched index lookup. With deriveWhen gone, every read is a direct
// `sel[k]` so there's no indirect/derived branch — every matcher is
// `_direct = true`.

// Pre-compilation: type tags for condition entries
const _CT = 0, _CF = 1, _CN = 2, _CR = 3, _CI = 4;

function _precompile() {
    const compileCond = (cond) => {
        const keys = [], types = [], vals = [];
        for (const k of Object.keys(cond)) {
            if (k === 'reason' || k.startsWith('_')) continue;
            const v = cond[k];
            keys.push(k);
            if (v === true) { types.push(_CT); vals.push(null); }
            else if (v === false) { types.push(_CF); vals.push(null); }
            else if (v && typeof v === 'object' && !Array.isArray(v) && v.not) {
                types.push(v.required ? _CR : _CN);
                vals.push(v.not);
            }
            else { types.push(_CI); vals.push(Array.isArray(v) ? v : [v]); }
        }
        cond._ck = keys; cond._ct = types; cond._cv = vals;
    };
    for (const node of NODES) {
        if (node.activateWhen) for (const c of node.activateWhen) compileCond(c);
        if (node.hideWhen) for (const c of node.hideWhen) compileCond(c);
        if (node.edges) for (const e of node.edges) {
            if (e.disabledWhen) for (const c of e.disabledWhen) compileCond(c);
            if (e.requires) {
                const cs = Array.isArray(e.requires) ? e.requires : [e.requires];
                for (const c of cs) compileCond(c);
            }
        }
    }
}
_precompile();

// resolvedVal — kept as a one-line wrapper rather than inlined at every
// call site so future "lazy view" semantics (e.g. flavor-underlay reads
// in an alternate matchCondition mode) have a single hook to extend. As
// of the deriveWhen drop, this is a direct sel lookup with no caching.
function resolvedVal(sel, k) {
    return sel[k];
}

// ════════════════════════════════════════════════════════
// Activation engine (generic isNodeVisible)
// ════════════════════════════════════════════════════════

function matchCondition(sel, cond) {
    const keys = cond._ck;
    // Slow path for un-precompiled conds (e.g. dynamically constructed
    // by callers outside graph-init). Mirrors the precompiled fast path
    // semantics exactly.
    if (!keys) {
        for (const [k, allowed] of Object.entries(cond)) {
            if (k === 'reason') continue;
            const v = sel[k];
            if (allowed === true)  { if (v == null) return false; continue; }
            if (allowed === false) { if (v != null) return false; continue; }
            if (allowed && allowed.not) {
                if (allowed.required && v == null) return false;
                if (v && allowed.not.includes(v)) return false;
                continue;
            }
            if (!v || !allowed.includes(v)) return false;
        }
        return true;
    }
    const types = cond._ct, vals = cond._cv;
    for (let i = 0; i < keys.length; i++) {
        const v = sel[keys[i]];
        switch (types[i]) {
            case _CT: if (v == null) return false; break;
            case _CF: if (v != null) return false; break;
            case _CN: if (v && vals[i].includes(v)) return false; break;
            case _CR: if (v == null || vals[i].includes(v)) return false; break;
            case _CI: if (!v || !vals[i].includes(v)) return false; break;
        }
    }
    return true;
}

// Module-first scheduling. Once a module's walk is in progress (some of
// its internals answered but completion marker not yet written), every
// non-module node defers — regardless of priority — until the module
// completes. Inside the pending module, its own internals flow normally.
// This keeps each module's walk contiguous; no flat question (priority 0
// or otherwise) can preempt mid-module. Cross-pending-module interleave
// is allowed (internals of ANY pending module are fair game), which is
// rare but harmless.
//
// Uses `node.module` back-pointer populated in graph.js from MODULE.nodeIds.
// Module completion marker: can be
//   * string dim name — module is done iff sel[dim] !== undefined
//   * { dim, values }  — module is done iff sel[dim] is in `values`
//     (used by EMERGENCE, where capability is user-answered mid-module
//     with {singularity, stalls} and then rewritten to {plateau, agi,
//     asi} on module exit; a simple "has any value" check can't
//     distinguish mid-module from post-exit).
function _moduleCompletionMarkerOf(mod) {
    if (mod.completionMarker) return mod.completionMarker;
    const writes = mod.writes || [];
    for (const w of writes) if (w.startsWith(mod.id + '_')) return w;
    return writes[writes.length - 1];
}
function _isModuleDone(sel, marker) {
    if (!marker) return false;
    if (typeof marker === 'string') return sel[marker] !== undefined;
    const v = sel[marker.dim];
    return v !== undefined && marker.values.indexOf(v) !== -1;
}
function _isModulePending(sel, mod) {
    const marker = _moduleCompletionMarkerOf(mod);
    if (_isModuleDone(sel, marker)) return false;
    const conds = mod.activateWhen;
    if (!conds || !conds.length) return true;
    return conds.some(c => matchCondition(sel, c));
}

// Generic module reducer derived from the module's exitPlan. Replaces
// the ten hand-written `*Reduce` functions that used to live in
// graph.js (decelReduce, escapeReduce, whoBenefitsReduce, …). For a
// given module-local state `local` (a sel-shaped object containing
// the internal node answers + any `when`-gate dims), walks the
// module's exitPlan in declaration order and returns the `set` bundle
// of the first tuple whose (nodeId, edgeId, when) triple matches.
// Returns `{}` if nothing matches (caller is outside an exit state).
//
// Not called by the runtime — the engine commits module output via
// collapseToFlavor blocks installed by attachModuleReducer (graph.js).
// This helper exists as a pure audit primitive for:
//   * module_primitive.js — parity check between `reduce(local)` and
//     the exitPlan tuple that maps to the same local state.
//   * Future tooling (replay, test harnesses) that wants to ask
//     "what WOULD this module commit if local state were X?"
//     without running the whole engine pipeline.
//
// `when` clauses support the same value-shape grammar as
// activateWhen: arrays (membership), `{ not: [...] }`, booleans for
// existence, or bare scalars for equality.
function reduceFromExitPlan(mod, local) {
    if (!mod || !mod.exitPlan || !local) return {};
    for (const t of mod.exitPlan) {
        if (local[t.nodeId] !== t.edgeId) continue;
        let whenOk = true;
        for (const [k, cond] of Object.entries(t.when || {})) {
            const cur = local[k];
            if (Array.isArray(cond)) {
                if (!cond.includes(cur)) { whenOk = false; break; }
            } else if (cond && typeof cond === 'object' && Array.isArray(cond.not)) {
                if (cond.not.includes(cur)) { whenOk = false; break; }
            } else if (cond === true) {
                if (!cur) { whenOk = false; break; }
            } else if (cond === false) {
                if (cur) { whenOk = false; break; }
            } else if (cur !== cond) {
                whenOk = false; break;
            }
        }
        if (whenOk) return { ...t.set };
    }
    return {};
}

// Base askability predicate — node is unanswered and its activate/hide
// gates pass. Shared by every askability call site:
//   * static-analysis (graph-io's DFS internal pick)
//   * flow-propagation's _slotPickPriority + flowNext
//   * runtime UI (via isNodeVisible / findNextQuestion's flowNext)
//
// Two checks are NOT included here, by design:
//   * has-an-enabled-edge — flow-propagation's slot priority pick
//     mirrors the user-facing engine, which surfaces a question even
//     if every edge is disabled (the user sees greyed buttons).
//     graph-io's DFS pick + flowNext's internal pick add it inline
//     where they want the strictness.
//   * module-completed short-circuit — runtime-only concern handled
//     at the slot level by flow-propagation (returns Infinity for
//     completed modules) and by graph-io's DFS terminating on the
//     completion marker.
function isAskableInternal(sel, n) {
    if (!n || n.derived) return false;
    if (sel[n.id] !== undefined) return false;
    if (n.activateWhen && !n.activateWhen.some(c => matchCondition(sel, c))) return false;
    if (n.hideWhen && n.hideWhen.some(c => matchCondition(sel, c))) return false;
    return true;
}

// Pure activate/hide check — no priority gating, no askability. Used
// by isNodeVisible and resolvedState to decide whether a node's
// preconditions are met under the given sel. Navigation order
// (which node fires next) lives entirely in FLOW_DAG via
// FlowPropagation.flowNext.
function isNodeActivated(sel, node) {
    if (node.hideWhen) {
        for (const cond of node.hideWhen) {
            if (matchCondition(sel, cond)) return false;
        }
    }
    if (!node.activateWhen) return true;
    return node.activateWhen.some(c => matchCondition(sel, c));
}

function isNodeVisible(sel, node) {
    if (sel[node.id]) return true;
    return isNodeActivated(sel, node);
}

// ════════════════════════════════════════════════════════
// Locking and disabling
// ════════════════════════════════════════════════════════

function isNodeLocked(sel, node) {
    if (!node.edges || node.derived) return null;
    const enabled = node.edges.filter(v => !isEdgeDisabled(sel, node, v));
    if (enabled.length !== 1) return null;

    for (const edge of node.edges) {
        if (!isEdgeDisabled(sel, node, edge)) continue;
        if (!edge.requires) continue;
        const condSets = Array.isArray(edge.requires) ? edge.requires : [edge.requires];
        for (const cond of condSets) {
            for (const [k, vals] of Object.entries(cond)) {
                if (k.startsWith('_') || k === 'reason') continue;
                const v = resolvedVal(sel, k);
                if (!v) {
                    const depNode = NODE_MAP[k];
                    if (depNode && isNodeActivated(sel, depNode)) return null;
                }
            }
        }
    }

    return enabled[0].id;
}

function isEdgeDisabled(sel, node, edge) {
    if (edge.disabledWhen) {
        for (const cond of edge.disabledWhen) {
            if (matchCondition(sel, cond)) return true;
        }
    }
    if (!edge.requires) return false;
    const condSets = Array.isArray(edge.requires) ? edge.requires : [edge.requires];
    return !condSets.some(cond => matchCondition(sel, cond));
}

function getEdgeDisabledReason(sel, node, edge) {
    if (edge.disabledWhen) {
        for (const cond of edge.disabledWhen) {
            if (matchCondition(sel, cond)) return cond.reason || null;
        }
    }
    if (!edge.requires) return null;
    const condSets = Array.isArray(edge.requires) ? edge.requires : [edge.requires];
    if (condSets.some(cond => matchCondition(sel, cond))) return null;
    for (const cond of condSets) {
        for (const key of Object.keys(cond)) {
            if (key.startsWith('_')) continue;
            const reqNode = NODE_MAP[key];
            if (!reqNode || !sel[key]) continue;
            if (cond[key].includes(sel[key])) continue;
            const selEdge = reqNode.edges && reqNode.edges.find(e => e.id === sel[key]);
            const selLabel = selEdge ? selEdge.label : sel[key];
            return `Not available when ${reqNode.label} is ${selLabel}`;
        }
    }
    return null;
}

// ════════════════════════════════════════════════════════
// State management
// ════════════════════════════════════════════════════════

// Apply a single edge's `collapseToFlavor` blocks to `sel` in place.
// This is the canonical block interpreter, shared between the runtime
// (cleanSelection, below) and static analysis (graph-io._applyEdgeWrites).
//
// Block semantics (per block, in order):
//   when      — optional; matched against the running `sel`. Skip if false.
//   set       — write dim → value in sel. Runs before move so blocks that
//               derive a value from a dim they then move (e.g. read
//               decel_Xmo_progress, set decel_align_progress, move
//               decel_Xmo_progress) see the dim before eviction.
//   setFlavor — write dim → value in flavor only (skipped if no flavor passed).
//   move      — for each dim, copy sel[dim] → flavor[dim] (if flavor passed)
//               and delete sel[dim]. Static analysis passes flavor=null and
//               just drops the dim.
//
// History: cleanSelection used to do a 6-pass fixpoint that interleaved an
// invalidation sweep (evict any sel[X] whose edge had become disabled in
// the fused view) with a collapse pass. That cascade had a parallel
// implementation in graph-io._applyEdgeWrites for static analysis, and the
// two diverged. `probe-divergence.js` enumerated 15 divergence patterns;
// each was fixed by pulling the load-bearing effect into the originating
// edge's `collapseToFlavor` block (with a `proliferation_set:false`-style
// one-shot gate where the effect must fire exactly once). Once divergence
// hit zero across 178k runtime-reachable pushes, the multi-pass loop became
// a proven no-op for every runtime state. The two implementations are now
// folded into this single helper so they can never re-diverge.
function applyEdgeBlocks(sel, edge, flavor) {
    if (!edge || !edge.collapseToFlavor) return;
    const blocks = Array.isArray(edge.collapseToFlavor) ? edge.collapseToFlavor : [edge.collapseToFlavor];
    for (const c of blocks) {
        if (c.when && !matchCondition(sel, c.when)) continue;
        if (c.set) {
            for (const k of Object.keys(c.set)) sel[k] = c.set[k];
        }
        if (c.setFlavor && flavor) {
            for (const k of Object.keys(c.setFlavor)) flavor[k] = c.setFlavor[k];
        }
        if (c.move) {
            for (const moveDim of c.move) {
                if (sel[moveDim] === undefined) continue;
                if (flavor) flavor[moveDim] = sel[moveDim];
                delete sel[moveDim];
            }
        }
    }
}

// Walk every set node in NODES (topological) order and apply its picked
// edge's `collapseToFlavor` blocks. Single pass, no invalidation sweep,
// no fixpoint loop. Persists evicted dims to `flavor` so narrative
// resolution can still see them.
function cleanSelection(sel, flavor) {
    if (!flavor) flavor = {};
    for (const node of NODES) {
        if (!sel[node.id]) continue;
        const edge = node.edges && node.edges.find(v => v.id === sel[node.id]);
        applyEdgeBlocks(sel, edge, flavor);
    }
    return { sel, flavor };
}


function resolvedState(sel) {
    const d = {};
    // Pass through sel keys that aren't declared nodes — these are
    // collapse/gating markers written by `collapseToFlavor.set` (e.g.
    // `asi_happens`, `rollout_set`, `who_benefits_set`). Outcome
    // `reachable` clauses may reference them.
    for (const k of Object.keys(sel)) {
        if (!NODE_MAP[k]) d[k] = sel[k];
    }
    for (const node of NODES) {
        if (!isNodeVisible(sel, node)) continue;
        const ev = sel[node.id];
        if (ev) { d[node.id] = ev; continue; }
        const locked = isNodeLocked(sel, node);
        if (locked !== null) d[node.id] = locked;
    }
    return d;
}

// State used for template `reachable` matching. Underlays flavor beneath
// resolvedState so dims moved to flavor by `collapseToFlavor.move` (e.g.
// module-internal dims exported only for outcome routing) remain matchable
// without needing to live in sel. sel wins on conflict — flavor is a
// fallback layer, not an override.
function resolvedStateWithFlavor(sel, flavor) {
    const base = resolvedState(sel);
    if (!flavor) return base;
    const d = {};
    for (const k of Object.keys(flavor)) d[k] = flavor[k];
    for (const k of Object.keys(base)) d[k] = base[k];
    return d;
}

// ════════════════════════════════════════════════════════
// Template matching
// ════════════════════════════════════════════════════════

// _not accepts two shapes:
//   - dict form {k: [excluded]}: reject if state[k] ∈ excluded for ANY key (disjunctive)
//   - array form [{k1: [v], k2: [v]}, ...]: reject if EVERY k in an entry matches
//     state (conjunctive). Used for "NOT (A AND B)" exclusions like
//     "NOT (containment=escaped AND inert_stays != yes)".
//
// Per-key value spec inside an array entry can be:
//   - [v1, v2, ...]      → key matches when state[k] ∈ list
//   - {not: [v1, v2,…]}  → key matches when state[k] ∉ list (and is set);
//                          undefined state[k] also "matches" (i.e. counts
//                          as not-in-list) so that escape-not-inert
//                          rejects sels where inert_stays is unset.
function _notRejects(notSpec, state) {
    if (!notSpec) return false;
    if (Array.isArray(notSpec)) {
        for (const conj of notSpec) {
            let allMatch = true;
            for (const [k, spec] of Object.entries(conj)) {
                const v = state[k];
                if (Array.isArray(spec)) {
                    if (!v || !spec.includes(v)) { allMatch = false; break; }
                } else if (spec && spec.not) {
                    if (v && spec.not.includes(v)) { allMatch = false; break; }
                } else {
                    allMatch = false; break;
                }
            }
            if (allMatch) return true;
        }
        return false;
    }
    for (const [k, excluded] of Object.entries(notSpec)) {
        if (state[k] && excluded.includes(state[k])) return true;
    }
    return false;
}

function templateMatches(t, state) {
    if (!t.reachable) return true;
    return t.reachable.some(cond => {
        for (const [k, allowed] of Object.entries(cond)) {
            if (k === '_not') continue;
            if (!state[k] || !allowed.includes(state[k])) return false;
        }
        if (_notRejects(cond._not, state)) return false;
        return true;
    });
}

function templatePartialMatch(t, state) {
    if (!t.reachable) return true;
    return t.reachable.some(cond => {
        for (const [k, allowed] of Object.entries(cond)) {
            if (k === '_not') continue;
            if (state[k] && !allowed.includes(state[k])) return false;
        }
        if (_notRejects(cond._not, state)) return false;
        return true;
    });
}

// ════════════════════════════════════════════════════════
// Immutable answer stack
// ════════════════════════════════════════════════════════

// Each entry carries a `moduleStack` vector of active module frames. When
// empty (the default), engine behavior is identical to the pre-module code:
// every helper that consults frames short-circuits and just reads globals.
// Frame shape (Phase 3 will instantiate these): { moduleId, local: {sel, flavor}, entryIndex }
function createStack() {
    const state = {};
    const { flavor } = cleanSelection(state);
    return [{ nodeId: null, edgeId: null, state, flavor, moduleStack: [] }];
}

function push(stack, nodeId, edgeId) {
    const existingIdx = stack.findIndex(e => e.nodeId === nodeId);
    const base = existingIdx > 0 ? stack.slice(0, existingIdx) : stack;

    const prev = base[base.length - 1].state;
    const prevFlavor = base[base.length - 1].flavor || {};
    const prevModuleStack = base[base.length - 1].moduleStack || [];
    const next = { ...prev };
    next[nodeId] = edgeId;
    const { flavor } = cleanSelection(next, { ...prevFlavor });
    return [...base, { nodeId, edgeId, state: next, flavor, moduleStack: prevModuleStack }];
}

function pop(stack) {
    if (stack.length <= 1) return stack;
    return stack.slice(0, -1);
}

function popTo(stack, nodeId) {
    const idx = stack.findIndex(e => e.nodeId === nodeId);
    if (idx <= 0) return stack.slice(0, 1);
    return stack.slice(0, idx);
}

function currentState(stack) {
    return stack[stack.length - 1].state;
}

function currentFlavor(stack) {
    return stack[stack.length - 1].flavor || {};
}

function currentModuleStack(stack) {
    return stack[stack.length - 1].moduleStack || [];
}

function currentModuleFrame(stack) {
    const ms = currentModuleStack(stack);
    return ms.length ? ms[ms.length - 1] : null;
}

// Merged view for narrative resolution: sel wins on conflict (engine state
// is the source of truth). Flavor contributes the dims that were moved out
// of sel by collapseToFlavor — purely cosmetic lookups that matter only for
// flavor text / heading / edge narrativeVariants.
function narrativeState(stack) {
    const sel = currentState(stack);
    const flavor = currentFlavor(stack);
    return Object.assign({}, flavor, sel);
}

function stackHas(stack, nodeId) {
    return stack.some(e => e.nodeId === nodeId);
}

// ════════════════════════════════════════════════════════
// Narrative resolution
// ════════════════════════════════════════════════════════

function resolveContextWhen(sel, narr) {
    if (narr && narr.contextWhen) {
        for (const entry of narr.contextWhen) {
            if (matchContextWhen(sel, entry.when) && entry.questionContext) return entry.questionContext;
        }
    }
    return (narr && narr.questionContext) || '';
}

// contextWhen entries may optionally include a `questionText` override. When
// present, the first matching entry wins (same precedence as questionContext).
// Falls back to the node's top-level questionText (or undefined, letting the
// caller default to node.label).
function resolveQuestionText(sel, narr) {
    if (narr && narr.contextWhen) {
        for (const entry of narr.contextWhen) {
            if (matchContextWhen(sel, entry.when) && entry.questionText) return entry.questionText;
        }
    }
    return narr && narr.questionText;
}

function resolveShortQuestionText(sel, narr) {
    if (narr && narr.contextWhen) {
        for (const entry of narr.contextWhen) {
            if (matchContextWhen(sel, entry.when) && entry.shortQuestionText) return entry.shortQuestionText;
        }
    }
    return narr && narr.shortQuestionText;
}

function resolveShortQuestionContext(sel, narr) {
    if (narr && narr.contextWhen) {
        for (const entry of narr.contextWhen) {
            if (matchContextWhen(sel, entry.when) && entry.shortQuestionContext) return entry.shortQuestionContext;
        }
    }
    return narr && narr.shortQuestionContext;
}

// Narrative-only match that also accepts the more-specific flavor detail
// (e.g. `distribution_detail = 'lagging'` when sel collapsed lagging into
// concentrated). Kept separate from `matchCondition` because graph gates and
// template `reachable` clauses deliberately see only the collapsed sel.
function matchContextWhen(state, cond) {
    for (const [k, allowed] of Object.entries(cond)) {
        if (k === 'reason' || k === '_ck' || k === '_ct' || k === '_cv' || k === '_direct') continue;
        const v = state[k];
        const detailV = state[k + '_detail'];
        if (allowed === true)  { if (v == null && detailV == null) return false; continue; }
        if (allowed === false) { if (v != null || detailV != null) return false; continue; }
        if (allowed && allowed.not) {
            if (allowed.required && v == null && detailV == null) return false;
            if (v && allowed.not.includes(v)) return false;
            if (detailV && allowed.not.includes(detailV)) return false;
            continue;
        }
        if (!Array.isArray(allowed)) return false;
        if (!((v && allowed.includes(v)) || (detailV && allowed.includes(detailV)))) return false;
    }
    return true;
}

// ════════════════════════════════════════════════════════
// Exports
// ════════════════════════════════════════════════════════

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { NODES, NODE_MAP, MODULES, MODULE_MAP,
        matchCondition, resolvedVal, isNodeVisible, isNodeActivated, isNodeLocked, isEdgeDisabled, getEdgeDisabledReason,
        isAskableInternal,
        applyEdgeBlocks, cleanSelection, resolvedState, resolvedStateWithFlavor,
        templateMatches, templatePartialMatch, reduceFromExitPlan, resolveContextWhen, resolveQuestionText, resolveShortQuestionText, resolveShortQuestionContext,
        isModuleDone: _isModuleDone, isModulePending: _isModulePending,
        createStack, push, pop, popTo, currentState, currentFlavor, currentModuleStack, currentModuleFrame, narrativeState, stackHas };
}
if (typeof window !== 'undefined') {
    window.Engine = { NODES, NODE_MAP, MODULES, MODULE_MAP,
        matchCondition, resolvedVal, isNodeVisible, isNodeActivated, isNodeLocked, isEdgeDisabled, getEdgeDisabledReason,
        isAskableInternal,
        applyEdgeBlocks, cleanSelection, resolvedState, resolvedStateWithFlavor,
        templateMatches, templatePartialMatch, reduceFromExitPlan, resolveContextWhen, resolveQuestionText, resolveShortQuestionText, resolveShortQuestionContext,
        isModuleDone: _isModuleDone, isModulePending: _isModulePending,
        createStack, push, pop, popTo, currentState, currentFlavor, currentModuleStack, currentModuleFrame, narrativeState, stackHas };
}

})();
