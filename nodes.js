(function () {
    'use strict';

    // ────────────────────────────────────────────────────────────
    // /nodes — static-analysis inspector.
    //
    // For each graph node: the conditions that read it (activation,
    // hiding, derivation, edges' gates, outcomes' reachable/flavors)
    // and the places that write it (user picks, derivations, flavor
    // collapses).
    //
    // For each outcome: the dims referenced in reachable clauses and
    // flavor texts.
    //
    // Everything is a static scan of NODES + outcomes.json — no state
    // simulation, no user flow.
    // ────────────────────────────────────────────────────────────

    const CSS = `
        #nodes-root {
            position: fixed; inset: 0; background: var(--bg); color: var(--text);
            overflow: hidden; font-family: inherit; display: flex;
        }
        #nodes-root .nodes-sidebar {
            width: 280px; flex: 0 0 280px; border-right: 1px solid var(--border);
            display: flex; flex-direction: column; background: var(--bg-soft);
        }
        #nodes-root .nodes-sidebar-head {
            padding: 10px 12px; border-bottom: 1px solid var(--border);
            display: flex; gap: 8px; align-items: center;
        }
        #nodes-root .nodes-sidebar-head a {
            color: var(--text-muted); text-decoration: none; font-size: 12px;
        }
        #nodes-root .nodes-sidebar-head a:hover { color: var(--text); }
        #nodes-root .nodes-search {
            width: 100%; padding: 6px 10px; font-size: 13px;
            background: var(--bg); color: var(--text);
            border: 1px solid var(--border); border-radius: 6px;
        }
        #nodes-root .nodes-list {
            flex: 1; overflow-y: auto; padding: 8px 0;
        }
        #nodes-root .nodes-list-section-head {
            font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em;
            color: var(--text-muted); padding: 10px 12px 4px; font-weight: 600;
        }
        #nodes-root .nodes-list-item {
            display: block; padding: 4px 12px; font-size: 12px;
            color: var(--text); cursor: pointer; text-decoration: none;
            border-left: 2px solid transparent;
        }
        #nodes-root .nodes-list-item:hover { background: var(--bg); }
        #nodes-root .nodes-list-item.is-active {
            background: var(--bg); border-left-color: var(--accent, #6b9bd1);
            font-weight: 600;
        }
        #nodes-root .nodes-list-item .nl-id { color: var(--text); }
        #nodes-root .nodes-list-item .nl-label { color: var(--text-muted); margin-left: 6px; }
        #nodes-root .nodes-list-item.nl-derived .nl-id { font-style: italic; }
        #nodes-root .nodes-list-item.nl-outcome .nl-id { color: #b3895e; }

        /* ─── Grid pane (replaces the old flat sidebar) ────────── */
        #nodes-root .nodes-grid-pane {
            flex: 1 1 60%; min-width: 420px; max-width: 65%;
            overflow-y: auto; background: var(--bg);
            border-right: 1px solid var(--border);
            display: flex; flex-direction: column;
        }
        #nodes-root .ng-head {
            padding: 10px 14px; border-bottom: 1px solid var(--border);
            display: flex; gap: 10px; align-items: center; flex: 0 0 auto;
            background: var(--bg-soft);
        }
        #nodes-root .ng-head a {
            color: var(--text-muted); text-decoration: none; font-size: 12px;
        }
        #nodes-root .ng-head a:hover { color: var(--text); }
        #nodes-root .ng-head .nodes-search { flex: 1; }
        #nodes-root .ng-body { flex: 1; overflow-y: auto; padding: 14px; }
        #nodes-root .ng-section { margin-bottom: 18px; }
        #nodes-root .ng-section-head {
            font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em;
            color: var(--text-muted); font-weight: 600; margin: 0 0 8px 2px;
        }
        #nodes-root .ng-module {
            border: 1px solid var(--border); border-radius: 8px;
            padding: 12px 12px 10px; margin-bottom: 14px;
            background: var(--bg-soft);
            transition: border-color 100ms;
        }
        #nodes-root .ng-module.is-active {
            border-color: var(--accent, #6b9bd1);
            background: rgba(107,155,209,0.06);
        }
        #nodes-root .ng-module-head {
            margin-bottom: 10px;
        }
        #nodes-root a.ng-module-title {
            font-weight: 600; font-size: 13px;
            font-family: ui-monospace, monospace;
            color: var(--accent, #6b9bd1);
            text-decoration: none; cursor: pointer;
            display: inline-block;
        }
        #nodes-root a.ng-module-title:hover { text-decoration: underline; }
        #nodes-root .ng-module-contract {
            font-size: 10px; color: var(--text-muted);
            margin-top: 3px; line-height: 1.5;
            font-family: ui-monospace, monospace;
        }
        #nodes-root .ng-module-contract b { color: var(--text); font-weight: 600; }
        #nodes-root .ng-module-contract a.ng-contract-dim {
            color: var(--text); text-decoration: none;
            border-bottom: 1px dotted var(--text-muted);
        }
        #nodes-root .ng-module-contract a.ng-contract-dim:hover {
            color: var(--accent, #6b9bd1);
            border-bottom-color: var(--accent, #6b9bd1);
        }
        #nodes-root .ng-grid {
            display: grid; gap: 6px;
            grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
        }
        #nodes-root .ng-cell {
            position: relative;
            display: block; padding: 6px 22px 6px 8px;
            border: 1px solid var(--border); border-radius: 4px;
            background: var(--bg); text-decoration: none; color: var(--text);
            font-size: 11px; line-height: 1.3; cursor: pointer;
            transition: border-color 100ms;
        }
        #nodes-root .ng-cell:hover { border-color: var(--accent, #6b9bd1); }
        #nodes-root .ng-cell.is-active {
            border-color: var(--accent, #6b9bd1);
            background: rgba(107,155,209,0.10);
        }
        #nodes-root .ng-cell .ng-id {
            font-family: ui-monospace, monospace; font-weight: 600;
            display: block; color: var(--text);
        }
        #nodes-root .ng-cell .ng-lbl {
            display: block; color: var(--text-muted);
            font-size: 10px; margin-top: 2px;
            overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        #nodes-root .ng-cell.nl-derived .ng-id { font-style: italic; }
        #nodes-root .ng-cell.nl-outcome { border-color: rgba(179,137,94,0.35); }
        #nodes-root .ng-cell.nl-outcome .ng-id { color: #b3895e; }
        #nodes-root .ng-cell .ng-badges {
            position: absolute; top: 4px; right: 4px;
            display: flex; gap: 2px; flex-direction: column; align-items: flex-end;
        }
        #nodes-root .ng-cell .ng-badge {
            font-size: 8px; line-height: 1;
            padding: 2px 3px; border-radius: 2px;
            font-family: ui-monospace, monospace; font-weight: 600;
            letter-spacing: 0.05em;
        }
        #nodes-root .ng-cell .ng-badge.ng-badge-in {
            color: #6b9bd1; background: rgba(107,155,209,0.15);
        }
        #nodes-root .ng-cell .ng-badge.ng-badge-out {
            color: #b3895e; background: rgba(179,137,94,0.15);
        }
        #nodes-root .ng-cell .ng-badge.ng-badge-stage {
            color: var(--text-muted); background: transparent;
        }

        /* ─── Layout toggle (Modules ↔ Flow) ─────────────────── */
        #nodes-root .ng-layout-toggle {
            display: inline-flex; border: 1px solid var(--border);
            border-radius: 4px; overflow: hidden;
        }
        #nodes-root .ng-layout-toggle button {
            background: var(--bg); color: var(--text-muted);
            border: none; padding: 4px 10px; cursor: pointer;
            font-family: inherit; font-size: 11px; line-height: 1.5;
        }
        #nodes-root .ng-layout-toggle button:hover { color: var(--text); }
        #nodes-root .ng-layout-toggle button.is-active {
            background: var(--accent, #6b9bd1); color: #fff;
        }

        /* ─── Flow view (narrative chain, left-to-right) ─────── */
        /* Pannable / zoomable canvas like /explore. */
        #nodes-root .ng-flow-canvas {
            position: relative; flex: 1;
            overflow: hidden; background: var(--bg);
            cursor: grab; user-select: none;
        }
        #nodes-root .ng-flow-canvas.dragging { cursor: grabbing; }
        #nodes-root .ng-flow-viewport {
            position: absolute; top: 0; left: 0;
            transform-origin: 0 0; will-change: transform;
            padding: 20px;
        }
        #nodes-root .ng-flow {
            display: flex; gap: 60px; align-items: flex-start;
            position: relative;
        }
        #nodes-root .ng-flow-col {
            flex: 0 0 auto; width: 220px;
            display: flex; flex-direction: column; gap: 24px;
            position: relative;
        }
        #nodes-root .ng-flow-edges {
            position: absolute; top: 0; left: 0;
            pointer-events: none; overflow: visible;
            color: var(--text-muted); z-index: 0;
        }
        #nodes-root .ng-flow-edges path {
            fill: none; stroke: currentColor; stroke-width: 1.4;
            opacity: 0.7;
        }
        #nodes-root .ng-flow-step {
            border: 1px solid var(--border); border-radius: 5px;
            padding: 7px 9px;
            background: rgba(255,255,255,0.9);
            text-decoration: none; color: var(--text);
            display: block; transition: border-color 100ms;
            position: relative; z-index: 1;
        }
        #nodes-root .ng-flow-step-title {
            display: block; text-decoration: none; color: var(--text);
        }
        #nodes-root .ng-flow-step:hover { border-color: var(--accent, #6b9bd1); }
        #nodes-root .ng-flow-step.is-active {
            border-color: var(--accent, #6b9bd1);
            background: rgba(107,155,209,0.20);
        }
        #nodes-root .ng-flow-step.is-opt {
            border-style: dashed;
            background: rgba(255,255,255,0.75);
        }
        #nodes-root .ng-flow-step-nodes {
            display: flex; flex-direction: column; gap: 3px;
            margin-top: 8px; padding-top: 7px;
            border-top: 1px dashed var(--border);
        }
        #nodes-root .ng-flow-step-nodes-head {
            font-size: 8px; color: var(--text-muted);
            text-transform: uppercase; letter-spacing: 0.08em;
            margin-bottom: 3px;
        }
        #nodes-root a.ng-flow-node {
            display: flex; align-items: baseline; gap: 6px;
            padding: 3px 6px; border-radius: 3px;
            background: var(--bg-soft); border: 1px solid transparent;
            text-decoration: none; color: var(--text);
            font-size: 10px; line-height: 1.3;
        }
        #nodes-root a.ng-flow-node:hover { border-color: var(--accent, #6b9bd1); }
        #nodes-root a.ng-flow-node.is-active {
            border-color: var(--accent, #6b9bd1);
            background: rgba(107,155,209,0.12);
        }
        #nodes-root a.ng-flow-node.nl-derived .ng-flow-node-id { font-style: italic; }
        #nodes-root .ng-flow-node-id {
            font-family: ui-monospace, monospace; font-weight: 600;
            flex: 0 0 auto;
        }
        #nodes-root .ng-flow-node-lbl {
            color: var(--text-muted); font-size: 9px;
            overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
            min-width: 0;
        }

        #nodes-root .ng-flow-toolbtn {
            background: var(--bg); color: var(--text-muted);
            border: 1px solid var(--border); border-radius: 4px;
            padding: 3px 8px; cursor: pointer;
            font-family: inherit; font-size: 11px; line-height: 1.5;
        }
        #nodes-root .ng-flow-toolbtn:hover { color: var(--text); }
        #nodes-root .ng-flow-step-row {
            display: flex; align-items: baseline; gap: 5px;
            flex-wrap: wrap;
        }
        #nodes-root .ng-flow-step-id {
            font-family: ui-monospace, monospace; font-weight: 600;
            font-size: 11px; color: var(--text);
        }
        #nodes-root .ng-flow-step-kind {
            font-size: 8px; color: var(--text-muted);
            text-transform: uppercase; letter-spacing: 0.08em;
        }
        #nodes-root .ng-flow-opt-badge {
            font-size: 8px; padding: 1px 4px; border-radius: 2px;
            background: rgba(179,137,94,0.15); color: #b3895e;
            font-family: ui-monospace, monospace; font-weight: 600;
            letter-spacing: 0.05em;
        }
        #nodes-root .ng-flow-step-label {
            font-size: 10px; color: var(--text-muted);
            margin-top: 3px; line-height: 1.3;
        }
        #nodes-root .ng-flow-step-note {
            font-size: 9px; color: var(--text-muted); font-style: italic;
            margin-top: 4px; line-height: 1.3;
        }
        #nodes-root .ng-flow-outcomes {
            display: flex; flex-direction: column; gap: 3px;
            margin-top: 8px; padding: 7px 8px 4px 8px;
            border-top: 1px dashed rgba(179,137,94,0.45);
            background: rgba(179,137,94,0.06);
            border-radius: 0 0 4px 4px;
            margin-left: -9px; margin-right: -9px;
            margin-bottom: -7px;
        }
        #nodes-root .ng-flow-outcomes-head {
            font-size: 8px; color: #b3895e;
            text-transform: uppercase; letter-spacing: 0.08em;
            font-weight: 600;
            margin-bottom: 2px;
        }
        #nodes-root a.ng-flow-outcome {
            font-size: 10px; color: #b3895e; text-decoration: none;
            padding: 1px 0; font-family: ui-monospace, monospace;
            border-bottom: 1px dotted transparent;
        }
        #nodes-root a.ng-flow-outcome:hover {
            border-bottom-color: rgba(179,137,94,0.5);
        }
        #nodes-root a.ng-flow-outcome.is-active {
            color: var(--text); font-weight: 600;
            border-bottom-color: var(--accent, #6b9bd1);
        }

        #nodes-root .nodes-detail {
            flex: 1; overflow-y: auto; padding: 20px 28px;
        }

        /* ─── Narrative preview (node detail, top section) ──── */
        #nodes-root .nd-narr {
            border: 1px solid var(--border); border-radius: 8px;
            padding: 14px 16px; margin: 0 0 20px 0;
            background: var(--bg-soft);
        }
        #nodes-root .nd-narr-head {
            font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em;
            color: var(--text-muted); font-weight: 600; margin: 0 0 10px 0;
        }
        #nodes-root .nd-narr-question {
            font-size: 15px; font-weight: 600; color: var(--text);
            margin: 0 0 6px 0; line-height: 1.35;
        }
        #nodes-root .nd-narr-context {
            font-size: 13px; color: var(--text); line-height: 1.5;
        }
        #nodes-root .nd-narr-context p:first-child { margin-top: 0; }
        #nodes-root .nd-narr-context p:last-child { margin-bottom: 0; }
        #nodes-root .nd-narr-source {
            margin-top: 8px; font-size: 11px;
        }
        #nodes-root .nd-narr-source a {
            color: var(--text-muted); text-decoration: none;
            border-bottom: 1px dotted var(--text-muted);
        }
        #nodes-root .nd-narr-source a:hover { color: var(--text); }
        #nodes-root .nd-narr-options {
            display: flex; flex-direction: column; gap: 8px;
            margin-top: 14px; padding-top: 12px;
            border-top: 1px solid var(--border);
        }
        #nodes-root .nd-narr-opt {
            padding: 10px 12px; border: 1px solid var(--border);
            border-radius: 6px; background: var(--bg);
        }
        #nodes-root .nd-narr-opt-head {
            display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap;
            margin-bottom: 4px;
        }
        #nodes-root .nd-narr-opt-id {
            font-family: ui-monospace, monospace; font-size: 11px;
            color: var(--text-muted); background: var(--bg-soft);
            padding: 2px 6px; border-radius: 3px;
        }
        #nodes-root .nd-narr-opt-label {
            font-size: 13px; font-weight: 600; color: var(--text);
            flex: 1 1 auto; min-width: 0;
        }
        #nodes-root .nd-narr-opt-desc {
            font-size: 12px; color: var(--text-muted); line-height: 1.5;
        }
        #nodes-root .nd-narr-opt-desc p:first-child { margin-top: 0; }
        #nodes-root .nd-narr-opt-desc p:last-child { margin-bottom: 0; }
        #nodes-root .nd-narr-variant-row {
            display: flex; align-items: center; gap: 8px;
            margin: 4px 0 8px 0;
        }
        #nodes-root .nd-narr-variant-row label {
            font-size: 10px; text-transform: uppercase;
            letter-spacing: 0.06em; color: var(--text-muted);
        }
        #nodes-root .nd-narr-select {
            font-size: 11px; padding: 2px 6px; max-width: 320px;
            background: var(--bg); color: var(--text);
            border: 1px solid var(--border); border-radius: 3px;
            font-family: ui-monospace, monospace;
        }
        #nodes-root .nd-narr-hidden { display: none; }
        #nodes-root .nd-narr-hint {
            font-size: 10px; color: var(--text-muted);
            font-style: italic; margin-top: 4px;
        }
        #nodes-root .nodes-detail-empty {
            color: var(--text-muted); font-size: 14px; padding: 40px 0;
        }
        #nodes-root h2.nd-title {
            margin: 0 0 4px 0; font-size: 20px; display: flex;
            align-items: baseline; gap: 10px;
        }
        #nodes-root h2.nd-title .nd-id {
            font-family: ui-monospace, monospace; color: var(--accent, #6b9bd1);
        }
        #nodes-root h2.nd-title.is-outcome .nd-id { color: #b3895e; }
        #nodes-root .nd-subtitle {
            color: var(--text-muted); font-size: 13px; margin-bottom: 18px;
        }
        #nodes-root .nd-meta {
            display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 16px;
        }
        #nodes-root .nd-meta .nd-tag {
            font-size: 11px; padding: 2px 8px; border-radius: 999px;
            background: var(--bg-soft); border: 1px solid var(--border);
            color: var(--text-muted);
        }
        #nodes-root .nd-section {
            margin: 18px 0; padding-top: 12px; border-top: 1px solid var(--border);
        }
        #nodes-root .nd-section > h3 {
            font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em;
            color: var(--text-muted); margin: 0 0 10px 0; font-weight: 600;
        }
        #nodes-root .nd-row {
            display: flex; margin-bottom: 8px; gap: 14px; align-items: flex-start;
        }
        #nodes-root .nd-row-label {
            flex: 0 0 160px; font-size: 12px; color: var(--text-muted);
            font-family: ui-monospace, monospace;
        }
        #nodes-root .nd-row-body { flex: 1; font-size: 13px; }
        #nodes-root .nd-chip-row { display: flex; flex-wrap: wrap; gap: 6px; }
        #nodes-root .nd-chip {
            font-size: 12px; padding: 3px 8px; border-radius: 4px;
            background: var(--bg-soft); border: 1px solid var(--border);
            color: var(--text); text-decoration: none; cursor: pointer;
            font-family: ui-monospace, monospace;
        }
        #nodes-root .nd-chip:hover { border-color: var(--accent, #6b9bd1); color: var(--accent, #6b9bd1); }
        #nodes-root .nd-chip.nd-chip-outcome { color: #b3895e; border-color: rgba(179,137,94,0.35); }
        #nodes-root .nd-chip.nd-chip-muted { color: var(--text-muted); opacity: 0.7; }
        #nodes-root .nd-chip-count {
            font-size: 10px; color: var(--text-muted); margin-left: 3px;
        }
        #nodes-root pre.nd-json {
            background: var(--bg-soft); border: 1px solid var(--border);
            border-radius: 4px; padding: 8px 10px; font-size: 11px;
            font-family: ui-monospace, monospace; overflow-x: auto;
            margin: 4px 0 8px 0; color: var(--text-muted);
            white-space: pre-wrap; word-break: break-word;
        }
        #nodes-root .nd-empty {
            font-size: 12px; color: var(--text-muted); font-style: italic;
        }
        #nodes-root .nd-site {
            margin: 8px 0 12px 0; padding: 8px 10px;
            background: var(--bg-soft); border-radius: 4px;
            border: 1px solid var(--border); font-size: 12px;
        }
        #nodes-root .nd-site-head {
            font-family: ui-monospace, monospace; color: var(--text-muted);
            font-size: 11px; margin-bottom: 4px;
        }
        #nodes-root .nd-site-body { font-family: ui-monospace, monospace; color: var(--text); }

        /* ─── Exit-plan table ────────────────────────────────── */
        #nodes-root table.nd-exitplan {
            width: 100%; border-collapse: collapse; font-size: 12px;
            margin: 4px 0 8px 0;
        }
        #nodes-root table.nd-exitplan th {
            text-align: left; padding: 6px 8px;
            border-bottom: 1px solid var(--border);
            font-size: 10px; color: var(--text-muted);
            text-transform: uppercase; letter-spacing: 0.08em;
            font-weight: 600;
        }
        #nodes-root table.nd-exitplan td {
            padding: 8px; vertical-align: top;
            border-bottom: 1px solid var(--border);
            font-family: ui-monospace, monospace;
        }
        #nodes-root table.nd-exitplan tbody tr:last-child td { border-bottom: none; }
        #nodes-root table.nd-exitplan td code {
            background: var(--bg-soft); padding: 1px 4px;
            border-radius: 3px; font-size: 11px;
        }
        #nodes-root .nd-exitplan-edges code { margin-right: 4px; }
        #nodes-root .nd-empty-inline {
            color: var(--text-muted); font-style: italic; font-family: inherit;
        }
    `;

    function injectCss() {
        if (document.getElementById('nodes-css')) return;
        const s = document.createElement('style');
        s.id = 'nodes-css';
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
            if (narr.questionText && !node.questionText) node.questionText = narr.questionText;
        }
        loaded = true;
    }

    // ────────────────────────────────────────────────────────────
    // Static analysis
    // ────────────────────────────────────────────────────────────

    // Keys inside condition objects that are structural, not dim references.
    const STRUCT_KEYS = new Set([
        'reason', '_ck', '_ct', '_cv', '_direct', 'required', 'not',
        'match', 'value', 'valueMap', 'if', 'text', '_default', '_when',
        'set', 'move', 'when'
    ]);

    // Walk arbitrary nested object and collect keys that are dim IDs.
    // Skips values inside `collapseToFlavor.move` (those are *writes*, not reads).
    function collectDimRefs(obj, dimSet, out) {
        if (!obj || typeof obj !== 'object') return;
        if (Array.isArray(obj)) { obj.forEach(x => collectDimRefs(x, dimSet, out)); return; }
        for (const [k, v] of Object.entries(obj)) {
            if (dimSet.has(k)) out.add(k);
            if (v && typeof v === 'object') collectDimRefs(v, dimSet, out);
        }
    }

    // Engine `_precompile()` mutates every condition / derivation rule in
    // place to add compiled fast-path fields:
    //   _ck/_ct/_cv/_direct  (conditions)
    //   _mk/_mt/_mv/_direct  (derivation rules)
    //   _dwLen               (derived-node rule count cache)
    // They're noise for the reader — strip before JSON-dumping.
    const COMPILED_KEYS = new Set([
        '_ck', '_ct', '_cv', '_direct', '_mk', '_mt', '_mv', '_dwLen'
    ]);
    function stripCompiled(x) {
        if (Array.isArray(x)) return x.map(stripCompiled);
        if (x && typeof x === 'object') {
            const out = {};
            for (const [k, v] of Object.entries(x)) {
                if (COMPILED_KEYS.has(k)) continue;
                out[k] = stripCompiled(v);
            }
            return out;
        }
        return x;
    }
    function prettyJson(x) {
        return JSON.stringify(stripCompiled(x), null, 2);
    }

    // Build analysis indices. Call once after load.
    let analysis = null;
    function buildAnalysis() {
        if (analysis) return analysis;
        const NODES = window.Engine.NODES;
        const dimSet = new Set(NODES.map(n => n.id));
        // Outcome "dims" exist too — templates reference marker-like keys
        // written only via collapseToFlavor.set (e.g. `rollout_set`,
        // `asi_happens`). Include those so references to them resolve, but
        // we'll treat them as synthetic dims without a host node.
        const syntheticDims = new Set();

        // First pass: discover synthetic dims written by collapseToFlavor.set.
        // collapseToFlavor may be a single block or an array of blocks (array
        // form is used when the collapse values depend on sel at edge-pick time,
        // e.g. decel terminating edges).
        for (const n of NODES) {
            if (!n.edges) continue;
            for (const e of n.edges) {
                if (!e.collapseToFlavor) continue;
                const blocks = Array.isArray(e.collapseToFlavor) ? e.collapseToFlavor : [e.collapseToFlavor];
                for (const c of blocks) {
                    if (!c || !c.set) continue;
                    for (const k of Object.keys(c.set)) {
                        if (!dimSet.has(k)) syntheticDims.add(k);
                    }
                }
            }
        }
        const allDims = new Set([...dimSet, ...syntheticDims]);

        // Per-node analysis.
        // Shape:
        //   nodeReads      : nodeId → Set<dimId>            (dims whose values this node reads)
        //   nodeReadSites  : nodeId → [{ where, dims, raw }]
        //   nodeWrites     : nodeId → Set<dimId>            (dims this node can set in sel via collapseToFlavor.set)
        //   nodeMoves      : nodeId → Set<dimId>            (dims this node moves to flavor via collapseToFlavor.move)
        //   outcomeReads   : outcomeId → Set<dimId>
        //   outcomeSites   : outcomeId → { reachable: Set, flavor: Set, primary: string }
        //   readBy         : dimId → [{ nodeId, where }]    (reverse of nodeReadSites)
        //   writtenBy      : dimId → [{ nodeId, via }]      (reverse; 'pick' means user picks an edge, 'set' means collapseToFlavor.set, 'derive' means deriveWhen sets this.id)
        //   movedBy        : dimId → [{ nodeId }]
        //   outcomesUsing  : dimId → Set<outcomeId>

        const nodeReads = new Map();
        const nodeReadSites = new Map();
        const nodeWrites = new Map();
        const nodeMoves = new Map();
        const outcomeReads = new Map();
        const outcomeSites = new Map();
        const readBy = new Map();
        const writtenBy = new Map();
        const movedBy = new Map();
        const outcomesUsing = new Map();

        const pushMap = (m, k, v) => {
            if (!m.has(k)) m.set(k, []);
            m.get(k).push(v);
        };
        const addSet = (m, k, v) => {
            if (!m.has(k)) m.set(k, new Set());
            m.get(k).add(v);
        };

        function scanCond(nodeId, where, cond) {
            const dims = new Set();
            collectDimRefs(cond, allDims, dims);
            dims.delete(nodeId); // self-reference isn't interesting
            if (!dims.size) return;
            if (!nodeReads.has(nodeId)) nodeReads.set(nodeId, new Set());
            if (!nodeReadSites.has(nodeId)) nodeReadSites.set(nodeId, []);
            for (const d of dims) nodeReads.get(nodeId).add(d);
            nodeReadSites.get(nodeId).push({ where, dims: [...dims], raw: cond });
            for (const d of dims) pushMap(readBy, d, { nodeId, where });
        }

        for (const n of NODES) {
            // Reads
            (n.activateWhen || []).forEach((c, i) => scanCond(n.id, `activateWhen[${i}]`, c));
            (n.hideWhen || []).forEach((c, i) => scanCond(n.id, `hideWhen[${i}]`, c));
            (n.deriveWhen || []).forEach((d, i) => {
                scanCond(n.id, `deriveWhen[${i}].match`, d.match || {});
                // deriveWhen[].value/valueMap writes to this.id — track as "derive" below.
            });
            // Edges
            // Normalize `requires` (which is a single condition object, not
            // an array like disabledWhen/activateWhen) into an array.
            const asArray = (x) => Array.isArray(x) ? x : (x ? [x] : []);
            (n.edges || []).forEach((e, ei) => {
                asArray(e.disabledWhen).forEach((c, ci) => scanCond(n.id, `edges.${e.id}.disabledWhen[${ci}]`, c));
                asArray(e.requires).forEach((c, ci) => scanCond(n.id, `edges.${e.id}.requires`, c));
                if (!e.collapseToFlavor) return;
                const blocks = Array.isArray(e.collapseToFlavor) ? e.collapseToFlavor : [e.collapseToFlavor];
                blocks.forEach((c, bi) => {
                    if (!c) return;
                    const suffix = blocks.length > 1 ? `[${bi}]` : '';
                    if (c.when) {
                        scanCond(n.id, `edges.${e.id}.collapseToFlavor${suffix}.when`, c.when);
                    }
                    if (c.set) {
                        for (const dim of Object.keys(c.set)) {
                            if (!nodeWrites.has(n.id)) nodeWrites.set(n.id, new Set());
                            nodeWrites.get(n.id).add(dim);
                            pushMap(writtenBy, dim, { nodeId: n.id, via: `edges.${e.id}.collapseToFlavor${suffix}.set`, value: c.set[dim] });
                        }
                    }
                    if (c.move) {
                        for (const dim of c.move) {
                            if (!nodeMoves.has(n.id)) nodeMoves.set(n.id, new Set());
                            nodeMoves.get(n.id).add(dim);
                            pushMap(movedBy, dim, { nodeId: n.id, via: `edges.${e.id}.collapseToFlavor${suffix}.move` });
                        }
                    }
                });
            });
            // Self-writes via derivation
            if (n.deriveWhen && n.deriveWhen.length) {
                pushMap(writtenBy, n.id, { nodeId: n.id, via: 'deriveWhen', value: '(derived)' });
            }
            // User-pick: each answer edge on a non-derived node writes this.id
            if (!n.derived && n.edges && n.edges.length) {
                pushMap(writtenBy, n.id, { nodeId: n.id, via: 'user-pick', value: '(edge id)' });
            }
        }

        // Outcomes
        for (const t of templates) {
            const reachableDims = new Set();
            const flavorDims = new Set();
            (t.reachable || []).forEach((clause) => collectDimRefs(clause, allDims, reachableDims));
            if (t.flavors) {
                // Top-level flavor keys are dims.
                for (const [dim, body] of Object.entries(t.flavors)) {
                    if (allDims.has(dim)) flavorDims.add(dim);
                    // _when conditions inside flavor texts also reference dims.
                    collectDimRefs(body, allDims, flavorDims);
                }
            }
            const all = new Set([...reachableDims, ...flavorDims]);
            outcomeReads.set(t.id, all);
            outcomeSites.set(t.id, {
                reachable: reachableDims,
                flavor: flavorDims,
                primary: t.primaryDimension || ''
            });
            for (const d of all) addSet(outcomesUsing, d, t.id);
        }

        analysis = {
            dimSet, syntheticDims, allDims,
            nodeReads, nodeReadSites, nodeWrites, nodeMoves,
            outcomeReads, outcomeSites,
            readBy, writtenBy, movedBy, outcomesUsing
        };
        return analysis;
    }

    // ────────────────────────────────────────────────────────────
    // Rendering
    // ────────────────────────────────────────────────────────────

    function esc(s) {
        return String(s).replace(/[&<>"']/g, c => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        })[c]);
    }

    // Group an exit-plan tuple list by (nodeId, canonical when, canonical set),
    // rolling multiple edge-ids onto one row. Canonicalize by stable
    // JSON so equal objects compare equal.
    function _groupExitPlan(plan) {
        const groups = new Map();
        for (const t of plan) {
            const whenKey = JSON.stringify(t.when || {});
            const setKey = JSON.stringify(t.set || {});
            const key = `${t.nodeId}||${whenKey}||${setKey}`;
            let g = groups.get(key);
            if (!g) {
                g = { nodeId: t.nodeId, when: t.when || {}, set: t.set || {}, edgeIds: [] };
                groups.set(key, g);
            }
            g.edgeIds.push(t.edgeId);
        }
        return Array.from(groups.values());
    }

    // ────────────────────────────────────────────────────────────
    // Deduced outcome table
    //
    // Pivots a module's exitPlan into a human-readable "what are this
    // module's atomic outcomes?" view. There are two pivot modes; the
    // function picks whichever is more informative for the given
    // module:
    //
    //   pivot='set'  — groups tuples by their full write bundle.
    //     One row per distinct bundle; exits are the (nodeId, edgeId)
    //     pairs that produce it. This is the "what can this module
    //     write to sel?" view. Used when the exitPlan has ≥2 distinct
    //     bundles (decel, escape, emergence, rollout, proliferation,
    //     intent_loop, war_loop).
    //
    //   pivot='node' — groups tuples by terminating nodeId.
    //     One row per distinct nodeId. Used when every exit writes the
    //     same bundle (who_benefits, control, alignment_loop) — in
    //     that case only the completion marker is committed and the
    //     interesting info is "which internal question actually ended
    //     the module". Without this fallback those three modules
    //     would display a single uninformative row.
    //
    // The bundle for each row is displayed verbatim, including the
    // completion marker dim. For modules with a string completion
    // marker (decel_set, escape_set, …) the marker is a boolean "am I
    // done" flag that's constant across outcomes, so the renderer
    // hides it from row labels. For modules with an object-form
    // marker ({ dim, values }) the marker dim is semantically the
    // output axis (emergence's `capability`), so the renderer keeps
    // it visible.
    //
    // Exposed on window.Nodes so explore.js's "Show All Connections"
    // overlay can render the same table inside module cards.
    function computeModuleOutcomeTable(mod) {
        if (!mod || !mod.exitPlan || !mod.exitPlan.length) {
            return { pivot: 'set', outcomes: [], markerDim: null };
        }
        const cm = mod.completionMarker;
        // Only hide string-form markers from labels — object-form markers
        // carry the discriminating value and must stay visible.
        const markerDim = typeof cm === 'string' ? cm : null;

        const byBundle = new Map();
        for (const t of mod.exitPlan) {
            const key = JSON.stringify(t.set || {});
            let g = byBundle.get(key);
            if (!g) {
                g = { setBundle: t.set || {}, exits: [] };
                byBundle.set(key, g);
            }
            g.exits.push({ nodeId: t.nodeId, edgeId: t.edgeId, when: t.when || {} });
        }

        if (byBundle.size > 1) {
            return {
                pivot: 'set',
                markerDim,
                outcomes: Array.from(byBundle.values()),
            };
        }

        // Trivial-bundle fallback: pivot by terminal nodeId so the user
        // sees the 3-4 exit questions instead of one "completion only"
        // row. setBundle is still carried (every row shares the same
        // bundle) so the renderer can show it once at the top if it
        // wants.
        const soloBundle = Array.from(byBundle.values())[0].setBundle;
        const byNode = new Map();
        for (const t of mod.exitPlan) {
            let g = byNode.get(t.nodeId);
            if (!g) {
                g = { nodeId: t.nodeId, setBundle: soloBundle, exits: [] };
                byNode.set(t.nodeId, g);
            }
            g.exits.push({ nodeId: t.nodeId, edgeId: t.edgeId, when: t.when || {} });
        }
        return {
            pivot: 'node',
            markerDim,
            outcomes: Array.from(byNode.values()),
        };
    }

    // Human-readable label for an outcome's write bundle. `markerDim`
    // is hidden (because it's constant per-module); everything else
    // is rendered as `dim=value` joined with commas. If the result is
    // empty (bundle contained only the marker), returns '(completion
    // only)'.
    function _fmtOutcomeBundle(bundle, markerDim) {
        const entries = Object.entries(bundle || {})
            .filter(([k]) => k !== markerDim);
        if (!entries.length) return '';
        return entries.map(([k, v]) =>
            `<code>${esc(k)}</code>=<code>${esc(typeof v === 'object' ? JSON.stringify(v) : String(v))}</code>`
        ).join(', ');
    }

    // Render the deduced outcome table. One row per outcome; the
    // outcome's label comes from its set bundle (pivot='set') or its
    // terminating nodeId (pivot='node'). Each row lists the
    // (nodeId, edgeId) exits that produce that outcome, compacting
    // edges that share a nodeId onto one line.
    function _renderOutcomeTable(mod) {
        const table = computeModuleOutcomeTable(mod);
        if (!table.outcomes.length) return '';
        const { pivot, markerDim, outcomes } = table;

        let html = `<table class="nd-exitplan"><thead><tr>`;
        html += pivot === 'set'
            ? `<th>outcome (writes)</th><th>exits</th>`
            : `<th>terminal question</th><th>edges</th>`;
        html += `</tr></thead><tbody>`;

        for (const o of outcomes) {
            html += `<tr>`;
            if (pivot === 'set') {
                const label = _fmtOutcomeBundle(o.setBundle, markerDim);
                html += `<td>${label || '<span class="nd-empty-inline">(completion only)</span>'}</td>`;
            } else {
                html += `<td>${dimChip(o.nodeId)}</td>`;
            }
            // Group edges by nodeId so "decel_2mo_action escapes / decel_4mo_action
            // escapes / …" becomes one line per action-node.
            const byNode = new Map();
            for (const ex of o.exits) {
                if (!byNode.has(ex.nodeId)) byNode.set(ex.nodeId, []);
                byNode.get(ex.nodeId).push(ex.edgeId);
            }
            const parts = [];
            for (const [nodeId, edgeIds] of byNode) {
                if (pivot === 'node') {
                    parts.push(edgeIds.map(e => `<code>${esc(e)}</code>`).join(' '));
                } else {
                    parts.push(`${dimChip(nodeId)} ${edgeIds.map(e => `<code>${esc(e)}</code>`).join(' ')}`);
                }
            }
            html += `<td class="nd-exitplan-edges">${parts.join('<br>')}</td>`;
            html += `</tr>`;
        }
        html += `</tbody></table>`;
        return html;
    }

    function _renderExitPlanTable(plan) {
        const rows = _groupExitPlan(plan);
        let html = `<table class="nd-exitplan"><thead><tr>`
                 + `<th>node</th><th>edges</th><th>when</th><th>set</th>`
                 + `</tr></thead><tbody>`;
        for (const r of rows) {
            html += `<tr>`;
            html += `<td>${dimChip(r.nodeId)}</td>`;
            html += `<td class="nd-exitplan-edges">${r.edgeIds.map(e => `<code>${esc(e)}</code>`).join(' ')}</td>`;
            const whenEmpty = !r.when || Object.keys(r.when).length === 0;
            html += `<td>${whenEmpty ? '<span class="nd-empty-inline">—</span>' : `<code>${esc(prettyJson(r.when))}</code>`}</td>`;
            const setEmpty = !r.set || Object.keys(r.set).length === 0;
            html += `<td>${setEmpty ? '<span class="nd-empty-inline">—</span>' : _renderSetCell(r.set)}</td>`;
            html += `</tr>`;
        }
        html += `</tbody></table>`;
        return html;
    }

    function _renderSetCell(set) {
        return Object.entries(set).map(([k, v]) =>
            `<div><code>${esc(k)}</code>=<code>${esc(typeof v === 'object' ? JSON.stringify(v) : String(v))}</code></div>`
        ).join('');
    }

    // Short human-readable form of a module's completionMarker. The
    // marker is either a dim-name string ('escape_set'), or an object
    // { dim, values } meaning "done when sel[dim] ∈ values" (only
    // emergence uses the object form today — see graph.js).
    function _fmtCompletionMarker(cm) {
        if (!cm) return '';
        if (typeof cm === 'string') return cm;
        if (typeof cm === 'object' && cm.dim) {
            const vals = Array.isArray(cm.values) ? cm.values : [];
            return vals.length
                ? `${cm.dim} ∈ {${vals.join(', ')}}`
                : cm.dim;
        }
        return String(cm);
    }

    function dimChip(dim, opts = {}) {
        const NODE_MAP = window.Engine.NODE_MAP;
        const node = NODE_MAP[dim];
        const isSynthetic = !node;
        const href = `#/nodes?n=${encodeURIComponent(dim)}`;
        const cls = 'nd-chip' + (isSynthetic ? ' nd-chip-muted' : '');
        const labelHtml = node && node.label
            ? `<span class="nd-chip-count">${esc(node.label)}</span>` : '';
        const countHtml = opts.count
            ? `<span class="nd-chip-count">×${opts.count}</span>` : '';
        return `<a class="${cls}" href="${href}">${esc(dim)}${labelHtml}${countHtml}</a>`;
    }

    function outcomeChip(oid, tpl) {
        const title = tpl ? tpl.title || '' : '';
        return `<a class="nd-chip nd-chip-outcome" href="#/nodes?o=${encodeURIComponent(oid)}">${esc(oid)}${title ? `<span class="nd-chip-count">${esc(title)}</span>` : ''}</a>`;
    }

    // Compute per-node cross-module data flow indicators:
    //   hasIn:  node reads a dim owned by a different module (or owned by
    //           some module, if node itself is flat).
    //   hasOut: node's dim is read by something living in a different
    //           module (or by some module, if node itself is flat).
    // Used by the grid to show contract-at-a-glance badges.
    function _crossModuleFlow(node, A) {
        const NODE_MAP = window.Engine.NODE_MAP;
        const myMod = node.module || null;
        let hasIn = false, hasOut = false;
        const reads = A.nodeReads.get(node.id);
        if (reads) {
            for (const d of reads) {
                const src = NODE_MAP[d];
                const srcMod = src && src.module;
                if (srcMod && srcMod !== myMod) { hasIn = true; break; }
            }
        }
        const readers = A.readBy.get(node.id) || [];
        for (const r of readers) {
            const src = NODE_MAP[r.nodeId];
            const srcMod = src && src.module;
            if (srcMod !== myMod && (srcMod || myMod)) { hasOut = true; break; }
        }
        return { hasIn, hasOut };
    }

    function _cellHtml(node, selected, A, opts = {}) {
        const isOutcome = !!opts.outcome;
        const isNode = !isOutcome;
        const href = isOutcome ? `#/nodes?o=${encodeURIComponent(node.id)}`
                                : `#/nodes?n=${encodeURIComponent(node.id)}`;
        const active = (isNode && selected.nodeId === node.id) ||
                       (isOutcome && selected.outcomeId === node.id);
        const cls = 'ng-cell'
            + (active ? ' is-active' : '')
            + (node.derived ? ' nl-derived' : '')
            + (isOutcome ? ' nl-outcome' : '');
        let badges = '';
        if (isNode && A) {
            const flow = _crossModuleFlow(node, A);
            if (flow.hasIn) badges += `<span class="ng-badge ng-badge-in" title="reads a dim owned by another module">r</span>`;
            if (flow.hasOut) badges += `<span class="ng-badge ng-badge-out" title="its dim is read by something in another module">w</span>`;
            if (node.stage != null) badges += `<span class="ng-badge ng-badge-stage" title="stage">${esc(String(node.stage))}</span>`;
        }
        const badgesHtml = badges ? `<span class="ng-badges">${badges}</span>` : '';
        const search = esc((node.id + ' ' + (node.label || '')).toLowerCase());
        return `<a class="${cls}" href="${href}" data-search="${search}">
            <span class="ng-id">${esc(node.id)}</span>
            <span class="ng-lbl">${esc(node.label || '')}</span>
            ${badgesHtml}
        </a>`;
    }

    // ────────────────────────────────────────────────────────────
    // Narrative flow DAG. Each entry is a distinct slot keyed by a
    // unique `key` (a module may appear in multiple slots, e.g. escape
    // has early / early-alt / late occurrences). Edges describe the
    // expected narrative transitions; optional branches diverge from
    // a parent and (sometimes) rejoin a later mainline node.
    // ────────────────────────────────────────────────────────────
    const FLOW_DAG = {
        nodes: [
            { key: 'emergence',        id: 'emergence',                    kind: 'module' },
            { key: 'plateau_bd',       id: 'plateau_benefit_distribution', kind: 'node',   note: 'if not asi' },
            { key: 'auto_bd',          id: 'auto_benefit_distribution',    kind: 'node',   note: 'if not asi' },
            { key: 'rollout_early',    id: 'early_rollout',                kind: 'module', note: 'early (plateau / automation)',
              earlyExits: ['the-plateau', 'the-automation'] },
            { key: 'control',          id: 'control',                      kind: 'module' },
            { key: 'alignment',        id: 'alignment_loop',               kind: 'module' },
            { key: 'decel',            id: 'decel',                        kind: 'module' },
            { key: 'escape_early',     id: 'escape',                       kind: 'module', note: 'early',
              earlyExits: ['the-ruin', 'the-escape', 'the-chaos', 'the-alien-ai'] },
            { key: 'proliferation',    id: 'proliferation',                kind: 'module' },
            { key: 'escape_early_alt', id: 'escape',                       kind: 'module', note: 'early-alt',
              earlyExits: ['the-ruin', 'the-escape', 'the-chaos', 'the-alien-ai'] },
            { key: 'intent',           id: 'intent_loop',                  kind: 'module' },
            { key: 'war',              id: 'war_loop',                     kind: 'module', note: 'if escalates',
              earlyExits: ['the-ruin'] },
            { key: 'who_benefits',     id: 'who_benefits',                 kind: 'module' },
            { key: 'inert_stays',      id: 'inert_stays',                  kind: 'node',   note: 'if escaped earlier & inert' },
            { key: 'brittle',          id: 'brittle_resolution',           kind: 'node',   note: 'if not already escaped' },
            { key: 'escape_late',      id: 'escape',                       kind: 'module', note: 'late',
              earlyExits: ['the-ruin', 'the-escape', 'the-chaos', 'the-alien-ai'] },
            // Second-position escape slot for the inert_stays=no re-entry.
            // Same module spec as escape_late — backed by the SAME runtime
            // experience (ESCAPE_MODULE re-pending after collapseToFlavor.move
            // evicts ai_goals + escape_set). Split into its own FLOW_DAG slot
            // so the back-edge from inert_stays=no doesn't form a topology
            // cycle with escape_late's forward edge into inert_stays. At
            // runtime users see one escape module either way; this is purely
            // a static-analysis affordance for validate.js / /explore.
            { key: 'escape_re_entry',  id: 'escape',                       kind: 'module', note: 'after inert=no',
              earlyExits: ['the-ruin', 'the-escape', 'the-chaos', 'the-alien-ai'] },
            // Third escape slot for the AI-soft-takeover path:
            // who_benefits=concentration_type:ai_itself triggers
            // ESCAPE_MODULE (its activateWhen includes
            // concentration_type:'ai_itself') even though containment
            // never broke. Same module spec as escape_late /
            // escape_re_entry — split into its own FLOW_DAG slot to
            // avoid topology cycles and to make this distinct entry
            // point visible to validate.js / /explore. On this slot:
            //   * power_use=generous pre-sets ai_goals=benevolent (via
            //     edge collapseToFlavor) and exits the escape pipeline
            //     immediately through the benevolent short-circuit —
            //     lands in the-escape (benevolent).
            //   * power_use=extractive/indifferent leaves ai_goals
            //     unset; ESCAPE asks ai_goals with benevolent + swarm
            //     + marginal disabled (the AI is established as
            //     exploitative, concentrated, and active), forcing
            //     paperclip / power_seeking / alien_* — lands in
            //     the-escape (bad) / the-alien-ai.
            { key: 'escape_after_who', id: 'escape',                       kind: 'module', note: 'after who=ai_itself',
              earlyExits: ['the-ruin', 'the-escape', 'the-chaos', 'the-alien-ai'] },
            { key: 'rollout',          id: 'rollout',                      kind: 'module', note: 'terminal',
              earlyExits: [
                'the-gilded-singularity', 'the-new-hierarchy', 'the-flourishing',
                'the-capture', 'the-standoff', 'the-mosaic', 'the-failure',
                'the-escape', 'the-alien-ai',
              ] },
        ],
        edges: [
            ['emergence',     'plateau_bd'],
            ['emergence',     'auto_bd'],
            ['emergence',     'control'],

            ['plateau_bd',    'rollout_early'],
            ['auto_bd',       'rollout_early'],

            ['control',       'alignment'],

            ['alignment',     'decel'],
            ['alignment',     'escape_early'],
            ['alignment',     'proliferation'],

            ['decel',         'proliferation'],

            ['escape_early',  'proliferation'],
            // ai_goals=benevolent short-circuits the escape pipeline and
            // skips straight past proliferation / intent / war to the
            // who-benefits question.
            ['escape_early',  'who_benefits'],

            ['proliferation', 'escape_early_alt'],
            ['proliferation', 'intent'],

            ['escape_early_alt', 'intent'],
            ['escape_early_alt', 'who_benefits'],

            ['intent',        'war'],
            ['intent',        'who_benefits'],

            ['war',           'who_benefits'],

            ['who_benefits',  'inert_stays'],
            ['who_benefits',  'brittle'],
            ['who_benefits',  'rollout'],

            // inert_stays=no clears ai_goals + escape_set (collapseToFlavor.move)
            // and re-routes through ESCAPE so the user picks a hostile goal
            // and walks the escape pipeline a second time. The back-edge
            // points to escape_re_entry rather than escape_late so the FLOW_DAG
            // stays acyclic — escape_late is only the FIRST escape position
            // (after a brittle exit), and the inert-loop second escape is its
            // own slot. inert_stays=yes is the legitimate "AI escaped but
            // stayed inert forever" branch: escape is genuinely done
            // (escape_set='yes' persists), so the engine yields directly to
            // rollout. Priority routing picks escape_re_entry when escape can
            // re-fire (no branch with markers cleared) and rollout otherwise.
            ['inert_stays',   'escape_re_entry'],
            ['inert_stays',   'rollout'],
            ['brittle',       'escape_late'],
            // brittle_resolution=solved/sufficient recovers alignment
            // (containment stays contained) and bypasses the escape
            // pipeline; only the brittle_resolution=escape branch
            // needs escape_late to play out. Without this edge the
            // recovered branch falls off the graph entirely.
            ['brittle',       'rollout'],

            // escape_late → inert_stays catches the brittle-escape narrative:
            // brittle_resolution=escape sets containment=escaped + alignment=
            // failed, then ESCAPE_MODULE asks ai_goals (only marginal/hostile
            // are reachable now). For ai_goals=marginal the user still owes
            // the inert-stays follow-up (does the dormant AI actually stay
            // dormant?). The slot picker only routes here when inert_stays is
            // askable (ai_goals=['marginal']), otherwise falls through to
            // rollout. After the inert_stays=no re-entry through
            // escape_re_entry, marginal is disabled (ai_goals.marginal.disabledWhen),
            // so this back-edge is naturally not re-traversed — bounding the
            // loop at one extra hop.
            ['escape_late',   'inert_stays'],
            ['escape_late',   'rollout'],

            ['escape_re_entry', 'rollout'],

            // who_benefits → escape_after_who routes the AI-soft-takeover
            // path through the escape pipeline (entered via
            // concentration_type=ai_itself rather than containment=
            // escaped). The slot picker only claims sels where ESCAPE's
            // activateWhen matches AND escape_set isn't yet set —
            // i.e. paths where the AI didn't escape earlier but
            // who_benefits put it in charge anyway. All other
            // who_benefits outputs route via the existing edges
            // (inert_stays / brittle / rollout).
            //
            // No escape_after_who → rollout edge: every path that reaches
            // this slot exits ESCAPE via response_success.no (the only
            // edge enabled when concentration_type=ai_itself + power_use
            // ∈ {extractive,indifferent}) with post_catch='loose' + a
            // hostile ai_goals (paperclip / power_seeking / alien_*),
            // which siphons immediately to the-escape / the-alien-ai —
            // their reachable clauses don't require rollout_set, so
            // the outputs never need to flow forward. The generous
            // branch never reaches this slot at all (its who_benefits
            // exit pre-sets escape_set='yes' which the slot picker
            // rejects via the completionMarker check) — it routes
            // who_benefits → rollout directly.
            ['who_benefits',  'escape_after_who'],
        ],
    };

    // Longest-path column assignment: every node's column is 1 +
    // max(column of any parent). Roots (no incoming edges) are at 0.
    function _computeFlowColumns(dag) {
        const parentsOf = new Map();
        for (const n of dag.nodes) parentsOf.set(n.key, []);
        for (const [p, c] of dag.edges) {
            if (parentsOf.has(c)) parentsOf.get(c).push(p);
        }
        const col = new Map();
        const visit = (k, stack = new Set()) => {
            if (col.has(k)) return col.get(k);
            if (stack.has(k)) return 0; // cycle guard — shouldn't happen
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

    function _flowStepHtml(slot, selected) {
        const NODE_MAP = window.Engine.NODE_MAP;
        const MODULE_MAP = (window.Graph && window.Graph.MODULE_MAP) || {};
        const tplById = new Map(templates.map(t => [t.id, t]));

        const isModule = slot.kind === 'module';
        const titleHref = isModule
            ? `#/nodes?m=${encodeURIComponent(slot.id)}&view=flow`
            : `#/nodes?n=${encodeURIComponent(slot.id)}&view=flow`;
        const active = isModule
            ? selected.moduleId === slot.id
            : selected.nodeId === slot.id;
        const mod = isModule ? MODULE_MAP[slot.id] : null;
        const label = isModule
            ? ((mod && mod.label) || '')
            : ((NODE_MAP[slot.id] && NODE_MAP[slot.id].label) || '');

        const cls = 'ng-flow-step'
            + (slot.opt ? ' is-opt' : '')
            + (active ? ' is-active' : '');

        let html = `<div class="${cls}" data-flow-key="${esc(slot.key)}">`;
        html += `<a class="ng-flow-step-title" href="${titleHref}">`;
        html += `<div class="ng-flow-step-row">`;
        html += `<span class="ng-flow-step-id">${esc(slot.id)}</span>`;
        html += `<span class="ng-flow-step-kind">${esc(slot.kind)}</span>`;
        if (slot.opt) html += `<span class="ng-flow-opt-badge">opt</span>`;
        html += `</div>`;
        if (label) html += `<div class="ng-flow-step-label">${esc(label)}</div>`;
        if (slot.note) html += `<div class="ng-flow-step-note">${esc(slot.note)}</div>`;
        html += `</a>`;

        // Module slots: list internal nodes inline so you can drill
        // straight to a specific question without going through the
        // module detail view first.
        if (isModule && mod && mod.nodeIds && mod.nodeIds.length) {
            const internals = mod.nodeIds.map(id => NODE_MAP[id]).filter(Boolean);
            if (internals.length) {
                html += `<div class="ng-flow-step-nodes">`;
                html += `<div class="ng-flow-step-nodes-head">internal nodes</div>`;
                for (const n of internals) {
                    const href = `#/nodes?n=${encodeURIComponent(n.id)}&view=flow`;
                    const isSel = selected.nodeId === n.id;
                    const ncls = 'ng-flow-node'
                        + (n.derived ? ' nl-derived' : '')
                        + (isSel ? ' is-active' : '');
                    html += `<a class="${ncls}" href="${href}" title="${esc(n.label || '')}">`
                         + `<span class="ng-flow-node-id">${esc(n.id)}</span>`
                         + (n.label ? `<span class="ng-flow-node-lbl">${esc(n.label)}</span>` : '')
                         + `</a>`;
                }
                html += `</div>`;
            }
        }

        // Nest early exits *inside* the module card so it's visually
        // unambiguous which module each outcome attaches to. Styled as
        // a warm-tinted footer strip flush with the card's bottom edge.
        if (slot.earlyExits && slot.earlyExits.length) {
            html += `<div class="ng-flow-outcomes">`;
            html += `<div class="ng-flow-outcomes-head">outcomes</div>`;
            for (const oid of slot.earlyExits) {
                const t = tplById.get(oid);
                const title = (t && t.title) || oid;
                const isSel = selected.outcomeId === oid;
                const oHref = `#/nodes?o=${encodeURIComponent(oid)}&view=flow`;
                html += `<a class="ng-flow-outcome${isSel ? ' is-active' : ''}" href="${oHref}" title="${esc(title)}">${esc(oid)}</a>`;
            }
            html += `</div>`;
        }

        html += `</div>`;
        return html;
    }

    function renderFlow(selected) {
        const col = _computeFlowColumns(FLOW_DAG);
        const byCol = new Map();
        for (const n of FLOW_DAG.nodes) {
            const c = col.get(n.key);
            if (!byCol.has(c)) byCol.set(c, []);
            byCol.get(c).push(n);
        }
        const maxCol = byCol.size ? Math.max(...byCol.keys()) : 0;

        // SVG overlay lives above the columns but behind interactive
        // cards (pointer-events: none). Size is set after mount.
        let html = `<svg class="ng-flow-edges" xmlns="http://www.w3.org/2000/svg">`
                 + `<defs>`
                 + `<marker id="ng-flow-arrow" viewBox="0 0 10 10" refX="9" refY="5" `
                 +         `markerWidth="7" markerHeight="7" orient="auto-start-reverse">`
                 + `<path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor"/>`
                 + `</marker>`
                 + `</defs>`
                 + `</svg>`;
        html += `<div class="ng-flow">`;
        for (let c = 0; c <= maxCol; c++) {
            const nodes = byCol.get(c) || [];
            html += `<div class="ng-flow-col">`;
            for (const slot of nodes) html += _flowStepHtml(slot, selected);
            html += `</div>`;
        }
        html += `</div>`;
        return html;
    }

    // Draws SVG arrows between flow DAG nodes after the DOM has been
    // laid out. Coordinates are in the viewport's unscaled local space
    // (SVG is inside the transformed viewport so arrows scale with the
    // content). Parent right-edge midpoint → child left-edge midpoint,
    // cubic bezier with horizontal tangents for a smooth curve.
    function drawFlowEdges(root) {
        const viewport = root.querySelector('.ng-flow-viewport');
        const svg = root.querySelector('svg.ng-flow-edges');
        if (!viewport || !svg) return;
        // Temporarily clear the SVG's explicit size so it doesn't
        // inflate the viewport during measurement.
        svg.setAttribute('width', 0);
        svg.setAttribute('height', 0);
        // Measure via getBoundingClientRect relative to the viewport
        // (accounting for the viewport's own transform, which at this
        // point is still identity since fit() hasn't run yet).
        const vRect = viewport.getBoundingClientRect();
        const steps = viewport.querySelectorAll('[data-flow-key]');
        const rects = new Map();
        let maxRight = 0, maxBot = 0;
        for (const el of steps) {
            const r = el.getBoundingClientRect();
            const x = r.left - vRect.left;
            const y = r.top  - vRect.top;
            const w = r.width, h = r.height;
            rects.set(el.dataset.flowKey, { x, y, w, h });
            if (x + w > maxRight) maxRight = x + w;
            if (y + h > maxBot) maxBot = y + h;
        }
        const pad = 20;
        const W = maxRight + pad, H = maxBot + pad;
        svg.setAttribute('width', W);
        svg.setAttribute('height', H);
        svg.setAttribute('viewBox', `0 0 ${W} ${H}`);

        const paths = [];
        for (const [p, c] of FLOW_DAG.edges) {
            const pr = rects.get(p), cr = rects.get(c);
            if (!pr || !cr) continue;
            const x1 = pr.x + pr.w;
            const y1 = pr.y + pr.h / 2;
            const x2 = cr.x;
            const y2 = cr.y + cr.h / 2;
            const dx = Math.max(40, (x2 - x1) / 2);
            const d = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
            paths.push(`<path d="${d}" marker-end="url(#ng-flow-arrow)"/>`);
        }
        // Preserve the <defs> by only replacing after the defs block.
        const defs = svg.querySelector('defs');
        svg.innerHTML = '';
        if (defs) svg.appendChild(defs);
        svg.insertAdjacentHTML('beforeend', paths.join(''));
    }

    function renderGrid(selected) {
        const NODES = window.Engine.NODES;
        const NODE_MAP = window.Engine.NODE_MAP;
        const MODULES = (window.Graph && window.Graph.MODULES) || [];
        const A = buildAnalysis();

        const viewBtn = (id, label) =>
            `<button data-view="${id}" class="${selected.view === id ? 'is-active' : ''}">${label}</button>`;

        const resetBtn = selected.view === 'flow'
            ? `<button class="ng-flow-toolbtn" data-flow-action="reset">Reset view</button>`
            : '';
        // Search filters the Modules grid only; omit it in flow mode.
        const searchHtml = selected.view === 'flow' ? '' :
            `<input type="text" class="nodes-search" placeholder="Search nodes / outcomes…" />`;

        let html = `
            <div class="ng-head">
                <a href="#/explore">← explore</a>
                ${searchHtml}
                <span class="ng-layout-toggle">
                    ${viewBtn('modules', 'Modules')}
                    ${viewBtn('flow', 'Flow')}
                </span>
                ${resetBtn}
                <a href="#/map">map →</a>
            </div>
        `;

        if (selected.view === 'flow') {
            // Full-bleed canvas: drag-to-pan, wheel-to-zoom. Transform
            // lives on .ng-flow-viewport; cells inside stay normal DOM.
            html += `<div class="ng-flow-canvas">`
                 + `<div class="ng-flow-viewport">`
                 + renderFlow(selected)
                 + `</div></div>`;
            return html;
        }

        html += `<div class="ng-body">`;

        // Modules — one card per module, internal nodes in a grid, with the
        // reads/writes contract right under the header.
        html += `<div class="ng-section">`;
        html += `<h3 class="ng-section-head">Modules</h3>`;
        const dimLinkList = (dims) => {
            if (!dims || !dims.length) return '—';
            return dims.map(d => {
                const href = `#/nodes?n=${encodeURIComponent(d)}`;
                return `<a class="ng-contract-dim" href="${href}">${esc(d)}</a>`;
            }).join(', ');
        };
        for (const m of MODULES) {
            const items = (m.nodeIds || []).map(id => NODE_MAP[id]).filter(Boolean);
            if (!items.length) continue;
            const readsHtml = dimLinkList(m.reads);
            const writesHtml = dimLinkList(m.writes);
            const markersHtml = m.internalMarkers && m.internalMarkers.length
                ? dimLinkList(m.internalMarkers) : '';
            const modActive = selected.moduleId === m.id ? ' is-active' : '';
            html += `<div class="ng-module${modActive}" id="ng-module-${esc(m.id)}" data-module-id="${esc(m.id)}">`;
            html += `<div class="ng-module-head">`;
            html += `<a class="ng-module-title" href="#/nodes?m=${encodeURIComponent(m.id)}">${esc(m.id)}</a>`;
            html += `<div class="ng-module-contract">`
                 + `<div><b>reads</b> <code>${readsHtml}</code></div>`
                 + `<div><b>writes</b> <code>${writesHtml}</code></div>`
                 + (markersHtml ? `<div><b>internal markers</b> <code>${markersHtml}</code></div>` : '')
                 + `</div>`;
            html += `</div>`;
            html += `<div class="ng-grid">`;
            for (const n of items) html += _cellHtml(n, selected, A);
            html += `</div>`;
            html += `</div>`;
        }
        html += `</div>`;

        // Unmodularized nodes — split derived (internal routing tags,
        // never asked) from regular flat nodes, and sub-group regular
        // nodes by stage.
        const isFlat = (n) => !n.module;
        const stageGroups = [
            { label: 'Stage 1 (flat)', items: NODES.filter(n => n.stage === 1 && isFlat(n) && !n.derived) },
            { label: 'Stage 2 (flat)', items: NODES.filter(n => n.stage === 2 && isFlat(n) && !n.derived) },
            { label: 'Stage 3 (flat)', items: NODES.filter(n => n.stage === 3 && isFlat(n) && !n.derived) },
            { label: 'Other (flat)',   items: NODES.filter(n => ![1,2,3].includes(n.stage) && isFlat(n) && !n.derived) },
        ];
        for (const g of stageGroups) {
            if (!g.items.length) continue;
            html += `<div class="ng-section">`;
            html += `<h3 class="ng-section-head">${esc(g.label)}</h3>`;
            html += `<div class="ng-grid">`;
            for (const n of g.items) html += _cellHtml(n, selected, A);
            html += `</div>`;
            html += `</div>`;
        }

        // Derived tags — flat nodes computed via deriveWhen, never asked
        // directly. Module-internal derived nodes stay in their module
        // card (they're part of that module's machinery).
        const derivedFlat = NODES.filter(n => n.derived && isFlat(n));
        if (derivedFlat.length) {
            html += `<div class="ng-section">`;
            html += `<h3 class="ng-section-head">Derived tags (never asked)</h3>`;
            html += `<div class="ng-grid">`;
            for (const n of derivedFlat) html += _cellHtml(n, selected, A);
            html += `</div>`;
            html += `</div>`;
        }

        // Outcomes.
        html += `<div class="ng-section">`;
        html += `<h3 class="ng-section-head">Outcomes</h3>`;
        html += `<div class="ng-grid">`;
        for (const t of templates) {
            const pseudo = { id: t.id, label: t.title || '' };
            html += _cellHtml(pseudo, selected, null, { outcome: true });
        }
        html += `</div>`;
        html += `</div>`;

        html += `</div>`;
        return html;
    }

    // Format a narrative `when` condition as a compact human-readable
    // label for the variant <select> options. Falls back to JSON for
    // anything unusual.
    function _formatWhen(w) {
        if (!w || typeof w !== 'object') return 'default';
        const parts = [];
        for (const [k, v] of Object.entries(w)) {
            if (Array.isArray(v)) parts.push(`${k}=${v.join('|')}`);
            else if (v && typeof v === 'object' && v.not) parts.push(`${k}≠${(Array.isArray(v.not) ? v.not : [v.not]).join('|')}`);
            else if (v === true) parts.push(`${k}:set`);
            else if (v === false) parts.push(`${k}:unset`);
            else if (typeof v === 'string' || typeof v === 'number') parts.push(`${k}=${v}`);
            else parts.push(`${k}=${JSON.stringify(v)}`);
        }
        return parts.join(' & ') || 'default';
    }

    function _md(s) {
        if (!s) return '';
        try { return window.marked ? window.marked.parse(String(s).replace(/~/g, '\\~')) : esc(s); }
        catch (_) { return esc(s); }
    }

    // Narrative preview pane: node's question text, context (with a
    // contextWhen variant dropdown if any), and one card per edge
    // showing the answer label + desc, plus a narrativeVariants dropdown
    // per edge. Visible variants swap via CSS (no rerender). All text
    // goes through marked.parse() to honor **bold** / paragraphs like
    // the main UI does.
    //
    // Derived nodes (internal routing tags like `ruin_type`) have no
    // narrative — the user never sees them asked — so we render a
    // short note instead of an empty shell.
    function renderNarrativePanel(node) {
        const narr = narrative && narrative[node.id];
        if (node.derived && !narr) {
            const edgeIds = (node.edges || []).map(e => e.id).join(', ');
            return `<div class="nd-narr">
                <div class="nd-narr-head">Derived tag · no narrative</div>
                <div class="nd-narr-hint">
                    <code>${esc(node.id)}</code> is never asked. Its value is
                    computed from other dims via <code>deriveWhen</code> and
                    consumed by outcome templates and edge gates.
                    ${edgeIds ? `Possible values: <code>${esc(edgeIds)}</code>.` : ''}
                </div>
            </div>`;
        }
        const qText = (narr && narr.questionText) || node.questionText || node.label || node.id;
        const qCtxDefault = (narr && narr.questionContext) || '';
        const contextVariants = (narr && narr.contextWhen) || [];

        let html = `<div class="nd-narr">`;
        html += `<div class="nd-narr-head">Narrative preview</div>`;
        html += `<div class="nd-narr-question">${esc(qText)}</div>`;

        // Question context (default + contextWhen variants).
        if (contextVariants.length) {
            html += `<div class="nd-narr-variant-row">`;
            html += `<label>context variant</label>`;
            html += `<select class="nd-narr-select" data-affects="ctx-${esc(node.id)}">`;
            html += `<option value="default">default</option>`;
            contextVariants.forEach((v, i) => {
                html += `<option value="v${i}">${esc(_formatWhen(v.when))}</option>`;
            });
            html += `</select>`;
            html += `</div>`;
        }
        if (qCtxDefault || contextVariants.length) {
            html += `<div class="nd-narr-context" data-group="ctx-${esc(node.id)}" data-variant="default">${qCtxDefault ? _md(qCtxDefault) : '<span class="nd-narr-hint">(no context)</span>'}</div>`;
            contextVariants.forEach((v, i) => {
                const text = v.questionContext || qCtxDefault || '';
                html += `<div class="nd-narr-context nd-narr-hidden" data-group="ctx-${esc(node.id)}" data-variant="v${i}">${text ? _md(text) : '<span class="nd-narr-hint">(variant omits context)</span>'}</div>`;
            });
        }

        if (narr && narr.source && narr.source.url) {
            html += `<div class="nd-narr-source"><a href="${esc(narr.source.url)}" target="_blank" rel="noopener">${esc(narr.source.label || narr.source.url)} ↗</a></div>`;
        }

        // Options (one card per edge).
        if (node.edges && node.edges.length) {
            html += `<div class="nd-narr-options">`;
            for (const e of node.edges) {
                const val = narr && narr.values && narr.values[e.id];
                const variants = (val && val.narrativeVariants) || [];
                const labelDefault = (val && val.answerLabel) || e.label || e.id;
                const descDefault = (val && val.answerDesc) || '';
                const gLbl = `opt-lbl-${node.id}-${e.id}`;
                const gDesc = `opt-desc-${node.id}-${e.id}`;

                html += `<div class="nd-narr-opt">`;
                html += `<div class="nd-narr-opt-head">`;
                html += `<span class="nd-narr-opt-id">${esc(e.id)}</span>`;
                // If the label echoes the id (no narrative / no edge.label),
                // skip the label span so we don't render "warwar".
                const idEchoes = (s) => String(s).trim() === e.id;
                if (!idEchoes(labelDefault)) {
                    html += `<span class="nd-narr-opt-label" data-group="${gLbl}" data-variant="default">${esc(labelDefault)}</span>`;
                    variants.forEach((v, i) => {
                        const l = v.answerLabel || labelDefault;
                        html += `<span class="nd-narr-opt-label nd-narr-hidden" data-group="${gLbl}" data-variant="v${i}">${esc(l)}</span>`;
                    });
                }
                html += `</div>`;

                if (variants.length) {
                    html += `<div class="nd-narr-variant-row">`;
                    html += `<label>variant</label>`;
                    html += `<select class="nd-narr-select" data-affects="${gLbl} ${gDesc}">`;
                    html += `<option value="default">default</option>`;
                    variants.forEach((v, i) => {
                        html += `<option value="v${i}">${esc(_formatWhen(v.when))}</option>`;
                    });
                    html += `</select>`;
                    html += `</div>`;
                }

                html += `<div class="nd-narr-opt-desc" data-group="${gDesc}" data-variant="default">${descDefault ? _md(descDefault) : '<span class="nd-narr-hint">(no description)</span>'}</div>`;
                variants.forEach((v, i) => {
                    const text = v.answerDesc || descDefault || '';
                    html += `<div class="nd-narr-opt-desc nd-narr-hidden" data-group="${gDesc}" data-variant="v${i}">${text ? _md(text) : '<span class="nd-narr-hint">(variant omits desc)</span>'}</div>`;
                });

                html += `</div>`;
            }
            html += `</div>`;
        }

        html += `</div>`;
        return html;
    }

    function renderNodeDetail(nodeId) {
        const A = buildAnalysis();
        const NODE_MAP = window.Engine.NODE_MAP;
        const node = NODE_MAP[nodeId];
        if (!node) {
            // maybe a synthetic dim (marker set via collapseToFlavor)
            if (A.syntheticDims.has(nodeId)) return renderSyntheticDimDetail(nodeId);
            return `<div class="nodes-detail-empty">Unknown node: ${esc(nodeId)}</div>`;
        }

        const writes    = A.nodeWrites.get(nodeId) || new Set();
        const moves     = A.nodeMoves.get(nodeId) || new Set();
        const readBy    = A.readBy.get(nodeId) || [];
        const writtenBy = A.writtenBy.get(nodeId) || [];
        const outcomes  = A.outcomesUsing.get(nodeId) || new Set();

        const tags = [];
        if (node.stage != null) tags.push(`stage ${node.stage}`);
        if (node.derived) tags.push('derived');
        if (node.forwardKey) tags.push('forwardKey');
        if (node.priority) tags.push(`priority ${node.priority}`);
        if (node.edges) tags.push(`${node.edges.length} edge${node.edges.length === 1 ? '' : 's'}`);

        // Group readBy by source node
        const readByByNode = new Map();
        for (const r of readBy) {
            if (!readByByNode.has(r.nodeId)) readByByNode.set(r.nodeId, []);
            readByByNode.get(r.nodeId).push(r.where);
        }

        let html = `
            <h2 class="nd-title"><span class="nd-id">${esc(node.id)}</span><span>${esc(node.label || '')}</span></h2>
            <div class="nd-meta">${tags.map(t => `<span class="nd-tag">${esc(t)}</span>`).join('')}</div>
        `;

        // ─── Reads / writes summary (pulled from activateWhen, hideWhen,
        //     edge requires / disabledWhen, deriveWhen.match,
        //     collapseToFlavor.when / set / move).
        const reads = A.nodeReads.get(nodeId) || new Set();
        if (reads.size || writes.size || moves.size) {
            html += `<div class="nd-section"><h3>Reads / writes</h3>`;
            html += `<div class="nd-narr-hint" style="margin-bottom: 8px;">
                <code>reads</code>: dims pulled from this node's activateWhen, hideWhen,
                deriveWhen.match, and per-edge requires / disabledWhen / collapseToFlavor.when.
                <code>writes (sel)</code>: collapseToFlavor.set targets.
                <code>moves to flavor</code>: collapseToFlavor.move targets.
            </div>`;
            if (reads.size) {
                html += `<div class="nd-row"><div class="nd-row-label">reads</div><div class="nd-row-body"><div class="nd-chip-row">`;
                [...reads].sort().forEach(d => { html += dimChip(d); });
                html += `</div></div></div>`;
            }
            if (writes.size) {
                html += `<div class="nd-row"><div class="nd-row-label">writes (sel)</div><div class="nd-row-body"><div class="nd-chip-row">`;
                [...writes].sort().forEach(d => { html += dimChip(d); });
                html += `</div></div></div>`;
            }
            if (moves.size) {
                html += `<div class="nd-row"><div class="nd-row-label">moves to flavor</div><div class="nd-row-body"><div class="nd-chip-row">`;
                [...moves].sort().forEach(d => { html += dimChip(d); });
                html += `</div></div></div>`;
            }
            html += `</div>`;
        }

        html += renderNarrativePanel(node);

        // ─── Written by
        html += `<div class="nd-section"><h3>Written by</h3>`;
        if (!writtenBy.length) {
            html += `<div class="nd-empty">Not written anywhere (orphan marker?).</div>`;
        } else {
            html += `<div class="nd-chip-row">`;
            const seen = new Set();
            for (const w of writtenBy) {
                const key = w.via + '|' + w.nodeId;
                if (seen.has(key)) continue;
                seen.add(key);
                const label = w.via === 'user-pick' ? 'user picks edge'
                            : w.via === 'deriveWhen' ? 'derived from this node’s own deriveWhen'
                            : w.via;
                html += `<span class="nd-chip nd-chip-muted" style="cursor: default;">${esc(label)}${w.value ? ` = ${esc(String(w.value))}` : ''}</span>`;
            }
            html += `</div>`;
        }
        html += `</div>`;

        // ─── When this question is active / hidden / auto-derived
        const activateWhen = node.activateWhen || [];
        const hideWhen = node.hideWhen || [];
        const deriveWhen = node.deriveWhen || [];
        const hasNodeGates = activateWhen.length || hideWhen.length || deriveWhen.length;
        html += `<div class="nd-section"><h3>Activation & visibility</h3>`;
        if (!hasNodeGates) {
            html += `<div class="nd-empty">Always active once its stage is reached. Never hidden. User-answered (not derived).</div>`;
        } else {
            if (activateWhen.length) {
                html += `<div class="nd-row"><div class="nd-row-label">activateWhen</div><div class="nd-row-body">`;
                html += `<div class="nd-narr-hint" style="margin-bottom: 6px;">Node is inactive until any clause matches <code>sel</code>.</div>`;
                activateWhen.forEach((c, i) => {
                    html += `<pre class="nd-json">clause ${i}: ${esc(prettyJson(c))}</pre>`;
                });
                html += `</div></div>`;
            }
            if (hideWhen.length) {
                html += `<div class="nd-row"><div class="nd-row-label">hideWhen</div><div class="nd-row-body">`;
                html += `<div class="nd-narr-hint" style="margin-bottom: 6px;">Node is suppressed from the queue when any clause matches.</div>`;
                hideWhen.forEach((c, i) => {
                    html += `<pre class="nd-json">clause ${i}: ${esc(prettyJson(c))}</pre>`;
                });
                html += `</div></div>`;
            }
            if (deriveWhen.length) {
                html += `<div class="nd-row"><div class="nd-row-label">deriveWhen</div><div class="nd-row-body">`;
                html += `<div class="nd-narr-hint" style="margin-bottom: 6px;">Value is auto-computed instead of asked when a rule's <code>match</code> holds.</div>`;
                deriveWhen.forEach((d, i) => {
                    html += `<pre class="nd-json">rule ${i}: ${esc(prettyJson(d))}</pre>`;
                });
                html += `</div></div>`;
            }
        }
        html += `</div>`;

        // ─── Edges (per-edge gating)
        if (node.edges && node.edges.length) {
            html += `<div class="nd-section"><h3>Edges (per-option gating)</h3>`;
            html += `<div class="nd-narr-hint" style="margin-bottom: 10px;"><code>requires</code>: edge is hidden unless the clause matches. <code>disabledWhen</code>: edge is shown but greyed out. <code>collapseToFlavor</code>: what happens to state when this edge is picked.</div>`;
            for (const e of node.edges) {
                html += `<div class="nd-site">`;
                html += `<div class="nd-site-head">${esc(e.id)}${e.label ? ` — ${esc(e.label)}` : ''}</div>`;
                const hasReq = e.requires && (Array.isArray(e.requires) ? e.requires.length : Object.keys(e.requires).length);
                const hasDis = e.disabledWhen && e.disabledWhen.length;
                const hasC2F = !!e.collapseToFlavor;
                if (!hasReq && !hasDis && !hasC2F) {
                    html += `<div class="nd-empty">Always shown. No collapse.</div>`;
                } else {
                    if (hasReq) {
                        html += `<div class="nd-row"><div class="nd-row-label">requires</div><div class="nd-row-body"><pre class="nd-json">${esc(prettyJson(e.requires))}</pre></div></div>`;
                    }
                    if (hasDis) {
                        html += `<div class="nd-row"><div class="nd-row-label">disabledWhen</div><div class="nd-row-body"><pre class="nd-json">${esc(prettyJson(e.disabledWhen))}</pre></div></div>`;
                    }
                    if (hasC2F) {
                        html += `<div class="nd-row"><div class="nd-row-label">collapseToFlavor</div><div class="nd-row-body"><pre class="nd-json">${esc(prettyJson(e.collapseToFlavor))}</pre></div></div>`;
                    }
                }
                html += `</div>`;
            }
            html += `</div>`;
        }

        // ─── Read by (other nodes)
        html += `<div class="nd-section"><h3>Read by (nodes)</h3>`;
        if (!readByByNode.size) {
            html += `<div class="nd-empty">No other graph nodes reference this dim.</div>`;
        } else {
            html += `<div class="nd-chip-row">`;
            const sorted = [...readByByNode.entries()].sort((a, b) => a[0].localeCompare(b[0]));
            for (const [srcId, wheres] of sorted) {
                html += dimChip(srcId, { count: wheres.length });
            }
            html += `</div>`;
            html += `<div style="margin-top: 10px;">`;
            for (const [srcId, wheres] of sorted) {
                const src = NODE_MAP[srcId];
                const sites = (A.nodeReadSites.get(srcId) || []).filter(s => s.dims.includes(nodeId));
                for (const site of sites) {
                    html += `<div class="nd-site">
                        <div class="nd-site-head">${esc(srcId)} · ${esc(site.where)}</div>
                        <div class="nd-site-body"><pre class="nd-json">${esc(prettyJson(site.raw))}</pre></div>
                    </div>`;
                }
            }
            html += `</div>`;
        }
        html += `</div>`;

        // ─── Affects outcomes
        html += `<div class="nd-section"><h3>Read by (outcomes)</h3>`;
        if (!outcomes.size) {
            html += `<div class="nd-empty">No outcomes reference this dim.</div>`;
        } else {
            html += `<div class="nd-chip-row">`;
            const tplById = new Map(templates.map(t => [t.id, t]));
            const sortedOutcomes = [...outcomes].sort();
            for (const oid of sortedOutcomes) {
                html += outcomeChip(oid, tplById.get(oid));
            }
            html += `</div>`;
            html += `<div style="margin-top: 10px;">`;
            for (const oid of sortedOutcomes) {
                const t = tplById.get(oid);
                const sites = A.outcomeSites.get(oid) || {};
                const inReach = sites.reachable && sites.reachable.has(nodeId);
                const inFlavor = sites.flavor && sites.flavor.has(nodeId);
                const isPrimary = sites.primary === nodeId;
                const where = [
                    isPrimary && 'primaryDimension',
                    inReach && 'reachable',
                    inFlavor && 'flavors'
                ].filter(Boolean).join(' · ');
                const clauseHits = [];
                if (inReach && t.reachable) {
                    t.reachable.forEach((c, i) => {
                        const dims = new Set();
                        collectDimRefs(c, A.allDims, dims);
                        if (dims.has(nodeId)) clauseHits.push({ i, c });
                    });
                }
                html += `<div class="nd-site">
                    <div class="nd-site-head">${esc(oid)} · ${esc(t && t.title || '')} · ${esc(where)}</div>`;
                if (clauseHits.length) {
                    for (const h of clauseHits) {
                        html += `<pre class="nd-json">reachable[${h.i}]: ${esc(prettyJson(h.c))}</pre>`;
                    }
                }
                html += `</div>`;
            }
            html += `</div>`;
        }
        html += `</div>`;

        return html;
    }

    function renderSyntheticDimDetail(dim) {
        const A = buildAnalysis();
        const NODE_MAP = window.Engine.NODE_MAP;
        const readBy    = A.readBy.get(dim) || [];
        const writtenBy = A.writtenBy.get(dim) || [];
        const outcomes  = A.outcomesUsing.get(dim) || new Set();
        const tplById = new Map(templates.map(t => [t.id, t]));

        let html = `
            <h2 class="nd-title"><span class="nd-id">${esc(dim)}</span><span style="color: var(--text-muted); font-weight: 400;">(marker dim)</span></h2>
            <div class="nd-subtitle">A synthetic dim used only as a flag — no graph node owns it. Written via <code>collapseToFlavor.set</code> on some edge, read by nodes/outcomes.</div>
        `;
        html += `<div class="nd-section"><h3>Written by</h3>`;
        if (!writtenBy.length) html += `<div class="nd-empty">(none)</div>`;
        else {
            html += `<div>`;
            for (const w of writtenBy) {
                html += `<div class="nd-site"><div class="nd-site-head">${esc(w.nodeId)} · ${esc(w.via)}</div>
                    <div class="nd-site-body">${esc(dim)} = ${esc(String(w.value))}</div></div>`;
            }
            html += `</div>`;
        }
        html += `</div>`;
        html += `<div class="nd-section"><h3>Read by (nodes)</h3>`;
        const by = new Map();
        for (const r of readBy) {
            if (!by.has(r.nodeId)) by.set(r.nodeId, []);
            by.get(r.nodeId).push(r.where);
        }
        if (!by.size) html += `<div class="nd-empty">(none)</div>`;
        else {
            html += `<div class="nd-chip-row">`;
            [...by.keys()].sort().forEach(id => { html += dimChip(id, { count: by.get(id).length }); });
            html += `</div>`;
        }
        html += `</div>`;
        html += `<div class="nd-section"><h3>Read by (outcomes)</h3>`;
        if (!outcomes.size) html += `<div class="nd-empty">(none)</div>`;
        else {
            html += `<div class="nd-chip-row">`;
            [...outcomes].sort().forEach(o => { html += outcomeChip(o, tplById.get(o)); });
            html += `</div>`;
        }
        html += `</div>`;
        return html;
    }

    function renderOutcomeDetail(outcomeId) {
        const A = buildAnalysis();
        const t = templates.find(x => x.id === outcomeId);
        if (!t) return `<div class="nodes-detail-empty">Unknown outcome: ${esc(outcomeId)}</div>`;
        const sites = A.outcomeSites.get(outcomeId) || { reachable: new Set(), flavor: new Set(), primary: '' };

        let html = `
            <h2 class="nd-title is-outcome"><span class="nd-id">${esc(t.id)}</span><span>${esc(t.title || '')}</span></h2>
            <div class="nd-subtitle">${esc(t.subtitle || '')}</div>
            <div class="nd-meta">
                ${t.primaryDimension ? `<span class="nd-tag">primary: ${esc(t.primaryDimension)}</span>` : ''}
                ${t.reachable ? `<span class="nd-tag">${t.reachable.length} reachable clause${t.reachable.length === 1 ? '' : 's'}</span>` : ''}
            </div>
        `;

        // Primary dim
        if (t.primaryDimension) {
            html += `<div class="nd-section"><h3>Primary Dimension</h3><div class="nd-chip-row">${dimChip(t.primaryDimension)}</div></div>`;
        }

        // Reachable clauses: summarize dim set, then list clauses
        html += `<div class="nd-section"><h3>Reachable (dims)</h3>`;
        if (!sites.reachable.size) html += `<div class="nd-empty">(no dims)</div>`;
        else {
            html += `<div class="nd-chip-row">`;
            // Show per-dim how many clauses reference it
            const dimCount = new Map();
            (t.reachable || []).forEach(c => {
                const dims = new Set();
                collectDimRefs(c, A.allDims, dims);
                for (const d of dims) dimCount.set(d, (dimCount.get(d) || 0) + 1);
            });
            [...sites.reachable].sort().forEach(d => { html += dimChip(d, { count: dimCount.get(d) }); });
            html += `</div>`;
        }
        html += `</div>`;

        if (t.reachable && t.reachable.length) {
            html += `<div class="nd-section"><h3>Reachable Clauses</h3>`;
            t.reachable.forEach((c, i) => {
                html += `<div class="nd-site">
                    <div class="nd-site-head">clause ${i}</div>
                    <pre class="nd-json">${esc(prettyJson(c))}</pre>
                </div>`;
            });
            html += `</div>`;
        }

        // Flavor dims
        html += `<div class="nd-section"><h3>Flavor Dims</h3>`;
        if (!sites.flavor.size) html += `<div class="nd-empty">(no flavor keys)</div>`;
        else {
            html += `<div class="nd-chip-row">`;
            [...sites.flavor].sort().forEach(d => { html += dimChip(d); });
            html += `</div>`;
        }
        html += `</div>`;

        return html;
    }

    function renderModuleDetail(moduleId) {
        const NODE_MAP = window.Engine.NODE_MAP;
        const MODULE_MAP = (window.Graph && window.Graph.MODULE_MAP) || {};
        const m = MODULE_MAP[moduleId];
        if (!m) return `<div class="nodes-detail-empty">Unknown module: ${esc(moduleId)}</div>`;

        const nodeIds = (m.nodeIds || []).filter(id => NODE_MAP[id]);
        const reads = m.reads || [];
        const writes = m.writes || [];
        const internals = m.internalMarkers || [];
        const activateWhen = m.activateWhen || [];

        const tags = [];
        tags.push(`${nodeIds.length} node${nodeIds.length === 1 ? '' : 's'}`);
        if (m.completionMarker) tags.push(`exit: ${_fmtCompletionMarker(m.completionMarker)}`);
        if (typeof m.reduce === 'function') tags.push('has reduce()');
        if (m.reducerTable) tags.push('has reducerTable');

        let html = `
            <h2 class="nd-title"><span class="nd-id">${esc(m.id)}</span><span style="color: var(--text-muted); font-weight: 400;">(module)</span></h2>
            <div class="nd-subtitle">A module: a group of nodes with a shared activation gate and a reducer that commits a bounded slice of dims to <code>sel</code> at exit.</div>
            <div class="nd-meta">${tags.map(t => `<span class="nd-tag">${esc(t)}</span>`).join('')}</div>
        `;

        html += `<div class="nd-section"><h3>activateWhen</h3>`;
        if (!activateWhen.length) {
            html += `<div class="nd-empty">(no gate — always active)</div>`;
        } else {
            activateWhen.forEach((c, i) => {
                html += `<div class="nd-site">
                    <div class="nd-site-head">clause ${i}</div>
                    <pre class="nd-json">${esc(prettyJson(c))}</pre>
                </div>`;
            });
        }
        html += `</div>`;

        html += `<div class="nd-section"><h3>Reads (external dims)</h3>`;
        if (!reads.length) html += `<div class="nd-empty">(none)</div>`;
        else {
            html += `<div class="nd-chip-row">`;
            [...reads].forEach(d => { html += dimChip(d); });
            html += `</div>`;
        }
        html += `</div>`;

        html += `<div class="nd-section"><h3>Writes (dims committed to sel at exit)</h3>`;
        if (!writes.length) html += `<div class="nd-empty">(none)</div>`;
        else {
            html += `<div class="nd-chip-row">`;
            [...writes].forEach(d => { html += dimChip(d); });
            html += `</div>`;
        }
        html += `</div>`;

        if (internals.length) {
            html += `<div class="nd-section"><h3>Internal markers</h3>`;
            html += `<div class="nd-subtitle" style="margin-bottom: 8px;">Written to sel mid-tick so internal gates can observe them, then moved to flavor at module exit.</div>`;
            html += `<div class="nd-chip-row">`;
            [...internals].forEach(d => { html += dimChip(d); });
            html += `</div>`;
            html += `</div>`;
        }

        if (m.completionMarker) {
            html += `<div class="nd-section"><h3>Completion marker</h3>`;
            html += `<div class="nd-subtitle" style="margin-bottom: 8px;">The dim (and, when listed, the specific values) whose presence in <code>sel</code> signals the module is done.</div>`;
            const cm = m.completionMarker;
            if (typeof cm === 'string') {
                html += `<div class="nd-chip-row">${dimChip(cm)}</div>`;
            } else if (cm && typeof cm === 'object' && cm.dim) {
                html += `<div class="nd-chip-row">${dimChip(cm.dim)}</div>`;
                if (Array.isArray(cm.values) && cm.values.length) {
                    html += `<div style="margin-top: 6px; font-size: 12px; color: var(--text-muted);">done when <code>${esc(cm.dim)}</code> ∈ {${cm.values.map(v => `<code>${esc(String(v))}</code>`).join(', ')}}</div>`;
                }
            }
            html += `</div>`;
        }

        html += `<div class="nd-section"><h3>Nodes</h3>`;
        if (!nodeIds.length) html += `<div class="nd-empty">(no nodes)</div>`;
        else {
            html += `<div class="nd-chip-row">`;
            for (const id of nodeIds) html += dimChip(id);
            html += `</div>`;
        }
        html += `</div>`;

        // Outcomes — the deduced "what can this module write?" table,
        // pivoted from exitPlan. For modules with ≥2 distinct write
        // bundles (decel, escape, emergence, rollout, proliferation,
        // intent_loop, war_loop) each row is one bundle; for modules
        // that only write their completion marker (who_benefits,
        // control, alignment_loop) each row is one terminal question.
        // See computeModuleOutcomeTable for the pivot logic.
        //
        // The raw exit-plan tuples are still available underneath,
        // collapsed behind a <details> toggle for cross-referencing
        // when debugging.
        let exitPlan = null;
        try { exitPlan = m.exitPlan; } catch (_) { exitPlan = null; }
        if (exitPlan && exitPlan.length) {
            const table = computeModuleOutcomeTable(m);
            html += `<div class="nd-section"><h3>Outcomes</h3>`;
            html += `<div class="nd-subtitle" style="margin-bottom: 8px;">`;
            if (table.pivot === 'set') {
                html += `The distinct write bundles this module can commit to <code>sel</code> on exit. Exits column lists the terminating <code>(node, edge)</code> pairs that produce each outcome.`;
            } else {
                html += `Every exit writes only the completion marker, so rows are pivoted by terminating question instead. Each row is one internal node whose edges can end the module.`;
            }
            html += `</div>`;
            html += _renderOutcomeTable(m);
            html += `<details style="margin-top: 10px;"><summary style="cursor: pointer; color: var(--text-muted); font-size: 12px;">raw exit plan (${exitPlan.length} tuple${exitPlan.length === 1 ? '' : 's'})</summary>`;
            html += `<div style="margin-top: 8px;">`;
            html += _renderExitPlanTable(exitPlan);
            html += `</div></details>`;
            html += `</div>`;
        }

        return html;
    }

    function renderDetail(selection) {
        if (selection.moduleId) return renderModuleDetail(selection.moduleId);
        if (selection.nodeId) return renderNodeDetail(selection.nodeId);
        if (selection.outcomeId) return renderOutcomeDetail(selection.outcomeId);
        return `<div class="nodes-detail-empty">
            <h2 style="margin: 0 0 10px 0;">Nodes & Outcomes</h2>
            <p>Pick a node or outcome from the left to see:</p>
            <ul>
                <li>What other nodes &amp; outcomes read its value (blast radius)</li>
                <li>What upstream dims it depends on (activation, hiding, derivation, edge gates)</li>
                <li>Where it's written (user picks / derivations / flavor collapses)</li>
            </ul>
            <p style="color: var(--text-muted); font-size: 12px; margin-top: 20px;">
                Every reference is a static scan of <code>graph.js</code> + <code>data/outcomes.json</code> — no runtime state.
            </p>
        </div>`;
    }

    function wireSearch(root) {
        const input = root.querySelector('.nodes-search');
        const body = root.querySelector('.ng-body');
        if (!input || !body) return;
        input.addEventListener('input', () => {
            const q = input.value.trim().toLowerCase();
            const cells = body.querySelectorAll('.ng-cell');
            cells.forEach(it => {
                const s = it.dataset.search || '';
                it.style.display = (!q || s.includes(q)) ? '' : 'none';
            });
            // Hide empty sections / modules so the grid stays tidy.
            body.querySelectorAll('.ng-section, .ng-module').forEach(sec => {
                const visible = sec.querySelector('.ng-cell:not([style*="display: none"])');
                sec.style.display = (!q || visible) ? '' : 'none';
            });
        });
    }

    // Narrative variant <select>s swap visible content in-place — no
    // re-render so the detail pane keeps its scroll position.
    function wireNarrative(root) {
        const detail = root.querySelector('.nodes-detail');
        if (!detail) return;
        detail.addEventListener('change', (e) => {
            const sel = e.target;
            if (!(sel.matches && sel.matches('.nd-narr-select'))) return;
            const affects = (sel.dataset.affects || '').split(/\s+/).filter(Boolean);
            const val = sel.value;
            for (const g of affects) {
                detail.querySelectorAll(`[data-group="${g}"]`).forEach(el => {
                    el.classList.toggle('nd-narr-hidden', el.dataset.variant !== val);
                });
            }
        });
    }

    function parseSelection() {
        const hash = location.hash.slice(1);
        const qIdx = hash.indexOf('?');
        const params = {};
        if (qIdx >= 0) {
            hash.slice(qIdx + 1).split('&').forEach(pair => {
                const [k, v] = pair.split('=');
                if (!k) return;
                params[decodeURIComponent(k)] = decodeURIComponent(v || '');
            });
        }
        const view = params.view === 'flow' ? 'flow' : 'modules';
        return {
            nodeId: params.n || '',
            outcomeId: params.o || '',
            moduleId: params.m || '',
            view,
        };
    }

    // Append `view=flow` to a selection href if the current view is
    // flow, so clicking a cell/chip/module title keeps us in flow mode.
    function _preserveViewHref(href, view) {
        if (!href || !href.startsWith('#/nodes')) return href;
        if (view !== 'flow') return href;
        if (/([?&])view=/.test(href)) return href;
        return href + (href.includes('?') ? '&' : '?') + 'view=flow';
    }

    async function render(app) {
        injectCss();
        await ensureLoaded();

        app.innerHTML = `<div id="nodes-root"></div>`;
        const root = app.querySelector('#nodes-root');

        // ── Flow canvas state ──
        // Persisted to localStorage so pan/zoom survives page reloads
        // and view toggles. `flowView.dirty` means the user has nudged
        // the view — skip the initial fit() on re-wire.
        const FLOW_VIEW_LS_KEY = 'nodes-flow-view-v1';
        const flowView = (() => {
            try {
                const raw = localStorage.getItem(FLOW_VIEW_LS_KEY);
                if (raw) {
                    const v = JSON.parse(raw);
                    if (typeof v.x === 'number' && typeof v.y === 'number' && typeof v.s === 'number') {
                        return { x: v.x, y: v.y, s: v.s, dirty: true };
                    }
                }
            } catch (_e) { /* ignore */ }
            return { x: 20, y: 20, s: 1, dirty: false };
        })();
        const saveFlowView = () => {
            try {
                localStorage.setItem(FLOW_VIEW_LS_KEY, JSON.stringify({
                    x: flowView.x, y: flowView.y, s: flowView.s,
                }));
            } catch (_e) { /* ignore */ }
        };
        // Flag set while panning; cleared on mouseup. Used to swallow
        // the click that would fire at the end of a pan drag.
        let flowPanMoved = false;
        // Set by wireFlowCanvas to its `fit()` closure so the toolbar
        // "Reset view" button can re-run fit-to-content. Null when
        // flow mode isn't mounted.
        let flowFit = null;

        function wireFlowCanvas() {
            const canvas = root.querySelector('.ng-flow-canvas');
            const viewport = root.querySelector('.ng-flow-viewport');
            if (!canvas || !viewport) return;

            // Size the SVG overlay and render arrows *before* fit() runs,
            // so the viewport's scrollWidth/scrollHeight account for them.
            drawFlowEdges(root);

            const apply = () => {
                viewport.style.transform =
                    `translate(${flowView.x}px, ${flowView.y}px) scale(${flowView.s})`;
            };

            // Fit-to-content. Called on first paint (when the user hasn't
            // pan/zoomed yet) and by the "Reset view" toolbar button. Also
            // clears the saved view so subsequent re-mounts fit fresh.
            const fit = () => {
                viewport.style.transform = 'translate(0,0) scale(1)';
                const cw = canvas.clientWidth, ch = canvas.clientHeight;
                const vw = viewport.scrollWidth, vh = viewport.scrollHeight;
                if (!cw || !vw) { apply(); return; }
                const sx = (cw - 40) / vw;
                const sy = (ch - 40) / vh;
                flowView.s = Math.max(0.3, Math.min(1, Math.min(sx, sy)));
                flowView.x = 20;
                flowView.y = Math.max(20, (ch - vh * flowView.s) / 2);
                flowView.dirty = false;
                try { localStorage.removeItem(FLOW_VIEW_LS_KEY); } catch (_e) { /* ignore */ }
                apply();
            };
            if (flowView.dirty) apply();
            else fit();

            let dragging = false, sx = 0, sy = 0, x0 = 0, y0 = 0;
            canvas.addEventListener('mousedown', (e) => {
                // Don't start a pan on an interactive anchor — let the
                // click fall through to the normal selection handler.
                if (e.target.closest && e.target.closest('a')) return;
                if (e.button !== 0) return;
                dragging = true; flowPanMoved = false;
                sx = e.clientX; sy = e.clientY;
                x0 = flowView.x; y0 = flowView.y;
                canvas.classList.add('dragging');
                e.preventDefault();
            });
            window.addEventListener('mousemove', (e) => {
                if (!dragging) return;
                const dx = e.clientX - sx, dy = e.clientY - sy;
                if (!flowPanMoved && Math.hypot(dx, dy) > 3) flowPanMoved = true;
                flowView.x = x0 + dx; flowView.y = y0 + dy;
                flowView.dirty = true;
                apply();
            });
            window.addEventListener('mouseup', () => {
                if (!dragging) return;
                dragging = false;
                canvas.classList.remove('dragging');
                if (flowPanMoved) saveFlowView();
            });

            canvas.addEventListener('wheel', (e) => {
                e.preventDefault();
                const rect = canvas.getBoundingClientRect();
                const cx = e.clientX - rect.left;
                const cy = e.clientY - rect.top;
                const wx = (cx - flowView.x) / flowView.s;
                const wy = (cy - flowView.y) / flowView.s;
                const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
                flowView.s = Math.max(0.2, Math.min(2.5, flowView.s * factor));
                flowView.x = cx - wx * flowView.s;
                flowView.y = cy - wy * flowView.s;
                flowView.dirty = true;
                apply();
                saveFlowView();
            }, { passive: false });

            // Expose `fit()` so the toolbar "Reset view" click (handled
            // by the single root-level click listener below) can invoke
            // it without installing a duplicate listener per wire call.
            flowFit = fit;
        }

        // Full paint — only on first load or route change.
        function paintFull() {
            const sel = parseSelection();
            root.innerHTML = `
                <div class="nodes-grid-pane">${renderGrid(sel)}</div>
                <div class="nodes-detail">${renderDetail(sel)}</div>
            `;
            wireSearch(root);
            wireNarrative(root);
            if (sel.view === 'flow') wireFlowCanvas();
        }

        // Cell-click repaints: refresh the detail pane + toggle the
        // is-active highlight, but keep both panes' scroll positions
        // untouched. Avoids jumping to the top of the grid every click.
        // If the view mode changed (e.g. toggle click), do a full paint
        // of the left pane since the layouts are structurally different.
        let lastView = null;
        function paintSelectionChange() {
            const sel = parseSelection();
            const detail = root.querySelector('.nodes-detail');
            if (detail) detail.innerHTML = renderDetail(sel);
            const pane = root.querySelector('.nodes-grid-pane');
            if (!pane) return;
            if (sel.view !== lastView) {
                pane.innerHTML = renderGrid(sel);
                wireSearch(root);
                if (sel.view === 'flow') wireFlowCanvas();
                lastView = sel.view;
                return;
            }
            pane.querySelectorAll('.ng-cell.is-active').forEach(c => c.classList.remove('is-active'));
            pane.querySelectorAll('.ng-module.is-active').forEach(c => c.classList.remove('is-active'));
            pane.querySelectorAll('.ng-flow-step.is-active').forEach(c => c.classList.remove('is-active'));
            pane.querySelectorAll('.ng-flow-node.is-active').forEach(c => c.classList.remove('is-active'));
            pane.querySelectorAll('.ng-flow-outcome.is-active').forEach(c => c.classList.remove('is-active'));
            // Match loosely: highlight any anchor whose target (n/m/o)
            // equals our selection, regardless of extra params like view.
            const markCellByHref = (selector, want) => {
                if (!want) return;
                pane.querySelectorAll(selector).forEach(a => {
                    const h = a.getAttribute('href') || '';
                    if (h.includes(want)) a.classList.add('is-active');
                });
            };
            const markStepByTitleHref = (want) => {
                if (!want) return;
                pane.querySelectorAll('a.ng-flow-step-title').forEach(a => {
                    const h = a.getAttribute('href') || '';
                    if (!h.includes(want)) return;
                    const step = a.closest('.ng-flow-step');
                    if (step) step.classList.add('is-active');
                });
            };
            if (sel.moduleId) {
                const wantM = `m=${encodeURIComponent(sel.moduleId)}`;
                const cards = pane.querySelectorAll('.ng-module');
                cards.forEach(c => {
                    if (c.dataset.moduleId === sel.moduleId) c.classList.add('is-active');
                });
                markStepByTitleHref(wantM);
            } else if (sel.nodeId) {
                const wantN = `n=${encodeURIComponent(sel.nodeId)}`;
                markCellByHref('a.ng-cell', wantN);
                markCellByHref('a.ng-flow-node', wantN);
                markStepByTitleHref(wantN);
            } else if (sel.outcomeId) {
                const wantO = `o=${encodeURIComponent(sel.outcomeId)}`;
                markCellByHref('a.ng-cell', wantO);
                markCellByHref('a.ng-flow-outcome', wantO);
            }
        }
        lastView = parseSelection().view;

        paintFull();

        // Intercept cell / chip / flow-step / flow-outcome clicks so
        // the browser's default anchor navigation doesn't reset the
        // scroll position. Update the URL manually and repaint only
        // what's needed.
        root.addEventListener('click', (e) => {
            // Flow toolbar: "Reset view" — re-fit the canvas.
            const resetBtn = e.target.closest && e.target.closest('[data-flow-action="reset"]');
            if (resetBtn) {
                e.preventDefault();
                if (flowFit) flowFit();
                return;
            }
            // Layout-toggle buttons (Modules ↔ Flow): update `view` in
            // the hash and repaint both panes.
            const btn = e.target.closest && e.target.closest('.ng-layout-toggle button');
            if (btn) {
                e.preventDefault();
                const view = btn.dataset.view || 'modules';
                const cur = parseSelection();
                if (view === cur.view) return;
                const parts = [];
                if (cur.moduleId) parts.push(`m=${encodeURIComponent(cur.moduleId)}`);
                if (cur.nodeId) parts.push(`n=${encodeURIComponent(cur.nodeId)}`);
                if (cur.outcomeId) parts.push(`o=${encodeURIComponent(cur.outcomeId)}`);
                if (view === 'flow') parts.push('view=flow');
                const next = '#/nodes' + (parts.length ? '?' + parts.join('&') : '');
                history.replaceState(null, '', next);
                paintSelectionChange();
                return;
            }

            const a = e.target.closest && e.target.closest(
                'a.ng-cell, a.nd-chip, a.ng-contract-dim, a.ng-module-title, '
              + 'a.ng-flow-step-title, a.ng-flow-node, a.ng-flow-outcome'
            );
            if (!a) return;
            // Suppress the click that fires at the end of a pan drag.
            if (flowPanMoved) { flowPanMoved = false; e.preventDefault(); return; }
            const rawHref = a.getAttribute('href') || '';
            if (!rawHref.startsWith('#/nodes')) return;
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
            e.preventDefault();
            const cur = parseSelection();
            const href = _preserveViewHref(rawHref, cur.view);
            if (location.hash !== href) {
                history.replaceState(null, '', href);
                paintSelectionChange();
            }
        });

        // Fallback: external hash changes (e.g. browser back/forward)
        // still trigger a repaint.
        window.addEventListener('hashchange', () => {
            if (!location.hash.startsWith('#/nodes')) return;
            paintSelectionChange();
        });
    }

    // FLOW_DAG is exposed so other pages (currently: explore.js's
    // "Show All Connections" debug overlay) can render the same
    // narrative-flow graph. If you change its shape here, update the
    // consumer too.
    //
    // computeModuleOutcomeTable is exposed so the same overlay can
    // render the deduced outcome pivot inside its module cards (see
    // step 1 of the exitPlan-as-source-of-truth refactor — graph.js
    // comments near DECEL_REDUCER_TABLE explain where this is headed).
    window.Nodes = { render, FLOW_DAG, computeModuleOutcomeTable };
})();
