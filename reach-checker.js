'use strict';

// reach-checker.js — Composite reachability lookup.
//
// Combines two layers:
//   1. Precomputed slot-exit reach masks loaded from
//      data/explore-cache/<slotKey>.full.bin (produced by the
//      explore + reach pipeline). Indexed PER SLOT: `(slotKey,
//      selKey) → uint32 mask`. The same `selKey` can legitimately
//      appear at multiple slot exits (escape × 5; node slots
//      whose only edges flavor-move their answer dim — brittle,
//      sufficient, takeoff, governance_window…), and each slot's
//      forward reach is distinct, so lookups MUST be slot-keyed.
//      A globalized `selKey → mask` index would OR escape's
//      forward reach into who_benefits, alignment's forward
//      reach into escape, etc., producing soundness-breaking
//      over-approximation in the gate.
//   2. Live in-module DFS for sels that don't appear at the
//      active slot's exit boundary — i.e. mid-module partial
//      states the runtime visits between an internal click and
//      the module's completionMarker firing. The DFS walks the
//      same path the engine does (`findNextInternalNode` +
//      `applyEdgeEffects`) and OR-merges every reachable child's
//      reach mask, with the per-slot index as the early-out /
//      cache-hit boundary at the module's exit.
//
// One reach mask = one uint32 with one bit per outcome entry from
// data/explore-cache/_meta.json. There are currently 28 entries
// (all outcome variants + flat outcomes), all fitting comfortably
// in 31 signed bits.
//
// Used by:
//   * tests/random_walks_locked.js    — gate edges against a
//                                        single locked outcome.
//   * (future) index.html             — same gate at the runtime,
//                                        replacing the old per-
//                                        outcome reach files.
//
// Why not always live DFS (no precompute)? Because the across-slot
// reach DAG is huge (1.88M unique full sels w/ predecessor lists
// — ~2 MB on disk in the v3 binary format). Live-traversing it
// per click would be unaffordable. Precompute does the global
// reach in one shot; the DFS only handles the cheap, bounded
// in-module branch space (≤ a few hundred sels per active module).
//
// Shape of `index`:
//   {
//     reachBySlot:    Map<slotKey, Map<selKey, uint32>>,
//     moduleOfNode:   Map<nodeId, module>,
//     outcomeEntries: [{ id, templateId, primaryDim, variantKey, bit }],
//     bitFor:         (entryId) => uint32 | 0,
//   }
//
// Browser bundling: this file declares `ReachChecker` on `window`
// when loaded, and on `module.exports` in Node. The Node-only
// `buildIndexFromCache(...)` helper walks the disk cache; browsers
// should build the index from fetched .full.bin files (loader to
// be added when index.html migrates to v3).

(function (root) {

    function _selKey(sel) {
        // Identical to GraphIO.selKey (canonical, NUL-delimited,
        // sorted). Re-implemented so the checker has zero optional
        // dependencies on graph runtime — buildIndexFromCache hands
        // us full sels straight from the binary cache, which never
        // go through Engine.applyEdgeEffects.
        const keys = Object.keys(sel).sort();
        const parts = new Array(keys.length * 2);
        for (let i = 0; i < keys.length; i++) {
            parts[i * 2] = keys[i];
            parts[i * 2 + 1] = sel[keys[i]];
        }
        return parts.join('\x00');
    }

    // ─── Composite checker ────────────────────────────────────────

    function createChecker(index, deps) {
        if (!index || !index.reachBySlot) {
            throw new Error('reach-checker: createChecker(index, deps) requires `index.reachBySlot`');
        }
        if (!deps || !deps.GraphIO || !deps.Engine) {
            throw new Error('reach-checker: createChecker requires { GraphIO, Engine } deps');
        }
        const { reachBySlot, moduleOfNode, outcomeEntries, slotsOfModule } = index;
        const { GraphIO, Engine } = deps;

        const _bitFor = new Map();
        for (const e of outcomeEntries || []) _bitFor.set(e.id, e.bit | 0);

        function _siphonBitsFor(sel) {
            // Mirrors precompute-reach-direct.siphonBitsFor. Cached
            // entries already include this contribution (the direct
            // pass set them before back-prop), but mid-module sels
            // skip the cache entirely so we rebuild it live.
            const hits = GraphIO.matchOutcomes(sel);
            if (!hits || hits.length === 0) return 0;
            let bits = 0;
            for (const oid of hits) {
                for (const e of (outcomeEntries || [])) {
                    if (e.templateId !== oid) continue;
                    if (!e.primaryDim) { bits |= e.bit; continue; }
                    if (sel[e.primaryDim] === e.variantKey) bits |= e.bit;
                }
            }
            return bits;
        }

        // Look up `sel`'s reach at the given slot's exit boundary.
        // Returns undefined when sel isn't at slotKey's exit (i.e.
        // mid-module relative to slotKey). Slot-keyed: alignment
        // and who_benefits can hold the same selKey with different
        // forward reach masks; the caller must specify which one
        // we're "leaving from."
        function _slotExitReach(slotKey, sk) {
            const m = reachBySlot.get(slotKey);
            if (!m) return undefined;
            return m.get(sk);
        }

        function _lightPushSel(sel, node, edge) {
            // Mirrors index.html `_lightPush` and graph-io's
            // `_applyEdgeWrites`. Stamps node.id=edge.id then runs
            // applyEdgeEffects (sel-only — flavor isn't observed
            // by templateMatches and so doesn't affect reach).
            const next = Object.assign({}, sel, { [node.id]: edge.id });
            Engine.applyEdgeEffects(next, edge, null);
            return next;
        }

        function _dfsInModule(sel, mod, slotKey, memo) {
            const sk = _selKey(sel);
            const cached = memo.get(sk);
            if (cached !== undefined) return cached;
            // Mark in-flight to short-circuit cycles. If a cycle
            // resolves later, the deferred OR is conservative
            // (zero), which only ever undercounts reach — never
            // produces a false positive. Modules are acyclic in
            // practice (findNextInternalNode advances a fresh
            // dim each call), so this guard is belt-and-suspenders.
            memo.set(sk, 0);

            // Cache hit takes priority over walk: post-Option-A,
            // the precompute produces runtime-shape exit sels (the
            // static merge tracks `effects.move` and excludes moved
            // dims from pt-merge), so the runtime selKey at module
            // exit lands directly in `reachBySlot`. No rehydration
            // step needed.
            const cachedReach = _slotExitReach(slotKey, sk);
            if (cachedReach !== undefined) {
                memo.set(sk, cachedReach | 0);
                return cachedReach | 0;
            }

            // Module-done check matches `_dfsModuleOutputs` — once
            // the completionMarker fires, the runtime navigator
            // stops asking the module's internals. If we got here
            // (no cache hit) the runtime exit sel isn't in the
            // cache, which is a real precompute soundness gap;
            // fall back to direct-match siphon bits only and let
            // the parity / random-walks tests surface the gap.
            const marker = mod.completionMarker;
            if (marker && Engine.isModuleDone(sel, marker)) {
                const direct = _siphonBitsFor(sel);
                memo.set(sk, direct);
                return direct;
            }

            const direct = _siphonBitsFor(sel);
            const node = GraphIO.findNextInternalNode(mod, sel);
            if (!node) {
                // Mid-module dead-end (no askable internal AND not
                // exited). Direct match only. Validate.js Phase 9
                // catches the structural cases of this; here we
                // just report what we have.
                memo.set(sk, direct);
                return direct;
            }

            let forward = 0;
            for (const edge of node.edges) {
                if (Engine.isEdgeDisabled(sel, node, edge)) continue;
                const child = _lightPushSel(sel, node, edge);
                forward |= _dfsInModule(child, mod, slotKey, memo);
            }
            const mask = direct | forward;
            memo.set(sk, mask);
            return mask;
        }

        // Public API — given a sel and the slot it's leaving from
        // (the slot whose findNextQuestion produced the click that
        // produced this sel), return its forward reach mask.
        //
        // slotKey contract:
        //   * `slotKey` MUST be a non-terminal FLOW_DAG slot key.
        //     For a top-level node click, that's the node id; for
        //     a module-internal click, it's the module's wrapping
        //     slot key (e.g. 'escape_early', not 'escape'). The
        //     walker / runtime always has this from
        //     `FlowPropagation.flowNext().slotKey`.
        //
        //   * If sel is at slotKey's exit boundary the precomputed
        //     mask is returned directly (single Map lookup).
        //
        //   * If sel is mid-module relative to slotKey, a live DFS
        //     walks the remaining internals of slotKey's module
        //     until each branch hits the module-exit boundary OR
        //     bottoms out (dead-end mid-module → direct match
        //     only). The DFS uses `dfsMemo` for repeated states.
        //
        // opts:
        //   * dfsMemo (Map) — shared DFS memo across calls.
        function getReach(slotKey, sel, opts) {
            const sk = _selKey(sel);
            const direct = _slotExitReach(slotKey, sk);
            if (direct !== undefined) return direct | 0;
            const mod = (slotsOfModule && slotsOfModule.byKey)
                ? slotsOfModule.byKey.get(slotKey)
                : null;
            if (!mod) {
                // Top-level node slot with sel not in cache — this
                // is a precompute gap. Conservatively report no
                // reach so the gate refuses the edge; the walker
                // will surface 'no-reachable-edges' and the user
                // can investigate.
                return 0;
            }
            const dfsMemo = (opts && opts.dfsMemo) || new Map();
            return _dfsInModule(sel, mod, slotKey, dfsMemo) | 0;
        }

        function couldReach(slotKey, sel, mask, opts) {
            return ((getReach(slotKey, sel, opts) & mask) | 0) !== 0;
        }

        function bitFor(entryId) {
            return _bitFor.has(entryId) ? _bitFor.get(entryId) : 0;
        }

        function moduleForNode(nodeId) {
            return moduleOfNode ? moduleOfNode.get(nodeId) || null : null;
        }

        return {
            getReach,
            couldReach,
            bitFor,
            moduleForNode,
            outcomeEntries: outcomeEntries || [],
            // Exposed for tests / diagnostics. Callers shouldn't
            // mutate.
            reachBySlot,
        };
    }

    // ─── Node-only: build index from data/explore-cache ───────────
    //
    // Browsers will build the index from fetched binaries; Node
    // uses the explore-cache loader. Result shape feeds straight
    // into createChecker(index, deps).

    function _isNode() {
        return typeof process !== 'undefined'
            && process.versions && process.versions.node
            && typeof require === 'function';
    }

    function buildIndexFromCache(deps) {
        if (!_isNode()) {
            throw new Error('reach-checker.buildIndexFromCache is Node-only');
        }
        if (!deps || !deps.Cache || !deps.MODULES || !deps.FLOW_DAG) {
            throw new Error('buildIndexFromCache requires { Cache, MODULES, FLOW_DAG }');
        }
        const { Cache, MODULES, FLOW_DAG } = deps;
        const fs = require('fs');

        const meta = Cache.loadMeta();
        if (!meta || !Array.isArray(meta.outcomeEntries)) {
            throw new Error('reach-checker: data/explore-cache/_meta.json missing — run precompute-explore.js first');
        }

        const cacheDir = Cache.cacheDir();
        const slotKeys = fs.readdirSync(cacheDir)
            .filter(f => f.endsWith('.full.bin'))
            .map(f => f.slice(0, -'.full.bin'.length))
            .sort();

        // Per-slot index: each slot owns its own selKey → mask map.
        // Memory cost is one selKey string per (slot, sel) entry —
        // ~60 MB total at 1.88M entries × 30B avg key. Acceptable
        // for both Node tests and the eventual browser runtime.
        const reachBySlot = new Map();
        for (const k of slotKeys) {
            const v = Cache.openFullSels(k);
            if (!v) continue;
            const m = new Map();
            for (let i = 0; i < v.selCount; i++) {
                m.set(_selKey(v.getSel(i)), v.getReach(i) | 0);
            }
            reachBySlot.set(k, m);
        }

        const moduleOfNode = new Map();
        for (const m of MODULES) {
            for (const nid of (m.nodeIds || [])) moduleOfNode.set(nid, m);
        }

        // slotsOfModule: the inverse of FLOW_DAG's module→slot
        // mapping. Modules can wrap under multiple slot keys
        // (escape × 5), so we map both directions:
        //   byKey:    slotKey → module
        //   byModule: moduleId → [slotKey, …]
        // The DFS uses byKey to find the module wrapping the
        // current slot.
        const byKey = new Map();
        const byModule = new Map();
        const moduleById = new Map();
        for (const m of MODULES) moduleById.set(m.id, m);
        for (const slot of FLOW_DAG.nodes) {
            if (!slot || slot.kind !== 'module') continue;
            const mod = moduleById.get(slot.id);
            if (!mod) continue;
            byKey.set(slot.key, mod);
            let arr = byModule.get(mod.id);
            if (!arr) { arr = []; byModule.set(mod.id, arr); }
            arr.push(slot.key);
        }

        return {
            reachBySlot,
            moduleOfNode,
            slotsOfModule: { byKey, byModule },
            outcomeEntries: meta.outcomeEntries,
            bitFor: (entryId) => {
                for (const e of meta.outcomeEntries) {
                    if (e.id === entryId) return e.bit | 0;
                }
                return 0;
            },
        };
    }

    // ─── Export surface ───────────────────────────────────────────
    const api = { createChecker, buildIndexFromCache, _selKey };
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    } else {
        root.ReachChecker = api;
    }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
