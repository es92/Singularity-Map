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
const {
    DIM_META, DIM_MAP, DECEL_PAIRS, decelOutcome, decelAlignProgress,
    matchesOverride, applyOverrides, effectiveVal,
    isDimVisible, isDimLocked, isValueDisabled,
    cleanSelection, effectiveDims, templateMatches, templatePartialMatch
} = require('./logic.js');

const questions = JSON.parse(fs.readFileSync(path.join(__dirname, 'data/questions.json'), 'utf8'));
const outcomes = JSON.parse(fs.readFileSync(path.join(__dirname, 'data/outcomes.json'), 'utf8'));
const templatesList = outcomes.templates;

const qMap = {};
for (const q of questions.questions) qMap[q.id] = q;
const oMap = {};
for (const t of templatesList) oMap[t.id] = t;

const KNOWN_EXCEPTIONS = {
    unreachableQuestions: new Set(['brittle-long-term']),
    exploreOnlyDims: new Set(['governance_window', 'gov_action']),
    disabledValues: new Set([
        'knowledge_replacement.limited', 'physical_automation.limited',
        'plateau_physical_rate.rapid', 'auto_knowledge_rate.limited',
    ]),
};

// ════════════════════════════════════════════════════════
// Phase 1 — Static Analysis
// ════════════════════════════════════════════════════════

function runStaticAnalysis() {
    const errors = [];
    const warnings = [];
    const infos = [];

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
            if (KNOWN_EXCEPTIONS.unreachableQuestions.has(q.id))
                infos.push(`[reachability] Question "${q.id}" is never reached from the question tree (dynamically navigated)`);
            else
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

    const metaDims = new Set(DIM_META.map(d => d.id));
    const virtualDims = new Set(['governance', 'rival_emerges']);

    for (const dim of questionDims) {
        if (!metaDims.has(dim) && !virtualDims.has(dim)) {
            warnings.push(`[consistency] Dimension "${dim}" is set in questions.json but not defined in DIM_META`);
        }
    }
    for (const dim of metaDims) {
        if (!questionDims.has(dim) && !dim.startsWith('decel_')) {
            if (KNOWN_EXCEPTIONS.exploreOnlyDims.has(dim))
                infos.push(`[consistency] Dimension "${dim}" is in DIM_META but never set by any question (Explore-only)`);
            else
                warnings.push(`[consistency] Dimension "${dim}" is in DIM_META but never set by any question`);
        }
    }

    for (const dim of DIM_META) {
        const qVals = questionDimValues[dim.id] || new Set();
        for (const v of dim.values) {
            if (!qVals.has(v.id)) {
                const isDecel = dim.id.startsWith('decel_');
                if (!isDecel) {
                    const key = `${dim.id}.${v.id}`;
                    if (KNOWN_EXCEPTIONS.exploreOnlyDims.has(dim.id))
                        infos.push(`[consistency] DIM_META value "${key}" never appears in any question answer (Explore-only)`);
                    else if (KNOWN_EXCEPTIONS.disabledValues.has(key))
                        infos.push(`[consistency] DIM_META value "${key}" never appears in any question answer (intentionally disabled)`);
                    else
                        warnings.push(`[consistency] DIM_META value "${key}" never appears in any question answer`);
                }
            }
        }
    }

    // 4. Override dependency / circular detection
    const overrideDeps = {};
    for (const dim of DIM_META) {
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
    for (const dim of DIM_META) {
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
                    if (!metaDims.has(dim) && !virtualDims.has(dim)) {
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

    return { errors, warnings, infos, overrideDeps };
}

// ════════════════════════════════════════════════════════
// Phase 2 — Explorer Simulation
// ════════════════════════════════════════════════════════

const TERMINAL_IDS = new Set([
    'knowledge_replacement', 'physical_automation',
    'economic_distribution', 'plateau_knowledge_rate', 'plateau_physical_rate',
    'automation_distribution', 'auto_knowledge_rate', 'auto_physical_rate'
]);

function selToUrl(sel) {
    const params = Object.entries(sel).filter(([, v]) => v != null).map(([k, v]) => `${k}=${v}`).join('&');
    return `http://localhost:3000/#/explore${params ? '?' + params : ''}`;
}

function selKey(sel) {
    return Object.entries(sel).filter(([, v]) => v != null).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('&');
}

function getNextDim(sel) {
    for (const dim of DIM_META) {
        if (TERMINAL_IDS.has(dim.id)) continue;
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

function forwardKey(sel) {
    const parts = [];
    const dims = effectiveDims(sel);
    for (const k of ['capability', 'automation', 'alignment', 'intent', 'failure_mode', 'containment', 'ai_goals', 'governance']) {
        if (dims[k]) parts.push(`E:${k}=${dims[k]}`);
    }
    for (const dim of DIM_META) {
        if (TERMINAL_IDS.has(dim.id)) continue;
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
    for (const dim of DIM_META) {
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
    const violations = { vanish: [], appearAboveAnswered: [], deadEnd: [], ambiguous: [], stuck: [], singleOption: [], clickErased: [], premature: [], lockedAfterUnanswered: [], progressiveVanish: [] };
    const seen = { vanish: new Set(), appearAbove: new Set(), clickErased: new Set(), premature: new Set(), lockedAfterUnanswered: new Set(), progressiveVanish: new Set() };

    function checkVanishUpward(sel) {
        const visible = new Set(DIM_META.filter(d => isDimVisible(sel, d)).map(d => d.id));
        for (const dim of DIM_META) {
            if (!visible.has(dim.id) || isDimLocked(sel, dim) !== null) continue;
            const myIdx = DIM_META.indexOf(dim);
            for (const val of getEnabledValues(sel, dim)) {
                if (sel[dim.id] === val.id) continue;
                const next = { ...sel, [dim.id]: val.id };
                cleanSelection(next);
                for (let i = 0; i < myIdx; i++) {
                    const upper = DIM_META[i];
                    if (!visible.has(upper.id)) continue;
                    if (!sel[upper.id]) continue;
                    if (!isDimVisible(next, upper)) {
                        const k = `${dim.id}:${val.id}->${upper.id}`;
                        if (seen.vanish.has(k)) continue;
                        seen.vanish.add(k);
                        violations.vanish.push({ dim: dim.id, val: val.id, vanished: upper.id, url: selToUrl(sel) });
                    }
                }
            }
        }
    }

    function dimDependsOn(dim, key) {
        if (!dim.activateWhen) return false;
        return dim.activateWhen.some(c => c[key] || (c._raw && c._raw[key]) || (c._eff && c._eff[key]));
    }
    function dimDependsOnKeyNotVal(dim, key, excludeVal) {
        if (!dim.activateWhen) return false;
        return dim.activateWhen.some(c => {
            const vals = c[key] || (c._raw && c._raw[key]) || (c._eff && c._eff[key]);
            return vals && !vals.includes(excludeVal);
        });
    }

    function checkAppearAbove(sel) {
        const visibleBefore = new Set(DIM_META.filter(d => isDimVisible(sel, d)).map(d => d.id));
        const answeredBefore = new Set(DIM_META.filter(d => visibleBefore.has(d.id) && sel[d.id] && isDimLocked(sel, d) === null).map(d => d.id));
        for (const dim of DIM_META) {
            if (!visibleBefore.has(dim.id) || isDimLocked(sel, dim) !== null) continue;
            if (sel[dim.id]) continue;
            for (const val of getEnabledValues(sel, dim)) {
                const next = { ...sel, [dim.id]: val.id };
                cleanSelection(next);
                const alignBefore = effectiveVal(sel, 'alignment');
                const alignAfter = effectiveVal(next, 'alignment');
                const containBefore = effectiveVal(sel, 'containment');
                const containAfter = effectiveVal(next, 'containment');
                const answeredRef = new Set(answeredBefore);
                answeredRef.add(dim.id);
                for (let i = 0; i < DIM_META.length; i++) {
                    const newDim = DIM_META[i];
                    if (visibleBefore.has(newDim.id)) continue;
                    if (!isDimVisible(next, newDim)) continue;
                    if (isDimLocked(next, newDim) !== null) continue;
                    if (alignBefore !== alignAfter && dimDependsOn(newDim, 'alignment')) continue;
                    if (containBefore !== containAfter && dimDependsOn(newDim, 'containment')) continue;
                    if (next.ai_goals === 'marginal' && answeredRef.has('ai_goals')
                        && dimDependsOnKeyNotVal(newDim, 'alignment', 'failed')) continue;
                    const k = `${dim.id}:${val.id}->${newDim.id}`;
                    if (seen.appearAbove.has(k)) continue;
                    let hasAnsweredBelow = false;
                    for (let j = i + 1; j < DIM_META.length; j++) {
                        if (answeredRef.has(DIM_META[j].id)) { hasAnsweredBelow = true; break; }
                    }
                    if (hasAnsweredBelow) {
                        seen.appearAbove.add(k);
                        violations.appearAboveAnswered.push({ dim: dim.id, val: val.id, appeared: newDim.id, url: selToUrl(sel) });
                    }
                }
            }
        }
    }

    function checkProgressiveVanish(sel) {
        const shownBefore = progressivelyShown(sel);
        for (const dim of DIM_META) {
            if (!shownBefore.has(dim.id)) continue;
            if (isDimLocked(sel, dim) !== null) continue;
            const myIdx = DIM_META.indexOf(dim);
            for (const val of getEnabledValues(sel, dim)) {
                if (sel[dim.id] === val.id) continue;
                const next = { ...sel, [dim.id]: val.id };
                cleanSelection(next);
                const shownAfter = progressivelyShown(next);
                for (const wasShown of shownBefore) {
                    if (shownAfter.has(wasShown)) continue;
                    const wasIdx = DIM_META.findIndex(d => d.id === wasShown);
                    if (wasIdx >= myIdx) continue;
                    const wasDim = DIM_META.find(d => d.id === wasShown);
                    if (!sel[wasShown] || isDimLocked(sel, wasDim) !== null) continue;
                    const k = `${dim.id}:${val.id}->${wasShown}`;
                    if (seen.progressiveVanish.has(k)) continue;
                    seen.progressiveVanish.add(k);
                    violations.progressiveVanish.push({ dim: dim.id, val: val.id, vanished: wasShown, url: selToUrl(sel) });
                }
            }
        }
    }

    function checkLockedAfterUnanswered(sel) {
        let firstUnansweredIdx = -1;
        for (let i = 0; i < DIM_META.length; i++) {
            const dim = DIM_META[i];
            if (!isDimVisible(sel, dim)) continue;
            if (isDimLocked(sel, dim) !== null) continue;
            if (sel[dim.id]) continue;
            firstUnansweredIdx = i;
            break;
        }
        if (firstUnansweredIdx === -1) return;
        for (let i = firstUnansweredIdx + 1; i < DIM_META.length; i++) {
            const dim = DIM_META[i];
            if (!isDimVisible(sel, dim)) continue;
            if (isDimLocked(sel, dim) === null) continue;
            const k = `${DIM_META[firstUnansweredIdx].id}|${dim.id}`;
            if (seen.lockedAfterUnanswered.has(k)) continue;
            seen.lockedAfterUnanswered.add(k);
            violations.lockedAfterUnanswered.push({ unanswered: DIM_META[firstUnansweredIdx].id, locked: dim.id, url: selToUrl(sel) });
        }
    }

    function checkStuck(sel) {
        for (const dim of DIM_META) {
            if (!isDimVisible(sel, dim)) continue;
            if (isDimLocked(sel, dim) !== null) continue;
            if (sel[dim.id]) continue;
            const enabled = getEnabledValues(sel, dim);
            if (enabled.length === 0) violations.stuck.push({ dim: dim.id, url: selToUrl(sel) });
            if (enabled.length === 1) violations.singleOption.push({ dim: dim.id, val: enabled[0].id, url: selToUrl(sel) });
        }
    }

    function checkClickErased(sel) {
        for (const dim of DIM_META) {
            if (!isDimVisible(sel, dim)) continue;
            if (isDimLocked(sel, dim) !== null) continue;
            for (const val of getEnabledValues(sel, dim)) {
                if (sel[dim.id] === val.id) continue;
                const next = { ...sel, [dim.id]: val.id };
                cleanSelection(next);
                if (!next[dim.id]) {
                    const k = `${dim.id}:${val.id}`;
                    if (seen.clickErased.has(k)) continue;
                    seen.clickErased.add(k);
                    violations.clickErased.push({ dim: dim.id, val: val.id, url: selToUrl(sel) });
                }
            }
        }
    }

    function checkPrematureOutcome(sel, nextDim) {
        const dims = effectiveDims(sel);
        const matched = templatesList.filter(t => templateMatches(t, dims));
        if (matched.length !== 1) return;
        const currentOutcome = matched[0].id;
        const enabled = getEnabledValues(sel, nextDim);
        for (const val of enabled) {
            const next = { ...sel, [nextDim.id]: val.id };
            cleanSelection(next);
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
        checkVanishUpward(sel);
        checkAppearAbove(sel);
        checkProgressiveVanish(sel);
        checkLockedAfterUnanswered(sel);
        checkStuck(sel);
        checkClickErased(sel);
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
        for (const dim of DIM_META) {
            if (TERMINAL_IDS.has(dim.id)) continue;
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
    const { errors, warnings, infos } = result;
    if (errors.length) {
        console.log(`  ERRORS (${errors.length}):`);
        for (const e of errors) console.log('    ✗ ' + e);
    }
    if (warnings.length) {
        console.log(`  WARNINGS (${warnings.length}):`);
        for (const w of warnings) console.log('    ⚠ ' + w);
    }
    if (infos.length) {
        console.log(`  INFO — known exceptions (${infos.length}):`);
        for (const i of infos) console.log('    ℹ ' + i);
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
        { name: 'PREMATURE OUTCOME', items: violations.premature, fmt: v => `    "${v.outcome}" matches but "${v.nextDim}" still unset` },
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
console.log(`${questions.questions.length} questions, ${templatesList.length} outcomes, ${DIM_META.length} dimensions\n`);

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
