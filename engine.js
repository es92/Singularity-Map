// Singularity Map — Engine
// Interprets the declarative dimension rules defined in dimensions.js.
// Handles overrides, activation, locking, state management, and template matching.

(function() {

const { SCENARIO, DIMENSIONS, DIM_MAP, EFFECTIVE_EXCLUSIONS } = (typeof module !== 'undefined' && module.exports)
    ? require('./dimensions.js') : window.Dimensions;

// ════════════════════════════════════════════════════════
// Override engine (declarative)
// ════════════════════════════════════════════════════════

function matchesOverride(rule, sel) {
    if (rule.when) {
        for (const [key, val] of Object.entries(rule.when)) {
            if (sel[key] !== val) return false;
        }
    }
    if (rule.whenSet && !sel[rule.whenSet]) return false;
    if (rule.effective) {
        for (const [key, val] of Object.entries(rule.effective)) {
            const eff = effectiveVal(sel, key);
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

function applyOverrides(overrides, sel, k) {
    for (const rule of overrides) {
        if (!matchesOverride(rule, sel)) continue;
        if (rule.fromDim) return sel[rule.fromDim];
        if (rule.valueMap) return rule.valueMap[sel[k]] ?? sel[k];
        return rule.value;
    }
    return undefined;
}

function effectiveVal(sel, k) {
    const dim = DIM_MAP[k];
    if (dim && dim.overrides) {
        const result = applyOverrides(dim.overrides, sel, k);
        if (result !== undefined) return result;
    }
    return sel[k];
}

// ════════════════════════════════════════════════════════
// Activation engine (generic isDimVisible)
// ════════════════════════════════════════════════════════

const HIDE_FLAG_RULES = (SCENARIO && SCENARIO.hideConditions || []).map(hc => ({
    dims: new Set(DIMENSIONS.filter(d => d[hc.flag]).map(d => d.id)),
    when: hc.when,
}));

const TERM_SET = new Set(DIMENSIONS.filter(d => d.terminal).map(d => d.id));

const CUSTOM_CHECKS = {
    allPrecedingAnswered(sel, dim, cond) {
        const brIdx = DIMENSIONS.indexOf(dim);
        const anchor = cond && cond._fnAnchor;
        const adIdx = anchor ? DIMENSIONS.findIndex(d => d.id === anchor) : 0;
        for (let i = adIdx + 1; i < brIdx; i++) {
            const mid = DIMENSIONS[i];
            if (mid.terminal || mid.virtual) continue;
            if (!isDimVisible(sel, mid)) continue;
            if (isDimLocked(sel, mid) !== null) continue;
            if (!sel[mid.id]) return false;
        }
        return true;
    },
};

function matchCondition(sel, cond, dim) {
    if (cond._notSet) {
        for (const k of cond._notSet) {
            if (effectiveVal(sel, k) != null) return false;
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
            const v = effectiveVal(sel, k);
            if (!v || !allowed.includes(v)) return false;
        }
    }
    if (cond._effNot) {
        for (const [k, excluded] of Object.entries(cond._effNot)) {
            const v = effectiveVal(sel, k);
            if (v && excluded.includes(v)) return false;
        }
    }
    const rawUnlessActive = dim.useRawUnless ? effectiveVal(sel, dim.useRawUnless) != null : false;
    for (const [k, allowed] of Object.entries(cond)) {
        if (k.startsWith('_')) continue;
        const useRaw = dim.useRawFor && dim.useRawFor.includes(k)
            && (!dim.useRawUnless || !rawUnlessActive);
        const v = useRaw ? sel[k] : effectiveVal(sel, k);
        if (!v || !allowed.includes(v)) return false;
    }
    if (cond._fn && !CUSTOM_CHECKS[cond._fn](sel, dim, cond)) return false;
    return true;
}

function isDimActivated(sel, dim) {
    for (const rule of HIDE_FLAG_RULES) {
        if (rule.dims.has(dim.id) && matchCondition(sel, rule.when, {})) return false;
    }
    if (!dim.activateWhen) return true;
    return dim.activateWhen.some(c => matchCondition(sel, c, dim));
}

function isDimVisible(sel, dim) {
    if (dim.suppressWhen && dim.suppressWhen.some(c => matchCondition(sel, c, dim))) return false;
    if (sel[dim.id]) return true;
    return isDimActivated(sel, dim);
}

// ════════════════════════════════════════════════════════
// Locking and disabling
// ════════════════════════════════════════════════════════

function isDimLocked(sel, dim) {
    if (dim.lockedWhen) {
        for (const rule of dim.lockedWhen) {
            if (matchCondition(sel, rule.when, {})) {
                if (rule.soft && sel[dim.id] && sel[dim.id] !== rule.value) continue;
                return rule.value;
            }
        }
    }
    if (!dim.values) return null;
    const enabled = dim.values.filter(v => !isValueDisabled(sel, dim, v));
    return enabled.length === 1 ? enabled[0].id : null;
}

function isValueDisabled(sel, dim, val) {
    if (val.disabledWhen) {
        for (const cond of val.disabledWhen) {
            if (matchCondition(sel, cond, {})) return true;
        }
    }
    if (!val.requires) return false;
    const condSets = Array.isArray(val.requires) ? val.requires : [val.requires];
    return condSets.every(conds => {
        for (const [k, allowed] of Object.entries(conds)) {
            const v = effectiveVal(sel, k);
            if (v && !allowed.includes(v)) return true;
        }
        return false;
    });
}

// ════════════════════════════════════════════════════════
// State management
// ════════════════════════════════════════════════════════

function cleanSelection(sel) {
    for (let pass = 0; pass < 5; pass++) {
        let changed = false;
        for (const dim of DIMENSIONS) {
            if (!isDimVisible(sel, dim)) {
                if (sel[dim.id] !== undefined) { delete sel[dim.id]; changed = true; }
                continue;
            }
            const locked = isDimLocked(sel, dim);
            if (locked !== null) {
                if (sel[dim.id] !== locked) { sel[dim.id] = locked; changed = true; }
                continue;
            }
            if (sel[dim.id]) {
                const val = dim.values.find(v => v.id === sel[dim.id]);
                if (val && isValueDisabled(sel, dim, val)) { delete sel[dim.id]; changed = true; }
            }
        }
        if (!changed) break;
    }
    return sel;
}

function applySelection(sel, dimId, newValue) {
    const dim = DIM_MAP[dimId];
    if (!dim) return;
    const idx = DIMENSIONS.indexOf(dim);

    const savedUpstream = {};
    for (let i = 0; i < idx; i++) {
        const id = DIMENSIONS[i].id;
        if (sel[id] !== undefined) savedUpstream[id] = sel[id];
    }

    if (sel[dimId] === newValue) {
        delete sel[dimId];
        for (let pass = 0; pass < 5; pass++) {
            let changed = false;
            for (let i = idx + 1; i < DIMENSIONS.length; i++) {
                const d = DIMENSIONS[i];
                if (sel[d.id] === undefined) continue;
                const saved = sel[d.id];
                delete sel[d.id];
                if (isDimVisible(sel, d)) {
                    sel[d.id] = saved;
                } else {
                    changed = true;
                }
            }
            if (!changed) break;
        }
    } else {
        const hadValue = sel[dimId] !== undefined;
        const wasZombie = new Set();
        if (hadValue) {
            for (let i = idx + 1; i < DIMENSIONS.length; i++) {
                const d = DIMENSIONS[i];
                if (sel[d.id] === undefined) continue;
                const saved = sel[d.id];
                delete sel[d.id];
                if (!isDimVisible(sel, d)) wasZombie.add(d.id);
                sel[d.id] = saved;
            }
        }
        sel[dimId] = newValue;
        if (hadValue) {
            for (let round = 0; round < 3; round++) {
                for (let pass = 0; pass < 5; pass++) {
                    let changed = false;
                    for (let i = idx + 1; i < DIMENSIONS.length; i++) {
                        const d = DIMENSIONS[i];
                        if (sel[d.id] === undefined) continue;
                        if (wasZombie.has(d.id)) continue;
                        const saved = sel[d.id];
                        delete sel[d.id];
                        if (isDimVisible(sel, d)) {
                            sel[d.id] = saved;
                        } else {
                            changed = true;
                        }
                    }
                    if (!changed) break;
                }
                const snapshot = DIMENSIONS.map(d => sel[d.id]);
                cleanSelection(sel);
                if (DIMENSIONS.every((d, i) => sel[d.id] === snapshot[i])) break;
            }
        }
    }

    for (let i = 0; i < idx; i++) {
        const id = DIMENSIONS[i].id;
        if (id in savedUpstream) {
            sel[id] = savedUpstream[id];
        } else {
            delete sel[id];
        }
    }
}

function effectiveDims(sel) {
    const d = {};
    for (const dim of DIMENSIONS) {
        if (!isDimVisible(sel, dim)) continue;
        const ev = effectiveVal(sel, dim.id);
        if (ev) { d[dim.id] = ev; continue; }
        const locked = isDimLocked(sel, dim);
        if (locked !== null) d[dim.id] = locked;
    }
    for (const rule of EFFECTIVE_EXCLUSIONS) {
        if (rule.when && !matchCondition(sel, rule.when, {})) continue;
        if (rule.unlessEffective && rule.unlessEffective.some(id => d[id])) continue;
        const hasPending = rule.anyPending.some(id => {
            const dim = DIM_MAP[id];
            return dim && isDimVisible(sel, dim) && isDimLocked(sel, dim) === null && !sel[id];
        });
        if (hasPending) {
            for (const id of rule.exclude) delete d[id];
        }
    }
    return d;
}

// ════════════════════════════════════════════════════════
// Template matching
// ════════════════════════════════════════════════════════

function templateMatches(t, dims) {
    if (!t.reachable) return true;
    return t.reachable.some(cond => {
        for (const [k, allowed] of Object.entries(cond)) {
            if (!dims[k] || !allowed.includes(dims[k])) return false;
        }
        return true;
    });
}

function templatePartialMatch(t, dims) {
    if (!t.reachable) return true;
    return t.reachable.some(cond => {
        for (const [k, allowed] of Object.entries(cond)) {
            if (dims[k] && !allowed.includes(dims[k])) return false;
        }
        return true;
    });
}

// ════════════════════════════════════════════════════════
// Render positioning
// ════════════════════════════════════════════════════════

function getRenderAfter(sel, dim) {
    if (!dim.renderAfter) return null;
    for (const rule of dim.renderAfter) {
        let match = true;
        for (const [k, v] of Object.entries(rule.when)) {
            if (sel[k] !== v) { match = false; break; }
        }
        if (match) return rule.after;
    }
    return null;
}

// ════════════════════════════════════════════════════════
// Exports
// ════════════════════════════════════════════════════════

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { DIMENSIONS, DIM_MAP,
        matchesOverride, applyOverrides, effectiveVal, isDimVisible, isDimLocked, isValueDisabled,
        cleanSelection, applySelection, effectiveDims, templateMatches, templatePartialMatch, getRenderAfter };
}
if (typeof window !== 'undefined') {
    window.Engine = { DIMENSIONS, DIM_MAP,
        matchesOverride, applyOverrides, effectiveVal, isDimVisible, isDimLocked, isValueDisabled,
        cleanSelection, applySelection, effectiveDims, templateMatches, templatePartialMatch, getRenderAfter };
}

})();
