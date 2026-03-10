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
// Path helpers (shared between story mode and engine)
// ════════════════════════════════════════════════════════

function collectStepDims(question, answer) {
    const dims = {};
    if (answer.value !== undefined && question.dimension) dims[question.dimension] = answer.value;
    if (answer.sets) Object.assign(dims, answer.sets);
    return dims;
}

function resolveConditionalNext(nextSpec, dims) {
    if (typeof nextSpec === 'string') return { target: nextSpec };
    if (!Array.isArray(nextSpec)) return null;
    for (const route of nextSpec) {
        if (!route.when) return { target: route.target, sets: route.sets };
        const match = Object.entries(route.when).every(([k, allowed]) =>
            dims[k] && allowed.includes(dims[k]));
        if (match) return { target: route.target, sets: route.sets };
    }
    return null;
}

function answerVisible(answer, dims) {
    if (answer.disabledWhen) {
        const dSets = Array.isArray(answer.disabledWhen) ? answer.disabledWhen : [answer.disabledWhen];
        for (const conds of dSets) {
            if (Object.entries(conds).every(([dim, vals]) => {
                const allowed = Array.isArray(vals) ? vals : [vals];
                return dims[dim] && allowed.includes(dims[dim]);
            })) return false;
        }
    }
    if (!answer.requires) return true;
    const condSets = Array.isArray(answer.requires) ? answer.requires : [answer.requires];
    return condSets.some(conds => {
        for (const [dim, allowed] of Object.entries(conds)) {
            if (!dims[dim] || !allowed.includes(dims[dim])) return false;
        }
        return true;
    });
}

// ════════════════════════════════════════════════════════
// Path-based game tree navigation
// ════════════════════════════════════════════════════════

function replayPath(questionsMap, rootId, path) {
    let curId = rootId;
    const dims = {};
    for (let i = 0; i < path.length; i++) {
        const step = path[i];
        if (step.questionId !== curId) return { ok: false, failIndex: i, dims, nextId: curId };
        const q = questionsMap[curId];
        if (!q) return { ok: false, failIndex: i, dims, nextId: curId };
        const a = q.answers[step.answerIndex];
        if (!a) return { ok: false, failIndex: i, dims, nextId: curId };
        if (!answerVisible(a, dims)) return { ok: false, failIndex: i, dims, nextId: curId };
        const stepDims = collectStepDims(q, a);
        Object.assign(dims, stepDims);
        const res = resolveConditionalNext(a.next, dims);
        if (res && res.sets) Object.assign(dims, res.sets);
        curId = res ? res.target : null;
    }
    return { ok: true, dims, nextId: curId };
}

function matchesOutcome(templatesMap, targetId, dims, outcome) {
    if (!outcome) return targetId != null && !!(templatesMap || {})[targetId];
    if (targetId === '__resolve__') {
        const t = (templatesMap || {})[outcome.templateId];
        if (!t) return false;
        if (!templateMatches(t, dims)) return false;
        if (outcome.variantKey && t.primaryDimension) {
            const v = effectiveVal(dims, t.primaryDimension) || dims[t.primaryDimension];
            if (v !== outcome.variantKey) return false;
        }
        return true;
    }
    if (targetId !== outcome.templateId) return false;
    if (outcome.variantKey) {
        const t = (templatesMap || {})[outcome.templateId];
        if (t && t.primaryDimension) {
            const v = effectiveVal(dims, t.primaryDimension) || dims[t.primaryDimension];
            if (v !== outcome.variantKey) return false;
        }
    }
    return true;
}

function dimFingerprint(dims) {
    const keys = Object.keys(dims).sort();
    let fp = '';
    for (const k of keys) fp += k + '=' + dims[k] + '|';
    return fp;
}

function canReachOutcome(questionsMap, templatesMap, questionId, dims, outcome, depth, cache) {
    if (depth <= 0) return false;
    if (!questionId) return false;
    if (!cache) cache = new Map();
    const cacheKey = questionId + '||' + dimFingerprint(dims);
    if (cache.has(cacheKey)) return cache.get(cacheKey);
    const q = questionsMap[questionId];
    if (!q) {
        const result = matchesOutcome(templatesMap, questionId, dims, outcome);
        cache.set(cacheKey, result);
        return result;
    }
    for (const a of q.answers) {
        if (!answerVisible(a, dims)) continue;
        const newDims = { ...dims, ...collectStepDims(q, a) };
        const res = resolveConditionalNext(a.next, newDims);
        if (res && res.sets) Object.assign(newDims, res.sets);
        const nextId = res ? res.target : null;
        if (canReachOutcome(questionsMap, templatesMap, nextId, newDims, outcome, depth - 1, cache)) {
            cache.set(cacheKey, true);
            return true;
        }
    }
    cache.set(cacheKey, false);
    return false;
}

function isValidPathToOutcome(questionsMap, templatesMap, rootId, path, outcome) {
    const cache = new Map();
    const replay = replayPath(questionsMap, rootId, path);
    if (!replay.ok) {
        const validStructural = path.slice(0, replay.failIndex);
        if (!outcome) return { valid: false, prefix: validStructural, dims: replay.dims, nextQuestionId: replay.nextId };
        let bestIdx = -1, bestDims = {}, bestNext = rootId;
        let cur = rootId, accDims = {};
        if (canReachOutcome(questionsMap, templatesMap, rootId, {}, outcome, 100, cache)) {
            bestIdx = -1; bestDims = {}; bestNext = rootId;
        }
        for (let i = 0; i < validStructural.length; i++) {
            const step = validStructural[i];
            const q = questionsMap[cur];
            const a = q.answers[step.answerIndex];
            Object.assign(accDims, collectStepDims(q, a));
            const res = resolveConditionalNext(a.next, accDims);
            if (res && res.sets) Object.assign(accDims, res.sets);
            cur = res ? res.target : null;
            if (canReachOutcome(questionsMap, templatesMap, cur, accDims, outcome, 100, cache)) {
                bestIdx = i; bestDims = { ...accDims }; bestNext = cur;
            }
        }
        const prefix = bestIdx >= 0 ? validStructural.slice(0, bestIdx + 1) : [];
        return { valid: false, prefix, dims: bestIdx >= 0 ? bestDims : {}, nextQuestionId: bestIdx >= 0 ? bestNext : rootId };
    }
    if (!outcome) return { valid: true, prefix: path, dims: replay.dims, nextQuestionId: replay.nextId };
    if (canReachOutcome(questionsMap, templatesMap, replay.nextId, replay.dims, outcome, 100, cache)) {
        return { valid: true, prefix: path, dims: replay.dims, nextQuestionId: replay.nextId };
    }
    let bestIdx = -1, bestDims = {}, bestNext = rootId;
    let cur = rootId, accDims = {};
    if (canReachOutcome(questionsMap, templatesMap, rootId, {}, outcome, 100, cache)) {
        bestIdx = -1; bestDims = {}; bestNext = rootId;
    }
    for (let i = 0; i < path.length; i++) {
        const step = path[i];
        const q = questionsMap[cur];
        const a = q.answers[step.answerIndex];
        Object.assign(accDims, collectStepDims(q, a));
        const res = resolveConditionalNext(a.next, accDims);
        if (res && res.sets) Object.assign(accDims, res.sets);
        cur = res ? res.target : null;
        if (canReachOutcome(questionsMap, templatesMap, cur, accDims, outcome, 100, cache)) {
            bestIdx = i; bestDims = { ...accDims }; bestNext = cur;
        }
    }
    const prefix = bestIdx >= 0 ? path.slice(0, bestIdx + 1) : [];
    return { valid: false, prefix, dims: bestIdx >= 0 ? bestDims : {}, nextQuestionId: bestIdx >= 0 ? bestNext : rootId };
}

function getNextOptions(questionsMap, templatesMap, rootId, path, outcome, cache) {
    if (!cache) cache = new Map();
    const replay = replayPath(questionsMap, rootId, path);
    if (!replay.ok || !replay.nextId) return [];
    const q = questionsMap[replay.nextId];
    if (!q) return [];
    const options = [];
    for (let i = 0; i < q.answers.length; i++) {
        const a = q.answers[i];
        if (!answerVisible(a, replay.dims)) continue;
        if (outcome) {
            const newDims = { ...replay.dims, ...collectStepDims(q, a) };
            const res = resolveConditionalNext(a.next, newDims);
            if (res && res.sets) Object.assign(newDims, res.sets);
            const nextId = res ? res.target : null;
            if (!canReachOutcome(questionsMap, templatesMap, nextId, newDims, outcome, 100, cache)) continue;
        }
        const dimValue = a.value !== undefined ? a.value : (a.sets && q.dimension && a.sets[q.dimension]) || undefined;
        options.push({
            answerIndex: i,
            label: a.label,
            description: a.description || '',
            dimension: q.dimension || null,
            value: dimValue,
            sets: a.sets || null,
            questionId: q.id,
            questionText: q.text,
            timelineEvent: a.timelineEvent || null,
            forced: false
        });
    }
    if (options.length === 1) options[0].forced = true;
    return options;
}

// ════════════════════════════════════════════════════════
// Exports
// ════════════════════════════════════════════════════════

function buildPathFromDims(questionsMap, rootId, dims) {
    const path = [];
    let curId = rootId;
    const walkDims = { ...dims };
    const visited = new Set();
    while (curId && questionsMap[curId] && !visited.has(curId)) {
        visited.add(curId);
        const q = questionsMap[curId];
        let answerIndex = -1;
        if (q.dimension) {
            const dimVal = walkDims[q.dimension];
            if (dimVal) {
                answerIndex = q.answers.findIndex(a =>
                    a.value === dimVal || (a.sets && a.sets[q.dimension] === dimVal));
            }
            if (answerIndex < 0) break;
        } else {
            let bestScore = -1;
            for (let i = 0; i < q.answers.length; i++) {
                const a = q.answers[i];
                if (!answerVisible(a, walkDims)) continue;
                let score = 0;
                if (a.sets) {
                    for (const [k, v] of Object.entries(a.sets)) {
                        if (walkDims[k] === v) score += 2;
                    }
                }
                if (score > bestScore) { bestScore = score; answerIndex = i; }
            }
            if (answerIndex < 0) break;
        }
        const a = q.answers[answerIndex];
        if (!a) break;
        path.push({ questionId: q.id, answerIndex });
        Object.assign(walkDims, collectStepDims(q, a));
        const res = resolveConditionalNext(a.next, walkDims);
        if (res && res.sets) Object.assign(walkDims, res.sets);
        curId = res ? res.target : null;
    }
    return path;
}

const pathExports = {
    collectStepDims, resolveConditionalNext, answerVisible, replayPath,
    matchesOutcome, canReachOutcome, isValidPathToOutcome, getNextOptions,
    buildPathFromDims
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { DIMENSIONS, DIM_MAP,
        matchesOverride, applyOverrides, effectiveVal, isDimVisible, isDimLocked, isValueDisabled,
        cleanSelection, applySelection, effectiveDims, templateMatches, templatePartialMatch, getRenderAfter,
        ...pathExports };
}
if (typeof window !== 'undefined') {
    window.Engine = { DIMENSIONS, DIM_MAP,
        matchesOverride, applyOverrides, effectiveVal, isDimVisible, isDimLocked, isValueDisabled,
        cleanSelection, applySelection, effectiveDims, templateMatches, templatePartialMatch, getRenderAfter,
        ...pathExports };
}

})();
