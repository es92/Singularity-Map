#!/usr/bin/env node
// Unified validation for the Singularity Map decision tree
// Phase 1: Static analysis (routing, reachability, consistency, derivations, requires)
// Phase 2: Explorer simulation (DFS over all reachable states, invariant checks)
//
// Usage:
//   node validate.js          — run both phases
//   node validate.js --quick  — phase 1 only (fast)
//   node validate.js sample 5 — sample 5 random leaf paths

const fs = require('fs');
const path = require('path');
const { NODES, NODE_MAP } = require('./graph.js');
const {
    matchCondition, matchesDerivation, applyDerivations, resolvedVal,
    isNodeVisible, isNodeActivated, isNodeLocked, isEdgeDisabled,
    cleanSelection, applySelection, resolvedState, templateMatches, templatePartialMatch,
    getDisplayOrder
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

    const metaNodes = new Set(NODES.map(d => d.id));

    // 1. Node structure validation
    for (const node of NODES) {
        if (!node.id) errors.push(`[structure] Node missing id`);
        if (!node.edges || node.edges.length === 0) {
            errors.push(`[structure] Node "${node.id}" has no edges`);
        }
        if (node.activateWhen) {
            for (const cond of node.activateWhen) {
                for (const [k] of Object.entries(cond)) {
                    if (k.startsWith('_')) continue;
                    if (!metaNodes.has(k)) {
                        errors.push(`[structure] Node "${node.id}" activateWhen references unknown node "${k}"`);
                    }
                }
            }
        }
    }

    // Helper: validate keys/edges in a matchCondition-style condition object
    function validateCondition(cond, nodeId, label) {
        for (const [k, vals] of Object.entries(cond)) {
            if (k.startsWith('_')) continue;
            if (!metaNodes.has(k)) {
                errors.push(`[${label}] Node "${nodeId}" references unknown node "${k}"`);
            } else {
                const validIds = new Set(NODE_MAP[k].edges.map(v => v.id));
                const arr = Array.isArray(vals) ? vals : [vals];
                for (const v of arr) {
                    if (!validIds.has(v)) errors.push(`[${label}] Node "${nodeId}" references unknown edge "${k}=${v}"`);
                }
            }
        }
        for (const sk of ['_raw', '_eff', '_rawNot', '_effNot']) {
            if (!cond[sk]) continue;
            for (const [k, vals] of Object.entries(cond[sk])) {
                if (!metaNodes.has(k)) {
                    errors.push(`[${label}] Node "${nodeId}" references unknown node "${k}" in ${sk}`);
                } else {
                    const validIds = new Set(NODE_MAP[k].edges.map(v => v.id));
                    const arr = Array.isArray(vals) ? vals : [vals];
                    for (const v of arr) {
                        if (!validIds.has(v)) errors.push(`[${label}] Node "${nodeId}" references unknown edge "${k}=${v}" in ${sk}`);
                    }
                }
            }
        }
        for (const sk of ['_set', '_notSet']) {
            if (!cond[sk]) continue;
            for (const k of cond[sk]) {
                if (!metaNodes.has(k)) errors.push(`[${label}] Node "${nodeId}" references unknown node "${k}" in ${sk}`);
            }
        }
    }

    // Helper: validate keys/edges in a matchesDerivation-style rule
    function validateDerivation(rule, node) {
        const nodeId = node.id;
        const ownEdges = node.edges ? new Set(node.edges.map(v => v.id)) : new Set();
        for (const rk of ['when', 'unless']) {
            if (!rule[rk]) continue;
            for (const [k, val] of Object.entries(rule[rk])) {
                if (!metaNodes.has(k)) {
                    errors.push(`[derivations] Node "${nodeId}" references unknown node "${k}" in ${rk}`);
                } else {
                    const validIds = new Set(NODE_MAP[k].edges.map(v => v.id));
                    const vals = Array.isArray(val) ? val : [val];
                    for (const v of vals) {
                        if (!validIds.has(v)) warnings.push(`[derivations] Node "${nodeId}" references unreachable edge "${k}=${v}" in ${rk} (dead rule)`);
                    }
                }
            }
        }
        if (rule.effective) {
            for (const [k, val] of Object.entries(rule.effective)) {
                if (!metaNodes.has(k)) {
                    errors.push(`[derivations] Node "${nodeId}" references unknown node "${k}" in effective`);
                } else {
                    const validIds = new Set(NODE_MAP[k].edges.map(v => v.id));
                    const vals = Array.isArray(val) ? val : [val];
                    for (const v of vals) {
                        if (!validIds.has(v)) errors.push(`[derivations] Node "${nodeId}" references unknown edge "${k}=${v}" in effective`);
                    }
                }
            }
        }
        if (rule.whenSet && !metaNodes.has(rule.whenSet)) {
            errors.push(`[derivations] Node "${nodeId}" references unknown node "${rule.whenSet}" in whenSet`);
        }
        if (rule.fromDim && !metaNodes.has(rule.fromDim)) {
            errors.push(`[derivations] Node "${nodeId}" references unknown node "${rule.fromDim}" in fromDim`);
        }
        if (rule.value !== undefined && !ownEdges.has(rule.value)) {
            errors.push(`[derivations] Node "${nodeId}" derivation produces unknown edge "${rule.value}"`);
        }
        if (rule.valueMap) {
            for (const [from, to] of Object.entries(rule.valueMap)) {
                if (!ownEdges.has(from)) errors.push(`[derivations] Node "${nodeId}" valueMap references unknown input "${from}"`);
                if (!ownEdges.has(to)) errors.push(`[derivations] Node "${nodeId}" valueMap references unknown output "${to}"`);
            }
        }
    }

    // 2. Requires validation on node edges
    for (const node of NODES) {
        if (!node.edges) continue;
        for (const v of node.edges) {
            if (!v.requires) continue;
            const condSets = Array.isArray(v.requires) ? v.requires : [v.requires];
            for (const conds of condSets) {
                for (const [dk, vals] of Object.entries(conds)) {
                    if (dk.startsWith('_')) continue;
                    if (!metaNodes.has(dk)) {
                        errors.push(`[requires] Node "${node.id}" edge "${v.id}" requires unknown node "${dk}"`);
                    }
                    if (NODE_MAP[dk]) {
                        const validIds = new Set(NODE_MAP[dk].edges.map(vv => vv.id));
                        const arr = Array.isArray(vals) ? vals : [vals];
                        for (const vv of arr) {
                            if (!validIds.has(vv)) {
                                errors.push(`[requires] Node "${node.id}" edge "${v.id}" requires unknown edge "${dk}=${vv}"`);
                            }
                        }
                    }
                }
            }
        }
    }

    // 2d. disabledWhen validation (on edges)
    for (const node of NODES) {
        if (!node.edges) continue;
        for (const v of node.edges) {
            if (!v.disabledWhen) continue;
            for (const cond of v.disabledWhen) {
                validateCondition(cond, `${node.id}.${v.id}`, 'disabledWhen');
            }
        }
    }

    // 2e. derivedFrom validation
    for (const node of NODES) {
        if (!node.derivedFrom) continue;
        for (const rule of node.derivedFrom) {
            validateDerivation(rule, node);
        }
    }

    // 2g. Dead edge detection: requires contradicted by disabledWhen
    for (const node of NODES) {
        if (!node.edges) continue;
        for (const edge of node.edges) {
            if (!edge.requires || !edge.disabledWhen) continue;
            const reqSets = Array.isArray(edge.requires) ? edge.requires : [edge.requires];
            let allBlocked = true;
            for (const req of reqSets) {
                let blocked = false;
                for (const dis of edge.disabledWhen) {
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
                warnings.push(`[dead-edge] Node "${node.id}" edge "${edge.id}": every requires clause is contradicted by disabledWhen`);
            }
        }
    }

    // 2h. _notSet referencing derivable nodes (raw/effective asymmetry lint)
    // _set checks raw, _notSet checks effective — flag when _notSet targets a non-derived node with derivedFrom
    // Derived nodes are excluded: they only exist through derivations, so effective IS the only value.
    const derivableNodes = new Set(NODES.filter(d => d.derivedFrom && !d.derived).map(d => d.id));
    for (const node of NODES) {
        const condSources = [];
        if (node.activateWhen) for (const c of node.activateWhen) condSources.push(['activateWhen', c]);
        if (node.edges) {
            for (const v of node.edges) {
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
                if (derivableNodes.has(k)) {
                    warnings.push(`[raw-eff] Node "${node.id}" ${source} uses _notSet on "${k}" which has derivedFrom (checks effective, not raw)`);
                }
            }
        }
    }

    // 3. Derivation dependency / circular detection
    const derivationDeps = {};
    for (const node of NODES) {
        if (!node.derivedFrom) continue;
        const deps = new Set();
        for (const rule of node.derivedFrom) {
            if (rule.when) Object.keys(rule.when).forEach(k => deps.add(k));
            if (rule.unless) Object.keys(rule.unless).forEach(k => deps.add(k));
            if (rule.effective) Object.keys(rule.effective).forEach(k => deps.add('effective:' + k));
            if (rule.whenSet) deps.add(rule.whenSet);
        }
        derivationDeps[node.id] = deps;
    }

    const visibilityDeps = {};
    for (const node of NODES) {
        const deps = new Set();
        if (node.activateWhen) {
            for (const cond of node.activateWhen) {
                for (const [k] of Object.entries(cond)) {
                    if (k.startsWith('_')) continue;
                    deps.add('effective:' + k);
                }
                if (cond._raw) for (const k of Object.keys(cond._raw)) deps.add('raw:' + k);
                if (cond._eff) for (const k of Object.keys(cond._eff)) deps.add('effective:' + k);
            }
        }
        visibilityDeps[node.id] = deps;
    }

    for (const [nodeId, oDeps] of Object.entries(derivationDeps)) {
        for (const dep of oDeps) {
            if (!dep.startsWith('effective:')) continue;
            const depNode = dep.slice('effective:'.length);
            const vDeps = visibilityDeps[depNode];
            if (!vDeps) continue;
            if (vDeps.has('effective:' + nodeId)) {
                errors.push(`[circular] resolvedVal("${nodeId}") depends on resolvedVal("${depNode}"), and isNodeVisible("${depNode}") depends on resolvedVal("${nodeId}")`);
            }
        }
    }

    // 4. Outcome template node references
    for (const t of templatesList) {
        if (t.reachable) {
            const condList = Array.isArray(t.reachable) ? t.reachable : [t.reachable];
            for (const cond of condList) {
                for (const [dk] of Object.entries(cond)) {
                    if (!metaNodes.has(dk)) {
                        errors.push(`[outcome] Template "${t.id}" reachable references unknown node "${dk}"`);
                    }
                }
            }
        }
    }

    return { errors, warnings, derivationDeps };
}

// ════════════════════════════════════════════════════════
// Phase 2 — Explorer Simulation
// ════════════════════════════════════════════════════════

function selToUrl(sel) {
    const params = Object.entries(sel).filter(([k, v]) => v != null && k !== '_locked').map(([k, v]) => `${k}=${v}`).join('&');
    return `http://localhost:3000/#/explore${params ? '?' + params : ''}`;
}

function selKey(sel) {
    return Object.entries(sel).filter(([k, v]) => v != null && k !== '_locked').sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('&');
}

function getNextNode(sel) {
    for (const node of NODES) {
        if (node.terminal || node.derived) continue;
        if (!isNodeVisible(sel, node)) continue;
        if (isNodeLocked(sel, node) !== null) continue;
        if (sel[node.id]) continue;
        return node;
    }
    return null;
}

function getEnabledEdges(sel, node) {
    return node.edges.filter(v => !isEdgeDisabled(sel, node, v));
}

const FORWARD_KEY_NODES = NODES.filter(d => d.forwardKey).map(d => d.id);

function forwardKey(sel) {
    const parts = [];
    const state = resolvedState(sel);
    for (const k of FORWARD_KEY_NODES) {
        if (state[k]) parts.push(`E:${k}=${state[k]}`);
    }
    for (const node of NODES) {
        if (!node.derivedFrom) continue;
        const raw = sel[node.id];
        const eff = state[node.id];
        if (raw && eff && raw !== eff) {
            parts.push(`R:${node.id}=${raw}`);
        }
    }
    for (const node of NODES) {
        if (node.terminal || node.derived) continue;
        if (!isNodeVisible(sel, node)) continue;
        if (isNodeLocked(sel, node) !== null) continue;
        if (sel[node.id]) continue;
        const enabled = getEnabledEdges(sel, node).map(v => v.id);
        parts.push(`${node.id}?${enabled.join(',')}`);
    }
    return parts.join('|');
}

function runExplorer() {
    const violations = { deadEnd: [], ambiguous: [], stuck: [], singleOption: [], clickErased: [], answerGap: [] };
    const warnings = {};
    const seen = { clickErased: new Set(), answerGap: new Set() };

    function checkLeaf(sel) {
        const state = resolvedState(sel);
        const matched = templatesList.filter(t => templateMatches(t, state));
        if (matched.length === 0) violations.deadEnd.push({ url: selToUrl(sel) });
        else if (matched.length > 1) violations.ambiguous.push({ outcomes: matched.map(t => t.id), url: selToUrl(sel) });
    }

    function runChecks(sel) {
        const N = NODES.length;
        for (let i = 0; i < N; i++) {
            const node = NODES[i];
            if (node.derived) continue;
            if (!isNodeVisible(sel, node)) continue;
            if (isNodeLocked(sel, node) !== null) continue;
            if (sel[node.id]) continue;
            const ena = getEnabledEdges(sel, node);
            if (ena.length === 0) {
                const reasons = [];
                for (const v of node.edges) {
                    if (v.disabledWhen && v.disabledWhen.some(c => matchCondition(sel, c, {}))) {
                        reasons.push(`"${v.id}" disabled by disabledWhen`);
                    } else if (v.requires) {
                        const rs = Array.isArray(v.requires) ? v.requires : [v.requires];
                        if (!rs.some(c => matchCondition(sel, c, {}))) reasons.push(`"${v.id}" blocked by requires`);
                    }
                }
                violations.stuck.push({ node: node.id, url: selToUrl(sel), mechanism: reasons.join('; ') });
            }
            if (ena.length === 1) violations.singleOption.push({ node: node.id, edge: ena[0].id, url: selToUrl(sel) });

            for (const edge of ena) {
                if (sel[node.id] === edge.id) continue;
                const next = { ...sel, _locked: { ...(sel._locked || {}) } };
                applySelection(next, node.id, edge.id);
                if (!next[node.id]) {
                    const vk = `${node.id}:${edge.id}`;
                    if (!seen.clickErased.has(vk)) {
                        seen.clickErased.add(vk);
                        violations.clickErased.push({ node: node.id, edge: edge.id, url: selToUrl(sel) });
                    }
                }

            }
        }
    }

    // DFS with forward-key deduplication + edge coverage tracking
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

        for (const node of NODES) {
            if (sel[node.id]) {
                const key = `${node.id}=${sel[node.id]}`;
                if (isNodeLocked(sel, node) !== null) autoLocked.add(key);
                else userSelected.add(key);
            }
            if (node.derivedFrom) {
                const eff = resolvedVal(sel, node.id);
                if (eff) autoLocked.add(`${node.id}=${eff}`);
            }
        }

        runChecks(sel);

        const order = getDisplayOrder(sel);
        let firstGap = null;
        for (const dNode of order) {
            const locked = isNodeLocked(sel, dNode);
            const hasValue = sel[dNode.id] || locked;
            const isUserAnswered = sel[dNode.id] && !(sel._locked && sel._locked[dNode.id]);
            if (!hasValue && !firstGap) {
                firstGap = dNode.id;
            } else if (isUserAnswered && firstGap) {
                const vk = `${firstGap}:${dNode.id}`;
                if (!seen.answerGap.has(vk)) {
                    seen.answerGap.add(vk);
                    violations.answerGap.push({
                        node: dNode.id,
                        gapNode: firstGap,
                        url: selToUrl(sel),
                    });
                }
                break;
            }
        }

        const next = getNextNode(sel);
        if (next) {
            for (const edge of getEnabledEdges(sel, next)) {
                const copy = { ...sel, _locked: { ...(sel._locked || {}) } };
                applySelection(copy, next.id, edge.id);
                cleanSelection(copy);
                stack.push(copy);
            }
        } else {
            totalLeaves++;
            checkLeaf(sel);
        }
    }

    const coverage = { userSelected, autoLocked };
    return { violations, warnings, totalStates, totalLeaves, dedupSaved, rawUnique: rawVisited.size, coverage };
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

        const next = getNextNode(sel);
        if (next) {
            for (const edge of getEnabledEdges(sel, next)) {
                const copy = { ...sel, _locked: { ...(sel._locked || {}) } };
                applySelection(copy, next.id, edge.id);
                cleanSelection(copy);
                stack.push(copy);
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
        const state = resolvedState(sel);
        const matched = templatesList.filter(t => templateMatches(t, state));
        const outcome = matched.length === 1 ? matched[0] : null;

        console.log(`━━━ Path ${p + 1} ━━━`);

        const steps = [];
        for (const node of NODES) {
            if (node.terminal || node.derived) continue;
            if (!isNodeVisible(sel, node)) continue;
            const locked = isNodeLocked(sel, node);
            if (locked !== null) {
                const edge = node.edges.find(v => v.id === locked);
                steps.push(`  ${node.label}: ${edge ? edge.label : locked} [locked]`);
            } else if (sel[node.id]) {
                const edge = node.edges.find(v => v.id === sel[node.id]);
                steps.push(`  ${node.label}: ${edge ? edge.label : sel[node.id]}`);
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
        { name: 'STUCK NODE (visible, 0 enabled edges)', items: violations.stuck, fmt: v => `    "${v.node}" is visible but has no selectable edges${v.mechanism ? '\n      Because: ' + v.mechanism : ''}` },
        { name: 'UNLOCKED SINGLE OPTION', items: violations.singleOption, fmt: v => `    "${v.node}" has only "${v.edge}" enabled but is not locked` },
        { name: 'CLICK ERASED', items: violations.clickErased, fmt: v => `    Click "${v.node}=${v.edge}" → immediately cleared` },
        { name: 'DISPLAY-ORDER GAP (answered after unanswered)', items: violations.answerGap, fmt: v => `    "${v.node}" answered after unanswered "${v.gapNode}"` },
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
    let totalChoice = 0, totalTerminal = 0, totalDerived = 0;
    const unreachedChoice = [], unreachedTerminal = [], unreachedDerived = [];
    for (const node of NODES) {
        if (!node.edges) continue;
        for (const edge of node.edges) {
            const key = `${node.id}=${edge.id}`;
            const reached = allReached.has(key);
            const entry = { node: node.id, edge: edge.id, hasRequires: !!edge.requires };
            if (node.derived) {
                totalDerived++;
                if (!reached) unreachedDerived.push(entry);
            } else if (node.terminal) {
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
    console.log(`  Choice nodes:   ${fmt(totalChoice - unreachedChoice.length, totalChoice)} edges reached`);
    console.log(`  Terminal nodes:  ${fmt(totalTerminal - unreachedTerminal.length, totalTerminal)} edges reached (not explored by DFS)`);
    console.log(`  Derived nodes:   ${fmt(totalDerived - unreachedDerived.length, totalDerived)} edges reached via derivations`);
    const lockedOnly = [...autoLocked].filter(k => !userSelected.has(k)).sort();
    if (lockedOnly.length) {
        console.log(`  ${lockedOnly.length} edges reached only via auto-lock/derivation (never user-selectable):`);
        for (const k of lockedOnly) console.log(`    ${k}`);
    }
    if (unreachedChoice.length) {
        console.log(`  Unreached choice edges (${unreachedChoice.length}):`);
        for (const u of unreachedChoice) {
            const tag = u.hasRequires ? '(has requires)' : '(no requires — forward-key dedup?)';
            console.log(`    "${u.node}" → "${u.edge}" ${tag}`);
        }
    }
    if (unreachedDerived.length) {
        console.log(`  Unreached derived edges (${unreachedDerived.length}):`);
        for (const u of unreachedDerived) console.log(`    "${u.node}" → "${u.edge}"`);
    }
    if (!unreachedChoice.length && !unreachedDerived.length) {
        console.log('  ✓ All choice + derived edges reached');
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
console.log(`${NODES.filter(d => !d.derived && !d.terminal).length} non-derived nodes, ${templatesList.length} outcomes, ${NODES.length} total nodes\n`);

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
console.log('Phase 3: Edge Coverage');
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
