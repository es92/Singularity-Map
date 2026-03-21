// Singularity Map — Engine
// Interprets the declarative graph rules defined in graph.js.
// Handles derivations, activation, locking, state management, and template matching.

(function() {

const { SCENARIO, NODES, NODE_MAP } = (typeof module !== 'undefined' && module.exports)
    ? require('./graph.js') : window.Graph;

// ════════════════════════════════════════════════════════
// Derivation engine (declarative)
// ════════════════════════════════════════════════════════

function matchesDerivation(rule, sel) {
    if (rule.when) {
        for (const [key, val] of Object.entries(rule.when)) {
            if (sel[key] !== val) return false;
        }
    }
    if (rule.whenSet && !sel[rule.whenSet]) return false;
    if (rule.effective) {
        for (const [key, val] of Object.entries(rule.effective)) {
            const eff = resolvedVal(sel, key);
            if (Array.isArray(val) ? !val.includes(eff) : eff !== val) return false;
        }
    }
    if (rule.unless) {
        for (const [key, val] of Object.entries(rule.unless)) {
            if (sel[key] === val) return false;
        }
    }
    return true;
}

function applyDerivations(derivations, sel, k) {
    for (const rule of derivations) {
        if (!matchesDerivation(rule, sel)) continue;
        if (rule.fromDim) return sel[rule.fromDim];
        if (rule.valueMap) return rule.valueMap[sel[k]] ?? sel[k];
        return rule.value;
    }
    return undefined;
}

function resolvedVal(sel, k) {
    const node = NODE_MAP[k];
    if (node && node.derivedFrom) {
        const result = applyDerivations(node.derivedFrom, sel, k);
        if (result !== undefined) return result;
    }
    return sel[k];
}

// ════════════════════════════════════════════════════════
// Activation engine (generic isNodeVisible)
// ════════════════════════════════════════════════════════

const HIDE_FLAG_RULES = (SCENARIO && SCENARIO.hideConditions || []).map(hc => ({
    nodes: new Set(NODES.filter(d => d[hc.flag]).map(d => d.id)),
    when: hc.when,
}));


const CUSTOM_CHECKS = {
    allPrecedingAnswered(sel, node, cond) {
        const brIdx = NODES.indexOf(node);
        const anchor = cond && cond._fnAnchor;
        const adIdx = anchor ? NODES.findIndex(d => d.id === anchor) : 0;
        for (let i = adIdx + 1; i < brIdx; i++) {
            const mid = NODES[i];
            if (mid.terminal || mid.derived) continue;
            if (!isNodeVisible(sel, mid)) continue;
            if (isNodeLocked(sel, mid) !== null) continue;
            if (!sel[mid.id]) return false;
        }
        return true;
    },
};

function matchCondition(sel, cond, node) {
    if (cond._notSet) {
        for (const k of cond._notSet) {
            if (resolvedVal(sel, k) != null) return false;
        }
    }
    if (cond._set) {
        for (const k of cond._set) {
            if (!sel[k]) return false;
        }
    }
    if (cond._raw) {
        for (const [k, allowed] of Object.entries(cond._raw)) {
            if (!sel[k] || !allowed.includes(sel[k])) return false;
        }
    }
    if (cond._rawNot) {
        for (const [k, excluded] of Object.entries(cond._rawNot)) {
            if (sel[k] && excluded.includes(sel[k])) return false;
        }
    }
    if (cond._eff) {
        for (const [k, allowed] of Object.entries(cond._eff)) {
            const v = resolvedVal(sel, k);
            if (!v || !allowed.includes(v)) return false;
        }
    }
    if (cond._effNot) {
        for (const [k, excluded] of Object.entries(cond._effNot)) {
            const v = resolvedVal(sel, k);
            if (v && excluded.includes(v)) return false;
        }
    }
    for (const [k, allowed] of Object.entries(cond)) {
        if (k.startsWith('_')) continue;
        const v = resolvedVal(sel, k);
        if (!v || !allowed.includes(v)) return false;
    }
    if (cond._fn && !CUSTOM_CHECKS[cond._fn](sel, node, cond)) return false;
    return true;
}

function isNodeActivated(sel, node) {
    for (const rule of HIDE_FLAG_RULES) {
        if (rule.nodes.has(node.id) && matchCondition(sel, rule.when, {})) return false;
    }
    if (!node.activateWhen) return true;
    return node.activateWhen.some(c => matchCondition(sel, c, node));
}

function isNodeVisible(sel, node) {
    if (sel[node.id]) {
        if (sel._locked && sel._locked[node.id]) {
            return isNodeActivated(sel, node);
        }
        return true;
    }
    return isNodeActivated(sel, node);
}

// ════════════════════════════════════════════════════════
// Locking and disabling
// ════════════════════════════════════════════════════════

function isNodeLocked(sel, node) {
    if (!node.edges || node.derived) return null;
    const enabled = node.edges.filter(v => !isEdgeDisabled(sel, node, v));
    return enabled.length === 1 ? enabled[0].id : null;
}

function isEdgeDisabled(sel, node, edge) {
    if (edge.disabledWhen) {
        for (const cond of edge.disabledWhen) {
            if (matchCondition(sel, cond, {})) return true;
        }
    }
    if (!edge.requires) return false;
    const condSets = Array.isArray(edge.requires) ? edge.requires : [edge.requires];
    return !condSets.some(cond => matchCondition(sel, cond, {}));
}

// ════════════════════════════════════════════════════════
// State management
// ════════════════════════════════════════════════════════

function cleanSelection(sel) {
    if (!sel._locked) sel._locked = {};
    for (let pass = 0; pass < 5; pass++) {
        let changed = false;
        for (const node of NODES) {
            if (!isNodeVisible(sel, node)) {
                if (sel[node.id] !== undefined) {
                    delete sel[node.id];
                    delete sel._locked[node.id];
                    changed = true;
                }
                continue;
            }
            const locked = isNodeLocked(sel, node);
            if (locked !== null) {
                if (sel[node.id] !== locked) {
                    sel[node.id] = locked;
                    sel._locked[node.id] = true;
                    changed = true;
                }
                continue;
            }
            if (sel._locked[node.id]) {
                delete sel._locked[node.id];
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

function applySelection(sel, nodeId, newValue) {
    if (sel[nodeId] === newValue) {
        delete sel[nodeId];
    } else {
        sel[nodeId] = newValue;
    }
    if (sel._locked) delete sel._locked[nodeId];
    cleanSelection(sel);
}

function resolvedState(sel) {
    const d = {};
    for (const node of NODES) {
        if (!isNodeVisible(sel, node)) continue;
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
            if (!state[k] || !allowed.includes(state[k])) return false;
        }
        return true;
    });
}

function templatePartialMatch(t, state) {
    if (!t.reachable) return true;
    return t.reachable.some(cond => {
        for (const [k, allowed] of Object.entries(cond)) {
            if (state[k] && !allowed.includes(state[k])) return false;
        }
        return true;
    });
}

// ════════════════════════════════════════════════════════
// Display order
// ════════════════════════════════════════════════════════

function getDisplayOrder(sel) {
    const visible = [];
    for (const node of NODES) {
        if (node.derived) continue;
        if (!isNodeVisible(sel, node)) continue;
        visible.push(node);
    }
    return visible;
}

function removeSelection(sel, nodeId) {
    if (sel[nodeId] === undefined) return;
    const idx = NODES.findIndex(n => n.id === nodeId);
    if (idx < 0) return;
    for (let i = idx; i < NODES.length; i++) {
        delete sel[NODES[i].id];
        if (sel._locked) delete sel._locked[NODES[i].id];
    }
    cleanSelection(sel);
}

// ════════════════════════════════════════════════════════
// Exports
// ════════════════════════════════════════════════════════

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { NODES, NODE_MAP,
        matchCondition, matchesDerivation, applyDerivations, resolvedVal, isNodeVisible, isNodeActivated, isNodeLocked, isEdgeDisabled,
        cleanSelection, applySelection, removeSelection, resolvedState,
        templateMatches, templatePartialMatch, getDisplayOrder };
}
if (typeof window !== 'undefined') {
    window.Engine = { NODES, NODE_MAP,
        matchCondition, matchesDerivation, applyDerivations, resolvedVal, isNodeVisible, isNodeActivated, isNodeLocked, isEdgeDisabled,
        cleanSelection, applySelection, removeSelection, resolvedState,
        templateMatches, templatePartialMatch, getDisplayOrder };
}

})();
