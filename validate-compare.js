#!/usr/bin/env node
// Parallel validation: runs DFS with both V1 and V2 engines, reports divergences.
// Usage: node validate-compare.js

const fs = require('fs');
const path = require('path');

const v1 = require('./engine.js');
const v2 = require('./engine-v2.js');

const outcomes = JSON.parse(fs.readFileSync(path.join(__dirname, 'data/outcomes.json'), 'utf8'));
const templatesList = outcomes.templates;

// ════════════════════════════════════════════════════════
// Helpers (shared between both engines)
// ════════════════════════════════════════════════════════

function selKey(sel) {
    return Object.entries(sel)
        .filter(([k, v]) => v != null && k !== '_locked')
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k}=${v}`)
        .join('&');
}

function getNextNode(engine, sel) {
    for (const node of engine.NODES) {
        if (node.terminal || node.derived) continue;
        if (!engine.isNodeVisible(sel, node)) continue;
        if (engine.isNodeLocked(sel, node) !== null) continue;
        if (sel[node.id]) continue;
        return node;
    }
    for (const node of engine.NODES) {
        if (!node.terminal || node.derived) continue;
        if (!engine.isNodeVisible(sel, node)) continue;
        if (engine.isNodeLocked(sel, node) !== null) continue;
        if (sel[node.id]) continue;
        return node;
    }
    return null;
}

function getEnabledEdges(engine, sel, node) {
    return node.edges.filter(v => !engine.isEdgeDisabled(sel, node, v));
}

function forwardKey(engine, sel) {
    const FORWARD_KEY_NODES = engine.NODES.filter(d => d.forwardKey).map(d => d.id);
    const parts = [];
    const state = engine.resolvedState(sel);
    for (const k of FORWARD_KEY_NODES) {
        if (state[k]) parts.push(`E:${k}=${state[k]}`);
    }
    for (const node of engine.NODES) {
        if (!node.derivedFrom) continue;
        const raw = sel[node.id];
        const eff = state[node.id];
        if (raw && eff && raw !== eff) {
            parts.push(`R:${node.id}=${raw}`);
        }
    }
    for (const node of engine.NODES) {
        if (node.terminal || node.derived) continue;
        if (!engine.isNodeVisible(sel, node)) continue;
        if (engine.isNodeLocked(sel, node) !== null) continue;
        if (sel[node.id]) continue;
        const enabled = getEnabledEdges(engine, sel, node).map(v => v.id);
        parts.push(`${node.id}?${enabled.join(',')}`);
    }
    return parts.join('|');
}

// ════════════════════════════════════════════════════════
// Per-state comparison: given the same sel, ask both engines
// ════════════════════════════════════════════════════════

function compareState(sel) {
    const diffs = [];

    for (const v1node of v1.NODES) {
        const v2node = v2.NODE_MAP[v1node.id];
        if (!v2node) continue;

        const vis1 = v1.isNodeVisible(sel, v1node);
        const vis2 = v2.isNodeVisible(sel, v2node);
        if (vis1 !== vis2) {
            diffs.push({ type: 'visibility', node: v1node.id, v1: vis1, v2: vis2 });
        }

        const lock1 = v1.isNodeLocked(sel, v1node);
        const lock2 = v2.isNodeLocked(sel, v2node);
        if (lock1 !== lock2) {
            diffs.push({ type: 'locked', node: v1node.id, v1: lock1, v2: lock2 });
        }

        const rv1 = v1.resolvedVal(sel, v1node.id);
        const rv2 = v2.resolvedVal(sel, v2node.id);
        if (rv1 !== rv2) {
            diffs.push({ type: 'resolvedVal', node: v1node.id, v1: rv1, v2: rv2 });
        }

        if (v1node.edges) {
            for (const edge of v1node.edges) {
                const dis1 = v1.isEdgeDisabled(sel, v1node, edge);
                const v2edge = v2node.edges && v2node.edges.find(e => e.id === edge.id);
                const dis2 = v2edge ? v2.isEdgeDisabled(sel, v2node, v2edge) : true;
                if (dis1 !== dis2) {
                    diffs.push({ type: 'edgeDisabled', node: v1node.id, edge: edge.id, v1: dis1, v2: dis2 });
                }
            }
        }
    }

    return diffs;
}

// ════════════════════════════════════════════════════════
// DFS runner (parameterized by engine)
// ════════════════════════════════════════════════════════

function runDFS(engine, label) {
    let totalStates = 0;
    let totalLeaves = 0;
    const visited = new Set();
    const worklist = [engine.createStack()];
    const violations = { deadEnd: 0, stuck: 0 };

    while (worklist.length > 0) {
        const stk = worklist.pop();
        const sel = engine.currentState(stk);

        const fk = forwardKey(engine, sel);
        if (visited.has(fk)) continue;
        visited.add(fk);
        totalStates++;

        if (totalStates % 2000 === 0) {
            process.stdout.write(`\r  [${label}] ${totalStates.toLocaleString()} states...`);
        }

        // Check for stuck nodes
        for (const node of engine.NODES) {
            if (node.derived) continue;
            if (!engine.isNodeVisible(sel, node)) continue;
            if (engine.isNodeLocked(sel, node) !== null) continue;
            if (sel[node.id]) continue;
            const ena = getEnabledEdges(engine, sel, node);
            if (ena.length === 0) violations.stuck++;
        }

        const next = getNextNode(engine, sel);
        if (next) {
            for (const edge of getEnabledEdges(engine, sel, next)) {
                worklist.push(engine.push(stk, next.id, edge.id));
            }
        } else {
            totalLeaves++;
            const state = engine.resolvedState(sel);
            const matched = templatesList.filter(t => engine.templateMatches(t, state));
            if (matched.length === 0) violations.deadEnd++;
        }
    }

    process.stdout.write(`\r`);
    return { totalStates, totalLeaves, violations };
}

// ════════════════════════════════════════════════════════
// Main: run V1 DFS with per-state V2 comparison, then V2 DFS independently
// ════════════════════════════════════════════════════════

console.log('Singularity Map — V1/V2 Comparison');
console.log('═'.repeat(50));

// Phase A: DFS with V1, compare V2 at each state
console.log('\nPhase A: V1 DFS with per-state V2 comparison');
const divergences = [];
let comparedStates = 0;

{
    const visited = new Set();
    const worklist = [v1.createStack()];

    while (worklist.length > 0) {
        const stk = worklist.pop();
        const sel = v1.currentState(stk);

        const fk = forwardKey(v1, sel);
        if (visited.has(fk)) continue;
        visited.add(fk);
        comparedStates++;

        if (comparedStates % 2000 === 0) {
            process.stdout.write(`\r  ${comparedStates.toLocaleString()} states compared...`);
        }

        const diffs = compareState(sel);
        if (diffs.length > 0) {
            divergences.push({ sel: selKey(sel), diffs });
        }

        const next = getNextNode(v1, sel);
        if (next) {
            for (const edge of getEnabledEdges(v1, sel, next)) {
                worklist.push(v1.push(stk, next.id, edge.id));
            }
        }
    }
}

process.stdout.write(`\r`);
console.log(`  ${comparedStates.toLocaleString()} states compared`);

if (divergences.length === 0) {
    console.log('  ✓ Zero divergences — V1 and V2 produce identical results');
} else {
    console.log(`  ✗ ${divergences.length} states with divergences:`);
    const MAX_SHOW = 20;
    for (let i = 0; i < Math.min(divergences.length, MAX_SHOW); i++) {
        const d = divergences[i];
        console.log(`\n    State: ${d.sel}`);
        for (const diff of d.diffs) {
            if (diff.type === 'edgeDisabled') {
                console.log(`      ${diff.type}: ${diff.node}.${diff.edge} — V1=${diff.v1}, V2=${diff.v2}`);
            } else {
                console.log(`      ${diff.type}: ${diff.node} — V1=${diff.v1}, V2=${diff.v2}`);
            }
        }
    }
    if (divergences.length > MAX_SHOW) {
        console.log(`\n    ... and ${divergences.length - MAX_SHOW} more`);
    }

    // Summarize divergence types
    const typeCounts = {};
    for (const d of divergences) {
        for (const diff of d.diffs) {
            const key = `${diff.type}:${diff.node}${diff.edge ? '.' + diff.edge : ''}`;
            typeCounts[key] = (typeCounts[key] || 0) + 1;
        }
    }
    console.log('\n  Divergence summary:');
    for (const [key, count] of Object.entries(typeCounts).sort((a, b) => b[1] - a[1])) {
        console.log(`    ${key}: ${count} states`);
    }
}

// Phase B: Independent V1 and V2 DFS
console.log('\nPhase B: Independent DFS runs');

const t1 = Date.now();
const v1Result = runDFS(v1, 'V1');
const v1ms = ((Date.now() - t1) / 1000).toFixed(1);

const t2 = Date.now();
const v2Result = runDFS(v2, 'V2');
const v2ms = ((Date.now() - t2) / 1000).toFixed(1);

console.log(`  V1: ${v1Result.totalStates.toLocaleString()} states, ${v1Result.totalLeaves.toLocaleString()} leaves (${v1ms}s)`);
console.log(`       dead-ends: ${v1Result.violations.deadEnd}, stuck: ${v1Result.violations.stuck}`);
console.log(`  V2: ${v2Result.totalStates.toLocaleString()} states, ${v2Result.totalLeaves.toLocaleString()} leaves (${v2ms}s)`);
console.log(`       dead-ends: ${v2Result.violations.deadEnd}, stuck: ${v2Result.violations.stuck}`);

if (v1Result.totalStates === v2Result.totalStates && v1Result.totalLeaves === v2Result.totalLeaves) {
    console.log('  ✓ State counts match');
} else {
    console.log('  ✗ State counts differ');
}

console.log();
