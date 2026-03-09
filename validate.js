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
    matchesOverride, applyOverrides, effectiveVal,
    isDimVisible, isDimLocked, isValueDisabled,
    cleanSelection, applySelection, effectiveDims, templateMatches, templatePartialMatch, getRenderAfter
} = require('./engine.js');

const questions = JSON.parse(fs.readFileSync(path.join(__dirname, 'data/questions.json'), 'utf8'));
const outcomes = JSON.parse(fs.readFileSync(path.join(__dirname, 'data/outcomes.json'), 'utf8'));
const templatesList = outcomes.templates;

const qMap = {};
for (const q of questions.questions) qMap[q.id] = q;
const oMap = {};
for (const t of templatesList) oMap[t.id] = t;


// ════════════════════════════════════════════════════════
// Phase 1 — Static Analysis
// ════════════════════════════════════════════════════════

function runStaticAnalysis() {
    const errors = [];
    const warnings = [];

    // 1. Routing completeness
    function collectNextTargets(nextSpec) {
        if (typeof nextSpec === 'string') return [nextSpec];
        if (Array.isArray(nextSpec)) return nextSpec.map(r => r.target);
        return [];
    }

    for (const q of questions.questions) {
        for (const a of q.answers) {
            if (!a.next) {
                if (a.next !== '__resolve__') {
                    errors.push(`[routing] Question "${q.id}" answer "${a.label}" has no 'next' property`);
                }
                continue;
            }
            const targets = collectNextTargets(a.next);
            for (const t of targets) {
                if (!qMap[t] && !oMap[t] && t !== '__resolve__') {
                    errors.push(`[routing] Question "${q.id}" answer "${a.label}" → target "${t}" not found in questions or outcomes`);
                }
            }
            if (Array.isArray(a.next)) {
                const hasFallback = a.next.some(r => !r.when);
                if (!hasFallback) {
                    warnings.push(`[routing] Question "${q.id}" answer "${a.label}" has conditional next with no fallback entry`);
                }
                for (const route of a.next) {
                    if (route.when) {
                        for (const [dim] of Object.entries(route.when)) {
                            if (!DIM_MAP[dim]) {
                                errors.push(`[routing] Question "${q.id}" answer "${a.label}" conditional when references unknown dimension "${dim}"`);
                            }
                        }
                    }
                }
            }
        }
    }

    // 2. Reachability (BFS from root)
    const reachedNodes = new Set();
    const bfsQueue = [questions.questions[0].id];
    while (bfsQueue.length) {
        const nodeId = bfsQueue.shift();
        if (reachedNodes.has(nodeId)) continue;
        reachedNodes.add(nodeId);
        if (oMap[nodeId] || !qMap[nodeId]) continue;
        const q = qMap[nodeId];
        for (const a of q.answers) {
            for (const t of collectNextTargets(a.next)) {
                if (!reachedNodes.has(t)) bfsQueue.push(t);
            }
        }
    }

    for (const t of templatesList) {
        if (!reachedNodes.has(t.id)) {
            warnings.push(`[reachability] Outcome "${t.id}" (${t.title}) is never reached from the question tree`);
        }
    }
    for (const q of questions.questions) {
        if (!reachedNodes.has(q.id)) {
            warnings.push(`[reachability] Question "${q.id}" is never reached from the question tree`);
        }
    }

    // 3. Dimension consistency
    const questionDims = new Set();
    const questionDimValues = {};
    for (const q of questions.questions) {
        if (q.dimension) {
            questionDims.add(q.dimension);
            if (!questionDimValues[q.dimension]) questionDimValues[q.dimension] = new Set();
        }
        for (const a of q.answers) {
            if (a.value !== undefined && q.dimension) questionDimValues[q.dimension].add(a.value);
            if (a.sets) {
                for (const [k, v] of Object.entries(a.sets)) {
                    questionDims.add(k);
                    if (!questionDimValues[k]) questionDimValues[k] = new Set();
                    questionDimValues[k].add(v);
                }
            }
            if (Array.isArray(a.next)) {
                for (const route of a.next) {
                    if (route.sets) {
                        for (const [k, v] of Object.entries(route.sets)) {
                            questionDims.add(k);
                            if (!questionDimValues[k]) questionDimValues[k] = new Set();
                            questionDimValues[k].add(v);
                        }
                    }
                }
            }
        }
    }

    const metaDims = new Set(DIMENSIONS.map(d => d.id));

    for (const dim of questionDims) {
        if (!metaDims.has(dim)) {
            warnings.push(`[consistency] Dimension "${dim}" is set in questions.json but not defined in DIMENSIONS`);
        }
    }
    for (const dim of DIMENSIONS) {
        if (dim.virtual) continue;
        if (!questionDims.has(dim.id)) {
            warnings.push(`[consistency] Dimension "${dim.id}" is in DIMENSIONS but never set by any question`);
        }
    }

    for (const dim of DIMENSIONS) {
        if (dim.virtual) continue;
        const qVals = questionDimValues[dim.id] || new Set();
        for (const v of dim.values) {
            if (!qVals.has(v.id)) {
                const key = `${dim.id}.${v.id}`;
                warnings.push(`[consistency] DIMENSIONS value "${key}" never appears in any question answer`);
            }
        }
    }

    // 4. Override dependency / circular detection
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
                    const useRaw = dim.useRawFor && dim.useRawFor.includes(k);
                    deps.add(useRaw ? 'raw:' + k : 'effective:' + k);
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
                warnings.push(`[circular] effectiveVal("${dimId}") depends on effectiveVal("${depDim}"), and isDimVisible("${depDim}") depends on effectiveVal("${dimId}")`);
            }
        }
    }

    // 5. Requires validation
    for (const q of questions.questions) {
        for (const a of q.answers) {
            if (!a.requires) continue;
            const condSets = Array.isArray(a.requires) ? a.requires : [a.requires];
            for (const conds of condSets) {
                for (const [dim, vals] of Object.entries(conds)) {
                    if (!metaDims.has(dim) && !DIM_MAP[dim]) {
                        errors.push(`[requires] Question "${q.id}" answer "${a.label}" requires unknown dimension "${dim}"`);
                    }
                    if (DIM_MAP[dim]) {
                        const validIds = new Set(DIM_MAP[dim].values.map(v => v.id));
                        for (const v of vals) {
                            if (!validIds.has(v)) {
                                errors.push(`[requires] Question "${q.id}" answer "${a.label}" requires unknown value "${dim}=${v}"`);
                            }
                        }
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
    const violations = { vanish: [], appearAboveAnswered: [], deadEnd: [], ambiguous: [], stuck: [], singleOption: [], clickErased: [], premature: [], lockedAfterUnanswered: [], progressiveVanish: [], selectionErasedUpward: [], selectionOverriddenUpward: [], selectionOverriddenDownward: [], switchOrphan: [], switchErased: [], switchUpstreamChanged: [] };
    const seen = { vanish: new Set(), appearAbove: new Set(), clickErased: new Set(), premature: new Set(), lockedAfterUnanswered: new Set(), progressiveVanish: new Set(), selectionErasedUpward: new Set(), selectionOverriddenUpward: new Set(), selectionOverriddenDownward: new Set(), switchOrphan: new Set(), switchErased: new Set(), switchUpstreamChanged: new Set() };

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

        // lockedAfterUnanswered (no per-value iteration needed)
        let firstUnansweredIdx = -1;
        for (let i = 0; i < N; i++) {
            if (!dimVis[i] || dimLock[i] !== null) continue;
            if (dimHasVal[i]) continue;
            firstUnansweredIdx = i;
            break;
        }
        if (firstUnansweredIdx !== -1) {
            for (let i = firstUnansweredIdx + 1; i < N; i++) {
                if (!dimVis[i] || dimLock[i] === null) continue;
                const k = `${DIMENSIONS[firstUnansweredIdx].id}|${DIMENSIONS[i].id}`;
                if (seen.lockedAfterUnanswered.has(k)) continue;
                seen.lockedAfterUnanswered.add(k);
                violations.lockedAfterUnanswered.push({ unanswered: DIMENSIONS[firstUnansweredIdx].id, locked: DIMENSIONS[i].id, url: selToUrl(sel) });
            }
        }

        // stuck / singleOption (no per-value iteration needed)
        for (let i = 0; i < N; i++) {
            if (!dimVis[i] || dimLock[i] !== null || dimHasVal[i]) continue;
            const ena = dimEna[i];
            if (ena.length === 0) violations.stuck.push({ dim: DIMENSIONS[i].id, url: selToUrl(sel) });
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
                            violations.vanish.push({ dim: dimId, val: val.id, vanished: upper.id, url: selToUrl(sel) });
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
                            violations.appearAboveAnswered.push({ dim: dimId, val: val.id, appeared: DIMENSIONS[ni].id, url: selToUrl(sel) });
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

    // DFS with forward-key deduplication
    let totalStates = 0;
    let totalLeaves = 0;
    const visited = new Set();
    const rawVisited = new Set();
    const stack = [{}];
    let dedupSaved = 0;

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

    return { violations, totalStates, totalLeaves, dedupSaved, rawUnique: rawVisited.size };
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
    }
    if (warnings.length) {
        console.log(`  WARNINGS (${warnings.length}):`);
        for (const w of warnings) console.log('    ⚠ ' + w);
    }
    if (!errors.length && !warnings.length) {
        console.log('  ✓ All static checks passed');
    }
}

function printPhase2(result) {
    const { violations, totalStates, totalLeaves } = result;

    const cats = [
        { name: 'DEAD-END LEAF (no outcome)', items: violations.deadEnd, fmt: v => `    No outcome matches at leaf` },
        { name: 'AMBIGUOUS LEAF (multiple outcomes)', items: violations.ambiguous, fmt: v => `    ${v.outcomes.length} outcomes: [${v.outcomes.join(', ')}]` },
        { name: 'STUCK DIM (visible, 0 enabled values)', items: violations.stuck, fmt: v => `    "${v.dim}" is visible but has no selectable values` },
        { name: 'UNLOCKED SINGLE OPTION', items: violations.singleOption, fmt: v => `    "${v.dim}" has only "${v.val}" enabled but is not locked` },
        { name: 'ROW VANISHES UPWARD', items: violations.vanish, fmt: v => `    Click "${v.dim}=${v.val}" → "${v.vanished}" vanishes` },
        { name: 'PROGRESSIVE DISCLOSURE VANISH', items: violations.progressiveVanish, fmt: v => `    Click "${v.dim}=${v.val}" → "${v.vanished}" hidden` },
        { name: 'ROW APPEARS ABOVE ANSWERED', items: violations.appearAboveAnswered, fmt: v => `    Click "${v.dim}=${v.val}" → "${v.appeared}" appears above answered row` },
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

    if (violations.lockedAfterUnanswered.length) {
        console.log(`  ━━━ LOCKED LEAKS PAST UNANSWERED — handled by progressive disclosure (${violations.lockedAfterUnanswered.length}) ━━━`);
        for (const v of violations.lockedAfterUnanswered) {
            console.log(`    "${v.locked}" is auto-locked but appears after unanswered "${v.unanswered}"`);
            console.log(`    ${v.url}\n`);
        }
    }

    if (violationCount === 0) {
        console.log('  ✓ No violations found');
    }

    return violationCount;
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
console.log(`${questions.questions.length} questions, ${templatesList.length} outcomes, ${DIMENSIONS.length} dimensions\n`);

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

// Summary
const totalIssues = phase1.errors.length + phase1.warnings.length + violationCount;
if (totalIssues === 0) {
    console.log('✓ All checks passed!');
} else {
    console.log(`${phase1.errors.length} error(s), ${phase1.warnings.length} warning(s), ${violationCount} violation(s)`);
}

process.exit(phase1.errors.length || violationCount ? 1 : 0);
