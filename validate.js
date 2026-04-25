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

const GraphIO = global.window.GraphIO;
const FLOW_DAG = global.window.Nodes.FLOW_DAG;
const NODES = Engine.NODES || Graph.NODES;
const NODE_MAP = {};
for (const n of NODES) NODE_MAP[n.id] = n;
const outcomesData = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/outcomes.json'), 'utf8'));
const TEMPLATES = outcomesData.templates;
GraphIO.registerOutcomes(TEMPLATES);

// PROPAGATE_TARGETS mirrors explore.js — keep in sync if either is
// extended to a new slot. Includes every non-outcome / non-deadend
// slot in FLOW_DAG; emergence is the implicit seed.
const PROPAGATE_TARGETS = new Set([
    'plateau_bd', 'auto_bd', 'rollout_early', 'control', 'alignment', 'decel',
    'escape_early', 'proliferation', 'escape_early_alt', 'intent', 'war',
    'who_benefits', 'inert_stays', 'brittle', 'escape_late', 'rollout',
]);

// ────────────────────────────────────────────────────────────────
// Phase 1 — Static schema checks (no traversal)
// ────────────────────────────────────────────────────────────────
//
// Verifies that every condition (activateWhen, hideWhen, requires,
// disabledWhen, deriveWhen, outcome.reachable) refers to dims/values
// that actually exist in the graph. Synthetic dims/values produced
// by collapseToFlavor.set or deriveWhen.value(Map) are accepted.
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
        if (node.deriveWhen) {
            for (const rule of node.deriveWhen) {
                if (rule.value !== undefined) addExtra(node.id, rule.value);
                if (rule.valueMap) {
                    for (const out of Object.values(rule.valueMap)) addExtra(node.id, out);
                }
            }
        }
        if (!node.edges) continue;
        for (const edge of node.edges) {
            if (!edge.collapseToFlavor) continue;
            const blocks = Array.isArray(edge.collapseToFlavor) ? edge.collapseToFlavor : [edge.collapseToFlavor];
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

    for (const node of NODES) {
        if (!node.deriveWhen) continue;
        const ownValues = validValuesFor(node.id) || new Set();
        for (const rule of node.deriveWhen) {
            if (rule.match) {
                for (const [k, val] of Object.entries(rule.match)) {
                    if (k === 'reason') continue;
                    if (!metaNodes.has(k)) { errors.push(`[derivations] "${node.id}" references unknown node "${k}" in match`); continue; }
                    if (val === true || val === false) continue;
                    const validIds = validValuesFor(k);
                    if (!validIds) continue;
                    if (val && typeof val === 'object' && !Array.isArray(val) && val.not) {
                        for (const v of val.not) {
                            if (!validIds.has(v)) errors.push(`[derivations] "${node.id}" unknown edge "${k}=${v}" in match.not`);
                        }
                        continue;
                    }
                    const vals = Array.isArray(val) ? val : [val];
                    for (const v of vals) {
                        if (!validIds.has(v)) errors.push(`[derivations] "${node.id}" unknown edge "${k}=${v}" in match`);
                    }
                }
            }
            if (rule.fromState && !metaNodes.has(rule.fromState)) {
                errors.push(`[derivations] "${node.id}" unknown node "${rule.fromState}" in fromState`);
            }
            if (rule.value !== undefined && !ownValues.has(rule.value)) {
                errors.push(`[derivations] "${node.id}" produces unknown edge "${rule.value}"`);
            }
            if (rule.valueMap) {
                for (const [from, to] of Object.entries(rule.valueMap)) {
                    if (!ownValues.has(from)) errors.push(`[derivations] "${node.id}" valueMap unknown input "${from}"`);
                    if (!ownValues.has(to))   errors.push(`[derivations] "${node.id}" valueMap unknown output "${to}"`);
                }
            }
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
// Runs the same set-wise enumeration that buildReachByKey runs in
// explore.js. Each parent's outputs are routed to its children via
// engine-equivalent priority pick: every output goes to exactly one
// child — the accepting child whose lowest-priority internal node
// has the smallest priority value. This matches what the navigator
// would do at runtime (a single sel never appears in two downstream
// slots' input sets).
//
// Returns:
//   inputsBySlot      Map<slotKey, sel[]>   sels routed INTO each slot
//   routedBySlot      Map<slotKey, sel[]>   sels routed FROM each parent
//                                           (i.e. parent outputs that found
//                                           a child) — used for edge cov.
//   routedToChild     Map<parentKey, Map<childKey, count>>
//                                           per-edge routed counts
//                                           (edge-coverage check)
//   deadBySlot        Map<slotKey, sel[]>   parent outputs no child accepts
//   acceptedBySlot    Map<slotKey, number>  inputs accepted by slot
//   matchedBySlot     Map<slotKey, number>  outputs siphoned to outcomes
//   outcomeAgg        Map<oid, number>      outputs siphoned to each outcome
//   parentsOf         Map<slotKey, slotKey[]>
//   childrenOf        Map<slotKey, slotKey[]>

function runPropagation() {
    const parentsOf = new Map();
    const childrenOf = new Map();
    for (const e of FLOW_DAG.edges) {
        const [p, c, kind] = e;
        if (kind === 'placement-outcome' || kind === 'placement-deadend') continue;
        if (kind === 'outcome-link') continue;
        if (String(c).startsWith('outcome:') || c === 'deadend') continue;
        if (!PROPAGATE_TARGETS.has(c)) continue;
        if (!parentsOf.has(c)) parentsOf.set(c, []);
        parentsOf.get(c).push(p);
        if (!childrenOf.has(p)) childrenOf.set(p, []);
        childrenOf.get(p).push(c);
    }
    const allKeys = new Set([...PROPAGATE_TARGETS, 'emergence']);
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

    const rowToSel = (row) => {
        const sel = {};
        for (const k of Object.keys(row)) if (row[k] !== GraphIO.UNSET) sel[k] = row[k];
        return sel;
    };
    const emergence = FLOW_DAG.nodes.find(n => n.key === 'emergence');
    const eW = GraphIO.cartesianWriteRows(emergence);
    const emergenceOutputs = eW.rows.map(rowToSel);

    // Engine-equivalent next-slot pick — see buildReachByKey in
    // explore.js for the full rationale. Returns Infinity for
    // "rejected" / "no askable internal", numeric priority otherwise.
    const _isAskableInternal = (n, sel) => {
        if (!n || n.derived) return false;
        if (sel[n.id] !== undefined) return false;
        if (n.activateWhen && n.activateWhen.length
            && !n.activateWhen.some(c => Engine.matchCondition(sel, c))) return false;
        if (n.hideWhen && n.hideWhen.length
            && n.hideWhen.some(c => Engine.matchCondition(sel, c))) return false;
        return true;
    };
    const slotPickPriority = (slot, sel) => {
        if (!slot || slot.kind === 'outcome' || slot.kind === 'deadend') return Infinity;
        if (slot.kind === 'node') {
            const n = Engine.NODE_MAP[slot.id];
            if (!_isAskableInternal(n, sel)) return Infinity;
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
                if (!_isAskableInternal(n, sel)) continue;
                const p = n.priority !== undefined ? n.priority : 0;
                if (p < minP) minP = p;
            }
            return minP;
        }
        return Infinity;
    };

    const inputsBySlot = new Map();
    const routedBySlot = new Map();   // parentKey → sels that found a child
    const deadBySlot = new Map();     // parentKey → sels with no accepting child
    const routedToChild = new Map();  // parentKey → Map<childKey, count>
    const acceptedBySlot = new Map();
    const matchedBySlot = new Map();
    const outcomeAgg = new Map();

    for (const slotKey of order) {
        const slot = FLOW_DAG.nodes.find(n => n.key === slotKey);
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
            .map(k => FLOW_DAG.nodes.find(n => n.key === k))
            .filter(Boolean);

        const routedHere = [];
        const deadHere = [];
        const perChildCount = new Map();
        let matched = 0;

        for (const sel of outputs) {
            const hits = GraphIO.matchOutcomes(sel);
            if (hits.length > 0) {
                matched++;
                for (const oid of hits) outcomeAgg.set(oid, (outcomeAgg.get(oid) || 0) + 1);
                continue;
            }
            let bestChild = null;
            let bestPri = Infinity;
            for (const child of childSlots) {
                const p = slotPickPriority(child, sel);
                if (p < bestPri) { bestPri = p; bestChild = child; }
            }
            if (bestChild) {
                let arr = inputsBySlot.get(bestChild.key);
                if (!arr) { arr = []; inputsBySlot.set(bestChild.key, arr); }
                arr.push(sel);
                routedHere.push(sel);
                perChildCount.set(bestChild.key, (perChildCount.get(bestChild.key) || 0) + 1);
            } else {
                deadHere.push(sel);
            }
        }
        matchedBySlot.set(slotKey, matched);
        routedBySlot.set(slotKey, routedHere);
        if (deadHere.length) deadBySlot.set(slotKey, deadHere);
        routedToChild.set(slotKey, perChildCount);
    }

    return {
        inputsBySlot, routedBySlot, deadBySlot, routedToChild,
        acceptedBySlot, matchedBySlot, outcomeAgg,
        parentsOf, childrenOf, order,
    };
}

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

function _slotAccepts(slot, sel) {
    if (!slot) return false;
    if (slot.kind === 'outcome') return false;
    const target = slot.kind === 'module'
        ? Engine.MODULE_MAP && Engine.MODULE_MAP[slot.id]
        : (slot.kind === 'node' ? Engine.NODE_MAP && Engine.NODE_MAP[slot.id] : null);
    if (!target) return false;
    const aw = target.activateWhen, hw = target.hideWhen;
    if (aw && aw.length && !aw.some(c => Engine.matchCondition(sel, c))) return false;
    if (hw && hw.length && hw.some(c => Engine.matchCondition(sel, c))) return false;
    return true;
}

function detectDeadEnds(prop) {
    const errors = [];
    for (const [slotKey, deadSels] of prop.deadBySlot) {
        if (!deadSels.length) continue;
        const routed = (prop.routedBySlot.get(slotKey) || []).length;
        const totalOuts = deadSels.length + routed;
        const childKeys = prop.childrenOf.get(slotKey) || [];
        if (!childKeys.length) {
            errors.push(`[deadend] Slot "${slotKey}" has ${deadSels.length} continuing outputs but no children to consume them`);
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
// Phase 6 — Outcome reachability
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
// Helpers
// ────────────────────────────────────────────────────────────────

function _selUrl(sel) {
    const params = Object.entries(sel)
        .filter(([, v]) => v != null)
        .map(([k, v]) => `${k}=${v}`)
        .join('&');
    return `http://localhost:2500/#/explore${params ? '?' + params : ''}`;
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
    const prop = runPropagation();
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

    console.log('\nPhase 6: outcome reachability');
    const t6 = Date.now();
    const outcomeErrors = checkOutcomeReach(prop);
    console.log(`  ${outcomeErrors.length === 0 ? 'OK' : `FAIL (${outcomeErrors.length})`}  ${Date.now() - t6}ms`);
    sections.push({ name: 'outcome reachability', errors: outcomeErrors });
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
