#!/usr/bin/env node
// Simulate how index.html's wouldReachOutcome uses the precomputed reach set.
//
// For a given test graph + "locked" outcome, this:
//   1. Builds the reachMap using the real precompute pipeline
//      (precompute-reachability.js → buildMatchersAndCompute).
//   2. Extracts the reach-set that the browser would receive for that outcome
//      (the list of irrKeys where the outcome's bit is set — same serialization
//      as data/reach/<id>.json).
//   3. Enumerates the full state space via baseline DFS ("truth").
//   4. For every reachable state, for every enabled next-edge choice, checks:
//         browser_says_reachable  = _reachSet.has(irrKey(childSel))
//         truth_says_reachable    = outcome reachable from childSel in DFS
//      and reports mismatches.
//
// Usage: node test/reach-browser-sim.js [graphName] [lockedOutcomeId]
// Example: node test/reach-browser-sim.js convergence-basic outcome1

'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');

const ROOT = path.resolve(__dirname, '..');
const modKeys = ['graph', 'engine', 'walker', 'precompute'];
const modFiles = {
    graph:      'graph.js',
    engine:     'engine.js',
    walker:     'graph-walker.js',
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
    m.id = resolved.graph; m.filename = resolved.graph; m.loaded = true;
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

// ── browser helpers (copied verbatim from index.html) ─────────────
function lightPush(Engine, Walker, sel, nodeId, edgeId) {
    const next = Object.assign({}, sel);
    next[nodeId] = edgeId;
    if (!Walker.safePushDims.has(nodeId)) {
        Engine.cleanSelection(next, { autoForce: false });
    }
    return next;
}

// ── baseline DFS over the full state space ────────────────────────
// Stores stacks (not just sels) so we can replay the exact browser logic.
function baselineDFS(Engine, Walker, NODES, matchers) {
    const { createStack, push, currentState, isNodeVisible, isEdgeDisabled } = Engine;

    const states = new Map();  // stateKey -> { sel, stack, mask }

    function stateKey(sel) {
        return NODES.map(n => n.id + '=' + (sel[n.id] || '*')).join('|');
    }
    function checkMatchers(sel) {
        let m = 0;
        for (let i = 0; i < matchers.length; i++) if (matchers[i](sel)) m |= (1 << i);
        return m;
    }
    function pickNext(sel) {
        for (const n of NODES) {
            if (n.derived) continue;
            if (sel[n.id] !== undefined) continue;
            if (!n.edges || n.edges.length === 0) continue;
            if (!isNodeVisible(sel, n)) continue;
            return n;
        }
        return null;
    }
    function dfs(stk) {
        const sel = currentState(stk);
        const key = stateKey(sel);
        if (states.has(key)) return states.get(key).mask;
        const entry = { sel: { ...sel }, stack: stk, mask: 0 };
        states.set(key, entry);
        const self = checkMatchers(sel);
        const next = pickNext(sel);
        if (!next) { entry.mask = self; return self; }
        const enabled = next.edges.filter(e => !isEdgeDisabled(sel, next, e));
        let child = 0;
        // Use autoForce=true so stacks mirror the browser's real flow
        // (createStack and push auto-commit forced single-option moves).
        for (const e of enabled) child |= dfs(push(stk, next.id, e.id));
        entry.mask = self | child;
        return entry.mask;
    }
    dfs(createStack());
    return states;
}

// Faithful replay of the browser's findNextQuestion PAST any forced/locked
// nodes (those early-return with reachable:!disabled and don't touch the
// reach set). In the real app, forced nodes are auto-committed by the user
// clicking through, after which stack advances and findNextQuestion runs
// again. This helper emulates that: push forced nodes onto the stack until
// we reach a real multi-edge decision, then return it.
function nextDecisionNode(Engine, stack) {
    while (true) {
        const sel = Engine.currentState(stack);
        let advanced = false;
        let decision = null;
        for (const node of Engine.displayOrder(stack)) {
            const locked = Engine.isNodeLocked(sel, node);
            if (locked !== null) {
                if (!Engine.stackHas(stack, node.id)) {
                    // Forced single-edge → auto-commit like the UI does.
                    stack = Engine.push(stack, node.id, locked);
                    advanced = true;
                    break;
                }
                continue;
            }
            if (Engine.stackHas(stack, node.id)) continue;
            if (sel[node.id]) continue;
            const enabled = node.edges.filter(e => !Engine.isEdgeDisabled(sel, node, e));
            if (enabled.length === 0) continue;
            decision = { node, enabled, sel, stack };
            break;
        }
        if (decision) return decision;
        if (!advanced) return null;
    }
}

// ── main ──────────────────────────────────────────────────────────
const graphName = process.argv[2] || 'convergence-basic';
const lockedId  = process.argv[3] || null;

if (graphName === '--all') {
    const dir = path.join(__dirname, 'graphs');
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort();
    let anyFail = false;
    for (const f of files) {
        const name = path.basename(f, '.json');
        const { spawnSync } = require('child_process');
        const r = spawnSync(process.execPath, [__filename, name], { encoding: 'utf8' });
        process.stdout.write(r.stdout);
        if (r.status !== 0) anyFail = true;
    }
    process.exit(anyFail ? 1 : 0);
}

const graphPath = path.join(__dirname, 'graphs', graphName + '.json');
const graphData = JSON.parse(fs.readFileSync(graphPath, 'utf8'));
const templates = graphData.outcomes.templates;

const { Engine, Walker, precompute, NODES } = clearAndInject(graphData);

// Build matcher list the same way the precompute does.
const buildEntries = (tmpls) => {
    const entries = [];
    for (const t of tmpls) {
        const vs = (t.variants && typeof t.variants === 'object') ? Object.keys(t.variants) : null;
        if (vs && vs.length > 0 && t.primaryDimension) {
            for (const vk of vs) {
                entries.push({
                    id: t.id + '--' + vk,
                    matcher: (sel) => {
                        const st = Walker.resolvedState(sel);
                        return Engine.templateMatches(t, st) && st[t.primaryDimension] === vk;
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
};
const entries = buildEntries(templates);

// (1) Real precompute
const pre = precompute.buildMatchersAndCompute(templates, { quiet: true });
const allIds = pre.entries.map(e => e.id);

// If no locked id was specified, test all outcomes against baseline.
const toCheck = lockedId ? [lockedId] : allIds;
for (const id of toCheck) if (!allIds.includes(id)) {
    console.error(`Unknown outcome: ${id}. Options: ${allIds.join(', ')}`);
    process.exit(1);
}

// (2) Baseline DFS
const baselineStates = baselineDFS(Engine, Walker, NODES, entries.map(e => e.matcher));

function fmtSel(sel) {
    const parts = [];
    for (const n of NODES) if (sel[n.id] !== undefined) parts.push(`${n.id}=${sel[n.id]}`);
    return parts.length ? parts.join(' ') : '(root)';
}

console.log(`\n═══ ${graphName} ═══`);
console.log(`entries:           ${allIds.length} [${allIds.join(', ')}]`);
console.log(`baseline states:   ${baselineStates.size}`);
console.log(`reachMap irrKeys:  ${pre.reachMap.size}`);

let anyFail = false;

for (const id of toCheck) {
    const idx = allIds.indexOf(id);
    const bit = 1 << idx;
    const reachSet = new Set();
    for (const [ik, mask] of pre.reachMap) if (mask & bit) reachSet.add(ik);

    console.log(`\n─ lock=${id}  (reach-set size=${reachSet.size}) ─`);

    // Mirror the browser's actual wouldReachOutcome call-sites: only at real
    // decision points (multi-edge, non-forced) surfaced by findNextQuestion.
    let edgeFP = 0, edgeFN = 0, edgeChecked = 0, decisions = 0;
    const edgeMismatches = [];

    for (const { stack: startStack } of baselineStates.values()) {
        const next = nextDecisionNode(Engine, startStack);
        if (!next) continue;
        const sel = next.sel;
        decisions++;
        for (const edge of next.enabled) {
            // The browser does a LIGHT push (no autoForce) and looks up that
            // sel's irrKey. We mirror that for the browser side.
            const childLight = lightPush(Engine, Walker, sel, next.node.id, edge.id);
            const ik = Walker.irrKey(childLight);
            const browserReach = reachSet.has(ik);

            // Ground truth: after the browser's autoForce commit, can the
            // outcome be reached from that stack? Walk the baseline by
            // committing this edge with autoForce and looking up the
            // resulting state in the baseline map.
            const childStack = Engine.push(next.stack, next.node.id, edge.id);
            const childSel = Engine.currentState(childStack);
            const childKey = NODES.map(n => n.id + '=' + (childSel[n.id] || '*')).join('|');
            const truth = baselineStates.get(childKey);
            const truthReach = truth ? ((truth.mask & bit) !== 0) : false;

            edgeChecked++;
            if (browserReach && !truthReach) {
                edgeFP++;
                if (edgeMismatches.length < 5) edgeMismatches.push(
                    `  FP: at [${fmtSel(sel)}]  pick ${next.node.id}=${edge.id}  ik=${ik}`);
            } else if (!browserReach && truthReach) {
                edgeFN++;
                if (edgeMismatches.length < 5) edgeMismatches.push(
                    `  FN: at [${fmtSel(sel)}]  pick ${next.node.id}=${edge.id}  ik=${ik}`);
            }
        }
    }
    console.log(`  decisions:      ${decisions}  edges-checked=${edgeChecked}  FP=${edgeFP}  FN=${edgeFN}`);
    for (const m of edgeMismatches) console.log(m);
    if (edgeFP || edgeFN) anyFail = true;
}

process.exit(anyFail ? 1 : 0);
