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
        }
        #nodes-root .ng-module-head {
            margin-bottom: 10px;
        }
        #nodes-root .ng-module-title {
            font-weight: 600; font-size: 13px;
            font-family: ui-monospace, monospace;
            color: var(--accent, #6b9bd1);
        }
        #nodes-root .ng-module-contract {
            font-size: 10px; color: var(--text-muted);
            margin-top: 3px; line-height: 1.5;
            font-family: ui-monospace, monospace;
        }
        #nodes-root .ng-module-contract b { color: var(--text); font-weight: 600; }
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

    // Build analysis indices. Call once after load.
    let analysis = null;
    function buildAnalysis() {
        if (analysis) return analysis;
        const NODES = window.Engine.NODES;
        const dimSet = new Set(NODES.map(n => n.id));
        // Outcome "dims" exist too — templates reference marker-like keys
        // written only via collapseToFlavor.set (e.g. `stall_later`). Include
        // those so references to them resolve, but we'll treat them as
        // synthetic dims without a host node.
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

    function renderGrid(selected) {
        const NODES = window.Engine.NODES;
        const NODE_MAP = window.Engine.NODE_MAP;
        const MODULES = (window.Graph && window.Graph.MODULES) || [];
        const A = buildAnalysis();

        let html = `
            <div class="ng-head">
                <a href="#/explore">← explore</a>
                <input type="text" class="nodes-search" placeholder="Search nodes / outcomes…" />
                <a href="#/map">map →</a>
            </div>
            <div class="ng-body">
        `;

        // Modules — one card per module, internal nodes in a grid, with the
        // reads/writes contract right under the header.
        html += `<div class="ng-section">`;
        html += `<h3 class="ng-section-head">Modules</h3>`;
        for (const m of MODULES) {
            const items = (m.nodeIds || []).map(id => NODE_MAP[id]).filter(Boolean);
            if (!items.length) continue;
            const reads = (m.reads || []).join(', ') || '—';
            const writes = (m.writes || []).join(', ') || '—';
            html += `<div class="ng-module" id="ng-module-${esc(m.id)}">`;
            html += `<div class="ng-module-head">`;
            html += `<div class="ng-module-title">${esc(m.id)}</div>`;
            html += `<div class="ng-module-contract">`
                 + `<div><b>reads</b> <code>${esc(reads)}</code></div>`
                 + `<div><b>writes</b> <code>${esc(writes)}</code></div>`
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

        const reads     = A.nodeReads.get(nodeId) || new Set();
        const readSites = A.nodeReadSites.get(nodeId) || [];
        const writes    = A.nodeWrites.get(nodeId) || new Set();
        const moves     = A.nodeMoves.get(nodeId) || new Set();
        const readBy    = A.readBy.get(nodeId) || [];
        const writtenBy = A.writtenBy.get(nodeId) || [];
        const movedBy   = A.movedBy.get(nodeId) || [];
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
            // Also show each site
            html += `<div style="margin-top: 10px;">`;
            for (const [srcId, wheres] of sorted) {
                const src = NODE_MAP[srcId];
                const sites = (A.nodeReadSites.get(srcId) || []).filter(s => s.dims.includes(nodeId));
                for (const site of sites) {
                    html += `<div class="nd-site">
                        <div class="nd-site-head">${esc(srcId)} · ${esc(site.where)}</div>
                        <div class="nd-site-body"><pre class="nd-json">${esc(JSON.stringify(site.raw, null, 2))}</pre></div>
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
            // Show where in each outcome
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
                // Enumerate matching reachable clauses
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
                        html += `<pre class="nd-json">reachable[${h.i}]: ${esc(JSON.stringify(h.c, null, 2))}</pre>`;
                    }
                }
                html += `</div>`;
            }
            html += `</div>`;
        }
        html += `</div>`;

        // ─── What this node reads
        html += `<div class="nd-section"><h3>Reads (upstream dependencies)</h3>`;
        if (!reads.size) {
            html += `<div class="nd-empty">This node has no reads on other dims.</div>`;
        } else {
            html += `<div class="nd-chip-row">`;
            [...reads].sort().forEach(d => { html += dimChip(d); });
            html += `</div>`;
            html += `<div style="margin-top: 10px;">`;
            for (const site of readSites) {
                html += `<div class="nd-site">
                    <div class="nd-site-head">${esc(site.where)} — refs: ${site.dims.map(d => esc(d)).join(', ')}</div>
                    <pre class="nd-json">${esc(JSON.stringify(site.raw, null, 2))}</pre>
                </div>`;
            }
            html += `</div>`;
        }
        html += `</div>`;

        // ─── Writes / moves
        if (writes.size || moves.size) {
            html += `<div class="nd-section"><h3>Writes (via edges)</h3>`;
            if (writes.size) {
                html += `<div class="nd-row"><div class="nd-row-label">sets (sel)</div><div class="nd-row-body"><div class="nd-chip-row">`;
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

        // ─── Edges summary
        if (node.edges && node.edges.length) {
            html += `<div class="nd-section"><h3>Edges</h3>`;
            for (const e of node.edges) {
                html += `<div class="nd-site">
                    <div class="nd-site-head">${esc(e.id)}${e.label ? ` — ${esc(e.label)}` : ''}</div>`;
                const parts = {};
                if (e.disabledWhen && e.disabledWhen.length) parts.disabledWhen = e.disabledWhen;
                if (e.requires && e.requires.length) parts.requires = e.requires;
                if (e.collapseToFlavor) parts.collapseToFlavor = e.collapseToFlavor;
                if (Object.keys(parts).length) {
                    html += `<pre class="nd-json">${esc(JSON.stringify(parts, null, 2))}</pre>`;
                } else {
                    html += `<div class="nd-empty">(no gates)</div>`;
                }
                html += `</div>`;
            }
            html += `</div>`;
        }

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
                    <pre class="nd-json">${esc(JSON.stringify(c, null, 2))}</pre>
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

    function renderDetail(selection) {
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
        return { nodeId: params.n || '', outcomeId: params.o || '' };
    }

    async function render(app) {
        injectCss();
        await ensureLoaded();

        app.innerHTML = `<div id="nodes-root"></div>`;
        const root = app.querySelector('#nodes-root');

        // Full paint — only on first load or route change.
        function paintFull() {
            const sel = parseSelection();
            root.innerHTML = `
                <div class="nodes-grid-pane">${renderGrid(sel)}</div>
                <div class="nodes-detail">${renderDetail(sel)}</div>
            `;
            wireSearch(root);
            wireNarrative(root);
        }

        // Cell-click repaints: refresh the detail pane + toggle the
        // is-active highlight, but keep both panes' scroll positions
        // untouched. Avoids jumping to the top of the grid every click.
        function paintSelectionChange() {
            const sel = parseSelection();
            const detail = root.querySelector('.nodes-detail');
            if (detail) detail.innerHTML = renderDetail(sel);
            // Update is-active class on grid cells without rerendering them.
            const pane = root.querySelector('.nodes-grid-pane');
            if (pane) {
                pane.querySelectorAll('.ng-cell.is-active').forEach(c => c.classList.remove('is-active'));
                const nodeHref = sel.nodeId ? `#/nodes?n=${encodeURIComponent(sel.nodeId)}` : null;
                const outHref = sel.outcomeId ? `#/nodes?o=${encodeURIComponent(sel.outcomeId)}` : null;
                if (nodeHref) {
                    const cell = pane.querySelector(`.ng-cell[href="${nodeHref}"]`);
                    if (cell) cell.classList.add('is-active');
                } else if (outHref) {
                    const cell = pane.querySelector(`.ng-cell[href="${outHref}"]`);
                    if (cell) cell.classList.add('is-active');
                }
            }
        }

        paintFull();

        // Intercept cell clicks so the browser's default anchor
        // navigation (which resets scroll to the nearest match or to
        // the top of the scroll container) doesn't fire. We update the
        // URL manually via history.replaceState, then repaint only the
        // detail pane — preserving the grid's scroll position exactly.
        root.addEventListener('click', (e) => {
            const a = e.target.closest && e.target.closest('a.ng-cell, a.nd-chip');
            if (!a) return;
            const href = a.getAttribute('href') || '';
            if (!href.startsWith('#/nodes')) return;
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
            e.preventDefault();
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

    window.Nodes = { render };
})();
