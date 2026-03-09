// Singularity Map — Engine
// Interprets the declarative dimension rules defined in dimensions.js.
// Handles overrides, activation, locking, state management, and template matching.

(function() {

const { DIMENSIONS, DIM_MAP } = (typeof module !== 'undefined' && module.exports)
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

const HIDE_AFTER_ESCAPE = new Set([
    'proliferation_control', 'proliferation_outcome', 'block_entrants', 'block_outcome',
    'new_entrants', 'rival_dynamics', 'enabled_aims', 'intent', 'failure_mode',
    'knowledge_replacement', 'physical_automation', 'brittle_resolution'
]);

function isEscapedNonMarginal(sel) {
    return sel.ai_goals && sel.ai_goals !== 'marginal' && effectiveVal(sel, 'alignment') === 'failed';
}

const TERM_SET = new Set(DIMENSIONS.filter(d => d.terminal).map(d => d.id));

const CUSTOM_CHECKS = {
    allPrecedingAnswered(sel, dim) {
        const brIdx = DIMENSIONS.indexOf(dim);
        const adIdx = DIMENSIONS.findIndex(d => d.id === 'alignment_durability');
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
    const decelActive = dim.useRawUnlessDecel ? effectiveVal(sel, 'decel_outcome') != null : false;
    for (const [k, allowed] of Object.entries(cond)) {
        if (k.startsWith('_')) continue;
        const useRaw = dim.useRawFor && dim.useRawFor.includes(k)
            && (!dim.useRawUnlessDecel || !decelActive);
        const v = useRaw ? sel[k] : effectiveVal(sel, k);
        if (!v || !allowed.includes(v)) return false;
    }
    if (cond._fn && !CUSTOM_CHECKS[cond._fn](sel, dim)) return false;
    return true;
}

function isDimActivated(sel, dim) {
    if (isEscapedNonMarginal(sel) && HIDE_AFTER_ESCAPE.has(dim.id)) return false;
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
    if (dim.id === 'gov_action' && sel.alignment === 'robust' && effectiveVal(sel, 'decel_outcome') == null) return 'accelerate';
    if (dim.id === 'containment') {
        if (sel.brittle_resolution === 'escape') return 'escaped';
        if (sel.brittle_resolution === 'solved' || sel.brittle_resolution === 'sufficient') {
            if (!sel.containment || sel.containment === 'contained') return 'contained';
        }
        if (effectiveVal(sel, 'decel_outcome') === 'escapes') return 'escaped';
        if (effectiveVal(sel, 'alignment') === 'robust') {
            if (!sel.containment || sel.containment === 'contained') return 'contained';
        }
    }
    if (dim.id === 'ai_goals' && sel.alignment === 'brittle' && sel.alignment_durability === 'holds') {
        if (sel.brittle_resolution === 'solved' || sel.brittle_resolution === 'sufficient') {
            if (!sel.ai_goals || sel.ai_goals === 'benevolent') return 'benevolent';
        }
    }
    if (dim.id === 'failure_mode' && sel.enabled_aims === 'proxy') return 'whimper';
    if (!dim.lockedWhen) {
        const enabled = dim.values.filter(v => !isValueDisabled(sel, dim, v));
        return enabled.length === 1 ? enabled[0].id : null;
    }
    for (const [triggerDim, rule] of Object.entries(dim.lockedWhen)) {
        if (effectiveVal(sel, triggerDim) === rule.equals) return rule.value;
    }
    const enabled = dim.values.filter(v => !isValueDisabled(sel, dim, v));
    return enabled.length === 1 ? enabled[0].id : null;
}

function isValueDisabled(sel, dim, val) {
    if (dim.id === 'enabled_aims' && val.id === 'arbitrary') {
        const out = effectiveVal(sel, 'decel_outcome');
        if (['solved', 'parity_solved'].includes(out)) return true;
    }
    if (dim.id === 'intent' && val.id === 'self_interest' && sel.enabled_aims === 'human_centered') return true;
    if (dim.id === 'gov_action' && val.id === 'decelerate' && sel.alignment === 'robust') return true;
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
    if (sel[dimId] === newValue) {
        delete sel[dimId];
        for (let i = idx + 1; i < DIMENSIONS.length; i++) {
            delete sel[DIMENSIONS[i].id];
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
    if (!d.rival_dynamics) {
        const pending = ['rival_dynamics', 'block_entrants', 'block_outcome', 'new_entrants'].some(id => {
            const dim = DIM_MAP[id];
            return dim && isDimVisible(sel, dim) && isDimLocked(sel, dim) === null && !sel[id];
        });
        if (pending) delete d.intent;
    }
    if (sel.ai_goals === 'marginal' && !sel.inert_stays) {
        const iDim = DIM_MAP['inert_stays'];
        if (iDim && isDimVisible(sel, iDim) && isDimLocked(sel, iDim) === null) {
            delete d.intent;
            delete d.ai_goals;
        }
    }
    if (sel.inert_stays === 'no' && !sel.inert_outcome) {
        const ioDim = DIM_MAP['inert_outcome'];
        if (ioDim && isDimVisible(sel, ioDim) && isDimLocked(sel, ioDim) === null) {
            delete d.ai_goals;
        }
    }
    const brDim = DIM_MAP['brittle_resolution'];
    if (brDim && isDimVisible(sel, brDim) && isDimLocked(sel, brDim) === null && !sel.brittle_resolution) {
        delete d.alignment;
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
// Exports
// ════════════════════════════════════════════════════════

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { DIMENSIONS, DIM_MAP,
        matchesOverride, applyOverrides, effectiveVal, isDimVisible, isDimLocked, isValueDisabled,
        cleanSelection, applySelection, effectiveDims, templateMatches, templatePartialMatch };
}
if (typeof window !== 'undefined') {
    window.Engine = { DIMENSIONS, DIM_MAP,
        matchesOverride, applyOverrides, effectiveVal, isDimVisible, isDimLocked, isValueDisabled,
        cleanSelection, applySelection, effectiveDims, templateMatches, templatePartialMatch };
}

})();
