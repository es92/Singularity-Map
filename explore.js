// /explore — narrative-flow card layout.
//
// Renders the same FLOW_DAG used by /nodes flow mode, but each card is
// the explore-focused summary of a slot: its reads, its writes, its
// "moves to flavor" set (sel→flavor evictions on exit, only shown when
// non-empty), the outcomes that can fire at that slot, and a
// (currently disabled) "Step through" affordance. Layout, edge
// drawing, and pan/zoom mirror nodes.js's flow canvas so the two views
// feel like the same map.

(function () {
    'use strict';

    // ─── CSS ─────────────────────────────────────────────────────────
    const CSS = `
        #explore-root {
            position: fixed; inset: 0;
            background: var(--bg); color: var(--text);
            overflow: hidden; font-family: inherit;
            display: flex; flex-direction: column;
        }
        #explore-root .ex-head {
            padding: 10px 14px; border-bottom: 1px solid var(--border);
            display: flex; gap: 12px; align-items: center; flex: 0 0 auto;
            background: var(--bg-soft);
        }
        #explore-root .ex-head a {
            color: var(--text-muted); text-decoration: none; font-size: 12px;
        }
        #explore-root .ex-head a:hover { color: var(--text); }
        #explore-root .ex-head-title {
            font-weight: 600; font-size: 13px;
        }
        #explore-root .ex-head-spacer { flex: 1; }
        #explore-root .ex-toolbtn {
            background: var(--bg); color: var(--text-muted);
            border: 1px solid var(--border); border-radius: 4px;
            padding: 3px 8px; cursor: pointer;
            font-family: inherit; font-size: 11px; line-height: 1.5;
        }
        #explore-root .ex-toolbtn:hover { color: var(--text); }

        /* Body row: canvas (flex) + draggable divider + sidebar. */
        #explore-root .ex-body {
            flex: 1; display: flex; flex-direction: row;
            min-height: 0;
        }
        #explore-root .ex-divider {
            flex: 0 0 5px; width: 5px;
            background: var(--border);
            cursor: col-resize;
            position: relative;
            transition: background 120ms ease;
        }
        #explore-root .ex-divider:hover,
        #explore-root .ex-divider.is-dragging {
            background: var(--text-muted);
        }
        /* Wider invisible hit-area so the 5px bar is easy to grab. */
        #explore-root .ex-divider::before {
            content: ''; position: absolute;
            top: 0; bottom: 0; left: -4px; right: -4px;
        }
        #explore-root.is-resizing,
        #explore-root.is-resizing * {
            cursor: col-resize !important;
            user-select: none !important;
        }

        /* Pannable / zoomable canvas. */
        #explore-root .ex-canvas {
            position: relative; flex: 1;
            overflow: hidden; background: var(--bg);
            cursor: grab; user-select: none;
        }
        #explore-root .ex-canvas.dragging { cursor: grabbing; }
        #explore-root .ex-viewport {
            position: absolute; top: 0; left: 0;
            transform-origin: 0 0; will-change: transform;
            padding: 24px;
        }
        #explore-root .ex-flow {
            display: flex; gap: 72px; align-items: flex-start;
            position: relative;
        }
        #explore-root .ex-col {
            flex: 0 0 auto; width: 280px;
            display: flex; flex-direction: column; gap: 28px;
            position: relative;
        }
        #explore-root svg.ex-edges {
            position: absolute; top: 0; left: 0;
            pointer-events: none; overflow: visible;
            color: var(--text-muted); z-index: 0;
        }
        #explore-root svg.ex-edges path {
            fill: none; stroke: currentColor; stroke-width: 1.4;
            opacity: 0.18;
        }

        /* ─── Card ─────────────────────────────────────────────── */
        /* Cards use a 90% white fill so arrows pass visually behind
         * them instead of through them. z-index keeps them above the
         * SVG layer; the near-opaque background does the obscuring. */
        #explore-root .ex-card {
            border: 1px solid var(--border); border-radius: 6px;
            background: rgba(255, 255, 255, 0.9);
            position: relative; z-index: 1;
            display: flex; flex-direction: column;
        }
        #explore-root .ex-card.is-module {
            border-color: rgba(107,155,209,0.45);
        }
        #explore-root .ex-card-head {
            padding: 9px 11px 7px;
            border-bottom: 1px solid var(--border);
        }
        #explore-root .ex-card-row {
            display: flex; align-items: baseline; gap: 6px; flex-wrap: wrap;
        }
        #explore-root .ex-card-id {
            font-family: ui-monospace, monospace; font-weight: 600;
            font-size: 12px; color: var(--text);
        }
        #explore-root .ex-card-kind {
            font-size: 8px; color: var(--text-muted);
            text-transform: uppercase; letter-spacing: 0.08em;
        }
        #explore-root .ex-card-tablesize {
            font-family: ui-monospace, monospace;
            font-size: 9px; color: var(--text-muted);
            margin-left: auto;
        }
        #explore-root .ex-card-note {
            font-size: 9px; color: var(--text-muted); font-style: italic;
            margin-top: 3px;
        }
        #explore-root .ex-card-label {
            font-size: 10px; color: var(--text-muted);
            margin-top: 3px; line-height: 1.3;
        }

        /* ─── Reads / Writes / Outcomes blocks ─────────────────── */
        #explore-root .ex-block {
            padding: 7px 11px;
            border-top: 1px dashed var(--border);
        }
        #explore-root .ex-block:first-of-type {
            border-top: none;
        }
        #explore-root .ex-block-head {
            font-size: 8px; color: var(--text-muted);
            text-transform: uppercase; letter-spacing: 0.08em;
            font-weight: 600; margin-bottom: 4px;
        }
        #explore-root .ex-dimlist {
            display: flex; flex-wrap: wrap; gap: 3px 4px;
        }
        #explore-root .ex-dim {
            font-family: ui-monospace, monospace; font-size: 10px;
            color: var(--text); background: var(--bg);
            border: 1px solid var(--border); border-radius: 3px;
            padding: 1px 5px;
        }
        #explore-root .ex-empty {
            font-size: 10px; color: var(--text-muted); font-style: italic;
        }

        /* ─── Outcome / dead-end terminal cards (far-right column) ──
         * Same 90%-white fill as the base card; tint lives in the
         * border + header text so arrows still get obscured. */
        #explore-root .ex-card.is-outcome {
            border-color: rgba(179,137,94,0.45);
        }
        #explore-root .ex-card.is-outcome .ex-card-head {
            border-bottom-color: rgba(179,137,94,0.25);
        }
        #explore-root .ex-card.is-outcome .ex-card-id { color: #c9a473; }
        #explore-root .ex-card.is-outcome .ex-card-kind { color: #b3895e; }

        #explore-root .ex-card.is-deadend {
            border-color: rgba(199,106,106,0.45);
        }
        #explore-root .ex-card.is-deadend .ex-card-head {
            border-bottom-color: rgba(199,106,106,0.25);
        }
        #explore-root .ex-card.is-deadend .ex-card-id { color: #d28a8a; }
        #explore-root .ex-card.is-deadend .ex-card-kind { color: #c76a6a; }

        #explore-root .ex-card-summary {
            padding: 8px 11px; font-size: 11px; line-height: 1.4;
            color: var(--text-muted);
        }

        /* Edge styling: dashed for placement-only edges (rightmost →
         * dead-end / unrelated outcomes). */
        #explore-root svg.ex-edges path.is-placement {
            stroke-dasharray: 3 4;
        }
        #explore-root svg.ex-edges path.is-outcome-link {
            color: #b3895e;
        }
        #explore-root svg.ex-edges path.is-deadend-link {
            color: #c76a6a;
        }
        /* Solid red flow edge for slots whose continuing outputs no
         * child accepts. Distinct from is-deadend-link (the dashed
         * layout-only placement edge) — this one carries real flow. */
        #explore-root svg.ex-edges path.is-flow-deadend {
            color: #c54545;
            stroke-width: 1.6;
            opacity: 0.85;
        }
        /* Dead-end badge (count of dead-end sels). Reuses the table-
         * size pill but tinted red so it pops against the regular
         * reach counters. */
        #explore-root .ex-card-tablesize.ex-card-dead {
            color: #c54545;
            border-color: rgba(197,69,69,0.45);
        }
        #explore-root .ex-card-dead {
            color: #c54545;
            font-weight: 600;
        }
        /* Output-state arrows (test, currently emergence-only). One
         * arrow per row of cartesianWriteRows; opacity bumped so the
         * fan-out reads cleanly. */
        #explore-root svg.ex-edges path.is-output-state {
            stroke: #6b9bd1;
            stroke-width: 1.4;
            opacity: 0.8;
        }

        /* ─── Step-through footer ──────────────────────────────── */
        #explore-root .ex-foot {
            padding: 8px 11px;
            border-top: 1px solid var(--border);
            display: flex; justify-content: flex-end;
        }
        #explore-root .ex-step-btn {
            background: var(--bg); color: var(--text-muted);
            border: 1px solid var(--border); border-radius: 4px;
            padding: 4px 10px; font-size: 10px;
            font-family: inherit; cursor: not-allowed;
            opacity: 0.55;
        }
        #explore-root .ex-step-btn:disabled {
            cursor: not-allowed;
        }

        /* Cursor hint that cards are clickable. */
        #explore-root .ex-card { cursor: pointer; }
        #explore-root .ex-card.is-selected {
            outline: 2px solid var(--text);
            outline-offset: 1px;
            background: rgba(255, 255, 255, 1);
        }

        /* ─── Sidebar ─────────────────────────────────────────────── */
        #explore-root .ex-sidebar {
            flex: 0 0 320px; width: 320px;
            border-left: 1px solid var(--border);
            background: var(--bg-soft);
            overflow-y: auto;
            display: flex; flex-direction: column;
        }
        #explore-root .ex-sb-empty {
            padding: 18px 16px; color: var(--text-muted);
            font-size: 12px; line-height: 1.5;
        }
        #explore-root .ex-sb {
            padding: 14px 16px;
            display: flex; flex-direction: column; gap: 14px;
        }
        #explore-root .ex-sb-head {
            display: flex; flex-direction: column; gap: 4px;
        }
        #explore-root .ex-sb-id {
            font-family: ui-monospace, monospace; font-weight: 600;
            font-size: 16px; color: var(--text);
        }
        #explore-root .ex-sb-kind {
            font-size: 9px; color: var(--text-muted);
            text-transform: uppercase; letter-spacing: 0.1em;
        }
        #explore-root .ex-sb-title {
            font-size: 14px; color: var(--text); font-weight: 600;
            margin-top: 2px;
        }
        #explore-root .ex-sb-label {
            font-size: 12px; color: var(--text);
            line-height: 1.4;
        }
        #explore-root .ex-sb-note {
            font-size: 11px; color: var(--text-muted);
            font-style: italic; line-height: 1.4;
        }
        #explore-root .ex-sb-section {
            display: flex; flex-direction: column; gap: 6px;
        }
        #explore-root .ex-sb-section-head {
            font-size: 9px; color: var(--text-muted);
            text-transform: uppercase; letter-spacing: 0.1em;
            font-weight: 600;
        }
        #explore-root .ex-sb-section-body {
            font-size: 12px; color: var(--text); line-height: 1.5;
        }
        #explore-root .ex-sb-dimlist {
            display: flex; flex-wrap: wrap; gap: 4px;
        }
        #explore-root .ex-sb-dim {
            font-family: ui-monospace, monospace; font-size: 11px;
            color: var(--text); background: var(--bg);
            border: 1px solid var(--border); border-radius: 3px;
            padding: 1px 6px;
        }
        #explore-root .ex-sb-empty-mini {
            font-size: 11px; color: var(--text-muted); font-style: italic;
        }
        #explore-root .ex-sb-variants {
            display: flex; flex-direction: column; gap: 8px;
        }
        #explore-root .ex-sb-variant {
            border: 1px solid var(--border); border-radius: 4px;
            padding: 7px 9px;
            background: var(--bg);
        }
        #explore-root .ex-sb-variant-head {
            display: flex; align-items: baseline; gap: 6px;
            margin-bottom: 2px;
        }
        #explore-root .ex-sb-variant-key {
            font-family: ui-monospace, monospace; font-size: 11px;
            color: var(--text-muted);
        }
        #explore-root .ex-sb-variant-subtitle {
            font-size: 12px; color: var(--text); font-weight: 600;
        }
        #explore-root .ex-sb-variant-mood {
            font-size: 9px; color: var(--text-muted);
            text-transform: uppercase; letter-spacing: 0.08em;
            margin-left: auto;
        }
        #explore-root .ex-sb-variant-summary {
            font-size: 11px; color: var(--text-muted); line-height: 1.45;
        }

        /* Cart-prod-of-reads table: monospace, dense, horizontally
         * scrollable so wide read-sets don't crush the column headers. */
        #explore-root .ex-sb-iotable-wrap {
            overflow-x: auto;
            border: 1px solid var(--border);
            border-radius: 4px;
            background: var(--bg);
        }
        #explore-root .ex-sb-iotable {
            border-collapse: collapse;
            font-family: ui-monospace, monospace;
            font-size: 10px;
            width: max-content;
            min-width: 100%;
        }
        #explore-root .ex-sb-iotable th,
        #explore-root .ex-sb-iotable td {
            border-right: 1px solid var(--border);
            border-bottom: 1px solid var(--border);
            padding: 3px 6px;
            text-align: left;
            white-space: nowrap;
            max-width: 160px;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        #explore-root .ex-sb-iotable th:last-child,
        #explore-root .ex-sb-iotable td:last-child { border-right: none; }
        #explore-root .ex-sb-iotable tr:last-child td { border-bottom: none; }
        #explore-root .ex-sb-iotable thead th {
            background: var(--bg-soft);
            color: var(--text-muted);
            font-weight: 600;
            font-size: 9px;
            text-transform: uppercase;
            letter-spacing: 0.06em;
            position: sticky; top: 0;
        }
        #explore-root .ex-sb-iotable .ex-sb-unset {
            color: var(--text-muted); font-style: italic;
        }
        #explore-root .ex-sb-iotable-meta {
            font-size: 10px; color: var(--text-muted);
            margin-top: 4px;
        }
    `;

    let cssInjected = false;
    function injectCss() {
        if (cssInjected) return;
        cssInjected = true;
        const s = document.createElement('style');
        s.textContent = CSS;
        document.head.appendChild(s);
    }

    // ─── Data loading (outcomes.json — for outcome titles) ──────────
    let templates = [];
    let loadedData = false;
    async function ensureLoaded() {
        if (loadedData) return;
        const bust = '?v=' + Date.now();
        const o = await fetch('data/outcomes.json' + bust).then(r => r.json());
        templates = o.templates || [];
        // Hand the templates to GraphIO so outcome slots can be analyzed
        // (read dims pulled from t.reachable, entry filter is
        // engine.templateMatches). Safe to call repeatedly.
        if (window.GraphIO) window.GraphIO.registerOutcomes(templates);
        loadedData = true;
    }

    // ─── Reads / writes / moves-to-flavor derivation for non-module nodes
    // Modules expose `reads` / `writes` directly. Flat nodes don't, so
    // we walk the same condition / edge structures the engine and the
    // contract tests (tests/module_reads_complete.js,
    // tests/post_write_dim_usage.js) do. Three disjoint(ish) categories:
    //   * reads  — strict gate-read set (activateWhen, hideWhen,
    //              disabledWhen, edge.requires, and
    //              effects.when conditions).
    //   * writes — dims this slot leaves in sel post-edge: the node's
    //              own pick (unless that pick is also moved out), plus
    //              every effects.set key that ISN'T also in a
    //              move list (set+move on the same dim = the value was
    //              committed to sel mid-tick then evicted to flavor on
    //              the same edge — engine ordering is set→setFlavor→
    //              move per applyEdgeEffects).
    //   * moves to flavor — dims evicted from sel into flavor: every
    //              effects.move entry plus every
    //              effects.setFlavor key. These are the dims
    //              this slot stops carrying in sel.
    const STRUCT_KEYS = new Set([
        'reason', '_ck', '_ct', '_cv', '_direct', 'required', 'not',
        'match', 'value', 'valueMap', 'if', 'text', '_default', '_when',
        'set', 'move', 'when', 'setFlavor',
    ]);

    function refsFromCondition(cond, out) {
        if (!cond || typeof cond !== 'object') return;
        for (const [k, v] of Object.entries(cond)) {
            if (k === 'reason' || k.startsWith('_')) {
                if (k === '_not' && v && typeof v === 'object') {
                    const entries = Array.isArray(v) ? v : [v];
                    for (const entry of entries) {
                        if (entry && typeof entry === 'object') {
                            for (const nk of Object.keys(entry)) {
                                if (!STRUCT_KEYS.has(nk)) out.add(nk);
                            }
                        }
                    }
                }
                continue;
            }
            out.add(k);
        }
    }

    function refsFromConditionList(conds, out) {
        if (!conds) return;
        for (const c of conds) refsFromCondition(c, out);
    }

    function collectNodeReads(node) {
        const refs = new Set();
        refsFromConditionList(node.activateWhen, refs);
        refsFromConditionList(node.hideWhen, refs);
        if (node.edges) for (const e of node.edges) {
            if (e.requires) {
                const cs = Array.isArray(e.requires) ? e.requires : [e.requires];
                for (const c of cs) refsFromCondition(c, refs);
            }
            const dw = e.disableWhen || e.disabledWhen;
            if (dw) refsFromConditionList(Array.isArray(dw) ? dw : [dw], refs);
            if (e.effects) {
                const blocks = Array.isArray(e.effects) ? e.effects : [e.effects];
                for (const b of blocks) {
                    if (!b) continue;
                    if (b.when) refsFromCondition(b.when, refs);
                    // `move` and `setFlavor` are NOT reads — they're sel→
                    // flavor evictions. Surfaced separately under
                    // collectNodeMoves / movesForSlot.
                }
            }
        }
        return refs;
    }

    function collectNodeMoves(node) {
        const moves = new Set();
        if (node.edges) for (const e of node.edges) {
            if (!e.effects) continue;
            const blocks = Array.isArray(e.effects) ? e.effects : [e.effects];
            for (const b of blocks) {
                if (!b) continue;
                if (Array.isArray(b.move)) for (const m of b.move) moves.add(m);
                if (b.setFlavor && typeof b.setFlavor === 'object') {
                    for (const k of Object.keys(b.setFlavor)) moves.add(k);
                }
            }
        }
        return moves;
    }

    function collectNodeWrites(node) {
        const moveSet = collectNodeMoves(node);
        const refs = new Set();
        // node.id stays in sel after the edge fires unless it's also in
        // a move list (e.g., brittle_resolution moves itself on every
        // edge, so it shows under "moves to flavor" rather than writes).
        if (!moveSet.has(node.id)) refs.add(node.id);
        if (node.edges) for (const e of node.edges) {
            if (!e.effects) continue;
            const blocks = Array.isArray(e.effects) ? e.effects : [e.effects];
            for (const b of blocks) {
                if (!b || !b.set || typeof b.set !== 'object') continue;
                for (const k of Object.keys(b.set)) {
                    // set + move on the same dim = the value was committed
                    // to sel then evicted to flavor on the same edge. Net
                    // post-exit state is in flavor, not sel — surface it
                    // under "moves to flavor" only, not writes.
                    if (!moveSet.has(k)) refs.add(k);
                }
            }
        }
        return refs;
    }

    function readsForSlot(slot) {
        const NODE_MAP = window.Engine.NODE_MAP;
        const MODULE_MAP = (window.Graph && window.Graph.MODULE_MAP) || {};
        if (slot.kind === 'module') {
            const m = MODULE_MAP[slot.id];
            return m && Array.isArray(m.reads) ? m.reads.slice() : [];
        }
        const n = NODE_MAP[slot.id];
        return n ? Array.from(collectNodeReads(n)).sort() : [];
    }

    function writesForSlot(slot) {
        const NODE_MAP = window.Engine.NODE_MAP;
        const MODULE_MAP = (window.Graph && window.Graph.MODULE_MAP) || {};
        if (slot.kind === 'module') {
            const m = MODULE_MAP[slot.id];
            return m && Array.isArray(m.writes) ? m.writes.slice() : [];
        }
        const n = NODE_MAP[slot.id];
        return n ? Array.from(collectNodeWrites(n)).sort() : [];
    }

    // movesForSlot — the dims this slot stops carrying in sel on exit
    // (sel→flavor evictions). For modules this is the same set
    // attachModuleReducer auto-installs on every exit edge: nodeIds \
    // writes (pure-internal question dims) ∪ internalMarkers (mid-module
    // marker dims that aren't external writes). Per-tuple `move` lists
    // (e.g. WHO_BENEFITS_EXIT_FLAVOR_MOVE on every who_benefits exit, or
    // LEAK_REENTRY_MOVE on proliferation leak tuples) get unioned in too
    // so explicit per-edge moves surface in the display. For nodes:
    // every effects.move + setFlavor entry across the node's
    // edges (collectNodeMoves).
    function movesForSlot(slot) {
        const NODE_MAP = window.Engine.NODE_MAP;
        const MODULE_MAP = (window.Graph && window.Graph.MODULE_MAP) || {};
        if (slot.kind === 'module') {
            const m = MODULE_MAP[slot.id];
            if (!m) return [];
            const writes = new Set(m.writes || []);
            const moves = new Set(
                (m.nodeIds || []).filter(d => !writes.has(d))
            );
            for (const d of (m.internalMarkers || [])) moves.add(d);
            const exitPlan = m.exitPlan;
            if (Array.isArray(exitPlan)) {
                for (const t of exitPlan) {
                    if (Array.isArray(t.move)) for (const d of t.move) moves.add(d);
                }
            }
            return [...moves].sort();
        }
        const n = NODE_MAP[slot.id];
        return n ? Array.from(collectNodeMoves(n)).sort() : [];
    }

    // ─── HTML helpers ───────────────────────────────────────────────
    function esc(str) {
        if (str == null) return '';
        const d = document.createElement('div');
        d.textContent = String(str);
        return d.innerHTML;
    }

    function dimListHtml(dims) {
        if (!dims || !dims.length) return `<span class="ex-empty">—</span>`;
        return `<div class="ex-dimlist">${
            dims.map(d => `<span class="ex-dim">${esc(d)}</span>`).join('')
        }</div>`;
    }

    // Per-slot reachability subset, populated only for slots whose
    // upstream coverage we currently care about (just emergence's
    // direct children for now). When set on a slot, the badge appends
    // two extra pairs:
    //
    //   `| (N' x M')`    bucket reach — input rows of the slot's own
    //                    table actually hit by upstream outputs, and
    //                    write-projections those produce.
    //   `| (N'' x M'')`  full-sel reach — distinct upstream FULL sels
    //                    accepted, and distinct merged post-exit FULL
    //                    sels produced. Can exceed the bucket pair
    //                    when pass-through dims (in neither reads nor
    //                    writes) ride through unchanged.
    //
    // Built at render-time in `render()`.
    let _reachByKey = null;

    // ─── Reach-map cross-refresh cache ─────────────────────────────────
    // The full propagation chain (~21s on a cold run) is the dominant
    // cost on /explore. Its output `_reachByKey` depends only on
    // static graph data — NODES, MODULES, FLOW_DAG, outcome templates
    // — so we can persist it to localStorage, fingerprinted on those
    // inputs, and skip the work entirely on refresh. (Propagation
    // targets are now derived from FLOW_DAG.nodes by
    // `FlowPropagation`, so any change to the target set is already
    // captured by the `flow` field below.)
    //
    // Invalidation: any change to fingerprint inputs produces a new
    // hash → new key → cache miss → recompute. Bump REACH_VERSION when
    // the propagation algorithm itself changes (slotAccepts gating,
    // outcome partitioning rules, etc.) — the static-data hash won't
    // catch logic edits in this file or graph-io.js.
    const REACH_VERSION = 16;
    const REACH_KEY_PREFIX = 'explore:reach:v';

    function _hashStr(s) {
        // FNV-1a 32-bit. Cheap, deterministic, no crypto needs.
        let h = 0x811c9dc5;
        for (let i = 0; i < s.length; i++) {
            h ^= s.charCodeAt(i);
            h = Math.imul(h, 0x01000193);
        }
        return (h >>> 0).toString(16);
    }

    function _reachFingerprint() {
        try {
            const NODES   = (window.Engine && window.Engine.NODES) || [];
            const MODULES = (window.Graph  && window.Graph.MODULES) || [];
            const FLOW    = (window.Nodes  && window.Nodes.FLOW_DAG) || { nodes: [], edges: [] };
            const tplDigest = (templates || []).map(t => ({
                id: t.id,
                reachable: t.reachable,
                primaryDimension: t.primaryDimension,
                variants: t.variants ? Object.keys(t.variants).sort() : null,
            }));
            const data = {
                v: REACH_VERSION,
                nodes: NODES.map(n => ({
                    id: n.id, edges: n.edges,
                    activateWhen: n.activateWhen, hideWhen: n.hideWhen,
                    derived: n.derived, module: n.module,
                    // Priority drives the routing tiebreak below — any
                    // change must invalidate the cached reach map.
                    priority: n.priority,
                })),
                modules: MODULES.map(m => ({
                    id: m.id, nodeIds: m.nodeIds,
                    completionMarker: m.completionMarker,
                    exitPlan: m.exitPlan,
                })),
                flow: { nodes: FLOW.nodes, edges: FLOW.edges },
                templates: tplDigest,
            };
            return _hashStr(JSON.stringify(data));
        } catch (_e) { return null; }
    }

    function _reachKey(fp) { return REACH_KEY_PREFIX + REACH_VERSION + ':' + fp; }

    // Map<string, entry> ↔ JSON. `outcomeReach` (per-slot) and
    // `sources` (deadend) are themselves Maps so they round-trip via
    // [...map] arrays of pairs.
    function _serializeReachMap(map) {
        const entries = [];
        for (const [k, v] of map) {
            const out = { ...v };
            if (out.outcomeReach instanceof Map) out.outcomeReach = [...out.outcomeReach];
            if (out.sources instanceof Map) out.sources = [...out.sources];
            entries.push([k, out]);
        }
        return entries;
    }

    function _deserializeReachMap(entries) {
        const map = new Map();
        for (const [k, v] of entries) {
            const out = { ...v };
            if (Array.isArray(out.outcomeReach)) out.outcomeReach = new Map(out.outcomeReach);
            if (Array.isArray(out.sources))      out.sources      = new Map(out.sources);
            map.set(k, out);
        }
        return map;
    }

    function _loadCachedReach(fp) {
        if (typeof localStorage === 'undefined') return null;
        try {
            const raw = localStorage.getItem(_reachKey(fp));
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            if (!parsed || parsed.fp !== fp || !Array.isArray(parsed.entries)) return null;
            return _deserializeReachMap(parsed.entries);
        } catch (_e) { return null; }
    }

    function _saveCachedReach(fp, map) {
        if (typeof localStorage === 'undefined') return;
        try {
            const payload = JSON.stringify({ fp, entries: _serializeReachMap(map) });
            localStorage.setItem(_reachKey(fp), payload);
        } catch (_e) { /* quota / disabled — accept the slow refresh */ }
    }


    // Card-header badge: "(N x M)" where N = # input rows that pass the
    // slot's entry conditions and M = # distinct output states reachable
    // by the slot's internal DFS (see GraphIO.cartesianWriteRows).
    // Outcome cards show "(N x —)" because outcomes are terminal — they
    // have no outputs of their own. Deadend cards have no I/O contract.
    // The trailing "+" indicates the count was capped (truncated).
    // When `_reachByKey` has an entry for this slot, append both the
    // bucket and full-sel reach pairs.
    function tableSizeBadgeHtml(slot) {
        if (!slot) return '';
        if (!window.GraphIO || !window.GraphIO.cartesianReadRows) return '';

        const isOutcome = slot.kind === 'outcome';
        const isDeadend = slot.kind === 'deadend';
        const reach = _reachByKey ? _reachByKey.get(slot.key) : null;

        // Outcome cards: reach count from upstream siphoning is the
        // only useful measurement. Skip the (NxM) table — outcomes
        // have no internal walk and the read-cart-prod is a confusing
        // upper bound.
        if (isOutcome) {
            if (reach && typeof reach.reach === 'number') {
                return `<span class="ex-card-tablesize">reach: ${reach.reach}</span>`;
            }
            return '';
        }

        // Dead-end card: aggregate count of dead-end sels across all
        // slots (continuing outputs no child accepts and no outcome
        // siphons).
        if (isDeadend) {
            if (reach && reach.reach > 0) {
                return `<span class="ex-card-tablesize ex-card-dead">reach: ${reach.reach}</span>`;
            }
            return '';
        }

        const inResult = window.GraphIO.cartesianReadRows(slot);
        if (!inResult) return '';
        const n = (inResult.rows || []).length;
        const nLabel = n + (inResult.truncated ? '+' : '');

        let mLabel;
        if (!window.GraphIO.cartesianWriteRows) {
            mLabel = '?';
        } else {
            const outResult = window.GraphIO.cartesianWriteRows(slot);
            const m = outResult ? (outResult.rows || []).length : 0;
            mLabel = m + (outResult && outResult.truncated ? '+' : '');
        }
        const main = `(${nLabel} x ${mLabel})`;

        if (!reach) return `<span class="ex-card-tablesize">${main}</span>`;

        const tSuf = reach.truncated ? '+' : '';
        const bucketStr = `(${reach.bucketInputs} x ${reach.bucketOutputs}${tSuf})`;
        const fullStr = `(${reach.fullInputs} x ${reach.fullOutputs}${tSuf})`;
        // Two extra slices: bucket reach (matches the slot's own
        // table columns) and full-sel reach (counts distinct full
        // states actually flowing through — can be larger).
        let html = `${main} | ${bucketStr} | ${fullStr}`;
        // If any of this slot's full-sel exits matched a global
        // outcome's reachable clause OR landed in a dead end, surface
        // the partition: matched / propagated / dead. Engine only
        // tests outcomes after a slot exits, so the boundary aligns
        // with the first place a sel can become terminal.
        const hasSplit = reach.outcomeSelCount > 0 || reach.deadCount > 0;
        if (hasSplit) {
            const parts = [];
            if (reach.outcomeSelCount > 0) parts.push(`out: ${reach.outcomeSelCount}`);
            parts.push(`dn: ${reach.propagatedCount || 0}`);
            if (reach.deadCount > 0) parts.push(`<span class="ex-card-dead">dead: ${reach.deadCount}</span>`);
            html += ` &rarr; ${parts.join(' / ')}`;
        }
        return `<span class="ex-card-tablesize">${html}</span>`;
    }

    // ─── Card ───────────────────────────────────────────────────────
    function slotCardHtml(slot) {
        const NODE_MAP = window.Engine.NODE_MAP;
        const MODULE_MAP = (window.Graph && window.Graph.MODULE_MAP) || {};
        const isModule = slot.kind === 'module';
        const label = isModule
            ? ((MODULE_MAP[slot.id] && MODULE_MAP[slot.id].label) || '')
            : ((NODE_MAP[slot.id] && NODE_MAP[slot.id].label) || '');

        const reads = readsForSlot(slot);
        const writes = writesForSlot(slot);
        const moves = movesForSlot(slot);

        const cls = 'ex-card' + (isModule ? ' is-module' : '');

        let html = `<div class="${cls}" data-flow-key="${esc(slot.key)}">`;

        html += `<div class="ex-card-head">`;
        html += `<div class="ex-card-row">`;
        html += `<span class="ex-card-id">${esc(slot.id)}</span>`;
        html += `<span class="ex-card-kind">${esc(slot.kind)}</span>`;
        html += tableSizeBadgeHtml(slot);
        html += `</div>`;
        if (label) html += `<div class="ex-card-label">${esc(label)}</div>`;
        if (slot.note) html += `<div class="ex-card-note">${esc(slot.note)}</div>`;
        html += `</div>`;

        html += `<div class="ex-block">`;
        html += `<div class="ex-block-head">reads</div>`;
        html += dimListHtml(reads);
        html += `</div>`;

        html += `<div class="ex-block">`;
        html += `<div class="ex-block-head">writes</div>`;
        html += dimListHtml(writes);
        html += `</div>`;

        if (moves.length) {
            html += `<div class="ex-block">`;
            html += `<div class="ex-block-head">moves to flavor</div>`;
            html += dimListHtml(moves);
            html += `</div>`;
        }

        html += `<div class="ex-foot">`;
        html += `<button class="ex-step-btn" disabled title="Coming soon">Step through</button>`;
        html += `</div>`;

        html += `</div>`;
        return html;
    }

    function outcomeCardHtml(slot, tplById) {
        const t = tplById.get(slot.id);
        const title = (t && t.title) || slot.id;
        const summary = t && (t.summary || '') ? t.summary : '';
        const variantCount = t && t.variants ? Object.keys(t.variants).length : 0;
        const subtitle = variantCount ? `${variantCount} variant${variantCount === 1 ? '' : 's'}` : 'outcome';
        let html = `<div class="ex-card is-outcome" data-flow-key="${esc(slot.key)}">`;
        html += `<div class="ex-card-head">`;
        html += `<div class="ex-card-row">`;
        html += `<span class="ex-card-id">${esc(slot.id)}</span>`;
        html += `<span class="ex-card-kind">outcome</span>`;
        html += tableSizeBadgeHtml(slot);
        html += `</div>`;
        html += `<div class="ex-card-label">${esc(title)}</div>`;
        html += `<div class="ex-card-note">${esc(subtitle)}</div>`;
        html += `</div>`;
        if (summary) {
            // Trim long summaries — these cards are visual sinks, not
            // detail panels. Full text lives on the share page / map.
            const trimmed = summary.length > 140 ? summary.slice(0, 137).trim() + '…' : summary;
            html += `<div class="ex-card-summary">${esc(trimmed)}</div>`;
        }
        html += `</div>`;
        return html;
    }

    function deadEndCardHtml(slot) {
        let html = `<div class="ex-card is-deadend" data-flow-key="${esc(slot.key)}">`;
        html += `<div class="ex-card-head">`;
        html += `<div class="ex-card-row">`;
        html += `<span class="ex-card-id">deadend</span>`;
        html += `<span class="ex-card-kind">terminal</span>`;
        html += tableSizeBadgeHtml(slot);
        html += `</div>`;
        html += `<div class="ex-card-label">Dead end</div>`;
        html += `<div class="ex-card-note">no askable next question, no template match</div>`;
        html += `</div>`;
        html += `<div class="ex-card-summary">Catch-all sink for branches that don't resolve to any outcome template.</div>`;
        html += `</div>`;
        return html;
    }

    function cardHtml(slot, tplById) {
        if (slot.kind === 'outcome') return outcomeCardHtml(slot, tplById);
        if (slot.kind === 'deadend') return deadEndCardHtml(slot);
        return slotCardHtml(slot);
    }

    // ─── Sidebar renderers ──────────────────────────────────────────
    // Same semantics as the cards but with room to breathe: full
    // reads/writes lists, full outcome summaries + variants, and
    // (for outcomes / deadend) which slots feed into them.
    function sidebarHtml(slot, tplById, dag) {
        if (slot.kind === 'outcome') return sbOutcomeHtml(slot, tplById, dag);
        if (slot.kind === 'deadend') return sbDeadEndHtml(slot, dag);
        return sbSlotHtml(slot);
    }

    function sbSection(headText, bodyHtml) {
        return `<div class="ex-sb-section">`
             + `<div class="ex-sb-section-head">${esc(headText)}</div>`
             + `<div class="ex-sb-section-body">${bodyHtml}</div>`
             + `</div>`;
    }

    function sbDimList(dims) {
        if (!dims || !dims.length) return `<span class="ex-sb-empty-mini">none</span>`;
        return `<div class="ex-sb-dimlist">`
             + dims.map(d => `<span class="ex-sb-dim">${esc(d)}</span>`).join('')
             + `</div>`;
    }

    function sbSlotHtml(slot) {
        const NODE_MAP = window.Engine.NODE_MAP;
        const MODULE_MAP = (window.Graph && window.Graph.MODULE_MAP) || {};
        const isModule = slot.kind === 'module';
        const label = isModule
            ? ((MODULE_MAP[slot.id] && MODULE_MAP[slot.id].label) || '')
            : ((NODE_MAP[slot.id] && NODE_MAP[slot.id].label) || '');
        const reads = readsForSlot(slot);
        const writes = writesForSlot(slot);
        const moves = movesForSlot(slot);

        let html = `<div class="ex-sb">`;
        html += `<div class="ex-sb-head">`;
        html += `<div class="ex-sb-id">${esc(slot.id)}</div>`;
        html += `<div class="ex-sb-kind">${esc(slot.kind)}</div>`;
        if (label) html += `<div class="ex-sb-label">${esc(label)}</div>`;
        if (slot.note) html += `<div class="ex-sb-note">${esc(slot.note)}</div>`;
        html += `</div>`;

        html += sbSection('reads', sbDimList(reads));
        html += sbSection('writes', sbDimList(writes));
        if (moves.length) {
            html += sbSection('moves to flavor', sbDimList(moves));
        }

        if (slot.earlyExits && slot.earlyExits.length) {
            html += sbSection('early exits', sbDimList(slot.earlyExits));
        }

        html += sbInputRowsHtml(slot);

        html += `</div>`;
        return html;
    }

    // Cart-prod over the slot's read dims, filtered to the rows whose
    // (UNSET-aware) sel satisfies the slot's activateWhen and not its
    // hideWhen. Computed by GraphIO; this is just the rendering side.
    function sbInputRowsHtml(slot) {
        if (!window.GraphIO) return '';
        const result = window.GraphIO.cartesianReadRows(slot);
        if (!result) return '';
        const { dims, rows, truncated } = result;
        if (!dims.length) {
            return sbSection('input rows',
                `<div class="ex-sb-empty-mini">no read constraints</div>`);
        }
        const UNSET = window.GraphIO.UNSET;
        const headerRow = `<tr>${dims.map(d => `<th>${esc(d)}</th>`).join('')}</tr>`;
        const bodyRows = rows.map(r =>
            `<tr>${dims.map(d => {
                const v = r[d];
                return v === UNSET
                    ? `<td><span class="ex-sb-unset">—</span></td>`
                    : `<td>${esc(v)}</td>`;
            }).join('')}</tr>`
        ).join('') || `<tr><td colspan="${dims.length}"><span class="ex-sb-empty-mini">no rows pass entry conditions</span></td></tr>`;
        const meta = `<div class="ex-sb-iotable-meta">`
            + `${rows.length} row${rows.length === 1 ? '' : 's'} pass entry`
            + (truncated ? ' · pre-filter cart-prod truncated at 4096' : '')
            + `</div>`;
        const tbl = `<div class="ex-sb-iotable-wrap">`
                  + `<table class="ex-sb-iotable">`
                  +     `<thead>${headerRow}</thead>`
                  +     `<tbody>${bodyRows}</tbody>`
                  + `</table>`
                  + `</div>`
                  + meta;
        return sbSection('input rows', tbl);
    }

    function sbOutcomeHtml(slot, tplById, dag) {
        const t = tplById.get(slot.id);
        const title = (t && t.title) || slot.id;
        const summary = t && t.summary ? t.summary : '';
        const sources = (slot.sources || [])
            .map(k => {
                const s = dag.nodes.find(n => n.key === k);
                return s ? s.id : k;
            });

        let html = `<div class="ex-sb">`;
        html += `<div class="ex-sb-head">`;
        html += `<div class="ex-sb-id">${esc(slot.id)}</div>`;
        html += `<div class="ex-sb-kind">outcome</div>`;
        html += `<div class="ex-sb-title">${esc(title)}</div>`;
        html += `</div>`;

        if (summary) html += sbSection('summary', `<div>${esc(summary)}</div>`);

        if (t && t.primaryDimension) {
            html += sbSection('primary dimension',
                `<span class="ex-sb-dim">${esc(t.primaryDimension)}</span>`);
        }

        if (t && t.variants) {
            const keys = Object.keys(t.variants);
            const variantsHtml = `<div class="ex-sb-variants">`
                + keys.map(k => {
                    const v = t.variants[k] || {};
                    return `<div class="ex-sb-variant">`
                        + `<div class="ex-sb-variant-head">`
                        + `<span class="ex-sb-variant-key">${esc(k)}</span>`
                        + (v.subtitle ? `<span class="ex-sb-variant-subtitle">${esc(v.subtitle)}</span>` : '')
                        + (v.mood ? `<span class="ex-sb-variant-mood">${esc(v.mood)}</span>` : '')
                        + `</div>`
                        + (v.summary ? `<div class="ex-sb-variant-summary">${esc(v.summary)}</div>` : '')
                        + `</div>`;
                }).join('')
                + `</div>`;
            html += sbSection(`variants (${keys.length})`, variantsHtml);
        }

        if (sources.length) {
            html += sbSection('reachable from', sbDimList(sources));
        }

        html += sbInputRowsHtml(slot);

        html += `</div>`;
        return html;
    }

    function sbDeadEndHtml(_slot, _dag) {
        let html = `<div class="ex-sb">`;
        html += `<div class="ex-sb-head">`;
        html += `<div class="ex-sb-id">deadend</div>`;
        html += `<div class="ex-sb-kind">terminal</div>`;
        html += `<div class="ex-sb-title">Dead end</div>`;
        html += `</div>`;
        html += sbSection('description',
            `<div>Catch-all sink for branches that resolve to no outcome template and no askable next question.</div>`);
        html += sbSection('engine signal',
            `<div>The engine emits <code>{ terminal: true, kind: 'deadend' }</code> when a derived state matches no template and exposes no further askable node.</div>`);

        // Per-source breakdown: which slots are leaking sels into the
        // dead end, and how many. Only rendered when reachability
        // propagation has run (otherwise sources is absent).
        const reach = _reachByKey ? _reachByKey.get('deadend') : null;
        if (reach && reach.sources && reach.sources.size) {
            const rows = [...reach.sources.entries()]
                .sort((a, b) => b[1] - a[1])
                .map(([k, n]) => `<div><code>${esc(k)}</code> &mdash; <span class="ex-card-dead">${n}</span></div>`)
                .join('');
            html += sbSection(`dead-end sels by source (total ${reach.reach})`, rows);
        }
        html += `</div>`;
        return html;
    }

    // ─── Extended DAG (real slots + outcome cards + dead-end) ───────
    // Each terminal narrative outcome that appears in any slot's
    // earlyExits becomes its own slot in the rightmost column. A
    // single shared `deadend` slot sits next to them. Edges:
    //   * real slot → outcome  for every (slot, oid) such that
    //     oid ∈ slot.earlyExits   (kind: 'outcome-link')
    //   * rightmost real slot → outcome  (placement-only) for any
    //     outcome not produced by the rightmost slot, so that
    //     longest-path lifts every outcome card to maxCol+1
    //   * rightmost real slot → deadend  (placement-only)
    function buildExtendedDag(baseDag) {
        const outcomeMap = new Map(); // oid → { sources: [slotKey] }
        for (const n of baseDag.nodes) {
            if (!n.earlyExits) continue;
            for (const oid of n.earlyExits) {
                if (!outcomeMap.has(oid)) outcomeMap.set(oid, { sources: [] });
                outcomeMap.get(oid).sources.push(n.key);
            }
        }
        const outcomeNodes = [];
        for (const [oid, info] of outcomeMap) {
            outcomeNodes.push({ key: 'outcome:' + oid, id: oid, kind: 'outcome', sources: info.sources });
        }
        const realEdges = baseDag.edges.slice();
        const outcomeEdges = []; // real (slot → outcome)
        for (const o of outcomeNodes) {
            for (const src of o.sources) outcomeEdges.push([src, o.key, 'outcome-link']);
        }

        // Find rightmost real slot via base columns.
        const baseCols = computeColumnsFromNodesEdges(baseDag.nodes, realEdges);
        let rightmost = null, rightmostCol = -1;
        for (const n of baseDag.nodes) {
            const c = baseCols.get(n.key) || 0;
            if (c > rightmostCol) { rightmostCol = c; rightmost = n.key; }
        }

        const deadEndNode = { key: 'deadend', id: 'deadend', kind: 'deadend' };
        const placementEdges = [];
        if (rightmost) {
            placementEdges.push([rightmost, 'deadend', 'placement-deadend']);
            for (const o of outcomeNodes) {
                if (!o.sources.includes(rightmost)) {
                    placementEdges.push([rightmost, o.key, 'placement-outcome']);
                }
            }
        }

        return {
            nodes: [...baseDag.nodes, ...outcomeNodes, deadEndNode],
            edges: [...realEdges, ...outcomeEdges, ...placementEdges],
        };
    }

    // ─── Layout (longest-path columns) ──────────────────────────────
    function computeColumnsFromNodesEdges(nodes, edges) {
        const parentsOf = new Map();
        for (const n of nodes) parentsOf.set(n.key, []);
        for (const [p, c] of edges) {
            if (parentsOf.has(c)) parentsOf.get(c).push(p);
        }
        const col = new Map();
        const visit = (k, stack = new Set()) => {
            if (col.has(k)) return col.get(k);
            if (stack.has(k)) return 0;
            stack.add(k);
            const ps = parentsOf.get(k) || [];
            const c = ps.length ? Math.max(...ps.map(p => visit(p, stack))) + 1 : 0;
            stack.delete(k);
            col.set(k, c);
            return c;
        };
        for (const n of nodes) visit(n.key);
        return col;
    }

    function renderFlow(dag) {
        const tplById = new Map(templates.map(t => [t.id, t]));
        const col = computeColumnsFromNodesEdges(dag.nodes, dag.edges);
        const byCol = new Map();
        for (const n of dag.nodes) {
            const c = col.get(n.key);
            if (!byCol.has(c)) byCol.set(c, []);
            byCol.get(c).push(n);
        }
        const maxCol = byCol.size ? Math.max(...byCol.keys()) : 0;

        // Within the rightmost (terminals) column, sort so dead-end is
        // always last — outcomes group together visually.
        for (const slots of byCol.values()) {
            slots.sort((a, b) => {
                const rank = (s) => s.kind === 'deadend' ? 2 : (s.kind === 'outcome' ? 1 : 0);
                return rank(a) - rank(b);
            });
        }

        let html = `<svg class="ex-edges" xmlns="http://www.w3.org/2000/svg">`
                 + `<defs>`
                 + `<marker id="ex-flow-arrow" viewBox="0 0 10 10" refX="9" refY="5" `
                 +         `markerWidth="7" markerHeight="7" orient="auto-start-reverse">`
                 + `<path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor"/>`
                 + `</marker>`
                 + `</defs>`
                 + `</svg>`;
        html += `<div class="ex-flow">`;
        for (let c = 0; c <= maxCol; c++) {
            const slots = byCol.get(c) || [];
            html += `<div class="ex-col">`;
            for (const slot of slots) html += cardHtml(slot, tplById);
            html += `</div>`;
        }
        html += `</div>`;
        return html;
    }

    // For a slot whose outputs we want to draw individually (currently
    // a hard-coded test list — just `emergence`), return one synthetic
    // edge per row of cartesianWriteRows. Each edge's target is the
    // first DAG-child of `slotKey` whose activateWhen passes against
    // the row's projected sel. Rows whose output sel doesn't activate
    // any of the slot's children are skipped (would mean the FLOW_DAG
    // is missing a downstream branch — worth surfacing later).
    const OUTPUT_STATE_SOURCES = new Set(['emergence']);

    // Convert an output row from cartesianWriteRows (UNSET-aware
    // dim-keyed object) to a sel object suitable for matchCondition —
    // i.e. drop UNSET dims so they're treated as absent.
    function rowToSel(row) {
        if (!row) return {};
        const UNSET = window.GraphIO && window.GraphIO.UNSET;
        const sel = {};
        for (const [k, v] of Object.entries(row)) {
            if (v === UNSET || v == null) continue;
            sel[k] = v;
        }
        return sel;
    }

    // Build the per-slot reachability map for the badges.
    //
    // Propagation itself (topo walk + slot-priority routing + outcome
    // siphoning) is delegated to `FlowPropagation.run` — the same
    // primitive validate.js and precompute-reachability.js use, so
    // explore's badges and the engine's static analysis can never
    // disagree on what's reachable. The hook `onOutcomeMatch` lets us
    // tally per-(slot, outcome) reach without re-walking; everything
    // else falls out of the propagation result directly.
    //
    // For each slot we record TWO views:
    //
    //   * bucket  — counts of distinct read-projections in / write-
    //               projections out, matching the slot's own table
    //               columns. (`reachableCountsFromInputs`, called per
    //               slot here because `FlowPropagation.run` only
    //               tracks full-sel counts.)
    //   * fullSel — counts of distinct full sels in / out, derived
    //               from FlowPropagation (`acceptedBySlot`,
    //               `routed + matched + dead`). Can exceed the bucket
    //               counts because pass-through dims ride through
    //               unchanged and split otherwise-collapsing buckets.
    function buildReachByKey(dag) {
        if (!window.GraphIO || !window.GraphIO.cartesianWriteRows
            || !window.GraphIO.reachableCountsFromInputs
            || !window.FlowPropagation) return null;
        const emergence = dag.nodes.find(n => n.key === 'emergence');
        if (!emergence) return null;
        const eW = window.GraphIO.cartesianWriteRows(emergence);
        if (!eW || !Array.isArray(eW.rows)) return null;

        // Per-(slot, outcome) reach: captured via the onOutcomeMatch
        // hook because FlowPropagation aggregates `outcomeAgg`
        // globally but not the per-slot breakdown.
        const perSlotOutcomes = new Map();
        const prop = window.FlowPropagation.run({
            onOutcomeMatch: (oid, _sel, slotKey) => {
                let m = perSlotOutcomes.get(slotKey);
                if (!m) { m = new Map(); perSlotOutcomes.set(slotKey, m); }
                m.set(oid, (m.get(oid) || 0) + 1);
            },
        });

        const map = new Map();
        const deadAgg = new Map(); // slotKey → dead-end count from that slot

        for (const slotKey of prop.order) {
            const slot = dag.nodes.find(n => n.key === slotKey);
            if (!slot) continue;

            let bucket, fullInputs;
            if (slotKey === 'emergence') {
                // Emergence is the seed: outputs come from
                // cartesianWriteRows directly, not from upstream
                // inputs. FlowPropagation skips its accept tracking.
                bucket = {
                    reachableInputs: 1,
                    reachableOutputs: eW.rows.length,
                    truncated: !!eW.truncated,
                };
                fullInputs = 1;
            } else {
                const upstream = prop.inputsBySlot.get(slotKey);
                if (!upstream || !upstream.length) continue;
                bucket = window.GraphIO.reachableCountsFromInputs(slot, upstream);
                if (!bucket) continue;
                fullInputs = prop.acceptedBySlot.get(slotKey) || 0;
            }

            const matched = prop.matchedBySlot.get(slotKey) || 0;
            const routed  = (prop.routedBySlot.get(slotKey) || []).length;
            const dead    = (prop.deadBySlot.get(slotKey)   || []).length;
            // Every output a slot produces is routed-to-child,
            // siphoned-to-outcome, or dead — exact identity.
            // (`reachableCountsFromInputs` and `reachableFullSelsFrom-
            // Inputs` both derive `truncated` from the same
            // `cartesianWriteRows(slot).truncated`, so the bucket
            // flag is the canonical truncation signal here.)
            const fullOutputs = matched + routed + dead;

            if (dead > 0) deadAgg.set(slotKey, dead);

            map.set(slotKey, {
                bucketInputs: bucket.reachableInputs,
                bucketOutputs: bucket.reachableOutputs,
                fullInputs,
                fullOutputs,
                truncated: !!bucket.truncated,
                outcomeReach: perSlotOutcomes.get(slotKey) || new Map(),
                outcomeSelCount: matched,
                propagatedCount: routed,
                deadCount: dead,
            });
        }

        // Pin per-outcome totals onto outcome keys so outcome cards can
        // render their incoming reach without re-walking the graph.
        for (const [oid, count] of prop.outcomeAgg) {
            map.set('outcome:' + oid, { kind: 'outcome', reach: count });
        }
        // Pin total dead-end count + per-source breakdown onto the
        // deadend node. The breakdown also drives the red flow-deadend
        // edges added in the init() pass.
        let deadTotal = 0;
        for (const c of deadAgg.values()) deadTotal += c;
        map.set('deadend', { kind: 'deadend', reach: deadTotal, sources: deadAgg });
        return map;
    }

    function buildOutputStateEdges(slotKey, dag) {
        if (!window.GraphIO || !window.GraphIO.cartesianWriteRows) return [];
        if (!window.Engine || !window.Engine.matchCondition) return [];
        const slot = dag.nodes.find(n => n.key === slotKey);
        if (!slot) return [];

        const w = window.GraphIO.cartesianWriteRows(slot);
        if (!w || !w.rows || !w.rows.length) return [];

        const NODE_MAP = window.Engine.NODE_MAP;
        const MODULE_MAP = (window.Graph && window.Graph.MODULE_MAP) || {};

        // Children = direct DAG successors of this slot. We want the
        // pre-existing FLOW_DAG topology, not the extended-DAG outcome
        // links — outcome cards aren't gated by activateWhen.
        const children = dag.edges
            .filter(([p, c]) => p === slotKey && !String(c).startsWith('outcome:') && c !== 'deadend')
            .map(([_p, c]) => c);

        const childActivateWhen = (childKey) => {
            const child = dag.nodes.find(n => n.key === childKey);
            if (!child) return null;
            if (child.kind === 'module') {
                const m = MODULE_MAP[child.id];
                return m ? m.activateWhen : null;
            }
            const n = NODE_MAP[child.id];
            return n ? n.activateWhen : null;
        };

        const out = [];
        for (const row of w.rows) {
            const sel = rowToSel(row);
            let target = null;
            for (const ck of children) {
                const aw = childActivateWhen(ck);
                const passes = !aw || aw.length === 0
                    || aw.some(c => window.Engine.matchCondition(sel, c));
                if (passes) { target = ck; break; }
            }
            if (target) out.push([slotKey, target, 'output-state']);
        }
        return out;
    }

    function drawEdges(root, dag) {
        const viewport = root.querySelector('.ex-viewport');
        const svg = root.querySelector('svg.ex-edges');
        if (!viewport || !svg) return;
        svg.setAttribute('width', 0);
        svg.setAttribute('height', 0);
        const vRect = viewport.getBoundingClientRect();
        const cards = viewport.querySelectorAll('[data-flow-key]');
        const rects = new Map();
        let maxRight = 0, maxBot = 0;
        for (const el of cards) {
            const r = el.getBoundingClientRect();
            const x = r.left - vRect.left;
            const y = r.top - vRect.top;
            const w = r.width, h = r.height;
            rects.set(el.dataset.flowKey, { x, y, w, h });
            if (x + w > maxRight) maxRight = x + w;
            if (y + h > maxBot) maxBot = y + h;
        }
        const pad = 24;
        const W = maxRight + pad, H = maxBot + pad;
        svg.setAttribute('width', W);
        svg.setAttribute('height', H);
        svg.setAttribute('viewBox', `0 0 ${W} ${H}`);

        // Edge swap: for any source slot in OUTPUT_STATE_SOURCES, drop
        // its regular DAG-children edges and replace them with one
        // edge per cartesianWriteRows row. Outcome / deadend placement
        // edges from that slot still pass through.
        const drawEdgesList = [];
        for (const e of dag.edges) {
            const [p, _c, kind] = e;
            if (OUTPUT_STATE_SOURCES.has(p) && (!kind || kind === 'flow' || kind === undefined)) continue;
            drawEdgesList.push(e);
        }
        for (const src of OUTPUT_STATE_SOURCES) {
            for (const e of buildOutputStateEdges(src, dag)) drawEdgesList.push(e);
        }

        // Per-source attach offsets: for each source, distribute its
        // outgoing edges' y1 across the card height so multiple
        // arrows fan out instead of stacking on the midline. Same on
        // the target side per (source, target) pair.
        const sourceCounts = new Map();
        const sourceIdx = new Map();
        const pairCounts = new Map();
        const pairIdx = new Map();
        for (const [p, c] of drawEdgesList) {
            sourceCounts.set(p, (sourceCounts.get(p) || 0) + 1);
            const pk = p + '→' + c;
            pairCounts.set(pk, (pairCounts.get(pk) || 0) + 1);
        }

        const elements = [];
        for (const edge of drawEdgesList) {
            const [p, c, kind] = edge;
            const pr = rects.get(p), cr = rects.get(c);
            if (!pr || !cr) continue;

            // Source attach: ((i+1) / (n+1)) of card height.
            const sN = sourceCounts.get(p) || 1;
            const sI = sourceIdx.get(p) || 0;
            sourceIdx.set(p, sI + 1);
            const y1 = pr.y + pr.h * (sI + 1) / (sN + 1);
            const x1 = pr.x + pr.w;

            // Target attach: same scheme but per (source, target).
            const pk = p + '→' + c;
            const tN = pairCounts.get(pk) || 1;
            const tI = pairIdx.get(pk) || 0;
            pairIdx.set(pk, tI + 1);
            const y2 = cr.y + cr.h * (tI + 1) / (tN + 1);
            const x2 = cr.x;

            const dx = Math.max(40, (x2 - x1) / 2);
            const d = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;

            let cls = '';
            if (kind === 'placement-outcome' || kind === 'placement-deadend') {
                cls = 'is-placement' + (kind === 'placement-deadend' ? ' is-deadend-link' : ' is-outcome-link');
            } else if (kind === 'outcome-link') {
                cls = 'is-outcome-link';
            } else if (kind === 'output-state') {
                cls = 'is-output-state';
            } else if (kind === 'flow-deadend') {
                cls = 'is-flow-deadend';
            }
            elements.push(`<path class="${cls}" d="${d}" marker-end="url(#ex-flow-arrow)"/>`);
        }
        const defs = svg.querySelector('defs');
        svg.innerHTML = '';
        if (defs) svg.appendChild(defs);
        svg.insertAdjacentHTML('beforeend', elements.join(''));
    }

    // ─── Pan / zoom ─────────────────────────────────────────────────
    const VIEW_LS_KEY = 'explore-flow-view-v1';
    const SIDEBAR_LS_KEY = 'explore-sidebar-width-v1';
    const SELECTED_LS_KEY = 'explore-selected-card-v1';
    const SIDEBAR_MIN = 220;
    const SIDEBAR_MAX_RATIO = 0.7; // never let sidebar eat more than this fraction of the body
    const SIDEBAR_DEFAULT = 320;

    function loadSidebarWidth() {
        try {
            const raw = localStorage.getItem(SIDEBAR_LS_KEY);
            if (raw) {
                const n = parseInt(raw, 10);
                if (Number.isFinite(n) && n >= SIDEBAR_MIN) return n;
            }
        } catch (_e) { /* ignore */ }
        return SIDEBAR_DEFAULT;
    }

    function saveSidebarWidth(w) {
        try { localStorage.setItem(SIDEBAR_LS_KEY, String(Math.round(w))); }
        catch (_e) { /* ignore */ }
    }

    function clampSidebarWidth(w, body) {
        const bodyW = body ? body.clientWidth : window.innerWidth;
        const maxW = Math.max(SIDEBAR_MIN, Math.floor(bodyW * SIDEBAR_MAX_RATIO));
        return Math.max(SIDEBAR_MIN, Math.min(maxW, Math.round(w)));
    }

    // Drag the .ex-divider to resize the sidebar. Width is persisted
    // to localStorage so it sticks across reloads, and clamped to a
    // sensible range so the canvas always has room to breathe.
    function wireSidebarResize(root, sidebar) {
        const body = root.querySelector('.ex-body');
        const divider = root.querySelector('.ex-divider');
        if (!body || !divider || !sidebar) return;

        const setWidth = (w) => {
            const clamped = clampSidebarWidth(w, body);
            sidebar.style.flex = `0 0 ${clamped}px`;
            sidebar.style.width = `${clamped}px`;
            return clamped;
        };

        setWidth(loadSidebarWidth());

        let startX = 0, startW = 0, dragging = false;
        divider.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            dragging = true;
            startX = e.clientX;
            startW = sidebar.getBoundingClientRect().width;
            divider.classList.add('is-dragging');
            root.classList.add('is-resizing');
            e.preventDefault();
        });

        window.addEventListener('mousemove', (e) => {
            if (!dragging) return;
            // Dragging left expands the sidebar; right shrinks it.
            const dx = e.clientX - startX;
            setWidth(startW - dx);
        });

        window.addEventListener('mouseup', () => {
            if (!dragging) return;
            dragging = false;
            divider.classList.remove('is-dragging');
            root.classList.remove('is-resizing');
            saveSidebarWidth(sidebar.getBoundingClientRect().width);
        });

        // If the window resizes such that the saved width violates
        // the max-ratio rule, re-clamp so the canvas isn't crushed.
        window.addEventListener('resize', () => {
            const current = sidebar.getBoundingClientRect().width;
            const re = clampSidebarWidth(current, body);
            if (re !== Math.round(current)) setWidth(re);
        });
    }


    function loadView() {
        try {
            const raw = localStorage.getItem(VIEW_LS_KEY);
            if (raw) {
                const v = JSON.parse(raw);
                if (typeof v.x === 'number' && typeof v.y === 'number' && typeof v.s === 'number') {
                    return { x: v.x, y: v.y, s: v.s, dirty: true };
                }
            }
        } catch (_e) { /* ignore */ }
        return { x: 24, y: 24, s: 1, dirty: false };
    }

    function saveView(view) {
        try {
            localStorage.setItem(VIEW_LS_KEY, JSON.stringify({
                x: view.x, y: view.y, s: view.s,
            }));
        } catch (_e) { /* ignore */ }
    }

    function wireCanvas(root, dag) {
        const canvas = root.querySelector('.ex-canvas');
        const viewport = root.querySelector('.ex-viewport');
        if (!canvas || !viewport) return null;

        // Draw arrows before fit() so the viewport's scrollWidth/Height
        // accounts for the SVG's bbox.
        drawEdges(root, dag);

        const view = loadView();

        const apply = () => {
            viewport.style.transform =
                `translate(${view.x}px, ${view.y}px) scale(${view.s})`;
        };

        const fit = () => {
            viewport.style.transform = 'translate(0,0) scale(1)';
            const cw = canvas.clientWidth, ch = canvas.clientHeight;
            const vw = viewport.scrollWidth, vh = viewport.scrollHeight;
            if (!cw || !vw) { apply(); return; }
            const sx = (cw - 48) / vw;
            const sy = (ch - 48) / vh;
            view.s = Math.max(0.25, Math.min(1, Math.min(sx, sy)));
            view.x = 24;
            view.y = Math.max(24, (ch - vh * view.s) / 2);
            view.dirty = false;
            try { localStorage.removeItem(VIEW_LS_KEY); } catch (_e) { /* ignore */ }
            apply();
        };

        if (view.dirty) apply();
        else fit();

        let dragging = false, sx = 0, sy = 0, x0 = 0, y0 = 0, panMoved = false;
        canvas.addEventListener('mousedown', (e) => {
            if (e.target.closest && e.target.closest('a, button')) return;
            if (e.button !== 0) return;
            dragging = true; panMoved = false;
            sx = e.clientX; sy = e.clientY;
            x0 = view.x; y0 = view.y;
            canvas.classList.add('dragging');
            e.preventDefault();
        });
        window.addEventListener('mousemove', (e) => {
            if (!dragging) return;
            const dx = e.clientX - sx, dy = e.clientY - sy;
            if (!panMoved && Math.hypot(dx, dy) > 3) panMoved = true;
            view.x = x0 + dx; view.y = y0 + dy;
            view.dirty = true;
            apply();
        });
        window.addEventListener('mouseup', () => {
            if (!dragging) return;
            dragging = false;
            canvas.classList.remove('dragging');
            if (panMoved) saveView(view);
        });

        canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            const rect = canvas.getBoundingClientRect();
            const cx = e.clientX - rect.left;
            const cy = e.clientY - rect.top;
            const wx = (cx - view.x) / view.s;
            const wy = (cy - view.y) / view.s;
            const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
            view.s = Math.max(0.2, Math.min(2.5, view.s * factor));
            view.x = cx - wx * view.s;
            view.y = cy - wy * view.s;
            view.dirty = true;
            apply();
            saveView(view);
        }, { passive: false });

        return { fit };
    }

    // ─── Entry point ────────────────────────────────────────────────
    async function render(app, _opts) {
        injectCss();
        await ensureLoaded();

        const baseDag = (window.Nodes && window.Nodes.FLOW_DAG)
            ? window.Nodes.FLOW_DAG
            : null;

        if (!baseDag) {
            app.innerHTML = `<div id="explore-root">
                <div class="ex-head">
                    <span class="ex-head-title">Explore</span>
                    <span class="ex-head-spacer"></span>
                    <a href="#/map">map →</a>
                </div>
                <div style="padding:24px;color:var(--text-muted);">
                    FLOW_DAG not available — make sure <code>nodes.js</code>
                    loads before <code>explore.js</code>.
                </div>
            </div>`;
            return;
        }

        const dag = buildExtendedDag(baseDag);
        // Try the cross-refresh cache first. On hit (graph unchanged
        // since last run) propagation is skipped entirely; on miss we
        // compute and persist for next time.
        const fp = _reachFingerprint();
        const cached = fp ? _loadCachedReach(fp) : null;
        if (cached) {
            _reachByKey = cached;
        } else {
            _reachByKey = buildReachByKey(dag);
            if (fp && _reachByKey) _saveCachedReach(fp, _reachByKey);
        }
        // Surface dead-end findings as red flow edges into the
        // deadend node — one per slot whose continuing outputs no
        // child accepts. The pre-existing dashed `placement-deadend`
        // edge from the rightmost slot stays in place for layout;
        // these solid red edges sit on top of it.
        const deadInfo = _reachByKey ? _reachByKey.get('deadend') : null;
        if (deadInfo && deadInfo.sources && deadInfo.sources.size) {
            for (const [src, count] of deadInfo.sources) {
                if (count > 0) dag.edges.push([src, 'deadend', 'flow-deadend']);
            }
        }
        const slotByKey = new Map();
        for (const n of dag.nodes) slotByKey.set(n.key, n);

        app.innerHTML = `<div id="explore-root">
            <div class="ex-head">
                <span class="ex-head-title">Explore — narrative flow</span>
                <a href="#/nodes">nodes →</a>
                <span class="ex-head-spacer"></span>
                <button class="ex-toolbtn" data-action="reset">Reset view</button>
                <a href="#/map">map →</a>
            </div>
            <div class="ex-body">
                <div class="ex-canvas">
                    <div class="ex-viewport">${renderFlow(dag)}</div>
                </div>
                <div class="ex-divider" role="separator" aria-orientation="vertical" title="Drag to resize"></div>
                <aside class="ex-sidebar" data-empty="true">
                    <div class="ex-sb-empty">
                        Click any card to inspect its details here.
                    </div>
                </aside>
            </div>
        </div>`;

        const root = app.querySelector('#explore-root');
        const sidebar = root.querySelector('.ex-sidebar');
        wireSidebarResize(root, sidebar);
        const handles = wireCanvas(root, dag);
        const tplById = new Map(templates.map(t => [t.id, t]));

        let selectedKey = null;
        const persistSelected = (key) => {
            try {
                if (key) localStorage.setItem(SELECTED_LS_KEY, key);
                else localStorage.removeItem(SELECTED_LS_KEY);
            } catch (_e) { /* ignore quota / disabled storage */ }
        };
        const selectCard = (key, opts) => {
            const persist = !opts || opts.persist !== false;
            const slot = key ? slotByKey.get(key) : null;
            if (!slot) {
                selectedKey = null;
                if (persist) persistSelected(null);
                root.querySelectorAll('.ex-card.is-selected').forEach(el => el.classList.remove('is-selected'));
                sidebar.dataset.empty = 'true';
                sidebar.innerHTML = `<div class="ex-sb-empty">Click any card to inspect its details here.</div>`;
                return;
            }
            selectedKey = slot.key;
            if (persist) persistSelected(slot.key);
            root.querySelectorAll('.ex-card.is-selected').forEach(el => el.classList.remove('is-selected'));
            const cardEl = root.querySelector(`.ex-card[data-flow-key="${cssEscape(slot.key)}"]`);
            if (cardEl) cardEl.classList.add('is-selected');
            sidebar.dataset.empty = 'false';
            sidebar.innerHTML = sidebarHtml(slot, tplById, dag);
            sidebar.scrollTop = 0;
        };

        root.addEventListener('click', (e) => {
            const reset = e.target.closest && e.target.closest('[data-action="reset"]');
            if (reset && handles && handles.fit) {
                e.preventDefault();
                handles.fit();
                return;
            }
            const card = e.target.closest && e.target.closest('.ex-card[data-flow-key]');
            if (card) {
                const key = card.dataset.flowKey;
                selectCard(key === selectedKey ? null : key);
            }
        });

        // Restore last selection across reloads. The lookup via slotByKey
        // silently no-ops if the saved key is gone (graph reshuffled,
        // outcome renamed, etc.), so a stale entry can't break the view.
        try {
            const saved = localStorage.getItem(SELECTED_LS_KEY);
            if (saved && slotByKey.has(saved)) selectCard(saved, { persist: false });
        } catch (_e) { /* ignore */ }
    }

    // CSS.escape isn't always available on older browsers; tiny shim.
    function cssEscape(s) {
        if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(s);
        return String(s).replace(/([^a-zA-Z0-9_-])/g, '\\$1');
    }

    window.Explore = { render };
})();
