#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const {
    DIM_META, DIM_MAP, decelOutcome, effectiveVal,
    isDimVisible, isDimLocked, isValueDisabled,
    cleanSelection, effectiveDims, templateMatches, templatePartialMatch
} = require('./logic.js');

const outcomes = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'outcomes.json'), 'utf-8'));
const templatesList = outcomes.templates;

// --- Helpers ---

function selToUrl(sel) {
    const params = Object.entries(sel).filter(([, v]) => v != null).map(([k, v]) => `${k}=${v}`).join('&');
    return `http://localhost:3000/#/explore${params ? '?' + params : ''}`;
}

function selKey(sel) {
    return Object.entries(sel).filter(([, v]) => v != null).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('&');
}

const TERMINAL_IDS = new Set([
    'knowledge_replacement', 'physical_automation',
    'economic_distribution', 'plateau_knowledge_rate', 'plateau_physical_rate',
    'automation_distribution', 'auto_knowledge_rate', 'auto_physical_rate'
]);

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

// --- Invariant checks ---

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
                if (alignBefore !== alignAfter && newDim.visibleWhen && newDim.visibleWhen.alignment) continue;
                if (containBefore !== containAfter && newDim.visibleWhen && newDim.visibleWhen.containment) continue;
                if (next.ai_goals === 'marginal' && answeredRef.has('ai_goals')
                    && newDim.visibleWhen && newDim.visibleWhen.alignment
                    && !newDim.visibleWhen.alignment.includes('failed')) continue;

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
        violations.lockedAfterUnanswered.push({
            unanswered: DIM_META[firstUnansweredIdx].id,
            locked: dim.id,
            url: selToUrl(sel)
        });
    }
}

function checkStuck(sel) {
    for (const dim of DIM_META) {
        if (!isDimVisible(sel, dim)) continue;
        if (isDimLocked(sel, dim) !== null) continue;
        if (sel[dim.id]) continue;
        const enabled = getEnabledValues(sel, dim);
        if (enabled.length === 0) {
            violations.stuck.push({ dim: dim.id, url: selToUrl(sel) });
        }
        if (enabled.length === 1) {
            violations.singleOption.push({ dim: dim.id, val: enabled[0].id, url: selToUrl(sel) });
        }
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
    if (matched.length === 0) {
        violations.deadEnd.push({ url: selToUrl(sel) });
    } else if (matched.length > 1) {
        violations.ambiguous.push({ outcomes: matched.map(t => t.id), url: selToUrl(sel) });
    }
}

function runChecks(sel) {
    checkVanishUpward(sel);
    checkAppearAbove(sel);
    checkProgressiveVanish(sel);
    checkLockedAfterUnanswered(sel);
    checkStuck(sel);
    checkClickErased(sel);
}

// --- DFS with forward-key deduplication ---

let totalStates = 0;
let totalLeaves = 0;

function explore(startSel) {
    const visited = new Set();
    const rawVisited = new Set();
    const stack = [{ ...startSel }];
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

    console.log(`\r  Forward-key dedup: ${totalStates} explored, ${dedupSaved} merged (${rawVisited.size} raw unique states)`);
}

// --- Sample paths mode ---

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

// --- Main ---

const mode = process.argv[2];

if (mode === 'sample') {
    const n = parseInt(process.argv[3]) || 5;
    console.log('Singularity Map Explorer — Path Sampler\n');
    samplePaths(n);
} else {
    console.log('Singularity Map Explorer — Invariant Checker');
    console.log(`${DIM_META.length} dimensions, ${templatesList.length} outcome templates\n`);

    const t0 = Date.now();
    explore({});
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

    console.log(`\r  Done: ${totalStates.toLocaleString()} unique forward-states, ${totalLeaves.toLocaleString()} leaves in ${elapsed}s\n`);

    const cats = [
        { name: 'DEAD-END LEAF (no outcome)', items: violations.deadEnd, fmt: v => `  No outcome matches at leaf` },
        { name: 'AMBIGUOUS LEAF (multiple outcomes)', items: violations.ambiguous, fmt: v => `  ${v.outcomes.length} outcomes: [${v.outcomes.join(', ')}]` },
        { name: 'STUCK DIM (visible, 0 enabled values)', items: violations.stuck, fmt: v => `  "${v.dim}" is visible but has no selectable values` },
        { name: 'UNLOCKED SINGLE OPTION (should be auto-locked)', items: violations.singleOption, fmt: v => `  "${v.dim}" has only "${v.val}" enabled but is not locked` },
        { name: 'ROW VANISHES UPWARD', items: violations.vanish, fmt: v => `  Click "${v.dim}=${v.val}" → "${v.vanished}" vanishes` },
        { name: 'PROGRESSIVE DISCLOSURE VANISH (row above disappears from screen)', items: violations.progressiveVanish, fmt: v => `  Click "${v.dim}=${v.val}" → "${v.vanished}" hidden by progressive disclosure` },
        { name: 'ROW APPEARS ABOVE ANSWERED', items: violations.appearAboveAnswered, fmt: v => `  Click "${v.dim}=${v.val}" → "${v.appeared}" appears above a row with an answer` },
        { name: 'CLICK ERASED (value removed by cleanSelection)', items: violations.clickErased, fmt: v => `  Click "${v.dim}=${v.val}" → immediately cleared` },
        { name: 'PREMATURE OUTCOME (shown before all choices made)', items: violations.premature, fmt: v => `  "${v.outcome}" matches but "${v.nextDim}" still unset and can change result` },
    ];

    let total = 0;
    for (const cat of cats) {
        if (cat.items.length === 0) continue;
        total += cat.items.length;
        console.log(`━━━ ${cat.name} (${cat.items.length}) ━━━`);
        for (const v of cat.items) {
            console.log(cat.fmt(v));
            console.log(`  ${v.url}\n`);
        }
    }

    const info = [
        { name: 'LOCKED LEAKS PAST UNANSWERED (handled by progressive disclosure)', items: violations.lockedAfterUnanswered, fmt: v => `  "${v.locked}" is auto-locked but appears after unanswered "${v.unanswered}"` },
    ];
    for (const cat of info) {
        if (cat.items.length === 0) continue;
        console.log(`━━━ ${cat.name} (${cat.items.length}) ━━━`);
        for (const v of cat.items) {
            console.log(cat.fmt(v));
            console.log(`  ${v.url}\n`);
        }
    }

    if (total === 0) console.log('No violations found!');
    else console.log(`\n${total} violation(s) found across ${totalStates.toLocaleString()} states.`);
}
