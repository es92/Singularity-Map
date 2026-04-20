#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');

const ROOT = path.resolve(__dirname, '..');

const { runBrowserSim } = require('./reach-browser-sim.js');

const modKeys = ['graph', 'engine', 'walker', 'validate', 'precompute'];
const modFiles = {
    graph:      'graph.js',
    engine:     'engine.js',
    walker:     'graph-walker.js',
    validate:   'validate.js',
    precompute: 'precompute-reachability.js',
};
const resolved = {};
for (const k of modKeys) resolved[k] = require.resolve(path.join(ROOT, modFiles[k]));

// ═══════════════════════════════════════════════════════
// Module cache injection
// ═══════════════════════════════════════════════════════

function clearAndInject(graphData) {
    for (const p of Object.values(resolved)) delete require.cache[p];

    const NODES = graphData.nodes;
    const NODE_MAP = {};
    for (const n of NODES) NODE_MAP[n.id] = n;

    const m = new Module(resolved.graph);
    m.id = resolved.graph;
    m.filename = resolved.graph;
    m.loaded = true;
    m.paths = Module._nodeModulePaths(path.dirname(resolved.graph));
    m.exports = {
        SCENARIO: { id: 'test', title: 'Test', description: '', storageKey: 'test' },
        NODES,
        NODE_MAP,
    };
    require.cache[resolved.graph] = m;

    const Engine     = require(resolved.engine);
    const Walker     = require(resolved.walker);
    const validate   = require(resolved.validate);
    const precompute = require(resolved.precompute);

    return { Engine, Walker, ...validate, ...precompute, NODES };
}

// ═══════════════════════════════════════════════════════
// Baseline (brute-force) DFS — no class merging,
// no irrelevance, no superposition
// ═══════════════════════════════════════════════════════

function baselineDFS(Engine, Walker, NODES, matchers) {
    const { createStack, push, currentState, isNodeVisible, isEdgeDisabled } = Engine;

    const visited = new Map();
    const deadEnds = [];
    const edgeCoverage = new Set();

    function stateKey(sel) {
        return NODES.map(n => n.id + '=' + (sel[n.id] || '*')).join('|');
    }

    function checkMatchers(sel) {
        let mask = 0;
        for (let i = 0; i < matchers.length; i++) {
            if (matchers[i](sel)) mask |= (1 << i);
        }
        return mask;
    }

    function pickNext(sel) {
        for (const node of NODES) {
            if (node.derived) continue;
            if (sel[node.id] !== undefined) continue;
            if (!node.edges || node.edges.length === 0) continue;
            if (!isNodeVisible(sel, node)) continue;
            return node;
        }
        return null;
    }

    function dfs(stk) {
        const sel = currentState(stk);
        const key = stateKey(sel);
        if (visited.has(key)) return visited.get(key);
        visited.set(key, 0);

        const termMask = checkMatchers(sel);
        // Mirror walk()'s isTerminal semantics: once any outcome matches, stop
        // descending. States "past" a terminal are not part of the user-reachable
        // state space we want to validate against.
        if (termMask !== 0) {
            visited.set(key, termMask);
            return termMask;
        }

        const nextNode = pickNext(sel);

        if (!nextNode) {
            deadEnds.push({ sel: { ...sel }, key });
            visited.set(key, 0);
            return 0;
        }

        const enabled = nextNode.edges.filter(e => !isEdgeDisabled(sel, nextNode, e));
        if (enabled.length === 0) {
            deadEnds.push({ sel: { ...sel }, key });
            visited.set(key, 0);
            return 0;
        }

        let childMask = 0;
        for (const edge of enabled) {
            edgeCoverage.add(nextNode.id + ':' + edge.id);
            childMask |= dfs(push(stk, nextNode.id, edge.id));
        }

        const mask = termMask | childMask;
        visited.set(key, mask);
        return mask;
    }

    const t0 = Date.now();
    const rootMask = dfs(createStack());
    return { visited, deadEnds, edgeCoverage, rootMask, elapsed: Date.now() - t0 };
}

// ═══════════════════════════════════════════════════════
// Build variant-aware matchers (mirrors precompute-reachability)
// ═══════════════════════════════════════════════════════

function buildMatchers(Engine, Walker, templates) {
    const entries = [];
    for (const t of templates) {
        const variants = t.variants && typeof t.variants === 'object' ? Object.keys(t.variants) : null;
        if (variants && variants.length > 0 && t.primaryDimension) {
            for (const vk of variants) {
                entries.push({
                    id: t.id + '--' + vk,
                    matcher: (sel) => {
                        const state = Walker.resolvedState(sel);
                        return Engine.templateMatches(t, state) && state[t.primaryDimension] === vk;
                    },
                });
            }
        } else {
            entries.push({
                id: t.id,
                matcher: (sel) => Engine.templateMatches(t, Walker.resolvedState(sel)),
            });
        }
    }
    return entries;
}

// ═══════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════

function selFromKey(key) {
    const sel = {};
    for (const part of key.split('|')) {
        const eq = part.indexOf('=');
        const dim = part.substring(0, eq);
        const val = part.substring(eq + 1);
        if (val !== '*') sel[dim] = val;
    }
    return sel;
}

function fmtMask(mask, entries) {
    if (!entries || entries.length === 0) return mask.toString(2);
    const bits = [];
    for (let i = 0; i < entries.length; i++) {
        if (mask & (1 << i)) bits.push(entries[i].id);
    }
    return bits.join('+') || '(none)';
}

function fmtSel(sel, NODES) {
    const parts = [];
    for (const n of NODES) if (sel[n.id] !== undefined) parts.push(`${n.id}=${sel[n.id]}`);
    return parts.length ? parts.join(' ') : '(root)';
}

// ═══════════════════════════════════════════════════════
// Run one test
// ═══════════════════════════════════════════════════════

// Category keys (also defines column order in the summary).
const CATEGORIES = [
    'static',
    'walk',
    'reach-fp',
    'reach-fn',
    'reach-missing',
    'sim-fp',
    'sim-fn',
];

const CATEGORY_LABELS = {
    'static':        'Static analysis',
    'walk':          'Optimized walk',
    'reach-fp':      'Reachability FP',
    'reach-fn':      'Reachability FN',
    'reach-missing': 'Reachability missing',
    'sim-fp':        'BrowserSim FP',
    'sim-fn':        'BrowserSim FN',
};

function runTest(name, graphData) {
    const templates = graphData.outcomes.templates;
    const mods = clearAndInject(graphData);
    const { Engine, Walker, runStaticAnalysis, runTraversal, buildMatchersAndCompute, NODES } = mods;
    Walker.setTemplates(templates);

    // Errors grouped by category; each category's failure is independent.
    const byCat = Object.create(null);
    for (const k of CATEGORIES) byCat[k] = [];
    const pushCat = (cat, msg) => byCat[cat].push(msg);

    // 1. Static analysis
    const phase1 = runStaticAnalysis(templates);
    for (const e of phase1.errors) pushCat('static', `[static] ${e}`);

    // 2. Optimized walk (from validate.js)
    const phase2 = runTraversal(templates, { quiet: true });
    for (const [type, list] of Object.entries(phase2.violations)) {
        if (type === 'singleOption') continue;
        const items = list instanceof Map ? [...list.values()] : list;
        for (const v of items) {
            pushCat('walk', `[walk:${type}] ${JSON.stringify(v).substring(0, 200)}`);
        }
    }

    // 3. Optimized reachability
    const optimized = buildMatchersAndCompute(templates, { quiet: true });

    // 4. Baseline DFS
    const matcherEntries = buildMatchers(Engine, Walker, templates);
    const baseline = baselineDFS(Engine, Walker, NODES, matcherEntries.map(e => e.matcher));

    // 5. Per-state reachability invariant (the one the browser depends on).
    //
    //    For every reachable state `sel`:
    //        optimized.reachMap[irrKey(sel)] === trueReachSet(sel)
    //
    //    This is strictly stronger than the previous "aggregated-by-irrKey"
    //    comparison: if two states s1, s2 with DIFFERENT true reach-sets
    //    collapse to the same irrKey, the stored mask = s1 | s2 violates this
    //    invariant for both (each sees extra bits from the other). The old
    //    aggregated check would OR them on the baseline side too and miss the
    //    collision; the browser's per-state query cannot.
    //
    //    Missing irrKeys are treated as failures here: the browser's
    //    wouldReachOutcome reads `_reachSet.has(ik)` — an absent key returns
    //    false (fail-closed), which is incorrect if the true mask is non-zero.

    let stateFP = 0, stateFN = 0, stateMissing = 0;
    const fpSamples = [], fnSamples = [], missingSamples = [];
    for (const [key, trueMask] of baseline.visited) {
        const sel = selFromKey(key);
        const ik = Walker.irrKey(sel);
        const optMask = optimized.reachMap.get(ik);
        if (optMask === undefined) {
            if (trueMask !== 0) {
                stateMissing++;
                if (missingSamples.length < 5) missingSamples.push(
                    `[state-missing] ${fmtSel(sel, NODES)} ik=${ik} truth=${fmtMask(trueMask, matcherEntries)} (optimized map has no entry)`
                );
            }
            continue;
        }
        const extra   = optMask  & ~trueMask;   // phantom reach bits from colliding states
        const missing = trueMask & ~optMask;    // undercounted by optimizer
        if (extra !== 0) {
            stateFP++;
            if (fpSamples.length < 5) fpSamples.push(
                `[state-fp] ${fmtSel(sel, NODES)} ik=${ik} truth=${fmtMask(trueMask, matcherEntries)} opt has extra ${fmtMask(extra, matcherEntries)}`
            );
        }
        if (missing !== 0) {
            stateFN++;
            if (fnSamples.length < 5) fnSamples.push(
                `[state-fn] ${fmtSel(sel, NODES)} ik=${ik} truth=${fmtMask(trueMask, matcherEntries)} opt missing ${fmtMask(missing, matcherEntries)}`
            );
        }
    }
    for (const m of fpSamples)      pushCat('reach-fp', m);
    for (const m of fnSamples)      pushCat('reach-fn', m);
    for (const m of missingSamples) pushCat('reach-missing', m);
    if (stateFP      > fpSamples.length)      pushCat('reach-fp',      `... and ${stateFP      - fpSamples.length} more reach FP cases`);
    if (stateFN      > fnSamples.length)      pushCat('reach-fn',      `... and ${stateFN      - fnSamples.length} more reach FN cases`);
    if (stateMissing > missingSamples.length) pushCat('reach-missing', `... and ${stateMissing - missingSamples.length} more reach missing cases`);

    // 6. Browser-sim invariant: the browser's wouldReachOutcome uses lightPush
    //    + reachSet.has. This must agree with the actual post-click state's
    //    reach-set membership (Engine.push, then descend in the baseline).
    //      FP = lightReach && !truthReach → UI green-lights a dead end.
    //      FN = !lightReach && truthReach  → UI hides a valid path.
    //    Both are invariant violations; both fail the test.
    const sim = runBrowserSim({
        Engine, Walker, NODES,
        reachMap: optimized.reachMap,
        entries: optimized.entries,
    });
    const simFpMsgs = [], simFnMsgs = [];
    for (const o of sim.perOutcome) {
        if (!o.edgeFP && !o.edgeFN) continue;
        for (const m of o.mismatches) {
            const line = `[browser-sim:${o.id}] ${m.trim()}`;
            if (line.includes(' FP:'))      simFpMsgs.push(line);
            else if (line.includes(' FN:')) simFnMsgs.push(line);
        }
    }
    for (const m of simFpMsgs.slice(0, 5)) pushCat('sim-fp', m);
    for (const m of simFnMsgs.slice(0, 5)) pushCat('sim-fn', m);
    if (simFpMsgs.length > 5) pushCat('sim-fp', `... and ${simFpMsgs.length - 5} more BrowserSim FP mismatches`);
    if (simFnMsgs.length > 5) pushCat('sim-fn', `... and ${simFnMsgs.length - 5} more BrowserSim FN mismatches`);

    // Per-category pass/fail status.
    const status = Object.create(null);
    for (const k of CATEGORIES) status[k] = byCat[k].length === 0 ? 'pass' : 'fail';

    return {
        name, byCat, status,
        stats: {
            baselineStates: baseline.visited.size,
            baselineDeadEnds: baseline.deadEnds.length,
            optimizedIrrKeys: optimized.reachMap.size,
            stateFP, stateFN, stateMissing,
            walkStates: phase2.visited,
            walkDeadEnds: phase2.deadEnds.length,
            simFP: sim.totalFP, simFN: sim.totalFN,
            simDecisions: sim.totalDecisions, simChecked: sim.totalChecked,
            simOutcomes: sim.entries.length,
        },
    };
}

// ═══════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════

const graphsDir = path.join(__dirname, 'graphs');
const filter = process.argv[2];
const verbose = process.argv.includes('--verbose') || process.argv.includes('-v');
const files = fs.readdirSync(graphsDir).filter(f => f.endsWith('.json')).sort();

const results = [];
const errorTests = [];

for (const file of files) {
    const name = path.basename(file, '.json');
    if (filter && name !== filter) continue;

    const graphData = JSON.parse(fs.readFileSync(path.join(graphsDir, file), 'utf8'));

    try {
        const r = runTest(name, graphData);
        results.push(r);

        if (verbose) {
            const { stats, byCat, status } = r;
            process.stdout.write(`\n${'═'.repeat(50)}\nTEST: ${name}\n${'─'.repeat(50)}\n`);
            console.log(`  Baseline: ${stats.baselineStates} states, ${stats.baselineDeadEnds} dead ends`);
            console.log(`  Optimized: ${stats.optimizedIrrKeys} irrKeys, walk ${stats.walkStates} states, ${stats.walkDeadEnds} dead ends`);
            console.log(`  Reachability: false positives=${stats.stateFP}, false negatives=${stats.stateFN}, missing=${stats.stateMissing}`);
            console.log(`  BrowserSim: ${stats.simOutcomes} outcomes, ${stats.simDecisions} decisions, ${stats.simChecked} edges checked, FP=${stats.simFP} FN=${stats.simFN}`);
            const failedCats = CATEGORIES.filter(c => status[c] === 'fail');
            if (failedCats.length === 0) {
                console.log('  PASS');
            } else {
                console.log(`  FAIL (${failedCats.map(c => CATEGORY_LABELS[c]).join(', ')})`);
                for (const c of failedCats) {
                    for (const e of byCat[c]) console.log(`    ${e}`);
                }
            }
        } else {
            const flags = CATEGORIES.map(c => {
                if (r.status[c] === 'pass') return '.';
                return 'F';
            }).join('');
            console.log(`  ${flags}  ${name}`);
        }
    } catch (err) {
        errorTests.push({ name, error: err });
        console.log(`  ERROR  ${name}: ${err.message}`);
    }
}

// ─────────────────────────────────────────────────────────────────────
// Summary: per-category aggregate across all tests.
// ─────────────────────────────────────────────────────────────────────

const total = results.length;
console.log(`\n${'═'.repeat(50)}`);
console.log(`Summary (${total} test${total === 1 ? '' : 's'})`);
console.log('─'.repeat(50));

const labelWidth = Math.max(...CATEGORIES.map(c => CATEGORY_LABELS[c].length));
let anyFail = errorTests.length > 0;

for (const cat of CATEGORIES) {
    const failing = results.filter(r => r.status[cat] === 'fail');
    const passing = total - failing.length;
    const label = CATEGORY_LABELS[cat].padEnd(labelWidth);
    const countCol = `${passing}/${total}`.padEnd(7);
    if (failing.length === 0) {
        console.log(`  ${label}  ${countCol}  PASS`);
    } else {
        anyFail = true;
        const names = failing.map(r => r.name).join(', ');
        console.log(`  ${label}  ${countCol}  FAIL — ${names}`);
    }
}

if (errorTests.length > 0) {
    console.log('');
    console.log(`  Tests that errored: ${errorTests.map(t => t.name).join(', ')}`);
}

if (!verbose && anyFail) {
    console.log('');
    console.log(`  (run with --verbose to see per-test details and sample failures)`);
}

process.exit(anyFail ? 1 : 0);
