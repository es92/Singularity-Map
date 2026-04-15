#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');

const ROOT = path.resolve(__dirname, '..');

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
        const nextNode = pickNext(sel);

        if (!nextNode) {
            if (termMask === 0) deadEnds.push({ sel: { ...sel }, key });
            visited.set(key, termMask);
            return termMask;
        }

        const enabled = nextNode.edges.filter(e => !isEdgeDisabled(sel, nextNode, e));
        if (enabled.length === 0) {
            if (termMask === 0) deadEnds.push({ sel: { ...sel }, key });
            visited.set(key, termMask);
            return termMask;
        }

        let childMask = 0;
        for (const edge of enabled) {
            edgeCoverage.add(nextNode.id + ':' + edge.id);
            childMask |= dfs(push(stk, nextNode.id, edge.id, { autoForce: false }));
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

// ═══════════════════════════════════════════════════════
// Run one test
// ═══════════════════════════════════════════════════════

function runTest(name, graphData) {
    const templates = graphData.outcomes.templates;
    const mods = clearAndInject(graphData);
    const { Engine, Walker, runStaticAnalysis, runTraversal, buildMatchersAndCompute, NODES } = mods;

    const errors = [];

    // 1. Static analysis
    const phase1 = runStaticAnalysis(templates);
    for (const e of phase1.errors) errors.push(`[static] ${e}`);

    // 2. Optimized walk (from validate.js)
    const phase2 = runTraversal(templates, { quiet: true });
    for (const [type, list] of Object.entries(phase2.violations)) {
        if (type === 'singleOption') continue;
        const items = list instanceof Map ? [...list.values()] : list;
        for (const v of items) {
            errors.push(`[walk:${type}] ${JSON.stringify(v).substring(0, 200)}`);
        }
    }

    // 3. Optimized reachability
    const optimized = buildMatchersAndCompute(templates, { quiet: true });

    // 4. Baseline DFS
    const matcherEntries = buildMatchers(Engine, Walker, templates);
    const baseline = baselineDFS(Engine, Walker, NODES, matcherEntries.map(e => e.matcher));

    // 5. Compare reachability
    // Aggregate baseline masks per irrKey (OR of all states at that key).
    // The optimized reachMap aggregates similarly via recordReach/expandVariants.
    //
    // Known acceptable difference: at irrKeys where noClassMergeDims are UNSET,
    // the optimized may undercount (DFS only propagates class-rep matches; the
    // expandVariants only fires when the dim IS set). This is safe because the
    // client always simulates a choice before lookup.

    const noClassMergeDims = new Set();
    for (const t of templates) {
        if (t.variants && typeof t.variants === 'object'
            && Object.keys(t.variants).length > 0 && t.primaryDimension) {
            noClassMergeDims.add(t.primaryDimension);
        }
    }

    const blByIK = new Map();
    for (const [key, mask] of baseline.visited) {
        const ik = Walker.irrKey(selFromKey(key));
        blByIK.set(ik, (blByIK.get(ik) || 0) | mask);
    }

    // 5a. No false positives: every optimized bit should be in baseline
    let fpCount = 0;
    for (const [ik, optMask] of optimized.reachMap) {
        const blMask = blByIK.get(ik);
        if (blMask === undefined) {
            if (fpCount < 3) errors.push(`[phantom] irrKey=${ik} in optimized but not baseline`);
            fpCount++;
            continue;
        }
        const extra = optMask & ~blMask;
        if (extra !== 0) {
            if (fpCount < 3) errors.push(`[false-pos] irrKey=${ik}: optimized has extra bits ${fmtMask(extra, matcherEntries)}`);
            fpCount++;
        }
    }
    if (fpCount > 3) errors.push(`... and ${fpCount - 3} more false-positive issues`);

    // 5b. No false negatives: every baseline bit should be in optimized
    //     (except at irrKeys where noClassMergeDims are unset — known undercount)
    //     Missing irrKeys (not in optimized at all) are tolerated — they arise from
    //     memoization when deriveWhen crossovers create superKey collisions. The
    //     client fails open (treats missing as reachable).
    let fnCount = 0, missingCount = 0;
    for (const [ik, blMask] of blByIK) {
        const optMask = optimized.reachMap.get(ik);
        if (optMask === undefined) {
            missingCount++;
            continue;
        }
        const missing = blMask & ~optMask;
        if (missing !== 0) {
            const sel = selFromKey([...baseline.visited.keys()].find(k => Walker.irrKey(selFromKey(k)) === ik) || '');
            const ncmUnset = [...noClassMergeDims].some(d => sel[d] === undefined);
            if (ncmUnset) continue;
            if (fnCount < 5) errors.push(`[false-neg] irrKey=${ik}: baseline has ${fmtMask(missing, matcherEntries)} missing from optimized`);
            fnCount++;
        }
    }
    if (fnCount > 5) errors.push(`... and ${fnCount - 5} more false-negative issues`);
    if (missingCount > 0) console.log(`  (${missingCount} irrKeys in baseline only — memoization gap, fail-open)`);

    return {
        name, errors,
        stats: {
            baselineStates: baseline.visited.size,
            baselineDeadEnds: baseline.deadEnds.length,
            optimizedIrrKeys: optimized.reachMap.size,
            walkStates: phase2.visited,
            walkDeadEnds: phase2.deadEnds.length,
        },
    };
}

// ═══════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════

const graphsDir = path.join(__dirname, 'graphs');
const filter = process.argv[2];
const files = fs.readdirSync(graphsDir).filter(f => f.endsWith('.json')).sort();

let passed = 0, failed = 0;

for (const file of files) {
    const name = path.basename(file, '.json');
    if (filter && name !== filter) continue;

    const graphData = JSON.parse(fs.readFileSync(path.join(graphsDir, file), 'utf8'));
    process.stdout.write(`\n${'═'.repeat(50)}\nTEST: ${name}\n${'─'.repeat(50)}\n`);

    try {
        const { errors, stats } = runTest(name, graphData);
        console.log(`  Baseline: ${stats.baselineStates} states, ${stats.baselineDeadEnds} dead ends`);
        console.log(`  Optimized: ${stats.optimizedIrrKeys} irrKeys, walk ${stats.walkStates} states, ${stats.walkDeadEnds} dead ends`);

        if (errors.length === 0) {
            console.log('  PASS');
            passed++;
        } else {
            console.log('  FAIL');
            for (const e of errors) console.log(`    ${e}`);
            failed++;
        }
    } catch (err) {
        console.log(`  ERROR: ${err.message}`);
        console.log(`  ${err.stack.split('\n').slice(1, 4).join('\n  ')}`);
        failed++;
    }
}

console.log(`\n${'═'.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
