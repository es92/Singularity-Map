// graph-io.js — static-analysis primitives for graph elements.
//
// Sits next to graph.js / engine.js / graph-walker.js as another
// graph-data layer that the runtime engine doesn't need but tooling
// and UI do. Stateless beyond a small lazy cache; every public call
// is a pure function of the graph data + outcome templates + the
// input slot.
//
// Slot vocabulary: a slot is `{ key, id, kind }` where kind is one
// of 'module' | 'node' | 'outcome'. Deadend slots have no I/O
// contract here.
//
// Initial public surface (window.GraphIO):
//
//   cartesianReadRows(slot)
//     Returns { dims, rows, truncated }, where:
//       - dims     : sorted list of dim names the slot reads
//       - rows     : the subset of the cartesian product over the dims'
//                    value spaces that satisfies the slot's entry
//                    conditions (`activateWhen` matches and `hideWhen`
//                    does not). Each row is { [dim]: value, ... }; a
//                    value of GraphIO.UNSET means "this dim has no
//                    value in the candidate sel".
//       - truncated: true iff the unfiltered cart-prod exceeded
//                    MAX_ROWS (the iteration is capped to keep
//                    pathological reads from blowing up the result).
//
//   cartesianWriteRows(slot)
//     Returns { dims, rows, truncated } parallel to cartesianReadRows,
//     but for OUTPUT states. Walks the slot's internal DFS from each
//     input row through to terminal states and projects each terminal
//     onto the slot's write-dim list, deduped:
//       - module : DFS through `mod.nodeIds`, picking enabled edges,
//                  applying every collapseToFlavor.set block (user-
//                  defined intermediate writes + auto-installed exit-
//                  tuple sets). A leaf is a state where no internal
//                  node is askable; it counts as an output iff the
//                  module's completionMarker is set.
//       - node   : single-step "DFS" — for each enabled edge, the
//                  output state is the input + edge.id written to
//                  node.id + the edge's collapseToFlavor.set blocks.
//       - outcome: terminal slot, no walk; returns no rows.
//     Distinct write-dim projections collapse identical paths, so a
//     module exposing 63 exit tuples may surface far fewer unique
//     output states.
//
//   dimDomain(dim)
//     Returns the inferred value space for a dim — every literal value
//     observed for it across the whole graph (NODE.edges, condition
//     literals, collapseToFlavor.set, exitPlan.set). The UNSET
//     sentinel is NOT included; cartesianReadRows adds it when it
//     enumerates rows.
//
// "Read dims" per slot:
//   * module: union of mod.reads + dims mentioned in mod.activateWhen
//     + dims mentioned in mod.hideWhen. Written dims (declared writes,
//     completionMarker) are NOT subtracted — a module can read and
//     write the same dim (escape reads containment='escaped' as its
//     entry gate and overwrites it on post_catch=contained exit), and
//     evicting them would force the dim to UNSET in every cart-prod
//     row and silently filter out entry clauses that require it.
//   * flat node: dims mentioned in node.activateWhen / hideWhen and in
//     each edge's `requires` / `disabledWhen`. Same no-eviction policy.
//   * outcome: dims mentioned in any t.reachable cond (positive keys
//     and `_not` keys both contribute). Entry filter is
//     engine.templateMatches(t, sel).
//
// Outcome templates aren't part of the graph proper — they're loaded
// asynchronously from data/outcomes.json — so the call site has to
// hand them in via GraphIO.registerOutcomes(templates) before
// querying outcome slots. Calling registerOutcomes invalidates the
// caches.
//
// Caches are populated lazily and otherwise never invalidated — the
// graph itself is static for the lifetime of the page.
//
// Cross-refresh persistence (localStorage):
//   `cartesianWriteRows` for every module slot is persisted to
//   localStorage under `gio:writeRows:<id>:v<N>` so a page refresh
//   skips the DFS entirely. Originally limited to 'escape' (the only
//   module above ~100ms), but the savings stack up across the dozen
//   other modules that /explore renders simultaneously, so we cache
//   them all. The stored payload carries a fingerprint of the module
//   + every NODE in mod.nodeIds; if any relevant graph data changes
//   the fingerprint mismatches and we recompute. PERSIST_VERSION must
//   be bumped whenever the DFS itself changes (e.g. new
//   collapseToFlavor handling) so old payloads are discarded across
//   deploys. Storage is best-effort: quota errors and disabled
//   localStorage just fall back to the in-memory path.

(function () {
    'use strict';

    const UNSET = '__GIO_UNSET__';
    const MAX_ROWS = 200000;

    // Every module's write-row DFS persists across refreshes. Bump
    // PERSIST_VERSION when the DFS algorithm or its helpers change in
    // a way that could affect output rows OR when the
    // _selKey/_readSelKey serialization format changes (byInput keys
    // are persisted, so a format change makes every lookup miss → 0
    // outputs). Eligibility is gated by `slot.kind === 'module'` at
    // the call sites below; outcomes have no DFS to cache.
    const PERSIST_VERSION = 8;
    const PERSIST_KEY_PREFIX = 'gio:writeRows:';

    let _domainsCache = null;
    const _readDimsCache = new Map();   // slot.key → string[]
    const _rowsCache = new Map();       // slot.key → { dims, rows, truncated }
    const _writeDimsCache = new Map();  // slot.key → string[]
    const _writeRowsCache = new Map();  // slot.key → { dims, rows, truncated }
    let _outcomeMap = null;             // id → template (registered externally)

    function _invalidate() {
        _domainsCache = null;
        _readDimsCache.clear();
        _rowsCache.clear();
        _writeDimsCache.clear();
        _writeRowsCache.clear();
    }

    function registerOutcomes(templates) {
        _outcomeMap = new Map((templates || []).map(t => [t.id, t]));
        _invalidate();
    }
    function _getOutcome(id) {
        return (_outcomeMap && _outcomeMap.get(id)) || null;
    }

    // Returns the list of outcome ids whose `reachable` clauses accept the
    // given sel. Mirrors engine.templateMatches; used by callers (explore
    // propagation) to siphon module-exit selections that have already
    // resolved to a terminal outcome out of the downstream flow. Empty
    // array if no outcomes match (or no templates registered yet).
    //
    // No memoization: templateMatches early-rejects on the first dim
    // that disagrees, so a typical call scans only a few props of a few
    // templates before returning. A projection-keyed cache was tried
    // and added ~100ms of key-building overhead for ~0ms of saved work
    // on a 1M-sel pass (escape_late). The real cost in that pass lives
    // in reachableFullSelsFromInputs's per-row merge — match phase is
    // already fast.
    function matchOutcomes(sel) {
        if (!_outcomeMap || _outcomeMap.size === 0) return [];
        if (!window.Engine || !window.Engine.templateMatches) return [];
        const hits = [];
        for (const t of _outcomeMap.values()) {
            if (window.Engine.templateMatches(t, sel)) hits.push(t.id);
        }
        return hits;
    }

    // ─── Graph accessors (lazy because graph.js loads first but
    //     window.Engine is populated by engine.js's IIFE). ─────────────
    function NODE_MAP() { return (window.Engine && window.Engine.NODE_MAP) || (window.Graph && window.Graph.NODE_MAP) || {}; }
    function MODULE_MAP() { return (window.Engine && window.Engine.MODULE_MAP) || (window.Graph && window.Graph.MODULE_MAP) || {}; }
    function NODES_LIST() { return (window.Engine && window.Engine.NODES) || (window.Graph && window.Graph.NODES) || []; }
    function MODULES_LIST() { return (window.Engine && window.Engine.MODULES) || (window.Graph && window.Graph.MODULES) || []; }

    function matchCondition(sel, cond) {
        // engine.matchCondition is the canonical gate — same one used at
        // runtime for activateWhen / hideWhen / requires / disabledWhen.
        if (!window.Engine || !window.Engine.matchCondition) return true;
        return window.Engine.matchCondition(sel, cond);
    }

    // ─── Dim value-space inference ──────────────────────────────────
    // Walks the entire graph once and accumulates, per dim, every
    // literal value observed:
    //   * NODE.edges                 → values for the node's own dim
    //   * NODE.activateWhen          → values constraining each dim
    //   * NODE.hideWhen              → ditto
    //   * edge.requires / disabledWhen → ditto
    //   * collapseToFlavor.set / setFlavor / .when → dim writes + gates
    //   * MODULE.activateWhen / hideWhen → ditto
    //   * MODULE.exitPlan[].set / .when → marker dims like decel_set
    //
    // The result is a Map<dim, string[]> with sorted, deduped values.
    // Booleans / objects are not collected as literals (they don't
    // contribute to a finite enumerable value space).
    function _buildDomains() {
        if (_domainsCache) return _domainsCache;
        const domains = new Map();
        const add = (dim, val) => {
            if (val == null) return;
            if (typeof val === 'boolean') return;
            const v = typeof val === 'object' ? JSON.stringify(val) : String(val);
            if (!domains.has(dim)) domains.set(dim, new Set());
            domains.get(dim).add(v);
        };
        const scanCondList = (conds) => {
            if (!conds) return;
            const arr = Array.isArray(conds) ? conds : [conds];
            for (const c of arr) {
                if (!c || typeof c !== 'object') continue;
                for (const k of Object.keys(c)) {
                    if (k === 'reason' || k.startsWith('_')) continue;
                    const v = c[k];
                    if (Array.isArray(v)) v.forEach(x => add(k, x));
                    else if (v && typeof v === 'object' && Array.isArray(v.not)) v.not.forEach(x => add(k, x));
                    else if (typeof v === 'string') add(k, v);
                }
            }
        };

        for (const n of NODES_LIST()) {
            if (n.edges) for (const e of n.edges) {
                add(n.id, e.id);
                scanCondList(e.requires);
                scanCondList(e.disabledWhen);
                if (e.collapseToFlavor) {
                    const blocks = Array.isArray(e.collapseToFlavor) ? e.collapseToFlavor : [e.collapseToFlavor];
                    for (const b of blocks) {
                        if (!b) continue;
                        if (b.set) for (const [k, v] of Object.entries(b.set)) add(k, v);
                        if (b.setFlavor) for (const [k, v] of Object.entries(b.setFlavor)) add(k, v);
                        scanCondList(b.when);
                    }
                }
            }
            scanCondList(n.activateWhen);
            scanCondList(n.hideWhen);
        }

        for (const m of MODULES_LIST()) {
            scanCondList(m.activateWhen);
            scanCondList(m.hideWhen);
            if (m.exitPlan) for (const t of m.exitPlan) {
                if (t.set) for (const [k, v] of Object.entries(t.set)) add(k, v);
                scanCondList(t.when);
            }
        }

        // Outcome reachable clauses use a slightly different shape than
        // engine conditions: positive keys map to value-arrays directly,
        // and `_not` carries a sub-object of dim → excluded-values.
        if (_outcomeMap) {
            for (const t of _outcomeMap.values()) {
                if (!t.reachable) continue;
                for (const cond of t.reachable) {
                    if (!cond || typeof cond !== 'object') continue;
                    for (const [k, v] of Object.entries(cond)) {
                        if (k === '_not') continue;
                        if (Array.isArray(v)) v.forEach(x => add(k, x));
                    }
                    if (cond._not && typeof cond._not === 'object') {
                        for (const [k, v] of Object.entries(cond._not)) {
                            if (Array.isArray(v)) v.forEach(x => add(k, x));
                        }
                    }
                }
            }
        }

        _domainsCache = new Map();
        for (const [k, vs] of domains) _domainsCache.set(k, [...vs].sort());
        return _domainsCache;
    }

    function dimDomain(dim) {
        return (_buildDomains().get(dim) || []).slice();
    }

    // ─── Per-slot read-dim discovery ────────────────────────────────
    function _collectCondDims(conds, out) {
        if (!conds) return;
        const arr = Array.isArray(conds) ? conds : [conds];
        for (const c of arr) {
            if (!c || typeof c !== 'object') continue;
            for (const k of Object.keys(c)) {
                if (k === 'reason' || k.startsWith('_')) continue;
                out.add(k);
            }
        }
    }

    function _readDimsForSlot(slot) {
        const cached = _readDimsCache.get(slot.key);
        if (cached) return cached;
        const dims = new Set();
        if (slot.kind === 'module') {
            const mod = MODULE_MAP()[slot.id];
            if (mod) {
                for (const d of (mod.reads || [])) dims.add(d);
                _collectCondDims(mod.activateWhen, dims);
                _collectCondDims(mod.hideWhen, dims);
            }
        } else if (slot.kind === 'node') {
            const node = NODE_MAP()[slot.id];
            if (node) {
                _collectCondDims(node.activateWhen, dims);
                _collectCondDims(node.hideWhen, dims);
                for (const e of (node.edges || [])) {
                    _collectCondDims(e.requires, dims);
                    _collectCondDims(e.disabledWhen, dims);
                    // Also include collapseToFlavor effect dims (set /
                    // setFlavor / move) in reads. This is what lets us
                    // distinguish, in the per-edge projection key,
                    // "edge X moved this dim" (UNSET) from "edge Y
                    // didn't touch it" (value carried from start sel).
                    // Without it, dims that are written by SOME edge
                    // but untouched by OTHERS get a UNSET projection
                    // for the untouched-edge case, which the
                    // reconstruction in reachableFullSelsFromInputs
                    // interprets as a deletion — silently dropping
                    // the upstream value. Concretely: inert_stays.no
                    // moves escape_set, but inert_stays.yes leaves it
                    // intact; only by carrying escape_set through the
                    // input bucket does the YES projection capture
                    // the upstream 'yes' as a real value rather than
                    // a spurious UNSET.
                    if (!e.collapseToFlavor) continue;
                    const blocks = Array.isArray(e.collapseToFlavor) ? e.collapseToFlavor : [e.collapseToFlavor];
                    for (const b of blocks) {
                        if (!b) continue;
                        if (b.set) for (const k of Object.keys(b.set)) dims.add(k);
                        if (b.setFlavor) for (const k of Object.keys(b.setFlavor)) dims.add(k);
                        if (Array.isArray(b.move)) for (const k of b.move) dims.add(k);
                        if (b.when) _collectCondDims([b.when], dims);
                    }
                }
            }
        } else if (slot.kind === 'outcome') {
            const t = _getOutcome(slot.id);
            if (t && t.reachable) {
                for (const cond of t.reachable) {
                    if (!cond || typeof cond !== 'object') continue;
                    for (const k of Object.keys(cond)) {
                        if (k === '_not') continue;
                        dims.add(k);
                    }
                    if (cond._not && typeof cond._not === 'object') {
                        for (const k of Object.keys(cond._not)) dims.add(k);
                    }
                }
            }
        }
        // Note: written dims are intentionally NOT evicted here. A module
        // can both read and write the same dim (e.g. ESCAPE reads
        // containment='escaped' as its entry gate and overwrites it on
        // the post_catch=contained exit). Evicting written dims would
        // strip containment from the cart-product columns, force it to
        // UNSET in every row, and silently filter out the entry clause
        // that requires it.
        const out = [...dims].sort();
        _readDimsCache.set(slot.key, out);
        return out;
    }

    // ─── Per-slot entry filter ──────────────────────────────────────
    // Returns an accept(row) predicate that takes a UNSET-aware row and
    // returns true iff the slot's entry conditions match. Returns null
    // if the slot's underlying target can't be resolved (e.g. outcome
    // template not registered yet) — callers should treat that as
    // "no rows pass".
    //
    // Note on UNSET semantics: dims whose row value is UNSET are
    // omitted from `sel` before evaluating conditions, so condition
    // shapes like `{ dim: false }` (dim has no value) and
    // `{ dim: { not: [...], required: true } }` (dim is set, just
    // not these values) work correctly.
    function _entryFilterForSlot(slot) {
        const rowToSel = (row) => {
            const sel = {};
            for (const d of Object.keys(row)) {
                if (row[d] !== UNSET) sel[d] = row[d];
            }
            return sel;
        };
        if (slot.kind === 'outcome') {
            const t = _getOutcome(slot.id);
            if (!t) return null;
            // engine.templateMatches encodes the canonical
            // "this template fires" rule (positive allow-lists per
            // dim + an optional `_not` reject set, ANY cond suffices).
            return (row) => {
                if (!window.Engine || !window.Engine.templateMatches) return false;
                return window.Engine.templateMatches(t, rowToSel(row));
            };
        }
        const target = slot.kind === 'module'
            ? MODULE_MAP()[slot.id]
            : (slot.kind === 'node' ? NODE_MAP()[slot.id] : null);
        if (!target) return null;
        const activateWhen = target.activateWhen || null;
        const hideWhen = target.hideWhen || null;
        return (row) => {
            const sel = rowToSel(row);
            if (activateWhen && activateWhen.length) {
                if (!activateWhen.some(c => matchCondition(sel, c))) return false;
            }
            if (hideWhen && hideWhen.length) {
                if (hideWhen.some(c => matchCondition(sel, c))) return false;
            }
            return true;
        };
    }

    // ─── Cartesian product, filtered by entry conditions ────────────
    // Iterative cart-prod with early-exit on MAX_ROWS so a wide read
    // set doesn't lock the page.
    function cartesianReadRows(slot) {
        if (!slot) return { dims: [], rows: [], truncated: false };
        const cached = _rowsCache.get(slot.key);
        if (cached) return cached;

        const dims = _readDimsForSlot(slot);
        const accept = _entryFilterForSlot(slot);
        if (!accept) {
            const empty = { dims, rows: [], truncated: false };
            _rowsCache.set(slot.key, empty);
            return empty;
        }
        if (!dims.length) {
            // Empty cart-prod is one row (the all-UNSET row); whether
            // it passes is up to the entry filter.
            const r = { dims, rows: accept({}) ? [{}] : [], truncated: false };
            _rowsCache.set(slot.key, r);
            return r;
        }

        // UNSET first, then the dim's literal value space sorted.
        const valuesPerDim = dims.map(d => [UNSET, ...dimDomain(d)]);

        let preFilterTotal = 1;
        for (const vs of valuesPerDim) preFilterTotal *= vs.length;
        const truncated = preFilterTotal > MAX_ROWS;

        const rows = [];
        const idxs = new Array(dims.length).fill(0);
        let iters = 0;
        outer: while (iters < MAX_ROWS) {
            iters++;
            const row = {};
            for (let i = 0; i < dims.length; i++) row[dims[i]] = valuesPerDim[i][idxs[i]];
            if (accept(row)) rows.push(row);
            for (let i = dims.length - 1; i >= 0; i--) {
                idxs[i]++;
                if (idxs[i] < valuesPerDim[i].length) continue outer;
                idxs[i] = 0;
            }
            break;
        }

        const result = { dims, rows, truncated };
        _rowsCache.set(slot.key, result);
        return result;
    }

    // ─── Per-slot write-dim discovery ───────────────────────────────
    // The "write columns" of the slot's table:
    //   * module : declared mod.writes (authoritative — modules pin the
    //              dims they commit to global sel on exit).
    //   * node   : {node.id} ∪ every dim mentioned in the node's edges'
    //              collapseToFlavor.set / setFlavor blocks.
    //   * outcome: none — outcome cards are terminal.
    function _writeDimsForSlot(slot) {
        const cached = _writeDimsCache.get(slot.key);
        if (cached) return cached;
        const dims = new Set();
        if (slot.kind === 'module') {
            const mod = MODULE_MAP()[slot.id];
            if (mod && Array.isArray(mod.writes)) for (const d of mod.writes) dims.add(d);
        } else if (slot.kind === 'node') {
            const node = NODE_MAP()[slot.id];
            if (node) {
                dims.add(node.id);
                for (const e of (node.edges || [])) {
                    if (!e.collapseToFlavor) continue;
                    const blocks = Array.isArray(e.collapseToFlavor) ? e.collapseToFlavor : [e.collapseToFlavor];
                    for (const b of blocks) {
                        if (!b) continue;
                        if (b.set) for (const k of Object.keys(b.set)) dims.add(k);
                        if (b.setFlavor) for (const k of Object.keys(b.setFlavor)) dims.add(k);
                        // `move` dims are deleted from sel by _applyEdgeWrites;
                        // we must include them in the projection so the
                        // deletion is captured (as UNSET in the projKey) and
                        // honored by reachableFullSelsFromInputs's
                        // reconstruction. Otherwise these dims fall into the
                        // pass-through bucket and the upstream sel's value
                        // is silently preserved — e.g. inert_stays.no
                        // (`move: ['ai_goals', 'escape_set']`) would leave
                        // escape_set='yes' in the reconstructed output,
                        // making escape_late look already-completed.
                        if (Array.isArray(b.move)) for (const k of b.move) dims.add(k);
                    }
                }
            }
        }
        const out = [...dims].sort();
        _writeDimsCache.set(slot.key, out);
        return out;
    }

    // ─── Internal DFS through a slot ────────────────────────────────
    // Walks from a single input row to every reachable terminal state,
    // accumulating the projection (write-dims) of each terminal into
    // `outputs` (a Set keyed by stable JSON projection).
    //
    // Module DFS:
    //   At each step, find the highest-priority askable internal node
    //   (priority + askability mirrors engine.findNextQ but scoped to
    //   `mod.nodeIds`). For each enabled edge, build the next sel by:
    //     1. setting sel[node.id] = edge.id
    //     2. applying every collapseToFlavor.{set,setFlavor} block
    //        whose `when` matches the new sel (this includes both the
    //        user-defined intermediate writes AND the auto-installed
    //        exit-tuple set blocks attachModuleReducer pushed in)
    //   Recurse on the new sel. A leaf is reached when no internal
    //   node is askable — counted iff the completionMarker is set.
    //
    // Node DFS:
    //   Single step: enumerate enabled edges, apply edge writes, emit.
    //
    // Both paths share `_applyEdgeWrites`. UNSET-aware sel handling:
    //   inputRow values that are UNSET are dropped from sel; the DFS
    //   then re-introduces them as needed via edge writes.
    //
    // STEP_CAP is the per-slot upper bound on `walk()` invocations. The
    // walk is a full cart-prod DFS over a slot's internal-node edge
    // choices, so the cost grows multiplicatively in the per-node edge
    // count. Most modules are tiny (decel/proliferation/etc. each well
    // under 1k steps), but ESCAPE has 9 internal nodes with edge counts
    // 7×4×4×4×7×3×3×2×3 ≈ 56k paths per input × ~315 read-cart-prod
    // input rows. At 10M the escape walk completes (~1.6s) and lands
    // on its real 61-projection answer; the result is cached in
    // `_writeRowsCache` for the rest of the page. Set high enough that
    // we never display a "+" suffix in practice on the current graph.
    const STEP_CAP = 10000000;

    function _rowToSel(row) {
        const sel = {};
        if (!row) return sel;
        for (const d of Object.keys(row)) if (row[d] !== UNSET) sel[d] = row[d];
        return sel;
    }

    function _selKey(sel) {
        // Stable canonical key for caching DFS results across input rows
        // that project to the same starting sel (cartesianReadRows
        // enumerates UNSET-axis rows, many of which collapse to the
        // same non-UNSET sub-state).
        //
        // Hot path: O(1M) calls in reachableFullSelsFromInputs for
        // escape_late. Pre-sized array + single join produces a flat
        // string in one pass, which V8's Map hashes cheaply. (A naive
        // `+=` concat builds cons strings that get re-flattened on
        // every Map op and ends up SLOWER, despite looking simpler.)
        const keys = Object.keys(sel).sort();
        const parts = new Array(keys.length * 2);
        for (let i = 0; i < keys.length; i++) {
            const k = keys[i];
            parts[i * 2] = k;
            parts[i * 2 + 1] = sel[k];
        }
        return parts.join('\x00');
    }

    function _projectKey(sel, dims) {
        // Stable JSON-array of [dim, value-or-UNSET] pairs. Sorted by
        // construction (dims is sorted) so identical projections compare
        // equal. We keep UNSET as a literal sentinel string so "dim
        // missing" rows are distinct from "dim is the literal string
        // '__GIO_UNSET__'" (impossible in practice, but explicit).
        const parts = [];
        for (const d of dims) {
            const v = sel[d];
            parts.push([d, v === undefined ? UNSET : v]);
        }
        return JSON.stringify(parts);
    }

    function _keyToRow(key) {
        const parts = JSON.parse(key);
        const row = {};
        for (const [d, v] of parts) row[d] = v;
        return row;
    }

    function _applyEdgeWrites(sel, node, edge) {
        // Returns a fresh sel with node.id=edge.id and any matching
        // collapseToFlavor blocks applied. Mirrors engine.commitEdge
        // for the sel-mutation portion:
        //   * `set`  : write dim → value
        //   * `move` : evict dim from sel (it's persisted to flavor
        //              by the runtime — for our projection we just
        //              delete it). Critical for cases like
        //              stall_recovery.mild moving stall_duration to
        //              flavor BEFORE the module exits, so the
        //              singularity → asi sub-path emerges with
        //              stall_duration absent from sel.
        //   * `setFlavor` : flavor-only, never touches sel.
        //
        // Block ordering matters: each block's `when` is evaluated
        // against the running `next`, so a later block can gate on a
        // value an earlier block just `set` (e.g. concentration_type
        // .ai_itself: block 1 sets inert_stays='no'; block 2 — gated
        // on ai_goals=marginal from upstream — evicts ai_goals +
        // escape_set, mirroring inert_stays.no's own block).
        const next = { ...sel, [node.id]: edge.id };
        if (!edge.collapseToFlavor) return next;
        const blocks = Array.isArray(edge.collapseToFlavor) ? edge.collapseToFlavor : [edge.collapseToFlavor];
        for (const b of blocks) {
            if (!b) continue;
            if (b.when && !matchCondition(next, b.when)) continue;
            if (b.set) for (const [k, v] of Object.entries(b.set)) next[k] = v;
            if (Array.isArray(b.move)) for (const k of b.move) delete next[k];
        }
        return next;
    }

    function _findNextInternalNode(mod, sel) {
        const NM = NODE_MAP();
        const nodeIds = mod.nodeIds || [];
        let best = null;
        let bestPri = -Infinity;
        for (const nid of nodeIds) {
            const n = NM[nid];
            if (!n) continue;
            if (sel[n.id] !== undefined) continue;
            if (n.activateWhen && n.activateWhen.length && !n.activateWhen.some(c => matchCondition(sel, c))) continue;
            if (n.hideWhen && n.hideWhen.length && n.hideWhen.some(c => matchCondition(sel, c))) continue;
            if (!n.edges || !n.edges.some(e => !window.Engine.isEdgeDisabled(sel, n, e))) continue;
            const pri = n.priority == null ? 0 : n.priority;
            if (pri > bestPri) { best = n; bestPri = pri; }
        }
        return best;
    }

    function _isModuleDone(mod, sel) {
        // Mirror engine._isModuleDone: completionMarker can be a bare
        // dim name ("any value present"), an object { dim, values }
        // (membership-tested), or absent (treat as "never internally
        // done" — DFS still terminates when no node is askable).
        const m = mod.completionMarker;
        if (!m) return true;
        if (typeof m === 'string') return sel[m] != null;
        if (typeof m === 'object' && m.dim) {
            const v = sel[m.dim];
            if (v == null) return false;
            if (Array.isArray(m.values)) return m.values.includes(v);
            return true;
        }
        return true;
    }

    function _dfsModuleOutputs(mod, startSel, outputs, ctx) {
        const writes = mod.writes || [];

        function walk(sel) {
            if (ctx.steps++ > STEP_CAP) { ctx.truncated = true; return; }
            if (outputs.size > MAX_ROWS) { ctx.truncated = true; return; }
            // Done-check FIRST — once the completion marker has fired,
            // the runtime engine stops asking the module's internal
            // nodes, and so should we. Without this guard, the auto-
            // installed exit-tuple `move` list (nodeIds \ writes) can
            // evict the action node's own answer dim from sel,
            // re-enabling it through `_findNextInternalNode` and
            // looping back through every internal pick — stack-blow on
            // any module whose action node is in the move list (decel,
            // who_benefits, etc.).
            if (_isModuleDone(mod, sel)) {
                outputs.add(_projectKey(sel, writes));
                return;
            }
            const node = _findNextInternalNode(mod, sel);
            // No askable internal AND not done = dead-end branch
            // (e.g. cart-prod input row that smuggled in a half-set
            // intermediate state). Discard silently.
            if (!node) return;
            for (const edge of node.edges) {
                if (window.Engine.isEdgeDisabled(sel, node, edge)) continue;
                walk(_applyEdgeWrites(sel, node, edge));
                if (ctx.truncated) return;
            }
        }

        walk(startSel);
    }

    function _dfsNodeOutputs(node, startSel, dims, outputs, ctx) {
        for (const edge of (node.edges || [])) {
            if (ctx.steps++ > STEP_CAP) { ctx.truncated = true; return; }
            if (window.Engine.isEdgeDisabled(startSel, node, edge)) continue;
            const next = _applyEdgeWrites(startSel, node, edge);
            outputs.add(_projectKey(next, dims));
            if (outputs.size > MAX_ROWS) { ctx.truncated = true; return; }
        }
    }

    // ─── Cross-refresh persistence (localStorage) ───────────────────
    // Fingerprint = JSON of the module + every node it owns + a version
    // tag. If any of these change the cached result is discarded. We
    // intentionally do NOT include outcome templates / dimDomains:
    // outputs of a single module's DFS only depend on that module's
    // structure (nodeIds, edges, completionMarker, exitPlan-installed
    // collapseToFlavor blocks) plus the engine semantics, not on the
    // wider graph.
    function _persistFingerprint(slot) {
        if (slot.kind !== 'module') return null;
        const mod = MODULE_MAP()[slot.id];
        if (!mod) return null;
        const NM = NODE_MAP();
        const nodes = (mod.nodeIds || []).map(nid => NM[nid] || null);
        try {
            return JSON.stringify({ v: PERSIST_VERSION, mod, nodes });
        } catch (_e) { return null; }
    }

    function _persistKeyFor(slot) {
        return PERSIST_KEY_PREFIX + slot.id + ':v' + PERSIST_VERSION;
    }

    function _persistedRead(slot) {
        if (typeof localStorage === 'undefined') return null;
        if (!slot || slot.kind !== 'module') return null;
        try {
            const raw = localStorage.getItem(_persistKeyFor(slot));
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            if (!parsed || !parsed.result) return null;
            const fp = _persistFingerprint(slot);
            if (!fp || parsed.fingerprint !== fp) return null;
            // byInput is a Map<string, Set<string>> serialized as
            // [[k, [...]], ...]. Rehydrate so callers (e.g. the badge
            // reachability lookup) can use it without recomputing.
            const r = parsed.result;
            const byInput = new Map();
            if (Array.isArray(r.byInput)) {
                for (const [k, vs] of r.byInput) {
                    byInput.set(k, new Set(Array.isArray(vs) ? vs : []));
                }
            }
            return { dims: r.dims || [], rows: r.rows || [], truncated: !!r.truncated, byInput };
        } catch (_e) { return null; }
    }

    function _persistedWrite(slot, result) {
        if (typeof localStorage === 'undefined') return;
        if (!slot || slot.kind !== 'module') return;
        // Don't persist truncated runs — a future refresh might be
        // able to complete the walk (config tweaks, etc.) and we'd
        // rather recompute than serve a known-incomplete answer.
        if (result && result.truncated) return;
        try {
            const fp = _persistFingerprint(slot);
            if (!fp) return;
            const byInputArr = [];
            if (result && result.byInput instanceof Map) {
                for (const [k, set] of result.byInput) byInputArr.push([k, [...set]]);
            }
            const serialized = {
                dims: result.dims || [],
                rows: result.rows || [],
                truncated: !!result.truncated,
                byInput: byInputArr,
            };
            localStorage.setItem(_persistKeyFor(slot),
                JSON.stringify({ fingerprint: fp, result: serialized }));
        } catch (_e) { /* quota / disabled — accept the slow refresh */ }
    }

    function cartesianWriteRows(slot) {
        if (!slot) return { dims: [], rows: [], truncated: false };
        const cached = _writeRowsCache.get(slot.key);
        if (cached) return cached;

        // Cross-refresh cache hit — promote to in-memory cache so
        // sibling slot.keys with the same module id (escape_early,
        // escape_early_alt, escape_late) all reuse the read.
        const persisted = _persistedRead(slot);
        if (persisted) {
            _writeRowsCache.set(slot.key, persisted);
            return persisted;
        }

        const dims = _writeDimsForSlot(slot);

        // Outcomes are terminal — no DFS, no output rows.
        if (slot.kind === 'outcome') {
            const r = { dims, rows: [], truncated: false };
            _writeRowsCache.set(slot.key, r);
            return r;
        }
        // Engine isn't loaded yet (e.g. graph-io.js called pre-IIFE) —
        // bail with empty output. Caller should retry once Engine is up.
        if (!window.Engine || !window.Engine.isEdgeDisabled || !window.Engine.matchCondition) {
            return { dims, rows: [], truncated: false };
        }

        const inputResult = cartesianReadRows(slot);
        if (!inputResult || !inputResult.rows.length) {
            const r = { dims, rows: [], truncated: !!(inputResult && inputResult.truncated) };
            _writeRowsCache.set(slot.key, r);
            return r;
        }

        const outputs = new Set();
        // Per-input mapping: `_selKey` of the read-projected starting
        // sel → set of output projection keys produced from that sel.
        // Lets reachability lookups (`reachableCountsFromInputs`) skip
        // the DFS — when a slot's `reads` lists every internally-used
        // dim (the convention for module.reads), projecting any
        // upstream sel onto slot.reads gives an identical DFS result
        // to running from the full upstream sel.
        const byInput = new Map();
        const ctx = { steps: 0, truncated: !!inputResult.truncated };
        // Different cartesianReadRows rows that project to the same
        // non-UNSET sel produce identical DFS results. Hash dedup
        // before walking to avoid pathological re-walks (mostly a
        // win on slots with few read dims; large read sets rarely
        // overlap after UNSET-axis enumeration).
        const walkInput = (selSource, walk) => {
            for (const row of inputResult.rows) {
                const sel = _rowToSel(row);
                const k = _selKey(sel);
                if (byInput.has(k)) continue;
                const perInput = new Set();
                walk(sel, perInput);
                byInput.set(k, perInput);
                for (const o of perInput) outputs.add(o);
                if (ctx.truncated) break;
            }
        };

        if (slot.kind === 'module') {
            const mod = MODULE_MAP()[slot.id];
            if (!mod) {
                const r = { dims, rows: [], truncated: ctx.truncated, byInput };
                _writeRowsCache.set(slot.key, r);
                return r;
            }
            walkInput('module', (sel, set) => _dfsModuleOutputs(mod, sel, set, ctx));
        } else if (slot.kind === 'node') {
            const node = NODE_MAP()[slot.id];
            if (!node) {
                const r = { dims, rows: [], truncated: ctx.truncated, byInput };
                _writeRowsCache.set(slot.key, r);
                return r;
            }
            walkInput('node', (sel, set) => _dfsNodeOutputs(node, sel, dims, set, ctx));
        }

        const rows = [];
        for (const k of outputs) rows.push(_keyToRow(k));
        const result = { dims, rows, truncated: ctx.truncated, byInput };
        _writeRowsCache.set(slot.key, result);
        _persistedWrite(slot, result);
        return result;
    }

    // ─── Reachability from a known set of upstream sels ─────────────
    // Given a slot and an array of upstream sels (full sel objects),
    // return how many of those inputs the slot accepts and how many
    // distinct write-projection outputs they produce. Powers the
    // "(N x M) | (N' x M')" badge:
    //   N' = reachableInputs  — distinct read-projections of accepted
    //                            upstream sels (matches how the slot's
    //                            own input table dedupes)
    //   M' = reachableOutputs — union of outputs the slot's table
    //                            already records for those inputs
    //
    // No DFS at reach-time: we look up `cartesianWriteRows.byInput`,
    // which the standalone DFS already populated. This relies on the
    // convention that `module.reads` lists every dim the module's
    // internal walk references — projecting onto slot.reads then
    // throws away nothing the DFS would have used.
    function _slotAccepts(slot, sel) {
        if (!slot) return false;
        if (slot.kind === 'outcome') {
            const t = _getOutcome(slot.id);
            if (!t) return false;
            if (!window.Engine || !window.Engine.templateMatches) return false;
            return window.Engine.templateMatches(t, sel);
        }
        const target = slot.kind === 'module'
            ? MODULE_MAP()[slot.id]
            : (slot.kind === 'node' ? NODE_MAP()[slot.id] : null);
        if (!target) return false;
        const aw = target.activateWhen, hw = target.hideWhen;
        if (aw && aw.length && !aw.some(c => matchCondition(sel, c))) return false;
        if (hw && hw.length && hw.some(c => matchCondition(sel, c))) return false;
        return true;
    }

    // Restriction of `sel` to dims listed in `reads`, dropping any
    // dim absent in sel — matches how `cartesianWriteRows` keys its
    // `byInput` map (`_selKey(_rowToSel(row))`, which strips UNSET).
    function _readSelKey(sel, reads) {
        const restricted = {};
        for (const d of reads) {
            if (sel[d] !== undefined) restricted[d] = sel[d];
        }
        return _selKey(restricted);
    }

    function reachableCountsFromInputs(slot, inputSels) {
        const empty = { reachableInputs: 0, reachableOutputs: 0, truncated: false };
        if (!slot || !Array.isArray(inputSels)) return empty;
        if (slot.kind === 'deadend') return empty;
        if (!window.Engine || !window.Engine.matchCondition) return empty;

        const reads = _readDimsForSlot(slot);
        const inputProjs = new Set();
        const acceptedKeys = [];
        for (const sel of inputSels) {
            if (!sel || typeof sel !== 'object') continue;
            if (!_slotAccepts(slot, sel)) continue;
            const k = _readSelKey(sel, reads);
            if (!inputProjs.has(k)) {
                inputProjs.add(k);
                acceptedKeys.push(k);
            }
        }

        if (slot.kind === 'outcome') {
            return { reachableInputs: inputProjs.size, reachableOutputs: 0, truncated: false };
        }

        // Drive cartesianWriteRows for its byInput side-table. The
        // call is cached after the first hit, so this is free on
        // subsequent reach lookups for the same slot.
        const writeResult = cartesianWriteRows(slot);
        const byInput = (writeResult && writeResult.byInput instanceof Map)
            ? writeResult.byInput
            : null;

        const outputProjs = new Set();
        let truncated = !!(writeResult && writeResult.truncated);
        if (byInput) {
            for (const k of acceptedKeys) {
                const outs = byInput.get(k);
                if (!outs) continue; // upstream sel matched activateWhen but
                                     // no DFS row exists — shouldn't happen
                                     // in practice (same gate filters both),
                                     // but be defensive.
                for (const o of outs) outputProjs.add(o);
            }
        }
        return {
            reachableInputs: inputProjs.size,
            reachableOutputs: outputProjs.size,
            truncated,
        };
    }

    // ─── Full-sel reachability (companion to the bucket counts) ─────
    // Returns the actual distinct full sels that flow through the
    // slot — which can exceed the bucket counts because:
    //   * upstream sels carry pass-through dims (not in slot.reads)
    //     that distinguish them as full sels but collapse on the
    //     slot's input bucket;
    //   * different exit paths can `move` (UNSET-mark) dims that the
    //     upstream sel still has set, so two upstream sels in the
    //     same input bucket can produce different post-exit sels (or
    //     two different upstream sels can converge to the same one).
    //
    // Pure table lookup: no DFS at call time. We just merge each
    // upstream sel with each of its byInput output projections —
    // UNSET in the projection means "this dim was moved to flavor",
    // so we drop it from the merged sel.
    //
    // The returned `acceptedInputs` / `outputs` arrays are full sel
    // OBJECTS (not keys), deduped by `_selKey`. They're the canonical
    // shape to feed back into another reachability call for chained
    // propagation through the DAG.
    function reachableFullSelsFromInputs(slot, inputSels) {
        const empty = { acceptedInputs: [], outputs: [], truncated: false };
        if (!slot || !Array.isArray(inputSels)) return empty;
        if (slot.kind === 'deadend') return empty;
        if (!window.Engine || !window.Engine.matchCondition) return empty;

        const reads = _readDimsForSlot(slot);

        // Dedupe upstream sels as FULL sels. Two upstream sels with
        // identical _selKey collapse here; sels that differ on any
        // dim (including pass-through ones the slot doesn't read)
        // stay distinct.
        const acceptedByKey = new Map();
        for (const sel of inputSels) {
            if (!sel || typeof sel !== 'object') continue;
            if (!_slotAccepts(slot, sel)) continue;
            const k = _selKey(sel);
            if (!acceptedByKey.has(k)) acceptedByKey.set(k, sel);
        }

        if (slot.kind === 'outcome') {
            return {
                acceptedInputs: [...acceptedByKey.values()],
                outputs: [],
                truncated: false,
            };
        }

        const writeResult = cartesianWriteRows(slot);
        const byInput = (writeResult && writeResult.byInput instanceof Map)
            ? writeResult.byInput
            : null;
        const truncated = !!(writeResult && writeResult.truncated);

        // ─── Bucket-grouped merge ─────────────────────────────────────
        // The naive shape is "for each input × each projKey: merge +
        // dedup". For escape_late that's ~1.26M iterations; per-merge
        // we'd be spreading the full input sel, applying writes, and
        // computing _selKey on the result.
        //
        // We can hoist most of that out of the inner loop:
        //
        //   1. The slot has fixed `reads` (input bucket dims) and
        //      fixed `writes` (output projection dims). Any input dim
        //      that is neither read nor written is a PASS-THROUGH dim
        //      — preserved unchanged in the merged output.
        //   2. Two inputs in the same bucket that also share their
        //      pass-through values produce IDENTICAL merged outputs
        //      for every projKey. Group inputs by (bucketKey, ptKey)
        //      and only walk the projKeys once per group. This step
        //      is exactly what eliminates the ~18% dedup we used to
        //      pay for at the end (e.g. 1.26M merges → 1.04M outputs
        //      on escape_late).
        //   3. For each (bucket, projKey) pair the "fixed prefix" of
        //      the merged sel — read-dim values overridden by writes,
        //      plus write-only dims set/deleted by writes — is the
        //      same for every group. Precompute it once.
        //   4. The merged-sel CANONICAL KEY is the sorted concat of
        //      (fixedParts, ptParts). Both halves are individually
        //      sorted with disjoint dim sets, so we can produce the
        //      key via a linear merge — no Object.keys + sort pass
        //      per merged sel.
        //   5. Build the merged sel OBJECT only on dedup miss.
        //
        // Together these turn a 1.26M × O(dim×log(dim)) loop into a
        // ~50K × O(dim) loop — the dominant cost on escape_late.
        const outByKey = new Map();
        if (byInput) {
            const writeDims = (writeResult && Array.isArray(writeResult.dims))
                ? writeResult.dims
                : [];
            const readSet = new Set(reads);
            const writeSet = new Set(writeDims);

            // Group inputs by (bucketKey, ptKey). Also pick a
            // representative restricted-bucket sel per bucketKey to
            // seed fixed-prefix computation below.
            const groups = new Map();        // gk → { bk, ptSel, ptParts }
            const repBucketSel = new Map();  // bk → sel restricted to readDims
            for (const sel of acceptedByKey.values()) {
                const bk = _readSelKey(sel, reads);
                if (!byInput.has(bk)) continue;

                if (!repBucketSel.has(bk)) {
                    const bs = {};
                    for (const d of Object.keys(sel)) {
                        if (readSet.has(d)) bs[d] = sel[d];
                    }
                    repBucketSel.set(bk, bs);
                }

                const ptDims = [];
                for (const d of Object.keys(sel)) {
                    if (!readSet.has(d) && !writeSet.has(d)) ptDims.push(d);
                }
                ptDims.sort();
                const ptParts = new Array(ptDims.length * 2);
                for (let i = 0; i < ptDims.length; i++) {
                    ptParts[i * 2] = ptDims[i];
                    ptParts[i * 2 + 1] = sel[ptDims[i]];
                }
                const ptKey = ptParts.join('\x00');
                const gk = bk + '\x02' + ptKey;
                if (!groups.has(gk)) {
                    const ptSel = {};
                    for (const d of ptDims) ptSel[d] = sel[d];
                    groups.set(gk, { bk, ptSel, ptParts });
                }
            }

            // For each (bucket, projKey) precompute fixedSel (the
            // post-write sel restricted to read+write dims) and a
            // sorted parts array for fast key-merging.
            // fixedByBucket: Map<bucketKey, Array<{ projSet entries → fp }>>
            // — implemented as a nested Map<bucketKey, Map<projKey, fp>>
            // so the inner loop avoids string concatenation just to
            // index into the cache.
            const fixedByBucket = new Map();
            for (const [bk, projSet] of byInput) {
                const bucketSel = repBucketSel.get(bk);
                if (!bucketSel) continue; // bucket has no live upstream
                const inner = new Map();
                fixedByBucket.set(bk, inner);
                for (const ok of projSet) {
                    const fixedSel = {};
                    for (const d of Object.keys(bucketSel)) fixedSel[d] = bucketSel[d];
                    const writes = JSON.parse(ok);
                    for (const [d, v] of writes) {
                        if (v === UNSET) delete fixedSel[d];
                        else fixedSel[d] = v;
                    }
                    const dims = Object.keys(fixedSel).sort();
                    const fixedParts = new Array(dims.length * 2);
                    for (let i = 0; i < dims.length; i++) {
                        const d = dims[i];
                        fixedParts[i * 2] = d;
                        fixedParts[i * 2 + 1] = fixedSel[d];
                    }
                    inner.set(ok, { fixedSel, fixedParts });
                }
            }

            // Inner loop: emit merged sels. Linear merge of two
            // pre-sorted halves yields the canonical mergedKey
            // directly. Build the merged sel object only on miss.
            for (const { bk, ptSel, ptParts } of groups.values()) {
                const inner = fixedByBucket.get(bk);
                if (!inner) continue;
                const plen = ptParts.length;
                for (const fp of inner.values()) {
                    const fixedParts = fp.fixedParts;
                    const flen = fixedParts.length;
                    let i = 0, j = 0, m = 0;
                    const out = new Array(flen + plen);
                    while (i < flen && j < plen) {
                        if (fixedParts[i] < ptParts[j]) {
                            out[m++] = fixedParts[i];
                            out[m++] = fixedParts[i + 1];
                            i += 2;
                        } else {
                            out[m++] = ptParts[j];
                            out[m++] = ptParts[j + 1];
                            j += 2;
                        }
                    }
                    while (i < flen) {
                        out[m++] = fixedParts[i];
                        out[m++] = fixedParts[i + 1];
                        i += 2;
                    }
                    while (j < plen) {
                        out[m++] = ptParts[j];
                        out[m++] = ptParts[j + 1];
                        j += 2;
                    }
                    const mk = out.join('\x00');
                    if (!outByKey.has(mk)) {
                        outByKey.set(mk, { ...fp.fixedSel, ...ptSel });
                    }
                }
            }
        }

        return {
            acceptedInputs: [...acceptedByKey.values()],
            outputs: [...outByKey.values()],
            truncated,
        };
    }

    window.GraphIO = {
        UNSET,
        dimDomain,
        cartesianReadRows,
        cartesianWriteRows,
        reachableCountsFromInputs,
        reachableFullSelsFromInputs,
        registerOutcomes,
        matchOutcomes,
    };
})();
