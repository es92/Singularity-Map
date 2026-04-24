// Singularity Map — Engine
// Interprets the declarative graph rules defined in graph.js.
// Handles derivations, activation, locking, state management, and template matching.

(function() {

const { SCENARIO, NODES, NODE_MAP, MODULES, MODULE_MAP } = (typeof module !== 'undefined' && module.exports)
    ? require('./graph.js') : window.Graph;

// ════════════════════════════════════════════════════════
// Derivation engine (declarative)
// ════════════════════════════════════════════════════════

// Pre-compilation: type tags for match entries
const _MT = 0, _MF = 1, _MN = 2, _MA = 3, _ME = 4;
// Pre-compilation: type tags for condition entries
const _CT = 0, _CF = 1, _CN = 2, _CR = 3, _CI = 4;

const _valToIdx = Object.create(null);
const _idxToVal = Object.create(null);
const _derivTable = Object.create(null);

function _precompile() {
    // Value indexing: map each dim's values to numeric indices (0 = undefined)
    for (const node of NODES) {
        if (!node.edges) continue;
        const v2i = Object.create(null);
        const i2v = [undefined];
        for (let j = 0; j < node.edges.length; j++) {
            v2i[node.edges[j].id] = j + 1;
            i2v.push(node.edges[j].id);
        }
        _valToIdx[node.id] = v2i;
        _idxToVal[node.id] = i2v;
    }

    // Register "marker" dimensions that aren't declared nodes but are written
    // into sel via `collapseToFlavor.set` (e.g. `agi_happens`, `asi_happens`,
    // `takeoff_class`, `rollout_set`, ...). These
    // need entries in _valToIdx/_idxToVal so derivation tables that reference
    // them as inputs can be built and looked up at runtime.
    //
    // Also collect extra values for dims that ARE declared nodes when
    // `collapseToFlavor.set` overrides the picked edge value with a collapsed
    // value (e.g. `geo_spread` edges 'two'/'several' collapsing to 'multiple').
    // Those collapsed values must be indexable too.
    const markerVals = Object.create(null);
    for (const node of NODES) {
        if (!node.edges) continue;
        for (const edge of node.edges) {
            const raw = edge.collapseToFlavor;
            if (!raw) continue;
            const blocks = Array.isArray(raw) ? raw : [raw];
            for (const c of blocks) {
                if (!c || !c.set) continue;
                for (const k of Object.keys(c.set)) {
                    if (!markerVals[k]) markerVals[k] = new Set();
                    markerVals[k].add(c.set[k]);
                }
            }
        }
    }
    // Collapsed values from deriveWhen rules that produce values not present
    // in a node's edges (e.g. `geo_spread` deriving 'multiple').
    for (const node of NODES) {
        if (!node.deriveWhen) continue;
        for (const rule of node.deriveWhen) {
            if (rule.value === undefined) continue;
            if (!markerVals[node.id]) markerVals[node.id] = new Set();
            markerVals[node.id].add(rule.value);
        }
    }
    for (const k of Object.keys(markerVals)) {
        let v2i = _valToIdx[k];
        let i2v = _idxToVal[k];
        if (!v2i) {
            v2i = Object.create(null);
            i2v = [undefined];
            _valToIdx[k] = v2i;
            _idxToVal[k] = i2v;
        }
        for (const val of markerVals[k]) {
            if (v2i[val]) continue;
            v2i[val] = i2v.length;
            i2v.push(val);
        }
    }

    const derivedDims = new Set();
    for (const node of NODES) {
        if (node.deriveWhen) derivedDims.add(node.id);
    }
    const compileRule = (rule) => {
        if (!rule.match) { rule._mk = null; rule._direct = true; return; }
        const keys = [], types = [], vals = [];
        let allDirect = true;
        for (const k of Object.keys(rule.match)) {
            const v = rule.match[k];
            keys.push(k);
            if (derivedDims.has(k)) allDirect = false;
            if (v === true) { types.push(_MT); vals.push(null); }
            else if (v === false) { types.push(_MF); vals.push(null); }
            else if (v && typeof v === 'object' && !Array.isArray(v) && v.not) { types.push(_MN); vals.push(v.not); }
            else if (Array.isArray(v)) { types.push(_MA); vals.push(v); }
            else { types.push(_ME); vals.push(v); }
        }
        rule._mk = keys; rule._mt = types; rule._mv = vals;
        rule._direct = allDirect;
    };
    const compileCond = (cond) => {
        const keys = [], types = [], vals = [];
        let allDirect = true;
        for (const k of Object.keys(cond)) {
            if (k === 'reason' || k.startsWith('_')) continue;
            const v = cond[k];
            keys.push(k);
            if (derivedDims.has(k)) allDirect = false;
            if (v === true) { types.push(_CT); vals.push(null); }
            else if (v === false) { types.push(_CF); vals.push(null); }
            else if (v && typeof v === 'object' && !Array.isArray(v) && v.not) {
                types.push(v.required ? _CR : _CN);
                vals.push(v.not);
            }
            else { types.push(_CI); vals.push(Array.isArray(v) ? v : [v]); }
        }
        cond._ck = keys; cond._ct = types; cond._cv = vals;
        cond._direct = allDirect;
    };
    for (const node of NODES) {
        if (node.deriveWhen) {
            const dw = node.deriveWhen;
            node._dwLen = dw.length;
            for (let i = 0; i < dw.length; i++) compileRule(dw[i]);
        }
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

function matchesDerivation(rule, sel) {
    const keys = rule._mk;
    if (!keys) return true;
    const types = rule._mt, vals = rule._mv;
    if (rule._direct) {
        for (let i = 0; i < keys.length; i++) {
            const eff = sel[keys[i]];
            switch (types[i]) {
                case _MT: if (!eff) return false; break;
                case _MF: if (eff) return false; break;
                case _MN: if (eff && vals[i].includes(eff)) return false; break;
                case _MA: if (!vals[i].includes(eff)) return false; break;
                case _ME: if (eff !== vals[i]) return false; break;
            }
        }
        return true;
    }
    for (let i = 0; i < keys.length; i++) {
        const eff = resolvedVal(sel, keys[i]);
        switch (types[i]) {
            case _MT: if (!eff) return false; break;
            case _MF: if (eff) return false; break;
            case _MN: if (eff && vals[i].includes(eff)) return false; break;
            case _MA: if (!vals[i].includes(eff)) return false; break;
            case _ME: if (eff !== vals[i]) return false; break;
        }
    }
    return true;
}

function applyDerivations(derivations, sel, k) {
    for (let r = 0; r < derivations.length; r++) {
        const rule = derivations[r];
        if (!matchesDerivation(rule, sel)) continue;
        if (rule.fromState) return resolvedVal(sel, rule.fromState);
        if (rule.valueMap) return rule.valueMap[sel[k]] ?? sel[k];
        return rule.value;
    }
    return undefined;
}

const _computing = Object.create(null);
let _rvCache = null;
function setRvCache(cache) { _rvCache = cache; }

function resolvedVal(sel, k) {
    if (_computing[k]) return sel[k];
    const tbl = _derivTable[k];
    if (tbl) {
        if (_rvCache) {
            const c = _rvCache.get(k);
            if (c !== undefined) return c;
        }
        const result = tbl(sel);
        if (_rvCache && result !== undefined) _rvCache.set(k, result);
        return result !== undefined ? result : sel[k];
    }
    const node = NODE_MAP[k];
    if (node && node.deriveWhen) {
        if (_rvCache) {
            const c = _rvCache.get(k);
            if (c !== undefined) return c;
        }
        _computing[k] = true;
        const result = applyDerivations(node.deriveWhen, sel, k);
        _computing[k] = false;
        if (result !== undefined) {
            if (_rvCache) _rvCache.set(k, result);
            return result;
        }
    }
    return sel[k];
}

// ════════════════════════════════════════════════════════
// Derivation lookup tables (pre-computed at init)
// ════════════════════════════════════════════════════════

function _buildDerivTables() {
    const derivedNodes = NODES.filter(n => n.deriveWhen);
    const derivedSet = new Set(derivedNodes.map(n => n.id));

    function getInputDims(node) {
        const inputs = [];
        let hasValueMap = false;
        for (const rule of node.deriveWhen) {
            if (rule.valueMap) hasValueMap = true;
            if (rule.match) for (const k of Object.keys(rule.match)) {
                if (k !== 'reason' && k !== node.id && !inputs.includes(k)) inputs.push(k);
            }
            if (rule.fromState && rule.fromState !== node.id && !inputs.includes(rule.fromState)) {
                inputs.push(rule.fromState);
            }
        }
        // valueMap rules reference sel[k], so include the dim itself as a raw-value input
        if (hasValueMap && !inputs.includes(node.id)) inputs.push(node.id);
        return inputs;
    }

    // Topological sort so tables for dependencies are built first
    const visited = new Set();
    const topoOrder = [];
    function topoVisit(id) {
        if (visited.has(id)) return;
        visited.add(id);
        const node = NODE_MAP[id];
        if (!node || !node.deriveWhen) return;
        for (const dep of getInputDims(node)) {
            if (derivedSet.has(dep)) topoVisit(dep);
        }
        topoOrder.push(id);
    }
    for (const n of derivedNodes) topoVisit(n.id);

    // Phase 4a: decel_outcome is deleted; decel_align_progress is no
    // longer derived (written directly by the decel module reducer).
    // The JIT chain tables below are therefore obsolete — largeDims is
    // empty (we keep the set as a hook for future large-fanout dims).
    const largeDims = new Set();

    for (const dimId of topoOrder) {
        if (largeDims.has(dimId)) continue;
        const node = NODE_MAP[dimId];
        const inputDims = getInputDims(node);
        const isDerived = inputDims.map(d => derivedSet.has(d) && d !== dimId);

        const sizes = inputDims.map(d => (_idxToVal[d] || [undefined]).length);
        const strides = new Array(inputDims.length);
        let totalSize = 1;
        for (let i = inputDims.length - 1; i >= 0; i--) {
            strides[i] = totalSize;
            totalSize *= sizes[i];
        }

        // Temporarily disable derivation on derived inputs so testSel values are used directly
        const savedDw = {};
        for (let i = 0; i < inputDims.length; i++) {
            if (isDerived[i]) {
                const inp = NODE_MAP[inputDims[i]];
                savedDw[inputDims[i]] = inp.deriveWhen;
                inp.deriveWhen = null;
            }
        }

        _computing[dimId] = true;
        const table = new Uint8Array(totalSize);
        const testSel = {};
        const v2i = _valToIdx[dimId];

        function enumerate(idx, flatIdx) {
            if (idx === inputDims.length) {
                const result = applyDerivations(node.deriveWhen, testSel, dimId);
                if (result !== undefined && v2i[result]) {
                    table[flatIdx] = v2i[result];
                }
                return;
            }
            const dim = inputDims[idx];
            const vals = _idxToVal[dim] || [undefined];
            for (let v = 0; v < vals.length; v++) {
                if (vals[v] === undefined) delete testSel[dim];
                else testSel[dim] = vals[v];
                enumerate(idx + 1, flatIdx + v * strides[idx]);
            }
            delete testSel[dim];
        }
        enumerate(0, 0);

        _computing[dimId] = false;
        for (const [d, dw] of Object.entries(savedDw)) {
            NODE_MAP[d].deriveWhen = dw;
        }

        // Build resolve closure
        const tInputDims = inputDims;
        const tIsDerived = isDerived;
        const tStrides = strides;
        const tTable = table;
        const tI2V = _idxToVal[dimId];
        const tV2Is = inputDims.map(d => _valToIdx[d]);

        _derivTable[dimId] = function(sel) {
            let idx = 0;
            for (let i = 0; i < tInputDims.length; i++) {
                const v = tIsDerived[i] ? resolvedVal(sel, tInputDims[i]) : sel[tInputDims[i]];
                idx += (v !== undefined ? (tV2Is[i][v] || 0) : 0) * tStrides[i];
            }
            const ri = tTable[idx];
            return ri ? tI2V[ri] : undefined;
        };
    }

    // Phase 4a: removed the JIT chain tables for decel_outcome and
    // decel_align_progress. Both were built over the 14 decel_*mo_*
    // dims to collapse the derived chain into a single O(steps) lookup.
    // Post-migration:
    //   * decel_outcome no longer exists — decel module writes alignment/
    //     geo_spread/rival_emerges/governance/containment directly.
    //   * decel_align_progress is written directly by the module reducer
    //     (collapseToFlavor.set) and needs no derivation — resolvedVal
    //     reads it from sel.
}
_buildDerivTables();

// ════════════════════════════════════════════════════════
// Activation engine (generic isNodeVisible)
// ════════════════════════════════════════════════════════

function matchCondition(sel, cond) {
    const keys = cond._ck;
    if (!keys) {
        for (const [k, allowed] of Object.entries(cond)) {
            if (k === 'reason') continue;
            const v = resolvedVal(sel, k);
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
    if (cond._direct) {
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
    for (let i = 0; i < keys.length; i++) {
        const v = resolvedVal(sel, keys[i]);
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

// "Actively pending" = module pending AND at least one internal is
// currently askable (passes its own activateWhen + hideWhen). A module
// can be in a pending state but have no internals askable right now
// (e.g. waiting on a derived dim from another module); in that case
// it doesn't block external nodes.
//
// Uses a shallow activation check (activateWhen + hideWhen only, no
// priority-gate, no isNodeVisible recursion) to avoid infinite loops
// when `isNodeActivatedByRules` calls back here.
function _isModuleActivelyPending(sel, mod) {
    if (!_isModulePending(sel, mod)) return false;
    for (const nid of (mod.nodeIds || [])) {
        const n = NODE_MAP[nid];
        if (!n || n.derived) continue;
        if (sel[n.id] !== undefined) continue;
        if (n.activateWhen && !n.activateWhen.some(c => matchCondition(sel, c))) continue;
        if (n.hideWhen && n.hideWhen.some(c => matchCondition(sel, c))) continue;
        return true;
    }
    return false;
}

// Shallow askability — activate matched, hide not matched, unanswered,
// has at least one enabled edge. NO recursion into isNodeVisible /
// isNodeActivatedByRules (those would create mutual recursion through
// the priority gate). Mirrors the gates `_isModuleActivelyPending` uses.
function _shallowAskable(sel, n) {
    if (n.derived) return false;
    if (sel[n.id] !== undefined) return false;
    if (!n.edges || n.edges.length === 0) return false;
    if (n.activateWhen && !n.activateWhen.some(c => matchCondition(sel, c))) return false;
    if (n.hideWhen && n.hideWhen.some(c => matchCondition(sel, c))) return false;
    if (!n.edges.some(e => !isEdgeDisabled(sel, n, e))) return false;
    return true;
}

function isNodeActivatedByRules(sel, node) {
    if (!node.activateWhen) return true;
    if (!node.activateWhen.some(c => matchCondition(sel, c))) return false;

    const pri = node.priority || 0;
    const imAModuleInternal = !!node.module;

    // Priority-first scheduling, ties → modules:
    //   - Defer if ANY shallow-askable node has STRICTLY LOWER priority
    //     number (lower pri# = fires first).
    //   - At the same priority, a flat (non-module) node defers to any
    //     active-module-internal (tie goes to modules). Module walks
    //     stay contiguous at their priority level because nothing inside
    //     the module has a lower priority, and same-priority externals
    //     defer to the module.
    //
    // Uses shallow askability (no isNodeVisible recursion) to avoid
    // mutual recursion through this priority gate.
    for (const mid of NODES) {
        if (mid === node) continue;
        if (!_shallowAskable(sel, mid)) continue;
        const midPri = mid.priority || 0;
        if (midPri < pri) return false;
        if (midPri === pri && !imAModuleInternal && mid.module) {
            const otherMod = MODULE_MAP[mid.module];
            if (otherMod && _isModulePending(sel, otherMod)) return false;
        }
    }
    return true;
}

function isNodeActivated(sel, node) {
    if (node.hideWhen) {
        for (const cond of node.hideWhen) {
            if (matchCondition(sel, cond)) return false;
        }
    }
    return isNodeActivatedByRules(sel, node);
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

function cleanSelection(sel, flavor) {
    if (!flavor) flavor = {};
    for (let pass = 0; pass < 6; pass++) {
        let changed = false;
        // Edge-validity checks read from a fused view (flavor underlaid,
        // sel wins). Once a dim is moved to flavor it's still a "locked-in
        // answer" — downstream requires/disabledWhen that reference it must
        // continue to evaluate against its known value, not treat it as
        // undefined. Without this, moving e.g. response_success to flavor
        // would delete catch_outcome from sel on the next pass because its
        // requires clause references response_success.
        const fused = {};
        for (const k of Object.keys(flavor)) fused[k] = flavor[k];
        for (const k of Object.keys(sel)) fused[k] = sel[k];
        for (const node of NODES) {
            if (!isNodeVisible(fused, node)) continue;
            if (sel[node.id]) {
                const edge = node.edges && node.edges.find(v => v.id === sel[node.id]);
                if (edge && isEdgeDisabled(fused, node, edge)) {
                    delete sel[node.id];
                    changed = true;
                }
            }
        }
        // Apply collapseToFlavor: move certain dims from sel to flavor when
        // an edge declares it. Narrative-preserving state collapse.
        //
        // An edge may declare either a single collapse block (object form) or
        // an array of blocks, each with its own optional `when` gate. Array
        // form is used when the collapse values depend on current sel (e.g.
        // decel terminating edges that set decel_outcome based on the current
        // decel_Xmo_progress value). Blocks are tried in order; each whose
        // `when` matches applies its set/move/setFlavor independently.
        for (const node of NODES) {
            if (!sel[node.id]) continue;
            const edge = node.edges && node.edges.find(v => v.id === sel[node.id]);
            if (!edge || !edge.collapseToFlavor) continue;
            const blocks = Array.isArray(edge.collapseToFlavor) ? edge.collapseToFlavor : [edge.collapseToFlavor];
            for (const c of blocks) {
                // Optional gate: collapse applies only when the current sel matches
                // `when`. Used for subtree-conditional moves (e.g. move open_source
                // to flavor only when distribution=concentrated at sovereignty.lab —
                // preserves it in the distribution=monopoly subtree where decel
                // chain still reads it).
                if (c.when && !matchCondition(sel, c.when)) continue;
                // set runs before move so that blocks which bake a derived
                // value from a dim they then move (e.g. set decel_align_progress
                // from decel_Xmo_progress, then move decel_Xmo_progress) read the
                // dim while it's still in sel.
                if (c.set) {
                    for (const k of Object.keys(c.set)) {
                        if (sel[k] !== c.set[k]) {
                            sel[k] = c.set[k];
                            changed = true;
                        }
                    }
                }
                if (c.setFlavor) {
                    for (const k of Object.keys(c.setFlavor)) {
                        if (flavor[k] !== c.setFlavor[k]) {
                            flavor[k] = c.setFlavor[k];
                            changed = true;
                        }
                    }
                }
                if (c.move) {
                    for (const moveDim of c.move) {
                        if (sel[moveDim] !== undefined) {
                            flavor[moveDim] = sel[moveDim];
                            delete sel[moveDim];
                            changed = true;
                        }
                    }
                }
            }
        }
        if (!changed) break;
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
        if (!isNodeVisible(sel, node)) {
            if (node.deriveWhen) {
                const derived = applyDerivations(node.deriveWhen, sel, node.id);
                if (derived !== undefined) d[node.id] = derived;
            }
            continue;
        }
        const ev = resolvedVal(sel, node.id);
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
//     "NOT (containment=escaped AND ai_goals ∈ HOSTILE)".
function _notRejects(notSpec, state) {
    if (!notSpec) return false;
    if (Array.isArray(notSpec)) {
        for (const conj of notSpec) {
            let allMatch = true;
            for (const [k, vals] of Object.entries(conj)) {
                if (!state[k] || !vals.includes(state[k])) { allMatch = false; break; }
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

function displayOrder(stack) {
    const state = currentState(stack);
    const answered = [];
    const answeredSet = new Set();

    for (const entry of stack) {
        if (!entry.nodeId) continue;
        const node = NODE_MAP[entry.nodeId];
        if (!node || node.derived) continue;
        answered.push(node);
        answeredSet.add(entry.nodeId);
    }

    const unanswered = [];
    for (const node of NODES) {
        if (node.derived || !isNodeVisible(state, node) || answeredSet.has(node.id)) continue;
        unanswered.push(node);
    }

    return answered.concat(unanswered);
}

// Legacy wrappers kept for validator internals

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
        matchCondition, resolvedVal, setRvCache, isNodeVisible, isNodeActivatedByRules, isNodeLocked, isEdgeDisabled, getEdgeDisabledReason,
        cleanSelection, resolvedState, resolvedStateWithFlavor,
        templateMatches, templatePartialMatch, resolveContextWhen, resolveQuestionText, resolveShortQuestionText, resolveShortQuestionContext,
        createStack, push, pop, popTo, currentState, currentFlavor, currentModuleStack, currentModuleFrame, narrativeState, stackHas, displayOrder };
}
if (typeof window !== 'undefined') {
    window.Engine = { NODES, NODE_MAP, MODULES, MODULE_MAP,
        matchCondition, resolvedVal, setRvCache, isNodeVisible, isNodeLocked, isEdgeDisabled, getEdgeDisabledReason,
        cleanSelection, resolvedState, resolvedStateWithFlavor,
        templateMatches, templatePartialMatch, resolveContextWhen, resolveQuestionText, resolveShortQuestionText, resolveShortQuestionContext,
        createStack, push, pop, popTo, currentState, currentFlavor, currentModuleStack, currentModuleFrame, narrativeState, stackHas, displayOrder };
}

})();
