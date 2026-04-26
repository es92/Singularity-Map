#!/usr/bin/env node
'use strict';

// precompute-reachability.js — Per-outcome reach sets, keyed by
// (slot, projection) pairs instead of full sels.
//
// Two passes:
//
//   1. OUTER  — FlowPropagation-style topo walk over FLOW_DAG, with
//               masks aggregated per `<slotKey>|o|<projKey>`, where
//               projKey is the pipe-delimited compact projection of
//               the post-edge sel onto the slot's writeDims. Runtime
//               computes the same key from the post-click childSel.
//
//   2. INNER  — per-module DFS visiting every partial internal state.
//               Each visited state contributes a mask under
//               `<moduleId>|i|<projKey>` where projKey covers (module
//               reads ∪ module nodeIds) — captures the input bucket
//               that drove the DFS plus whichever internals have
//               been answered so far. Mask at a state = OR over
//               (terminal exits reachable from it) of the OUTER mask
//               for the corresponding `<slot>|o|<exitProj>`.
//
// Key encoding: `<slot|moduleId>|<i|o>|<v1>|<v2>|...` where values
// are joined with '|' in the dim list's sorted order, empty between
// pipes for unset dims. ~20× smaller than the JSON-array form the
// earlier revision used; produces files that fit GitHub Pages
// without per-outcome multi-hundred-MB raw blobs.
//
// Together these cover every state the runtime gate can land on:
// non-module clicks and module-exit clicks land on outer keys,
// mid-module clicks land on inner keys.
//
// Run: `npm run precompute-reach` (~8 min on a fast laptop, mostly
// in pass 1's `rollout` slot which fans out to ~200k inputs). Bumps
// node's heap limit because the topo pass holds ~4.5M output sels
// in flight. Pre-launch flags: invoke as
//   `node --max-old-space-size=8192 precompute-reachability.js`
// or rely on the wrapper script in `package.json` which sets it.

const fs = require('fs');
const path = require('path');
const { createGzip } = require('zlib');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');

// ─── Browser shim setup (same pattern as validate.js) ─────────────
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
const FlowPropagation = global.window.FlowPropagation;
const FLOW_DAG = global.window.Nodes.FLOW_DAG;
const NODES = Engine.NODES;
const NODE_MAP = Engine.NODE_MAP;
const MODULES = Engine.MODULES;
const MODULE_MAP = Engine.MODULE_MAP;

const outcomesData = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/outcomes.json'), 'utf8'));
const TEMPLATES = outcomesData.templates;
GraphIO.registerOutcomes(TEMPLATES);

// ─── Outcome entries (variant-aware) ──────────────────────────────
const entries = [];
for (const t of TEMPLATES) {
    const variantKeys = (t.variants && typeof t.variants === 'object')
        ? Object.keys(t.variants) : [];
    if (variantKeys.length > 0 && t.primaryDimension) {
        for (const vk of variantKeys) {
            entries.push({
                id: t.id + '--' + vk,
                templateId: t.id,
                primaryDim: t.primaryDimension,
                variantKey: vk,
            });
        }
    } else {
        entries.push({ id: t.id, templateId: t.id });
    }
}
if (entries.length > 31) {
    throw new Error(entries.length + ' entries exceeds 31-bit mask limit');
}

const entryByTemplate = new Map();
for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    e.bit = 1 << i;
    if (!entryByTemplate.has(e.templateId)) entryByTemplate.set(e.templateId, []);
    entryByTemplate.get(e.templateId).push(e);
}

function siphonBitsFor(sel) {
    const hits = GraphIO.matchOutcomes(sel);
    if (!hits.length) return { bits: 0, terminal: false };
    let bits = 0;
    for (const oid of hits) {
        const es = entryByTemplate.get(oid);
        if (!es) continue;
        for (const e of es) {
            if (!e.primaryDim) { bits |= e.bit; continue; }
            // primaryDim can be a derived dim (e.g. `ruin_type` is
            // not a sel value but resolves from `post_catch` /
            // `conflict_result` via deriveWhen). Match on
            // `resolvedVal` so derived variants attribute to the
            // right bit. Falls back to sel[…] when there's no
            // derive table.
            const v = Engine.resolvedVal(sel, e.primaryDim);
            if (v === e.variantKey) bits |= e.bit;
        }
    }
    // terminal=true even when the variant filter zeros every bit:
    // the runtime still siphons at this outcome card and stops the
    // walk, so the static analysis must too.
    return { bits, terminal: true };
}

// ─── Module ownership index ───────────────────────────────────────
// Map each internal node id to the module that owns it. Lets the
// inner pass know which module a node belongs to without scanning
// MODULES every lookup.
const MODULE_OF_NODE = new Map();
for (const m of MODULES) {
    for (const nid of (m.nodeIds || [])) MODULE_OF_NODE.set(nid, m);
}

// ─── Topological order over FLOW_DAG ──────────────────────────────
// Same shape as flow-propagation.js's _buildTopo, inlined so we can
// hook the per-input observation we need without duplicating the
// bulk pass.
const propagateTargets = new Set();
for (const node of FLOW_DAG.nodes) {
    if (!node || !node.key) continue;
    if (node.key === 'emergence') continue;
    if (node.kind === 'outcome' || node.kind === 'deadend') continue;
    propagateTargets.add(node.key);
}

const parentsOf = new Map();
const childrenOf = new Map();
for (const e of FLOW_DAG.edges) {
    const [p, c, kind] = e;
    if (kind === 'placement-outcome' || kind === 'placement-deadend') continue;
    if (kind === 'outcome-link') continue;
    if (String(c).startsWith('outcome:') || c === 'deadend') continue;
    if (!propagateTargets.has(c)) continue;
    if (!parentsOf.has(c)) parentsOf.set(c, []);
    parentsOf.get(c).push(p);
    if (!childrenOf.has(p)) childrenOf.set(p, []);
    childrenOf.get(p).push(c);
}

const allKeys = new Set([...propagateTargets, 'emergence']);
const inDeg = new Map();
for (const k of allKeys) inDeg.set(k, 0);
for (const [c, ps] of parentsOf) {
    inDeg.set(c, ps.filter(p => allKeys.has(p)).length);
}
const order = [];
{
    const queue = ['emergence'];
    while (queue.length) {
        const k = queue.shift();
        order.push(k);
        for (const c of (childrenOf.get(k) || [])) {
            if (!allKeys.has(c)) continue;
            inDeg.set(c, inDeg.get(c) - 1);
            if (inDeg.get(c) === 0) queue.push(c);
        }
    }
}

// ─── Pass 1 — outer (slot-graph) reach ────────────────────────────
//
// Forward: for each slot in topo order, dedup inputs by selKey, then
// run reachableFullSelsFromInputs per-input so we keep the
// (input → outputs) mapping. Each output sel records its
// `<slotKey>|out:<projKey>` provenance immediately; we OR that
// provenance back into a slot-keyed reach map after the backward
// pass.
//
// Backward: reverse topo, mask[selKey]_input = OR over outputs of
// mask[selKey]_output; mask[selKey]_output = siphon bits | mask of
// the same selKey treated as input at its routed-to child. Each
// slot's input sels get dropped after their backward step so the
// 4.5M sel ↦ mask map peaks once and decays during the sweep.

const UNSET = GraphIO.UNSET;
const rowToSel = (row) => {
    const sel = {};
    for (const k of Object.keys(row)) if (row[k] !== UNSET) sel[k] = row[k];
    return sel;
};

const emergenceSlot = FLOW_DAG.nodes.find(n => n.key === 'emergence');
const eW = GraphIO.cartesianWriteRows(emergenceSlot);
const emergenceOutputs = eW.rows.map(rowToSel);

const slotInputs   = new Map(); // slotKey   → Map<inputSelKey, sel>
const inputToOuts  = new Map(); // slotKey   → Map<inputSelKey, Set<outputSelKey>>
const outSiphon    = new Map(); // selKey    → bitmask
const outRouted    = new Map(); // selKey    → childSlotKey
const outProv      = new Map(); // selKey    → string ("<slotKey>|o|<projKey>")
const inputsBySlot = new Map(); // slotKey   → sel[]   (accumulated by parents)

console.log(`Pass 1 (outer): forward over ${order.length} slots…`);
const t0 = Date.now();

for (let oi = 0; oi < order.length; oi++) {
    const slotKey = order[oi];
    const slot = FLOW_DAG.nodes.find(n => n.key === slotKey);
    if (!slot) continue;

    const incomingSels = (slotKey === 'emergence')
        ? emergenceOutputs
        : (inputsBySlot.get(slotKey) || []);

    const inputMap = new Map();
    for (const sel of incomingSels) {
        const k = GraphIO.selKey(sel);
        if (!inputMap.has(k)) inputMap.set(k, sel);
    }
    slotInputs.set(slotKey, inputMap);
    // Drop the parent-accumulated array — we have the deduped map
    // now; the array's entries are pinning sel objects that we
    // can let GC reclaim once they fall out of inputMap (only
    // distinct sels survive).
    inputsBySlot.delete(slotKey);

    if (inputMap.size === 0) continue;
    if (slot.kind === 'outcome' || slot.kind === 'deadend') continue;

    const writeDims  = GraphIO.writeDimsForSlot(slot);

    const childKeys  = childrenOf.get(slotKey) || [];
    const childSlots = childKeys
        .map(k => FLOW_DAG.nodes.find(n => n.key === k))
        .filter(Boolean);

    const outsByInput = new Map();
    inputToOuts.set(slotKey, outsByInput);

    let processed = 0;
    for (const [inputKey, inputSel] of inputMap) {
        processed++;
        const r = GraphIO.reachableFullSelsFromInputs(slot, [inputSel]);
        const outsForInput = new Set();
        outsByInput.set(inputKey, outsForInput);

        for (const o of (r.outputs || [])) {
            const ok = GraphIO.selKey(o);
            outsForInput.add(ok);

            // Provenance for this output. Each `(slotKey, projKey)`
            // is the canonical "post-edge state at slot S" the
            // runtime gate will compute on click. The same selKey
            // can be produced at multiple slots; we keep only the
            // first observed provenance because the mask we'll
            // attach is a function of the sel alone (routing is
            // deterministic from sel), so two parents producing the
            // same selKey contribute identical masks under their
            // own `<slotKey>|out:<projKey>` keys.
            if (!outProv.has(ok)) {
                const pk = GraphIO.compactProjectKey(o, writeDims);
                outProv.set(ok, slotKey + '|o|' + pk);
            }

            if (outSiphon.has(ok) || outRouted.has(ok)) continue;

            const { bits, terminal } = siphonBitsFor(o);
            if (terminal) {
                outSiphon.set(ok, bits);
                continue;
            }

            let bestChild = null;
            let bestPri = Infinity;
            for (const child of childSlots) {
                const p = FlowPropagation.slotPickPriority(child, o);
                if (p < bestPri) { bestPri = p; bestChild = child; }
            }
            if (bestChild) {
                outRouted.set(ok, bestChild.key);
                let arr = inputsBySlot.get(bestChild.key);
                if (!arr) { arr = []; inputsBySlot.set(bestChild.key, arr); }
                arr.push(o);
            }
            // No bestChild → dead-end output. Tracked by absence
            // from both `outSiphon` and `outRouted`.
        }
    }

    const seconds = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`  ${slotKey}: ${processed} inputs (cumulative ${seconds}s)`);
}

console.log(`  forward done in ${((Date.now() - t0) / 1000).toFixed(1)}s.`);
console.log(`  distinct output sels: ${outProv.size}`);

// Backward sweep — same shape as the previous version, but we drop
// each slot's inputMap as soon as its mask is computed so the peak
// holds at most one slot's worth of sel→mask pairs, not all 4.5M.
console.log('Pass 1 (outer): backward sweep…');
const t1 = Date.now();
const inputMask = new Map(); // selKey → mask, sel-as-input-at-its-slot

// outerReach: `<slotKey>|out:<projKey>` → mask. Aggregated as we go
// so we never need to keep per-selKey OUTPUT masks alive after a
// slot's backward step finishes.
const outerReach = new Map();

for (let oi = order.length - 1; oi >= 0; oi--) {
    const slotKey = order[oi];
    const outsByInput = inputToOuts.get(slotKey);
    if (!outsByInput) continue;
    const inputMap = slotInputs.get(slotKey);
    if (!inputMap) continue;

    for (const [inputKey, _sel] of inputMap) {
        const outs = outsByInput.get(inputKey);
        let m = 0;
        if (outs) {
            for (const ok of outs) {
                const sb = outSiphon.has(ok) ? outSiphon.get(ok) : 0;
                const rt = outRouted.get(ok); // undefined if siphoned/dead
                const childMask = rt ? (inputMask.get(ok) || 0) : 0;
                const om = sb | childMask;
                const prov = outProv.get(ok);
                if (prov) outerReach.set(prov, (outerReach.get(prov) || 0) | om);
                m |= om;
            }
        }
        inputMask.set(inputKey, (inputMask.get(inputKey) || 0) | m);
    }

    // Slot done — drop its input map and per-input output sets.
    slotInputs.delete(slotKey);
    inputToOuts.delete(slotKey);
}

console.log(`  backward done in ${((Date.now() - t1) / 1000).toFixed(1)}s.`);
console.log(`  outer keys: ${outerReach.size}`);

// Free the largest residual maps before we run the inner pass.
outProv.clear();
outSiphon.clear();
outRouted.clear();
inputMask.clear();

// ─── Pass 2 — inner (per-module) reach ────────────────────────────
//
// For every module M and every input bucket the outer pass touched
// M with, walk the internal-node DFS the engine would walk at run
// time. Each visited partial state is keyed
// `<M.key>|in:<projection-onto-(M.reads ∪ M.nodeIds)>` and gets a
// mask = OR over (terminal exits reachable from this state) of the
// outer mask at the corresponding `<M.key>|out:<exitProj>`.
//
// We seed the DFS from cartesianReadRows(M) (every cart-prod input
// row that passes M's entry filter), so we naturally visit every
// bucket without having to round-trip through the outer pass's
// per-bucket sel reps.
//
// The ordering inside the DFS mirrors `_dfsModuleOutputs` /
// `engine.findNextQ`: pick the highest-priority askable internal
// node, branch on every enabled edge, applyEdgeWrites, recurse. At
// the root of each branch we record the partial state's reach
// before recursing so the recorded mask reflects both the eventual
// terminal exits and any intermediate siphons.

const innerReach = new Map();

console.log('Pass 2 (inner): per-module DFS…');
const t2 = Date.now();

function _isAskableInternal(n, sel) {
    if (!n || n.derived) return false;
    if (sel[n.id] !== undefined) return false;
    if (n.activateWhen && n.activateWhen.length
        && !n.activateWhen.some(c => Engine.matchCondition(sel, c))) return false;
    if (n.hideWhen && n.hideWhen.length
        && n.hideWhen.some(c => Engine.matchCondition(sel, c))) return false;
    return true;
}

function _findNextInternal(mod, sel) {
    let best = null;
    let bestPri = -Infinity;
    for (const nid of (mod.nodeIds || [])) {
        const n = NODE_MAP[nid];
        if (!n) continue;
        if (!_isAskableInternal(n, sel)) continue;
        if (!n.edges || !n.edges.some(e => !Engine.isEdgeDisabled(sel, n, e))) continue;
        const pri = n.priority == null ? 0 : n.priority;
        if (pri > bestPri) { best = n; bestPri = pri; }
    }
    return best;
}

// Shared completion-marker check (engine.js); returns true iff the
// module's marker dim has a value AND that value is in the marker's
// allowed-values list. The runtime gate in index.html uses the same
// helper, so the precompute's outer-vs-inner split mirrors the live
// UI's outer-vs-inner key choice.
const _isModuleDone = (mod, sel) => Engine.isModuleDone(sel, mod.completionMarker);

// applyEdgeWrites mirroring graph-io._applyEdgeWrites — single-pass
// collapseToFlavor application, no cleanSelection cascade. The
// 178k-push divergence probe (see engine.cleanSelection comment)
// proved this is equivalent on every runtime-reachable state.
function _applyEdgeWrites(sel, node, edge) {
    const next = { ...sel, [node.id]: edge.id };
    if (!edge.collapseToFlavor) return next;
    const blocks = Array.isArray(edge.collapseToFlavor) ? edge.collapseToFlavor : [edge.collapseToFlavor];
    for (const b of blocks) {
        if (!b) continue;
        if (b.when && !Engine.matchCondition(next, b.when)) continue;
        if (b.set) for (const [k, v] of Object.entries(b.set)) next[k] = v;
        if (Array.isArray(b.move)) for (const k of b.move) delete next[k];
    }
    return next;
}

for (const mod of MODULES) {
    // FLOW_DAG slot.key is NOT the same as mod.id. Most modules are
    // 1:1 (slot.key='decel', id='decel'), but some have a single slot
    // under a different name (alignment_loop → 'alignment',
    // intent_loop → 'intent', war_loop → 'war', early_rollout →
    // 'rollout_early') and `escape` appears as FIVE slots
    // (escape_early/_alt/_late/_re_entry/_after_who). Each slot's
    // outer reach is keyed by its own slot.key during pass 1.
    //
    // For the inner DFS, the module's reads/writes/nodeIds are
    // shared across all its slots (they all wrap the same mod
    // object), so a single DFS pass covers them. But the exit-state
    // reach lookup must OR across every slot's outer reach, since
    // once we're mid-DFS the runtime can't know which FLOW_DAG slot
    // routed us in. The OR is sound (no slot can produce reach the
    // others don't) and conservative (multi-slot modules may light
    // up an option whose downstream only reaches via a different
    // entry — fine for the gate; under-greying beats over-greying).
    const slots = FLOW_DAG.nodes.filter(n =>
        n && n.kind === 'module' && n.id === mod.id);
    if (!slots.length) continue;
    const slot = slots[0];

    const innerDims = [...new Set([
        ...GraphIO.readDimsForSlot(slot),
        ...(mod.nodeIds || []),
    ])].sort();
    const writeDims = GraphIO.writeDimsForSlot(slot);

    const inputRows = GraphIO.cartesianReadRows(slot);
    if (!inputRows || !inputRows.rows.length) continue;

    let visited = 0;
    let withMask = 0;
    const memoMask = new Map(); // selKey → mask, scoped to this module

    function dfs(sel) {
        const sk = GraphIO.selKey(sel);
        if (memoMask.has(sk)) return memoMask.get(sk);

        let mask = 0;

        // Module just exited — look up the exit's outer mask. The
        // exit projection IS the same projKey
        // cartesianWriteRows.byInput uses, so the lookup hits.
        // OR over every FLOW_DAG slot for this module — see the
        // multi-slot comment at the top of the loop.
        if (_isModuleDone(mod, sel)) {
            const pk = GraphIO.compactProjectKey(sel, writeDims);
            for (const s of slots) {
                mask |= outerReach.get(s.key + '|o|' + pk) || 0;
            }
        } else {
            const n = _findNextInternal(mod, sel);
            if (n) {
                for (const edge of n.edges) {
                    if (Engine.isEdgeDisabled(sel, n, edge)) continue;
                    mask |= dfs(_applyEdgeWrites(sel, n, edge));
                }
            }
            // No askable internal AND not done = dead-end branch
            // (mirrors _dfsModuleOutputs' silent discard).
        }

        memoMask.set(sk, mask);

        // Inner provenance for this state. Skip if the whole branch
        // is dead — empty masks add no info, and skipping shrinks
        // the reach files.
        if (mask !== 0) {
            const inProj = GraphIO.compactProjectKey(sel, innerDims);
            const innerKey = mod.id + '|i|' + inProj;
            innerReach.set(innerKey, (innerReach.get(innerKey) || 0) | mask);
            withMask++;
        }
        visited++;
        return mask;
    }

    for (const row of inputRows.rows) {
        const startSel = rowToSel(row);
        dfs(startSel);
    }

    console.log(`  ${mod.id}: visited ${visited} states, ${withMask} non-empty`);
}

console.log(`  inner done in ${((Date.now() - t2) / 1000).toFixed(1)}s.`);
console.log(`  inner keys: ${innerReach.size}`);

// ─── Emit per-outcome reach files (gzip only) ─────────────────────
//
// Only `.json.gz` is emitted. The browser fetches the gzip and
// decompresses with DecompressionStream; shipping raw `.json` made
// `data/reach` 100× larger on disk and in git for no UX gain.
//
// Memory discipline: we sort one shared [key, mask] array across
// all outcomes and stream-filter it per outcome straight into a
// gzip pipeline (no intermediate raw file, no in-flight outcome
// arrays). Peak working set after the DFS phases is bounded by
// the sorted array's size.
const outDir = path.join(ROOT, 'data', 'reach');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

console.log(`\nFlattening reach maps for streaming write…`);
const tFlat = Date.now();
const allEntries = new Array(outerReach.size + innerReach.size);
let idx = 0;
for (const [k, m] of outerReach) allEntries[idx++] = [k, m];
for (const [k, m] of innerReach) allEntries[idx++] = [k, m];
// Free the source maps — we have everything we need in allEntries
// now, and the next phase is the largest concurrent allocation.
outerReach.clear();
innerReach.clear();
allEntries.sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
console.log(`  ${allEntries.length} total entries sorted in ${((Date.now() - tFlat) / 1000).toFixed(1)}s.`);

console.log(`\nWriting ${entries.length} files…`);

let totalGz  = 0;
let totalKeys = 0;

async function writeReachFile(entry) {
    const gzPath = path.join(outDir, entry.id + '.json.gz');
    const bit = entry.bit;

    // Stream JSON array shape: '[' + key1 + ',' + key2 + ... + ']'.
    // Feed straight into gzip — no raw `.json` ever materialized.
    function* jsonChunks() {
        yield '[';
        let first = true;
        let count = 0;
        for (let i = 0; i < allEntries.length; i++) {
            const e = allEntries[i];
            if (!(e[1] & bit)) continue;
            if (!first) yield ',';
            yield JSON.stringify(e[0]);
            first = false;
            count++;
        }
        yield ']';
        writeReachFile._lastCount = count;
    }

    // Readable.from(generator) defaults to objectMode:true, which
    // gzip refuses (it wants bytes). Force a byte stream by passing
    // { objectMode: false } so each yielded string is emitted as
    // a Buffer chunk on the wire.
    await pipeline(
        Readable.from(jsonChunks(), { objectMode: false }),
        createGzip({ level: 9 }),
        fs.createWriteStream(gzPath)
    );
    const gzSize = fs.statSync(gzPath).size;
    return { gzSize, count: writeReachFile._lastCount };
}

(async () => {
    let zero = 0;
    for (const entry of entries) {
        const { gzSize, count } = await writeReachFile(entry);
        totalGz += gzSize;
        totalKeys += count;
        if (count === 0) zero++;
        console.log(`  ${entry.id}: ${count} keys, ${(gzSize / 1024).toFixed(1)}KB gz`);
    }
    console.log(`\nDone. ${entries.length} files written.`);
    console.log(`  Gzipped total: ${(totalGz / 1024).toFixed(1)}KB across ${totalKeys} key emissions.`);
    if (zero > 0) {
        console.warn(`  WARN: ${zero} entries have empty reach sets — outcome unreachable`);
        process.exitCode = 1;
    }
})().catch(err => {
    console.error('precompute write failed:', err);
    process.exit(1);
});
