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
        }
        #explore-root .explore-edge-row:hover { background: var(--bg); }
        #explore-root .explore-edge-row.is-expanded { background: rgba(107,155,209,0.15); color: var(--text); }
        #explore-root .explore-edge-row.is-disabled { color: var(--text-muted); opacity: 0.5; cursor: not-allowed; }
        #explore-root .explore-edge-row.is-disabled:hover { background: transparent; }
        #explore-root .explore-edge-row .explore-edge-chevron {
            width: 10px; text-align: center; font-family: monospace; font-size: 10px; color: var(--text-muted);
        }
        #explore-root .explore-edge-row.is-expanded .explore-edge-chevron { color: var(--accent, #6b9bd1); }
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

    function _buildModuleSyntheticNode(mod) {
        const edges = [];
        if (mod.reducerTable) {
            for (const [action, progressMap] of Object.entries(mod.reducerTable)) {
                for (const [progress, cell] of Object.entries(progressMap)) {
                    const writes = {};
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
            if (marker && sel[marker] !== undefined) continue;
            if (_moduleActivateWhenMatches(sel, m)) return m;
        }
        return null;
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
        if (marker && childSel[marker] !== undefined) return null;
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
    function _dagKey(clean, moduleExpanded) {
        const base = selKey(clean);
        return moduleExpanded ? base + '|inside:' + moduleExpanded : base;
    }

    function getOrCreate(dag, sel, flavorIn, moduleExpanded) {
        const { sel: clean, flavor } = window.Engine.cleanSelection({ ...sel }, { ...(flavorIn || {}) });
        const me = _resolveChildModuleExpanded(moduleExpanded || null, clean);
        const key = _dagKey(clean, me);
        if (dag.nodes.has(key)) return dag.nodes.get(key);
        const nq = findNextQ(clean, { skipModule: me });
        const node = {
            key, sel: clean, flavor, nq,
            moduleExpanded: me,
            depth: Object.keys(clean).length,
            // outgoing: edgeId → { childKey, flavorDelta } so path-specific
            // flavor (e.g., stall_recovery='mild') is preserved even when the
            // child node converges via DAG key.
            outgoing: new Map(),
            // incoming: parentKey → { edgeId, flavorDelta } for each inbound path
            incoming: new Map(),
            x: 0, y: 0,
            hidden: false
        };
        dag.nodes.set(key, node);
        return node;
    }

    function placeNewNode(dag, node, parent) {
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

    function toggleEdge(dag, node, edgeId) {
        if (node.nq.terminal) return;
        const q = node.nq.node;
        const edge = q.edges.find(e => e.id === edgeId);
        if (!edge) return;
        // Synthetic module edges carry either a writes bundle (atomic cell)
        // or an `_moduleEnter` marker (enter the internal question walk);
        // neither is ever "disabled" since the module's activateWhen already
        // gated entry.
        const isModuleCell = !!edge._moduleWrites;
        const isModuleEnter = !!edge._moduleEnter;
        const isSynth = isModuleCell || isModuleEnter;
        if (!isSynth && window.Engine.isEdgeDisabled(node.sel, q, edge)) return;
        if (node.outgoing.has(edgeId)) {
            const { childKey } = node.outgoing.get(edgeId);
            node.outgoing.delete(edgeId);
            savedOpens.delete(openTag(node.key, edgeId));
            persistOpens();
            const child = dag.nodes.get(childKey);
            if (child) {
                child.incoming.delete(node.key);
                if (child.incoming.size === 0 && child.key !== dag.rootKey) {
                    removeSubtree(dag, child);
                }
            }
        } else {
            let childSelIn, childModuleCtx;
            if (isModuleEnter) {
                // Enter the module's internal walk: sel is unchanged, but the
                // child gets flagged as "inside" this module so findNextQ
                // falls through to the first internal question.
                childSelIn = { ...node.sel };
                childModuleCtx = node.nq.module.id;
            } else if (isModuleCell) {
                childSelIn = { ...node.sel, ...edge._moduleWrites };
                childModuleCtx = null;
            } else {
                childSelIn = { ...node.sel, [q.id]: edge.id };
                // Regular question edges inherit the parent's module-expansion
                // flag so the whole walk stays "inside" the module until the
                // reducer exits.
                childModuleCtx = node.moduleExpanded || null;
            }
            const { sel: cleanChild, flavor: childFlavor } =
                window.Engine.cleanSelection({ ...childSelIn }, { ...node.flavor });
            const childMe = _resolveChildModuleExpanded(childModuleCtx, cleanChild);
            const childKey = _dagKey(cleanChild, childMe);
            const isNew = !dag.nodes.has(childKey);
            const child = getOrCreate(dag, childSelIn, node.flavor, childModuleCtx);
            const flavorDelta = {};
            const parentFlavor = node.flavor || {};
            for (const k of Object.keys(childFlavor)) {
                if (parentFlavor[k] !== childFlavor[k]) flavorDelta[k] = childFlavor[k];
            }
            child.incoming.set(node.key, { edgeId, flavorDelta });
            node.outgoing.set(edgeId, { childKey: child.key, flavorDelta });
            savedOpens.add(openTag(node.key, edgeId));
            persistOpens();
            if (isNew) placeNewNode(dag, child, node);
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
                for (const edgeId of edgeIds) {
                    const edge = node.nq.node.edges.find(e => e.id === edgeId);
                    if (!edge) continue;
                    const isSyntheticModuleEdge = !!(edge._moduleWrites || edge._moduleEnter);
                    if (!isSyntheticModuleEdge && window.Engine.isEdgeDisabled(node.sel, node.nq.node, edge)) continue;
                    if (!node.outgoing.has(edgeId)) toggleEdge(dag, node, edgeId);
                    const info = node.outgoing.get(edgeId);
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
            if (c.incoming.size === 0 && c.key !== dag.rootKey) {
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
            title = (mod.label || mod.id) + ' loop';
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
                const expanded = node.outgoing.has(edge.id);
                const isEnter = !!edge._moduleEnter;
                let rowCls = 'explore-edge-row';
                if (expanded) rowCls += ' is-expanded';
                if (isEnter) rowCls += ' is-module-enter';
                const chev = expanded ? '▾' : '▸';
                const label = edge.label || edge.id;
                const rowHtml = `<div class="${rowCls}" data-edge-id="${edge.id}"><span class="explore-edge-chevron">${chev}</span><span class="explore-edge-label">${escHtml(label)}</span></div>`;
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
                const tooltip = disabled ? (reason || 'Not available') : '';
                return `<div class="${rowCls}" data-edge-id="${edge.id}" title="${escHtml(tooltip)}"><span class="explore-edge-chevron">${chev}</span><span class="explore-edge-label">${escHtml(label)}</span></div>`;
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
        const selHtml = Object.keys(sel).length ? renderDimChips(sel, {}) : '<span class="explore-dim-chip"><i>empty</i></span>';
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
                const y2 = child.y + 24;
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
                    <button data-action="expand-early">Expand to Open Source</button>
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
            for (const n of dag.nodes.values()) { n.pinned = false; n._placed = false; }
            refresh();
        });
        root.querySelector('[data-action="expand-early"]').addEventListener('click', () => {
            // BFS-expand every enabled edge from the current frontier, stopping
            // descent as soon as a node is terminal (outcome/dead-end) OR its
            // next question is `open_source`. The open_source node itself is
            // rendered as a leaf but not expanded.
            const STOP_AT = 'open_source';
            const MAX_NODES = 500;
            // Snapshot existing keys so we can unpin everything created by this
            // expansion and let the barycenter auto-layout place them without
            // sibling overlap.
            const preexisting = new Set(dag.nodes.keys());
            const queue = [dag.nodes.get(dag.rootKey)];
            const seen = new Set();
            while (queue.length && dag.nodes.size < MAX_NODES) {
                const node = queue.shift();
                if (!node || seen.has(node.key)) continue;
                seen.add(node.key);
                if (node.nq.terminal) continue;
                if (node.nq.node.id === STOP_AT) continue;
                for (const edge of node.nq.node.edges) {
                    if (window.Engine.isEdgeDisabled(node.sel, node.nq.node, edge)) continue;
                    if (!node.outgoing.has(edge.id)) {
                        toggleEdge(dag, node, edge.id);
                    }
                    const info = node.outgoing.get(edge.id);
                    if (!info) continue;
                    const child = dag.nodes.get(info.childKey);
                    if (child && !seen.has(child.key)) queue.push(child);
                }
            }
            // Unpin newly created nodes so layout() spreads them vertically
            // using the same barycenter logic used elsewhere. Pre-existing
            // (user-dragged) nodes keep their pinned positions.
            for (const n of dag.nodes.values()) {
                if (!preexisting.has(n.key)) n.pinned = false;
            }
            refresh();
        });
        root.querySelector('[data-action="clear"]').addEventListener('click', () => {
            const rootSel = dag.nodes.get(dag.rootKey).sel;
            dag.nodes.clear();
            const r = getOrCreate(dag, rootSel);
            dag.rootKey = r.key;
            selectedKey = null;
            clearSavedOpens();
            refresh();
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
    }

    async function start(container, opts) {
        container.innerHTML = '<div class="loading"><p>Loading explorer…</p></div>';
        await ensureLoaded();
        render(container, opts);
    }

    window.Explore = { render: start };
})();
