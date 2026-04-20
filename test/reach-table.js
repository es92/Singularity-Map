#!/usr/bin/env node
'use strict';

// Dump a reachability table for a single test graph.
// Usage: node test/reach-table.js [graphName]   (default: convergence-basic)

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
        NODES, NODE_MAP,
    };
    require.cache[resolved.graph] = m;

    return {
        Engine:     require(resolved.engine),
        Walker:     require(resolved.walker),
        precompute: require(resolved.precompute),
        NODES,
    };
}

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

function baselineDFS(Engine, Walker, NODES, matcherEntries) {
    const { createStack, push, currentState, isNodeVisible, isEdgeDisabled } = Engine;
    const matchers = matcherEntries.map(e => e.matcher);

    // visited: stateKey -> { sel, mask }
    const visited = new Map();

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
        if (visited.has(key)) return visited.get(key).mask;

        const entry = { sel: { ...sel }, mask: 0, selfMatches: 0 };
        visited.set(key, entry);

        const termMask = checkMatchers(sel);
        entry.selfMatches = termMask;
        const next = pickNext(sel);

        if (!next) {
            entry.mask = termMask;
            return termMask;
        }

        const enabled = next.edges.filter(e => !isEdgeDisabled(sel, next, e));
        let childMask = 0;
        for (const edge of enabled) {
            childMask |= dfs(push(stk, next.id, edge.id));
        }

        entry.mask = termMask | childMask;
        return entry.mask;
    }

    dfs(createStack());
    return visited;
}

function fmtMask(mask, entries) {
    if (mask === 0) return '—';
    const bits = [];
    for (let i = 0; i < entries.length; i++) {
        if (mask & (1 << i)) bits.push(entries[i].id);
    }
    return bits.join(', ');
}

function fmtSel(sel, NODES) {
    const parts = [];
    for (const n of NODES) {
        if (sel[n.id] !== undefined) parts.push(`${n.id}=${sel[n.id]}`);
    }
    return parts.length ? parts.join(' ') : '(root)';
}

function pad(s, w) {
    s = String(s);
    return s.length >= w ? s : s + ' '.repeat(w - s.length);
}

// ─── main ──────────────────────────────────────────────────────────────────

const graphName = process.argv[2] || 'convergence-basic';
const graphPath = path.join(__dirname, 'graphs', graphName + '.json');
if (!fs.existsSync(graphPath)) {
    console.error(`No such graph: ${graphPath}`);
    process.exit(1);
}
const graphData = JSON.parse(fs.readFileSync(graphPath, 'utf8'));
const templates = graphData.outcomes.templates;

const { Engine, Walker, precompute, NODES } = clearAndInject(graphData);
const entries = buildMatchers(Engine, Walker, templates);
const matchers = entries.map(e => e.matcher);

// 1. Baseline: per full-state reach
const states = baselineDFS(Engine, Walker, NODES, entries);

// 2. Optimized: reachMap keyed by irrKey
const optimized = precompute.buildMatchersAndCompute(templates, { quiet: true });

// ── table 1: full state → reach (baseline DFS) ─────────────────────────────
console.log(`\nGraph: ${graphName}`);
console.log(`Matchers: ${entries.map((e, i) => `${i}=${e.id}`).join(', ')}\n`);

console.log('─ Table 1: baseline DFS — reach from each full state ─');
const rows = [...states.values()].map(({ sel, mask, selfMatches }) => ({
    state:   fmtSel(sel, NODES),
    irrKey:  Walker.irrKey(sel) || '(empty)',
    self:    fmtMask(selfMatches, entries),
    reach:   fmtMask(mask, entries),
}));
const wState = Math.max(5, ...rows.map(r => r.state.length));
const wIrr   = Math.max(6, ...rows.map(r => r.irrKey.length));
const wSelf  = Math.max(4, ...rows.map(r => r.self.length));
const wReach = Math.max(5, ...rows.map(r => r.reach.length));
console.log(`  ${pad('state', wState)}  ${pad('irrKey', wIrr)}  ${pad('here', wSelf)}  reachable`);
console.log(`  ${'-'.repeat(wState)}  ${'-'.repeat(wIrr)}  ${'-'.repeat(wSelf)}  ${'-'.repeat(wReach)}`);
for (const r of rows) {
    console.log(`  ${pad(r.state, wState)}  ${pad(r.irrKey, wIrr)}  ${pad(r.self, wSelf)}  ${r.reach}`);
}

// ── table 2: optimized reachMap keyed by irrKey ────────────────────────────
console.log('\n─ Table 2: optimized reachMap (keyed by irrKey) ─');
const optRows = [...optimized.reachMap.entries()].map(([ik, mask]) => ({
    irrKey: ik || '(empty)',
    reach:  fmtMask(mask, entries),
}));
const wOptIrr   = Math.max(6, ...optRows.map(r => r.irrKey.length));
const wOptReach = Math.max(5, ...optRows.map(r => r.reach.length));
console.log(`  ${pad('irrKey', wOptIrr)}  reachable`);
console.log(`  ${'-'.repeat(wOptIrr)}  ${'-'.repeat(wOptReach)}`);
for (const r of optRows) {
    console.log(`  ${pad(r.irrKey, wOptIrr)}  ${r.reach}`);
}

// ── table 3: aggregate baseline by irrKey and diff vs optimized ────────────
console.log('\n─ Table 3: baseline-aggregated-by-irrKey  vs  optimized ─');
const aggByIK = new Map();
for (const { sel, mask } of states.values()) {
    const ik = Walker.irrKey(sel) || '(empty)';
    aggByIK.set(ik, (aggByIK.get(ik) || 0) | mask);
}
const allKeys = new Set([...aggByIK.keys(), ...[...optimized.reachMap.keys()].map(k => k || '(empty)')]);
const diffRows = [...allKeys].map(ik => {
    const bl  = aggByIK.get(ik) || 0;
    const opt = optimized.reachMap.get(ik === '(empty)' ? '' : ik) || 0;
    const extra   = opt & ~bl;
    const missing = bl & ~opt;
    return {
        irrKey: ik,
        bl:     fmtMask(bl,  entries),
        opt:    fmtMask(opt, entries),
        diff:   (extra || missing)
            ? (extra   ? `+${fmtMask(extra,   entries)}` : '') +
              (missing ? ` -${fmtMask(missing, entries)}` : '')
            : 'ok',
    };
});
const wDIrr  = Math.max(6, ...diffRows.map(r => r.irrKey.length));
const wDBl   = Math.max(8, ...diffRows.map(r => r.bl.length));
const wDOpt  = Math.max(9, ...diffRows.map(r => r.opt.length));
console.log(`  ${pad('irrKey', wDIrr)}  ${pad('baseline', wDBl)}  ${pad('optimized', wDOpt)}  diff`);
console.log(`  ${'-'.repeat(wDIrr)}  ${'-'.repeat(wDBl)}  ${'-'.repeat(wDOpt)}  ----`);
for (const r of diffRows) {
    console.log(`  ${pad(r.irrKey, wDIrr)}  ${pad(r.bl, wDBl)}  ${pad(r.opt, wDOpt)}  ${r.diff}`);
}

console.log('');
