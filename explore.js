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

    function findNextQ(sel) {
        const E = window.Engine;
        const res = E.resolvedState(sel);
        for (const t of templates) {
            if (E.templateMatches(t, res)) {
                return { terminal: true, kind: 'outcome', outcome: t, res };
            }
        }
        for (const node of E.NODES) {
            if (node.derived) continue;
            if (sel[node.id] !== undefined) continue;
            if (!E.isNodeVisible(sel, node)) continue;
            return { terminal: false, node, res };
        }
        return { terminal: true, kind: 'deadend', res };
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

    function getOrCreate(dag, sel, flavorIn) {
        const { sel: clean, flavor } = window.Engine.cleanSelection({ ...sel }, { ...(flavorIn || {}) });
        const key = selKey(clean);
        if (dag.nodes.has(key)) return dag.nodes.get(key);
        const nq = findNextQ(clean);
        const node = {
            key, sel: clean, flavor, nq,
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
        // Place relative to the parent's current position so that new nodes
        // always appear to the right of the parent, even if the user has
        // dragged the parent away from the default depth grid.
        if (parent) {
            node.x = parent.x + NODE_DX;
        } else {
            node.x = node.depth * NODE_DX;
        }
        // Siblings = other children of the SAME parent (that already have a
        // position). Stack new children below the lowest existing one so they
        // don't overlap.
        const siblings = [];
        if (parent) {
            for (const outInfo of parent.outgoing.values()) {
                const child = dag.nodes.get(outInfo.childKey);
                if (!child || child === node) continue;
                siblings.push(child);
            }
        }
        if (siblings.length === 0) {
            node.y = parent ? parent.y : 0;
        } else {
            let maxBottom = -Infinity;
            for (const s of siblings) {
                const h = s._height || DEFAULT_NODE_H;
                const bottom = s.y + h;
                if (bottom > maxBottom) maxBottom = bottom;
            }
            node.y = maxBottom + NODE_VGAP;
        }
        node.pinned = true;
    }

    function toggleEdge(dag, node, edgeId) {
        if (node.nq.terminal) return;
        const q = node.nq.node;
        const edge = q.edges.find(e => e.id === edgeId);
        if (!edge) return;
        if (window.Engine.isEdgeDisabled(node.sel, q, edge)) return;
        if (node.outgoing.has(edgeId)) {
            const { childKey } = node.outgoing.get(edgeId);
            node.outgoing.delete(edgeId);
            const child = dag.nodes.get(childKey);
            if (child) {
                child.incoming.delete(node.key);
                if (child.incoming.size === 0 && child.key !== dag.rootKey) {
                    removeSubtree(dag, child);
                }
            }
        } else {
            const childSelIn = { ...node.sel, [q.id]: edge.id };
            const { sel: cleanChild, flavor: childFlavor } =
                window.Engine.cleanSelection({ ...childSelIn }, { ...node.flavor });
            const childKey = selKey(cleanChild);
            const isNew = !dag.nodes.has(childKey);
            const child = getOrCreate(dag, childSelIn, node.flavor);
            // flavorDelta = entries added by this edge relative to parent
            const flavorDelta = {};
            const parentFlavor = node.flavor || {};
            for (const k of Object.keys(childFlavor)) {
                if (parentFlavor[k] !== childFlavor[k]) flavorDelta[k] = childFlavor[k];
            }
            child.incoming.set(node.key, { edgeId, flavorDelta });
            node.outgoing.set(edgeId, { childKey: child.key, flavorDelta });
            if (isNew) placeNewNode(dag, child, node);
        }
    }

    function removeSubtree(dag, node) {
        const childKeys = [...node.outgoing.values()].map(v => v.childKey);
        dag.nodes.delete(node.key);
        for (const ck of childKeys) {
            const c = dag.nodes.get(ck);
            if (!c) continue;
            c.incoming.delete(node.key);
            if (c.incoming.size === 0 && c.key !== dag.rootKey) {
                removeSubtree(dag, c);
            }
        }
    }

    // ═══ Layout ═══

    const NODE_DX = 320;
    const NODE_DY = 170;
    const NODE_VGAP = 24;
    const DEFAULT_NODE_H = 90;

    function layout(dag) {
        const byDepth = new Map();
        for (const node of dag.nodes.values()) {
            if (!byDepth.has(node.depth)) byDepth.set(node.depth, []);
            byDepth.get(node.depth).push(node);
        }
        const depths = [...byDepth.keys()].sort((a, b) => a - b);

        for (const node of dag.nodes.values()) {
            if (node.pinned) { node._tempY = node.y; continue; }
            if (node._tempY === undefined) node._tempY = 0;
        }

        for (let iter = 0; iter < 8; iter++) {
            for (const d of depths) {
                if (d === 0) continue;
                for (const node of byDepth.get(d)) {
                    if (node.pinned) { node._tempY = node.y; continue; }
                    const parents = [...node.incoming.keys()].map(k => dag.nodes.get(k)).filter(Boolean);
                    if (parents.length) {
                        const sum = parents.reduce((s, p) => s + p._tempY, 0);
                        node._tempY = sum / parents.length;
                    }
                }
            }
            for (const d of depths) {
                const arr = byDepth.get(d).slice().sort((a, b) => a._tempY - b._tempY || a.key.localeCompare(b.key));
                const total = arr.length;
                for (let i = 0; i < total; i++) {
                    if (arr[i].pinned) continue;
                    arr[i]._tempY = (i - (total - 1) / 2) * NODE_DY;
                }
            }
        }

        for (const node of dag.nodes.values()) {
            if (node.pinned) continue;
            node.x = node.depth * NODE_DX;
            node.y = node._tempY;
        }
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
        let cls = 'explore-node';
        if (isRoot) cls += ' is-root';
        if (nq.terminal && nq.kind === 'outcome') cls += ' is-outcome';
        if (nq.terminal && nq.kind === 'deadend') cls += ' is-deadend';
        if (selectedKey === node.key) cls += ' is-selected';
        if (node.pinned) cls += ' is-pinned';

        let title = '';
        let edgesHtml = '';
        if (nq.terminal) {
            if (nq.kind === 'outcome') {
                title = outcomeLabel(nq.outcome, nq.res);
            } else {
                title = 'Dead end — no active question';
            }
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
            nextHtml = `<div class="explore-detail-section"><h4>Next question</h4><code>${escHtml(node.nq.node.id)}</code> — ${escHtml(node.nq.node.label || '')}</div>`;
        }
        return `
            <h3>State @ depth ${node.depth}</h3>
            <div class="explore-detail-section"><h4>Selection</h4>${selHtml}</div>
            <div class="explore-detail-section"><h4>Derived / locked</h4>${derivedHtml}</div>
            ${flavorHtml}
            ${nextHtml}${outcomeHtml}
            <div class="explore-detail-section"><h4>Links</h4><a href="${mapUrl}">Open in /map</a></div>
        `;
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
        for (const node of dag.nodes.values()) {
            const hi = node.key === selectedKey;
            for (const [edgeId, outInfo] of node.outgoing) {
                const child = dag.nodes.get(outInfo.childKey);
                if (!child) continue;
                const x1 = node.x + 260;
                const y1 = node.y + 24;
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
        // Auto-expand root's only enabled edges up to a minimum depth? No — just root for now.
        let selectedKey = null;
        let viewX = 400, viewY = window.innerHeight / 2;
        let scale = 1;

        container.innerHTML = `
            <div id="explore-root">
                <div class="explore-toolbar">
                    <button data-action="reset">Reset view</button>
                    <button data-action="unpin">Unpin all</button>
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
                if (node) node._height = el.offsetHeight;
            }
        }

        function refresh() {
            layout(dag);
            const nodesHtml = [];
            for (const node of dag.nodes.values()) {
                nodesHtml.push(renderNodeHTML(dag, node, selectedKey));
            }
            nodesLayer.innerHTML = nodesHtml.join('');
            measureHeights();
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
            // Click on node (not on an edge row) → select
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
            if (dragging) { dragging = false; canvas.classList.remove('dragging'); }
        });

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
        }, { passive: false });

        // Toolbar
        root.querySelector('[data-action="reset"]').addEventListener('click', () => {
            viewX = 400; viewY = window.innerHeight / 2; scale = 1;
            applyTransform();
        });
        root.querySelector('[data-action="unpin"]').addEventListener('click', () => {
            for (const n of dag.nodes.values()) n.pinned = false;
            refresh();
        });
        root.querySelector('[data-action="clear"]').addEventListener('click', () => {
            const rootSel = dag.nodes.get(dag.rootKey).sel;
            dag.nodes.clear();
            const r = getOrCreate(dag, rootSel);
            dag.rootKey = r.key;
            selectedKey = null;
            refresh();
        });
        root.querySelector('[data-action="back"]').addEventListener('click', () => {
            location.hash = '/map';
        });

        refresh();
    }

    async function start(container, opts) {
        container.innerHTML = '<div class="loading"><p>Loading explorer…</p></div>';
        await ensureLoaded();
        render(container, opts);
    }

    window.Explore = { render: start };
})();
