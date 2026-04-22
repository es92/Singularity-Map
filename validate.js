#!/usr/bin/env node
// validate2.js — Graph validator using equivalence-class superposition DFS
//
// Phase 1: Static analysis (structure, references, dead edges, circular deps)
// Phase 2: DFS traversal with per-state invariant checks
// Phase 3: Personal vignette validation
//
// Usage:
//   node validate2.js          — run all phases
//   node validate2.js --quick  — phase 1 only

const fs = require('fs');
const path = require('path');
const { NODES, NODE_MAP } = require('./graph.js');
const {
    matchCondition, resolvedVal, resolvedState: engineResolvedState,
    isNodeVisible, isNodeActivatedByRules, isNodeLocked, isEdgeDisabled,
    templateMatches,
    createStack, push, currentState, stackHas, displayOrder
} = require('./engine.js');
const { walk, resolvedState, dimOrder, classes, derivedDimSet, setTemplates, irrKey, safePushDims } = require('./graph-walker.js');
const { cleanSelection } = require('./engine.js');
const { resolvePersonalVignetteText, getCountryBucket } = require('./milestone-utils.js');

let _outcomes, _narrative, _personalData, _defaultTemplates;
function _loadData() {
    if (!_outcomes) {
        _outcomes = JSON.parse(fs.readFileSync(path.join(__dirname, 'data/outcomes.json'), 'utf8'));
        _narrative = JSON.parse(fs.readFileSync(path.join(__dirname, 'data/narrative.json'), 'utf8'));
        _personalData = JSON.parse(fs.readFileSync(path.join(__dirname, 'data/personal.json'), 'utf8'));
        _defaultTemplates = _outcomes.templates;
    }
}

// ════════════════════════════════════════════════════════
// Phase 1 — Static Analysis (ported from validate.js)
// ════════════════════════════════════════════════════════

function runStaticAnalysis(templates) {
    if (!templates) { _loadData(); templates = _defaultTemplates; }
    const errors = [];
    const metaNodes = new Set(NODES.map(d => d.id));

    // Synthetic dims + values are written via `collapseToFlavor.set` and
    // `deriveWhen.value/.valueMap` — they exist at runtime without being
    // declared as graph nodes or edges. Collect both so conditions that
    // reference them (`hideWhen: { open_source_set: ['yes'] }`,
    // `requires: { geo_spread: ['multiple'] }`, etc.) don't false-flag.
    //   metaNodes              — valid dim keys (real nodes ∪ marker dims)
    //   extraValuesByDim[dim]  — values that aren't edge ids but are
    //                            produced by collapseToFlavor.set or derive.
    const extraValuesByDim = new Map();
    const addExtra = (dim, val) => {
        if (val == null) return;
        if (!extraValuesByDim.has(dim)) extraValuesByDim.set(dim, new Set());
        extraValuesByDim.get(dim).add(val);
    };
    for (const node of NODES) {
        // deriveWhen on this node can set its own value to a non-edge string
        // (e.g. geo_spread derives to 'multiple').
        if (node.deriveWhen) {
            for (const rule of node.deriveWhen) {
                if (rule.value !== undefined) addExtra(node.id, rule.value);
                if (rule.valueMap) {
                    for (const out of Object.values(rule.valueMap)) addExtra(node.id, out);
                }
            }
        }
        if (!node.edges) continue;
        for (const edge of node.edges) {
            if (!edge.collapseToFlavor) continue;
            const blocks = Array.isArray(edge.collapseToFlavor) ? edge.collapseToFlavor : [edge.collapseToFlavor];
            for (const c of blocks) {
                if (!c || !c.set) continue;
                for (const [dim, val] of Object.entries(c.set)) {
                    metaNodes.add(dim);
                    addExtra(dim, val);
                }
            }
        }
    }

    // Return the set of runtime-valid values for a dim (edges ∪ extras).
    // Returns null for pure marker dims that have no edges — callers should
    // skip value validation in that case (we accept any value for them).
    function validValuesFor(dimId) {
        const refNode = NODE_MAP[dimId];
        const extras = extraValuesByDim.get(dimId);
        if (!refNode || !refNode.edges) {
            return extras ? new Set(extras) : null; // null = skip value check
        }
        const s = new Set(refNode.edges.map(v => v.id));
        if (extras) for (const e of extras) s.add(e);
        return s;
    }

    function validateCondition(cond, nodeId, label) {
        for (const [k, vals] of Object.entries(cond)) {
            if (k === 'reason' || k.startsWith('_')) continue;
            if (!metaNodes.has(k)) {
                errors.push(`[${label}] "${nodeId}" references unknown node "${k}"`);
                continue;
            }
            if (vals === true || vals === false) continue;
            const validIds = validValuesFor(k);
            if (!validIds) continue; // pure marker dim — accept any value
            if (vals && typeof vals === 'object' && !Array.isArray(vals) && vals.not) {
                for (const v of vals.not) {
                    if (!validIds.has(v)) errors.push(`[${label}] "${nodeId}" references unknown edge "${k}=${v}" in not`);
                }
                continue;
            }
            const arr = Array.isArray(vals) ? vals : [vals];
            for (const v of arr) {
                if (!validIds.has(v)) errors.push(`[${label}] "${nodeId}" references unknown edge "${k}=${v}"`);
            }
        }
    }

    // 1. Node structure
    for (const node of NODES) {
        if (!node.id) errors.push(`[structure] Node missing id`);
        if (!node.edges || node.edges.length === 0) errors.push(`[structure] "${node.id}" has no edges`);
        if (node.activateWhen) {
            for (const cond of node.activateWhen) validateCondition(cond, node.id, 'activateWhen');
        }
        if (node.hideWhen) {
            for (const cond of node.hideWhen) validateCondition(cond, node.id, 'hideWhen');
        }
    }

    // 2. Requires and disabledWhen validation
    for (const node of NODES) {
        if (!node.edges) continue;
        for (const v of node.edges) {
            if (v.requires) {
                const condSets = Array.isArray(v.requires) ? v.requires : [v.requires];
                for (const cond of condSets) validateCondition(cond, `${node.id}.${v.id}`, 'requires');
            }
            if (v.disabledWhen) {
                for (const cond of v.disabledWhen) validateCondition(cond, `${node.id}.${v.id}`, 'disabledWhen');
            }
        }
    }

    // 3. deriveWhen validation
    for (const node of NODES) {
        if (!node.deriveWhen) continue;
        const ownValues = validValuesFor(node.id) || new Set();
        for (const rule of node.deriveWhen) {
            if (rule.match) {
                for (const [k, val] of Object.entries(rule.match)) {
                    if (k === 'reason') continue;
                    if (!metaNodes.has(k)) { errors.push(`[derivations] "${node.id}" references unknown node "${k}" in match`); continue; }
                    if (val === true || val === false) continue;
                    const validIds = validValuesFor(k);
                    if (!validIds) continue;
                    if (val && typeof val === 'object' && !Array.isArray(val) && val.not) {
                        for (const v of val.not) {
                            if (!validIds.has(v)) errors.push(`[derivations] "${node.id}" unknown edge "${k}=${v}" in match.not`);
                        }
                        continue;
                    }
                    const vals = Array.isArray(val) ? val : [val];
                    for (const v of vals) {
                        if (!validIds.has(v)) errors.push(`[derivations] "${node.id}" unknown edge "${k}=${v}" in match`);
                    }
                }
            }
            if (rule.fromState && !metaNodes.has(rule.fromState)) {
                errors.push(`[derivations] "${node.id}" unknown node "${rule.fromState}" in fromState`);
            }
            if (rule.value !== undefined && !ownValues.has(rule.value)) {
                errors.push(`[derivations] "${node.id}" produces unknown edge "${rule.value}"`);
            }
            if (rule.valueMap) {
                for (const [from, to] of Object.entries(rule.valueMap)) {
                    if (!ownValues.has(from)) errors.push(`[derivations] "${node.id}" valueMap unknown input "${from}"`);
                    if (!ownValues.has(to)) errors.push(`[derivations] "${node.id}" valueMap unknown output "${to}"`);
                }
            }
        }
    }

    // 4. Dead edge detection: requires contradicted by disabledWhen
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
                errors.push(`[dead-edge] "${node.id}" edge "${edge.id}": every requires contradicted by disabledWhen`);
            }
        }
    }

    // 5. Outcome template references
    for (const t of templates) {
        if (!t.reachable) continue;
        for (const cond of (Array.isArray(t.reachable) ? t.reachable : [t.reachable])) {
            for (const [dk, dv] of Object.entries(cond)) {
                if (dk === '_not') {
                    for (const nk of Object.keys(dv)) {
                        if (!metaNodes.has(nk)) errors.push(`[outcome] "${t.id}" references unknown node "${nk}" in _not`);
                    }
                    continue;
                }
                if (!metaNodes.has(dk)) errors.push(`[outcome] "${t.id}" references unknown node "${dk}"`);
            }
        }
    }

    return { errors };
}

function selToUrl(sel) {
    const params = Object.entries(sel).filter(([, v]) => v != null).map(([k, v]) => `${k}=${v}`).join('&');
    return `http://localhost:3000/#/explore${params ? '?' + params : ''}`;
}

// ════════════════════════════════════════════════════════
// Phase 2 — DFS Traversal with Invariant Checks
// ════════════════════════════════════════════════════════

function runTraversal(templates, opts = {}) {
    if (!templates) { _loadData(); templates = _defaultTemplates; }
    setTemplates(templates);
    const quiet = opts.quiet || false;
    const violations = {
        deadEnd: [],
        reDerivedDeadEnd: [],
        ambiguous: [],
        stuck: [],
        singleOption: [],
        clickErased: new Map(),
        stackIntegrity: [],
    };
    const seenStackKeys = new Set();
    const edgesReached = new Set();

    function onVisit(sel, stk, { ck, nextNode, enabled }) {
        for (const node of NODES) {
            if (sel[node.id]) {
                edgesReached.add(`${node.id}=${sel[node.id]}`);
            }
            if (node.deriveWhen) {
                const eff = resolvedVal(sel, node.id);
                if (eff) edgesReached.add(`${node.id}=${eff}`);
            }
        }

        // Stack integrity: displayOrder's answered section must match stack order
        const order = displayOrder(stk);
        const expectedIds = stk
            .filter(e => e.nodeId && NODE_MAP[e.nodeId] && !NODE_MAP[e.nodeId].derived)
            .map(e => e.nodeId);
        let seenUnanswered = false, ansIdx = 0, integrityBroken = false;
        for (const node of order) {
            const onStack = stackHas(stk, node.id);
            if (onStack) {
                if (seenUnanswered || expectedIds[ansIdx] !== node.id) {
                    integrityBroken = true;
                    break;
                }
                ansIdx++;
            } else {
                seenUnanswered = true;
            }
        }
        if (integrityBroken) {
            const sk = Object.entries(sel).filter(([,v]) => v != null).sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => `${k}=${v}`).join('&');
            if (!seenStackKeys.has(sk)) {
                seenStackKeys.add(sk);
                violations.stackIntegrity.push({
                    expected: expectedIds,
                    actual: order.filter(n => stackHas(stk, n.id)).map(n => n.id),
                    sel: { ...sel },
                    url: selToUrl(sel),
                });
            }
        }

        if (!nextNode) return;

        for (const n of NODES) {
            if (n.derived) continue;
            if (sel[n.id]) continue;
            if (!isNodeVisible(sel, n)) continue;
            if (isNodeLocked(sel, n) !== null) continue;
            if (!n.edges || n.edges.length === 0) continue;
            const ena = n.edges.filter(e => !isEdgeDisabled(sel, n, e));
            if (ena.length === 0) {
                violations.stuck.push({ node: n.id, sel: { ...sel }, url: selToUrl(sel) });
            }
        }

        if (nextNode && enabled.length === 1 && isNodeLocked(sel, nextNode) === null) {
            violations.singleOption.push({ node: nextNode.id, edge: enabled[0].id, url: selToUrl(sel) });
        }

        if (nextNode) {
            for (const edge of enabled) {
                const vk = `${nextNode.id}:${edge.id}`;
                if (violations.clickErased.has(vk)) continue;
                const testState = currentState(push(stk, nextNode.id, edge.id));
                if (!testState[nextNode.id]) {
                    violations.clickErased.set(vk, { node: nextNode.id, edge: edge.id, url: selToUrl(sel) });
                }
            }
        }
    }

    function onPush(sel, nodeId, edgeId) {
        edgesReached.add(`${nodeId}=${edgeId}`);
    }

    function isTerminal(sel) {
        const state = resolvedState(sel);
        const matched = templates.filter(t => templateMatches(t, state));
        if (matched.length > 1) {
            violations.ambiguous.push({ outcomes: matched.map(t => t.id), sel: { ...sel }, url: selToUrl(sel) });
        }
        return matched.length > 0;
    }

    const result = walk({ isTerminal, onVisit, onPush, quiet });

    for (const de of result.deadEnds) {
        violations.deadEnd.push({ ...de, url: selToUrl(de.sel) });
    }

    // Re-derived dead end: at dead ends, check if overriding derivations reveals hidden questions
    for (const de of result.deadEnds) {
        const sel = de.sel;
        const splits = [];
        for (const node of NODES) {
            if (!node.deriveWhen) continue;
            const raw = sel[node.id];
            if (!raw) continue;
            const eff = resolvedVal(sel, node.id);
            if (eff && eff !== raw) splits.push({ node: node.id, raw, eff });
        }
        if (splits.length > 0) {
            const effSel = Object.assign({}, sel);
            for (const s of splits) effSel[s.node] = s.eff;
            let next = null;
            for (const node of NODES) {
                if (node.derived) continue;
                if (!isNodeVisible(effSel, node)) continue;
                if (isNodeLocked(effSel, node) !== null) continue;
                if (effSel[node.id]) continue;
                next = node;
                break;
            }
            if (next) {
                violations.reDerivedDeadEnd.push({
                    splits: splits.map(s => `${s.node}: ${s.raw}→${s.eff}`),
                    hiddenQuestion: next.id,
                    sel: { ...sel },
                    url: selToUrl(sel),
                });
            }
        }
    }

    return { violations, edgesReached, ...result };
}

// ════════════════════════════════════════════════════════
// Phase 4 — Browser reach-set invariant
// ════════════════════════════════════════════════════════
//
// Audits the consistency between what the browser's `wouldReachOutcome`
// advertises (via `reachSet.has(irrKey(lightPush(sel, n, e)))`) and the
// state the user actually lands in after `Engine.push` (which is how the
// UI commits a click).
//
// For every reach set in data/reach/*.json:
//   FP (dead-end): lightKey ∈ reachSet but commitKey ∉ reachSet
//                  → UI says "reachable", click lands in a dead end.
//   FN (hidden):   lightKey ∉ reachSet but commitKey ∈ reachSet
//                  → UI hides a path that is actually reachable.
//
// Bounded DFS (default 100k states) — hitting the cap still gives useful
// partial coverage; we flag truncation in the report.

function runReachInvariantCheck(templates, opts = {}) {
    if (!templates) { _loadData(); templates = _defaultTemplates; }
    setTemplates(templates);

    const maxStates = opts.maxStates || 100000;
    const samplePerBucket = opts.samplePerBucket || 5;

    const reachDir = path.join(__dirname, 'data/reach');
    const reachSets = [];
    if (fs.existsSync(reachDir)) {
        const files = fs.readdirSync(reachDir)
            .filter(f => f.endsWith('.json') && !f.endsWith('.gz'))
            .sort();
        for (const f of files) {
            const id = f.replace(/\.json$/, '');
            const arr = JSON.parse(fs.readFileSync(path.join(reachDir, f), 'utf8'));
            reachSets.push({ id, set: new Set(arr) });
        }
    }
    if (reachSets.length === 0) {
        return { skipped: true, reason: 'No data/reach/*.json files found (run: node precompute-reachability.js)' };
    }

    function doLightPush(sel, nodeId, edgeId) {
        const next = Object.assign({}, sel);
        next[nodeId] = edgeId;
        if (!safePushDims.has(nodeId)) {
            cleanSelection(next);
        }
        return next;
    }

    function selKey(sel) {
        const parts = [];
        for (const n of NODES) if (sel[n.id] != null) parts.push(n.id + '=' + sel[n.id]);
        return parts.join('|');
    }

    // Advance past forced/locked nodes the same way the browser's
    // findNextQuestion does, and return the first real decision point
    // (unanswered, visible, enabled.length >= 1).
    function nextDecision(stack) {
        while (true) {
            const sel = currentState(stack);
            let advanced = false;
            let decision = null;
            for (const node of displayOrder(stack)) {
                const locked = isNodeLocked(sel, node);
                if (locked !== null) {
                    if (!stackHas(stack, node.id)) {
                        stack = push(stack, node.id, locked);
                        advanced = true;
                        break;
                    }
                    continue;
                }
                if (stackHas(stack, node.id)) continue;
                if (sel[node.id]) continue;
                if (!node.edges || node.edges.length === 0) continue;
                const enabled = node.edges.filter(e => !isEdgeDisabled(sel, node, e));
                if (enabled.length === 0) continue;
                decision = { node, enabled, sel, stack };
                break;
            }
            if (decision) return decision;
            if (!advanced) return null;
        }
    }

    const perOutcome = {};
    for (const { id } of reachSets) {
        perOutcome[id] = { fp: [], fn: [], fpCount: 0, fnCount: 0, checked: 0 };
    }

    const seen = new Set();
    const t0 = Date.now();
    let visited = 0;
    let decisions = 0;
    let edgesChecked = 0;
    let truncated = false;

    function dfs(stk) {
        if (truncated) return;
        const sel = currentState(stk);
        const sk = selKey(sel);
        if (seen.has(sk)) return;
        seen.add(sk);
        visited++;
        if (visited >= maxStates) { truncated = true; return; }

        const decision = nextDecision(stk);
        if (!decision) return;
        decisions++;
        const { node, enabled, sel: decSel, stack: decStack } = decision;

        for (const edge of enabled) {
            if (truncated) return;
            const lightSel = doLightPush(decSel, node.id, edge.id);
            const lightKey = irrKey(lightSel);

            const childStack = push(decStack, node.id, edge.id);
            const commitSel = currentState(childStack);
            const commitKey = irrKey(commitSel);
            edgesChecked++;

            for (const rs of reachSets) {
                const o = perOutcome[rs.id];
                o.checked++;
                const lightReach = rs.set.has(lightKey);
                const commitReach = rs.set.has(commitKey);
                if (lightReach === commitReach) continue;
                if (lightReach && !commitReach) {
                    o.fpCount++;
                    if (o.fp.length < samplePerBucket) {
                        o.fp.push({ at: decSel, node: node.id, edge: edge.id, lightKey, commitKey, commitSel });
                    }
                } else {
                    o.fnCount++;
                    if (o.fn.length < samplePerBucket) {
                        o.fn.push({ at: decSel, node: node.id, edge: edge.id, lightKey, commitKey, commitSel });
                    }
                }
            }

            dfs(childStack);
        }
    }

    dfs(createStack());

    const elapsed = Date.now() - t0;
    let totalFP = 0, totalFN = 0;
    for (const o of Object.values(perOutcome)) { totalFP += o.fpCount; totalFN += o.fnCount; }

    return {
        reachSetIds: reachSets.map(r => r.id),
        visited, decisions, edgesChecked,
        truncated, maxStates,
        totalFP, totalFN,
        perOutcome, elapsed,
    };
}

// ════════════════════════════════════════════════════════
// Phase 3 — Personal Vignette Validation
// ════════════════════════════════════════════════════════

const TEST_PERSONAS = [
    { profession: 'software', country: 'United States', is_ai_geo: 'yes' },
    { profession: 'healthcare', country: 'Germany', is_ai_geo: 'no' },
    { profession: 'trade', country: 'Nigeria', is_ai_geo: 'no' },
    { profession: 'government', country: 'China', is_ai_geo: 'yes' },
];

function runVignetteValidation() {
    _loadData();
    const narrative = _narrative, personalData = _personalData;
    const errors = [];
    const warnings = [];

    // _when condition validation
    for (const [nodeId, node] of Object.entries(narrative)) {
        if (!node.values) continue;
        for (const [edgeId, edge] of Object.entries(node.values)) {
            const pv = edge.personalVignette;
            if (!pv) continue;
            if (pv._when) {
                for (let i = 0; i < pv._when.length; i++) {
                    const rule = pv._when[i];
                    if (!rule.if) { errors.push(`[vignettes] ${nodeId}.${edgeId} _when[${i}]: missing "if" condition`); continue; }
                    if (!rule.text && rule.text !== null) errors.push(`[vignettes] ${nodeId}.${edgeId} _when[${i}]: missing "text" field`);
                    const validKeys = new Set(['profession', 'country_bucket', 'is_ai_geo', ...NODES.map(n => n.id)]);
                    for (const [k, vals] of Object.entries(rule.if)) {
                        if (!validKeys.has(k)) warnings.push(`[vignettes] ${nodeId}.${edgeId} _when[${i}]: condition key "${k}" is not a known dimension`);
                        if (!Array.isArray(vals)) errors.push(`[vignettes] ${nodeId}.${edgeId} _when[${i}]: condition "${k}" must be an array`);
                    }
                }
            }
            if (!pv._default && (!pv._when || pv._when.length === 0) && typeof pv !== 'string') {
                errors.push(`[vignettes] ${nodeId}.${edgeId}: personalVignette has no _default and no _when rules`);
            }
        }
    }

    // Resolution completeness across test personas
    let totalVignettes = 0, withWhen = 0;
    const nullResolutions = [];
    for (const [nodeId, node] of Object.entries(narrative)) {
        if (!node.values) continue;
        for (const [edgeId, edge] of Object.entries(node.values)) {
            const pv = edge.personalVignette;
            if (!pv) continue;
            totalVignettes++;
            if (pv._when && pv._when.length > 0) withWhen++;
            for (const persona of TEST_PERSONAS) {
                const bucket = getCountryBucket(persona.country, personalData);
                const ctx = { profession: persona.profession, country_bucket: bucket, is_ai_geo: persona.is_ai_geo };
                const text = resolvePersonalVignetteText(pv, ctx);
                if (!text) nullResolutions.push({ node: nodeId, edge: edgeId, persona: `${persona.profession} in ${persona.country}` });
            }
        }
    }

    // Token validation
    for (const [nodeId, node] of Object.entries(narrative)) {
        if (!node.values) continue;
        for (const [edgeId, edge] of Object.entries(node.values)) {
            const pv = edge.personalVignette;
            if (!pv) continue;
            const texts = [];
            if (pv._default) texts.push(pv._default);
            if (pv._when) for (const rule of pv._when) if (rule.text) texts.push(rule.text);
            if (typeof pv === 'string') texts.push(pv);
            for (const text of texts) {
                const tokens = text.match(/\{[^}]+\}/g) || [];
                for (const token of tokens) {
                    if (token !== '{country}' && token !== '{profession}') {
                        errors.push(`[vignettes] ${nodeId}.${edgeId}: unknown token "${token}" in text`);
                    }
                }
            }
        }
    }

    // Coverage
    const nodesWithVignettes = new Set();
    const nodesWithoutVignettes = new Set();
    for (const node of NODES) {
        if (node.derived) continue;
        if (!node.edges) continue;
        let hasAny = false;
        for (const edge of node.edges) {
            const narr = narrative[node.id];
            if (narr && narr.values && narr.values[edge.id] && narr.values[edge.id].personalVignette) { hasAny = true; break; }
        }
        (hasAny ? nodesWithVignettes : nodesWithoutVignettes).add(node.id);
    }

    return { errors, warnings, totalVignettes, withWhen, nodesWithVignettes, nodesWithoutVignettes };
}

// ════════════════════════════════════════════════════════
// Reporting
// ════════════════════════════════════════════════════════

function printPhase1({ errors }) {
    if (errors.length === 0) {
        console.log('  OK — All static checks passed');
    } else {
        console.log(`  ${errors.length} error(s):`);
        for (const e of errors) console.log('    ' + e);
    }
}

function printPhase2(result) {
    const { violations, edgesReached, visited, terminals, deadEnds, elapsed } = result;

    const cats = [
        { name: 'Dead ends (no outcome)', items: violations.deadEnd },
        { name: 'Re-derived dead ends (derivation reveals question)', items: violations.reDerivedDeadEnd },
        { name: 'Ambiguous (multiple outcomes)', items: violations.ambiguous },
        { name: 'Stuck nodes (visible, 0 enabled edges)', items: violations.stuck },
        { name: 'Single option (not locked)', items: violations.singleOption },
        { name: 'Click erased', items: [...violations.clickErased.values()] },
        { name: 'Stack integrity (displayOrder != stack order)', items: violations.stackIntegrity },
    ];

    let total = 0;
    for (const cat of cats) {
        if (cat.items.length === 0) continue;
        total += cat.items.length;
        console.log(`\n  ${cat.name}: ${cat.items.length}`);
        const shown = cat.items.slice(0, 5);
        for (const item of shown) {
            if (item.hiddenQuestion) {
                console.log(`    splits: ${item.splits.join(', ')} → hidden: ${item.hiddenQuestion}`);
            } else if (item.expected) {
                console.log(`    expected: [${item.expected.join(', ')}]`);
                console.log(`    actual:   [${item.actual.join(', ')}]`);
            } else if (item.node && item.edge) {
                console.log(`    ${item.node} -> ${item.edge}`);
            } else if (item.outcomes) {
                console.log(`    outcomes: ${item.outcomes.join(', ')}`);
            } else if (item.sel) {
                const rs = resolvedState(item.sel);
                const parts = [];
                for (const dim of dimOrder) {
                    const v = rs[dim];
                    if (v === undefined) continue;
                    if (item.superSet && item.superSet.has(dim)) { parts.push(`${dim}=*`); continue; }
                    parts.push(`${dim}=${v}`);
                }
                console.log(`    ${parts.join(', ').substring(0, 120)}...`);
            }
            if (item.url) console.log(`    ${item.url}`);
        }
        if (cat.items.length > 5) console.log(`    ... and ${cat.items.length - 5} more`);
    }

    // Edge coverage
    let totalEdges = 0, reached = 0;
    const unreached = [];
    for (const node of NODES) {
        if (!node.edges) continue;
        for (const edge of node.edges) {
            totalEdges++;
            if (edgesReached.has(`${node.id}=${edge.id}`)) reached++;
            else unreached.push({ node: node.id, edge: edge.id, derived: !!node.derived });
        }
    }
    console.log(`\n  Edge coverage: ${reached}/${totalEdges} (${(100*reached/totalEdges).toFixed(1)}%)`);
    const unreachedChoice = unreached.filter(u => !u.derived);
    if (unreachedChoice.length > 0 && unreachedChoice.length <= 20) {
        console.log(`  Unreached non-derived edges (${unreachedChoice.length}):`);
        for (const u of unreachedChoice) console.log(`    ${u.node} -> ${u.edge}`);
    } else if (unreachedChoice.length > 20) {
        console.log(`  Unreached non-derived edges: ${unreachedChoice.length} (too many to list)`);
    }

    if (total === 0) {
        console.log('\n  OK — No violations found');
    }
    return total;
}

function printPhase3(result) {
    if (result.errors.length === 0 && result.warnings.length === 0) {
        console.log('  OK — All vignette checks passed');
    }
    for (const e of result.errors) console.log(`  ERROR: ${e}`);
    for (const w of result.warnings) console.log(`  WARN: ${w}`);
    console.log(`\n  Personal vignettes: ${result.totalVignettes} total (${result.withWhen} customized)`);
    console.log(`  Nodes with vignettes: ${result.nodesWithVignettes.size} / ${result.nodesWithVignettes.size + result.nodesWithoutVignettes.size}`);
    if (result.nodesWithoutVignettes.size > 0 && result.nodesWithoutVignettes.size <= 30) {
        console.log(`  Nodes without: ${[...result.nodesWithoutVignettes].join(', ')}`);
    }
}

function printPhase4(result) {
    if (result.skipped) {
        console.log(`  SKIP — ${result.reason}`);
        return 0;
    }
    const { visited, decisions, edgesChecked, truncated, maxStates, totalFP, totalFN, perOutcome, elapsed } = result;
    const truncNote = truncated ? ` (truncated at ${maxStates} states)` : '';
    console.log(`  ${visited} states, ${decisions} decisions, ${edgesChecked} edges checked in ${(elapsed/1000).toFixed(1)}s${truncNote}`);
    console.log(`  Reach sets loaded: ${result.reachSetIds.length}`);

    if (totalFP === 0 && totalFN === 0) {
        console.log('\n  OK — No FP/FN mismatches found');
        return 0;
    }

    console.log(`\n  Mismatches: FP=${totalFP} (dead-end: UI says reachable, click lands in dead end)`);
    console.log(`              FN=${totalFN} (hidden path: UI hides a reachable path)`);

    const withIssues = Object.entries(perOutcome)
        .filter(([, o]) => o.fpCount || o.fnCount)
        .sort((a, b) => (b[1].fpCount + b[1].fnCount) - (a[1].fpCount + a[1].fnCount));

    for (const [id, o] of withIssues) {
        console.log(`\n  ── ${id}  FP=${o.fpCount}  FN=${o.fnCount} ──`);
        for (const bucket of ['fp', 'fn']) {
            const label = bucket.toUpperCase();
            for (const rec of o[bucket]) {
                console.log(`    ${label}: ${rec.node}=${rec.edge}`);
                console.log(`      at: ${selToUrl(rec.at)}&locked=${id}`);
                console.log(`      after click: ${selToUrl(rec.commitSel)}&locked=${id}`);
            }
            const extra = o[bucket + 'Count'] - o[bucket].length;
            if (extra > 0) console.log(`    ... and ${extra} more ${label}`);
        }
    }
    return totalFP + totalFN;
}

// ════════════════════════════════════════════════════════
// Exports
// ════════════════════════════════════════════════════════

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { runStaticAnalysis, runTraversal, runVignetteValidation, runReachInvariantCheck };
}

// ════════════════════════════════════════════════════════
// Main
// ════════════════════════════════════════════════════════

if (require.main === module) {

_loadData();
const templates = _defaultTemplates;
const arg = process.argv[2];

console.log('Singularity Map — Validation Report');
console.log('═'.repeat(50));
console.log(`${NODES.length} nodes, ${templates.length} outcome templates\n`);

// Phase 1
const t0 = Date.now();
const phase1 = runStaticAnalysis(templates);
console.log(`Phase 1: Static Analysis (${Date.now() - t0}ms)`);
printPhase1(phase1);
console.log();

if (arg === '--quick') {
    process.exit(phase1.errors.length ? 1 : 0);
}

// Phase 2
console.log('Phase 2: DFS Traversal');
const phase2 = runTraversal(templates);
console.log(`  ${phase2.visited} states, ${phase2.terminals.length} terminals, ${(phase2.elapsed/1000).toFixed(1)}s`);
const violationCount = printPhase2(phase2);
console.log();

// Phase 3
const t3 = Date.now();
const phase3 = runVignetteValidation();
console.log(`Phase 3: Personal Vignette Validation (${Date.now() - t3}ms)`);
printPhase3(phase3);
console.log();

// Phase 4
const t4 = Date.now();
console.log('Phase 4: Browser reach-set invariant (lightPush vs commit)');
const phase4 = runReachInvariantCheck(templates);
console.log(`  (${Date.now() - t4}ms)`);
const reachMismatches = printPhase4(phase4);
console.log();

// Summary
const totalIssues = phase1.errors.length + violationCount + phase3.errors.length + reachMismatches;
if (totalIssues === 0) {
    console.log('All checks passed!');
} else {
    console.log(`${phase1.errors.length} static error(s), ${violationCount} DFS violation(s), ${phase3.errors.length} vignette error(s), ${reachMismatches} reach mismatch(es)`);
}
process.exit(totalIssues ? 1 : 0);

}
