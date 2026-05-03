#!/usr/bin/env node
'use strict';

// derive-reach-per-outcome.js — Per-outcome reach files derived from
// the new explore-cache pipeline.
//
// Replaces precompute-reachability.js. The new pipeline (precompute-
// explore + reach-direct + reach-backprop) is the source of truth for
// per-(slot, sel) reach masks; this script bit-slices those masks
// across outcome entries and writes one gz file per entry, in exactly
// the format index.html's `wouldReachOutcome` already consumes:
//
//   * `<slotKey>|o|<compactProjKey>` for top-level / module-exit
//                                    clicks (writeDimsForSlot)
//   * `<moduleId>|i|<compactProjKey>` for in-module clicks
//                                    (innerDimsForSlot)
//
// OUTER keys come straight from each slot's *.full.bin: project every
// full sel onto writeDims and OR-merge masks per projected key.
//
// INNER keys require enumerating mid-module partial states. For each
// module, we DFS through its internals from every input bucket the
// new cache records (predecessor sels of any of the module's
// wrapping slots). At each visited partial state we OR the forward
// reach mask in under the innerDims-projected key. Module-done
// states pull their mask from `reachBySlot` directly (post-Option-A
// the runtime selKey at exit lands in the cache), OR-merged across
// every slot wrapping the module — multi-slot modules (escape × 5)
// can reach different downstream outcomes from different wrappers
// and the runtime gate can't disambiguate after the click.
//
// Why the explicit DFS here instead of reusing reach-checker's
// `_dfsInModule`? The checker memoizes on full selKey and only
// returns the top-level mask — perfect for a single runtime gate
// lookup, but it never emits the per-partial-state mask under the
// inner-projected key the gate stores. The DFS shape here is
// identical (mirrors `_dfsModuleOutputs` / `engine.findNextQ`); only
// the memo key + the per-state record-keeping differ.
//
// Run: `node derive-reach-per-outcome.js` after the explore-cache
// pipeline. Writes data/reach/<entryId>.json.gz.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

global.window = {
    requestAnimationFrame: () => 0,
    addEventListener: () => {},
    location: { hash: '' },
};
global.document = {
    addEventListener: () => {},
    readyState: 'complete',
    getElementById: () => null,
    querySelector: () => null,
};

const ROOT = __dirname;
const Graph = require(path.join(ROOT, 'graph.js'));
global.window.Graph = Graph;
const Engine = require(path.join(ROOT, 'engine.js'));
global.window.Engine = Engine;
new Function('window', fs.readFileSync(path.join(ROOT, 'graph-io.js'), 'utf8'))(global.window);
new Function('window', 'document', fs.readFileSync(path.join(ROOT, 'nodes.js'), 'utf8'))(global.window, global.document);
new Function('window', fs.readFileSync(path.join(ROOT, 'flow-propagation.js'), 'utf8'))(global.window);

const GraphIO = global.window.GraphIO;
GraphIO.setStrictTruncation(true);
const FLOW_DAG = global.window.Nodes.FLOW_DAG;
const MODULES = Engine.MODULES;
const MODULE_MAP = Engine.MODULE_MAP;

const outcomesData = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/outcomes.json'), 'utf8'));
GraphIO.registerOutcomes(outcomesData.templates);

const Cache = require(path.join(ROOT, 'explore-cache'));
const meta = Cache.loadMeta();
if (!meta || !Array.isArray(meta.outcomeEntries)) {
    throw new Error('data/explore-cache/_meta.json missing — run precompute-explore.js first');
}

// ─── Per-outcome key sets ─────────────────────────────────────────
const perOutcomeSets = new Map();
for (const e of meta.outcomeEntries) perOutcomeSets.set(e.id, new Set());
const bitToEntries = new Map();
for (const e of meta.outcomeEntries) {
    let arr = bitToEntries.get(e.bit);
    if (!arr) { arr = []; bitToEntries.set(e.bit, arr); }
    arr.push(e);
}

function distribute(key, mask) {
    if (!mask) return;
    for (const e of meta.outcomeEntries) {
        if ((mask & e.bit) !== 0) perOutcomeSets.get(e.id).add(key);
    }
}

const allSlotKeys = fs.readdirSync(Cache.cacheDir())
    .filter(f => f.endsWith('.full.bin'))
    .map(f => f.slice(0, -'.full.bin'.length))
    .sort();
console.log(`Found ${allSlotKeys.length} slot caches.`);

// ─── Pass 1: OUTER keys ───────────────────────────────────────────
// Iterate every slot's full sels, project on writeDims, OR-merge.
// outerByKey is also reused in Pass 2 — when a module-done DFS state
// pulls its mask from the cache, we look up the OR of every exit sel
// sharing the same writeDims projection (not by full selKey),
// because the runtime gate's outer key is writeDims-projected too:
// upstream pass-through dims that vary across exits but agree on the
// writeDims projection must contribute their reach to the inner
// state's mask, or the derive output under-emits keys runtime
// over-greys would have hit.
console.log('\nPass 1: outer keys (per-slot writeDims projection)…');
const tOuter = Date.now();
const outerByKey = new Map(); // `<slotKey>|o|<projKey>` → mask
for (const slot of FLOW_DAG.nodes) {
    if (!slot || (slot.kind !== 'module' && slot.kind !== 'node')) continue;
    const v = Cache.openFullSels(slot.key);
    if (!v) continue;
    const writeDims = GraphIO.writeDimsForSlot(slot);
    for (let i = 0; i < v.selCount; i++) {
        const mask = v.getReach(i) | 0;
        if (!mask) continue;
        const sel = v.getSel(i);
        const pk = GraphIO.compactProjectKey(sel, writeDims);
        const key = slot.key + '|o|' + pk;
        outerByKey.set(key, (outerByKey.get(key) || 0) | mask);
    }
}
for (const [key, mask] of outerByKey) distribute(key, mask);
console.log(`  ${outerByKey.size.toLocaleString()} outer keys in ${((Date.now() - tOuter) / 1000).toFixed(2)}s.`);

// ─── Pass 2: INNER keys (per-module DFS) ──────────────────────────
console.log('\nPass 2: inner keys (per-module DFS)…');
const tInner = Date.now();
let innerEmitted = 0;
let modulesProcessed = 0;

function _applyEdgeWrites(sel, node, edge) {
    const next = Object.assign({}, sel, { [node.id]: edge.id });
    Engine.applyEdgeEffects(next, edge, null);
    return next;
}

for (const mod of MODULES) {
    const slots = FLOW_DAG.nodes.filter(n => n && n.kind === 'module' && n.id === mod.id);
    if (!slots.length) continue;

    // innerDims + writeDims are module-shared (mod.reads/writes/nodeIds
    // don't change across wrappers).
    const innerDims = GraphIO.innerDimsForSlot(slots[0]);
    const writeDims = GraphIO.writeDimsForSlot(slots[0]);

    // Seed sels: every predecessor full sel of every wrapping slot,
    // deduped by innerDims projection (states agreeing on innerDims
    // produce identical DFS sub-trees — innerDims is the closure of
    // every dim that affects branching or exit projection).
    // emergence is the root: no predecessors in the cache, seed with
    // empty sel (the actual runtime entry state).
    const seedByInnerKey = new Map();
    if (mod.id === 'emergence') {
        seedByInnerKey.set('', {});
    } else {
        for (const slot of slots) {
            const v = Cache.openFullSels(slot.key);
            if (!v) continue;
            for (let i = 0; i < v.selCount; i++) {
                v.iteratePreds(i, predSel => {
                    const ik = GraphIO.compactProjectKey(predSel, innerDims);
                    if (!seedByInnerKey.has(ik)) seedByInnerKey.set(ik, predSel);
                });
            }
        }
    }
    if (seedByInnerKey.size === 0) continue;

    // DFS keyed on innerDims projection (memo + emit key share the
    // same projection — see OLD precompute-reachability.js' rationale,
    // copy-paste safe to reuse here since the pipeline produces
    // runtime-shape exit sels and the projection contract is unchanged).
    const memoMask = new Map();
    const innerByKey = new Map();
    const innerSlotKey = slots[0].key; // any wrapper works for selKey lookup tag

    function dfs(sel) {
        const sk = GraphIO.compactProjectKey(sel, innerDims);
        if (memoMask.has(sk)) return memoMask.get(sk);
        memoMask.set(sk, 0); // cycle guard (modules are acyclic in practice)

        let mask = 0;
        if (Engine.isModuleDone(sel, mod.completionMarker)) {
            // Module just exited — pull the writeDims-projected outer
            // mask, OR'd across every wrapping slot. We MUST project
            // here (not look up by full selKey) because two exits can
            // share an innerDims projection while differing on a
            // pass-through dim that's outside writeDims; the runtime
            // gate's outer key only projects writeDims, so its mask
            // is the OR over all such full sels — and the inner state
            // upstream of those exits inherits that OR. Looking up by
            // full selKey would emit only the specific exit's mask
            // and miss the reach contributed by its writeDims-twins.
            const pk = GraphIO.compactProjectKey(sel, writeDims);
            for (const slot of slots) {
                const cached = outerByKey.get(slot.key + '|o|' + pk);
                if (cached !== undefined) mask |= cached;
            }
        } else {
            const n = GraphIO.findNextInternalNode(mod, sel);
            if (n) {
                for (const edge of n.edges) {
                    if (Engine.isEdgeDisabled(sel, n, edge)) continue;
                    mask |= dfs(_applyEdgeWrites(sel, n, edge));
                }
            }
            // No askable internal AND not done = mid-module dead-end
            // branch (mirrors _dfsModuleOutputs' silent discard).
        }

        memoMask.set(sk, mask);

        // Skip empty branches: they add no info and skipping shrinks
        // the per-outcome files (matches OLD precompute behavior).
        if (mask !== 0) {
            const innerKey = mod.id + '|i|' + sk;
            innerByKey.set(innerKey, (innerByKey.get(innerKey) || 0) | mask);
        }
        return mask;
    }

    for (const startSel of seedByInnerKey.values()) dfs(startSel);

    for (const [key, mask] of innerByKey) {
        distribute(key, mask);
        innerEmitted++;
    }
    modulesProcessed++;
}
console.log(`  ${innerEmitted.toLocaleString()} inner keys across ${modulesProcessed} modules in ${((Date.now() - tInner) / 1000).toFixed(2)}s.`);

// ─── Write per-outcome files ──────────────────────────────────────
const REACH_DIR = path.join(ROOT, 'data', 'reach');
fs.mkdirSync(REACH_DIR, { recursive: true });

console.log('\nWriting per-outcome reach files…');
const tWrite = Date.now();
let totalGz = 0;
let zeroEntries = 0;
for (const entry of meta.outcomeEntries) {
    const set = perOutcomeSets.get(entry.id);
    const arr = [...set].sort();
    const json = JSON.stringify(arr);
    const gz = zlib.gzipSync(Buffer.from(json), { level: 6 });
    const outPath = path.join(REACH_DIR, entry.id + '.json.gz');
    fs.writeFileSync(outPath, gz);
    totalGz += gz.length;
    if (arr.length === 0) zeroEntries++;
    console.log(`  ${entry.id.padEnd(40)} ${arr.length.toString().padStart(7)} keys, ${(gz.length / 1024).toFixed(1)}KB gz`);
}
console.log(`\nDone. ${meta.outcomeEntries.length} files in ${((Date.now() - tWrite) / 1000).toFixed(1)}s.`);
console.log(`  Gzipped total: ${(totalGz / 1024).toFixed(1)}KB.`);
if (zeroEntries > 0) {
    console.warn(`  WARN: ${zeroEntries} entries have empty reach sets — outcome unreachable`);
    process.exitCode = 1;
}
