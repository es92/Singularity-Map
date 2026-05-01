#!/usr/bin/env node
/*
 * Static analysis: every external dim referenced by a module's internal
 * conditions / exit-plan when-clauses must be declared in mod.reads.
 *
 * Why this matters
 * ─────────────────
 * The static-analysis pipeline (cartesianReadRows → cartesianWriteRows →
 * reachableFullSelsFromInputs) buckets a module's upstream sels by their
 * projection on `_readDimsForSlot(slot)`. For module slots that's
 * `mod.reads ∪ module.activateWhen ∪ module.hideWhen ∪ (move-dims of
 * internal-node edges)` — it deliberately does NOT auto-collect the dims
 * referenced by internal-node activateWhen / hideWhen / requires /
 * disabledWhen / effects.when. The convention is that any such dim must
 * be declared by hand in `mod.reads` (or be locally produced inside the
 * module).
 *
 * If a module-internal condition reads an external dim X but X is missing
 * from mod.reads, two upstream sels that differ only on X collapse to
 * the same bucket. cartesianReadRows synthesizes ONE input row per
 * bucket (with X = UNSET) and the inner DFS walks one canonical path —
 * silently producing wrong outputs for the other X-value. Validate
 * aggregates and outcome-reach counts then drift from runtime truth.
 *
 * What this test checks
 * ─────────────────────
 * For every module M:
 *   1. Collect dims referenced by any internal-node activateWhen,
 *      hideWhen, edge.requires, edge.disabledWhen, effects.when, plus
 *      exitPlan tuple `when` clauses.
 *   2. Drop dims that are demonstrably set within M's own DFS:
 *        - internalMarkers
 *        - nodeIds (each is set when its node is answered)
 *        - dims set by an internal node's effects.set / setFlavor
 *   3. Anything left must be in mod.reads. If not, fail.
 *
 * Whitelist
 * ─────────
 * Two intentional exclusions are documented inline. They reference
 * external dims via post-hoc gates that are dead at the module's own
 * DFS time (the upstream slot can never produce that input). Adding
 * them to mod.reads would synthesize phantom inputs and add false
 * outputs.
 *
 * The whitelist's premise — "no upstream FLOW_DAG slot writes this
 * dim" — is verified automatically. If a future graph change adds
 * an upstream writer (or reroutes FLOW_DAG so an existing writer
 * becomes upstream), the test fails with a "broken whitelist entry"
 * error and the entry must be either removed (the dim now varies
 * across upstream sels — declare it in mod.reads) or restructured
 * to restore the topology premise. Stale entries (whitelisted dim no
 * longer referenced by any internal condition) also fail loudly so
 * the rationale list stays honest.
 *
 * Pure structural scan: no propagation, no enumeration, runs in <100ms.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

global.window = {
    location: { search: '', hash: '' },
    requestAnimationFrame: () => 0,
    addEventListener: () => {},
    Graph: require('../graph.js'),
    Engine: require('../engine.js'),
};
global.document = {
    addEventListener: () => {},
    readyState: 'complete',
    getElementById: () => null,
    querySelector: () => null,
};
new Function('window', fs.readFileSync(path.join(ROOT, 'graph-io.js'), 'utf8'))(global.window);
new Function('window', 'document', fs.readFileSync(path.join(ROOT, 'nodes.js'), 'utf8'))(global.window, global.document);

const Engine = global.window.Engine;
const GraphIO = global.window.GraphIO;
const FLOW_DAG = global.window.Nodes.FLOW_DAG;

// ── Whitelist ──────────────────────────────────────────────────────
//
// Each entry maps `${moduleId}:${dim}` → human-readable rationale.
// Keep this list short: every entry is a place where the static
// analysis is intentionally LESS precise than runtime fused-state
// evaluation, and the test is asserting that we accept the imprecision
// because the alternative (declaring the dim in mod.reads) would be
// strictly worse.
const KNOWN_FALSE_POSITIVES = {
    // distribution.open.requires/disabledWhen reference proliferation_set
    // as a post-leak gate — the runtime UI evaluates these clauses against
    // fused state AFTER proliferation has run and back-set distribution
    // ='open'. control runs strictly upstream of proliferation in
    // FLOW_DAG, so during control's own DFS proliferation_set is always
    // UNSET and the proliferation_set='yes' branch of the OR is dead.
    // Adding it to control.reads would synthesize a phantom
    // proliferation_set='yes' input and emit a fake distribution=open
    // output that no upstream sel actually produces.
    'control:proliferation_set':
        'post-leak gate; control runs strictly upstream of proliferation, ' +
        'so proliferation_set is always UNSET at DFS time',

    // containment.contained.requires uses post_catch=contained as an
    // alternate gate (OR with distribution: ['concentrated','monopoly'])
    // for paths where escape has already run and caught the AI. But
    // alignment_loop runs strictly upstream of escape in FLOW_DAG and
    // does not re-enter, so post_catch is always UNSET during
    // alignment_loop's DFS. Empirical: 5 outputs UNSET == 5 outputs
    // post_catch='contained', identical sets.
    'alignment_loop:post_catch':
        'post-escape alternate gate; alignment_loop runs strictly upstream ' +
        'of escape and does not re-enter, so post_catch is always UNSET at DFS time',
};

// ── Condition-dim scanner ──────────────────────────────────────────

function collectCondDims(conds, out) {
    if (!conds) return;
    const arr = Array.isArray(conds) ? conds : [conds];
    for (const c of arr) {
        if (!c || typeof c !== 'object') continue;
        for (const k of Object.keys(c)) {
            if (k === 'reason' || (k.startsWith('_') && k !== '_not')) continue;
            if (k === '_not') continue;
            out.add(k);
        }
        if (Array.isArray(c._not)) {
            for (const conj of c._not) {
                if (!conj || typeof conj !== 'object') continue;
                for (const k of Object.keys(conj)) out.add(k);
            }
        } else if (c._not && typeof c._not === 'object') {
            for (const k of Object.keys(c._not)) out.add(k);
        }
    }
}

// ── Per-module audit ───────────────────────────────────────────────

const violations = [];
const acceptedWhitelist = [];

for (const mod of Engine.MODULES) {
    const declaredReads = new Set(mod.reads || []);
    const ownNodeIds = new Set(mod.nodeIds || []);
    const internalMarkers = new Set(mod.internalMarkers || []);
    // The module's own completionMarker. Exit-plan `when` clauses
    // legitimately gate on it as an idempotency guard
    // ("only fire this tuple if proliferation_set isn't yet 'yes'").
    // Pre-entry it's UNSET (the module's gate enforces that), and
    // once any exit tuple's `set` writes it to 'yes' the runtime
    // engine treats the module as done — no further exit tuples
    // fire on the same pass. So the dim is module-internal even
    // though it's also published as a write.
    if (typeof mod.completionMarker === 'string') {
        internalMarkers.add(mod.completionMarker);
    } else if (mod.completionMarker && mod.completionMarker.dim) {
        internalMarkers.add(mod.completionMarker.dim);
    }

    // Dims set by internal-node edges' effects.set / setFlavor —
    // these are local writes that downstream-priority internal nodes
    // can read without needing the dim in mod.reads.
    const internallyWritten = new Set();
    for (const nid of mod.nodeIds || []) {
        const n = Engine.NODE_MAP[nid];
        if (!n) continue;
        for (const e of n.edges || []) {
            if (!e.effects) continue;
            const blocks = Array.isArray(e.effects) ? e.effects : [e.effects];
            for (const b of blocks) {
                if (!b) continue;
                if (b.set) for (const k of Object.keys(b.set)) internallyWritten.add(k);
                if (b.setFlavor) for (const k of Object.keys(b.setFlavor)) internallyWritten.add(k);
            }
        }
    }

    // Collect all external-dim references.
    const refs = new Map(); // dim → Set<source descriptor>
    const addRef = (dim, where) => {
        if (!refs.has(dim)) refs.set(dim, new Set());
        refs.get(dim).add(where);
    };

    for (const nid of mod.nodeIds || []) {
        const n = Engine.NODE_MAP[nid];
        if (!n) continue;
        const dims = new Set();
        collectCondDims(n.activateWhen, dims);
        collectCondDims(n.hideWhen, dims);
        for (const e of n.edges || []) {
            collectCondDims(e.requires, dims);
            collectCondDims(e.disabledWhen, dims);
            if (!e.effects) continue;
            const blocks = Array.isArray(e.effects) ? e.effects : [e.effects];
            for (const b of blocks) {
                if (!b) continue;
                if (b.when) collectCondDims([b.when], dims);
            }
        }
        for (const d of dims) {
            if (ownNodeIds.has(d)) continue;
            if (internalMarkers.has(d)) continue;
            if (internallyWritten.has(d)) continue;
            addRef(d, `node:${nid}`);
        }
    }

    // Exit-plan `when` clauses are evaluated against sel BEFORE the
    // tuple's own effects fire (attachModuleReducer installs each
    // tuple as an effects block on its triggering edge; the block's
    // `when` gates the block, but `set`/`setFlavor` haven't run yet).
    //
    // The `internallyWritten` exemption (used for node-level
    // conditions, where it's plausible that an upstream-priority
    // node already set the dim) is UNSAFE here: a dim that's written
    // ONLY by some unrelated escape edge (e.g. collateral_survivors
    // setting war_survivors) is NOT set yet at the time an
    // ai_goals exit tuple's `when: war_survivors=none` is checked.
    // Without this tightening the test rubber-stamps reads that the
    // static analyzer can't fulfill from canonical inputs.
    //
    // ownNodeIds and internalMarkers stay exempt: nodeIds are
    // edge-stamped at the moment the user picks the edge (so any
    // already-picked node's dim is in sel), and internalMarkers
    // by convention are set early by some edge to drive downstream
    // askability — they're set before exit. If those exemptions
    // ever produce false negatives, tighten them per-case via the
    // KNOWN_FALSE_POSITIVES whitelist.
    if (Array.isArray(mod.exitPlan)) {
        for (const t of mod.exitPlan) {
            if (!t.when) continue;
            const dims = new Set();
            collectCondDims(t.when, dims);
            for (const d of dims) {
                if (ownNodeIds.has(d)) continue;
                if (internalMarkers.has(d)) continue;
                addRef(d, 'exitPlan.when');
            }
        }
    }

    for (const [dim, sources] of refs) {
        if (declaredReads.has(dim)) continue;
        const whitelistKey = `${mod.id}:${dim}`;
        if (KNOWN_FALSE_POSITIVES[whitelistKey]) {
            acceptedWhitelist.push({
                module: mod.id, dim,
                sources: [...sources].sort(),
                rationale: KNOWN_FALSE_POSITIVES[whitelistKey],
            });
            continue;
        }
        violations.push({ module: mod.id, dim, sources: [...sources].sort() });
    }
}

// ── Whitelist topology verification ────────────────────────────────
//
// Each whitelist entry's premise is: no upstream FLOW_DAG slot writes
// this dim, so its value at the whitelisted module's DFS time is fixed
// (always UNSET in practice) and bucket-projection collapse is safe.
// If a future graph change adds an upstream writer (or moves an existing
// writer above the whitelisted module), the premise breaks and the
// entry becomes a real missing-read bug. Catch that here.
//
// Build ancestor closures over FLOW_DAG, then for each whitelist entry
// check that no slot writing the dim is an ancestor (or sibling-equal)
// of any slot for the whitelisted module.

const SLOTS = FLOW_DAG.nodes.filter(n => n && n.key);
const parentsOf = new Map();
for (const s of SLOTS) parentsOf.set(s.key, []);
for (const [p, c] of FLOW_DAG.edges) {
    if (parentsOf.has(c)) parentsOf.get(c).push(p);
}
const ancestorClosure = new Map();
function ancestorsOf(k, stack = new Set()) {
    if (ancestorClosure.has(k)) return ancestorClosure.get(k);
    if (stack.has(k)) return new Set();
    stack.add(k);
    const out = new Set();
    for (const p of parentsOf.get(k) || []) {
        out.add(p);
        for (const a of ancestorsOf(p, stack)) out.add(a);
    }
    stack.delete(k);
    ancestorClosure.set(k, out);
    return out;
}
for (const s of SLOTS) ancestorsOf(s.key);

// Slot keys per module id.
const slotsByModuleId = new Map();
for (const s of SLOTS) {
    if (s.kind !== 'module') continue;
    if (!slotsByModuleId.has(s.id)) slotsByModuleId.set(s.id, []);
    slotsByModuleId.get(s.id).push(s.key);
}

// Slots that write a given dim (delegate to GraphIO so we mirror the
// same write-discovery the static analyzer uses).
const writersByDim = new Map();
for (const s of SLOTS) {
    const writes = GraphIO.writeDimsForSlot(s) || [];
    for (const d of writes) {
        if (!writersByDim.has(d)) writersByDim.set(d, []);
        writersByDim.get(d).push(s.key);
    }
}

const brokenWhitelist = [];
const staleWhitelist = [];
const acceptedKeys = new Set(acceptedWhitelist.map(w => `${w.module}:${w.dim}`));
for (const [key, rationale] of Object.entries(KNOWN_FALSE_POSITIVES)) {
    if (!acceptedKeys.has(key)) {
        // Whitelist entry exists but no module-internal condition
        // references this dim — entry is stale.
        staleWhitelist.push({ key, rationale });
        continue;
    }
    const [modId, dim] = key.split(':');
    const moduleSlots = slotsByModuleId.get(modId) || [];
    const writerSlots = writersByDim.get(dim) || [];
    const upstreamWriters = [];
    for (const ms of moduleSlots) {
        const ancs = ancestorClosure.get(ms) || new Set();
        for (const ws of writerSlots) {
            // The module writing its own dim doesn't count (that's
            // covered by the internally-written exclusion). Only
            // ancestors are a topology violation.
            if (ancs.has(ws)) upstreamWriters.push({ moduleSlot: ms, writerSlot: ws });
        }
    }
    if (upstreamWriters.length) {
        brokenWhitelist.push({ key, rationale, upstreamWriters });
    }
}

// ── Report ─────────────────────────────────────────────────────────

console.log('module reads completeness audit');
console.log('  modules scanned: ' + Engine.MODULES.length);
console.log('  whitelisted false positives: ' + acceptedWhitelist.length);
for (const w of acceptedWhitelist) {
    console.log(`    ${w.module}:${w.dim}  (${w.sources.join(', ')})`);
    console.log(`      ${w.rationale}`);
}
console.log('');

const failed = violations.length || brokenWhitelist.length || staleWhitelist.length;

if (!failed) {
    console.log('module reads complete: PASS');
    process.exit(0);
}

console.error('module reads complete: FAIL');
console.error('');

if (violations.length) {
    console.error(`  ${violations.length} missing-read violation(s):`);
    console.error('  Internal conditions reference an external dim that is NOT');
    console.error('  declared in mod.reads, NOT an internalMarker, NOT a nodeId,');
    console.error('  and NOT set by an internal effect. The static analysis');
    console.error('  bucket projection will collapse upstream sels that differ');
    console.error('  only on this dim, producing wrong DFS outputs whenever the');
    console.error('  dim gates an internal node.');
    console.error('');
    for (const v of violations) {
        console.error(`    ${v.module}:`);
        console.error(`      missing read: ${v.dim}`);
        console.error(`      referenced by: ${v.sources.join(', ')}`);
        console.error('      fix: add to mod.reads, OR document as a known false');
        console.error('           positive in tests/module_reads_complete.js if');
        console.error('           the dim genuinely cannot occur at this');
        console.error('           module\'s DFS time.');
        console.error('');
    }
}

if (brokenWhitelist.length) {
    console.error(`  ${brokenWhitelist.length} broken whitelist entr(ies):`);
    console.error('  A whitelist entry asserts that no upstream FLOW_DAG slot');
    console.error('  writes the dim (so its value at the whitelisted module\'s');
    console.error('  DFS time is fixed and bucket-projection collapse is safe).');
    console.error('  But FLOW_DAG now has an upstream writer — the topology');
    console.error('  premise is broken and this is now a real missing-read bug.');
    console.error('');
    for (const b of brokenWhitelist) {
        console.error(`    ${b.key}:`);
        console.error(`      rationale (no longer holds): ${b.rationale}`);
        for (const uw of b.upstreamWriters) {
            console.error(`      upstream writer: ${uw.writerSlot} → (ancestor of) ${uw.moduleSlot}`);
        }
        console.error('      fix: either add the dim to mod.reads (it now varies');
        console.error('           across upstream sels), or remove the upstream');
        console.error('           writer / restructure FLOW_DAG so the premise');
        console.error('           holds again.');
        console.error('');
    }
}

if (staleWhitelist.length) {
    console.error(`  ${staleWhitelist.length} stale whitelist entr(ies):`);
    console.error('  Whitelist entry exists but no module-internal condition');
    console.error('  references this dim. The condition was probably removed');
    console.error('  and the whitelist entry should be deleted to keep the');
    console.error('  rationale list honest.');
    console.error('');
    for (const s of staleWhitelist) {
        console.error(`    ${s.key}: remove from KNOWN_FALSE_POSITIVES`);
    }
    console.error('');
}

process.exit(1);
