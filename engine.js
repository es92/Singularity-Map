// Singularity Map — Engine
// Interprets the declarative graph rules defined in graph.js.
// Handles derivations, activation, locking, state management, and template matching.

(function() {

const { SCENARIO, NODES, NODE_MAP } = (typeof module !== 'undefined' && module.exports)
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

    const largeDims = new Set(['decel_outcome', 'decel_align_progress']);

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

    // Chain tables for decel_outcome and decel_align_progress (production graph only)
    if (!NODE_MAP['decel_outcome'] || !NODE_MAP['decel_align_progress']) return;
    const steps = [
        ['decel_2mo_action', 'decel_2mo_progress'],
        ['decel_4mo_action', 'decel_4mo_progress'],
        ['decel_6mo_action', 'decel_6mo_progress'],
        ['decel_9mo_action', 'decel_9mo_progress'],
        ['decel_12mo_action', 'decel_12mo_progress'],
        ['decel_18mo_action', 'decel_18mo_progress'],
        ['decel_24mo_action', 'decel_24mo_progress'],
    ];

    // decel_outcome: per-step 2D tables [actionIdx * pStride + progressIdx] -> resultIdx
    const outcomeNode = NODE_MAP['decel_outcome'];
    const outcomeI2V = _idxToVal['decel_outcome'];
    const outcomeV2I = _valToIdx['decel_outcome'];
    const oStepTables = [];
    const oActionDims = [];
    const oProgressDims = [];
    const oActionV2I = [];
    const oPStrides = [];

    for (const [actionDim, progressDim] of steps) {
        oActionDims.push(actionDim);
        oProgressDims.push(progressDim);
        oActionV2I.push(_valToIdx[actionDim]);
        const aVals = _idxToVal[actionDim];
        const pVals = _idxToVal[progressDim];
        const pStride = pVals.length;
        oPStrides.push(pStride);

        const tbl = new Uint8Array(aVals.length * pVals.length);
        for (let a = 0; a < aVals.length; a++) {
            for (let p = 0; p < pVals.length; p++) {
                const testSel = {};
                if (aVals[a]) testSel[actionDim] = aVals[a];
                if (pVals[p]) testSel[progressDim] = pVals[p];
                const result = applyDerivations(outcomeNode.deriveWhen, testSel, 'decel_outcome');
                if (result && outcomeV2I[result]) {
                    tbl[a * pStride + p] = outcomeV2I[result];
                }
            }
        }
        oStepTables.push(tbl);
    }

    _derivTable['decel_outcome'] = function(sel) {
        for (let s = 0; s < 7; s++) {
            const action = sel[oActionDims[s]];
            if (!action) continue;
            const aIdx = oActionV2I[s][action];
            if (!aIdx) continue;
            const progress = sel[oProgressDims[s]];
            const pIdx = progress ? (_valToIdx[oProgressDims[s]][progress] || 0) : 0;
            const ri = oStepTables[s][aIdx * oPStrides[s] + pIdx];
            if (ri) return outcomeI2V[ri];
        }
        return undefined;
    };

    // decel_align_progress: per-step action match sets
    const alignNode = NODE_MAP['decel_align_progress'];
    const alignActionSets = [];

    for (const [actionDim, progressDim] of steps) {
        const matching = new Set();
        for (const rule of alignNode.deriveWhen) {
            if (!rule.match) continue;
            const vals = rule.match[actionDim];
            if (vals && Array.isArray(vals)) for (const v of vals) matching.add(v);
        }
        alignActionSets.push(matching);
    }

    _derivTable['decel_align_progress'] = function(sel) {
        for (let s = 0; s < 7; s++) {
            const action = sel[steps[s][0]];
            if (action && alignActionSets[s].has(action)) {
                return sel[steps[s][1]];
            }
        }
        return undefined;
    };
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

function isNodeActivatedByRules(sel, node) {
    if (!node.activateWhen) return true;
    if (!node.activateWhen.some(c => matchCondition(sel, c))) return false;
    const pri = node.priority || 0;
    if (pri > 0) {
        const nodeIdx = NODES.indexOf(node);
        for (let i = 0; i < nodeIdx; i++) {
            const mid = NODES[i];
            if ((mid.priority || 0) >= pri) continue;
            if (mid.derived) continue;
            if (!isNodeVisible(sel, mid)) continue;
            if (isNodeLocked(sel, mid) !== null) continue;
            if (!sel[mid.id]) return false;
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

function cleanSelection(sel, { autoForce = true } = {}) {
    const autoForced = new Set();
    for (let pass = 0; pass < 5; pass++) {
        let changed = false;
        for (const node of NODES) {
            if (autoForced.has(node.id) && !isNodeActivated(sel, node)) {
                const hidden = node.hideWhen && node.hideWhen.some(c => matchCondition(sel, c));
                if (hidden) {
                    delete sel[node.id];
                    autoForced.delete(node.id);
                    changed = true;
                    continue;
                }
                autoForced.delete(node.id);
                continue;
            }
            if (!isNodeVisible(sel, node)) continue;
            if (autoForce) {
                const locked = isNodeLocked(sel, node);
                if (locked !== null) {
                    if (sel[node.id] !== locked) {
                        sel[node.id] = locked;
                        changed = true;
                    }
                    autoForced.add(node.id);
                    continue;
                }
                autoForced.delete(node.id);
            }
            if (sel[node.id]) {
                const edge = node.edges && node.edges.find(v => v.id === sel[node.id]);
                if (edge && isEdgeDisabled(sel, node, edge)) {
                    delete sel[node.id];
                    changed = true;
                }
            }
        }
        if (!changed) break;
    }
    return sel;
}


function resolvedState(sel) {
    const d = {};
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

// ════════════════════════════════════════════════════════
// Template matching
// ════════════════════════════════════════════════════════

function templateMatches(t, state) {
    if (!t.reachable) return true;
    return t.reachable.some(cond => {
        for (const [k, allowed] of Object.entries(cond)) {
            if (k === '_not') continue;
            if (!state[k] || !allowed.includes(state[k])) return false;
        }
        if (cond._not) {
            for (const [k, excluded] of Object.entries(cond._not)) {
                if (state[k] && excluded.includes(state[k])) return false;
            }
        }
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
        if (cond._not) {
            for (const [k, excluded] of Object.entries(cond._not)) {
                if (state[k] && excluded.includes(state[k])) return false;
            }
        }
        return true;
    });
}

// ════════════════════════════════════════════════════════
// Immutable answer stack
// ════════════════════════════════════════════════════════

function createStack() {
    const state = {};
    cleanSelection(state);
    return [{ nodeId: null, edgeId: null, state }];
}

function push(stack, nodeId, edgeId, { autoForce = true } = {}) {
    const existingIdx = stack.findIndex(e => e.nodeId === nodeId);
    const base = existingIdx > 0 ? stack.slice(0, existingIdx) : stack;

    const prev = base[base.length - 1].state;
    const next = { ...prev };
    next[nodeId] = edgeId;
    cleanSelection(next, { autoForce });
    return [...base, { nodeId, edgeId, state: next }];
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
            if (matchCondition(sel, entry.when)) return entry.questionContext;
        }
    }
    return (narr && narr.questionContext) || '';
}

// ════════════════════════════════════════════════════════
// Exports
// ════════════════════════════════════════════════════════

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { NODES, NODE_MAP,
        matchCondition, resolvedVal, setRvCache, isNodeVisible, isNodeActivatedByRules, isNodeLocked, isEdgeDisabled, getEdgeDisabledReason,
        cleanSelection, resolvedState,
        templateMatches, templatePartialMatch, resolveContextWhen,
        createStack, push, pop, popTo, currentState, stackHas, displayOrder };
}
if (typeof window !== 'undefined') {
    window.Engine = { NODES, NODE_MAP,
        matchCondition, resolvedVal, setRvCache, isNodeVisible, isNodeLocked, isEdgeDisabled, getEdgeDisabledReason,
        cleanSelection, resolvedState,
        templateMatches, templatePartialMatch, resolveContextWhen,
        createStack, push, pop, popTo, currentState, stackHas, displayOrder };
}

})();
