(function () {
    'use strict';

    const CSS = `
        #explore-root {
            position: fixed; inset: 0; background: var(--bg); color: var(--text);
            overflow: hidden; font-family: inherit;
        }
        #explore-root .explore-toolbar {
            position: absolute; top: 12px; left: 12px; z-index: 10;
            display: flex; gap: 8px; align-items: center;
            background: var(--bg-soft); padding: 8px 12px; border: 1px solid var(--border);
            border-radius: 8px; font-size: 13px;
        }
        #explore-root .explore-toolbar button {
            background: transparent; color: var(--text); border: 1px solid var(--border);
            border-radius: 6px; padding: 4px 10px; cursor: pointer; font-size: 12px;
        }
        #explore-root .explore-toolbar button:hover { background: var(--bg); }
        #explore-root .explore-toolbar .explore-stats { color: var(--text-muted); margin-left: 8px; }
        #explore-root .explore-canvas {
            position: absolute; inset: 0; overflow: hidden; cursor: grab;
        }
        #explore-root .explore-canvas.dragging { cursor: grabbing; }
        #explore-root .explore-viewport {
            position: absolute; top: 0; left: 0;
            transform-origin: 0 0;
            will-change: transform;
        }
        #explore-root svg.explore-edges {
            position: absolute; top: 0; left: 0; overflow: visible;
            pointer-events: none;
        }
        #explore-root svg.explore-edges path {
            fill: none; stroke: var(--border); stroke-width: 1.5;
        }
        #explore-root svg.explore-edges path.explore-edge-hi {
            stroke: var(--accent, #6b9bd1); stroke-width: 2;
        }
        #explore-root .explore-node {
            position: absolute;
            min-width: 220px; max-width: 260px;
            background: var(--bg-soft);
            border: 1px solid var(--border);
            border-radius: 8px;
            padding: 10px 12px;
            font-size: 12px; line-height: 1.35;
            box-shadow: 0 2px 6px rgba(0,0,0,0.15);
            user-select: none;
            cursor: grab;
        }
        #explore-root .explore-node.is-dragging { cursor: grabbing; z-index: 100; }
        #explore-root .explore-node.is-pinned::after {
            content: '📌'; position: absolute; top: -6px; right: -4px;
            font-size: 10px; opacity: 0.7;
        }
        #explore-root .explore-node.is-root { border-color: var(--accent, #6b9bd1); }
        #explore-root .explore-node.is-outcome { border-color: #b3895e; background: rgba(179,137,94,0.08); }
        #explore-root .explore-node.is-deadend { border-color: #c76a6a; background: rgba(199,106,106,0.08); }
        #explore-root .explore-node.is-module {
            border-color: #8a6bbf; background: rgba(138,107,191,0.10);
            border-style: double; border-width: 3px; padding: 8px 10px;
        }
        #explore-root .explore-node.is-module .explore-node-title { color: #b99ef0; }
        #explore-root .explore-node.is-module .explore-module-badge {
            display: inline-block; font-size: 9px; text-transform: uppercase;
            letter-spacing: 0.08em; color: #b99ef0; background: rgba(138,107,191,0.18);
            border: 1px solid rgba(138,107,191,0.4); border-radius: 3px;
            padding: 0 4px; margin-right: 6px; font-weight: 600;
        }
        #explore-root .explore-node.is-module .explore-module-io {
            font-size: 9px; color: var(--text-muted); margin-bottom: 6px;
            font-family: ui-monospace, 'SF Mono', Consolas, monospace;
        }
        #explore-root .explore-node.is-module .explore-module-io code {
            background: rgba(0,0,0,0.2); padding: 0 3px; border-radius: 2px;
        }
        #explore-root .explore-edge-subhead {
            font-size: 8px; text-transform: uppercase; letter-spacing: 0.08em;
            color: var(--text-muted); padding: 6px 4px 2px; opacity: 0.75;
        }
        #explore-root .explore-edge-subhead:first-child { padding-top: 2px; }
        #explore-root .explore-edge-row.is-module-enter { font-style: italic; }
        #explore-root .explore-edge-row.is-module-enter .explore-edge-label { color: #b99ef0; }
        /* Module cluster: translucent region drawn behind the internal
         * nodes of an expanded module. */
        #explore-root .explore-cluster {
            fill: rgba(138,107,191,0.08);
            stroke: rgba(138,107,191,0.45);
            stroke-width: 1.5;
            stroke-dasharray: 6 4;
            rx: 10; ry: 10;
        }
        #explore-root .explore-cluster-label {
            fill: #b99ef0;
            font-size: 10px; font-weight: 600;
            text-transform: uppercase; letter-spacing: 0.1em;
            font-family: ui-monospace, 'SF Mono', Consolas, monospace;
        }
        #explore-root .explore-detail .explore-module-table {
            width: 100%; border-collapse: collapse; font-size: 10px;
            font-family: ui-monospace, 'SF Mono', Consolas, monospace;
        }
        #explore-root .explore-detail .explore-module-table th,
        #explore-root .explore-detail .explore-module-table td {
            padding: 3px 6px; border-bottom: 1px solid var(--border);
            text-align: left; vertical-align: top;
        }
        #explore-root .explore-detail .explore-module-table th {
            color: var(--text-muted); font-weight: 600;
            text-transform: uppercase; letter-spacing: 0.04em; font-size: 9px;
        }
        #explore-root .explore-detail .explore-module-table td.dim-empty { color: var(--text-muted); opacity: 0.4; }
        #explore-root .explore-node.has-unchecked { background: #ffffff; color: #111; }
        #explore-root .explore-node.has-unchecked .explore-node-title,
        #explore-root .explore-node.has-unchecked .explore-edge-row { color: #111; }
        #explore-root .explore-node.has-unchecked .explore-edge-row:hover { background: rgba(0,0,0,0.06); }
        #explore-root .explore-node.has-unchecked .explore-edge-row.is-expanded { background: rgba(107,155,209,0.25); color: #111; }
        #explore-root .explore-node.has-unchecked .explore-edge-row.is-disabled { color: #888; }
        #explore-root .explore-node.has-unchecked .explore-edge-chevron { color: #888; }
        #explore-root .explore-node.has-unchecked .explore-node-depth { color: #666; }
        #explore-root .explore-node.is-selected { outline: 2px solid var(--accent, #6b9bd1); outline-offset: 2px; }
        #explore-root .explore-node-header {
            font-weight: 600; font-size: 12px; color: var(--text);
            margin-bottom: 6px; cursor: pointer;
            display: flex; justify-content: space-between; align-items: baseline; gap: 6px;
        }
        #explore-root .explore-node-header .explore-node-depth {
            font-weight: 400; font-size: 10px; color: var(--text-muted);
        }
        #explore-root .explore-node-title { color: var(--text); }
        #explore-root .explore-node.is-outcome .explore-node-title { color: #b3895e; }
        #explore-root .explore-node.is-deadend .explore-node-title { color: #c76a6a; }
        #explore-root .explore-node-edges { display: flex; flex-direction: column; gap: 3px; }
        #explore-root .explore-edge-row {
            display: flex; align-items: center; gap: 6px;
            padding: 3px 6px; border-radius: 4px;
            cursor: pointer; font-size: 11px; color: var(--text);
            position: relative;
        }
        #explore-root .explore-edge-row:hover { background: var(--bg); }
        #explore-root .explore-edge-row.is-expanded { background: rgba(107,155,209,0.15); color: var(--text); }
        #explore-root .explore-edge-row.is-disabled { color: var(--text-muted); opacity: 0.5; cursor: not-allowed; }
        #explore-root .explore-edge-row.is-disabled:hover { background: transparent; opacity: 0.7; }
        #explore-root .explore-edge-row .explore-edge-chevron {
            width: 10px; text-align: center; font-family: monospace; font-size: 10px; color: var(--text-muted);
        }
        #explore-root .explore-edge-row.is-expanded .explore-edge-chevron { color: var(--accent, #6b9bd1); }
        /* Hover tooltip for disabled edges — immediate, no native-title delay. */
        #explore-root .explore-edge-tooltip {
            position: absolute; left: 100%; top: 50%; transform: translate(8px, -50%);
            background: #1a1a1a; color: #f0f0f0; opacity: 1;
            font-size: 10px; line-height: 1.3; font-weight: 400;
            padding: 5px 8px; border-radius: 4px;
            border: 1px solid rgba(255,255,255,0.15);
            box-shadow: 0 2px 8px rgba(0,0,0,0.4);
            max-width: 220px; white-space: normal;
            pointer-events: none;
            visibility: hidden;
            z-index: 1000;
        }
        #explore-root .explore-edge-tooltip::before {
            content: ''; position: absolute; right: 100%; top: 50%;
            transform: translateY(-50%);
            border: 5px solid transparent;
            border-right-color: #1a1a1a;
        }
        #explore-root .explore-edge-row:hover > .explore-edge-tooltip { visibility: visible; }
        #explore-root .explore-dims {
            font-size: 10px; color: var(--text-muted);
            margin-top: 6px; padding-top: 6px; border-top: 1px dashed var(--border);
            font-family: ui-monospace, 'SF Mono', Consolas, monospace;
        }
        #explore-root .explore-dim-chip {
            display: inline-block; margin: 1px 3px 1px 0; padding: 1px 5px;
            background: var(--bg); border-radius: 3px; font-size: 10px;
        }
        #explore-root .explore-dim-chip.is-derived { color: var(--accent, #6b9bd1); }
        #explore-root .explore-dim-chip.explore-dim-flavor { color: var(--fg-dim, #888); font-style: italic; }
        #explore-root .explore-detail {
            position: absolute; top: 12px; right: 12px; z-index: 10;
            background: var(--bg-soft); border: 1px solid var(--border); border-radius: 8px;
            padding: 12px; max-width: 320px; max-height: calc(100vh - 24px); overflow-y: auto;
            font-size: 12px; line-height: 1.4;
        }
        #explore-root .explore-detail h3 { margin: 0 0 6px 0; font-size: 13px; }
        #explore-root .explore-detail .explore-detail-section { margin-top: 10px; }
        #explore-root .explore-detail .explore-detail-section h4 {
            margin: 0 0 4px 0; font-size: 11px; font-weight: 600;
            color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px;
        }
        #explore-root .explore-detail code {
            font-family: ui-monospace, 'SF Mono', Consolas, monospace;
            font-size: 11px; background: var(--bg); padding: 1px 4px; border-radius: 3px;
        }
        #explore-root .explore-detail a { color: var(--accent, #6b9bd1); }
        #explore-root .explore-copy-btn {
            margin-left: 8px; padding: 2px 8px; font-size: 11px;
            background: var(--bg); color: var(--text); border: 1px solid var(--border, #444);
            border-radius: 3px; cursor: pointer;
        }
        #explore-root .explore-copy-btn:hover { background: var(--bg-hover, rgba(255,255,255,0.05)); }
        #explore-root .explore-copy-btn.is-copied { color: var(--accent, #6b9bd1); border-color: var(--accent, #6b9bd1); }

        /* ─── Show All Connections overlay ──────────────────────────
         * Full-bleed flow-DAG view (reuses window.Nodes.FLOW_DAG). Sits
         * on top of the normal path-exploration canvas, toggled by the
         * toolbar button. Separate localStorage key for pan/zoom so it
         * doesn't clash with the path explorer or with /nodes Flow.
         * Cards use the .ec-* prefix ("explore-connections").          */
        #explore-root .explore-connections {
            position: absolute; inset: 0; z-index: 5;
            background: var(--bg);
            overflow: hidden; cursor: grab;
        }
        #explore-root .explore-connections.dragging { cursor: grabbing; }
        #explore-root .explore-connections-viewport {
            position: absolute; top: 0; left: 0;
            transform-origin: 0 0; will-change: transform;
        }
        #explore-root .ec-flow {
            display: flex; gap: 64px; padding: 32px;
            align-items: flex-start;
        }
        #explore-root .ec-col {
            display: flex; flex-direction: column; gap: 40px;
        }
        #explore-root svg.ec-edges {
            position: absolute; top: 0; left: 0; overflow: visible;
            pointer-events: none; color: var(--border);
        }
        /* Direct-child selector (>) so this rule doesn't reach into
         * the <marker> triangles inside <defs> — they need to keep
         * their hardcoded fill so colored arrowheads actually render
         * as solid triangles instead of empty currentColor outlines. */
        #explore-root svg.ec-edges > path {
            fill: none; stroke: currentColor; stroke-width: 1.5;
        }
        #explore-root svg.ec-edges path.is-outcome-link {
            stroke: #b3895e; stroke-dasharray: 6 4; stroke-width: 2;
            opacity: 0.9;
        }
        /* Live arrow: from a committed cell row to its currently-active
         * downstream slot — the "path you've walked" in the guided
         * traversal. The stroke color is set inline per-arrow (see
         * EC_LIVE_PALETTE) so simultaneous picks each get their own
         * hue; stroke-width/opacity stay in CSS as shared defaults. */
        #explore-root svg.ec-edges path.is-live {
            stroke-width: 2.5; opacity: 0.95;
        }
        /* Fan-out: the secondary arrows inside a downstream card,
         * landing point → each cell row this pick specifically
         * unlocks. Same color as the main arrow, thinner and more
         * transparent so the primary card-to-card arrow still reads
         * as the dominant visual. */
        #explore-root svg.ec-edges path.is-live-fanout {
            stroke-width: 1.25; opacity: 0.8;
        }
        /* Faded = a base FLOW_DAG arrow whose parent has a committed
         * cell AND whose child is active — the live arrow takes over
         * that visual channel, so the base arrow fades back. */
        #explore-root svg.ec-edges path.is-faded {
            opacity: 0.2;
        }

        /* Outer card: mirrors .explore-node visual weight so module
         * cards read as the same object as in the path explorer. The
         * inner HTML reuses .explore-module-io / .explore-edge-row so
         * it inherits all the regular-explore module styling for free.
         * The path explorer's .explore-node is absolute-positioned, so
         * .ec-card is a new wrapper with flex-friendly layout.            */
        #explore-root .ec-card {
            min-width: 240px; max-width: 280px;
            border: 1px solid var(--border); border-radius: 8px;
            background: var(--bg-soft);
            padding: 10px 12px 0;
            font-size: 12px; line-height: 1.35;
            box-shadow: 0 2px 6px rgba(0,0,0,0.15);
            position: relative;
        }
        /* Module cards: purple double-border signals "this is a module"
         * without tinting the background — otherwise, since most slots in
         * FLOW_DAG are modules, the whole overlay would read as a wall of
         * purple. Keep the background neutral (same as plain nodes) so
         * cards look like normal modules, just pre-instantiated. */
        #explore-root .ec-card.is-module {
            border-color: #8a6bbf;
            border-style: double; border-width: 3px; padding: 8px 10px 0;
        }
        #explore-root .ec-card.is-node { border-color: var(--border); }
        #explore-root .ec-card-head {
            display: flex; gap: 6px; align-items: baseline; margin-bottom: 4px;
        }
        #explore-root .ec-card-title {
            font-weight: 600; font-size: 13px; color: var(--text);
        }
        #explore-root .ec-card.is-module .ec-card-title { color: #b99ef0; }
        #explore-root .ec-card-slotnote {
            font-size: 10px; color: var(--text-muted); margin-left: auto;
            font-style: italic;
        }
        #explore-root .ec-card-label {
            font-size: 11px; color: var(--text-muted); margin-bottom: 4px;
        }
        #explore-root .ec-stepinto {
            display: block; margin: 4px 0 6px;
            font-size: 11px; color: #b99ef0; text-decoration: none;
            padding: 3px 6px; border-radius: 4px;
            border: 1px dashed rgba(138,107,191,0.5);
            background: rgba(138,107,191,0.08);
        }
        #explore-root .ec-stepinto:hover {
            background: rgba(138,107,191,0.18); color: #d5c2f5;
            border-color: rgba(138,107,191,0.75);
        }
        #explore-root .ec-node-link {
            display: inline-block; font-size: 11px;
            color: var(--text-muted); text-decoration: none;
            padding: 2px 6px; border-radius: 4px;
            border: 1px solid var(--border); margin: 2px 0;
        }
        #explore-root .ec-node-link:hover { color: var(--text); background: var(--bg); }
        #explore-root .ec-outcomes {
            margin: 8px -12px 0; padding: 6px 10px 8px;
            border-top: 1px dashed rgba(179,137,94,0.5);
            background: rgba(179,137,94,0.08);
            border-bottom-left-radius: 6px; border-bottom-right-radius: 6px;
        }
        #explore-root .ec-outcomes-head {
            font-size: 9px; text-transform: uppercase; letter-spacing: 0.08em;
            color: #c9a473; margin-bottom: 4px;
        }
        #explore-root .ec-outcome {
            display: inline-block;
            font-family: ui-monospace, 'SF Mono', Consolas, monospace;
            font-size: 10px;
            padding: 2px 6px; margin: 1px 2px 1px 0;
            border-radius: 4px;
            background: rgba(179,137,94,0.18);
            color: #c9a473; cursor: pointer;
            border: 1px solid transparent;
        }
        #explore-root .ec-outcome:hover {
            background: rgba(179,137,94,0.32);
            border-color: rgba(179,137,94,0.55);
        }
        #explore-root .ec-outcome.is-selected {
            background: #b3895e; color: #fff; font-weight: 600;
            border-color: #d9ae82;
        }
        #explore-root .ec-outcome.is-linked {
            background: rgba(179,137,94,0.55); color: #fff;
            border-color: rgba(179,137,94,0.75);
        }
        /* Narrative outcome pill matched by the current sel's reachable
         * clause — the guided traversal has committed the user into
         * this terminal narrative state. */
        #explore-root .ec-outcome.is-reached {
            background: #5f8a52; color: #fff;
            border-color: #7cae6b; font-weight: 600;
        }
        /* Dim non-linked cards when an outcome is selected, to draw the
         * eye to the connected ones. Applied on the container via
         * [data-ec-selected] attribute. */
        #explore-root .explore-connections[data-ec-selected] .ec-card:not(.has-linked) {
            opacity: 0.45;
        }
        /* Inactive card = slot whose activateWhen isn't satisfied by
         * the overlay's current sel AND hasn't been walked through yet.
         * Visible but muted so the reachable-from-here cards stand out. */
        #explore-root .ec-card.is-inactive { opacity: 0.4; }
        /* Visited = at least one cell on this card has been committed.
         * Just a subtle accent — doesn't compete with is-committed on
         * the row itself. */
        #explore-root .ec-card.is-visited {
            box-shadow: 0 2px 6px rgba(0,0,0,0.15), 0 0 0 1px rgba(107,155,209,0.35);
        }
        /* A committed cell row — the user clicked it, its writes are
         * in state.sel. */
        #explore-root .ec-cell-row.is-committed {
            background: rgba(107,155,209,0.22);
            color: var(--text);
            font-weight: 600;
        }
        #explore-root .ec-cell-row.is-committed .explore-edge-chevron {
            color: var(--accent, #6b9bd1);
        }
        #explore-root .ec-cell-row:hover {
            background: rgba(255,255,255,0.06);
        }
        /* Outcome card: terminal narrative endings (the-ruin, the-plateau,
         * etc) get their own visual node with arrows from the slots whose
         * earlyExits list them. Copper accent matches the legacy outcome-pill
         * palette so the visual identity carries over. */
        #explore-root .ec-card.is-outcome {
            min-width: 180px; max-width: 220px;
            border-color: rgba(179,137,94,0.6);
            background: rgba(179,137,94,0.08);
        }
        #explore-root .ec-card.is-outcome .ec-card-title { color: #c9a473; }
        #explore-root .ec-card.is-outcome.is-reached {
            border-color: #7cae6b;
            background: rgba(95,138,82,0.18);
        }
        #explore-root .ec-card.is-outcome.is-reached .ec-card-title {
            color: #b6d3a8;
        }
        /* Dead-end card: catch-all for branches whose derived sel matches
         * no outcome template AND has no askable next question. Single
         * shared node, lit up only when at least one branch lands here. */
        #explore-root .ec-card.is-deadend {
            min-width: 180px; max-width: 220px;
            border-color: rgba(180,90,90,0.55);
            background: rgba(180,90,90,0.08);
        }
        #explore-root .ec-card.is-deadend .ec-card-title { color: #d28a8a; }
        #explore-root .ec-card.is-deadend.is-reached {
            border-color: #d96b6b;
            background: rgba(217,107,107,0.18);
        }
        #explore-root .ec-toolbar {
            position: absolute; top: 12px; right: 12px; z-index: 10;
            display: flex; gap: 8px; align-items: center;
            background: var(--bg); padding: 6px 10px; border-radius: 6px;
            border: 1px solid var(--border);
            font-size: 11px; color: var(--text-muted);
        }
        #explore-root .ec-toolbar button {
            background: transparent; color: var(--text-muted);
            border: 1px solid var(--border); border-radius: 4px;
            padding: 3px 8px; font-size: 11px; cursor: pointer;
        }
        #explore-root .ec-toolbar button:hover {
            color: var(--text); border-color: var(--text-muted);
        }
        #explore-root .ec-toolbar button:disabled {
            opacity: 0.4; cursor: default;
        }
    `;

    function injectCSS() {
        if (document.getElementById('explore-css')) return;
        const s = document.createElement('style');
        s.id = 'explore-css';
        s.textContent = CSS;
        document.head.appendChild(s);
    }

    let templates = [];
    let narrative = null;
    let loaded = false;

    async function ensureLoaded() {
        if (loaded) return;
        const bust = '?v=' + Date.now();
        const [o, n] = await Promise.all([
            fetch('data/outcomes.json' + bust).then(r => r.json()),
            fetch('data/narrative.json' + bust).then(r => r.json())
        ]);
        templates = o.templates;
        narrative = n;
        for (const [nodeId, narr] of Object.entries(narrative)) {
            if (nodeId === '_stages') continue;
            const node = window.Engine.NODE_MAP[nodeId];
            if (!node) continue;
            if (narr.questionText) node.questionText = narr.questionText;
            if (narr.values) {
                for (const [edgeId, vn] of Object.entries(narr.values)) {
                    const v = node.edges && node.edges.find(vv => vv.id === edgeId);
                    if (v && !v._exploreEnriched) {
                        Object.assign(v, vn);
                        v._exploreEnriched = true;
                    }
                }
            }
        }
        loaded = true;
    }

    function selKey(sel) {
        const keys = Object.keys(sel).sort();
        if (!keys.length) return '<root>';
        return keys.map(k => k + '=' + sel[k]).join('|');
    }

    // ─── Module-as-atomic-edge (Phase 5 /explore rendering) ───
    // Mirror of graph-walker.js's module short-circuit: when a module's
    // activateWhen fires and its completion marker is unset, render it as
    // one explore-node whose edges are the reducer's pre-computed cells.
    // Clicking a cell applies its writes bundle in one step, skipping the
    // internal decel_*mo_* question walk.

    const _MODULES = (window.Graph && window.Graph.MODULES) || [];
    const _MODULE_MAP = {};
    for (const m of _MODULES) _MODULE_MAP[m.id] = m;
    const _MODULE_COMPLETION_MARKER = {};
    const _MODULE_SYNTHETIC_NODES = {};

    function _moduleCompletionMarker(mod) {
        if (mod.completionMarker) return mod.completionMarker;
        const writes = mod.writes || [];
        for (const w of writes) if (w.startsWith(mod.id + '_')) return w;
        return writes[writes.length - 1];
    }
    // Marker can be a string dim name ("module done iff sel[dim] defined")
    // or an object { dim, values } ("module done iff sel[dim] ∈ values").
    function _isMarkerSatisfied(marker, sel) {
        if (!marker) return false;
        if (typeof marker === 'string') return sel[marker] !== undefined;
        const v = sel[marker.dim];
        return v !== undefined && marker.values.indexOf(v) !== -1;
    }

    function _buildModuleSyntheticNode(mod) {
        const edges = [];
        if (mod.reducerTable) {
            // The completion marker isn't part of the reducerTable's
            // raw `set` blocks — it's only added inside the module's
            // exitPlan (`buildDecelExitPlan` etc.). The /explore overlay
            // bypasses the exitPlan and reads the reducerTable directly,
            // so without re-adding the marker here the cell's writes
            // would commit `{alignment, governance, decel_align_progress}`
            // and leave `decel_set` unset. That makes downstream priority-
            // winner DFS (`isNodeVisible` doesn't check completion) keep
            // surfacing already-answered internals like `decel_2mo_progress`
            // as the "next" pick, so live arrows never draw to the actual
            // next module. String markers commit "yes" by convention; object
            // markers ({dim, values}) commit the first allowed value.
            const marker = mod.completionMarker;
            const markerDim = typeof marker === 'string'
                ? marker
                : (marker && marker.dim) || null;
            const markerValue = typeof marker === 'string'
                ? 'yes'
                : (marker && marker.values && marker.values[0]) || null;
            for (const [action, progressMap] of Object.entries(mod.reducerTable)) {
                for (const [progress, cell] of Object.entries(progressMap)) {
                    const writes = {};
                    if (markerDim && markerValue && cell[markerDim] === undefined) {
                        writes[markerDim] = markerValue;
                    }
                    for (const k of Object.keys(cell)) {
                        if (k.startsWith('_')) continue;
                        writes[k] = cell[k];
                    }
                    edges.push({
                        id: action + '__' + progress,
                        label: action + ' — ' + progress,
                        _moduleWrites: writes,
                        _moduleAction: action,
                        _moduleProgress: progress,
                    });
                }
            }
        }
        // Escape hatch: an extra edge that enters the module's internal
        // question walk as real DAG nodes. The child DAG node inherits the
        // same sel but is flagged `moduleExpanded = mod.id`, which makes
        // findNextQ skip the atomic short-circuit for that branch so the
        // user can click through `decel_2mo_progress`, `decel_2mo_action`,
        // etc. as normal nodes. All such nodes live visually inside the
        // module's cluster bounding box.
        edges.push({
            id: '__enter__',
            label: 'Step into module ▸',
            _moduleEnter: true,
        });
        return {
            id: '__module__' + mod.id,
            label: 'Module: ' + mod.id,
            _module: mod,
            edges,
        };
    }

    for (const m of _MODULES) {
        _MODULE_COMPLETION_MARKER[m.id] = _moduleCompletionMarker(m);
        _MODULE_SYNTHETIC_NODES[m.id] = _buildModuleSyntheticNode(m);
    }

    // Exposed so explore-tables.js can route module slots to the same
    // synthetic-node / dynamic-DFS enumerators the path explorer uses,
    // without duplicating the (non-trivial) reducer-marker bookkeeping
    // and dim-projection logic. Static across the page lifetime; both
    // entries hand back data structures (edges array / cells Map) that
    // ExploreTables caches per-slot.
    window._ExploreInternals = {
        buildModuleSyntheticNode: _buildModuleSyntheticNode,
        dynamicCellEnumerate: _dynamicCellEnumerate,
    };

    // Every node id that belongs to SOME module's internal walk. Used by
    // findNextQ to identify "flat" nodes — questions that live outside
    // all modules and should interleave with module boundaries based on
    // NODES-array order (same way the main-UI displayOrder does it).
    const _MODULE_INTERNAL_NODE_IDS = new Set();
    for (const m of _MODULES) {
        for (const nid of (m.nodeIds || [])) _MODULE_INTERNAL_NODE_IDS.add(nid);
    }

    // Cache: for each module, the smallest NODES-array index among its
    // internal node ids. A pending flat node whose index < this value
    // should be asked BEFORE the module hub is returned, so questions
    // like `alignment` (line ~407) are asked between CONTROL (last
    // internal node ~line 387) and PROLIFERATION (first internal node
    // ~line 767) rather than being pre-empted by the proliferation hub.
    const _MODULE_FIRST_NODE_INDEX = {};
    function _computeModuleFirstIndex(mod) {
        if (_MODULE_FIRST_NODE_INDEX[mod.id] != null) return _MODULE_FIRST_NODE_INDEX[mod.id];
        const NODES = window.Engine.NODES;
        let best = Infinity;
        for (let i = 0; i < NODES.length; i++) {
            if (mod.nodeIds && mod.nodeIds.includes(NODES[i].id)) {
                if (i < best) best = i;
            }
        }
        _MODULE_FIRST_NODE_INDEX[mod.id] = best;
        return best;
    }

    function _moduleActivateWhenMatches(sel, mod) {
        const conds = mod.activateWhen;
        if (!conds || !conds.length) return true;
        const E = window.Engine;
        for (const cond of conds) {
            let ok = true;
            for (const [k, v] of Object.entries(cond)) {
                if (k === 'reason' || k.startsWith('_')) continue;
                const cur = E.resolvedVal ? E.resolvedVal(sel, k) : sel[k];
                if (Array.isArray(v)) { if (!v.includes(cur)) { ok = false; break; } }
                else if (v === true) { if (!cur) { ok = false; break; } }
                else if (v === false) { if (cur) { ok = false; break; } }
                else if (v && v.not) { if (v.not.includes(cur)) { ok = false; break; } }
                else if (cur !== v) { ok = false; break; }
            }
            if (ok) return true;
        }
        return false;
    }

    function pendingModule(sel) {
        for (const m of _MODULES) {
            const marker = _MODULE_COMPLETION_MARKER[m.id];
            if (_isMarkerSatisfied(marker, sel)) continue;
            if (_moduleActivateWhenMatches(sel, m)) return m;
        }
        return null;
    }

    // ─── Per-input cell reachability ───
    // Enumerate which reducer cells a given pre-module sel can reach by
    // simulating the module's internal walk (DFS over its own nodeIds).
    // A cell (action, progress) is reachable iff some branch of the walk
    // arrives at an `_action` node whose edge id matches `action` while the
    // sibling `_progress` is `progress`, AND that (action, progress) tuple
    // exists in the reducerTable (which makes it an exit, not a continue).
    const _cellReachCache = new Map();

    function enumerateModuleCells(mod, inputSel) {
        if (!mod.reducerTable) return new Set();
        const cacheKey = mod.id + '|' + selKey(inputSel);
        const cached = _cellReachCache.get(cacheKey);
        if (cached) return cached;
        const E = window.Engine;
        const reachable = new Set();
        const marker = _MODULE_COMPLETION_MARKER[mod.id];
        const seen = new Set();
        const stack = [inputSel];
        const MAX_STATES = 2000;
        let count = 0;
        while (stack.length && count++ < MAX_STATES) {
            const sel = stack.pop();
            const k = selKey(sel);
            if (seen.has(k)) continue;
            seen.add(k);
            if (_isMarkerSatisfied(marker, sel)) continue;
            let nextNode = null;
            for (const nodeId of mod.nodeIds || []) {
                const node = E.NODE_MAP[nodeId];
                if (!node || node.derived) continue;
                if (sel[node.id] !== undefined) continue;
                if (!E.isNodeVisible(sel, node)) continue;
                nextNode = node;
                break;
            }
            if (!nextNode || !nextNode.edges) continue;
            for (const edge of nextNode.edges) {
                if (E.isEdgeDisabled(sel, nextNode, edge)) continue;
                // Is this an exit edge? Only _action nodes exit via reducer cells.
                let exited = false;
                if (nextNode.id.endsWith('_action')) {
                    const monthPrefix = nextNode.id.replace(/_action$/, '');
                    const progressKey = monthPrefix + '_progress';
                    const progress = sel[progressKey];
                    const action = edge.id;
                    if (progress != null && mod.reducerTable[action] && mod.reducerTable[action][progress]) {
                        reachable.add(action + '__' + progress);
                        exited = true;
                    }
                }
                if (!exited) stack.push({ ...sel, [nextNode.id]: edge.id });
            }
        }
        _cellReachCache.set(cacheKey, reachable);
        return reachable;
    }

    function cellReachableFromSel(inputSel, mod, cellEdge) {
        if (!cellEdge._moduleWrites) return true;
        if (mod.reducerTable) {
            return enumerateModuleCells(mod, inputSel).has(cellEdge.id);
        }
        // Dynamic-cell module: reachability = membership in the dynamic
        // enumeration from this specific input sel.
        return _dynamicCellEnumerate(mod, inputSel).has(cellEdge.id);
    }

    // ─── Dynamic atomic-cell enumeration for non-reducerTable modules ───
    // For modules like emergence / rollout / escape / who_benefits, there's
    // no pre-declared reducer table — the set of "atomic outcomes" is
    // whatever distinct post-exit sel states you can DFS into from a given
    // input. Each unique writes-bundle (projected onto mod.writes + marker)
    // becomes one clickable cell. Cells are computed per-input (so plateau
    // vs main-path rollout entries contribute different cell sets) and
    // unioned on the hub node.
    //
    // Cells here are DELTAS from inputSel — clicking the cell applies
    // `parentSel ∪ _moduleWrites` which reconstructs the post-exit sel.
    // Dims moved to flavor during the internal walk are not recorded (same
    // semantics as decel's reducer cells — atomic = no flavor narrative).
    const _dynamicCellCache = new Map();

    const _moduleOwnedDimsCache = new Map();
    function _ecModuleOwnedDims(mod) {
        let owned = _moduleOwnedDimsCache.get(mod.id);
        if (owned) return owned;
        owned = new Set();
        for (const d of (mod.writes || [])) owned.add(d);
        for (const d of (mod.nodeIds || [])) owned.add(d);
        for (const d of (mod.internalMarkers || [])) owned.add(d);
        if (typeof mod.completionMarker === 'string') {
            owned.add(mod.completionMarker);
        } else if (mod.completionMarker && mod.completionMarker.dim) {
            owned.add(mod.completionMarker.dim);
        }
        _moduleOwnedDimsCache.set(mod.id, owned);
        return owned;
    }

    function _dynamicCellEnumerate(mod, inputSel) {
        if (mod.reducerTable) return new Map();
        const E = window.Engine;
        const cacheKey = mod.id + '|' + selKey(inputSel);
        const cached = _dynamicCellCache.get(cacheKey);
        if (cached) return cached;
        const results = new Map();
        if (!E) { _dynamicCellCache.set(cacheKey, results); return results; }
        const marker = _MODULE_COMPLETION_MARKER[mod.id];
        const debug = (typeof window !== 'undefined') && (window.__EC_DEBUG_DFS__ === mod.id);
        const seen = new Set();
        const stack = [{ ...inputSel }];
        const MAX = 10000;
        let count = 0;
        if (debug) {
            console.groupCollapsed('[ec-dfs:' + mod.id + '] inputSel ' + selKey(inputSel));
        }
        while (stack.length && count++ < MAX) {
            const sel = stack.pop();
            const k = selKey(sel);
            if (seen.has(k)) continue;
            seen.add(k);
            // Find next askable internal node BEFORE checking exit — some
            // exit tuples are idempotent (e.g. `gov_action.{accelerate,
            // decelerate}` fires after an earlier alignment/containment
            // exit has already set `alignment_set`). Exiting on first
            // marker satisfaction would skip those trailing nodes and
            // drop real user-visible cells (`gov_action=accelerate` vs
            // `decelerate`). Only exit when the pipeline is fully walked
            // (no more active questions) AND the marker is satisfied.
            let nextNode = null;
            for (const nid of mod.nodeIds || []) {
                const node = E.NODE_MAP[nid];
                if (!node || node.derived) continue;
                if (sel[nid] !== undefined) continue;
                if (!E.isNodeVisible(sel, node)) continue;
                nextNode = node;
                break;
            }
            if (!nextNode || !nextNode.edges) {
                if (_isMarkerSatisfied(marker, sel) && !_isMarkerSatisfied(marker, inputSel)) {
                    // Exit — capture sel deltas from inputSel, but restrict
                    // to dims this module actually owns. Without the
                    // restriction, `cleanSelection` side effects from
                    // foreign modules leak in: e.g. `attachModuleReducer`
                    // installs `collapseToFlavor.set: { alignment_set:
                    // 'yes' }` on `containment.contained`, so any rollout
                    // DFS whose inputSel still carries
                    // `containment=contained` would spuriously mint cells
                    // prefixed with `alignment_set=yes`, doubling the cell
                    // count on (distribution ∈ {concentrated, monopoly})
                    // branches. Own-dims = writes ∪ nodeIds ∪
                    // internalMarkers — covers external writes, answered
                    // internal questions, and internal markers (e.g.
                    // `asi_happens`) needed to hide internal nodes after
                    // the click.
                    const ownedDims = _ecModuleOwnedDims(mod);
                    const bundle = {};
                    const deltaKeys = new Set([...Object.keys(sel), ...Object.keys(inputSel)]);
                    for (const k2 of deltaKeys) {
                        if (!ownedDims.has(k2)) continue;
                        if (sel[k2] !== undefined && sel[k2] !== inputSel[k2]) bundle[k2] = sel[k2];
                    }
                    const bundleKey = selKey(bundle);
                    const cellId = '__dyn__' + bundleKey;
                    if (debug) {
                        const dropped = [];
                        for (const dk of deltaKeys) {
                            if (ownedDims.has(dk)) continue;
                            if (sel[dk] !== undefined && sel[dk] !== inputSel[dk]) {
                                dropped.push(dk + '=' + sel[dk]);
                            }
                        }
                        console.log('EXIT sel=' + k + ' bundle=' + bundleKey
                            + (dropped.length ? ' droppedForeign=' + dropped.join(',') : ''));
                    }
                    if (!results.has(cellId)) {
                        results.set(cellId, {
                            id: cellId,
                            label: _formatDynamicCellLabel(bundle, marker),
                            _moduleWrites: bundle,
                        });
                    }
                } else if (debug) {
                    console.log('STUCK sel=' + k + ' (no nextNode)');
                }
                continue;
            }
            for (const edge of nextNode.edges) {
                if (E.isEdgeDisabled(sel, nextNode, edge)) continue;
                const ns = { ...sel, [nextNode.id]: edge.id };
                const { sel: cleaned } = E.cleanSelection(ns, {});
                if (debug) {
                    const added = [];
                    for (const k of Object.keys(cleaned)) {
                        if (k === nextNode.id) continue;
                        if (sel[k] !== cleaned[k]) added.push(k + '=' + cleaned[k]);
                    }
                    const lost = [];
                    for (const k of Object.keys(sel)) {
                        if (cleaned[k] === undefined) lost.push(k);
                    }
                    console.log('STEP ' + nextNode.id + '=' + edge.id
                        + (added.length ? ' +' + added.join(',') : '')
                        + (lost.length ? ' -' + lost.join(',') : ''));
                }
                stack.push(cleaned);
            }
        }
        if (debug) {
            console.log('results: ' + results.size + ' cells');
            console.groupEnd();
        }
        _dynamicCellCache.set(cacheKey, results);
        return results;
    }

    function _formatDynamicCellLabel(bundle, marker) {
        // Label from user-facing dims only. Bookkeeping markers
        // (module completion marker, `_set`/`_happens`/`_later` suffixes)
        // are present in the bundle for correct cell application but
        // shouldn't clutter the label. If every delta is bookkeeping
        // (the "all choices collapse to flavor" degenerate case), flag
        // it so the user knows to step through for differentiation.
        const isBookkeeping = (k) => (
            k === marker || /_set$|_happens$|_later$/.test(k)
        );
        const visible = Object.keys(bundle).filter(k => !isBookkeeping(k));
        if (!visible.length) return '(flavor-only — step through to differentiate)';
        visible.sort();
        return visible.map(k => k + '=' + bundle[k]).join(', ');
    }

    // Merge dynamically-enumerated cells for a specific input into a hub
    // node's edges list. Hub nodes get a cloned synthetic node (so their
    // edges array is independent of the shared `_MODULE_SYNTHETIC_NODES`
    // entry) the first time we mutate it. Cells are dedup'd by id across
    // inputs — the hub's edges list is the union over all registered
    // inputs.
    function _mergeDynamicCellsIntoHub(hubNode, inputSel) {
        const mod = hubNode.nq && hubNode.nq.module;
        if (!mod || mod.reducerTable) return;
        const cells = _dynamicCellEnumerate(mod, inputSel);
        if (!cells.size) return;
        if (!hubNode.nq.node._cloned) {
            const orig = hubNode.nq.node;
            hubNode.nq = {
                ...hubNode.nq,
                node: { ...orig, edges: [...orig.edges], _cloned: true },
            };
        }
        const edges = hubNode.nq.node.edges;
        const existingIds = new Set(edges.map(e => e.id));
        // Insert dynamic cells BEFORE the `__enter__` edge so the render
        // pass groups them under "Atomic outcomes" and the enter row stays
        // visually last under "Or step through".
        const enterIdx = edges.findIndex(e => e._moduleEnter);
        const insertAt = enterIdx === -1 ? edges.length : enterIdx;
        let inserted = 0;
        for (const cell of cells.values()) {
            if (existingIds.has(cell.id)) continue;
            edges.splice(insertAt + inserted, 0, cell);
            inserted++;
        }
    }

    function findNextQ(sel, opts) {
        const E = window.Engine;
        const res = E.resolvedState(sel);
        for (const t of templates) {
            if (E.templateMatches(t, res)) {
                return { terminal: true, kind: 'outcome', outcome: t, res };
            }
        }
        const skipModuleId = opts && opts.skipModule;
        const mod = pendingModule(sel);
        if (mod && mod.id !== skipModuleId) {
            // Flat-node interleaving: if any non-module-internal node
            // appears BEFORE the module's first internal node in NODES
            // order and is currently pending, ask it first. Matches the
            // main UI's displayOrder semantics so e.g. `alignment` (flat,
            // idx ~407) is asked between the control module
            // (terminates ~387) and the proliferation module (first
            // internal node ~767) instead of being pre-empted by the
            // proliferation hub.
            const firstModIdx = _computeModuleFirstIndex(mod);
            for (let i = 0; i < firstModIdx; i++) {
                const node = E.NODES[i];
                if (!node || node.derived) continue;
                if (_MODULE_INTERNAL_NODE_IDS.has(node.id)) continue;
                if (sel[node.id] !== undefined) continue;
                if (!E.isNodeVisible(sel, node)) continue;
                return { terminal: false, node, res };
            }
            return {
                terminal: false, kind: 'module', module: mod,
                node: _MODULE_SYNTHETIC_NODES[mod.id], res,
            };
        }
        for (const node of E.NODES) {
            if (node.derived) continue;
            if (sel[node.id] !== undefined) continue;
            if (!E.isNodeVisible(sel, node)) continue;
            return { terminal: false, node, res };
        }
        return { terminal: true, kind: 'deadend', res };
    }

    // If the parent is "inside" a module's question walk, propagate that
    // flag to the child — but only while the same module is still pending
    // in the child's sel. Once the module exits (its completion marker is
    // set or activateWhen stops matching), the flag is dropped so downstream
    // navigation reverts to the ordinary post-module flow.
    function _resolveChildModuleExpanded(parentModuleExpanded, childSel) {
        if (!parentModuleExpanded) return null;
        const mod = _MODULE_MAP[parentModuleExpanded];
        if (!mod) return null;
        const marker = _MODULE_COMPLETION_MARKER[mod.id];
        if (_isMarkerSatisfied(marker, childSel)) return null;
        if (!_moduleActivateWhenMatches(childSel, mod)) return null;
        return mod.id;
    }

    function outcomeLabel(outcome, res) {
        const primary = outcome.primaryDimension;
        if (primary && outcome.variants && outcome.variants[res[primary]]) {
            return (outcome.title || outcome.id) + ' — ' + (outcome.variants[res[primary]].subtitle || res[primary]);
        }
        return outcome.title || outcome.id;
    }

    // ═══ DAG model ═══

    function createDag(initialSel) {
        const dag = {
            nodes: new Map(),
            rootKey: null
        };
        const root = getOrCreate(dag, initialSel || {});
        dag.rootKey = root.key;
        return dag;
    }

    // DAG-unique key. Two DAG nodes can share the same `sel` but differ in
    // whether the user entered a pending module (walking its internal
    // questions as real nodes) vs. left the module atomic. The `|inside:<id>`
    // suffix disambiguates those positions.
    //
    // Module hubs: when the next question is a pending module AND the caller
    // is NOT already inside that module's walk, the key is just
    // `module:<id>` — all paths converge on a single hub, each registered as
    // a separate input (see `node.inputs`).
    function _dagKey(clean, moduleExpanded) {
        const base = selKey(clean);
        return moduleExpanded ? base + '|inside:' + moduleExpanded : base;
    }

    function getOrCreate(dag, sel, flavorIn, moduleExpanded, parentKey) {
        const { sel: clean, flavor } = window.Engine.cleanSelection({ ...sel }, { ...(flavorIn || {}) });
        const me = _resolveChildModuleExpanded(moduleExpanded || null, clean);
        const nq = findNextQ(clean, { skipModule: me });
        const isHub = !me && nq.kind === 'module';
        const key = isHub ? ('module:' + nq.module.id) : _dagKey(clean, me);
        const inputKey = parentKey == null ? '__root__' : parentKey;
        if (dag.nodes.has(key)) {
            const existing = dag.nodes.get(key);
            if (isHub && existing.inputs && !existing.inputs.has(inputKey)) {
                // Register this new pre-module sel as another input of the hub.
                existing.inputs.set(inputKey, { sel: clean, flavor });
                _mergeDynamicCellsIntoHub(existing, clean);
            }
            return existing;
        }
        const node = {
            key, sel: clean, flavor, nq,
            moduleExpanded: me,
            isHub,
            depth: Object.keys(clean).length,
            // outgoing: edgeId → { childKey, flavorDelta } so path-specific
            // flavor (e.g., stall_recovery='mild') is preserved even when the
            // child node converges via DAG key. On a module hub, the edgeId
            // is a composite `logicalEdge@inputKey` so each reducer-cell /
            // __enter__ row fans out to one outgoing entry per input that
            // can reach it.
            outgoing: new Map(),
            // incoming: parentKey → { edgeId, flavorDelta } for each inbound path
            incoming: new Map(),
            // Hubs only: parentKey → { sel, flavor } for each pre-module
            // selection that entered this hub. Used by toggleEdge fan-out
            // and by renderDetail to list per-input state.
            inputs: isHub ? new Map() : null,
            x: 0, y: 0,
            hidden: false
        };
        if (isHub) {
            node.inputs.set(inputKey, { sel: clean, flavor });
            _mergeDynamicCellsIntoHub(node, clean);
        }
        dag.nodes.set(key, node);
        return node;
    }

    function placeNewNode(dag, node, parent) {
        // If the parent was user-dragged (pinned), anchor the new child
        // to the parent's current position rather than letting layout()
        // place it in the global column. Drag-then-click should keep
        // the new node visually adjacent to the module the user just
        // moved. Pinning the child makes layout() respect its
        // parent-relative coords; subsequent clicks stack below prior
        // children of the same pinned parent.
        if (parent && parent.pinned) {
            // Only stack below siblings that were anchored to this same
            // pinned parent. A sibling the user later dragged somewhere
            // else shouldn't pull the next child along with it.
            let bottom = null;
            for (const info of parent.outgoing.values()) {
                if (info.childKey === node.key) continue;
                const sib = dag.nodes.get(info.childKey);
                if (!sib || sib._pinnedBy !== parent.key) continue;
                const h = sib._height || DEFAULT_NODE_H;
                const sb = sib.y + h;
                if (bottom == null || sb > bottom) bottom = sb;
            }
            node.x = parent.x + NODE_DX;
            node.y = bottom == null ? parent.y : bottom + NODE_VGAP;
            node.pinned = true;
            node._pinnedBy = parent.key;
            return;
        }
        // Provisional anchor only — the real placement is done by the
        // next `layout()` pass, which appends this fresh node below the
        // bottom of its visual column (considering ALL column-mates, not
        // just the parent's own siblings, so convergent DAG columns
        // don't overlap). Leaving the node unpinned lets layout() move it.
        node.x = parent ? parent.x + NODE_DX : node.depth * NODE_DX;
        node.y = parent ? parent.y : 0;
        node.pinned = false;
    }

    // ═══ Open-set persistence ═══
    // Every opened (selKey, edgeId) is recorded so the current expansion can
    // be restored across reloads. Graph changes degrade gracefully: when a
    // previously opened state no longer exists (or an edge is now disabled /
    // removed), the replay simply skips it, leaving the rest of the tree
    // intact.
    const STORAGE_KEY = 'explore-opens-v1';
    const VIEW_KEY = 'explore-view-v1';
    const savedOpens = loadSavedOpens();
    let replaying = false;

    function loadSavedOpens() {
        try {
            const raw = typeof localStorage !== 'undefined' && localStorage.getItem(STORAGE_KEY);
            if (!raw) return new Set();
            const arr = JSON.parse(raw);
            return new Set(Array.isArray(arr) ? arr : []);
        } catch (e) { return new Set(); }
    }
    function persistOpens() {
        if (replaying) return;
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify([...savedOpens])); } catch (e) {}
    }
    function loadSavedView() {
        try {
            const raw = typeof localStorage !== 'undefined' && localStorage.getItem(VIEW_KEY);
            if (!raw) return null;
            const v = JSON.parse(raw);
            if (v && typeof v.x === 'number' && typeof v.y === 'number' && typeof v.s === 'number') return v;
            return null;
        } catch (e) { return null; }
    }
    function persistView(x, y, s) {
        try { localStorage.setItem(VIEW_KEY, JSON.stringify({ x, y, s })); } catch (e) {}
    }
    function openTag(key, edgeId) { return key + '→' + edgeId; }

    function _collapseOutgoing(dag, node, storageEdgeId) {
        const entry = node.outgoing.get(storageEdgeId);
        if (!entry) return;
        node.outgoing.delete(storageEdgeId);
        savedOpens.delete(openTag(node.key, storageEdgeId));
        persistOpens();
        const child = dag.nodes.get(entry.childKey);
        if (!child) return;
        // If the parent still has other outgoing edges pointing to this same
        // child (fan-out convergence), leave child.incoming intact.
        let stillReferenced = false;
        for (const info of node.outgoing.values()) {
            if (info.childKey === child.key) { stillReferenced = true; break; }
        }
        if (!stillReferenced) {
            child.incoming.delete(node.key);
            // If the child is a hub and the collapsing parent was one of its
            // inputs, drop that input and prune any fan-out it seeded.
            if (child.isHub && child.inputs && child.inputs.has(node.key)) {
                child.inputs.delete(node.key);
                const suffix = '@' + node.key;
                const toPrune = [];
                for (const k of child.outgoing.keys()) if (k.endsWith(suffix)) toPrune.push(k);
                for (const k of toPrune) _collapseOutgoing(dag, child, k);
            }
        }
        const hubEmpty = child.isHub && child.inputs && child.inputs.size === 0;
        if ((child.incoming.size === 0 || hubEmpty) && child.key !== dag.rootKey) {
            removeSubtree(dag, child);
        }
    }

    function _expandOutgoing(dag, node, storageEdgeId, edge, parentSelOverride, parentFlavorOverride) {
        const q = node.nq.node;
        const isModuleCell = !!edge._moduleWrites;
        const isModuleEnter = !!edge._moduleEnter;
        const parentSel = parentSelOverride != null ? parentSelOverride : node.sel;
        const parentFlavor = parentFlavorOverride != null ? parentFlavorOverride : (node.flavor || {});
        let childSelIn, childModuleCtx;
        if (isModuleEnter) {
            childSelIn = { ...parentSel };
            childModuleCtx = node.nq.module.id;
        } else if (isModuleCell) {
            childSelIn = { ...parentSel, ...edge._moduleWrites };
            childModuleCtx = null;
        } else {
            childSelIn = { ...parentSel, [q.id]: edge.id };
            // Regular question edges inherit the parent's module-expansion
            // flag so the whole walk stays "inside" the module until the
            // reducer exits.
            childModuleCtx = node.moduleExpanded || null;
        }
        const { flavor: childFlavor } =
            window.Engine.cleanSelection({ ...childSelIn }, { ...parentFlavor });
        const sizeBefore = dag.nodes.size;
        const child = getOrCreate(dag, childSelIn, parentFlavor, childModuleCtx, node.key);
        const isNew = dag.nodes.size > sizeBefore;
        const flavorDelta = {};
        for (const k of Object.keys(childFlavor)) {
            if (parentFlavor[k] !== childFlavor[k]) flavorDelta[k] = childFlavor[k];
        }
        child.incoming.set(node.key, { edgeId: storageEdgeId, flavorDelta });
        node.outgoing.set(storageEdgeId, { childKey: child.key, flavorDelta });
        savedOpens.add(openTag(node.key, storageEdgeId));
        persistOpens();
        if (isNew) placeNewNode(dag, child, node);
    }

    // Composite-edge helpers for module hubs. Storage edgeIds on hubs take
    // the form `logicalEdgeId@inputKey` so a single reducer-cell row (or
    // __enter__ row) can fan out to one outgoing per input that can reach
    // it. Callers may pass a logical edgeId to mean "operate on all
    // inputs," or a composite to operate on a single input.
    function _hubCompositeKeys(node, logicalEdgeId) {
        const prefix = logicalEdgeId + '@';
        const keys = [];
        for (const k of node.outgoing.keys()) if (k.startsWith(prefix)) keys.push(k);
        return keys;
    }

    function _isHubEdgeExpanded(node, logicalEdgeId) {
        return _hubCompositeKeys(node, logicalEdgeId).length > 0;
    }

    function toggleEdge(dag, node, edgeId) {
        if (node.nq.terminal) return;
        const q = node.nq.node;

        // ─── Hub fan-out dispatch ───
        if (node.isHub && node.inputs) {
            const atIdx = edgeId.indexOf('@');
            if (atIdx === -1) {
                // Aggregate toggle: if any composite expanded, collapse ALL;
                // otherwise expand for every input that can reach this edge.
                const existing = _hubCompositeKeys(node, edgeId);
                if (existing.length > 0) {
                    for (const k of existing) _collapseOutgoing(dag, node, k);
                    return;
                }
                const edge = q.edges.find(e => e.id === edgeId);
                if (!edge) return;
                const mod = node.nq.module;
                for (const [inputKey, input] of node.inputs) {
                    if (edge._moduleWrites && !cellReachableFromSel(input.sel, mod, edge)) continue;
                    const composite = edgeId + '@' + inputKey;
                    if (!node.outgoing.has(composite)) {
                        _expandOutgoing(dag, node, composite, edge, input.sel, input.flavor);
                    }
                }
                return;
            }
            // Composite edgeId: operate on one (logicalEdge, input) pair.
            const logicalEdgeId = edgeId.slice(0, atIdx);
            const inputKey = edgeId.slice(atIdx + 1);
            const edge = q.edges.find(e => e.id === logicalEdgeId);
            if (!edge) return;
            if (node.outgoing.has(edgeId)) {
                _collapseOutgoing(dag, node, edgeId);
            } else {
                const input = node.inputs.get(inputKey);
                if (!input) return;
                if (edge._moduleWrites && !cellReachableFromSel(input.sel, node.nq.module, edge)) return;
                _expandOutgoing(dag, node, edgeId, edge, input.sel, input.flavor);
            }
            return;
        }

        // ─── Non-hub (original) behavior ───
        const edge = q.edges.find(e => e.id === edgeId);
        if (!edge) return;
        const isModuleCell = !!edge._moduleWrites;
        const isModuleEnter = !!edge._moduleEnter;
        const isSynth = isModuleCell || isModuleEnter;
        if (!isSynth && window.Engine.isEdgeDisabled(node.sel, q, edge)) return;
        if (node.outgoing.has(edgeId)) {
            _collapseOutgoing(dag, node, edgeId);
        } else {
            _expandOutgoing(dag, node, edgeId, edge, node.sel, node.flavor);
        }
    }

    function replaySavedOpens(dag) {
        if (!savedOpens.size) return;
        replaying = true;
        const preexisting = new Set(dag.nodes.keys());
        try {
            // Index savedOpens by parent key, preserving per-parent insertion
            // order so siblings replay in click order (the order the user
            // originally expanded them) rather than edge-declaration order.
            const opensByKey = new Map();
            for (const tag of savedOpens) {
                const sep = tag.indexOf('→');
                if (sep === -1) continue;
                const parentKey = tag.slice(0, sep);
                const edgeId = tag.slice(sep + 1);
                if (!opensByKey.has(parentKey)) opensByKey.set(parentKey, []);
                opensByKey.get(parentKey).push(edgeId);
            }
            // BFS from root: parents are always processed before their children.
            const queue = [dag.nodes.get(dag.rootKey)];
            const seen = new Set();
            const MAX = 2000;
            let count = 0;
            while (queue.length && count++ < MAX) {
                const node = queue.shift();
                if (!node || seen.has(node.key)) continue;
                seen.add(node.key);
                if (node.nq.terminal) continue;
                const edgeIds = opensByKey.get(node.key) || [];
                for (const storageEdgeId of edgeIds) {
                    // Storage edgeId may be composite (`logicalEdge@inputKey`)
                    // on module hubs; strip to find the underlying edge def.
                    const atIdx = storageEdgeId.indexOf('@');
                    const logicalEdgeId = atIdx === -1 ? storageEdgeId : storageEdgeId.slice(0, atIdx);
                    const edge = node.nq.node.edges.find(e => e.id === logicalEdgeId);
                    if (!edge) continue;
                    const isSyntheticModuleEdge = !!(edge._moduleWrites || edge._moduleEnter);
                    if (!node.isHub && !isSyntheticModuleEdge
                        && window.Engine.isEdgeDisabled(node.sel, node.nq.node, edge)) continue;
                    if (!node.outgoing.has(storageEdgeId)) toggleEdge(dag, node, storageEdgeId);
                    const info = node.outgoing.get(storageEdgeId);
                    if (info) {
                        const child = dag.nodes.get(info.childKey);
                        if (child && !seen.has(child.key)) queue.push(child);
                    }
                }
            }
            // Unpin everything created during replay. `placeNewNode` pinned
            // each child with a height-based guess, but at replay time no DOM
            // existed so `_height` fell back to DEFAULT_NODE_H and many nodes
            // piled onto near-identical coordinates. Unpinning hands placement
            // to layout(), which (after measureHeights) uses real heights +
            // stable creation-order sort to preserve click order without
            // overlap.
            for (const n of dag.nodes.values()) {
                if (!preexisting.has(n.key)) n.pinned = false;
            }
        } finally {
            replaying = false;
        }
    }
    function clearSavedOpens() {
        savedOpens.clear();
        try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
    }

    function removeSubtree(dag, node) {
        // Forget this node's own outgoing expansions — otherwise, if a later
        // click reaches this selKey again via a different path, replay on
        // refresh would bloom the whole forgotten subtree back.
        const childEntries = [...node.outgoing.entries()];
        for (const [edgeId] of childEntries) {
            savedOpens.delete(openTag(node.key, edgeId));
        }
        persistOpens();
        dag.nodes.delete(node.key);
        for (const [, info] of childEntries) {
            const c = dag.nodes.get(info.childKey);
            if (!c) continue;
            c.incoming.delete(node.key);
            // Hub input cleanup: if the removed node was a contributing
            // input to a hub, drop it from the hub's inputs map and prune
            // any fan-out outgoing edges that used it as their input key.
            if (c.isHub && c.inputs && c.inputs.has(node.key)) {
                c.inputs.delete(node.key);
                const suffix = '@' + node.key;
                const toPrune = [];
                for (const k of c.outgoing.keys()) if (k.endsWith(suffix)) toPrune.push(k);
                for (const k of toPrune) _collapseOutgoing(dag, c, k);
            }
            // Remove the child if it lost all incoming, OR (for hubs) lost
            // all inputs.
            const hubEmpty = c.isHub && c.inputs && c.inputs.size === 0;
            if ((c.incoming.size === 0 || hubEmpty) && c.key !== dag.rootKey) {
                removeSubtree(dag, c);
            }
        }
    }

    // ═══ Layout ═══

    const NODE_DX = 320;
    const NODE_VGAP = 24;
    const DEFAULT_NODE_H = 90;

    function layout(dag) {
        // Assign `_order` once (insertion into dag.nodes = click order, or
        // — for saved-opens replay — original click order, preserved by
        // `replaySavedOpens`'s per-parent insertion-order indexing).
        let _creationOrder = 0;
        for (const node of dag.nodes.values()) {
            if (node._order == null) node._order = _creationOrder;
            _creationOrder++;
        }

        // Column = graph distance from root (longest path) rather than
        // `Object.keys(sel).length`. Sel depth jumps unpredictably: picking
        // `agi_threshold` sets both the dimension itself AND the
        // `agi_happens=yes` marker, so sel grows by 2 in one click; picking
        // `asi_threshold` collapses `agi_threshold` into flavor, so sel
        // *shrinks* by 1. Neither maps to visual "distance from root" the
        // way the user expects — they want each child sitting in the
        // column immediately right of its parent.
        //
        // Processing in `_order` is safe because a node is always created
        // from an already-present parent, so parents have smaller `_order`
        // than their children and are assigned their column first.
        const column = new Map();
        column.set(dag.rootKey, 0);
        const byOrder = [...dag.nodes.values()].sort((a, b) => a._order - b._order);
        for (const node of byOrder) {
            if (node.key === dag.rootKey) continue;
            let maxCol = 0;
            for (const pKey of node.incoming.keys()) {
                const pc = column.get(pKey);
                if (pc != null && pc + 1 > maxCol) maxCol = pc + 1;
            }
            column.set(node.key, maxCol);
        }

        // Stack each column by `_order` (click order) using real heights so
        // tall nodes don't overlap. No barycenter: sel depth isn't
        // monotonic (see comment above), and the user's expectation for a
        // debug DAG is "first clicked sits on top", not "fewest edge
        // crossings".
        //
        // Incremental placement: nodes that have been placed in a prior
        // refresh keep their y (so opening new siblings doesn't shove
        // existing ones around or re-center the column). Fresh nodes
        // (`!_placed`) are appended below the existing bottom of the
        // column. Only columns with no prior placements center-anchor
        // around y=0.
        const byCol = new Map();
        for (const node of dag.nodes.values()) {
            const c = column.get(node.key) ?? 0;
            node._col = c;
            if (!byCol.has(c)) byCol.set(c, []);
            byCol.get(c).push(node);
        }
        for (const [c, arr] of byCol) {
            arr.sort((a, b) => a._order - b._order);
            const placed = arr.filter(n => n._placed);
            const fresh = arr.filter(n => !n._placed);
            if (!fresh.length) continue;
            let cursor;
            if (!placed.length) {
                // First layout for this column: center the whole stack on y=0.
                const heights = fresh.map(n => (n._height || DEFAULT_NODE_H));
                const totalH = heights.reduce((s, h) => s + h, 0) + Math.max(0, fresh.length - 1) * NODE_VGAP;
                cursor = -totalH / 2;
            } else {
                // Keep existing siblings anchored where they already are;
                // append fresh nodes below the current bottom of the column.
                let bottom = -Infinity;
                for (const n of placed) {
                    const h = n._height || DEFAULT_NODE_H;
                    if (n.y + h > bottom) bottom = n.y + h;
                }
                cursor = bottom + NODE_VGAP;
            }
            for (const n of fresh) {
                if (!n.pinned) {
                    n.x = c * NODE_DX;
                    n.y = cursor;
                }
                // Pinned (user-dragged) nodes still reserve their slot so
                // following unpinned siblings don't slide on top of them.
                cursor += (n._height || DEFAULT_NODE_H) + NODE_VGAP;
            }
        }
    }

    // ═══ Debug ═══

    // Dump the DAG to the console in two formats:
    //   1. A flat table (sortable) of every node with key, depth, x, y, h,
    //      _order, pinned, and the outgoing edges in Map-insertion order
    //      (= click order).
    //   2. An indented tree from the root, listed per-parent in outgoing
    //      (click) order, so you can eyeball whether the rendered left-to-
    //      right / top-to-bottom positions match the click order.
    function debugDumpGraph(dag) {
        const rows = [];
        for (const n of dag.nodes.values()) {
            const outs = [...n.outgoing.entries()].map(([eid, info]) => {
                const c = dag.nodes.get(info.childKey);
                return eid + '→' + (c ? `${c.key} @(${Math.round(c.x)},${Math.round(c.y)})` : '?');
            });
            rows.push({
                key: n.key,
                depth: n.depth,
                col: n._col,
                x: Math.round(n.x),
                y: Math.round(n.y),
                h: n._height || null,
                _order: n._order,
                pinned: !!n.pinned,
                parents: [...n.incoming.keys()],
                children: outs
            });
        }
        rows.sort((a, b) => a.col - b.col || a.y - b.y || a._order - b._order);
        console.groupCollapsed(`[explore] graph dump — ${dag.nodes.size} nodes`);
        console.table(rows.map(r => ({
            key: r.key.length > 60 ? r.key.slice(0, 57) + '…' : r.key,
            d: r.depth, col: r.col, x: r.x, y: r.y, h: r.h, ord: r._order, pin: r.pinned,
            parents: r.parents.length, children: r.children.length
        })));
        // Tree view — walk outgoing in click order from root.
        const lines = [];
        const seen = new Set();
        function walk(key, indent) {
            const n = dag.nodes.get(key);
            if (!n) { lines.push(indent + '?? ' + key); return; }
            const marker = seen.has(key) ? ' [visited]' : '';
            lines.push(`${indent}${key} d=${n.depth} x=${Math.round(n.x)} y=${Math.round(n.y)} h=${n._height || '?'} ord=${n._order}${marker}`);
            if (seen.has(key)) return;
            seen.add(key);
            for (const [eid, info] of n.outgoing) {
                lines.push(`${indent}  └─[${eid}]→`);
                walk(info.childKey, indent + '    ');
            }
        }
        walk(dag.rootKey, '');
        console.log(lines.join('\n'));
        console.groupEnd();
    }

    // ═══ Render ═══

    function renderDimChips(sel, res) {
        const parts = [];
        const seen = new Set();
        for (const k of Object.keys(sel).sort()) {
            parts.push(`<span class="explore-dim-chip" title="${k}=${sel[k]}"><b>${k}</b>=${sel[k]}</span>`);
            seen.add(k);
        }
        for (const k of Object.keys(res).sort()) {
            if (seen.has(k)) continue;
            if (sel[k] !== undefined) continue;
            parts.push(`<span class="explore-dim-chip is-derived" title="derived: ${k}=${res[k]}"><b>${k}</b>=${res[k]}</span>`);
        }
        return parts.join('');
    }

    function renderNodeHTML(dag, node, selectedKey) {
        const nq = node.nq;
        const isRoot = node.key === dag.rootKey;
        const isModule = nq.kind === 'module';
        let cls = 'explore-node';
        if (isRoot) cls += ' is-root';
        if (nq.terminal && nq.kind === 'outcome') cls += ' is-outcome';
        if (nq.terminal && nq.kind === 'deadend') cls += ' is-deadend';
        if (isModule) cls += ' is-module';
        if (selectedKey === node.key) cls += ' is-selected';
        if (node.pinned) cls += ' is-pinned';

        // A node has an "unchecked" edge when at least one enabled edge has
        // not been expanded yet — highlight those to mark partially-explored
        // subtrees. Terminal nodes (outcome/deadend) have no edges and keep
        // their default tinted background.
        let hasUnchecked = false;
        if (!nq.terminal && nq.node && nq.node.edges) {
            for (const edge of nq.node.edges) {
                // The synthetic __enter__ edge is an alternate drill-down and
                // shouldn't count as "unchecked" — otherwise every module box
                // would always look partially explored.
                if (edge._moduleEnter) continue;
                if (node.isHub) {
                    if (edge._moduleWrites) {
                        let reach = 0;
                        for (const inp of node.inputs.values()) {
                            if (cellReachableFromSel(inp.sel, nq.module, edge)) reach++;
                        }
                        if (reach === 0) continue;
                        const expandedN = _hubCompositeKeys(node, edge.id).length;
                        if (expandedN < reach) { hasUnchecked = true; break; }
                    }
                    continue;
                }
                if (!edge._moduleWrites && window.Engine.isEdgeDisabled(node.sel, nq.node, edge)) continue;
                if (!node.outgoing.has(edge.id)) { hasUnchecked = true; break; }
            }
        }
        if (hasUnchecked) cls += ' has-unchecked';

        let title = '';
        let extraHtml = '';
        let edgesHtml = '';
        if (nq.terminal) {
            if (nq.kind === 'outcome') {
                title = outcomeLabel(nq.outcome, nq.res);
            } else {
                title = 'Dead end — no active question';
            }
        } else if (isModule) {
            const mod = nq.module;
            const totalInputs = node.inputs ? node.inputs.size : 1;
            const titleSuffix = totalInputs > 1 ? ` (${totalInputs} inputs)` : '';
            title = (mod.label || mod.id) + ' loop' + titleSuffix;
            const reads = (mod.reads || []).join(', ');
            const writes = (mod.writes || []).join(', ');
            extraHtml = `<div class="explore-module-io">`
                + `<span class="explore-module-badge">module</span>`
                + `<div>reads: <code>${escHtml(reads)}</code></div>`
                + `<div>writes: <code>${escHtml(writes)}</code></div>`
                + `</div>`;
            const cellRows = [];
            const enterRows = [];
            for (const edge of nq.node.edges) {
                const isEnter = !!edge._moduleEnter;
                const expanded = node.isHub ? _isHubEdgeExpanded(node, edge.id) : node.outgoing.has(edge.id);
                let rowCls = 'explore-edge-row';
                if (expanded) rowCls += ' is-expanded';
                if (isEnter) rowCls += ' is-module-enter';
                let chev = expanded ? '▾' : '▸';
                let label = edge.label || edge.id;
                let tooltip = '';
                // Per-input reachability annotation on atomic cells (cells
                // unreachable from every input are greyed; partial reach gets
                // a `(N/M inputs)` suffix and a tooltip listing the splits).
                if (node.isHub && edge._moduleWrites) {
                    const canReach = [];
                    const cannot = [];
                    for (const [ik, inp] of node.inputs) {
                        if (cellReachableFromSel(inp.sel, mod, edge)) canReach.push(ik);
                        else cannot.push(ik);
                    }
                    if (canReach.length === 0) {
                        rowCls += ' is-disabled';
                        chev = '·';
                        tooltip = 'Unreachable from all ' + totalInputs + ' input(s)';
                    } else if (canReach.length < totalInputs) {
                        label += ` (${canReach.length}/${totalInputs} inputs)`;
                        tooltip = `Reachable from ${canReach.length} of ${totalInputs} input(s).`;
                    }
                } else if (node.isHub && isEnter && totalInputs > 1) {
                    const expandedN = _hubCompositeKeys(node, edge.id).length;
                    label += ` (${expandedN}/${totalInputs})`;
                    tooltip = `Each input gets its own walk inside the module.`;
                }
                const rowHtml = `<div class="${rowCls}" data-edge-id="${edge.id}" title="${escHtml(tooltip)}"><span class="explore-edge-chevron">${chev}</span><span class="explore-edge-label">${escHtml(label)}</span></div>`;
                (isEnter ? enterRows : cellRows).push(rowHtml);
            }
            let inner = '';
            if (cellRows.length) {
                inner += `<div class="explore-edge-subhead">Atomic outcomes</div>` + cellRows.join('');
            }
            if (enterRows.length) {
                inner += `<div class="explore-edge-subhead">Or step through</div>` + enterRows.join('');
            }
            edgesHtml = `<div class="explore-node-edges">${inner}</div>`;
        } else {
            const q = nq.node;
            title = q.questionText || q.label || q.id;
            if (title.length > 90) title = title.slice(0, 87) + '…';
            const edgesArr = q.edges.map(edge => {
                const disabled = window.Engine.isEdgeDisabled(node.sel, q, edge);
                const reason = disabled ? window.Engine.getEdgeDisabledReason(node.sel, q, edge) : null;
                const expanded = node.outgoing.has(edge.id);
                let rowCls = 'explore-edge-row';
                if (disabled) rowCls += ' is-disabled';
                if (expanded) rowCls += ' is-expanded';
                const label = edge.shortAnswerLabel || edge.shortLabel || edge.answerLabel || edge.label || edge.id;
                const chev = disabled ? '·' : (expanded ? '▾' : '▸');
                const tooltipText = disabled ? (reason || 'Not available') : '';
                const tooltipHtml = disabled
                    ? `<span class="explore-edge-tooltip">${escHtml(tooltipText)}</span>`
                    : '';
                return `<div class="${rowCls}" data-edge-id="${edge.id}"><span class="explore-edge-chevron">${chev}</span><span class="explore-edge-label">${escHtml(label)}</span>${tooltipHtml}</div>`;
            });
            edgesHtml = `<div class="explore-node-edges">${edgesArr.join('')}</div>`;
        }

        const headerRight = `<span class="explore-node-depth">d${node.depth}</span>`;
        return `<div class="${cls}" data-key="${escHtml(node.key)}" style="left:${node.x}px;top:${node.y}px;">
            <div class="explore-node-header"><span class="explore-node-title">${escHtml(title)}</span>${headerRight}</div>
            ${extraHtml}
            ${edgesHtml}
        </div>`;
    }

    function escHtml(s) {
        return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    }

    function renderDetail(dag, node) {
        if (!node) return '';
        const sel = node.sel;
        const res = node.nq.res;
        // Hubs show one block per input (distinct pre-module selections that
        // merged onto this module) instead of a single Selection chip set.
        let selHtml;
        if (node.isHub && node.inputs && node.inputs.size > 1) {
            const blocks = [];
            let i = 0;
            for (const [ik, inp] of node.inputs) {
                i++;
                const chips = Object.keys(inp.sel).length ? renderDimChips(inp.sel, {}) : '<span class="explore-dim-chip"><i>empty</i></span>';
                let reachHtml = '';
                if (node.nq.module && node.nq.module.reducerTable) {
                    const cells = enumerateModuleCells(node.nq.module, inp.sel);
                    if (cells.size) {
                        reachHtml = `<div style="font-size:10px;color:var(--text-muted);margin-top:3px;">reaches: <code>${escHtml([...cells].join(', '))}</code></div>`;
                    } else {
                        reachHtml = `<div style="font-size:10px;color:var(--text-muted);margin-top:3px;"><i>no cells reachable</i></div>`;
                    }
                }
                blocks.push(`<div style="margin-bottom:6px;padding:4px 6px;background:var(--bg);border-radius:4px;"><div style="font-size:10px;color:var(--text-muted);margin-bottom:2px;">Input ${i}${ik === '__root__' ? ' (root)' : ''}</div>${chips}${reachHtml}</div>`);
            }
            selHtml = blocks.join('');
        } else {
            selHtml = Object.keys(sel).length ? renderDimChips(sel, {}) : '<span class="explore-dim-chip"><i>empty</i></span>';
        }
        const derived = {};
        for (const k of Object.keys(res)) if (sel[k] === undefined) derived[k] = res[k];
        const derivedHtml = Object.keys(derived).length ? renderDimChips({}, derived) : '<span class="explore-dim-chip"><i>none</i></span>';
        // Flavor union across all incoming edges: nodes that converge here
        // may have taken different flavor-preserving paths. Show `|` between
        // the different flavor values so the path-dependent narrative is
        // visible even when sel has converged.
        const flavorUnion = {};
        if (node.incoming && node.incoming.size > 0) {
            for (const info of node.incoming.values()) {
                const delta = info.flavorDelta || {};
                for (const k of Object.keys(delta)) {
                    if (!flavorUnion[k]) flavorUnion[k] = new Set();
                    flavorUnion[k].add(delta[k]);
                }
            }
        } else if (node.flavor) {
            // Root node or seeded-from-URL: single path; show directly.
            for (const k of Object.keys(node.flavor)) {
                flavorUnion[k] = new Set([node.flavor[k]]);
            }
        }
        let flavorHtml = '';
        if (Object.keys(flavorUnion).length) {
            const chips = Object.keys(flavorUnion).map(k => {
                const vals = [...flavorUnion[k]].join(' | ');
                return `<span class="explore-dim-chip explore-dim-flavor">${escHtml(k)}=${escHtml(vals)}</span>`;
            }).join(' ');
            flavorHtml = `<div class="explore-detail-section"><h4>Flavor (narrative only)</h4>${chips}</div>`;
        }
        const mapUrl = buildMapUrl(sel);
        let outcomeHtml = '';
        if (node.nq.terminal && node.nq.kind === 'outcome') {
            outcomeHtml = `<div class="explore-detail-section"><h4>Outcome</h4><code>${escHtml(node.nq.outcome.id)}</code><br><i>${escHtml(outcomeLabel(node.nq.outcome, res))}</i></div>`;
        }
        let nextHtml = '';
        if (!node.nq.terminal) {
            if (node.nq.kind === 'module') {
                nextHtml = `<div class="explore-detail-section"><h4>Module</h4><code>${escHtml(node.nq.module.id)}</code></div>`
                         + renderModuleTable(node.nq.module);
            } else {
                nextHtml = `<div class="explore-detail-section"><h4>Next question</h4><code>${escHtml(node.nq.node.id)}</code> — ${escHtml(node.nq.node.label || '')}</div>`;
            }
        }
        return `
            <h3>State @ depth ${node.depth}</h3>
            <div class="explore-detail-section"><h4>Selection</h4>${selHtml}</div>
            <div class="explore-detail-section"><h4>Derived / locked</h4>${derivedHtml}</div>
            ${flavorHtml}
            ${nextHtml}${outcomeHtml}
            <div class="explore-detail-section"><h4>Links</h4><a href="${mapUrl}">Open in /map</a><button type="button" class="explore-copy-btn" data-copy-url="${escHtml(mapUrl)}">Copy</button></div>
        `;
    }

    function renderModuleTable(mod) {
        const writeCols = mod.writes || [];
        if (!mod.reducerTable || !writeCols.length) return '';
        const rows = [];
        for (const [action, progressMap] of Object.entries(mod.reducerTable)) {
            for (const [progress, cell] of Object.entries(progressMap)) {
                const cells = writeCols.map(w => {
                    const v = cell[w];
                    if (v === undefined) return `<td class="dim-empty">—</td>`;
                    return `<td><code>${escHtml(v)}</code></td>`;
                }).join('');
                rows.push(`<tr><td><code>${escHtml(action)}</code></td><td><code>${escHtml(progress)}</code></td>${cells}</tr>`);
            }
        }
        const headers = writeCols.map(w => `<th>${escHtml(w)}</th>`).join('');
        return `<div class="explore-detail-section">
            <h4>Reducer table (${rows.length} cells)</h4>
            <table class="explore-module-table">
                <thead><tr><th>action</th><th>progress</th>${headers}</tr></thead>
                <tbody>${rows.join('')}</tbody>
            </table>
        </div>`;
    }

    function buildMapUrl(sel) {
        const parts = Object.keys(sel).map(k => encodeURIComponent(k) + '=' + encodeURIComponent(sel[k]));
        return '#/map' + (parts.length ? '?' + parts.join('&') : '');
    }

    function renderEdges(dag, selectedKey) {
        const parts = [];
        let minX = 0, minY = 0, maxX = 0, maxY = 0;
        for (const node of dag.nodes.values()) {
            if (node.x < minX) minX = node.x;
            if (node.y < minY) minY = node.y;
            if (node.x + 260 > maxX) maxX = node.x + 260;
            if (node.y + 120 > maxY) maxY = node.y + 120;
        }
        // Module clusters are drawn BEFORE the edge paths so they sit as a
        // translucent background behind the internal nodes. A node belongs
        // to cluster `C` iff `node.moduleExpanded === C`. The module entry
        // box itself is NOT in the cluster — it sits to the left and the
        // __enter__ edge visibly crosses the cluster boundary. Exit
        // children (post-reducer) have moduleExpanded = null and sit
        // outside to the right, so exit edges also visibly leave the box.
        const clusters = new Map(); // modId → { nodes: Set, label }
        for (const node of dag.nodes.values()) {
            if (node.moduleExpanded) {
                const cid = node.moduleExpanded;
                if (!clusters.has(cid)) clusters.set(cid, { nodes: new Set(), label: cid });
                clusters.get(cid).nodes.add(node);
            }
        }
        const PAD = 24;
        for (const { nodes, label } of clusters.values()) {
            if (!nodes.size) continue;
            let cx0 = Infinity, cy0 = Infinity, cx1 = -Infinity, cy1 = -Infinity;
            for (const n of nodes) {
                const w = n._width || 260;
                const h = n._height || 120;
                if (n.x < cx0) cx0 = n.x;
                if (n.y < cy0) cy0 = n.y;
                if (n.x + w > cx1) cx1 = n.x + w;
                if (n.y + h > cy1) cy1 = n.y + h;
            }
            const rx = cx0 - PAD, ry = cy0 - PAD - 16; // extra top padding for label
            const rw = (cx1 - cx0) + PAD * 2, rh = (cy1 - cy0) + PAD * 2 + 16;
            parts.push(`<rect class="explore-cluster" x="${rx}" y="${ry}" width="${rw}" height="${rh}" />`);
            parts.push(`<text class="explore-cluster-label" x="${rx + 12}" y="${ry + 14}">module · ${escHtml(label)}</text>`);
            // Grow the overall canvas bbox so the cluster edges aren't clipped.
            if (rx < minX) minX = rx;
            if (ry < minY) minY = ry;
            if (rx + rw > maxX) maxX = rx + rw;
            if (ry + rh > maxY) maxY = ry + rh;
        }
        // Precompute a stagger-index for each (hub, incomingParent) so
        // multiple arrows landing on the same hub's left edge don't overlap.
        const hubIncomingIdx = new Map(); // childKey → Map(parentKey → idx)
        for (const child of dag.nodes.values()) {
            if (!child.isHub || !child.incoming || child.incoming.size <= 1) continue;
            const order = [...child.incoming.keys()];
            const idxMap = new Map();
            order.forEach((pk, i) => idxMap.set(pk, i));
            hubIncomingIdx.set(child.key, idxMap);
        }
        for (const node of dag.nodes.values()) {
            const hi = node.key === selectedKey;
            const nodeW = node._width || 260;
            for (const [edgeId, outInfo] of node.outgoing) {
                const child = dag.nodes.get(outInfo.childKey);
                if (!child) continue;
                const x1 = node.x + nodeW;
                // Start the path at the vertical center of the corresponding
                // edge row so sibling edges fan out from distinct points
                // rather than stacking on a single node-edge anchor.
                const rowY = node._edgeRowY && node._edgeRowY[edgeId];
                const y1 = node.y + (rowY != null ? rowY : 24);
                const x2 = child.x;
                let y2 = child.y + 24;
                const stagger = hubIncomingIdx.get(child.key);
                if (stagger && stagger.has(node.key)) {
                    const i = stagger.get(node.key);
                    const total = stagger.size;
                    const childH = child._height || 90;
                    // Distribute landings across the child's left edge
                    // (bounded by child height, skipping the header band).
                    const top = 18, bot = Math.max(top + 10, childH - 18);
                    y2 = child.y + (total <= 1 ? (top + bot) / 2
                        : top + ((bot - top) * i) / (total - 1));
                }
                const mx = (x1 + x2) / 2;
                const d = `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`;
                const cls = (hi || child.key === selectedKey) ? 'explore-edge-hi' : '';
                parts.push(`<path class="${cls}" d="${d}" />`);
            }
        }
        const w = Math.max(1, maxX - minX + 200);
        const h = Math.max(1, maxY - minY + 200);
        return { svgInner: parts.join(''), viewBox: `${minX - 100} ${minY - 100} ${w} ${h}`, width: w, height: h, minX: minX - 100, minY: minY - 100 };
    }

    // ═══ App ═══

    function render(container, opts) {
        injectCSS();
        opts = opts || {};
        const initialSel = opts.initialSel || {};

        const dag = createDag(initialSel);
        replaySavedOpens(dag);
        let selectedKey = null;
        const savedView = loadSavedView();
        let viewX = savedView ? savedView.x : 400;
        let viewY = savedView ? savedView.y : window.innerHeight / 2;
        let scale = savedView ? savedView.s : 1;

        container.innerHTML = `
            <div id="explore-root">
                <div class="explore-toolbar">
                    <button data-action="reset">Reset view</button>
                    <button data-action="unpin">Unpin all</button>
                    <button data-action="show-connections">Show All Connections</button>
                    <button data-action="clear">Clear expansions</button>
                    <button data-action="back">← Back to map</button>
                    <span class="explore-stats"></span>
                </div>
                <div class="explore-canvas">
                    <div class="explore-viewport">
                        <svg class="explore-edges"></svg>
                        <div class="explore-nodes"></div>
                    </div>
                </div>
                <div class="explore-detail" hidden></div>
            </div>
        `;
        const root = container.querySelector('#explore-root');
        const canvas = root.querySelector('.explore-canvas');
        const viewport = root.querySelector('.explore-viewport');
        const nodesLayer = root.querySelector('.explore-nodes');
        const edgesLayer = root.querySelector('.explore-edges');
        const detail = root.querySelector('.explore-detail');
        const statsEl = root.querySelector('.explore-stats');

        function applyTransform() {
            viewport.style.transform = `translate(${viewX}px, ${viewY}px) scale(${scale})`;
        }

        function redrawEdges() {
            const edgeData = renderEdges(dag, selectedKey);
            edgesLayer.setAttribute('viewBox', edgeData.viewBox);
            edgesLayer.setAttribute('width', edgeData.width);
            edgesLayer.setAttribute('height', edgeData.height);
            edgesLayer.style.left = edgeData.minX + 'px';
            edgesLayer.style.top = edgeData.minY + 'px';
            edgesLayer.innerHTML = edgeData.svgInner;
        }

        function measureHeights() {
            const els = nodesLayer.querySelectorAll('.explore-node');
            for (const el of els) {
                const key = el.dataset.key;
                const node = dag.nodes.get(key);
                if (!node) continue;
                node._height = el.offsetHeight;
                node._width = el.offsetWidth;
                // Vertical center of each edge row, in node-local coords, so
                // outgoing SVG paths can originate from the row instead of
                // stacking at a single point on the node's right edge.
                const rowY = {};
                const rows = el.querySelectorAll('.explore-edge-row');
                for (const r of rows) {
                    const edgeId = r.dataset.edgeId;
                    if (!edgeId) continue;
                    rowY[edgeId] = r.offsetTop + r.offsetHeight / 2;
                }
                node._edgeRowY = rowY;
            }
        }

        function refresh() {
            // Pass 1: layout with whatever _height values are currently cached
            // (missing for brand-new nodes — falls back to DEFAULT_NODE_H).
            layout(dag);
            const nodesHtml = [];
            for (const node of dag.nodes.values()) {
                nodesHtml.push(renderNodeHTML(dag, node, selectedKey));
            }
            nodesLayer.innerHTML = nodesHtml.join('');
            measureHeights();
            // Pass 2: re-layout using the actual measured heights so new
            // nodes don't overlap. Then patch the already-rendered DOM
            // elements' positions in-place instead of re-rendering.
            layout(dag);
            // Mark every node as placed now that it has a real y from this
            // refresh. Subsequent refreshes treat them as anchored; only
            // brand-new nodes get repositioned (see `layout`).
            for (const n of dag.nodes.values()) n._placed = true;
            for (const el of nodesLayer.querySelectorAll('.explore-node')) {
                const node = dag.nodes.get(el.dataset.key);
                if (!node) continue;
                el.style.left = node.x + 'px';
                el.style.top = node.y + 'px';
            }
            redrawEdges();
            statsEl.textContent = `${dag.nodes.size} nodes`;
            if (selectedKey && dag.nodes.has(selectedKey)) {
                detail.hidden = false;
                detail.innerHTML = renderDetail(dag, dag.nodes.get(selectedKey));
            } else {
                detail.hidden = true;
                detail.innerHTML = '';
            }
            applyTransform();
            debugDumpGraph(dag);
        }

        detail.addEventListener('click', (e) => {
            const btn = e.target.closest('.explore-copy-btn');
            if (!btn) return;
            e.preventDefault();
            const rel = btn.dataset.copyUrl || '';
            const full = new URL(rel, location.href).href;
            const done = () => {
                const prev = btn.textContent;
                btn.textContent = 'Copied';
                btn.classList.add('is-copied');
                setTimeout(() => { btn.textContent = prev; btn.classList.remove('is-copied'); }, 1200);
            };
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(full).then(done, () => fallbackCopy(full, done));
            } else {
                fallbackCopy(full, done);
            }
        });
        function fallbackCopy(text, done) {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.position = 'fixed'; ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            try { document.execCommand('copy'); } catch {}
            document.body.removeChild(ta);
            done();
        }

        // Node drag
        let nodeDrag = null;
        let suppressNextClick = false;
        nodesLayer.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            const nodeEl = e.target.closest('.explore-node');
            if (!nodeEl) return;
            const key = nodeEl.dataset.key;
            const node = dag.nodes.get(key);
            if (!node) return;
            nodeDrag = { node, nodeEl, startX: e.clientX, startY: e.clientY, x0: node.x, y0: node.y, moved: false };
            e.stopPropagation();
        });
        window.addEventListener('mousemove', (e) => {
            if (!nodeDrag) return;
            const dxPx = e.clientX - nodeDrag.startX;
            const dyPx = e.clientY - nodeDrag.startY;
            if (!nodeDrag.moved && Math.hypot(dxPx, dyPx) > 4) {
                nodeDrag.moved = true;
                nodeDrag.node.pinned = true;
                nodeDrag.node._pinnedBy = null;
                nodeDrag.nodeEl.classList.add('is-dragging', 'is-pinned');
            }
            if (nodeDrag.moved) {
                nodeDrag.node.x = nodeDrag.x0 + dxPx / scale;
                nodeDrag.node.y = nodeDrag.y0 + dyPx / scale;
                nodeDrag.nodeEl.style.left = nodeDrag.node.x + 'px';
                nodeDrag.nodeEl.style.top = nodeDrag.node.y + 'px';
                redrawEdges();
            }
        });
        window.addEventListener('mouseup', () => {
            if (!nodeDrag) return;
            if (nodeDrag.moved) {
                nodeDrag.nodeEl.classList.remove('is-dragging');
                suppressNextClick = true;
            }
            nodeDrag = null;
        });

        // Double-click node to unpin (restore auto-layout for it)
        nodesLayer.addEventListener('dblclick', (e) => {
            const nodeEl = e.target.closest('.explore-node');
            if (!nodeEl) return;
            const node = dag.nodes.get(nodeEl.dataset.key);
            if (!node || !node.pinned) return;
            node.pinned = false;
            node._pinnedBy = null;
            suppressNextClick = true;
            refresh();
            e.preventDefault();
        });

        // Interaction: click nodes, edges
        nodesLayer.addEventListener('click', (e) => {
            if (suppressNextClick) { suppressNextClick = false; return; }
            const rowEl = e.target.closest('.explore-edge-row');
            const nodeEl = e.target.closest('.explore-node');
            if (!nodeEl) return;
            const key = nodeEl.dataset.key;
            const node = dag.nodes.get(key);
            if (!node) return;
            if (rowEl && !rowEl.classList.contains('is-disabled')) {
                const edgeId = rowEl.dataset.edgeId;
                toggleEdge(dag, node, edgeId);
                selectedKey = key;
                refresh();
                return;
            }
            selectedKey = (selectedKey === key) ? null : key;
            refresh();
        });

        // Pan
        let dragging = false, startX = 0, startY = 0, vx0 = 0, vy0 = 0;
        canvas.addEventListener('mousedown', (e) => {
            if (e.target.closest('.explore-node')) return;
            dragging = true;
            startX = e.clientX; startY = e.clientY;
            vx0 = viewX; vy0 = viewY;
            canvas.classList.add('dragging');
            e.preventDefault();
        });
        window.addEventListener('mousemove', (e) => {
            if (!dragging) return;
            viewX = vx0 + (e.clientX - startX);
            viewY = vy0 + (e.clientY - startY);
            applyTransform();
        });
        window.addEventListener('mouseup', () => {
            if (dragging) {
                dragging = false;
                canvas.classList.remove('dragging');
                persistView(viewX, viewY, scale);
            }
        });

        // Persist on zoom — debounced via a short timer so rapid wheel
        // events coalesce into a single localStorage write.
        let zoomSaveTimer = null;
        function scheduleViewSave() {
            if (zoomSaveTimer) clearTimeout(zoomSaveTimer);
            zoomSaveTimer = setTimeout(() => {
                zoomSaveTimer = null;
                persistView(viewX, viewY, scale);
            }, 200);
        }

        // Zoom
        canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            const rect = canvas.getBoundingClientRect();
            const cx = e.clientX - rect.left;
            const cy = e.clientY - rect.top;
            const wx = (cx - viewX) / scale;
            const wy = (cy - viewY) / scale;
            const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
            const newScale = Math.max(0.2, Math.min(2.5, scale * factor));
            scale = newScale;
            viewX = cx - wx * scale;
            viewY = cy - wy * scale;
            applyTransform();
            scheduleViewSave();
        }, { passive: false });

        function fitToContent(opts) {
            opts = opts || {};
            const pad = opts.pad != null ? opts.pad : 60;
            const maxScale = opts.maxScale != null ? opts.maxScale : 1;
            const minScale = opts.minScale != null ? opts.minScale : 0.2;
            if (!dag.nodes.size) return;
            let xmin = Infinity, ymin = Infinity, xmax = -Infinity, ymax = -Infinity;
            for (const n of dag.nodes.values()) {
                const w = n._width || 260;
                const h = n._height || 120;
                if (n.x < xmin) xmin = n.x;
                if (n.y < ymin) ymin = n.y;
                if (n.x + w > xmax) xmax = n.x + w;
                if (n.y + h > ymax) ymax = n.y + h;
            }
            if (!isFinite(xmin)) return;
            const rect = canvas.getBoundingClientRect();
            const cw = rect.width, ch = rect.height;
            if (cw <= 0 || ch <= 0) return;
            const contentW = (xmax - xmin) + pad * 2;
            const contentH = (ymax - ymin) + pad * 2;
            const fitScale = Math.min(cw / contentW, ch / contentH);
            scale = Math.max(minScale, Math.min(maxScale, fitScale));
            const cx = (xmin + xmax) / 2;
            const cy = (ymin + ymax) / 2;
            viewX = cw / 2 - cx * scale;
            viewY = ch / 2 - cy * scale;
            applyTransform();
            persistView(viewX, viewY, scale);
        }

        // Toolbar
        root.querySelector('[data-action="reset"]').addEventListener('click', () => {
            fitToContent();
        });
        root.querySelector('[data-action="unpin"]').addEventListener('click', () => {
            // Clear `_placed` too so the layout re-centers every column
            // from scratch, not just "append the dragged ones to the
            // bottom of their existing stack".
            for (const n of dag.nodes.values()) {
                n.pinned = false;
                n._placed = false;
                n._pinnedBy = null;
            }
            refresh();
        });
        root.querySelector('[data-action="show-connections"]').addEventListener('click', () => {
            toggleConnectionsOverlay(root);
        });
        root.querySelector('[data-action="clear"]').addEventListener('click', () => {
            const rootSel = dag.nodes.get(dag.rootKey).sel;
            dag.nodes.clear();
            const r = getOrCreate(dag, rootSel);
            dag.rootKey = r.key;
            selectedKey = null;
            clearSavedOpens();
            refresh();
            // Also reset the connections overlay if it's open, so
            // "clear expansions" behaves as a single start-over for
            // both views. If the overlay is closed we still purge its
            // persisted picks so a subsequent open starts fresh.
            _ecResetConnectionsState(root);
        });
        root.querySelector('[data-action="back"]').addEventListener('click', () => {
            location.hash = '/map';
        });

        refresh();
        // Restore the user's last viewport if we have one; otherwise fit
        // the initial graph to the canvas so the whole DAG is visible.
        if (savedView) {
            applyTransform();
        } else {
            fitToContent();
        }
        // Auto-reopen the Show-All-Connections overlay if it was open
        // before the refresh. Its traversal state (sel + committed) is
        // already persisted via EC_STATE_LS_KEY and will be picked up
        // inside toggleConnectionsOverlay when it re-enters.
        if (_ecLoadState().open) {
            toggleConnectionsOverlay(root);
        }
    }

    // ════════════════════════════════════════════════════════════════
    // "Show All Connections" overlay
    //
    // A debug view that renders the full narrative-flow DAG (borrowed
    // from window.Nodes.FLOW_DAG) as a single pannable/zoomable canvas,
    // layered on top of the normal path-exploration view. The primary
    // debug affordance: clicking an outcome in any module's outcome
    // strip highlights every other module where that same outcome
    // appears, and draws dashed copper arrows between all occurrences.
    //
    // Not a replacement for the path explorer — it's read-only, static
    // (no sel / flavor), and exists purely to answer "which modules
    // can produce outcome X?" at a glance.
    // ════════════════════════════════════════════════════════════════

    const EC_LS_KEY = 'explore-connections-view-v1';
    // Separate key from the pan/zoom view so traversal state survives
    // even if the user clears the view (and vice-versa). Shape:
    //   { open: boolean, sel: object, committed: [{slotKey, cellId, label, writes}, ...] }
    const EC_STATE_LS_KEY = 'explore-connections-state-v1';

    // Minimal HTML escaper for the connections view. Inputs are all
    // controlled constants (node ids, labels) but strict escaping keeps
    // us honest in case someone adds a label with a stray `<` later.
    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function _ecLoadView() {
        try {
            const raw = localStorage.getItem(EC_LS_KEY);
            if (raw) {
                const v = JSON.parse(raw);
                if (typeof v.x === 'number' && typeof v.y === 'number' && typeof v.s === 'number') {
                    return { x: v.x, y: v.y, s: v.s, dirty: true };
                }
            }
        } catch (_e) { /* ignore */ }
        return { x: 20, y: 20, s: 1, dirty: false };
    }
    function _ecSaveView(v) {
        try { localStorage.setItem(EC_LS_KEY, JSON.stringify({ x: v.x, y: v.y, s: v.s })); }
        catch (_e) { /* ignore */ }
    }

    // Persistence for the overlay's open flag + traversal state. Kept
    // defensive: any schema mismatch falls back to a closed/empty state
    // rather than blowing up the page.
    function _ecLoadState() {
        try {
            const raw = localStorage.getItem(EC_STATE_LS_KEY);
            if (!raw) return { open: false, committed: [] };
            const v = JSON.parse(raw);
            if (!v || typeof v !== 'object') return { open: false, committed: [] };
            return {
                open: !!v.open,
                committed: Array.isArray(v.committed) ? v.committed : [],
            };
        } catch (_e) {
            return { open: false, committed: [] };
        }
    }
    function _ecSaveState(open, state) {
        try {
            localStorage.setItem(EC_STATE_LS_KEY, JSON.stringify({
                open: !!open,
                committed: state.committed || [],
            }));
        } catch (_e) { /* ignore */ }
    }

    // Start-over helper shared between the explorer's "Clear expansions"
    // button and anything else that wants to wipe the connections
    // overlay's traversal. Clears the committed picks AND the persisted
    // copy so a later open (or a page refresh) restarts from empty;
    // live overlays, if present, rerender in place.
    function _ecResetConnectionsState(exploreRoot) {
        const overlay = exploreRoot && exploreRoot.querySelector('.explore-connections');
        if (overlay && overlay._ecState) {
            overlay._ecState.committed = [];
            _ecSaveState(true, overlay._ecState);
            if (typeof overlay._ecRerender === 'function') overlay._ecRerender();
            return;
        }
        // Overlay closed: purge persisted picks (but preserve whatever
        // `open` flag was there — the user's next open should still
        // respect whether they'd asked the overlay to auto-reopen).
        const prev = _ecLoadState();
        _ecSaveState(prev.open, { committed: [] });
    }

    // Longest-path column assignment (same algorithm as the /nodes Flow
    // view). Every node's column is 1 + max(column of any parent); roots
    // sit at 0. Guards against cycles (shouldn't occur) by treating a
    // re-entry as column 0.
    function _ecComputeColumns(dag) {
        const parentsOf = new Map();
        for (const n of dag.nodes) parentsOf.set(n.key, []);
        for (const [p, c] of dag.edges) {
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
        for (const n of dag.nodes) visit(n.key);
        return col;
    }

    // Augment FLOW_DAG with virtual terminal slots so outcomes and
    // dead-ends render as their own visual cards instead of being
    // collapsed into pill-strips inside their source cards.
    //
    // Outcome slots: one per unique id in any slot's `earlyExits`,
    // with virtual edges from every source slot. We deliberately add
    // a placement edge from the rightmost regular slot to every
    // outcome and to the dead-end as well — that way longest-path
    // column assignment parks ALL terminal sinks one column past the
    // rightmost real slot, clustering them in a clean terminal column
    // instead of scattering each outcome at (max source col + 1).
    // The placement edges are visually skipped in the base-arrow
    // pass (see `c === 'deadend'` and the outcome-from-rightmost
    // skip there); only the real source edges render.
    //
    // Dead-end slot: single shared `deadend` slot. It lights up
    // dynamically when a branch's findNextQ resolves to
    // `kind: 'deadend'` (no askable + no template match).
    // Memoize by base-dag identity. FLOW_DAG is loaded once and reused
    // forever, so the augmented dag (with virtual outcome / deadend
    // sinks + their column-pinning placement edges) only ever needs to
    // be built once. Saves a per-render `_ecComputeColumns` walk + a
    // double allocation of the entire node/edge arrays.
    const _ecExtendedDagCache = new WeakMap();
    function _ecBuildExtendedDag(dag) {
        const cached = _ecExtendedDagCache.get(dag);
        if (cached) return cached;
        const outcomeMap = new Map();
        for (const n of dag.nodes) {
            if (!n.earlyExits || !n.earlyExits.length) continue;
            for (const oid of n.earlyExits) {
                if (!outcomeMap.has(oid)) {
                    outcomeMap.set(oid, {
                        key: 'outcome:' + oid,
                        id: oid,
                        kind: 'outcome',
                        sources: [],
                    });
                }
                outcomeMap.get(oid).sources.push(n.key);
            }
        }
        const outcomeNodes = [...outcomeMap.values()];
        const extraEdges = [];
        for (const o of outcomeNodes) {
            for (const src of o.sources) extraEdges.push([src, o.key]);
        }
        // Park dead-end + every outcome one column past the rightmost
        // real slot via a placement edge from rightmost. Together
        // with the per-source outcome edges above, longest-path lifts
        // every terminal sink to (rightmostCol + 1).
        const baseCols = _ecComputeColumns(dag);
        let rightmost = null;
        let rightmostCol = -1;
        for (const n of dag.nodes) {
            const c = baseCols.get(n.key) || 0;
            if (c > rightmostCol) { rightmostCol = c; rightmost = n.key; }
        }
        const deadEndNode = { key: 'deadend', id: 'deadend', kind: 'deadend' };
        if (rightmost) {
            extraEdges.push([rightmost, 'deadend']);
            for (const o of outcomeNodes) {
                if (!o.sources.includes(rightmost)) {
                    extraEdges.push([rightmost, o.key]);
                }
            }
        }
        const out = {
            nodes: [...dag.nodes, ...outcomeNodes, deadEndNode],
            edges: [...dag.edges, ...extraEdges],
        };
        _ecExtendedDagCache.set(dag, out);
        return out;
    }

    // The base-arrow pass should skip placement-only edges (rightmost
    // → deadend, rightmost → outcome:* when the source isn't a real
    // earlyExits source). This helper centralises that check so the
    // _ecDrawEdges pass only needs to know "is this a real edge".
    function _ecIsRealFlowEdge(p, c, outcomeSourceMap) {
        if (c === 'deadend') return false;
        if (typeof c === 'string' && c.startsWith('outcome:')) {
            const sources = outcomeSourceMap && outcomeSourceMap.get(c);
            return !!(sources && sources.includes(p));
        }
        return true;
    }

    // Renders one slot (module, standalone node, outcome, or dead-end)
    // as an .ec-card. The card's outcome list is reachability-filtered
    // across every branch implied by `state.committed` (multi-pick
    // model) and rows already committed on this slot render as selected.
    //
    //   * module slots: purple double-border card with reads/writes
    //     contract and an "Atomic outcomes" list of reachable exit
    //     cells. Empty list → "awaiting inputs" placeholder.
    //   * node slots (inert_stays, brittle_resolution): plain card
    //     with the node's own clickable edges as outcomes.
    //   * outcome slots: terminal narrative endings (the-ruin etc),
    //     wired in via _ecBuildExtendedDag. Receive arrows from each
    //     source slot whose `earlyExits` lists them.
    //   * dead-end slot: catch-all terminal for branches that resolve
    //     to no outcome and no askable next question.
    //
    // Every clickable row carries `data-slot-key` + `data-cell-id`
    // so the overlay's single click handler can find it.
    function _ecRenderCard(slot, state) {
        if (slot.kind === 'outcome') return _ecRenderOutcomeCard(slot, state);
        if (slot.kind === 'deadend') return _ecRenderDeadEndCard(slot, state);
        const NODE_MAP = window.Engine.NODE_MAP;
        const MODULE_MAP = (window.Graph && window.Graph.MODULE_MAP) || {};
        const isModule = slot.kind === 'module';
        const mod = isModule ? MODULE_MAP[slot.id] : null;
        const node = !isModule ? NODE_MAP[slot.id] : null;
        const label = isModule ? ((mod && mod.label) || '') : ((node && node.label) || '');
        const committedHere = state.committed.filter(c => c.slotKey === slot.key);
        const committedCellIds = new Set(committedHere.map(c => c.cellId));
        const hasCommit = committedHere.length > 0;
        // Multi-branch activation: this slot is "live" if ANY branch
        // built from commits on OTHER slots makes its activateWhen pass.
        // Cell enumeration likewise unions the reachable cells across
        // those branches, so picking multiple outcomes upstream exposes
        // every downstream option that any of them would unlock.
        const isActive = _ecAnyBranchActivates(slot, state.committed);

        let cls = 'ec-card ' + (isModule ? 'is-module' : 'is-node');
        if (!isActive && !hasCommit) cls += ' is-inactive';
        if (hasCommit) cls += ' is-visited';

        let html = `<div class="${cls}" data-ec-key="${esc(slot.key)}">`;

        const title = isModule ? ((mod && mod.label) || slot.id) + ' loop' : (label || slot.id);
        html += `<div class="ec-card-head">`
             + `<span class="ec-card-title">${esc(title)}</span>`
             + (slot.note ? `<span class="ec-card-slotnote">${esc(slot.note)}</span>` : '')
             + `</div>`;

        if (isModule && mod) {
            const reads = (mod.reads || []).join(', ');
            const writes = (mod.writes || []).join(', ');
            html += `<div class="explore-module-io">`
                 + `<span class="explore-module-badge">module</span>`
                 + `<div>reads: <code>${esc(reads)}</code></div>`
                 + `<div>writes: <code>${esc(writes)}</code></div>`
                 + `</div>`;
        }

        // Atomic outcomes: reachable cells unioned across every branch
        // that doesn't pass through this slot. Inactive slots show a
        // muted placeholder instead of enumerating their full outcome
        // table — the point of this overlay is to only expose what's
        // actually reachable from the path(s) built so far, starting
        // with an empty sel (only `emergence` is active).
        //
        // Why union-of-branches (not a single accumulated sel): the
        // user can pick multiple outcomes on any slot, each of which
        // seeds its own branch. A downstream slot stays visible while
        // ANY of those branches could reach it, and every alternative
        // remains clickable so the user can fork or toggle picks
        // without losing previous choices.
        if (isActive) {
            const cells = _ecUnionCellsAcrossBranches(slot, state.committed);
            if (cells.length) {
                html += `<div class="explore-node-edges" style="margin-top:6px;">`
                     + `<div class="explore-edge-subhead">Atomic outcomes</div>`;
                for (const cell of cells) {
                    const isCommitted = committedCellIds.has(cell.id);
                    const rowCls = 'explore-edge-row ec-cell-row' + (isCommitted ? ' is-committed' : '');
                    html += `<div class="${rowCls}" data-slot-key="${esc(slot.key)}" data-cell-id="${esc(cell.id)}">`
                         + `<span class="explore-edge-chevron">${isCommitted ? '▾' : '▸'}</span>`
                         + `<span class="explore-edge-label">${esc(cell.label)}</span>`
                         + `</div>`;
                }
                html += `</div>`;
            } else {
                html += `<div class="ec-card-label" style="margin-top:6px;font-style:italic;">no reachable outcomes from current path</div>`;
            }
        } else {
            html += `<div class="ec-card-label" style="margin-top:6px;font-style:italic;">awaiting inputs</div>`;
        }

        // Narrative outcomes (slot.earlyExits) and dead-ends are now
        // rendered as their own cards via _ecBuildExtendedDag — see
        // _ecRenderOutcomeCard / _ecRenderDeadEndCard. The static
        // pill-strip is gone; arrows from this card's cell rows to the
        // outcome cards carry that visual relationship instead.

        html += `</div>`;
        return html;
    }

    // Outcome card: a terminal narrative bucket (the-ruin, the-plateau,
    // etc) wired in by _ecBuildExtendedDag. Inactive (muted) until at
    // least one branch's derived state matches the outcome's template,
    // at which point it lights up green to mirror the legacy
    // `is-reached` pill highlight. Has no cells of its own — it's a
    // pure sink, reached via live arrows from upstream cell commits.
    function _ecRenderOutcomeCard(slot, state) {
        const oid = slot.id;
        const tpl = (templates || []).find(t => t.id === oid);
        const title = tpl && tpl.title ? tpl.title : oid;
        const reached = _ecOutcomeReached(oid, state.committed);
        let cls = 'ec-card is-outcome';
        if (reached) cls += ' is-reached';
        else cls += ' is-inactive';
        let html = `<div class="${cls}" data-ec-key="${esc(slot.key)}">`;
        html += `<div class="ec-card-head">`
             + `<span class="ec-card-title">${esc(title)}</span>`
             + `<span class="ec-card-slotnote">outcome</span>`
             + `</div>`;
        html += `<div class="ec-card-label" style="font-family:ui-monospace,'SF Mono',Consolas,monospace;font-size:10px;">${esc(oid)}</div>`;
        html += `</div>`;
        return html;
    }

    // Dead-end card: single shared sink for branches that resolve to
    // `kind: 'deadend'` (no askable next question, no template match).
    // Rendered red-tinted when at least one branch lands here so the
    // user can see at a glance that part of their picks lead nowhere.
    function _ecRenderDeadEndCard(slot, state) {
        const reached = _ecAnyBranchDeadEnds(state.committed);
        let cls = 'ec-card is-deadend';
        if (reached) cls += ' is-reached';
        else cls += ' is-inactive';
        let html = `<div class="${cls}" data-ec-key="${esc(slot.key)}">`;
        html += `<div class="ec-card-head">`
             + `<span class="ec-card-title">Dead end</span>`
             + `<span class="ec-card-slotnote">terminal</span>`
             + `</div>`;
        html += `<div class="ec-card-label">${reached ? 'at least one branch lands here' : 'no branch dead-ends here yet'}</div>`;
        html += `</div>`;
        return html;
    }

    // Derived states per branch, memoized for the render cycle.
    // `_ecOutcomeReached` is called once per outcome pill across every
    // card, and `resolvedStateWithFlavor` is the dominant cost per
    // branch (it walks every NODE with visibility + deriveWhen +
    // locked checks). Computing it once per unique branch sel and
    // reusing across all outcomes turns the hot path from
    // O(branches × outcomes) resolutions into O(branches).
    //
    // We also dedupe post-derivation — the (k+1)^n optional-subset
    // branch explosion produces many branches that differ only on
    // dims that don't survive `resolvedState` (e.g. two variants of
    // an optional commit on a slot whose writes get derived away).
    // Template matching cares only about derived state, so collapsing
    // duplicates here cuts the `templateMatches` loop by a further
    // constant factor without any semantic change.
    let _ecDerivedStatesCache = null;
    function _ecDerivedStates(committed) {
        if (_ecDerivedStatesCache) return _ecDerivedStatesCache;
        const E = window.Engine;
        const branches = _ecBranches(committed);
        const out = [];
        const seen = new Set();
        for (const b of branches) {
            let state;
            try {
                state = E && E.resolvedStateWithFlavor
                    ? E.resolvedStateWithFlavor(b.sel, {}) : b.sel;
            } catch (_e) {
                state = b.sel;
            }
            const k = selKey(state);
            if (seen.has(k)) continue;
            seen.add(k);
            out.push(state);
        }
        _ecDerivedStatesCache = out;
        return out;
    }

    // Does the given narrative outcome template match ANY branch?
    // A pill is "reached" if at least one branch's accumulated sel
    // satisfies the template — useful when the user has multiple
    // selections active and wants to see which outcomes any of them
    // lands on. Uses engine.templateMatches against (sel, derivedState).
    // `templates` is the module-scoped list loaded via ensureLoaded().
    function _ecOutcomeReached(outcomeId, committed) {
        const E = window.Engine;
        if (!E || !E.templateMatches || !templates || !templates.length) return false;
        const tpl = templates.find(t => t.id === outcomeId);
        if (!tpl) return false;
        const states = _ecDerivedStates(committed);
        for (const state of states) {
            try {
                if (E.templateMatches(tpl, state)) return true;
            } catch (_e) { /* ignore individual branch failures */ }
        }
        return false;
    }

    // Does ANY branch from the current commits resolve to a dead-end
    // (no askable next question + no outcome template match)? Drives
    // the dead-end card's "reached" highlight. Mirrors the engine's
    // findNextQ terminal branch — kind === 'deadend'.
    //
    // Uses the dedup'd, render-cached derived-state list shared with
    // `_ecOutcomeReached` so we resolve each unique branch state at
    // most once per render. Inlining the template-match + askable-
    // node loop here (rather than calling `findNextQ` per branch)
    // skips the per-call `resolvedState` walk that findNextQ would
    // otherwise repeat — a 2k-branch render previously cost ~2s of
    // redundant resolution. With the local cache, it's bounded by
    // unique derived states (typically <100 even for deep paths).
    function _ecAnyBranchDeadEnds(committed) {
        if (!committed || !committed.length) return false;
        const E = window.Engine;
        if (!E) return false;
        const states = _ecDerivedStates(committed);
        const tpls = templates || [];
        for (const state of states) {
            let matched = false;
            for (const t of tpls) {
                try {
                    if (E.templateMatches(t, state)) { matched = true; break; }
                } catch (_e) { /* ignore */ }
            }
            if (matched) continue;
            let askable = false;
            for (const node of E.NODES) {
                if (node.derived) continue;
                if (state[node.id] !== undefined) continue;
                try {
                    if (!E.isNodeVisible(state, node)) continue;
                } catch (_e) { continue; }
                askable = true;
                break;
            }
            if (!askable) return true;
        }
        return false;
    }

    function _ecRenderFlowHtml(state) {
        // Reset per-render caches: every card and arrow check goes
        // through _ecSlotActive / _ecSlotCells / _ecBranches, so
        // clearing here covers both the card pass (this function)
        // and the subsequent _ecDrawEdges pass fired from rAF.
        _ecResetRenderCache();
        const baseDag = window.Nodes && window.Nodes.FLOW_DAG;
        if (!baseDag) return '<div style="padding:20px;color:var(--text-muted)">FLOW_DAG not available — make sure nodes.js loaded first.</div>';
        // Augmented DAG with virtual outcome + dead-end slots so they
        // render as their own cards alongside modules. The base DAG
        // is left untouched; downstream lookups all go through this
        // local `dag`.
        const dag = _ecBuildExtendedDag(baseDag);
        const col = _ecComputeColumns(dag);
        const byCol = new Map();
        for (const n of dag.nodes) {
            const c = col.get(n.key);
            if (!byCol.has(c)) byCol.set(c, []);
            byCol.get(c).push(n);
        }
        const maxCol = byCol.size ? Math.max(...byCol.keys()) : 0;
        let html = `<svg class="ec-edges" xmlns="http://www.w3.org/2000/svg">`
                 + `<defs>`
                 + `<marker id="ec-arrow" viewBox="0 0 10 10" refX="9" refY="5" `
                 +         `markerWidth="7" markerHeight="7" orient="auto-start-reverse">`
                 + `<path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor"/>`
                 + `</marker>`
                 + `<marker id="ec-arrow-outcome" viewBox="0 0 10 10" refX="9" refY="5" `
                 +         `markerWidth="7" markerHeight="7" orient="auto-start-reverse">`
                 + `<path d="M 0 0 L 10 5 L 0 10 z" fill="#b3895e"/>`
                 + `</marker>`
                 // Single universal marker for every live arrow — uses
                 // fill="context-stroke" so the arrowhead colors itself
                 // from whatever stroke the path carries (palette color
                 // or a blended average when multiple picks converge
                 // on the same fan-out destination). Replaces the old
                 // one-marker-per-palette-slot scheme, which couldn't
                 // express blended colors.
                 //
                 // markerUnits="userSpaceOnUse" keeps the arrowhead a
                 // fixed visual size (5px) instead of scaling with the
                 // path's stroke-width — otherwise the primary (2.5-wide)
                 // and fan-out (1.25-wide) arrows would get wildly
                 // different arrowheads despite sharing this marker.
                 // refX="0" pins the BACK of the triangle to the line
                 // endpoint, so the triangle sits forward of where the
                 // line stops instead of overlapping it.
                 + `<marker id="ec-arrow-live" viewBox="0 0 10 10" refX="0" refY="5" `
                 +         `markerUnits="userSpaceOnUse" `
                 +         `markerWidth="5" markerHeight="5" orient="auto-start-reverse">`
                 + `<path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke"/>`
                 + `</marker>`
                 + `</defs>`
                 + `</svg>`;
        html += `<div class="ec-flow">`;
        for (let c = 0; c <= maxCol; c++) {
            const nodes = byCol.get(c) || [];
            html += `<div class="ec-col">`;
            for (const slot of nodes) html += _ecRenderCard(slot, state);
            html += `</div>`;
        }
        html += `</div>`;
        return html;
    }

    // Measures every card + every outcome pill under the given viewport,
    // then redraws the SVG with:
    //   * base parent→child FLOW_DAG arrows (faint, grey)
    //   * live arrows from each committed cell row to its downstream
    //     slots that are active under that pick's own post-sel (the
    //     "path you've walked" highlight, computed per-pick so
    //     parallel picks on the same slot each draw their own fan-out)
    //   * dashed copper pill-to-pill links when a narrative outcome
    //     pill is selected (legacy "where else does this outcome
    //     appear?" interaction)
    function _ecDrawEdges(overlay, selectedOutcomeId) {
        const viewport = overlay.querySelector('.explore-connections-viewport');
        const svg = overlay.querySelector('svg.ec-edges');
        const baseDag = window.Nodes && window.Nodes.FLOW_DAG;
        if (!viewport || !svg || !baseDag) return;
        // Use the same augmented DAG that the render pass laid out, so
        // virtual outcome / dead-end slots participate in static base
        // arrows, slot lookups, and child-key resolution below.
        const dag = _ecBuildExtendedDag(baseDag);
        const state = overlay._ecState || { committed: [] };
        const committed = state.committed || [];
        svg.setAttribute('width', 0);
        svg.setAttribute('height', 0);
        // Measure in pre-transform coordinates. getBoundingClientRect
        // returns post-transform DOM pixels, so once the viewport has
        // been scaled by fit()/wheel zoom, those rects are compressed
        // by view.s — and feeding them into the SVG's internal coord
        // system (which is itself inside the scaled viewport) would
        // compress arrow endpoints a second time, pulling everything
        // toward (0,0). offsetLeft/Top/Width/Height are resolved
        // against the viewport (the nearest positioned ancestor) in
        // layout pixels, unaffected by CSS transforms.
        // Helper: walk up offsetParents until we hit the viewport.
        const offsetWithin = (el) => {
            let x = 0, y = 0, cur = el;
            while (cur && cur !== viewport) {
                x += cur.offsetLeft;
                y += cur.offsetTop;
                cur = cur.offsetParent;
            }
            return { x, y, w: el.offsetWidth, h: el.offsetHeight };
        };
        const rects = new Map();
        let maxRight = 0, maxBot = 0;
        for (const el of viewport.querySelectorAll('[data-ec-key]')) {
            const r = offsetWithin(el);
            rects.set(el.dataset.ecKey, r);
            if (r.x + r.w > maxRight) maxRight = r.x + r.w;
            if (r.y + r.h > maxBot) maxBot = r.y + r.h;
        }
        // Per-cell-row rects keyed by "slotKey|cellId" — used as the
        // emanation point for live arrows so the path visual starts
        // right where the click landed.
        const cellRects = new Map();
        for (const el of viewport.querySelectorAll('.ec-cell-row[data-cell-id]')) {
            cellRects.set(el.dataset.slotKey + '|' + el.dataset.cellId, offsetWithin(el));
        }
        const outcomeRects = [];
        for (const el of viewport.querySelectorAll('.ec-outcome')) {
            const r = offsetWithin(el);
            outcomeRects.push({ oid: el.dataset.outcomeId, ...r });
        }
        const pad = 20;
        const W = maxRight + pad, H = maxBot + pad;
        svg.setAttribute('width', W);
        svg.setAttribute('height', H);
        svg.setAttribute('viewBox', `0 0 ${W} ${H}`);

        // Each commit emits arrows under its own post-sel — that way
        // two commits on the same slot (say "substantial" + "never" on
        // emergence) each drive independent downstream highlights,
        // rather than the last one winning. Post-sel for a (parent,
        // child) pair excludes BOTH the parent's and the child's own
        // commits before merging the parent's writes — otherwise the
        // child's own collapseToFlavor writes (e.g. who_benefits_set
        // from plateau_benefit_distribution edges) retroactively
        // trigger its hideWhen and hide the arrow into it.
        const childPostSels = (commit, childKey) => {
            const childSlot = dag.nodes.find(n => n.key === childKey);
            const rel = childSlot ? _ecRelevantDims(childSlot) : null;
            const others = committed.filter(
                c => c.slotKey !== commit.slotKey && c.slotKey !== childKey,
            );
            // Branches over the child's relevant dims only — an
            // unrelated sibling pick on a different fork that writes
            // disjoint dims can't affect the child's activation or
            // cell enumeration, so folding those commits out keeps the
            // Cartesian product bounded. Parent writes are re-merged
            // on top (they're the whole point of this arrow check).
            return _ecBranches(others, undefined, rel).map(b => _ecCommit(b.sel, commit.writes));
        };

        // Priority filter — for a given commit, returns the subset of
        // its DAG children that are the engine's actual *next* pick
        // (first visible-unanswered node in NODES order, factoring in
        // `isNodeActivatedByRules` priority deferral via isNodeVisible).
        // Without this filter, an alignment commit on (brittle, breaks)
        // draws arrows into BOTH escape_early and proliferation; the
        // engine would only enter one of them at a time. Once the user
        // commits the active one, the next becomes the priority winner
        // and gets its own arrow.
        const E = window.Engine;
        const NODES = (E && E.NODES) || [];
        const MODULE_MAP = (window.Graph && window.Graph.MODULE_MAP) || {};
        const priorityWinnersByCommit = new Map();
        const computePriorityWinners = (commit) => {
            const candidates = _ecChildSlotKeys(commit.slotKey);
            const candSet = new Set(candidates);
            const nodeToSlot = new Map();
            for (const key of candidates) {
                const slot = dag.nodes.find(n => n.key === key);
                if (!slot) continue;
                if (slot.kind === 'module') {
                    const mod = MODULE_MAP[slot.id];
                    if (!mod) continue;
                    for (const nid of mod.nodeIds || []) {
                        if (!nodeToSlot.has(nid)) nodeToSlot.set(nid, key);
                    }
                } else if (!nodeToSlot.has(slot.id)) {
                    nodeToSlot.set(slot.id, key);
                }
            }
            // Branch over commits that aren't on a candidate child
            // (those would mask their own activation). The branch
            // enumerator further excludes the parent's own slot via
            // excludeSlotKey — `commit.writes` is layered on top per
            // branch, so we want exactly THIS commit's writes from the
            // parent, not other multi-picks on the same slot.
            //
            // Why branches instead of one merged sel: when the parent
            // has cousins with mutually-exclusive picks (e.g. multiple
            // emergence cells: asi vs plateau vs agi), Object.assign-
            // merging just keeps the last one's `capability`, which can
            // hide the candidate child's activateWhen on every branch
            // (alignment_loop needs capability='asi'; if last emergence
            // commit was capability='plateau', alignment never wins).
            // Per-branch the engine sees a self-consistent sel.
            //
            // Passing parent's slotKey as excludeSlotKey gives this
            // call a unique cache key — childPostSels uses
            // (undefined, rel), so without this we'd alias to its
            // cached result over a different `others` filter.
            const others = committed.filter(c => !candSet.has(c.slotKey));
            const branches = _ecBranches(others, commit.slotKey, null);
            const winners = new Set();
            const firstVisibleByBranch = [];
            for (const b of branches) {
                const sel = _ecCommit(b.sel, commit.writes);
                let firstVisible = null;
                for (const node of NODES) {
                    if (node.derived) continue;
                    if (sel[node.id] !== undefined) continue;
                    // Skip internals of modules already completed in this
                    // sel. `isNodeVisible` only checks activate/hideWhen
                    // — it doesn't know about completion markers, so a
                    // committed module's internal (e.g. decel_2mo_progress
                    // after `decel|accelerate__robust` commits decel_set
                    // =yes) keeps looking visible because its own
                    // activateWhen still matches against live sel dims
                    // (capability, gov_action). Its slot is excluded
                    // from candidates here (we're computing winners FOR
                    // its own commit, or emergence's commit downstream
                    // of it), so the loop never finds a mapped winner
                    // and `winners=[<none>]` — no live arrow draws.
                    // Mirrors `_shallowAskable`'s module-done short-
                    // circuit inside `isNodeActivatedByRules`.
                    if (node.module) {
                        const marker = _MODULE_COMPLETION_MARKER[node.module];
                        if (_isMarkerSatisfied(marker, sel)) continue;
                    }
                    if (!E.isNodeVisible(sel, node)) continue;
                    firstVisible = node.id;
                    const slotKey = nodeToSlot.get(node.id);
                    if (slotKey) winners.add(slotKey);
                    break;
                }
                if (firstVisible) {
                    firstVisibleByBranch.push(firstVisible);
                } else {
                    // Branch is terminal: either the engine would now
                    // emit an outcome (template match against derived
                    // sel) or a dead-end (no askable + no match). Map
                    // those to the virtual outcome / deadend slots so
                    // they show up as winners and get live arrows just
                    // like regular DAG children. Cells-empty branches
                    // (askable internal node but DFS finds no exit) are
                    // rerouted to the dead-end sink in the live-arrow
                    // pass below — that's a per-postSel check, much
                    // cheaper than running cell enumeration per
                    // priority-winner branch.
                    let matched = null;
                    try {
                        const nq = findNextQ(sel);
                        if (nq && nq.terminal) {
                            if (nq.kind === 'outcome' && nq.outcome) {
                                matched = 'outcome:' + nq.outcome.id;
                            } else if (nq.kind === 'deadend') {
                                matched = 'deadend';
                            }
                        }
                    } catch (_e) { /* ignore branch-specific failure */ }
                    if (matched) {
                        winners.add(matched);
                        firstVisibleByBranch.push('<' + matched + '>');
                    }
                }
            }
            if (window.__EC_DEBUG_WINNERS__ !== false) {
                // On by default — set window.__EC_DEBUG_WINNERS__=false
                // in the console to silence. Logs the union of "next
                // pick" nodes across all branches for this commit.
                const uniqFirst = [...new Set(firstVisibleByBranch)];
                // eslint-disable-next-line no-console
                console.log(
                    `[ec-winners] commit=${commit.slotKey}|${commit.cellId} `
                    + `candidates=[${candidates.join(',')}] `
                    + `branches=${branches.length} `
                    + `firstVisible=[${uniqFirst.join(',') || '<none>'}] `
                    + `→ winners=[${[...winners].join(',') || '<none>'}]`,
                );
            }
            return winners;
        };
        const priorityWinners = (commit) => {
            const k = commit.slotKey + '|' + commit.cellId;
            let w = priorityWinnersByCommit.get(k);
            if (!w) {
                w = computePriorityWinners(commit);
                priorityWinnersByCommit.set(k, w);
            }
            return w;
        };

        // Active AND has at least one reachable exit cell — mirrors
        // the "askable-but-empty → terminal" check in priority winners
        // so the live arrow only draws when the user could actually
        // pass through this slot. Otherwise the arrow would point at
        // a card stamped "no reachable outcomes from current path".
        const _slotLiveUnder = (childSlot, postSels) => postSels.some(
            s => _ecSlotActive(childSlot, s) && _ecSlotCells(childSlot, s).length > 0,
        );
        const liveSlotPairs = new Set();
        for (const commit of committed) {
            const winners = priorityWinners(commit);
            // Regular DAG children — same activation gating as before.
            for (const child of _ecChildSlotKeys(commit.slotKey)) {
                if (!winners.has(child)) continue;
                const childSlot = dag.nodes.find(n => n.key === child);
                if (!childSlot) continue;
                const postSels = childPostSels(commit, child);
                if (_slotLiveUnder(childSlot, postSels)) {
                    liveSlotPairs.add(commit.slotKey + '|' + child);
                }
            }
            // Terminal winners (outcome:* / deadend) don't have an
            // activateWhen — they're terminal sinks. If the priority
            // pass added them as a winner for this commit, the live
            // arrow always draws and the base arrow (if any) fades.
            for (const w of winners) {
                if (w === 'deadend' || (typeof w === 'string' && w.startsWith('outcome:'))) {
                    liveSlotPairs.add(commit.slotKey + '|' + w);
                }
            }
        }
        // Build a quick lookup of "real" outcome source slots so the
        // base-arrow pass can skip the synthetic placement edges
        // (rightmost → outcome:*, rightmost → deadend) added by
        // _ecBuildExtendedDag for column-pinning.
        const outcomeSourceMap = new Map();
        for (const n of dag.nodes) {
            if (n.kind !== 'outcome') continue;
            outcomeSourceMap.set(n.key, n.sources || []);
        }
        const paths = [];
        for (const [p, c] of dag.edges) {
            if (!_ecIsRealFlowEdge(p, c, outcomeSourceMap)) continue;
            const pr = rects.get(p), cr = rects.get(c);
            if (!pr || !cr) continue;
            const x1 = pr.x + pr.w, y1 = pr.y + pr.h / 2;
            const x2 = cr.x, y2 = cr.y + cr.h / 2;
            const dx = Math.max(40, (x2 - x1) / 2);
            const d = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
            const cls = liveSlotPairs.has(p + '|' + c) ? ' class="is-faded"' : '';
            paths.push(`<path${cls} d="${d}" marker-end="url(#ec-arrow)"/>`);
        }

        // Live arrows — main + fan-out, emitted in two passes:
        //
        // 1. MAIN arrows (committed cell → downstream card): one per
        //    (commit, child) pair. Each commit's cell row is a unique
        //    source position, so these don't visually duplicate even
        //    when two picks converge on the same child.
        //
        // 2. FAN-OUT arrows (child's left-center → specific outcome
        //    row): all fan-outs for a given child share the SAME start
        //    point (the landing point on the card's left edge), so
        //    multiple picks unlocking the same row would otherwise
        //    stack identical lines. We dedupe by "childKey|cellId" and
        //    blend contributing colors into a single arrow — gives the
        //    user a visual cue that several picks converge there,
        //    without the overdraw.
        //
        // style="stroke:..." (not the stroke ATTRIBUTE) — the general
        // svg.ec-edges path { stroke: currentColor } CSS rule has
        // higher specificity than any SVG presentation attribute and
        // would otherwise paint every arrow grey. Inline style beats
        // it. The universal marker uses context-stroke, so the
        // arrowhead color follows the path's stroke automatically.
        const fanoutByDest = new Map();
        for (const commit of committed) {
            const cellR = cellRects.get(commit.slotKey + '|' + commit.cellId);
            if (!cellR) continue;
            const colorIdx = _ecColorIdx(commit.slotKey, commit.cellId);
            const color = EC_LIVE_PALETTE[colorIdx];
            const winners = priorityWinners(commit);
            // Iterate winners directly so terminal sinks (outcome:* /
            // deadend) get their main arrow alongside regular DAG
            // children. Terminal sinks have no cells of their own, so
            // they skip the activateWhen check and the fan-out pass.
            for (const ck of winners) {
                const childSlot = dag.nodes.find(n => n.key === ck);
                if (!childSlot) continue;
                const isTerminal = childSlot.kind === 'outcome' || childSlot.kind === 'deadend';
                let postSels = null;
                let drawKey = ck;
                let drawTerminal = isTerminal;
                if (!isTerminal) {
                    postSels = childPostSels(commit, ck);
                    if (!_slotLiveUnder(childSlot, postSels)) {
                        // Askable-but-uncompletable: priority winners
                        // picked this slot because the engine has a
                        // visible internal node, but `_dynamicCellEnumerate`
                        // finds no exit cells under this commit's pre-
                        // sel — every internal walk dead-ends. Reroute
                        // the live arrow to the dead-end card so the
                        // user doesn't see an arrow pointing into a
                        // card stamped "no reachable outcomes from
                        // current path".
                        if (!dag.nodes.find(n => n.key === 'deadend')) continue;
                        drawKey = 'deadend';
                        drawTerminal = true;
                    }
                }
                const cr = rects.get(drawKey);
                if (!cr) continue;
                const x1 = cellR.x + cellR.w, y1 = cellR.y + cellR.h / 2;
                const x2 = cr.x, y2 = cr.y + cr.h / 2;
                const dx = Math.max(40, (x2 - x1) / 2);
                const d = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
                paths.push(`<path class="is-live" d="${d}" style="stroke:${color}" `
                         + `marker-end="url(#ec-arrow-live)"/>`);

                if (drawTerminal) continue;

                // Collect fan-out contributions per destination —
                // emit later once per unique (childKey, cellId).
                const unlocked = new Set();
                for (const s of postSels) {
                    if (!_ecSlotActive(childSlot, s)) continue;
                    for (const cell of _ecSlotCells(childSlot, s)) {
                        unlocked.add(cell.id);
                    }
                }
                for (const cellId of unlocked) {
                    const rowR = cellRects.get(ck + '|' + cellId);
                    if (!rowR) continue;
                    const destKey = ck + '|' + cellId;
                    let entry = fanoutByDest.get(destKey);
                    if (!entry) {
                        // Start at the card's left edge (landing point
                        // of the main arrow, = this child's left-
                        // center) and end at the cell row's left edge.
                        // Both points live inside the card, so the
                        // curve span is short — a small Bezier keeps
                        // the path from snapping to a straight line.
                        const fx1 = x2, fy1 = y2;
                        const fx2 = rowR.x, fy2 = rowR.y + rowR.h / 2;
                        const fdx = Math.max(12, (fx2 - fx1) / 2);
                        const d2 = `M ${fx1} ${fy1} C ${fx1 + fdx} ${fy1}, `
                                 + `${fx2 - fdx} ${fy2}, ${fx2} ${fy2}`;
                        entry = { d: d2, colors: [] };
                        fanoutByDest.set(destKey, entry);
                    }
                    entry.colors.push(color);
                }
            }
        }
        for (const { d: fd, colors } of fanoutByDest.values()) {
            // Dedupe contributing colors before blending — two picks
            // that happen to hash to the same palette slot shouldn't
            // bias the average, since the final stroke would be the
            // same color anyway.
            const uniq = [...new Set(colors)];
            const stroke = _ecBlendColors(uniq);
            paths.push(`<path class="is-live-fanout" d="${fd}" `
                     + `style="stroke:${stroke}" `
                     + `marker-end="url(#ec-arrow-live)"/>`);
        }

        if (selectedOutcomeId) {
            // Link every pair of same-id outcome pills with a curved dashed
            // copper arc. Going pill-to-pill (rather than card-to-card)
            // makes the visual answer to "where else does this appear?"
            // land on the exact row the user clicked.
            const matches = outcomeRects.filter(r => r.oid === selectedOutcomeId);
            for (let i = 0; i < matches.length; i++) {
                for (let j = i + 1; j < matches.length; j++) {
                    const a = matches[i], b = matches[j];
                    const ax = a.x + a.w / 2, ay = a.y + a.h / 2;
                    const bx = b.x + b.w / 2, by = b.y + b.h / 2;
                    // Arc up-and-over so the connection line doesn't
                    // hide behind the intervening cards. Control points
                    // are offset vertically by half the pair's span.
                    const span = Math.max(80, Math.abs(bx - ax) / 3);
                    const midY = Math.min(ay, by) - span;
                    const d = `M ${ax} ${ay} C ${ax} ${midY}, ${bx} ${midY}, ${bx} ${by}`;
                    paths.push(`<path class="is-outcome-link" d="${d}" marker-end="url(#ec-arrow-outcome)"/>`);
                }
            }
        }
        const defs = svg.querySelector('defs');
        svg.innerHTML = '';
        if (defs) svg.appendChild(defs);
        svg.insertAdjacentHTML('beforeend', paths.join(''));
        _ecFlushBranchDebug();
    }

    // Emit a grouped console summary of every unique _ecBranches query
    // that was executed during this render (via the per-render debug
    // accumulator). Enabled by default; set
    // window.__EC_DEBUG_BRANCHES__=false to silence. Each render logs a
    // single collapsed group with a table showing which slots produced
    // the most branches and how long the render took.
    function _ecFlushBranchDebug() {
        const dbg = _ecBranchDebug;
        if (!dbg) return;
        _ecBranchDebug = null;
        const rows = [...dbg.byKey.entries()]
            .map(([key, v]) => ({
                query: v.excludeSlotKey ? `exclude:${v.excludeSlotKey}` : 'full',
                dims: v.relevantDims ? v.relevantDims.join(',') : '(all)',
                contribSlots: v.contributingSlots.length,
                contribPicks: v.contributingPicks,
                mand: v.mandatorySlots,
                opt: v.optionalSlots,
                branches: v.branchCount,
                capped: v.capped,
            }))
            .sort((a, b) => b.branches - a.branches);
        const dtMs = (performance.now() - dbg.t0).toFixed(1);
        const derivedCount = _ecDerivedStatesCache ? _ecDerivedStatesCache.length : 0;
        // eslint-disable-next-line no-console
        console.groupCollapsed(
            `[ec-branches] ${rows.length} unique queries, `
            + `${dbg.calls} total calls, `
            + `${derivedCount} unique derived states, `
            + `${dtMs}ms`,
        );
        // eslint-disable-next-line no-console
        if (rows.length) console.table(rows);
        // eslint-disable-next-line no-console
        console.groupEnd();
    }

    function _ecApplyHighlights(overlay, selectedOutcomeId) {
        if (selectedOutcomeId) overlay.setAttribute('data-ec-selected', selectedOutcomeId);
        else overlay.removeAttribute('data-ec-selected');
        overlay.querySelectorAll('.ec-outcome').forEach(el => {
            const oid = el.dataset.outcomeId;
            el.classList.remove('is-selected', 'is-linked');
            if (!selectedOutcomeId) return;
            if (oid === selectedOutcomeId) {
                el.classList.add(el._ecClicked ? 'is-selected' : 'is-linked');
            }
        });
        overlay.querySelectorAll('.ec-card').forEach(card => {
            card.classList.remove('has-linked');
            if (!selectedOutcomeId) return;
            if (card.querySelector(`.ec-outcome[data-outcome-id="${CSS.escape(selectedOutcomeId)}"]`)) {
                card.classList.add('has-linked');
            }
        });
    }

    function toggleConnectionsOverlay(exploreRoot) {
        const btn = exploreRoot.querySelector('[data-action="show-connections"]');
        let overlay = exploreRoot.querySelector('.explore-connections');
        if (overlay) {
            // Persist the traversal state on close so reopening (or a
            // full page refresh with the open flag still set in LS)
            // resumes exactly where the user left off. `open: false`
            // flips the auto-reopen bit; committed is preserved.
            const existingState = overlay._ecState || { committed: [] };
            _ecSaveState(false, existingState);
            if (overlay._ecCleanup) overlay._ecCleanup();
            overlay.remove();
            if (btn) btn.textContent = 'Show All Connections';
            return;
        }
        if (btn) btn.textContent = 'Hide Connections';
        overlay = document.createElement('div');
        overlay.className = 'explore-connections';

        // Overlay state — guides the reachability-filtered traversal:
        //   committed : array of { slotKey, cellId, label, writes } in
        //               click order. Multiple entries may share the
        //               same slotKey (multi-branch picks). Any "current
        //               sel" is derived on the fly via _ecBranches so
        //               each pick owns its own branch rather than
        //               overwriting siblings.
        // Persisted to localStorage (EC_STATE_LS_KEY) on every mutation
        // so a page refresh with the overlay open restores both the
        // open flag AND the walked path. Schema is kept defensive —
        // bad reads fall back to an empty state, not a crash.
        const persisted = _ecLoadState();
        const state = {
            committed: persisted.committed || [],
        };
        overlay._ecState = state;
        // Persist the "open" bit right away so a refresh during the
        // same session restores the overlay even if the user hasn't
        // yet interacted with it.
        _ecSaveState(true, state);
        // Outcome-pill highlight id (see narrative outcome click handler
        // at the bottom of this fn). Declared here so the rerender
        // closure can pass it through to _ecDrawEdges/_ecApplyHighlights.
        let selectedOutcomeId = null;

        overlay.innerHTML = `<div class="explore-connections-viewport">${_ecRenderFlowHtml(state)}</div>`;
        exploreRoot.appendChild(overlay);
        const viewport = overlay.querySelector('.explore-connections-viewport');

        // Toolbar: lives outside the pan/zoom transform so it stays
        // fixed in the top-right corner. Currently just shows the
        // traversal depth + a Reset button; extend here for future
        // "load current path" / "export sel" controls.
        const toolbar = document.createElement('div');
        toolbar.className = 'ec-toolbar';
        toolbar.innerHTML = `<span class="ec-toolbar-label"></span>`
                          + `<button type="button" data-action="ec-reset">Reset path</button>`;
        overlay.appendChild(toolbar);
        const _updateToolbar = () => {
            const label = toolbar.querySelector('.ec-toolbar-label');
            const n = state.committed.length;
            // Show the deduped (post-`resolvedState`) branch count —
            // that's the number the outcome template matcher actually
            // iterates, and two pre-derivation sels that collapse to
            // the same derived state answer every downstream query
            // identically. The raw `_ecBranches` size is still visible
            // in the [ec-branches] console debug group if needed.
            const derivedCount = n > 0 ? _ecDerivedStates(state.committed).length : 1;
            const suffix = derivedCount > 1 ? `, ${derivedCount} branches` : '';
            label.textContent = n === 0
                ? 'empty path'
                : `${n} pick${n === 1 ? '' : 's'}${suffix}`;
            const resetBtn = toolbar.querySelector('[data-action="ec-reset"]');
            resetBtn.disabled = n === 0;
        };
        _updateToolbar();

        // Render pass: innerHTML rebuild from state, then redraw edges
        // and reapply any outcome-pill highlight. Kept as a closure so
        // both the cell click handler and the Reset button can call it.
        const rerender = () => {
            viewport.innerHTML = _ecRenderFlowHtml(state);
            _updateToolbar();
            // Redraw edges after layout settles so rect measurements
            // pick up any card-size changes from commit highlighting.
            requestAnimationFrame(() => {
                _ecDrawEdges(overlay, selectedOutcomeId);
                _ecApplyHighlights(overlay, selectedOutcomeId);
            });
        };
        // Exposed so external actions (e.g. the explorer toolbar's
        // "Clear expansions") can reset committed picks and trigger a
        // repaint without having to re-enter toggleConnectionsOverlay.
        overlay._ecRerender = rerender;

        toolbar.addEventListener('click', (e) => {
            if (e.target.closest('[data-action="ec-reset"]')) {
                state.committed = [];
                _ecSaveState(true, state);
                rerender();
            }
        });

        const view = _ecLoadView();
        const apply = () => {
            viewport.style.transform =
                `translate(${view.x}px, ${view.y}px) scale(${view.s})`;
        };
        const fit = () => {
            viewport.style.transform = 'translate(0,0) scale(1)';
            const cw = overlay.clientWidth, ch = overlay.clientHeight;
            const vw = viewport.scrollWidth, vh = viewport.scrollHeight;
            if (!cw || !vw) { apply(); return; }
            const sx = (cw - 40) / vw;
            const sy = (ch - 40) / vh;
            view.s = Math.max(0.3, Math.min(1, Math.min(sx, sy)));
            view.x = 20;
            view.y = Math.max(20, (ch - vh * view.s) / 2);
            view.dirty = false;
            try { localStorage.removeItem(EC_LS_KEY); } catch (_e) { /* ignore */ }
            apply();
        };
        // Draw edges first (their SVG inflates viewport scrollWidth /
        // scrollHeight, which fit() needs to measure accurately).
        _ecDrawEdges(overlay, null);
        if (view.dirty) apply(); else fit();

        let dragging = false, sx = 0, sy = 0, x0 = 0, y0 = 0, moved = false;
        // Set by onUp when a drag actually panned, consumed (and
        // cleared) by the next click event to keep end-of-drag clicks
        // from clearing the outcome selection / firing on a pill.
        let suppressNextClick = false;
        overlay.addEventListener('mousedown', (e) => {
            if (e.target.closest && e.target.closest('.ec-outcome')) return;
            if (e.target.closest && e.target.closest('.ec-cell-row')) return;
            if (e.target.closest && e.target.closest('.ec-toolbar')) return;
            if (e.button !== 0) return;
            dragging = true; moved = false;
            sx = e.clientX; sy = e.clientY;
            x0 = view.x; y0 = view.y;
            overlay.classList.add('dragging');
            e.preventDefault();
        });
        const onMove = (e) => {
            if (!dragging) return;
            const dx = e.clientX - sx, dy = e.clientY - sy;
            if (!moved && Math.hypot(dx, dy) > 3) moved = true;
            view.x = x0 + dx; view.y = y0 + dy;
            view.dirty = true;
            apply();
        };
        const onUp = () => {
            if (!dragging) return;
            dragging = false;
            overlay.classList.remove('dragging');
            if (moved) { _ecSaveView(view); suppressNextClick = true; }
        };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
        overlay._ecCleanup = () => {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
        };
        overlay.addEventListener('wheel', (e) => {
            e.preventDefault();
            const rect = overlay.getBoundingClientRect();
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
            _ecSaveView(view);
        }, { passive: false });

        // Click dispatch: three independent click targets share the
        // overlay, handled in priority order.
        //   1. atomic-cell row → toggle this (slotKey, cellId) in
        //      state.committed, rerender so downstream cards pick up
        //      the updated union of reachable outcomes
        //   2. narrative outcome pill → highlight all matching pills
        //      across cards (unchanged legacy behaviour)
        //   3. empty canvas → clear any outcome-pill highlight
        // Toolbar clicks are handled by the toolbar's own listener so
        // they don't reach this one.
        overlay.addEventListener('click', (e) => {
            if (suppressNextClick) { suppressNextClick = false; return; }
            if (toolbar.contains(e.target)) return;

            const cellRow = e.target.closest && e.target.closest('.ec-cell-row');
            if (cellRow) {
                const slotKey = cellRow.dataset.slotKey;
                const cellId = cellRow.dataset.cellId;
                // Multi-branch toggle: each (slotKey, cellId) is its own
                // pick. Clicking an already-committed row removes just
                // that one (downstream siblings survive). Clicking a
                // fresh row appends it without touching existing picks,
                // so the user can accumulate parallel outcomes from any
                // slot — e.g. both "substantial" and "never" on
                // emergence light up their respective downstream paths
                // simultaneously.
                const existingIdx = state.committed.findIndex(
                    c => c.slotKey === slotKey && c.cellId === cellId
                );
                if (existingIdx !== -1) {
                    state.committed.splice(existingIdx, 1);
                    _ecSaveState(true, state);
                    rerender();
                    return;
                }
                const dag = window.Nodes && window.Nodes.FLOW_DAG;
                const slot = dag && dag.nodes.find(n => n.key === slotKey);
                if (!slot) return;
                // Fresh pick: re-enumerate reachable cells under this
                // slot's multi-branch pre-sel so we can copy the cell's
                // writes and label verbatim (what the renderer showed).
                const cells = _ecUnionCellsAcrossBranches(slot, state.committed);
                const cell = cells.find(c => c.id === cellId);
                if (!cell) return;
                state.committed.push({
                    slotKey, cellId,
                    label: cell.label,
                    writes: cell.writes,
                });
                _ecSaveState(true, state);
                rerender();
                return;
            }

            const pill = e.target.closest && e.target.closest('.ec-outcome');
            if (!pill) {
                if (selectedOutcomeId && !e.target.closest('.ec-card')) {
                    overlay.querySelectorAll('.ec-outcome').forEach(el => { el._ecClicked = false; });
                    selectedOutcomeId = null;
                    _ecApplyHighlights(overlay, null);
                    _ecDrawEdges(overlay, null);
                }
                return;
            }
            const oid = pill.dataset.outcomeId;
            overlay.querySelectorAll('.ec-outcome').forEach(el => { el._ecClicked = false; });
            if (selectedOutcomeId === oid) {
                selectedOutcomeId = null;
            } else {
                selectedOutcomeId = oid;
                pill._ecClicked = true;
            }
            _ecApplyHighlights(overlay, selectedOutcomeId);
            _ecDrawEdges(overlay, selectedOutcomeId);
        });
    }

    async function start(container, opts) {
        container.innerHTML = '<div class="loading"><p>Loading explorer…</p></div>';
        await ensureLoaded();
        render(container, opts);
    }

    window.Explore = { render: start };
})();
