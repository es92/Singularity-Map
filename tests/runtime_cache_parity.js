#!/usr/bin/env node
'use strict';

// runtime_cache_parity.js — Verifies that every sel the engine
// produces at a slot boundary appears in that slot's `.full.bin`
// exit cache.
//
// This is the single invariant Option A is supposed to restore:
// the static merge in `reachableFullSelsFromInputs` MUST produce
// runtime-shape sels. If the cache preserves any dim the engine
// moves out (`effects.move`) the runtime sel won't match any cache
// sel, and `random_walks_locked.js` (and the eventual runtime gate)
// silently under-report reach.
//
// No reach gating, no DFS — pure cache-vs-runtime parity along
// random paths. Run before AND after the option-A precompute change
// to track regression.
//
// Output: one line per (slotKey, signature) failure pattern, where
// signature = sorted list of dims the cache has but runtime doesn't
// PLUS dims runtime has but cache doesn't. One example sel per
// pattern. Grouped this way because random walks hit the same
// structural mismatch hundreds of times — the shape, not the
// exemplar count, is what's diagnostic.
//
// Usage:
//   node tests/runtime_cache_parity.js                  500 walks
//   node tests/runtime_cache_parity.js --walks 2000     heavier sweep
//   node tests/runtime_cache_parity.js --seed 7
//   node tests/runtime_cache_parity.js --verbose        every failure
//
// Exits 0 on full parity, 1 on any divergence.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const { Graph, Engine, GraphIO, FlowPropagation, NODES, NODE_MAP } =
    require(path.join(ROOT, 'node-runtime')).loadNodeRuntime();
const { nextAction } = require(path.join(ROOT, 'walk-step'));
const _walkDeps = { Engine, FlowPropagation };

const Cache = require(path.join(ROOT, 'explore-cache'));

// ── CLI ──

const args = process.argv.slice(2);
function getArg(flag, fallback) {
    const i = args.indexOf(flag);
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}
const NUM_WALKS = parseInt(getArg('--walks', '500'), 10);
const SEED = parseInt(getArg('--seed', '1'), 10);
const VERBOSE = args.includes('--verbose');
const STEP_CAP = parseInt(getArg('--step-cap', '500'), 10);

// ── Helpers ──

const { selKey } = require('../sel-key');

function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// Pre-load every slot's full-sel cache once. Each `view` is a binary
// reader; we materialize a `Set<selKey>` per slot (~50 MB for 1.88M
// entries, fits comfortably) so membership is O(1) instead of a per-
// query linear scan over 110K-446K entries.
console.log('Loading slot caches…');
const t0 = Date.now();
const cacheDir = path.join(ROOT, 'data', 'explore-cache');
const slotKeys = fs.readdirSync(cacheDir)
    .filter(f => f.endsWith('.full.bin'))
    .map(f => f.slice(0, -'.full.bin'.length));
const cacheBySlot = new Map(); // slotKey -> { keys: Set<selKey>, byKey: Map<selKey, sel> }
const slotMeta    = new Map(); // slotKey -> { kind, id }
let totalEntries = 0;
for (const k of slotKeys) {
    const v = Cache.openFullSels(k);
    if (!v) continue;
    const keys = new Set();
    const byKey = new Map();
    for (let i = 0; i < v.selCount; i++) {
        const s = v.getSel(i);
        const sk = selKey(s);
        keys.add(sk);
        byKey.set(sk, s);
    }
    cacheBySlot.set(k, { keys, byKey });
    slotMeta.set(k, { kind: v.slotKind, id: v.slotId });
    totalEntries += v.selCount;
}
console.log(`  ${totalEntries.toLocaleString()} entries across ${cacheBySlot.size} slots in ${((Date.now() - t0) / 1000).toFixed(2)}s.\n`);

// Counts the number of times the runtime's flowNext skipped past a
// slot mid-module (no askable internal, completion marker not set,
// re-routed to another slot via the global fallback). Reported
// separately from cache-parity failures because the cache is right
// not to record these states.
const midModuleFallthrough = new Map();

// ── Diff helper: classify the gap between a runtime sel and the
// closest cache sel for a slot. ──
//
// Returns either { kind: 'match' } or { kind: 'mismatch',
// extraInCache, extraInRuntime, valueDiffs, sample } where:
//   * extraInCache    — dim names present in some cache sel but not
//                       in runtime (cache preserves; runtime moved).
//   * extraInRuntime  — present in runtime but absent in any
//                       superset-matching cache sel.
//   * valueDiffs      — dim names where runtime + the closest cache
//                       sel hold different values.
//   * sample          — a closest-superset cache sel, if any (used
//                       to render the diff in error output).
//
// "Closest" = the cache sel that shares the most dim+value pairs
// with the runtime sel. We scan the slot's cache linearly. For
// failure-pattern grouping we only need the dim NAMES, not values,
// so the scan is bounded and cheap (only on miss).
function diffAgainstCache(runtimeSel, slotSlot) {
    const sk = selKey(runtimeSel);
    if (slotSlot.keys.has(sk)) return { kind: 'match' };

    const rtKeys = Object.keys(runtimeSel);
    let bestSel = null;
    let bestOverlap = -1;
    let bestExtraInCache = null;
    let bestExtraInRuntime = null;
    for (const candidate of slotSlot.byKey.values()) {
        let overlap = 0;
        let valueDiffs = 0;
        for (const d of rtKeys) {
            if (candidate[d] === runtimeSel[d]) overlap++;
            else if (candidate[d] !== undefined) valueDiffs++;
        }
        if (valueDiffs === 0 && overlap > bestOverlap) {
            bestOverlap = overlap;
            bestSel = candidate;
            bestExtraInCache = Object.keys(candidate).filter(d => runtimeSel[d] === undefined);
            bestExtraInRuntime = rtKeys.filter(d => candidate[d] === undefined);
        }
    }

    if (bestSel) {
        return {
            kind: 'mismatch',
            extraInCache: bestExtraInCache.sort(),
            extraInRuntime: (bestExtraInRuntime || []).sort(),
            valueDiffs: [],
            sample: bestSel,
        };
    }

    // No superset match: either the runtime has dims no cache sel
    // has (extraInRuntime), or some dims hold different values.
    let bestValueSel = null;
    let bestValueOverlap = -1;
    let bestValueDiffs = null;
    let bestExtraInRuntimeVal = null;
    let bestExtraInCacheVal = null;
    for (const candidate of slotSlot.byKey.values()) {
        let overlap = 0;
        const valueDiffs = [];
        for (const d of rtKeys) {
            if (candidate[d] === runtimeSel[d]) overlap++;
            else if (candidate[d] !== undefined) valueDiffs.push(d);
        }
        if (overlap > bestValueOverlap) {
            bestValueOverlap = overlap;
            bestValueSel = candidate;
            bestValueDiffs = valueDiffs.sort();
            bestExtraInRuntimeVal = rtKeys.filter(d => candidate[d] === undefined).sort();
            bestExtraInCacheVal = Object.keys(candidate).filter(d => runtimeSel[d] === undefined).sort();
        }
    }
    return {
        kind: 'mismatch',
        extraInCache: bestExtraInCacheVal || [],
        extraInRuntime: bestExtraInRuntimeVal || [],
        valueDiffs: bestValueDiffs || [],
        sample: bestValueSel,
    };
}

function patternKey(slotKey, diff) {
    return [
        slotKey,
        '+cache:' + diff.extraInCache.join(','),
        '+runtime:' + diff.extraInRuntime.join(','),
        '!=:' + diff.valueDiffs.join(','),
    ].join(' | ');
}

// ── Walk ──

// A runtime sel "really exited" a slot only when:
//   * module slot: its completionMarker dim is set in sel (module-
//                  done — runtime + cache agree this is an exit).
//   * node slot:   its node-id dim is set in sel.
// Mid-module fall-through (flow.slotKey changing because no internal
// is askable) is a SEPARATE engine bug — the slot didn't produce a
// real exit, so its cache (which only stores module-done sels) has
// no business matching. Skip those checks here.
function reallyExited(slotKey, runtimeSel) {
    const slot = (typeof Engine.MODULE_MAP === 'object')
        ? null : null; // resolved below
    // We don't have direct access to FLOW_DAG slot definitions in
    // this scope, so look up via Engine + the cache's known kind.
    const meta = slotMeta.get(slotKey);
    if (!meta) return true; // unknown slot — fail open to surface it
    if (meta.kind === 'module') {
        const m = Engine.MODULE_MAP[meta.id];
        if (!m || !m.completionMarker) return true;
        return Engine.isModuleDone(runtimeSel, m.completionMarker);
    }
    if (meta.kind === 'node') {
        return runtimeSel[meta.id] !== undefined;
    }
    return true;
}

function checkSlotExit(slotKey, runtimeSel, failures, reason, stack) {
    const slotSlot = cacheBySlot.get(slotKey);
    if (!slotSlot) {
        // Some slots (rollout terminals, dead-ends) don't have an
        // exit cache because they never produce outputs. Skip
        // silently — the precompute is right not to write them.
        return;
    }
    if (!reallyExited(slotKey, runtimeSel)) {
        // Mid-module fall-through: the runtime advanced past this
        // slot without completing it (the engine's flowNext
        // re-routed because no internal was askable). Distinct
        // bug class, not a precompute soundness issue. Tracked
        // separately.
        midModuleFallthrough.set(slotKey,
            (midModuleFallthrough.get(slotKey) || 0) + 1);
        return;
    }
    const diff = diffAgainstCache(runtimeSel, slotSlot);
    if (diff.kind === 'match') return;
    const pat = patternKey(slotKey, diff);
    const existing = failures.get(pat);
    if (existing) {
        existing.count++;
        return;
    }
    // Capture stack history (sequence of slots visited) on first
    // hit, so we can see which path led here.
    const visited = [];
    if (stack) {
        const items = stack.items || stack;
        if (Array.isArray(items)) {
            for (const item of items) {
                if (item && item.nodeId) visited.push(`${item.nodeId}=${item.edgeId}`);
            }
        }
    }
    failures.set(pat, {
        count: 1,
        slotKey,
        diff,
        runtimeSel,
        visited,
    });
}

function walk(rand, failures, debugLog) {
    let stack = Engine.createStack();
    let currentSlotKey = null;

    for (let step = 0; step < STEP_CAP; step++) {
        const a = nextAction(stack, _walkDeps);
        const parentSlotKey = FlowPropagation.parentSlotKeyFromStack(stack);

        if (debugLog) debugLog.push(`step ${step}: parent=${parentSlotKey || 'null'} flowSlot=${a.flow.slotKey || a.flow.kind} sel=${JSON.stringify(a.sel)}`);

        if (a.kind === 'open') {
            if (currentSlotKey !== null) checkSlotExit(currentSlotKey, a.sel, failures, 'open', stack);
            return 'open';
        }
        if (a.kind === 'stuck') {
            if (currentSlotKey !== null) checkSlotExit(currentSlotKey, a.sel, failures, 'stuck', stack);
            return 'stuck';
        }
        if (a.kind === 'unknown-flow') return 'unknown';

        if (a.flow.slotKey !== currentSlotKey) {
            if (currentSlotKey !== null) checkSlotExit(currentSlotKey, a.sel, failures, 'transition', stack);
            currentSlotKey = a.flow.slotKey;
        }

        let edgeId;
        if (a.kind === 'auto-locked') {
            edgeId = a.edgeId;
        } else {
            if (a.enabled.length === 0) return 'no-edges';
            edgeId = a.enabled[Math.floor(rand() * a.enabled.length)].id;
        }
        const stackLenBefore = stack.length;
        stack = Engine.push(stack, a.node.id, edgeId);
        // Engine.push rolls back to before the existing answer when
        // re-answering the same node, then re-applies — random walks
        // hit this constantly. After a rollback, the previous slot
        // wasn't really exited; the test's `currentSlotKey` is stale.
        // Reset it so the next iteration's flow.slotKey is treated
        // as a fresh entry rather than an exit.
        if (stack.length <= stackLenBefore) {
            currentSlotKey = null;
        }
    }
    return 'step-cap';
}

// ── Main ──

const rand = mulberry32(SEED);
const failures = new Map(); // patternKey -> { count, slotKey, diff, runtimeSel }
const terminals = { open: 0, stuck: 0, 'no-edges': 0, 'step-cap': 0, unknown: 0 };

const tWalk0 = Date.now();
console.log(`Walking ${NUM_WALKS} random paths (seed=${SEED})…`);
const DEBUG_FIRST_FAIL = args.includes('--debug-first-fail');
let firstFailWalkLog = null;
let firstFailWalkIdx = -1;
for (let i = 0; i < NUM_WALKS; i++) {
    const before = failures.size;
    const debugLog = DEBUG_FIRST_FAIL && firstFailWalkIdx === -1 ? [] : null;
    const term = walk(rand, failures, debugLog);
    if (DEBUG_FIRST_FAIL && debugLog && failures.size > before && firstFailWalkIdx === -1) {
        firstFailWalkLog = debugLog;
        firstFailWalkIdx = i;
    }
    terminals[term] = (terminals[term] || 0) + 1;
    if ((i + 1) % 250 === 0) {
        process.stdout.write(`  ${i + 1}/${NUM_WALKS}…\r`);
    }
}
if (firstFailWalkLog) {
    console.log(`\n\n── First-failing walk #${firstFailWalkIdx} step trace ──`);
    for (const line of firstFailWalkLog) console.log('  ' + line);
}
console.log(`  done in ${((Date.now() - tWalk0) / 1000).toFixed(2)}s.`);
console.log(`  terminals:`, Object.entries(terminals).filter(([, v]) => v > 0).map(([k, v]) => `${k}=${v}`).join('  '));

if (midModuleFallthrough.size > 0) {
    const total = [...midModuleFallthrough.values()].reduce((a, n) => a + n, 0);
    console.log(`\nNote: ${total.toLocaleString()} mid-module fall-through transitions skipped (runtime advanced past slot without completing it). Per slot:`);
    const sortedFallthroughs = [...midModuleFallthrough.entries()]
        .sort((a, b) => b[1] - a[1]);
    for (const [k, n] of sortedFallthroughs) {
        console.log(`  ${k.padEnd(28)} ${String(n).padStart(6)}`);
    }
    console.log(`(Tracked separately — these are runtime fall-through bugs, not precompute soundness gaps.)`);
}

if (failures.size === 0) {
    console.log(`\nPASS — every real slot-exit sel along all walks is in its cache.`);
    process.exit(0);
}

console.log(`\nFAIL — ${failures.size} distinct mismatch patterns across ${[...failures.values()].reduce((a, f) => a + f.count, 0).toLocaleString()} slot-exit checks.\n`);

// Sort patterns by hit count descending so the structurally common
// patterns (the bulk of the divergence) surface first.
const sorted = [...failures.values()].sort((a, b) => b.count - a.count);
const limit = VERBOSE ? sorted.length : Math.min(sorted.length, 20);

for (let i = 0; i < limit; i++) {
    const f = sorted[i];
    console.log(`── slot=${f.slotKey}  hits=${f.count}`);
    if (f.diff.extraInCache.length > 0) {
        console.log(`     cache has dims runtime moved out:  ${f.diff.extraInCache.join(', ')}`);
    }
    if (f.diff.extraInRuntime.length > 0) {
        console.log(`     runtime has dims cache lacks:      ${f.diff.extraInRuntime.join(', ')}`);
    }
    if (f.diff.valueDiffs.length > 0) {
        console.log(`     value disagreement on:             ${f.diff.valueDiffs.join(', ')}`);
    }
    console.log(`     example runtime sel: ${JSON.stringify(f.runtimeSel)}`);
    if (f.diff.sample) {
        console.log(`     closest cache sel:   ${JSON.stringify(f.diff.sample)}`);
    }
    if (f.visited && f.visited.length) {
        console.log(`     stack path: ${f.visited.join(' → ')}`);
    }
    console.log();
}

if (!VERBOSE && sorted.length > limit) {
    console.log(`…${sorted.length - limit} more patterns (use --verbose to see all)`);
}

process.exit(1);
