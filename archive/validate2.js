#!/usr/bin/env node
// validate2.js — Graph validator using module-composed DFS (post-modularization).
//
// Replaces validate.js's equivalence-class / irrKey DFS with a simpler
// concrete-key DFS that treats each module as a single atomic step,
// using precomputed module exit tables (see module-tables.js).
//
// Phase 1: Static analysis (structure, references, dead edges)
// Phase 2: Module-composed DFS (terminals, dead-ends, ambiguous outcomes,
//          stuck nodes, single-option, click-erased, edge coverage)
// Phase 3: Personal vignette validation
//
// Dropped from old validator (by design):
//   * Re-derived dead end check — deriveWhen semantics converge on a
//     single resolved value; no need to re-derive at dead ends.
//   * Browser reach-set invariant (Phase 4) — will be re-added in a
//     later pass after we've refactored precompute-reachability.js to
//     work without irrKey/classes.
//   * Stack-integrity check — the DFS no longer maintains a push-stack;
//     this was a UI-behavior test, not a graph test.
//
// Usage:
//   node validate2.js          — run all phases
//   node validate2.js --quick  — phase 1 only

const fs = require('fs');
const path = require('path');
const { NODES, NODE_MAP, MODULES, MODULE_MAP } = require('./graph.js');
const {
    matchCondition, resolvedVal, resolvedState,
    isEdgeDisabled,
    cleanSelection, templateMatches,
} = require('./engine.js');
const {
    isModuleActivelyPending,
    pickActiveModule,
    pickNextAction,
    getModuleTable,
    resetCache: resetModuleCache,
    cacheStats: moduleCacheStats,
    allInternalEdgesVisited,
    allInternalIssues,
} = require('./module-tables.js');
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

function selToUrl(sel) {
    const params = Object.entries(sel).filter(([, v]) => v != null).map(([k, v]) => `${k}=${v}`).join('&');
    return `http://localhost:3000/#/explore${params ? '?' + params : ''}`;
}

// ════════════════════════════════════════════════════════
// Phase 1 — Static Analysis (ported from validate.js verbatim)
// ════════════════════════════════════════════════════════

function runStaticAnalysis(templates) {
    if (!templates) { _loadData(); templates = _defaultTemplates; }
    const errors = [];
    const metaNodes = new Set(NODES.map(d => d.id));

    const extraValuesByDim = new Map();
    const addExtra = (dim, val) => {
        if (val == null) return;
        if (!extraValuesByDim.has(dim)) extraValuesByDim.set(dim, new Set());
        extraValuesByDim.get(dim).add(val);
    };
    for (const node of NODES) {
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

    function validValuesFor(dimId) {
        const refNode = NODE_MAP[dimId];
        const extras = extraValuesByDim.get(dimId);
        if (!refNode || !refNode.edges) {
            return extras ? new Set(extras) : null;
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
            if (!validIds) continue;
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

    for (const node of NODES) {
        if (!node.id) errors.push(`[structure] Node missing id`);
        if (!node.edges || node.edges.length === 0) errors.push(`[structure] "${node.id}" has no edges`);
        if (node.activateWhen) for (const cond of node.activateWhen) validateCondition(cond, node.id, 'activateWhen');
        if (node.hideWhen)     for (const cond of node.hideWhen)     validateCondition(cond, node.id, 'hideWhen');
    }
    for (const node of NODES) {
        if (!node.edges) continue;
        for (const v of node.edges) {
            if (v.requires) {
                const condSets = Array.isArray(v.requires) ? v.requires : [v.requires];
                for (const cond of condSets) validateCondition(cond, `${node.id}.${v.id}`, 'requires');
            }
            if (v.disabledWhen) for (const cond of v.disabledWhen) validateCondition(cond, `${node.id}.${v.id}`, 'disabledWhen');
        }
    }
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
    for (const t of templates) {
        if (!t.reachable) continue;
        for (const cond of (Array.isArray(t.reachable) ? t.reachable : [t.reachable])) {
            for (const [dk, dv] of Object.entries(cond)) {
                if (dk === '_not') {
                    const entries = Array.isArray(dv) ? dv : [dv];
                    for (const entry of entries) {
                        for (const nk of Object.keys(entry)) {
                            if (!metaNodes.has(nk)) errors.push(`[outcome] "${t.id}" references unknown node "${nk}" in _not`);
                        }
                    }
                    continue;
                }
                if (!metaNodes.has(dk)) errors.push(`[outcome] "${t.id}" references unknown node "${dk}"`);
            }
        }
    }

    return { errors };
}

// ════════════════════════════════════════════════════════
// Phase 2 — Module-composed DFS
// ════════════════════════════════════════════════════════
//
// State = (sel, flavor). Each DFS step either:
//   1. matches an outcome template (terminal)
//   2. has an actively-pending module → branch over getModuleTable exits
//   3. has an askable flat (non-module) node → branch over its enabled edges
//   4. neither → dead-end
//
// Dedup on concrete (sel, flavor) key.

// Pure sel-only state key. Flavor is narrative/rendering state; validate2
// is a graph-logic check and treats outcome matching on sel alone. Any
// template whose reachable clauses reference dims that live only in flavor
// will not match from validate2 — that's a finding (the template isn't
// actually reachable from the sel-view and needs its load-bearing dim
// promoted to sel or its reachable rewritten).
function stateKey(sel) {
    const sk = Object.keys(sel).filter(k => sel[k] != null).sort().map(k => k + '=' + sel[k]).join('|');
    return sk;
}

function applyExit(sel, exit) {
    const nextSel = { ...sel };
    for (const k of Object.keys(exit.setSel)) nextSel[k] = exit.setSel[k];
    return nextSel;
}

function moduleNodeSet() {
    const s = new Set();
    for (const mod of MODULES) for (const nid of (mod.nodeIds || [])) s.add(nid);
    return s;
}
const _MODULE_NODES = moduleNodeSet();

function isAskableFlatNode(sel, node) {
    if (node.derived) return null;
    if (node.module) return null;                    // module nodes go through tables
    if (_MODULE_NODES.has(node.id)) return null;     // defensive: in case module field was lost
    if (sel[node.id] !== undefined) return null;
    if (!node.edges || node.edges.length === 0) return null;
    if (node.activateWhen && !node.activateWhen.some(c => matchCondition(sel, c))) return null;
    if (node.hideWhen && node.hideWhen.some(c => matchCondition(sel, c))) return null;
    const enabled = node.edges.filter(e => !isEdgeDisabled(sel, node, e));
    return enabled;
}

function runTraversal(templates, opts = {}) {
    if (!templates) { _loadData(); templates = _defaultTemplates; }
    resetModuleCache();

    const maxStates = opts.maxStates || 1_000_000;
    const violations = {
        deadEnd: [],
        ambiguous: [],
        stuck: [],
        singleOption: [],
        clickErased: new Map(),
        moduleInternalDeadEnd: [],   // populated post-walk from module tables
        moduleInternalStuck: [],     // populated post-walk from module tables
    };
    const flatEdgesReached = new Set();  // `${nid}=${eid}` for flat-node edges traversed
    const terminals = [];
    const visited = new Set();
    let visitedCount = 0;
    let truncated = false;
    let ambiguousSeen = new Set();

    const t0 = Date.now();

    function recordFlatEdges(sel) {
        // sel keys that are flat-node answers. Useful for edge-coverage.
        for (const k of Object.keys(sel)) {
            if (sel[k] == null) continue;
            const n = NODE_MAP[k];
            if (!n || n.derived) continue;
            if (n.module) continue;  // module internal edges come from module tables
            flatEdgesReached.add(k + '=' + sel[k]);
        }
    }

    function dfs(sel) {
        if (truncated) return;
        const key = stateKey(sel);
        if (visited.has(key)) return;
        visited.add(key);
        visitedCount++;
        if (visitedCount >= maxStates) { truncated = true; return; }

        recordFlatEdges(sel);

        // Terminal: outcome template match on sel-only resolvedState.
        const state = resolvedState(sel);
        const matched = templates.filter(t => templateMatches(t, state));
        if (matched.length > 1) {
            const sig = matched.map(t => t.id).sort().join(',');
            if (!ambiguousSeen.has(sig + '|' + key)) {
                ambiguousSeen.add(sig + '|' + key);
                violations.ambiguous.push({ outcomes: matched.map(t => t.id), sel: { ...sel }, url: selToUrl(sel) });
            }
        }
        if (matched.length > 0) {
            terminals.push({ outcomes: matched.map(t => t.id), sel: { ...sel } });
            return;
        }

        // Engine scheduling: priority-first, ties → modules.
        const action = pickNextAction(sel);
        if (!action) {
            violations.deadEnd.push({ reason: 'no askable node', sel: { ...sel }, url: selToUrl(sel) });
            return;
        }

        if (action.kind === 'module') {
            const mod = action.mod;
            const { exits } = getModuleTable(mod, sel);
            if (exits.length === 0) {
                violations.deadEnd.push({
                    reason: `module '${mod.id}' has no viable exit`,
                    sel: { ...sel }, url: selToUrl(sel),
                });
                return;
            }
            // Dedup exits by their setSel projection (flavor-only variants
            // collapse to the same outer state).
            const seenSetSel = new Set();
            for (const exit of exits) {
                const sig = Object.keys(exit.setSel).sort().map(k => k + '=' + exit.setSel[k]).join('|');
                if (seenSetSel.has(sig)) continue;
                seenSetSel.add(sig);
                dfs(applyExit(sel, exit));
            }
            return;
        }

        // Flat node action.
        const n = action.node;
        const enabled = n.edges.filter(e => !isEdgeDisabled(sel, n, e));
        if (enabled.length === 0) {
            violations.stuck.push({ node: n.id, sel: { ...sel }, url: selToUrl(sel) });
            return;
        }
        if (enabled.length === 1) {
            violations.singleOption.push({ node: n.id, edge: enabled[0].id, url: selToUrl(sel) });
        }
        for (const e of enabled) {
            const vk = n.id + ':' + e.id;
            if (!violations.clickErased.has(vk)) {
                const testSel = { ...sel, [n.id]: e.id };
                const r = cleanSelection(testSel, {});
                if (r.sel[n.id] === undefined && r.flavor[n.id] !== e.id) {
                    violations.clickErased.set(vk, { node: n.id, edge: e.id, url: selToUrl(sel) });
                }
            }
            const nextSel = { ...sel, [n.id]: e.id };
            const r = cleanSelection(nextSel, {});
            if (r.sel[n.id] === undefined && r.flavor[n.id] !== e.id) continue;
            dfs(r.sel);
        }
    }

    const { sel: startSel } = cleanSelection({}, {});
    dfs(startSel);

    const elapsed = Date.now() - t0;

    // Pull module-internal issues from the tables that got hit.
    const internal = allInternalIssues();
    violations.moduleInternalDeadEnd = internal.deadEnds;
    violations.moduleInternalStuck = internal.stuck;

    return {
        violations,
        flatEdgesReached,
        internalEdgesReached: allInternalEdgesVisited(),
        terminals,
        visited: visitedCount,
        truncated,
        maxStates,
        elapsed,
        moduleCacheStats: moduleCacheStats(),
    };
}

// ════════════════════════════════════════════════════════
// Phase 3 — Personal Vignette Validation (ported from validate.js)
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
    const { violations, flatEdgesReached, internalEdgesReached, terminals, visited, truncated, maxStates, elapsed, moduleCacheStats: mcs } = result;
    console.log(`  ${visited} states, ${terminals.length} terminals, ${(elapsed/1000).toFixed(1)}s${truncated ? ` (truncated at ${maxStates})` : ''}`);
    console.log(`  Module tables: ${mcs.totalRows} rows across ${Object.keys(mcs.perModule).length} modules`);

    const cats = [
        { name: 'Dead ends', items: violations.deadEnd },
        { name: 'Ambiguous (multiple outcomes)', items: violations.ambiguous },
        { name: 'Stuck flat nodes (visible, 0 enabled edges)', items: violations.stuck },
        { name: 'Single-option flat nodes (not locked)', items: violations.singleOption },
        { name: 'Click-erased (flat)', items: [...violations.clickErased.values()] },
        { name: 'Module-internal dead ends', items: violations.moduleInternalDeadEnd },
        { name: 'Module-internal stuck nodes', items: violations.moduleInternalStuck },
    ];

    let total = 0;
    for (const cat of cats) {
        if (cat.items.length === 0) continue;
        total += cat.items.length;
        console.log(`\n  ${cat.name}: ${cat.items.length}`);
        const shown = cat.items.slice(0, 5);
        for (const item of shown) {
            if (item.outcomes) {
                console.log(`    outcomes: ${item.outcomes.join(', ')}`);
            } else if (item.node && item.edge) {
                console.log(`    ${item.node} -> ${item.edge}`);
            } else if (item.module && item.node) {
                console.log(`    [${item.module}] stuck: ${item.node}`);
            } else if (item.module) {
                console.log(`    [${item.module}] dead`);
            } else if (item.node) {
                console.log(`    ${item.node}`);
            } else if (item.reason) {
                console.log(`    ${item.reason}`);
            }
            if (item.url) console.log(`    ${item.url}`);
        }
        if (cat.items.length > 5) console.log(`    ... and ${cat.items.length - 5} more`);
    }

    // Edge coverage: flat + internal. Everything in NODES that isn't derived.
    let totalEdges = 0, reached = 0;
    const unreached = [];
    const allReached = new Set();
    for (const e of flatEdgesReached) allReached.add(e);
    for (const e of internalEdgesReached) allReached.add(e);
    for (const node of NODES) {
        if (!node.edges) continue;
        for (const edge of node.edges) {
            totalEdges++;
            if (allReached.has(`${node.id}=${edge.id}`)) reached++;
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

    if (total === 0) console.log('\n  OK — No violations found');
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

// ════════════════════════════════════════════════════════
// Exports
// ════════════════════════════════════════════════════════

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { runStaticAnalysis, runTraversal, runVignetteValidation };
}

// ════════════════════════════════════════════════════════
// Main
// ════════════════════════════════════════════════════════

if (require.main === module) {

_loadData();
const templates = _defaultTemplates;
const arg = process.argv[2];

console.log('Singularity Map — Validation Report (validate2)');
console.log('═'.repeat(50));
console.log(`${NODES.length} nodes, ${MODULES.length} modules, ${templates.length} outcome templates\n`);

const t0 = Date.now();
const phase1 = runStaticAnalysis(templates);
console.log(`Phase 1: Static Analysis (${Date.now() - t0}ms)`);
printPhase1(phase1);
console.log();

if (arg === '--quick') {
    process.exit(phase1.errors.length ? 1 : 0);
}

console.log('Phase 2: Module-composed DFS');
const phase2 = runTraversal(templates);
const violationCount = printPhase2(phase2);
console.log();

const t3 = Date.now();
const phase3 = runVignetteValidation();
console.log(`Phase 3: Personal Vignette Validation (${Date.now() - t3}ms)`);
printPhase3(phase3);
console.log();

const totalIssues = phase1.errors.length + violationCount + phase3.errors.length;
if (totalIssues === 0) {
    console.log('All checks passed!');
} else {
    console.log(`${phase1.errors.length} static error(s), ${violationCount} DFS violation(s), ${phase3.errors.length} vignette error(s)`);
}
process.exit(totalIssues ? 1 : 0);

}
