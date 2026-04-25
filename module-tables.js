// module-tables.js — precomputed/memoized module exit tables.
//
// A module is a sub-loop over a disjoint subset of nodeIds + markers,
// entered when activateWhen matches, walked via its internal decisions,
// and exited when its completionMarker is set in sel.
//
// For the validator, we treat each module as an atomic step: given the
// outer sel (projected onto mod.reads), enumerate all possible exit
// results. An ExitResult is { setSel, setFlavor } — the dims that
// propagate to sel (writes) and the dims that propagate to flavor
// (nodeIds \ writes, plus internalMarkers, plus anything the reducer
// pushed to flavor via collapseToFlavor).
//
// Memoization key = mod.id + projection of sel onto mod.reads. Dims
// outside mod.reads cannot affect the module's walk (module-audit
// enforces this). Projection keeps the table keyspace tiny.

const { NODES, NODE_MAP, MODULES, MODULE_MAP } = require('./graph.js');
const { cleanSelection, matchCondition, isEdgeDisabled } = require('./engine.js');

// ────────────────────────────────────────────────────────
// Module-pending helpers (sel-only; mirror engine internals).
// ────────────────────────────────────────────────────────

function completionMarkerOf(mod) {
    if (mod.completionMarker) return mod.completionMarker;
    const writes = mod.writes || [];
    for (const w of writes) if (w.startsWith(mod.id + '_')) return w;
    return writes[writes.length - 1];
}

function isModuleDone(sel, marker) {
    if (!marker) return false;
    if (typeof marker === 'string') return sel[marker] !== undefined;
    const v = sel[marker.dim];
    return v !== undefined && marker.values.indexOf(v) !== -1;
}

function isModulePending(mod, sel) {
    const marker = completionMarkerOf(mod);
    if (isModuleDone(sel, marker)) return false;
    const conds = mod.activateWhen;
    if (!conds || !conds.length) return true;
    return conds.some(c => matchCondition(sel, c));
}

// "Actively pending" = module pending AND at least one internal node is
// currently askable (its own activateWhen/hideWhen + at least one enabled
// edge). Mirrors engine's _isModuleActivelyPending but uses a shallow
// activation check to avoid module-first recursion.
function isModuleActivelyPending(mod, sel) {
    return earliestAskableNodeIndex(mod, sel) !== -1;
}

// Returns the NODES-array index of the earliest-askable internal node of
// `mod` under `sel`, or -1 if the module isn't actively pending. This
// matches the engine's scheduling: when multiple modules are pending,
// the one whose earliest internal node comes first in NODES order wins
// (because NODES order is how the engine picks the next question).
const _NODE_INDEX = new Map();
for (let i = 0; i < NODES.length; i++) _NODE_INDEX.set(NODES[i].id, i);

function earliestAskableNodeIndex(mod, sel) {
    if (!isModulePending(mod, sel)) return -1;
    let best = -1;
    for (const nid of (mod.nodeIds || [])) {
        const n = NODE_MAP[nid];
        if (!n || n.derived) continue;
        if (sel[nid] !== undefined) continue;
        if (n.activateWhen && !n.activateWhen.some(c => matchCondition(sel, c))) continue;
        if (n.hideWhen && n.hideWhen.some(c => matchCondition(sel, c))) continue;
        if (!n.edges || n.edges.length === 0) continue;
        if (!n.edges.some(e => !isEdgeDisabled(sel, n, e))) continue;
        const idx = _NODE_INDEX.get(nid);
        if (idx === undefined) continue;
        if (best === -1 || idx < best) best = idx;
    }
    return best;
}

// Returns the pending module with the earliest-askable internal node,
// or null if no module is actively pending. Ties broken by MODULES
// array order (deterministic). Used internally by pickNextAction.
function pickActiveModule(sel) {
    let best = null, bestIdx = Infinity;
    for (const mod of MODULES) {
        const idx = earliestAskableNodeIndex(mod, sel);
        if (idx === -1) continue;
        if (idx < bestIdx) { best = mod; bestIdx = idx; }
    }
    return best;
}

// "Basic askability" — activateWhen matched, hideWhen not matched,
// unanswered in sel, has at least one enabled edge. Mirrors the gates
// the engine applies before the priority-tier check.
function _basicAskable(sel, n) {
    if (n.derived) return false;
    if (sel[n.id] !== undefined) return false;
    if (!n.edges || n.edges.length === 0) return false;
    if (n.activateWhen && !n.activateWhen.some(c => matchCondition(sel, c))) return false;
    if (n.hideWhen && n.hideWhen.some(c => matchCondition(sel, c))) return false;
    if (!n.edges.some(e => !isEdgeDisabled(sel, n, e))) return false;
    return true;
}

// Picks the next action under the engine's current rule:
//   priority-first (lowest pri# fires first), ties → modules.
// Returns { kind: 'module', mod } | { kind: 'flat', node } | null.
//
// Module internals are NEVER picked as flat — they only fire as part
// of their module's table walk. That matches the validator contract
// (the module is atomic from the outer DFS's perspective). If a node's
// module is done, the node is considered ineligible (its dim will have
// been moved to flavor by the module exit, so the validator shouldn't
// re-ask it as a flat node).
//
// Algorithm:
//   1. Build the set of "candidates":
//        - Active-module-internals (a node inside an actively-pending
//          module that is shallow-askable).
//        - Pure flat nodes (no `n.module`) that are shallow-askable.
//   2. Find the minimum priority among candidates.
//   3. At minPri, prefer module-internals (tie → module). Pick first
//      qualifying node in NODES order; for a module-internal pick,
//      drive its module.
function pickNextAction(sel) {
    // Cache module-pending status per module so we don't recompute per node.
    const modPending = new Map();
    function modIsPending(mid) {
        if (modPending.has(mid)) return modPending.get(mid);
        const mod = MODULE_MAP[mid];
        const v = !!(mod && isModulePending(mod, sel));
        modPending.set(mid, v);
        return v;
    }

    function eligible(n) {
        if (!_basicAskable(sel, n)) return false;
        if (n.module) return modIsPending(n.module);
        return true;
    }

    let minPri = Infinity;
    for (const n of NODES) {
        if (!eligible(n)) continue;
        const pri = n.priority || 0;
        if (pri < minPri) minPri = pri;
    }
    if (minPri === Infinity) return null;

    let firstModuleNode = null;
    let firstFlatNode = null;
    for (const n of NODES) {
        if (!eligible(n)) continue;
        if ((n.priority || 0) !== minPri) continue;
        if (n.module) {
            if (!firstModuleNode) firstModuleNode = n;
        } else {
            if (!firstFlatNode) firstFlatNode = n;
        }
    }
    if (firstModuleNode) {
        return { kind: 'module', mod: MODULE_MAP[firstModuleNode.module] };
    }
    if (firstFlatNode) {
        return { kind: 'flat', node: firstFlatNode };
    }
    return null;
}

// ────────────────────────────────────────────────────────
// Projection + memo key.
// ────────────────────────────────────────────────────────

function projectReads(mod, sel) {
    const r = {};
    const reads = mod.reads || [];
    for (const k of reads) {
        if (sel[k] !== undefined) r[k] = sel[k];
    }
    return r;
}

function keyOfProjected(mod, proj) {
    const keys = (mod.reads || []).slice().sort();
    const parts = [];
    for (const k of keys) {
        if (proj[k] !== undefined) parts.push(k + '=' + proj[k]);
    }
    return mod.id + '#' + parts.join('&');
}

// ────────────────────────────────────────────────────────
// Internal askable check (no module-first, no priority gate).
// Used to walk a module's subgraph independently. Any order of
// internal answers produces the same terminal set (dedup on internal
// state captures convergence).
// ────────────────────────────────────────────────────────

function internalAskable(sel, node) {
    if (sel[node.id] !== undefined) return null;
    if (!node.edges || node.edges.length === 0) return null;
    if (node.activateWhen && !node.activateWhen.some(c => matchCondition(sel, c))) return null;
    if (node.hideWhen && node.hideWhen.some(c => matchCondition(sel, c))) return null;
    const enabled = node.edges.filter(e => !isEdgeDisabled(sel, node, e));
    return enabled.length ? enabled : null;
}

// ────────────────────────────────────────────────────────
// Capture exit result from a (sel, flavor) pair that has the
// completion marker set.
//   setSel   = writes ∩ sel        (dims that propagate to outer sel)
//   setFlavor = nodeIds\writes ∩ flavor  ∪ internalMarkers ∩ flavor
//               ∪ any extra flavor entries produced by collapseToFlavor
// ────────────────────────────────────────────────────────

function captureExitResult(mod, exitSel, exitFlavor) {
    const writes = mod.writes || [];
    const setSel = {};
    for (const w of writes) {
        if (exitSel[w] !== undefined) setSel[w] = exitSel[w];
    }
    const setFlavor = {};
    const writesSet = new Set(writes);
    // nodeIds \ writes: per attachModuleReducer, these move to flavor on exit.
    for (const nid of (mod.nodeIds || [])) {
        if (writesSet.has(nid)) continue;
        if (exitFlavor[nid] !== undefined) setFlavor[nid] = exitFlavor[nid];
    }
    // internalMarkers: per attachModuleReducer, also move to flavor.
    for (const m of (mod.internalMarkers || [])) {
        if (exitFlavor[m] !== undefined) setFlavor[m] = exitFlavor[m];
    }
    // Any other flavor entries the module reducer wrote (e.g. setFlavor
    // blocks) that aren't in nodeIds/internalMarkers: include them too so
    // narrative/templates can see them.
    for (const k of Object.keys(exitFlavor)) {
        if (setFlavor[k] !== undefined) continue;
        if (exitSel[k] !== undefined) continue;  // sel wins
        setFlavor[k] = exitFlavor[k];
    }
    return { setSel, setFlavor };
}

function exitSignature(r) {
    const sk = Object.keys(r.setSel).sort().map(k => k + '=' + r.setSel[k]).join('|');
    const fk = Object.keys(r.setFlavor).sort().map(k => k + '=' + r.setFlavor[k]).join('|');
    return 's:' + sk + ';f:' + fk;
}

// ────────────────────────────────────────────────────────
// Run a module's internal DFS starting from a projected input sel.
// Returns { exits, internalEdgesVisited, internalDeadEnds, internalStuck }.
// ────────────────────────────────────────────────────────

function runModule(mod, inputSel) {
    const exits = [];
    const seenExits = new Set();
    const marker = completionMarkerOf(mod);
    const moduleNodeSet = new Set(mod.nodeIds || []);

    const internalEdgesVisited = new Set();   // `${nid}=${eid}` for edges in mod.nodeIds
    const internalDeadEnds = [];              // module-internal states with no askable internals
    const internalStuck = [];                 // `${nid}` + state, internal node visible with 0 enabled

    const visitedStates = new Set();

    function keyOfLocalState(sel) {
        // Only keep keys that the module could possibly read/write.
        const ks = Object.keys(sel).filter(k =>
            (mod.reads || []).includes(k) ||
            moduleNodeSet.has(k) ||
            (mod.internalMarkers || []).includes(k) ||
            (mod.writes || []).includes(k)
        );
        ks.sort();
        return ks.map(k => k + '=' + sel[k]).join('|');
    }

    function dfs(sel, flavor) {
        if (isModuleDone(sel, marker)) {
            const r = captureExitResult(mod, sel, flavor);
            const sig = exitSignature(r);
            if (!seenExits.has(sig)) {
                seenExits.add(sig);
                exits.push(r);
            }
            return;
        }

        const sk = keyOfLocalState(sel);
        if (visitedStates.has(sk)) return;
        visitedStates.add(sk);

        // Pick first askable internal node.
        let picked = null;
        let pickedEnabled = null;
        for (const nid of (mod.nodeIds || [])) {
            const n = NODE_MAP[nid];
            if (!n || n.derived) continue;
            // Stuck-internal detection: visible (activate matched, hide not matched,
            // unanswered, has edges) but zero enabled edges.
            if (sel[nid] !== undefined) continue;
            if (!n.edges || n.edges.length === 0) continue;
            if (n.activateWhen && !n.activateWhen.some(c => matchCondition(sel, c))) continue;
            if (n.hideWhen && n.hideWhen.some(c => matchCondition(sel, c))) continue;
            const enabled = n.edges.filter(e => !isEdgeDisabled(sel, n, e));
            if (enabled.length === 0) {
                internalStuck.push({ module: mod.id, node: nid, sel: { ...sel } });
                continue;
            }
            picked = n;
            pickedEnabled = enabled;
            break;
        }

        if (!picked) {
            // No askable internal + marker not set → module can't complete
            // from this input state (module-internal dead end).
            internalDeadEnds.push({ module: mod.id, sel: { ...sel } });
            return;
        }

        for (const edge of pickedEnabled) {
            internalEdgesVisited.add(picked.id + '=' + edge.id);
            const nextSel = { ...sel, [picked.id]: edge.id };
            const nextFlavor = { ...flavor };
            const r = cleanSelection(nextSel, nextFlavor);
            // Always recurse. sel[picked.id] may be undefined after cleanSel
            // if the edge has a `move: [picked.id]` directive (legitimate
            // move-to-flavor — the answer is captured in flavor). The only
            // "erased" case that matters is if the edge had zero effect,
            // but for the module-internal walk we just continue — the
            // outer DFS reports flat-node click-erased separately.
            dfs(r.sel, r.flavor);
        }
    }

    dfs({ ...inputSel }, {});

    return { exits, internalEdgesVisited, internalDeadEnds, internalStuck };
}

// ────────────────────────────────────────────────────────
// Public API: memoized lookup.
// ────────────────────────────────────────────────────────

const _tableCache = new Map();  // key → { exits, internalEdgesVisited, ... }

function getModuleTable(mod, sel) {
    const proj = projectReads(mod, sel);
    const key = keyOfProjected(mod, proj);
    let entry = _tableCache.get(key);
    if (entry) return entry;
    entry = runModule(mod, proj);
    _tableCache.set(key, entry);
    return entry;
}

function getModuleExits(mod, sel) {
    return getModuleTable(mod, sel).exits;
}

function resetCache() {
    _tableCache.clear();
}

function cacheStats() {
    const perModule = {};
    for (const k of _tableCache.keys()) {
        const mid = k.split('#')[0];
        perModule[mid] = (perModule[mid] || 0) + 1;
    }
    return { totalRows: _tableCache.size, perModule };
}

// Aggregate the internal edges visited across all cached module tables.
// Used by the validator's edge-coverage reporting so internal module edges
// count as "reached" whenever any module-table row hit them.
function allInternalEdgesVisited() {
    const all = new Set();
    for (const entry of _tableCache.values()) {
        for (const e of entry.internalEdgesVisited) all.add(e);
    }
    return all;
}

// Aggregate internal-dead-end / internal-stuck observations across cached
// tables. Dedup by (module + serialized sel) / (module + node + serialized sel).
function allInternalIssues() {
    const ddKeys = new Set();
    const stuckKeys = new Set();
    const deadEnds = [];
    const stuck = [];
    for (const entry of _tableCache.values()) {
        for (const de of entry.internalDeadEnds) {
            const kk = de.module + '|' + JSON.stringify(de.sel);
            if (ddKeys.has(kk)) continue;
            ddKeys.add(kk);
            deadEnds.push(de);
        }
        for (const st of entry.internalStuck) {
            const kk = st.module + '|' + st.node + '|' + JSON.stringify(st.sel);
            if (stuckKeys.has(kk)) continue;
            stuckKeys.add(kk);
            stuck.push(st);
        }
    }
    return { deadEnds, stuck };
}

module.exports = {
    isModulePending,
    isModuleActivelyPending,
    earliestAskableNodeIndex,
    pickActiveModule,
    pickNextAction,
    projectReads,
    getModuleExits,
    getModuleTable,
    resetCache,
    cacheStats,
    allInternalEdgesVisited,
    allInternalIssues,
};
