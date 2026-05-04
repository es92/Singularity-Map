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
// when loaded, and on `module.exports` in Node. The cross-platform
// `buildIndexFromViews(...)` helper takes per-slot views (produced
// by `ExploreCache.openFullSels` on disk in Node, or
// `openFullSelsFromBuffer` after fetch+decompress in the browser).
// `buildIndexFromCache(...)` is a Node-only convenience that wraps
// disk reads then forwards to buildIndexFromViews.

(function (root) {

    // Canonical sel string. Single source of truth in sel-key.js
    // (Node `require('./sel-key')`, browser `window.SelKey`). Bound
    // to a local so per-call lookups stay cheap on the in-module DFS
    // path.
    const _SelKeyMod = (typeof require === 'function')
        ? require('./sel-key')
        : root.SelKey;
    const _selKey = _SelKeyMod.selKey;

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
            // Mirrors index.html `_lightPushSel` and graph-io's
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

    // ─── Cross-platform: build index from per-slot views ──────────
    //
    // Both Node tests and the browser runtime funnel through this.
    // Caller provides:
    //   * outcomeEntries — the bit assignment from
    //                      data/explore-cache/_meta.json (or the
    //                      bundled `_meta.json` shipped with the
    //                      browser binary).
    //   * views          — Map<slotKey, view>, where each view has
    //                      `selCount`, `getSel(i)`, `getReach(i)`
    //                      (the shape `ExploreCache.openFullSels`
    //                      and `openFullSelsFromBuffer` return).
    //   * MODULES, FLOW_DAG — runtime graph metadata.
    //
    // Result feeds straight into createChecker(index, deps).

    function buildIndexFromViews(deps) {
        if (!deps || !deps.views || !deps.outcomeEntries
                || !deps.MODULES || !deps.FLOW_DAG) {
            throw new Error('buildIndexFromViews requires '
                + '{ views, outcomeEntries, MODULES, FLOW_DAG }');
        }
        const { views, outcomeEntries, MODULES, FLOW_DAG } = deps;

        // Per-slot index: each slot owns its own selKey → mask map.
        // Memory cost is one selKey string per (slot, sel) entry —
        // ~60 MB total at 1.88M entries × 30B avg key. Acceptable
        // for both Node tests and the browser runtime (a one-time
        // build cost on enter-locked-mode).
        const reachBySlot = new Map();
        for (const [slotKey, v] of views) {
            if (!v) continue;
            const m = new Map();
            for (let i = 0; i < v.selCount; i++) {
                m.set(_selKey(v.getSel(i)), v.getReach(i) | 0);
            }
            reachBySlot.set(slotKey, m);
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
            outcomeEntries,
            bitFor: (entryId) => {
                for (const e of outcomeEntries) {
                    if (e.id === entryId) return e.bit | 0;
                }
                return 0;
            },
        };
    }

    // ─── Node-only: build index from data/explore-cache ───────────
    //
    // Reads the disk cache produced by the precompute pipeline and
    // forwards to buildIndexFromViews. Browsers fetch binaries +
    // call buildIndexFromViews directly.

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

        const views = new Map();
        for (const k of slotKeys) {
            const v = Cache.openFullSels(k);
            if (v) views.set(k, v);
        }

        return buildIndexFromViews({
            views,
            outcomeEntries: meta.outcomeEntries,
            MODULES,
            FLOW_DAG,
        });
    }

    // ─── Per-outcome variant ──────────────────────────────────────
    //
    // The browser fetches a single per-outcome file on lock — every
    // (slot, sel) it contains has been pre-filtered to mask & bit ≠ 0,
    // and the mask itself is dropped. The runtime gate then collapses
    // to a boolean lookup.
    //
    // Equivalence with the mask-based gate (proved by tests/per_outcome_parity
    // and tests/random_walks_locked):
    //
    //   * slot-exit click whose sel is in the per-outcome set
    //                                         ⇒ couldReach=true (mask-based: mask & bit ≠ 0)
    //   * slot-exit click whose sel is NOT in the set
    //                                         ⇒ DFS recurses, bottoms out, returns false
    //                                            (mask-based: mask=0 ⇒ false; same gate decision)
    //   * mid-module click
    //                                         ⇒ DFS walks internals exactly as before;
    //                                            base case at the module-exit boundary uses
    //                                            the per-outcome set instead of the mask AND
    //                                            direct-match (siphon) reduces to a single
    //                                            template match instead of OR-of-all-templates.
    //
    // Boolean result type means the in-module memo and OR-merge step
    // both collapse — the DFS short-circuits as soon as any branch
    // returns true.

    function buildOutcomeIndexFromView(deps) {
        if (!deps || !deps.outcomeView || !deps.MODULES || !deps.FLOW_DAG) {
            throw new Error('buildOutcomeIndexFromView requires '
                + '{ outcomeView, MODULES, FLOW_DAG }');
        }
        const { outcomeView, MODULES, FLOW_DAG } = deps;

        // Per-slot Set<selKey>. Built once per locked outcome; the
        // ExploreCache view's getSelKey() materializes the canonical
        // string directly from the byte row (no Object/Sort/JSON
        // detour through getSel).
        const reachBySlot = new Map();
        for (const slot of outcomeView.slots) {
            const s = new Set();
            for (let i = 0; i < slot.selCount; i++) {
                s.add(slot.getSelKey(i));
            }
            reachBySlot.set(slot.key, s);
        }

        const moduleOfNode = new Map();
        for (const m of MODULES) {
            for (const nid of (m.nodeIds || [])) moduleOfNode.set(nid, m);
        }

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
            entryId: outcomeView.entryId,
            templateId: outcomeView.templateId,
            primaryDim: outcomeView.primaryDim,
            variantKey: outcomeView.variantKey,
        };
    }

    function createOutcomeChecker(index, deps) {
        if (!index || !index.reachBySlot) {
            throw new Error('reach-checker: createOutcomeChecker requires `index.reachBySlot`');
        }
        if (!deps || !deps.GraphIO || !deps.Engine) {
            throw new Error('reach-checker: createOutcomeChecker requires { GraphIO, Engine } deps');
        }
        if (!deps.template) {
            throw new Error('reach-checker: createOutcomeChecker requires { template } '
                + '(the locked outcome\'s template object from outcomes.json)');
        }
        const { reachBySlot, moduleOfNode, slotsOfModule,
                templateId, primaryDim, variantKey } = index;
        const { GraphIO, Engine, template } = deps;

        // Variant gate: when the locked outcome is a variant entry
        // (e.g. the-flourishing--rapid), a direct template match is
        // only a hit if sel[primaryDim] === variantKey. Flat outcomes
        // skip this check.
        const _hasVariant = primaryDim != null && variantKey != null;

        function _directHit(sel) {
            if (!Engine.templateMatches(template, sel)) return false;
            if (_hasVariant && sel[primaryDim] !== variantKey) return false;
            return true;
        }

        function _slotExitReach(slotKey, sk) {
            const s = reachBySlot.get(slotKey);
            return !!(s && s.has(sk));
        }

        function _lightPushSel(sel, node, edge) {
            const next = Object.assign({}, sel, { [node.id]: edge.id });
            Engine.applyEdgeEffects(next, edge, null);
            return next;
        }

        function _dfsInModule(sel, mod, slotKey, memo) {
            const sk = _selKey(sel);
            const cached = memo.get(sk);
            if (cached !== undefined) return cached;
            // In-flight = false: short-circuits cycles to a
            // conservative under-estimate (modules are acyclic in
            // practice — findNextInternalNode advances a fresh
            // dim each call — so this is belt-and-suspenders).
            memo.set(sk, false);

            // Cache hit at module exit boundary takes priority over
            // walk: the post-edge sel landed at an exit the
            // precompute records as reaching this outcome.
            if (_slotExitReach(slotKey, sk)) {
                memo.set(sk, true);
                return true;
            }

            // Module-done with cache miss falls back to direct match
            // only — same shape as the mask-based DFS, just bool.
            const marker = mod.completionMarker;
            if (marker && Engine.isModuleDone(sel, marker)) {
                const direct = _directHit(sel);
                memo.set(sk, direct);
                return direct;
            }

            if (_directHit(sel)) {
                memo.set(sk, true);
                return true;
            }

            const node = GraphIO.findNextInternalNode(mod, sel);
            if (!node) {
                memo.set(sk, false);
                return false;
            }

            for (const edge of node.edges) {
                if (Engine.isEdgeDisabled(sel, node, edge)) continue;
                const child = _lightPushSel(sel, node, edge);
                if (_dfsInModule(child, mod, slotKey, memo)) {
                    memo.set(sk, true);
                    return true;
                }
            }
            memo.set(sk, false);
            return false;
        }

        function couldReach(slotKey, sel, opts) {
            const sk = _selKey(sel);
            if (_slotExitReach(slotKey, sk)) return true;
            const mod = (slotsOfModule && slotsOfModule.byKey)
                ? slotsOfModule.byKey.get(slotKey)
                : null;
            if (!mod) {
                // Top-level node slot, sel not in the per-outcome
                // set → cannot reach (matches the mask-based path's
                // "return 0" precompute-gap fallback).
                return false;
            }
            const dfsMemo = (opts && opts.dfsMemo) || new Map();
            return _dfsInModule(sel, mod, slotKey, dfsMemo);
        }

        function moduleForNode(nodeId) {
            return moduleOfNode ? moduleOfNode.get(nodeId) || null : null;
        }

        return {
            couldReach,
            moduleForNode,
            entryId: index.entryId,
            templateId, primaryDim, variantKey,
            reachBySlot,
        };
    }

    // ─── Export surface ───────────────────────────────────────────
    const api = {
        createChecker, buildIndexFromCache, buildIndexFromViews,
        createOutcomeChecker, buildOutcomeIndexFromView,
        _selKey,
    };
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    } else {
        root.ReachChecker = api;
    }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
