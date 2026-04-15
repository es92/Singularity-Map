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

function _precompile() {
    const compileRule = (rule) => {
        if (!rule.match) { rule._mk = null; return; }
        const keys = [], types = [], vals = [];
        for (const k of Object.keys(rule.match)) {
            const v = rule.match[k];
            keys.push(k);
            if (v === true) { types.push(_MT); vals.push(null); }
            else if (v === false) { types.push(_MF); vals.push(null); }
            else if (v && typeof v === 'object' && !Array.isArray(v) && v.not) { types.push(_MN); vals.push(v.not); }
            else if (Array.isArray(v)) { types.push(_MA); vals.push(v); }
            else { types.push(_ME); vals.push(v); }
        }
        rule._mk = keys; rule._mt = types; rule._mv = vals;
    };
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
        if (node.deriveWhen) for (const rule of node.deriveWhen) compileRule(rule);
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
    for (const rule of derivations) {
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
                delete sel[node.id];
                autoForced.delete(node.id);
                changed = true;
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
        matchCondition, resolvedVal, isNodeVisible, isNodeLocked, isEdgeDisabled, getEdgeDisabledReason,
        resolvedState,
        templateMatches, templatePartialMatch, resolveContextWhen,
        createStack, push, pop, popTo, currentState, stackHas, displayOrder };
}

})();
