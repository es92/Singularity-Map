#!/usr/bin/env node
'use strict';

// validate.js — Graph integrity checks powered by graph-io.js's
// engine-equivalent traversal.
//
// Two-phase structure:
//   1. Static schema   — pure data checks (unknown node refs, dead edges,
//                        outcome template refs). Fast (<1s).
//   2. Live propagation — runs the same set-wise enumeration that drives
//                        /explore (every state reachable by any valid
//                        path from emergence), then checks invariants
//                        on the result.
//
// Usage:
//   node validate.js          full check (~30-60s on first run)
//   node validate.js --quick  static phase only
//
// Exits 0 on clean, 1 on any failure. Failures are grouped by category
// and displayed with sample sels (URL-shaped) so you can paste them
// into the live map for debugging.

const fs = require('fs');
const path = require('path');

// ────────────────────────────────────────────────────────────────
// Browser-shim setup
// ────────────────────────────────────────────────────────────────
// graph-io.js + nodes.js are written as IIFEs that attach to `window`.
// engine.js + graph.js are CommonJS-friendly. To run them under Node
// we mount a minimal window/document shim, then load the IIFEs into
// it. This is the same pattern used by the /tmp/sm-* probe scripts.

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
const NODES = Engine.NODES || Graph.NODES;
const NODE_MAP = {};
for (const n of NODES) NODE_MAP[n.id] = n;
const outcomesData = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/outcomes.json'), 'utf8'));
const TEMPLATES = outcomesData.templates;
GraphIO.registerOutcomes(TEMPLATES);

// ────────────────────────────────────────────────────────────────
// Phase 1 — Static schema checks (no traversal)
// ────────────────────────────────────────────────────────────────
//
// Verifies that every condition (activateWhen, hideWhen, requires,
// disabledWhen, outcome.reachable) refers to dims/values that
// actually exist in the graph. Synthetic dims/values produced by
// effects.set are accepted.
//
// Also detects "dead edges" — edges whose `requires` is fully
// implied by their `disabledWhen`, meaning the edge can never fire.

function runStaticAnalysis() {
    const errors = [];

    const metaNodes = new Set(NODES.map(n => n.id));
    const extraValuesByDim = new Map();
    const addExtra = (dim, val) => {
        if (val == null) return;
        if (!extraValuesByDim.has(dim)) extraValuesByDim.set(dim, new Set());
        extraValuesByDim.get(dim).add(val);
    };
    for (const node of NODES) {
        if (!node.edges) continue;
        for (const edge of node.edges) {
            if (!edge.effects) continue;
            const blocks = Array.isArray(edge.effects) ? edge.effects : [edge.effects];
            for (const c of blocks) {
                if (!c || !c.set) continue;
                for (const [dim, val] of Object.entries(c.set)) {
                    metaNodes.add(dim);
                    addExtra(dim, val);
                }
            }
        }
    }

    function validValuesFor(dimId) {
        const refNode = NODE_MAP[dimId];
        const extras = extraValuesByDim.get(dimId);
        if (!refNode || !refNode.edges) return extras ? new Set(extras) : null;
        const s = new Set(refNode.edges.map(v => v.id));
        if (extras) for (const e of extras) s.add(e);
        return s;
    }

    function validateCondition(cond, ctx, label) {
        for (const [k, vals] of Object.entries(cond)) {
            if (k === 'reason' || k.startsWith('_')) continue;
            if (!metaNodes.has(k)) {
                errors.push(`[${label}] "${ctx}" references unknown node "${k}"`);
                continue;
            }
            if (vals === true || vals === false) continue;
            const validIds = validValuesFor(k);
            if (!validIds) continue;
            if (vals && typeof vals === 'object' && !Array.isArray(vals) && vals.not) {
                for (const v of vals.not) {
                    if (!validIds.has(v)) {
                        errors.push(`[${label}] "${ctx}" references unknown edge "${k}=${v}" in not`);
                    }
                }
                continue;
            }
            const arr = Array.isArray(vals) ? vals : [vals];
            for (const v of arr) {
                if (!validIds.has(v)) {
                    errors.push(`[${label}] "${ctx}" references unknown edge "${k}=${v}"`);
                }
            }
        }
    }

    for (const node of NODES) {
        if (!node.id) errors.push(`[structure] Node missing id`);
        if (!node.edges || node.edges.length === 0) {
            errors.push(`[structure] "${node.id}" has no edges`);
        }
        if (node.activateWhen) for (const c of node.activateWhen) validateCondition(c, node.id, 'activateWhen');
        if (node.hideWhen)     for (const c of node.hideWhen)     validateCondition(c, node.id, 'hideWhen');
    }

    for (const node of NODES) {
        if (!node.edges) continue;
        for (const v of node.edges) {
            if (v.requires) {
                const condSets = Array.isArray(v.requires) ? v.requires : [v.requires];
                for (const c of condSets) validateCondition(c, `${node.id}.${v.id}`, 'requires');
            }
            if (v.disabledWhen) for (const c of v.disabledWhen) validateCondition(c, `${node.id}.${v.id}`, 'disabledWhen');
        }
    }

    // Dead edges: edge.requires fully implied by edge.disabledWhen.
    // Such edges can never satisfy both at once → they're unreachable
    // even via the optimizer, never mind the user.
    for (const node of NODES) {
        if (!node.edges) continue;
        for (const edge of node.edges) {
            if (!edge.requires || !edge.disabledWhen) continue;
            const reqSets = Array.isArray(edge.requires) ? edge.requires : [edge.requires];
            let allBlocked = true;
            for (const req of reqSets) {
                let blocked = false;
                for (const dis of edge.disabledWhen) {
                    let disImplied = true;
                    for (const [dk, dvals] of Object.entries(dis)) {
                        if (dk.startsWith('_')) { disImplied = false; break; }
                        if (!req[dk]) { disImplied = false; break; }
                        const reqArr = Array.isArray(req[dk]) ? req[dk] : [req[dk]];
                        const disArr = Array.isArray(dvals) ? dvals : [dvals];
                        if (!reqArr.every(rv => disArr.includes(rv))) { disImplied = false; break; }
                    }
                    if (disImplied) { blocked = true; break; }
                }
                if (!blocked) { allBlocked = false; break; }
            }
            if (allBlocked) {
                errors.push(`[dead-edge] "${node.id}.${edge.id}" requires fully blocked by disabledWhen`);
            }
        }
    }

    // Outcome template references. `_not` carries an array of full
    // condition objects (each one a subselection that disqualifies the
    // outcome), so recursively validate them like any other condition.
    for (const t of TEMPLATES) {
        if (!t.reachable) continue;
        for (const cond of (Array.isArray(t.reachable) ? t.reachable : [t.reachable])) {
            for (const [dk, dv] of Object.entries(cond)) {
                if (dk === '_not') {
                    const subs = Array.isArray(dv) ? dv : [dv];
                    for (const sub of subs) validateCondition(sub, t.id, 'outcome._not');
                    continue;
                }
                if (!metaNodes.has(dk)) {
                    errors.push(`[outcome] "${t.id}" references unknown node "${dk}"`);
                    continue;
                }
                if (dv === true || dv === false) continue;
                const validIds = validValuesFor(dk);
                if (!validIds) continue;
                if (dv && typeof dv === 'object' && !Array.isArray(dv) && dv.not) {
                    for (const v of dv.not) {
                        if (!validIds.has(v)) errors.push(`[outcome] "${t.id}" references unknown edge "${dk}=${v}" in not`);
                    }
                    continue;
                }
                const arr = Array.isArray(dv) ? dv : [dv];
                for (const v of arr) {
                    if (!validIds.has(v)) errors.push(`[outcome] "${t.id}" references unknown edge "${dk}=${v}"`);
                }
            }
        }
    }

    return errors;
}

// ────────────────────────────────────────────────────────────────
// Phase 2 — Live propagation (mirrors /explore)
// ────────────────────────────────────────────────────────────────
//
// The propagation pass itself lives in flow-propagation.js so the
// precompute pipeline (and eventually browser runtime) can reuse the
// exact same enumeration. validate.js stays the home of the
// invariant-checking phases that consume the result (dead ends, gate
// vs internals, edge coverage, outcome reachability).

// ────────────────────────────────────────────────────────────────
// Phase 3 — Dead-end detection
// ────────────────────────────────────────────────────────────────
//
// A continuing output is a dead end if:
//   - it didn't match any outcome (so propagation tried to forward it),
//   - and no child slot's activateWhen / hideWhen accepts it.
//
// At runtime this would manifest as a user reaching a state with no
// next slot to advance into AND no outcome to terminate at.
//
// In the priority-routing model, runPropagation already partitions
// each slot's continuing outputs into routed (one accepting child won
// the priority pick) vs. dead (no child accepts at all). We just
// surface the dead bucket here.

function detectDeadEnds(prop) {
    const errors = [];
    for (const [slotKey, deadSels] of prop.deadBySlot) {
        if (!deadSels.length) continue;
        const routed = (prop.routedBySlot.get(slotKey) || []).length;
        const totalOuts = deadSels.length + routed;
        const childKeys = prop.childrenOf.get(slotKey) || [];
        if (!childKeys.length) {
            errors.push(`[deadend] Slot "${slotKey}" has ${deadSels.length} continuing outputs but no children to consume them`);
            const samples = deadSels.slice(0, 3).map(_selUrl);
            for (const u of samples) errors.push(`           sample: ${u}`);
            continue;
        }
        const samples = deadSels.slice(0, 3).map(_selUrl);
        errors.push(`[deadend] Slot "${slotKey}": ${deadSels.length}/${totalOuts} continuing outputs accepted by no child`);
        for (const u of samples) errors.push(`           sample: ${u}`);
    }
    return errors;
}

// ────────────────────────────────────────────────────────────────
// Phase 4 — Module gate vs. internal askability
// ────────────────────────────────────────────────────────────────
//
// A module's activateWhen / hideWhen advertises which states the
// module is willing to handle. If the gate accepts a sel but every
// internal node is hidden, derived, or already set on that path, the
// module would "enter" with no askable question — the engine would
// silently fall through, producing a confusing experience and (in
// the static analysis) often a dead end one slot upstream.
//
// This is always a graph-design bug: either the module gate is too
// permissive, the internal hideWhen / activateWhen is too narrow, or
// the missing exit / derivation that should resolve the module on
// this path was forgotten. We surface it per (parent → module-child)
// edge so the offending route is unambiguous.
//
// The check is independent of dead-end detection: even when the
// priority race causes some other child to win the route at runtime,
// a permissive gate is still misleading and worth fixing.

function detectGateWithoutInternals(prop) {
    const errors = [];

    const gateAccepts = (m, sel) => {
        if (m.completionMarker && sel[m.completionMarker] !== undefined) return false;
        const aw = m.activateWhen, hw = m.hideWhen;
        if (aw && aw.length && !aw.some(c => Engine.matchCondition(sel, c))) return false;
        if (hw && hw.length && hw.some(c => Engine.matchCondition(sel, c))) return false;
        return true;
    };
    const hasAskableInternal = (m, sel) => {
        for (const nid of (m.nodeIds || [])) {
            const n = Engine.NODE_MAP[nid];
            if (!n || n.derived) continue;
            if (sel[n.id] !== undefined) continue;
            if (n.activateWhen && n.activateWhen.length
                && !n.activateWhen.some(c => Engine.matchCondition(sel, c))) continue;
            if (n.hideWhen && n.hideWhen.length
                && n.hideWhen.some(c => Engine.matchCondition(sel, c))) continue;
            return true;
        }
        return false;
    };

    for (const [parentKey, childKeys] of prop.childrenOf) {
        const outputs = [
            ...(prop.routedBySlot.get(parentKey) || []),
            ...(prop.deadBySlot.get(parentKey) || []),
        ];
        if (!outputs.length) continue;
        for (const childKey of childKeys) {
            const childSlot = FLOW_DAG.nodes.find(n => n.key === childKey);
            if (!childSlot || childSlot.kind !== 'module') continue;
            const m = Engine.MODULE_MAP[childSlot.id];
            if (!m) continue;
            let count = 0;
            const samples = [];
            for (const sel of outputs) {
                if (!gateAccepts(m, sel)) continue;
                if (hasAskableInternal(m, sel)) continue;
                count++;
                if (samples.length < 3) samples.push(sel);
            }
            if (count > 0) {
                errors.push(`[gate-no-internals] "${parentKey}" → "${childSlot.id}": ${fmtCount(count)} sels pass module-level gate but no internal node is askable`);
                for (const sel of samples) errors.push(`           sample: ${_selUrl(sel)}`);
            }
        }
    }
    return errors;
}

// ────────────────────────────────────────────────────────────────
// Phase 5 — Edge coverage
// ────────────────────────────────────────────────────────────────
//
// Every placement edge (parent → child) should carry traffic — i.e.,
// at least one of parent's outputs must actually route through it.
// An edge that nothing routes through is dead in practice: either
// the child gate filters everything out, or a higher-priority
// sibling always wins the engine's next-slot race. Both signal an
// edge that should be removed or a gate that needs tightening.

function checkEdgeCoverage(prop) {
    const errors = [];
    for (const [parentKey, childKeys] of prop.childrenOf) {
        const counts = prop.routedToChild.get(parentKey) || new Map();
        const totalOuts = (prop.routedBySlot.get(parentKey) || []).length
            + (prop.deadBySlot.get(parentKey) || []).length;
        for (const childKey of childKeys) {
            const c = counts.get(childKey) || 0;
            if (c === 0) {
                errors.push(`[edge] "${parentKey}" → "${childKey}": parent has ${totalOuts} continuing outputs but ${childKey} routed none`);
            }
        }
    }
    return errors;
}

// ────────────────────────────────────────────────────────────────
// Phase 6 — Stuck inputs
// ────────────────────────────────────────────────────────────────
//
// A stuck input is a sel that flow-prop pushed into a slot, the
// slot's gate accepted, but the runtime would have nothing to
// advance into. Two flavors, both reported here:
//
// (a) BUCKET-LEVEL stuck — `reachableFullSelsFromInputs` produced
//     zero output rows for the input's read-bucket. Surfaced via
//     `prop.stuckBySlot` (graph-io tracks it as part of the
//     bucket-grouped DFS).
//
// (b) PER-SEL stuck — bucketing in (a) groups inputs by
//     `slot.reads` only, but `disabledWhen` can read dims OUTSIDE
//     reads. Two inputs in the same bucket can therefore have
//     different edge-enablement: the bucket as a whole produces
//     output rows (from its non-stuck members) so (a) doesn't
//     fire, but for the stuck input every askable internal has
//     every edge disabled. The runtime caller (flowNext via
//     GraphIO.findNextInternalNode, TIGHT askability) returns null
//     for these and renders an empty card. We catch them here by
//     replaying findNextInternalNode per accepted input on each
//     module slot.
//
// Common causes (either flavor):
//   * Module entered with all internal nodes hidden, derived, or
//     answered, but the completion marker isn't set yet.
//   * Module entered where every askable internal has all edges
//     blocked by `disabledWhen` for this sel.
//   * Node slot whose every edge is blocked by `disabledWhen`.
//
// The fix is always at the graph-design level: tighten the slot's
// activateWhen / hideWhen, add the missing exit transition, or
// derive the completion marker on this path.

function detectStuckInputs(prop) {
    const errors = [];

    for (const [slotKey, stuckSels] of prop.stuckBySlot) {
        if (!stuckSels.length) continue;
        const accepted = prop.acceptedBySlot.get(slotKey) || 0;
        const samples = stuckSels.slice(0, 3).map(_selUrl);
        errors.push(`[stuck-bucket] Slot "${slotKey}": ${fmtCount(stuckSels.length)}/${fmtCount(accepted)} accepted inputs produced zero outputs (engine would render slot with nothing to advance into)`);
        for (const u of samples) errors.push(`              sample: ${u}`);
    }

    // Per-sel tight check: for every sel routed into a module slot,
    // confirm at least one internal is runtime-askable AND has at
    // least one enabled edge. We only run this on module slots
    // because node slots only have one internal — if it's askable
    // with all edges disabled, the slot's gate let the sel through
    // but the slot's writes produce no rows and bucket-level
    // detection (a) catches it.
    for (const [slotKey, sels] of prop.inputsBySlot) {
        const slot = FLOW_DAG.nodes.find(n => n && n.key === slotKey);
        if (!slot || slot.kind !== 'module') continue;
        const m = Engine.MODULE_MAP[slot.id];
        if (!m) continue;
        let perSelStuck = 0;
        const perSelSamples = [];
        for (const sel of sels) {
            if (GraphIO.findNextInternalNode(m, sel) !== null) continue;
            // Skip if already counted at the bucket level.
            const stuckBucket = prop.stuckBySlot.get(slotKey) || [];
            if (stuckBucket.indexOf(sel) >= 0) continue;
            perSelStuck++;
            if (perSelSamples.length < 3) perSelSamples.push(_selUrl(sel));
        }
        if (perSelStuck > 0) {
            errors.push(`[stuck-per-sel] Slot "${slotKey}": ${fmtCount(perSelStuck)}/${fmtCount(sels.length)} routed inputs have every askable internal's every edge disabled (engine would render slot's first askable internal with all options greyed out)`);
            for (const u of perSelSamples) errors.push(`                sample: ${u}`);
        }
    }

    return errors;
}

// ────────────────────────────────────────────────────────────────
// Phase 7 — Outcome reachability
// ────────────────────────────────────────────────────────────────
//
// Every outcome template should have at least one path that reaches
// it. An outcome with zero reach is either (a) over-constrained in
// its `reachable` clauses, or (b) the dim values it requires aren't
// produced anywhere by the graph.

function checkOutcomeReach(prop) {
    const errors = [];
    for (const t of TEMPLATES) {
        if (!t.reachable) continue;
        const count = prop.outcomeAgg.get(t.id) || 0;
        if (count === 0) {
            errors.push(`[outcome-unreached] "${t.id}" — no path from emergence siphons to this outcome`);
        }
    }
    return errors;
}

// ────────────────────────────────────────────────────────────────
// Phase 8 — Unauthorized siphons
// ────────────────────────────────────────────────────────────────
//
// FLOW_DAG annotates each slot with `earlyExits` — the outcomes this
// slot may legitimately terminate at. Anything matchOutcomes hits at
// a slot whose earlyExits doesn't list the oid is either a clause
// leak (the outcome's reachable clauses match a sel produced by a
// slot not designed to terminate at it) or an annotation gap (the
// slot really should terminate at this outcome and earlyExits needs
// extending). Either way it inflates the reach masks the runtime
// ships and should be fixed.

function checkUnauthorizedSiphons(prop) {
    const errors = [];
    const slotKeys = [...prop.unauthorizedBySlot.keys()].sort();
    for (const sk of slotKeys) {
        const perSlot = prop.unauthorizedBySlot.get(sk);
        const oids = [...perSlot.keys()].sort();
        for (const oid of oids) {
            const c = perSlot.get(oid);
            errors.push(`[unauthorized-siphon] ${sk} → ${oid} (${fmtCount(c)} sel${c === 1 ? '' : 's'} — not in slot.earlyExits)`);
        }
    }
    return errors;
}

// ────────────────────────────────────────────────────────────────
// Phase 9 — Module exit-plan completeness
// ────────────────────────────────────────────────────────────────
//
// Walks each module-kind slot's reachable input sels through the
// engine's actual decision logic — pick the next askable internal
// (graph-io.findNextInternalNode), fork on each enabled edge, apply
// edge effects via Engine.applyEdgeEffects, recurse — and verifies
// every reachable terminal is either:
//   (a) cleanly exited (module's completionMarker set), OR
//   (b) accepted by a child slot's gate (legitimate module-bypass).
//
// A "stuck terminal" is a sel where:
//   * Engine.isModuleDone(sel, completionMarker) is false, AND
//   * GraphIO.findNextInternalNode returns null (nothing askable), AND
//   * No downstream slot's activateWhen/hideWhen accepts the sel.
//
// At runtime this manifests as flowNext returning { kind: 'stuck' }
// (or the fall-through { kind: 'open' } with no template match). The
// UI silently swallows both — the user freezes on the last rendered
// question with no path forward. (Confirmed in index.html's mainLoop:
// `if (flow.kind === 'stuck') return null;`.)
//
// Why graph-io's set-wise propagation (Phases 3, 6) misses this:
// `cartesianWriteRows` enumerates module outputs by iterating the
// *declared* exit plan. A *missing* exit-plan tuple produces no
// output sel for that input combination, so the propagation has
// nothing to flag. This phase is the engine-faithful complement —
// it walks the same DFS the runtime would and verifies the exit
// plan is complete relative to the inputs each slot actually sees.
//
// Cost: per-input-sel walk, memoized on the post-edge sel content.
// Module internals are bounded (≤10 nodes × ≤6 edges), so per-walk
// fan-out is small. Empirically ≪1s on the current graph.

function detectExitPlanGaps(prop) {
    const errors = [];
    const gapsByKey = new Map();

    // Memo is scoped per slot, NOT per module — whether a stuck
    // terminal counts as a gap depends on the slot's child set
    // (a downstream gate can "save" the sel). Shared-across-slots
    // memo would let slot A's "saved by child" early-return mask a
    // real gap at slot B (different children). Per-slot scope keeps
    // each slot's gap calculus independent while still collapsing
    // intra-slot convergence (the dominant work).
    for (const slot of FLOW_DAG.nodes) {
        if (!slot || slot.kind !== 'module') continue;
        const m = Engine.MODULE_MAP[slot.id];
        if (!m || !m.completionMarker) continue;

        // Walk the *real* propagation inputs for this slot — the
        // sels that actually arrive at runtime, including upstream
        // history. Canonical (cartesianReadRows) inputs project away
        // dims the module doesn't declare as reads, but the engine's
        // DFS is sensitive to ANY dim referenced by a node/edge
        // predicate (available_when, disabled_when, hide_when,
        // requires, effects.when), and those can — and do — overlap
        // with upstream-only dims. Walking the real inputs guarantees
        // we exercise the same routing the runtime sees.
        const realInputs = prop.inputsBySlot.get(slot.key) || [];
        if (!realInputs.length) continue;

        // Project the memo key onto the dims the module's DFS could
        // possibly read — module reads/writes/nodeIds/completion +
        // every dim mentioned in any internal node's predicates and
        // every internal edge's predicates/effects. Sels that agree
        // on this projection produce identical DFS behavior. Two
        // upstream histories that differ only in dims the module
        // doesn't observe collapse to one walk.
        const memoDims = _moduleMemoDims(m);
        const visited = new Set();

        for (const input of realInputs) {
            _walkModuleForGaps(m, input, slot.key, gapsByKey, visited, memoDims);
        }
    }

    const sortedKeys = [...gapsByKey.keys()].sort();
    for (const key of sortedKeys) {
        const info = gapsByKey.get(key);
        // Two distinct failure modes share Phase 9's reporting:
        //   * stuck       — flowNext returns kind=stuck. The engine is
        //                   wedged inside the module — no askable
        //                   internal, no exit tuple, no downstream slot
        //                   accepts. Fix: add an exit-plan tuple OR
        //                   make a child slot's gate accept the sel.
        //   * no-outcome  — flowNext returns kind=open (path completes
        //                   per FLOW_DAG) but no outcome template
        //                   matches the resolved state. Symptom is the
        //                   eval's "NO MATCH" terminal. Fix: extend an
        //                   outcome template's `reachable` clauses,
        //                   OR add an exit tuple that sets the missing
        //                   dim a template requires.
        const detail = info.symptom === 'no-outcome'
            ? 'with no matching outcome template (path completes via flowNext but resolves to NO MATCH)'
            : 'with no exit-plan tuple firing AND no downstream slot accepting the result';
        errors.push(
            `[exit-plan-gap:${info.symptom}] Slot "${info.slotKey}" (module "${info.moduleId}"): `
            + `terminal ${info.terminalNodeId}.${info.terminalEdgeId} is reachable `
            + `via ${fmtCount(info.count)} engine state(s) ${detail}`
        );
        for (const u of info.samples) errors.push(`                sample: ${u}`);
    }
    return errors;
}

// Dims the module's DFS may observe. Must be a SUPERSET of every
// dim that affects findNextInternalNode / isEdgeDisabled /
// applyEdgeEffects for this module — otherwise two sels with the
// same projection can produce different walks and we'd miss gaps.
//
// Includes module-declared reads/writes/nodeIds/completion plus
// every dim mentioned in any internal node's available_when /
// hide_when / requires and any internal edge's disabled_when /
// effects[].when. We do NOT include dims set BY effects on those
// nodes — those are already captured via writes ∪ nodeIds.
function _moduleMemoDims(m) {
    const dims = new Set();
    for (const d of m.reads || []) dims.add(d);
    for (const d of m.writes || []) dims.add(d);
    for (const d of m.nodeIds || []) dims.add(d);
    if (typeof m.completionMarker === 'string') dims.add(m.completionMarker);
    else if (m.completionMarker && m.completionMarker.dim) dims.add(m.completionMarker.dim);
    for (const nodeId of (m.nodeIds || [])) {
        const node = NODE_MAP[nodeId];
        if (!node) continue;
        _collectCondDims(node.activate_when, dims);
        _collectCondDims(node.hide_when, dims);
        _collectCondDims(node.requires, dims);
        for (const e of (node.edges || [])) {
            _collectCondDims(e.disabled_when, dims);
            const effects = Array.isArray(e.effects) ? e.effects : (e.effects ? [e.effects] : []);
            for (const eff of effects) if (eff) _collectCondDims(eff.when, dims);
        }
    }
    return [...dims].sort();
}

function _collectCondDims(cond, out) {
    if (!cond || typeof cond !== 'object') return;
    if (Array.isArray(cond)) { for (const c of cond) _collectCondDims(c, out); return; }
    for (const k of Object.keys(cond)) {
        if (k === 'reason') continue;
        if (k === 'and' || k === 'or' || k === 'not_all' || k === 'any' || k === 'all') {
            _collectCondDims(cond[k], out);
            continue;
        }
        out.add(k);
    }
}

function _walkModuleForGaps(module, entrySel, slotKey, gapsByKey, visited, memoDims) {
    const completionMarker = module.completionMarker;

    function visit(sel, lastEdge) {
        if (Engine.isModuleDone(sel, completionMarker)) return;

        // Project sel onto memoDims for the memo key. Two sels that
        // agree on (reads ∪ writes ∪ nodeIds ∪ completionMarker)
        // produce identical module DFS results — we explore once.
        let memoKey = '';
        for (const d of memoDims) {
            const v = sel[d];
            if (v !== undefined) memoKey += d + '=' + v + '|';
        }
        if (visited.has(memoKey)) return;
        visited.add(memoKey);

        const next = GraphIO.findNextInternalNode(module, sel);
        if (next) {
            for (const edge of next.edges) {
                if (Engine.isEdgeDisabled(sel, next, edge)) continue;
                // Engine.push semantics: stamp edge.id, then apply
                // edge effects (may set completionMarker, move dims,
                // etc.). flavor=null mirrors the static-analysis
                // posture in graph-io — `move` just deletes the dim.
                const newSel = { ...sel, [next.id]: edge.id };
                Engine.applyEdgeEffects(newSel, edge, null);
                visit(newSel, { nodeId: next.id, edgeId: edge.id });
            }
            return;
        }

        // No askable internal AND module not done. Defer to the runtime
        // navigator (FlowPropagation.flowNext) — same primitive index.html
        // and tests/evaluate.js use — to decide whether the engine can
        // advance from this sel.
        //
        // Replaces an earlier optimistic child-slot heuristic that
        // asked "does any child of THIS slot's gate match?". That
        // check was unsound: a static "child accepts" doesn't
        // guarantee the runtime would actually route there, because
        // the runtime current slot is determined by
        // `parentSlotKeyFromStack(stack)` — which can disagree with
        // the slot Phase 9 happens to be walking. Concretely, Lena's
        // path (committed bugfix 2d1d08b) exposed this: Phase 9 walked
        // escape_early_alt where intent_loop's activateWhen matches
        // the stuck sel ("saved by child"), but the runtime resolved
        // her stack's parent to a slot routing through escape_early
        // (children: proliferation, who_benefits — neither saves) and
        // dead-ended at NO MATCH.
        //
        // flowNext is the canonical routing primitive, so deferring to
        // it gives a runtime-faithful answer for the slot Phase 9 is
        // walking. Three outcomes:
        //   * kind=question   — runtime would ask the next node. Safe.
        //   * kind=open       — module/path exited cleanly per FLOW_DAG.
        //                       Need to additionally verify an outcome
        //                       template matches; otherwise this is a
        //                       NO MATCH terminal (= what eval surfaces).
        //   * kind=stuck      — runtime is wedged. Flag.
        //
        // CAVEAT: this still inherits propagation's slot assignment for
        // the input sel. If propagation thinks the sel reaches slot X
        // but runtime's parentSlotKeyFromStack would put the engine
        // at a different slot Y for the same sel + some stack history,
        // and flowNext(sel, X) is happy while flowNext(sel, Y) is
        // stuck, this check misses it. The strictly-correct fix would
        // enumerate every FLOW_DAG slot whose gate matches this sel
        // and check flowNext from each — sound but expensive and
        // likely surfaces false positives. Land the cheap fix first,
        // see what surfaces, then escalate if needed.
        const flow = FlowPropagation.flowNext(sel, slotKey);
        if (flow.kind === 'question') return;
        if (flow.kind === 'open') {
            // Path complete — verify an outcome template matches.
            const eff = Engine.resolvedState(sel);
            for (const t of TEMPLATES) {
                if (Engine.templateMatches(t, eff)) return;
            }
            // Falls through to gap flagging — open with no outcome.
        }

        // Stuck or open-no-outcome. Skip entry-time stalls (Phase 4 /
        // Phase 6 territory).
        if (!lastEdge) return;

        const symptom = flow.kind === 'open' ? 'no-outcome' : 'stuck';
        const gapKey = `${module.id}|${lastEdge.nodeId}|${lastEdge.edgeId}|${symptom}`;
        let info = gapsByKey.get(gapKey);
        if (!info) {
            info = {
                slotKey, moduleId: module.id,
                terminalNodeId: lastEdge.nodeId,
                terminalEdgeId: lastEdge.edgeId,
                symptom,
                count: 0, samples: [],
            };
            gapsByKey.set(gapKey, info);
        }
        info.count++;
        if (info.samples.length < 3) info.samples.push(_selUrl(sel));
    }

    visit(entrySel, null);
}

// ────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────

// Honors $PORT for parity with serve.js (which defaults to 3000).
const _DEBUG_PORT = process.env.PORT || 3000;
function _selUrl(sel) {
    const params = Object.entries(sel)
        .filter(([, v]) => v != null)
        .map(([k, v]) => `${k}=${v}`)
        .join('&');
    return `http://localhost:${_DEBUG_PORT}/#/explore${params ? '?' + params : ''}`;
}

function fmtCount(n) { return Number(n).toLocaleString(); }

// ────────────────────────────────────────────────────────────────
// Main
// ────────────────────────────────────────────────────────────────

const QUICK = process.argv.includes('--quick');

const sections = [];

console.log('Phase 1: static schema');
const t1 = Date.now();
const staticErrors = runStaticAnalysis();
console.log(`  ${staticErrors.length === 0 ? 'OK' : `FAIL (${staticErrors.length})`}  ${Date.now() - t1}ms`);
sections.push({ name: 'static schema', errors: staticErrors });

if (!QUICK) {
    console.log('\nPhase 2: live propagation (full tree)');
    const t2 = Date.now();
    const prop = FlowPropagation.run();
    const inputsTotal = [...prop.acceptedBySlot.values()].reduce((a, b) => a + b, 0);
    const matchedTotal = [...prop.matchedBySlot.values()].reduce((a, b) => a + b, 0);
    console.log(`  propagated through ${prop.order.length} slots in ${Date.now() - t2}ms`);
    console.log(`  ${fmtCount(inputsTotal)} inputs accepted across all slots`);
    console.log(`  ${fmtCount(matchedTotal)} sels siphoned to outcomes`);
    console.log(`  ${prop.outcomeAgg.size}/${TEMPLATES.length} outcome templates reached`);

    console.log('\nPhase 3: dead-end detection');
    const t3 = Date.now();
    const deadErrors = detectDeadEnds(prop);
    console.log(`  ${deadErrors.length === 0 ? 'OK' : `FAIL (${deadErrors.length})`}  ${Date.now() - t3}ms`);
    sections.push({ name: 'dead ends', errors: deadErrors });

    console.log('\nPhase 4: module gate vs. internal askability');
    const t4 = Date.now();
    const gateErrors = detectGateWithoutInternals(prop);
    console.log(`  ${gateErrors.length === 0 ? 'OK' : `FAIL (${gateErrors.length})`}  ${Date.now() - t4}ms`);
    sections.push({ name: 'module gate vs. internals', errors: gateErrors });

    console.log('\nPhase 5: edge coverage');
    const t5 = Date.now();
    const edgeErrors = checkEdgeCoverage(prop);
    console.log(`  ${edgeErrors.length === 0 ? 'OK' : `FAIL (${edgeErrors.length})`}  ${Date.now() - t5}ms`);
    sections.push({ name: 'edge coverage', errors: edgeErrors });

    console.log('\nPhase 6: stuck inputs');
    const t6 = Date.now();
    const stuckErrors = detectStuckInputs(prop);
    console.log(`  ${stuckErrors.length === 0 ? 'OK' : `FAIL (${stuckErrors.length})`}  ${Date.now() - t6}ms`);
    sections.push({ name: 'stuck inputs', errors: stuckErrors });

    console.log('\nPhase 7: outcome reachability');
    const t7 = Date.now();
    const outcomeErrors = checkOutcomeReach(prop);
    console.log(`  ${outcomeErrors.length === 0 ? 'OK' : `FAIL (${outcomeErrors.length})`}  ${Date.now() - t7}ms`);
    sections.push({ name: 'outcome reachability', errors: outcomeErrors });

    console.log('\nPhase 8: unauthorized siphons');
    const t8 = Date.now();
    const unauthErrors = checkUnauthorizedSiphons(prop);
    console.log(`  ${unauthErrors.length === 0 ? 'OK' : `FAIL (${unauthErrors.length})`}  ${Date.now() - t8}ms`);
    sections.push({ name: 'unauthorized siphons', errors: unauthErrors });

    console.log('\nPhase 9: module exit-plan completeness');
    const t9 = Date.now();
    const exitPlanErrors = detectExitPlanGaps(prop);
    console.log(`  ${exitPlanErrors.length === 0 ? 'OK' : `FAIL (${exitPlanErrors.length})`}  ${Date.now() - t9}ms`);
    sections.push({ name: 'exit-plan completeness', errors: exitPlanErrors });
}

console.log('\n' + '═'.repeat(60));
let totalErrors = 0;
for (const s of sections) {
    const status = s.errors.length === 0 ? 'PASS' : `FAIL (${s.errors.length})`;
    console.log(`  ${s.name.padEnd(24)} ${status}`);
    totalErrors += s.errors.length;
}
console.log('─'.repeat(60));
console.log(`  total: ${totalErrors === 0 ? 'PASS' : `${totalErrors} errors`}`);

if (totalErrors > 0) {
    console.log();
    for (const s of sections) {
        if (!s.errors.length) continue;
        console.log(`── ${s.name} ──`);
        for (const e of s.errors) console.log(`  ${e}`);
        console.log();
    }
}

process.exit(totalErrors === 0 ? 0 : 1);
