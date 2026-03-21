#!/usr/bin/env node
// Unified validation for the Singularity Map decision tree
// Phase 1: Static analysis (routing, reachability, consistency, overrides, requires)
// Phase 2: Explorer simulation (DFS over all reachable states, invariant checks)
//
// Usage:
//   node validate.js          — run both phases
//   node validate.js --quick  — phase 1 only (fast)
//   node validate.js sample 5 — sample 5 random leaf paths

const fs = require('fs');
const path = require('path');
const { DIMENSIONS, DIM_MAP } = require('./dimensions.js');
const {
    matchCondition, matchesOverride, applyOverrides, effectiveVal,
    isDimVisible, isDimActivated, isDimLocked, isValueDisabled,
    cleanSelection, applySelection, effectiveDims, templateMatches, templatePartialMatch, getRenderAfter
} = require('./engine.js');

const outcomes = JSON.parse(fs.readFileSync(path.join(__dirname, 'data/outcomes.json'), 'utf8'));
const templatesList = outcomes.templates;

const oMap = {};
for (const t of templatesList) oMap[t.id] = t;


// ════════════════════════════════════════════════════════
// Phase 1 — Static Analysis
// ════════════════════════════════════════════════════════

function runStaticAnalysis() {
    const errors = [];
    const warnings = [];

    const metaDims = new Set(DIMENSIONS.map(d => d.id));

    // 1. Dimension structure validation
    for (const dim of DIMENSIONS) {
        if (!dim.id) errors.push(`[structure] Dimension missing id`);
        if (!dim.values || dim.values.length === 0) {
            errors.push(`[structure] Dimension "${dim.id}" has no values`);
        }
        if (dim.activateWhen) {
            for (const cond of dim.activateWhen) {
                for (const [k] of Object.entries(cond)) {
                    if (k.startsWith('_')) continue;
                    if (!metaDims.has(k)) {
                        errors.push(`[structure] Dimension "${dim.id}" activateWhen references unknown dimension "${k}"`);
                    }
                }
            }
        }
    }

    // Helper: validate keys/values in a matchCondition-style condition object
    function validateCondition(cond, dimId, label) {
        for (const [k, vals] of Object.entries(cond)) {
            if (k.startsWith('_')) continue;
            if (!metaDims.has(k)) {
                errors.push(`[${label}] Dimension "${dimId}" references unknown dimension "${k}"`);
            } else {
                const validIds = new Set(DIM_MAP[k].values.map(v => v.id));
                const arr = Array.isArray(vals) ? vals : [vals];
                for (const v of arr) {
                    if (!validIds.has(v)) errors.push(`[${label}] Dimension "${dimId}" references unknown value "${k}=${v}"`);
                }
            }
        }
        for (const sk of ['_raw', '_eff', '_rawNot', '_effNot']) {
            if (!cond[sk]) continue;
            for (const [k, vals] of Object.entries(cond[sk])) {
                if (!metaDims.has(k)) {
                    errors.push(`[${label}] Dimension "${dimId}" references unknown dimension "${k}" in ${sk}`);
                } else {
                    const validIds = new Set(DIM_MAP[k].values.map(v => v.id));
                    const arr = Array.isArray(vals) ? vals : [vals];
                    for (const v of arr) {
                        if (!validIds.has(v)) errors.push(`[${label}] Dimension "${dimId}" references unknown value "${k}=${v}" in ${sk}`);
                    }
                }
            }
        }
        for (const sk of ['_set', '_notSet']) {
            if (!cond[sk]) continue;
            for (const k of cond[sk]) {
                if (!metaDims.has(k)) errors.push(`[${label}] Dimension "${dimId}" references unknown dimension "${k}" in ${sk}`);
            }
        }
    }

    // Helper: validate keys/values in a matchesOverride-style rule
    function validateOverride(rule, dim) {
        const dimId = dim.id;
        const ownValues = dim.values ? new Set(dim.values.map(v => v.id)) : new Set();
        for (const rk of ['when', 'unless']) {
            if (!rule[rk]) continue;
            for (const [k, val] of Object.entries(rule[rk])) {
                if (!metaDims.has(k)) {
                    errors.push(`[overrides] Dimension "${dimId}" references unknown dimension "${k}" in ${rk}`);
                } else {
                    const validIds = new Set(DIM_MAP[k].values.map(v => v.id));
                    const vals = Array.isArray(val) ? val : [val];
                    for (const v of vals) {
                        if (!validIds.has(v)) warnings.push(`[overrides] Dimension "${dimId}" references unreachable value "${k}=${v}" in ${rk} (dead rule)`);
                    }
                }
            }
        }
        if (rule.effective) {
            for (const [k, val] of Object.entries(rule.effective)) {
                if (!metaDims.has(k)) {
                    errors.push(`[overrides] Dimension "${dimId}" references unknown dimension "${k}" in effective`);
                } else {
                    const validIds = new Set(DIM_MAP[k].values.map(v => v.id));
                    const vals = Array.isArray(val) ? val : [val];
                    for (const v of vals) {
                        if (!validIds.has(v)) errors.push(`[overrides] Dimension "${dimId}" references unknown value "${k}=${v}" in effective`);
                    }
                }
            }
        }
        if (rule.whenSet && !metaDims.has(rule.whenSet)) {
            errors.push(`[overrides] Dimension "${dimId}" references unknown dimension "${rule.whenSet}" in whenSet`);
        }
        if (rule.fromDim && !metaDims.has(rule.fromDim)) {
            errors.push(`[overrides] Dimension "${dimId}" references unknown dimension "${rule.fromDim}" in fromDim`);
        }
        if (rule.value !== undefined && !ownValues.has(rule.value)) {
            errors.push(`[overrides] Dimension "${dimId}" override produces unknown value "${rule.value}"`);
        }
        if (rule.valueMap) {
            for (const [from, to] of Object.entries(rule.valueMap)) {
                if (!ownValues.has(from)) errors.push(`[overrides] Dimension "${dimId}" valueMap references unknown input "${from}"`);
                if (!ownValues.has(to)) errors.push(`[overrides] Dimension "${dimId}" valueMap references unknown output "${to}"`);
            }
        }
    }

    // 2. Requires validation on dimension values
    for (const dim of DIMENSIONS) {
        if (!dim.values) continue;
        for (const v of dim.values) {
            if (!v.requires) continue;
            const condSets = Array.isArray(v.requires) ? v.requires : [v.requires];
            for (const conds of condSets) {
                for (const [dk, vals] of Object.entries(conds)) {
                    if (dk.startsWith('_')) continue;
                    if (!metaDims.has(dk)) {
                        errors.push(`[requires] Dimension "${dim.id}" value "${v.id}" requires unknown dimension "${dk}"`);
                    }
                    if (DIM_MAP[dk]) {
                        const validIds = new Set(DIM_MAP[dk].values.map(vv => vv.id));
                        const arr = Array.isArray(vals) ? vals : [vals];
                        for (const vv of arr) {
                            if (!validIds.has(vv)) {
                                errors.push(`[requires] Dimension "${dim.id}" value "${v.id}" requires unknown value "${dk}=${vv}"`);
                            }
                        }
                    }
                }
            }
        }
    }

    // 2b. lockedWhen validation
    for (const dim of DIMENSIONS) {
        if (!dim.lockedWhen) continue;
        const ownValues = new Set(dim.values.map(v => v.id));
        for (const rule of dim.lockedWhen) {
            if (rule.when) validateCondition(rule.when, dim.id, 'lockedWhen');
            if (!ownValues.has(rule.value)) {
                errors.push(`[lockedWhen] Dimension "${dim.id}" locks to unknown value "${rule.value}"`);
            }
        }
    }

    // 2c. suppressWhen validation
    for (const dim of DIMENSIONS) {
        if (!dim.suppressWhen) continue;
        for (const cond of dim.suppressWhen) {
            validateCondition(cond, dim.id, 'suppressWhen');
        }
    }

    // 2d. disabledWhen validation (on values)
    for (const dim of DIMENSIONS) {
        if (!dim.values) continue;
        for (const v of dim.values) {
            if (!v.disabledWhen) continue;
            for (const cond of v.disabledWhen) {
                validateCondition(cond, `${dim.id}.${v.id}`, 'disabledWhen');
            }
        }
    }

    // 2e. overrides validation
    for (const dim of DIMENSIONS) {
        if (!dim.overrides) continue;
        for (const rule of dim.overrides) {
            validateOverride(rule, dim);
        }
    }

    // 2f. lockedWhen / overrides duplication detection
    for (const dim of DIMENSIONS) {
        if (!dim.lockedWhen || !dim.overrides) continue;
        for (const lock of dim.lockedWhen) {
            const lockDimKeys = new Set();
            if (lock.when) {
                for (const [k] of Object.entries(lock.when)) {
                    if (!k.startsWith('_')) lockDimKeys.add(k);
                }
                if (lock.when._raw) for (const k of Object.keys(lock.when._raw)) lockDimKeys.add(k);
                if (lock.when._eff) for (const k of Object.keys(lock.when._eff)) lockDimKeys.add(k);
            }
            for (const ovr of dim.overrides) {
                if (ovr.value === undefined || ovr.value !== lock.value) continue;
                const ovrDimKeys = new Set();
                if (ovr.when) for (const k of Object.keys(ovr.when)) ovrDimKeys.add(k);
                if (ovr.effective) for (const k of Object.keys(ovr.effective)) ovrDimKeys.add(k);
                const shared = [...lockDimKeys].filter(k => ovrDimKeys.has(k));
                if (shared.length > 0) {
                    errors.push(`[redundant] Dimension "${dim.id}": lockedWhen and overrides both produce "${lock.value}" referencing ${shared.map(k => '"'+k+'"').join(', ')}`);
                }
            }
        }
    }

    // 2g. Dead value detection: requires contradicted by disabledWhen
    for (const dim of DIMENSIONS) {
        if (!dim.values) continue;
        for (const val of dim.values) {
            if (!val.requires || !val.disabledWhen) continue;
            const reqSets = Array.isArray(val.requires) ? val.requires : [val.requires];
            let allBlocked = true;
            for (const req of reqSets) {
                let blocked = false;
                for (const dis of val.disabledWhen) {
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
                warnings.push(`[dead-value] Dimension "${dim.id}" value "${val.id}": every requires clause is contradicted by disabledWhen`);
            }
        }
    }

    // 2h. _notSet referencing overridable dims (raw/effective asymmetry lint)
    // _set checks raw, _notSet checks effective — flag when _notSet targets a non-virtual dim with overrides
    // Virtual dims are excluded: they only exist through overrides, so effective IS the only value.
    const overridableDims = new Set(DIMENSIONS.filter(d => d.overrides && !d.virtual).map(d => d.id));
    for (const dim of DIMENSIONS) {
        const condSources = [];
        if (dim.activateWhen) for (const c of dim.activateWhen) condSources.push(['activateWhen', c]);
        if (dim.suppressWhen) for (const c of dim.suppressWhen) condSources.push(['suppressWhen', c]);
        if (dim.lockedWhen) for (const r of dim.lockedWhen) if (r.when) condSources.push(['lockedWhen', r.when]);
        if (dim.values) {
            for (const v of dim.values) {
                if (v.disabledWhen) for (const c of v.disabledWhen) condSources.push([`disabledWhen(${v.id})`, c]);
                if (v.requires) {
                    const rs = Array.isArray(v.requires) ? v.requires : [v.requires];
                    for (const c of rs) condSources.push([`requires(${v.id})`, c]);
                }
            }
        }
        for (const [source, cond] of condSources) {
            if (!cond._notSet) continue;
            for (const k of cond._notSet) {
                if (overridableDims.has(k)) {
                    warnings.push(`[raw-eff] Dimension "${dim.id}" ${source} uses _notSet on "${k}" which has overrides (checks effective, not raw)`);
                }
            }
        }
    }

    // 3. Override dependency / circular detection
    const overrideDeps = {};
    for (const dim of DIMENSIONS) {
        if (!dim.overrides) continue;
        const deps = new Set();
        for (const rule of dim.overrides) {
            if (rule.when) Object.keys(rule.when).forEach(k => deps.add(k));
            if (rule.unless) Object.keys(rule.unless).forEach(k => deps.add(k));
            if (rule.effective) Object.keys(rule.effective).forEach(k => deps.add('effective:' + k));
            if (rule.whenSet) deps.add(rule.whenSet);
        }
        overrideDeps[dim.id] = deps;
    }

    const visibilityDeps = {};
    for (const dim of DIMENSIONS) {
        const deps = new Set();
        if (dim.activateWhen) {
            for (const cond of dim.activateWhen) {
                for (const [k] of Object.entries(cond)) {
                    if (k.startsWith('_')) continue;
                    const inRawFor = dim.useRawFor && dim.useRawFor.includes(k);
                    if (inRawFor && dim.useRawUnless) {
                        deps.add('raw:' + k);
                        deps.add('effective:' + k);
                    } else {
                        deps.add(inRawFor ? 'raw:' + k : 'effective:' + k);
                    }
                }
                if (cond._raw) for (const k of Object.keys(cond._raw)) deps.add('raw:' + k);
                if (cond._eff) for (const k of Object.keys(cond._eff)) deps.add('effective:' + k);
            }
        }
        visibilityDeps[dim.id] = deps;
    }

    for (const [dimId, oDeps] of Object.entries(overrideDeps)) {
        for (const dep of oDeps) {
            if (!dep.startsWith('effective:')) continue;
            const depDim = dep.slice('effective:'.length);
            const vDeps = visibilityDeps[depDim];
            if (!vDeps) continue;
            if (vDeps.has('effective:' + dimId)) {
                errors.push(`[circular] effectiveVal("${dimId}") depends on effectiveVal("${depDim}"), and isDimVisible("${depDim}") depends on effectiveVal("${dimId}")`);
            }
        }
    }

    // 4. Outcome template dimension references
    for (const t of templatesList) {
        if (t.reachable) {
            const condList = Array.isArray(t.reachable) ? t.reachable : [t.reachable];
            for (const cond of condList) {
                for (const [dk] of Object.entries(cond)) {
                    if (!metaDims.has(dk)) {
                        errors.push(`[outcome] Template "${t.id}" reachable references unknown dimension "${dk}"`);
                    }
                }
            }
        }
    }

    return { errors, warnings, overrideDeps };
}

// ════════════════════════════════════════════════════════
// Phase 2 — Explorer Simulation
// ════════════════════════════════════════════════════════

function selToUrl(sel) {
    const params = Object.entries(sel).filter(([, v]) => v != null).map(([k, v]) => `${k}=${v}`).join('&');
    return `http://localhost:3000/#/explore${params ? '?' + params : ''}`;
}

function selKey(sel) {
    return Object.entries(sel).filter(([, v]) => v != null).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('&');
}

function getNextDim(sel) {
    for (const dim of DIMENSIONS) {
        if (dim.terminal || dim.virtual) continue;
        if (!isDimVisible(sel, dim)) continue;
        if (isDimLocked(sel, dim) !== null) continue;
        if (sel[dim.id]) continue;
        return dim;
    }
    return null;
}

function getEnabledValues(sel, dim) {
    return dim.values.filter(v => !isValueDisabled(sel, dim, v));
}

const FORWARD_KEY_DIMS = DIMENSIONS.filter(d => d.forwardKey).map(d => d.id);

function forwardKey(sel) {
    const parts = [];
    const dims = effectiveDims(sel);
    for (const k of FORWARD_KEY_DIMS) {
        if (dims[k]) parts.push(`E:${k}=${dims[k]}`);
    }
    for (const dim of DIMENSIONS) {
        if (dim.terminal || dim.virtual) continue;
        if (!isDimVisible(sel, dim)) continue;
        if (isDimLocked(sel, dim) !== null) continue;
        if (sel[dim.id]) continue;
        const enabled = getEnabledValues(sel, dim).map(v => v.id);
        parts.push(`${dim.id}?${enabled.join(',')}`);
    }
    return parts.join('|');
}

function progressivelyShown(sel) {
    let shownNext = false;
    const shown = new Set();
    for (const dim of DIMENSIONS) {
        if (dim.virtual) continue;
        const visible = isDimVisible(sel, dim);
        if (!visible) continue;
        const locked = isDimLocked(sel, dim);
        const answered = !!sel[dim.id];
        const userAnswered = answered && locked === null;
        const isNext = visible && locked === null && !answered;
        if (shownNext && !userAnswered) continue;
        shown.add(dim.id);
        if (isNext) shownNext = true;
    }
    return shown;
}

function runExplorer() {
    const violations = { vanish: [], appearAboveAnswered: [], deadEnd: [], ambiguous: [], stuck: [], singleOption: [], clickErased: [], premature: [], progressiveVanish: [], selectionErasedUpward: [], selectionOverriddenUpward: [], selectionOverriddenDownward: [], switchOrphan: [], switchErased: [], switchUpstreamChanged: [] };
    const seen = { vanish: new Set(), appearAbove: new Set(), clickErased: new Set(), premature: new Set(), progressiveVanish: new Set(), selectionErasedUpward: new Set(), selectionOverriddenUpward: new Set(), selectionOverriddenDownward: new Set(), switchOrphan: new Set(), switchErased: new Set(), switchUpstreamChanged: new Set() };

    function resolveRenderIdx(sel, dim) {
        const afterId = getRenderAfter(sel, dim);
        if (!afterId) return null;
        const afterDim = DIM_MAP[afterId];
        if (!afterDim) return null;
        const parentIdx = resolveRenderIdx(sel, afterDim);
        const baseIdx = parentIdx !== null ? parentIdx : DIMENSIONS.indexOf(afterDim);
        return baseIdx + 1;
    }

    function checkPrematureOutcome(sel, nextDim) {
        const dims = effectiveDims(sel);
        const matched = templatesList.filter(t => templateMatches(t, dims));
        if (matched.length !== 1) return;
        const currentOutcome = matched[0].id;
        const enabled = getEnabledValues(sel, nextDim);
        for (const val of enabled) {
            const next = { ...sel };
            applySelection(next, nextDim.id, val.id);
            const childDims = effectiveDims(next);
            const childMatched = templatesList.filter(t => templateMatches(t, childDims));
            if (childMatched.length !== 1 || childMatched[0].id !== currentOutcome) {
                const k = selKey(sel);
                if (seen.premature.has(k)) return;
                seen.premature.add(k);
                violations.premature.push({ outcome: currentOutcome, nextDim: nextDim.id, url: selToUrl(sel) });
                return;
            }
        }
    }

    function checkLeaf(sel) {
        const dims = effectiveDims(sel);
        const matched = templatesList.filter(t => templateMatches(t, dims));
        if (matched.length === 0) violations.deadEnd.push({ url: selToUrl(sel) });
        else if (matched.length > 1) violations.ambiguous.push({ outcomes: matched.map(t => t.id), url: selToUrl(sel) });
    }

    function runChecks(sel) {
        const N = DIMENSIONS.length;
        const dimVis = new Uint8Array(N);
        const dimLock = new Array(N);
        const dimEna = new Array(N);
        const dimHasVal = new Uint8Array(N);
        for (let i = 0; i < N; i++) {
            const dim = DIMENSIONS[i];
            if (dim.virtual) continue;
            const vis = isDimVisible(sel, dim);
            if (!vis) continue;
            dimVis[i] = 1;
            const lock = isDimLocked(sel, dim);
            dimLock[i] = lock;
            if (lock === null) {
                dimEna[i] = getEnabledValues(sel, dim);
                dimHasVal[i] = sel[dim.id] ? 1 : 0;
            }
        }


        // stuck / singleOption (no per-value iteration needed)
        for (let i = 0; i < N; i++) {
            if (!dimVis[i] || dimLock[i] !== null || dimHasVal[i]) continue;
            const ena = dimEna[i];
            if (ena.length === 0) {
                const reasons = [];
                for (const v of DIMENSIONS[i].values) {
                    if (v.disabledWhen && v.disabledWhen.some(c => matchCondition(sel, c, {}))) {
                        reasons.push(`"${v.id}" disabled by disabledWhen`);
                    } else if (v.requires) {
                        const rs = Array.isArray(v.requires) ? v.requires : [v.requires];
                        if (!rs.some(c => matchCondition(sel, c, {}))) reasons.push(`"${v.id}" blocked by requires`);
                    }
                }
                violations.stuck.push({ dim: DIMENSIONS[i].id, url: selToUrl(sel), mechanism: reasons.join('; ') });
            }
            if (ena.length === 1) violations.singleOption.push({ dim: DIMENSIONS[i].id, val: ena[0].id, url: selToUrl(sel) });
        }

        const visibleIds = new Set();
        const answeredIds = new Set();
        for (let i = 0; i < N; i++) {
            if (!dimVis[i]) continue;
            visibleIds.add(DIMENSIONS[i].id);
            if (dimLock[i] === null && dimHasVal[i]) answeredIds.add(DIMENSIONS[i].id);
        }
        const shownBefore = progressivelyShown(sel);

        // Unified per-value iteration: applySelection once per (dim, val) pair
        for (let di = 0; di < N; di++) {
            if (!dimVis[di] || dimLock[di] !== null || !dimEna[di]) continue;
            const dim = DIMENSIONS[di];
            const dimId = dim.id;
            const isUnanswered = !dimHasVal[di];

            for (const val of dimEna[di]) {
                if (sel[dimId] === val.id) continue;

                const next = { ...sel };
                applySelection(next, dimId, val.id);
                const vk = `${dimId}:${val.id}`;

                // clickErased
                if (!next[dimId]) {
                    if (!seen.clickErased.has(vk)) {
                        seen.clickErased.add(vk);
                        violations.clickErased.push({ dim: dimId, val: val.id, url: selToUrl(sel) });
                    }
                }

                // switchErased / switchUpstreamChanged (answered dims only)
                if (!isUnanswered) {
                    if (next[dimId] !== val.id) {
                        if (!seen.switchErased.has(vk)) {
                            seen.switchErased.add(vk);
                            violations.switchErased.push({ dim: dimId, val: val.id, url: selToUrl(sel) });
                        }
                    }
                    if (next[dimId] === val.id) {
                        for (let ui = 0; ui < di; ui++) {
                            if (!sel[DIMENSIONS[ui].id]) continue;
                            const upId = DIMENSIONS[ui].id;
                            const k = `${vk}->${upId}`;
                            if (!next[upId]) {
                                if (!seen.switchUpstreamChanged.has(k)) {
                                    seen.switchUpstreamChanged.add(k);
                                    violations.switchUpstreamChanged.push({ dim: dimId, val: val.id, upstream: upId, from: sel[upId], to: '(deleted)', url: selToUrl(sel) });
                                }
                            } else if (sel[upId] !== next[upId]) {
                                if (!seen.switchUpstreamChanged.has(k)) {
                                    seen.switchUpstreamChanged.add(k);
                                    violations.switchUpstreamChanged.push({ dim: dimId, val: val.id, upstream: upId, from: sel[upId], to: next[upId], url: selToUrl(sel) });
                                }
                            }
                        }
                    }
                }

                // upper dims: vanishUpward + selectionImpact upward
                for (let ui = 0; ui < di; ui++) {
                    if (!dimVis[ui] || !sel[DIMENSIONS[ui].id]) continue;
                    const upper = DIMENSIONS[ui];
                    const upperVisible = isDimVisible(next, upper);
                    const k = `${vk}->${upper.id}`;

                    if (!upperVisible) {
                        if (!seen.vanish.has(k)) {
                            seen.vanish.add(k);
                            let mechanism = 'activateWhen no longer matches';
                            if (upper.suppressWhen) {
                                const matchingSup = upper.suppressWhen.find(c => matchCondition(next, c, upper));
                                if (matchingSup) mechanism = `suppressWhen matched: ${JSON.stringify(matchingSup)}`;
                            }
                            violations.vanish.push({ dim: dimId, val: val.id, vanished: upper.id, url: selToUrl(sel), mechanism });
                        }
                    } else if (isUnanswered && dimLock[ui] === null && next[upper.id] !== sel[upper.id]) {
                        const nowLocked = isDimLocked(next, upper) !== null;
                        if (nowLocked) {
                            if (!seen.selectionOverriddenUpward.has(k)) {
                                seen.selectionOverriddenUpward.add(k);
                                violations.selectionOverriddenUpward.push({ dim: dimId, val: val.id, overridden: upper.id, from: sel[upper.id], to: next[upper.id], url: selToUrl(sel) });
                            }
                        } else {
                            if (!seen.selectionErasedUpward.has(k)) {
                                seen.selectionErasedUpward.add(k);
                                violations.selectionErasedUpward.push({ dim: dimId, val: val.id, erased: upper.id, hadValue: sel[upper.id], url: selToUrl(sel) });
                            }
                        }
                    }
                }

                // lower dims: selectionImpact downward (unanswered) + switchOrphan (answered)
                if (isUnanswered) {
                    for (let li = di + 1; li < N; li++) {
                        if (!dimVis[li] || dimLock[li] !== null || !sel[DIMENSIONS[li].id]) continue;
                        if (next[DIMENSIONS[li].id] === undefined || next[DIMENSIONS[li].id] === sel[DIMENSIONS[li].id]) continue;
                        const k = `${vk}->${DIMENSIONS[li].id}`;
                        if (!seen.selectionOverriddenDownward.has(k)) {
                            seen.selectionOverriddenDownward.add(k);
                            violations.selectionOverriddenDownward.push({ dim: dimId, val: val.id, overridden: DIMENSIONS[li].id, from: sel[DIMENSIONS[li].id], to: next[DIMENSIONS[li].id], url: selToUrl(sel) });
                        }
                    }
                } else {
                    for (let ci = di + 1; ci < N; ci++) {
                        const check = DIMENSIONS[ci];
                        if (next[check.id] === undefined) continue;
                        if (isDimLocked(next, check) !== null) continue;
                        const savedPre = sel[check.id];
                        if (savedPre !== undefined) delete sel[check.id];
                        const wasActivated = savedPre !== undefined ? isDimVisible(sel, check) : false;
                        if (savedPre !== undefined) sel[check.id] = savedPre;
                        if (!wasActivated) continue;
                        const savedPost = next[check.id];
                        delete next[check.id];
                        const isActivated = isDimVisible(next, check);
                        next[check.id] = savedPost;
                        if (!isActivated) {
                            const k = `${vk}->${check.id}`;
                            if (!seen.switchOrphan.has(k)) {
                                seen.switchOrphan.add(k);
                                violations.switchOrphan.push({ switchDim: dimId, switchTo: val.id, orphan: check.id, orphanVal: savedPost, url: selToUrl(sel) });
                            }
                        }
                    }
                }

                // appearAbove (unanswered dims only)
                if (isUnanswered) {
                    const answeredRef = new Set(answeredIds);
                    answeredRef.add(dimId);
                    for (let ni = 0; ni < N; ni++) {
                        if (DIMENSIONS[ni].virtual || visibleIds.has(DIMENSIONS[ni].id)) continue;
                        if (!isDimVisible(next, DIMENSIONS[ni])) continue;
                        if (isDimLocked(next, DIMENSIONS[ni]) !== null) continue;
                        const k = `${vk}->${DIMENSIONS[ni].id}`;
                        if (seen.appearAbove.has(k)) continue;
                        let effectiveIdx = ni;
                        const renderPos = resolveRenderIdx(next, DIMENSIONS[ni]);
                        if (renderPos !== null) effectiveIdx = renderPos;
                        let hasAnsweredBelow = false;
                        for (let j = effectiveIdx + 1; j < N; j++) {
                            if (answeredRef.has(DIMENSIONS[j].id)) { hasAnsweredBelow = true; break; }
                        }
                        if (hasAnsweredBelow) {
                            seen.appearAbove.add(k);
                            const newDim = DIMENSIONS[ni];
                            let mechanism = 'always active';
                            if (newDim.activateWhen) {
                                const mc = newDim.activateWhen.find(c => matchCondition(next, c, newDim));
                                if (mc) mechanism = `activateWhen: ${JSON.stringify(mc)}`;
                            }
                            violations.appearAboveAnswered.push({ dim: dimId, val: val.id, appeared: DIMENSIONS[ni].id, url: selToUrl(sel), mechanism });
                        }
                    }
                }

                // progressiveVanish — only compute shownAfter if a previously-shown dim lost visibility
                let needFullCheck = false;
                for (const wasShown of shownBefore) {
                    const wasIdx = DIMENSIONS.findIndex(dd => dd.id === wasShown);
                    if (wasIdx >= di || !sel[wasShown] || dimLock[wasIdx] !== null) continue;
                    if (!isDimVisible(next, DIMENSIONS[wasIdx])) { needFullCheck = true; break; }
                }
                if (needFullCheck) {
                    const shownAfter = progressivelyShown(next);
                    for (const wasShown of shownBefore) {
                        if (shownAfter.has(wasShown)) continue;
                        const wasIdx = DIMENSIONS.findIndex(dd => dd.id === wasShown);
                        if (wasIdx >= di || !sel[wasShown] || dimLock[wasIdx] !== null) continue;
                        const k = `${vk}->${wasShown}`;
                        if (seen.progressiveVanish.has(k)) continue;
                        seen.progressiveVanish.add(k);
                        violations.progressiveVanish.push({ dim: dimId, val: val.id, vanished: wasShown, url: selToUrl(sel) });
                    }
                }
            }
        }
    }

    // DFS with forward-key deduplication + value coverage tracking
    let totalStates = 0;
    let totalLeaves = 0;
    const visited = new Set();
    const rawVisited = new Set();
    const stack = [{}];
    let dedupSaved = 0;
    const userSelected = new Set();
    const autoLocked = new Set();

    while (stack.length > 0) {
        const sel = stack.pop();
        cleanSelection(sel);

        const raw = selKey(sel);
        const isNewRaw = !rawVisited.has(raw);
        if (isNewRaw) rawVisited.add(raw);

        const fk = forwardKey(sel);
        if (visited.has(fk)) {
            if (isNewRaw) dedupSaved++;
            continue;
        }
        visited.add(fk);
        totalStates++;

        if (totalStates % 1000 === 0) {
            process.stdout.write(`\r  ${totalStates.toLocaleString()} states...`);
        }

        for (const dim of DIMENSIONS) {
            if (sel[dim.id]) {
                const key = `${dim.id}=${sel[dim.id]}`;
                if (isDimLocked(sel, dim) !== null) autoLocked.add(key);
                else userSelected.add(key);
            }
            if (dim.overrides) {
                const eff = effectiveVal(sel, dim.id);
                if (eff) autoLocked.add(`${dim.id}=${eff}`);
            }
        }

        runChecks(sel);

        const next = getNextDim(sel);
        if (next) {
            checkPrematureOutcome(sel, next);
            for (const val of getEnabledValues(sel, next)) {
                stack.push({ ...sel, [next.id]: val.id });
            }
        } else {
            totalLeaves++;
            checkLeaf(sel);
        }
    }

    const coverage = { userSelected, autoLocked };
    return { violations, totalStates, totalLeaves, dedupSaved, rawUnique: rawVisited.size, coverage };
}

// ════════════════════════════════════════════════════════
// Sample Paths Mode
// ════════════════════════════════════════════════════════

function samplePaths(n) {
    const leaves = [];
    const visited = new Set();
    const stack = [{}];

    while (stack.length > 0) {
        const sel = stack.pop();
        cleanSelection(sel);
        const fk = forwardKey(sel);
        if (visited.has(fk)) continue;
        visited.add(fk);

        const next = getNextDim(sel);
        if (next) {
            for (const val of getEnabledValues(sel, next)) {
                stack.push({ ...sel, [next.id]: val.id });
            }
        } else {
            leaves.push(sel);
        }
    }

    const step = Math.max(1, Math.floor(leaves.length / n));
    const picked = [];
    for (let i = 0; i < leaves.length && picked.length < n; i += step) {
        picked.push(leaves[i]);
    }

    console.log(`Sampled ${picked.length} of ${leaves.length} total leaf states:\n`);

    for (let p = 0; p < picked.length; p++) {
        const sel = picked[p];
        const dims = effectiveDims(sel);
        const matched = templatesList.filter(t => templateMatches(t, dims));
        const outcome = matched.length === 1 ? matched[0] : null;

        console.log(`━━━ Path ${p + 1} ━━━`);

        const steps = [];
        for (const dim of DIMENSIONS) {
            if (dim.terminal || dim.virtual) continue;
            if (!isDimVisible(sel, dim)) continue;
            const locked = isDimLocked(sel, dim);
            if (locked !== null) {
                const val = dim.values.find(v => v.id === locked);
                steps.push(`  ${dim.label}: ${val ? val.label : locked} [locked]`);
            } else if (sel[dim.id]) {
                const val = dim.values.find(v => v.id === sel[dim.id]);
                steps.push(`  ${dim.label}: ${val ? val.label : sel[dim.id]}`);
            }
        }
        console.log(steps.join('\n'));

        if (outcome) {
            console.log(`  → Outcome: ${outcome.title} (${outcome.id})`);
        } else if (matched.length === 0) {
            console.log(`  → DEAD END (no outcome)`);
        } else {
            console.log(`  → AMBIGUOUS: ${matched.map(t => t.id).join(', ')}`);
        }

        console.log(`  ${selToUrl(sel)}\n`);
    }
}

// ════════════════════════════════════════════════════════
// Report & Main
// ════════════════════════════════════════════════════════

function printPhase1(result) {
    const { errors, warnings } = result;
    if (errors.length) {
        console.log(`  ERRORS (${errors.length}):`);
        for (const e of errors) console.log('    ✗ ' + e);
    } else {
        console.log('  ✓ All static checks passed');
    }
    if (warnings.length) {
        console.log(`  WARNINGS (${warnings.length}):`);
        for (const w of warnings) console.log('    ⚠ ' + w);
    }
}

function printPhase2(result) {
    const { violations, totalStates, totalLeaves } = result;

    const cats = [
        { name: 'DEAD-END LEAF (no outcome)', items: violations.deadEnd, fmt: v => `    No outcome matches at leaf` },
        { name: 'AMBIGUOUS LEAF (multiple outcomes)', items: violations.ambiguous, fmt: v => `    ${v.outcomes.length} outcomes: [${v.outcomes.join(', ')}]` },
        { name: 'STUCK DIM (visible, 0 enabled values)', items: violations.stuck, fmt: v => `    "${v.dim}" is visible but has no selectable values${v.mechanism ? '\n      Because: ' + v.mechanism : ''}` },
        { name: 'UNLOCKED SINGLE OPTION', items: violations.singleOption, fmt: v => `    "${v.dim}" has only "${v.val}" enabled but is not locked` },
        { name: 'ROW VANISHES UPWARD', items: violations.vanish, fmt: v => `    Click "${v.dim}=${v.val}" → "${v.vanished}" vanishes${v.mechanism ? '\n      Because: ' + v.mechanism : ''}` },
        { name: 'PROGRESSIVE DISCLOSURE VANISH', items: violations.progressiveVanish, fmt: v => `    Click "${v.dim}=${v.val}" → "${v.vanished}" hidden` },
        { name: 'ROW APPEARS ABOVE ANSWERED', items: violations.appearAboveAnswered, fmt: v => `    Click "${v.dim}=${v.val}" → "${v.appeared}" appears above answered row${v.mechanism ? '\n      Because: ' + v.mechanism : ''}` },
        { name: 'CLICK ERASED', items: violations.clickErased, fmt: v => `    Click "${v.dim}=${v.val}" → immediately cleared` },
        { name: 'SELECTION ERASED UPWARD', items: violations.selectionErasedUpward, fmt: v => `    Click "${v.dim}=${v.val}" → erased "${v.erased}=${v.hadValue}" above` },
        { name: 'SELECTION OVERRIDDEN UPWARD', items: violations.selectionOverriddenUpward, fmt: v => `    Click "${v.dim}=${v.val}" → overrode "${v.overridden}" from "${v.from}" to "${v.to}" above` },
        { name: 'SELECTION OVERRIDDEN DOWNWARD', items: violations.selectionOverriddenDownward, fmt: v => `    Click "${v.dim}=${v.val}" → overrode "${v.overridden}" from "${v.from}" to "${v.to}" below` },
        { name: 'PREMATURE OUTCOME', items: violations.premature, fmt: v => `    "${v.outcome}" matches but "${v.nextDim}" still unset` },
        { name: 'VALUE SWITCH ORPHAN', items: violations.switchOrphan, fmt: v => `    Switch "${v.switchDim}" to "${v.switchTo}" → "${v.orphan}=${v.orphanVal}" persists without activation` },
        { name: 'VALUE SWITCH ERASED', items: violations.switchErased, fmt: v => `    Switch "${v.dim}" to "${v.val}" → immediately cleared` },
        { name: 'VALUE SWITCH CHANGES UPSTREAM', items: violations.switchUpstreamChanged, fmt: v => `    Switch "${v.dim}" to "${v.val}" → changes upstream "${v.upstream}" (${v.from} → ${v.to})` },
    ];

    let violationCount = 0;
    for (const cat of cats) {
        if (cat.items.length === 0) continue;
        violationCount += cat.items.length;
        console.log(`  ━━━ ${cat.name} (${cat.items.length}) ━━━`);
        for (const v of cat.items) {
            console.log(cat.fmt(v));
            console.log(`    ${v.url}\n`);
        }
    }


    if (violationCount === 0) {
        console.log('  ✓ No violations found');
    }

    return violationCount;
}

function printPhase3(coverage) {
    const { userSelected, autoLocked } = coverage;
    const allReached = new Set([...userSelected, ...autoLocked]);
    let totalChoice = 0, totalTerminal = 0, totalVirtual = 0;
    const unreachedChoice = [], unreachedTerminal = [], unreachedVirtual = [];
    for (const dim of DIMENSIONS) {
        if (!dim.values) continue;
        for (const val of dim.values) {
            const key = `${dim.id}=${val.id}`;
            const reached = allReached.has(key);
            const entry = { dim: dim.id, val: val.id, hasRequires: !!val.requires };
            if (dim.virtual) {
                totalVirtual++;
                if (!reached) unreachedVirtual.push(entry);
            } else if (dim.terminal) {
                totalTerminal++;
                if (!reached) unreachedTerminal.push(entry);
            } else {
                totalChoice++;
                if (!reached) unreachedChoice.push(entry);
            }
        }
    }
    const fmt = (reached, total) => {
        const pct = total ? ((reached / total) * 100).toFixed(1) : '100.0';
        return `${reached}/${total} (${pct}%)`;
    };
    console.log(`  Choice dims:   ${fmt(totalChoice - unreachedChoice.length, totalChoice)} values reached`);
    console.log(`  Terminal dims:  ${fmt(totalTerminal - unreachedTerminal.length, totalTerminal)} values reached (not explored by DFS)`);
    console.log(`  Virtual dims:   ${fmt(totalVirtual - unreachedVirtual.length, totalVirtual)} values reached via overrides`);
    const lockedOnly = [...autoLocked].filter(k => !userSelected.has(k)).sort();
    if (lockedOnly.length) {
        console.log(`  ${lockedOnly.length} values reached only via auto-lock/override (never user-selectable):`);
        for (const k of lockedOnly) console.log(`    ${k}`);
    }
    if (unreachedChoice.length) {
        console.log(`  Unreached choice values (${unreachedChoice.length}):`);
        for (const u of unreachedChoice) {
            const tag = u.hasRequires ? '(has requires)' : '(no requires — forward-key dedup?)';
            console.log(`    "${u.dim}" → "${u.val}" ${tag}`);
        }
    }
    if (unreachedVirtual.length) {
        console.log(`  Unreached virtual values (${unreachedVirtual.length}):`);
        for (const u of unreachedVirtual) console.log(`    "${u.dim}" → "${u.val}"`);
    }
    if (!unreachedChoice.length && !unreachedVirtual.length) {
        console.log('  ✓ All choice + virtual values reached');
    }
}

// --- Main ---
const arg = process.argv[2];

if (arg === 'sample') {
    const n = parseInt(process.argv[3]) || 5;
    console.log('Singularity Map — Path Sampler\n');
    samplePaths(n);
    process.exit(0);
}

console.log('Singularity Map — Validation Report');
console.log('═'.repeat(50));
console.log(`${DIMENSIONS.filter(d => !d.virtual && !d.terminal).length} non-virtual dimensions, ${templatesList.length} outcomes, ${DIMENSIONS.length} total dimensions\n`);

// Phase 1
const t0 = Date.now();
const phase1 = runStaticAnalysis();
const phase1ms = Date.now() - t0;
console.log(`Phase 1: Static Analysis (${phase1ms}ms)`);
printPhase1(phase1);
console.log();

if (arg === '--quick') {
    process.exit(phase1.errors.length ? 1 : 0);
}

// Phase 2
const t1 = Date.now();
const phase2 = runExplorer();
const phase2ms = ((Date.now() - t1) / 1000).toFixed(1);
console.log(`Phase 2: Explorer Simulation (${phase2ms}s, ${phase2.totalStates} states, ${phase2.totalLeaves} leaves)`);
const violationCount = printPhase2(phase2);
console.log();

// Phase 3 — Coverage
console.log('Phase 3: Value Coverage');
printPhase3(phase2.coverage);
console.log();

// Summary
const totalIssues = phase1.errors.length + violationCount;
if (totalIssues === 0) {
    console.log('✓ All checks passed!');
} else {
    console.log(`${phase1.errors.length} error(s), ${violationCount} violation(s)`);
}

process.exit(phase1.errors.length || violationCount ? 1 : 0);
