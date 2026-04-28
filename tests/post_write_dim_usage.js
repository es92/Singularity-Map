/*
 * Static analysis: post-last-write usage of state dims.
 *
 * State dim = a dim DURABLY present in `sel` after some FLOW_DAG slot
 * exits. Concretely:
 *
 *   For module slots: `m.writes` ∪ `completionMarker` ∪ any
 *   `exitPlan[].set` key K such that K ∉ `(nodeIds \ writes) ∪
 *   internalMarkers`. The excluded set is exactly what
 *   `attachModuleReducer` moves to flavor at exit, so writes to
 *   those keys aren't durable. Cross-module shared dims (e.g.
 *   `war_set` set in ESCAPE's exit plan) survive — they're not in
 *   ESCAPE's nodeIds and aren't internal markers, so they stay in
 *   sel.
 *
 *   For node slots (top-level nodes in FLOW_DAG): the answer dim
 *   (= node.id) and any `effects.set` keys — neither is
 *   subject to module-exit eviction.
 *
 *   1. Find the topologically latest FLOW_DAG slot S that writes D.
 *   2. Walk the forward-reachable descendants of S (slots strictly
 *      downstream).
 *   3. Tally every "graph-impacting" mention of D across those
 *      descendants:
 *        - module.activateWhen / hideWhen
 *        - module.reads
 *        - module.exitPlan[].when
 *        - node.activateWhen / hideWhen
 *        - node.edges[].requires / disabledWhen
 *        - node.edges[].effects.when
 *        - node.edges[].effects.set / setFlavor (writes)
 *        - module.writes / completionMarker (writes)
 *   4. Plus mentions in outcome.reachable clauses for outcomes
 *      attached (via slot.earlyExits) to any descendant slot.
 *
 * Output: one row per dim, sorted by total post-write mentions desc.
 *
 * No propagation, no enumeration — pure structural scan of FLOW_DAG +
 * MODULE_MAP + NODE_MAP + outcomes.json. Runs in <100ms.
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
const FLOW_DAG = global.window.Nodes.FLOW_DAG;
const NODE_MAP = Engine.NODE_MAP;
const MODULE_MAP = Engine.MODULE_MAP;

const TEMPLATES = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/outcomes.json'), 'utf8')).templates;

// ── Helpers for scanning condition objects ─────────────────────────

// Generic "given a list (or single) cond object(s), return the dims
// referenced by it". Recognises `_not` (array of conjunctions or single
// conjunction) and skips meta keys like `reason` / `_xxx`.
function condDims(conds) {
    const out = new Set();
    if (!conds) return out;
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
    return out;
}

// Same as condDims but counts each occurrence (a dim referenced in two
// different conjunctions counts twice). Used so "mentions" reflects
// the number of distinct gate clauses that read the dim, not just
// "is it referenced anywhere".
function condDimsCounts(conds) {
    const out = new Map();
    if (!conds) return out;
    const arr = Array.isArray(conds) ? conds : [conds];
    const bump = (d) => out.set(d, (out.get(d) || 0) + 1);
    for (const c of arr) {
        if (!c || typeof c !== 'object') continue;
        for (const k of Object.keys(c)) {
            if (k === 'reason' || (k.startsWith('_') && k !== '_not')) continue;
            if (k === '_not') continue;
            bump(k);
        }
        if (Array.isArray(c._not)) {
            for (const conj of c._not) {
                if (!conj || typeof conj !== 'object') continue;
                for (const k of Object.keys(conj)) bump(k);
            }
        } else if (c._not && typeof c._not === 'object') {
            for (const k of Object.keys(c._not)) bump(k);
        }
    }
    return out;
}

function mergeCounts(into, add) {
    for (const [k, v] of add) into.set(k, (into.get(k) || 0) + v);
}

// ── Per-slot read / write profiles ─────────────────────────────────
//
// Each slot gets a `reads` map (keyed by category) and a `writes` set.
// The categories let us attribute downstream usage to a specific kind
// of gate.

const SLOTS = FLOW_DAG.nodes.filter(n => n && n.key);

function profileSlot(slot) {
    const reads = {
        moduleReads:        new Map(),
        moduleActivateWhen: new Map(),
        moduleHideWhen:     new Map(),
        moduleExitPlanWhen: new Map(),
        nodeActivateWhen:   new Map(),
        nodeHideWhen:       new Map(),
        edgeRequires:       new Map(),
        edgeDisabledWhen:   new Map(),
        collapseWhen:       new Map(),
    };
    const writes = new Map();   // dim → count of write-sites in this slot
    const bumpW = (d) => writes.set(d, (writes.get(d) || 0) + 1);

    if (slot.kind === 'module') {
        const m = MODULE_MAP[slot.id];
        if (!m) return { reads, writes };

        for (const d of (m.reads || [])) {
            reads.moduleReads.set(d, (reads.moduleReads.get(d) || 0) + 1);
        }
        mergeCounts(reads.moduleActivateWhen, condDimsCounts(m.activateWhen));
        mergeCounts(reads.moduleHideWhen,     condDimsCounts(m.hideWhen));

        // Mirror attachModuleReducer's eviction rule to identify
        // durable writes. Anything in moveDims is moved to flavor at
        // module exit and isn't durable state.
        const writeSet = new Set(m.writes || []);
        const moveDims = new Set();
        for (const nid of (m.nodeIds || [])) {
            if (!writeSet.has(nid)) moveDims.add(nid);
        }
        for (const d of (m.internalMarkers || [])) moveDims.add(d);

        for (const d of writeSet) bumpW(d);
        if (m.completionMarker) {
            const cm = typeof m.completionMarker === 'string'
                ? m.completionMarker
                : (m.completionMarker && m.completionMarker.dim);
            if (cm) bumpW(cm);
        }

        if (m.exitPlan) {
            for (const t of m.exitPlan) {
                if (t.when) mergeCounts(reads.moduleExitPlanWhen, condDimsCounts(t.when));
                // exitPlan.set may include cross-module shared dims
                // that aren't formally in m.writes (e.g. war_set set
                // by ESCAPE's collateral_survivors tuples). Keep them
                // unless they're in moveDims.
                if (t.set) {
                    for (const d of Object.keys(t.set)) {
                        if (!moveDims.has(d)) bumpW(d);
                    }
                }
            }
        }
    } else if (slot.kind === 'node') {
        const n = NODE_MAP[slot.id];
        if (!n) return { reads, writes };

        mergeCounts(reads.nodeActivateWhen, condDimsCounts(n.activateWhen));
        mergeCounts(reads.nodeHideWhen,     condDimsCounts(n.hideWhen));

        // Selecting any edge writes the node's own dim.
        bumpW(n.id);

        for (const e of (n.edges || [])) {
            mergeCounts(reads.edgeRequires,     condDimsCounts(e.requires));
            mergeCounts(reads.edgeDisabledWhen, condDimsCounts(e.disabledWhen));
            if (e.effects) {
                const blocks = Array.isArray(e.effects) ? e.effects : [e.effects];
                for (const b of blocks) {
                    if (!b) continue;
                    if (b.when) mergeCounts(reads.collapseWhen, condDimsCounts(b.when));
                    if (b.set) for (const d of Object.keys(b.set)) bumpW(d);
                    // setFlavor / move are intentionally NOT counted
                    // as sel-writes — they target flavor or evict to
                    // flavor respectively. They don't end with the
                    // dim having a sel value.
                }
            }
        }
    }

    return { reads, writes };
}

const slotProfile = new Map();
for (const s of SLOTS) slotProfile.set(s.key, profileSlot(s));

// ── Topological order + descendant closure ─────────────────────────

const childrenOf = new Map();
const parentsOf  = new Map();
for (const s of SLOTS) { childrenOf.set(s.key, []); parentsOf.set(s.key, []); }
for (const [p, c] of FLOW_DAG.edges) {
    if (!childrenOf.has(p) || !childrenOf.has(c)) continue;
    childrenOf.get(p).push(c);
    parentsOf.get(c).push(p);
}

// Longest-path depth from any root → unambiguous topological ordering.
const depth = new Map();
function computeDepth(k, stack = new Set()) {
    if (depth.has(k)) return depth.get(k);
    if (stack.has(k)) return 0;
    stack.add(k);
    const ps = parentsOf.get(k) || [];
    const d = ps.length ? Math.max(...ps.map(p => computeDepth(p, stack))) + 1 : 0;
    stack.delete(k);
    depth.set(k, d);
    return d;
}
for (const s of SLOTS) computeDepth(s.key);

// Slot index in FLOW_DAG.nodes order — used as tie-breaker for "last".
const slotOrder = new Map();
SLOTS.forEach((s, i) => slotOrder.set(s.key, i));

// Forward-reachable descendant set for each slot (excluding self).
const descendants = new Map();
function computeDescendants(k, stack = new Set()) {
    if (descendants.has(k)) return descendants.get(k);
    if (stack.has(k)) return new Set();
    stack.add(k);
    const out = new Set();
    for (const c of (childrenOf.get(k) || [])) {
        out.add(c);
        for (const dd of computeDescendants(c, stack)) out.add(dd);
    }
    stack.delete(k);
    descendants.set(k, out);
    return out;
}
for (const s of SLOTS) computeDescendants(s.key);

// ── Outcome → attachment slots, dim profile per outcome ────────────

const outcomeReadCounts = new Map();    // outcomeId → Map<dim, count>
const outcomeAttachSlots = new Map();   // outcomeId → Set<slotKey>

for (const t of TEMPLATES) {
    if (!t.reachable) continue;
    const counts = condDimsCounts(t.reachable);
    if (counts.size) outcomeReadCounts.set(t.id, counts);
}
for (const s of SLOTS) {
    if (!Array.isArray(s.earlyExits)) continue;
    for (const oid of s.earlyExits) {
        if (!outcomeAttachSlots.has(oid)) outcomeAttachSlots.set(oid, new Set());
        outcomeAttachSlots.get(oid).add(s.key);
    }
}

// ── Collect every state dim + all writer slots per dim ─────────────

const writersByDim = new Map(); // dim → [slotKey, …]
for (const s of SLOTS) {
    const { writes } = slotProfile.get(s.key);
    for (const d of writes.keys()) {
        if (!writersByDim.has(d)) writersByDim.set(d, []);
        writersByDim.get(d).push(s.key);
    }
}

const stateDims = [...writersByDim.keys()].sort();

// Pick the topologically last writer for each dim.
function lastWriter(dim) {
    const candidates = writersByDim.get(dim) || [];
    let best = null;
    for (const k of candidates) {
        if (best == null) { best = k; continue; }
        const d1 = depth.get(k), d2 = depth.get(best);
        if (d1 > d2 || (d1 === d2 && slotOrder.get(k) > slotOrder.get(best))) {
            best = k;
        }
    }
    return best;
}

// ── For each dim, tally post-write mentions across descendants ─────

const READ_CATS = [
    'moduleReads',
    'moduleActivateWhen',
    'moduleHideWhen',
    'moduleExitPlanWhen',
    'nodeActivateWhen',
    'nodeHideWhen',
    'edgeRequires',
    'edgeDisabledWhen',
    'collapseWhen',
];

function analyzeDim(dim) {
    const lastWK = lastWriter(dim);
    const desc = descendants.get(lastWK) || new Set();

    const readsByCat = Object.fromEntries(READ_CATS.map(c => [c, 0]));
    let downstreamWrites = 0;
    const readingSlots = new Set();
    const writingSlots = new Set();

    for (const k of desc) {
        const prof = slotProfile.get(k);
        if (!prof) continue;
        for (const cat of READ_CATS) {
            const n = prof.reads[cat].get(dim) || 0;
            if (n) {
                readsByCat[cat] += n;
                readingSlots.add(k);
            }
        }
        const wn = prof.writes.get(dim) || 0;
        if (wn) {
            downstreamWrites += wn;
            writingSlots.add(k);
        }
    }

    // Outcomes attached to descendant slots
    let outcomeReads = 0;
    const outcomeSet = new Set();
    for (const [oid, counts] of outcomeReadCounts) {
        const c = counts.get(dim) || 0;
        if (!c) continue;
        const attachSlots = outcomeAttachSlots.get(oid) || new Set();
        let attached = false;
        for (const a of attachSlots) {
            if (desc.has(a) || a === lastWK) { attached = true; break; }
        }
        if (attached) {
            outcomeReads += c;
            outcomeSet.add(oid);
        }
    }

    const totalReads = READ_CATS.reduce((s, c) => s + readsByCat[c], 0) + outcomeReads;
    const totalWrites = downstreamWrites;

    return {
        dim,
        lastWriter: lastWK,
        lastWriterDepth: depth.get(lastWK),
        descCount: desc.size,
        readsByCat,
        outcomeReads,
        outcomeSlotsHit: outcomeSet.size,
        readingSlots: readingSlots.size,
        downstreamWrites: totalWrites,
        writingSlots: writingSlots.size,
        totalReads,
        totalImpact: totalReads + totalWrites,
        writers: writersByDim.get(dim).length,
    };
}

const rows = stateDims.map(analyzeDim);

// ── Report ────────────────────────────────────────────────────────

const pad  = (s, n) => String(s).padStart(n);
const padR = (s, n) => String(s).padEnd(n);

console.log('=== STATE DIMS — POST-LAST-WRITE GRAPH-IMPACTING USAGE ===');
console.log('');
console.log('  state dim         = a dim DURABLY in sel after some slot exits.');
console.log('                      Modules: writes ∪ completionMarker ∪');
console.log('                      exitPlan.set keys not in nodeIds\\writes ∪');
console.log('                      internalMarkers (the moveDims set used by');
console.log('                      attachModuleReducer to evict to flavor).');
console.log('                      Nodes: node.id ∪ effects.set keys.');
console.log('  last writer       = topologically latest FLOW_DAG slot that');
console.log('                      writes the dim (depth = longest-path');
console.log('                      column from any root)');
console.log('  reads             = mentions in any gate clause across slots');
console.log('                      strictly downstream of the last writer:');
console.log('                      activateWhen / hideWhen / edge.requires /');
console.log('                      edge.disabledWhen / collapse.when /');
console.log('                      module.reads / module.exitPlan.when');
console.log('  outc              = mentions in outcome.reachable clauses');
console.log('                      for outcomes attached (via earlyExits)');
console.log('                      to a descendant slot');
console.log('  writes            = downstream slot counts that overwrite');
console.log('                      the dim (would replace the "last" write');
console.log('                      on at least one path)');
console.log('  rSlots / wSlots   = distinct downstream slots reading /');
console.log('                      writing the dim');
console.log('  desc              = number of forward-reachable slots from');
console.log('                      the last writer');
console.log('  writers           = total number of slots that write the dim');
console.log('                      (≥1; >1 means multiple authors)');
console.log('');

// Least-used first. Tie-break by writer-count desc (more authors with
// no downstream readers ⇒ more obviously dead) then dim name asc.
rows.sort((a, b) =>
    a.totalImpact - b.totalImpact
    || b.writers - a.writers
    || a.dim.localeCompare(b.dim)
);

// Optional cap via env var: LIMIT=20 node tests/post_write_dim_usage.js
const LIMIT = process.env.LIMIT ? Number(process.env.LIMIT) : Infinity;
const shown = Number.isFinite(LIMIT) ? rows.slice(0, LIMIT) : rows;

const W = {
    dim: 30, last: 22, depth: 5, desc: 5,
    aw: 5, hw: 5, er: 5, ed: 5, cw: 5, mr: 5, ew: 5,
    outc: 6, rSlots: 6, wDown: 6, wSlots: 6, total: 8, writers: 9,
};

const header =
    padR('dim', W.dim) +
    padR('lastWriter', W.last) +
    pad('dpth', W.depth) +
    pad('desc', W.desc) +
    pad('aw', W.aw) +
    pad('hw', W.hw) +
    pad('er', W.er) +
    pad('ed', W.ed) +
    pad('cw', W.cw) +
    pad('mR', W.mr) +
    pad('eW', W.ew) +
    pad('outc', W.outc) +
    pad('rSl', W.rSlots) +
    pad('wDn', W.wDown) +
    pad('wSl', W.wSlots) +
    pad('writers', W.writers) +
    pad('TOTAL', W.total);

console.log('Legend: aw=node+module activateWhen, hw=node+module hideWhen,');
console.log('        er=edge.requires, ed=edge.disabledWhen, cw=collapse.when,');
console.log('        mR=module.reads, eW=module.exitPlan.when');
console.log('');
console.log(`(showing ${shown.length} least-used dims of ${rows.length} total)`);
console.log('');
console.log(header);
console.log('-'.repeat(header.length));

for (const r of shown) {
    const aw = r.readsByCat.nodeActivateWhen + r.readsByCat.moduleActivateWhen;
    const hw = r.readsByCat.nodeHideWhen     + r.readsByCat.moduleHideWhen;
    const er = r.readsByCat.edgeRequires;
    const ed = r.readsByCat.edgeDisabledWhen;
    const cw = r.readsByCat.collapseWhen;
    const mr = r.readsByCat.moduleReads;
    const ew = r.readsByCat.moduleExitPlanWhen;
    console.log(
        padR(r.dim, W.dim) +
        padR(r.lastWriter, W.last) +
        pad(r.lastWriterDepth, W.depth) +
        pad(r.descCount, W.desc) +
        pad(aw, W.aw) +
        pad(hw, W.hw) +
        pad(er, W.er) +
        pad(ed, W.ed) +
        pad(cw, W.cw) +
        pad(mr, W.mr) +
        pad(ew, W.ew) +
        pad(r.outcomeReads, W.outc) +
        pad(r.readingSlots, W.rSlots) +
        pad(r.downstreamWrites, W.wDown) +
        pad(r.writingSlots, W.wSlots) +
        pad(r.writers, W.writers) +
        pad(r.totalImpact, W.total)
    );
}

console.log('');
console.log('=== TOP DEAD WRITES (last-writer with zero downstream impact) ===');
const dead = rows.filter(r => r.totalImpact === 0);
if (dead.length === 0) {
    console.log('  (none — every state dim is read or rewritten somewhere downstream)');
} else {
    for (const r of dead) {
        const writers = writersByDim.get(r.dim);
        const writerStr = writers.length === 1
            ? r.lastWriter
            : `${r.lastWriter}  (also written by: ${writers.filter(w => w !== r.lastWriter).join(', ')})`;
        console.log(`  ${padR(r.dim, 28)} last=${writerStr}`);
    }
}

console.log('');
console.log(`(scanned ${SLOTS.length} FLOW_DAG slots, ${TEMPLATES.length} outcome templates, ${stateDims.length} state dims)`);
