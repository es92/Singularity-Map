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

        #nodes-root .nodes-detail {
            flex: 1; overflow-y: auto; padding: 20px 28px;
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

    function renderSidebar(selected) {
        const NODES = window.Engine.NODES;
        const sections = [
            { id: 'stage-1', label: 'Stage 1', items: NODES.filter(n => n.stage === 1) },
            { id: 'stage-2', label: 'Stage 2', items: NODES.filter(n => n.stage === 2) },
            { id: 'stage-3', label: 'Stage 3', items: NODES.filter(n => n.stage === 3) },
            { id: 'stage-other', label: 'Other Nodes', items: NODES.filter(n => ![1,2,3].includes(n.stage)) },
            { id: 'outcomes', label: 'Outcomes', items: templates.map(t => ({ id: t.id, label: t.title || '', _outcome: true })) }
        ];
        let html = `
            <div class="nodes-sidebar-head">
                <a href="#/explore">← explore</a>
                <a href="#/map" style="margin-left: auto;">map →</a>
            </div>
            <div style="padding: 8px 10px;">
                <input type="text" class="nodes-search" placeholder="Search nodes / outcomes…" />
            </div>
            <div class="nodes-list">
        `;
        for (const sec of sections) {
            if (!sec.items.length) continue;
            html += `<div class="nodes-list-section-head">${esc(sec.label)}</div>`;
            for (const n of sec.items) {
                const isOutcome = !!n._outcome;
                const href = isOutcome ? `#/nodes?o=${encodeURIComponent(n.id)}`
                                        : `#/nodes?n=${encodeURIComponent(n.id)}`;
                const active = (!isOutcome && selected.nodeId === n.id) || (isOutcome && selected.outcomeId === n.id);
                const cls = 'nodes-list-item'
                    + (active ? ' is-active' : '')
                    + (n.derived ? ' nl-derived' : '')
                    + (isOutcome ? ' nl-outcome' : '');
                html += `<a class="${cls}" href="${href}"
                          data-search="${esc((n.id + ' ' + (n.label || '')).toLowerCase())}">
                            <span class="nl-id">${esc(n.id)}</span>
                            <span class="nl-label">${esc(n.label || '')}</span>
                         </a>`;
            }
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
            <div class="nd-subtitle">${esc(node.questionText || '')}</div>
            <div class="nd-meta">${tags.map(t => `<span class="nd-tag">${esc(t)}</span>`).join('')}</div>
        `;

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
        const list = root.querySelector('.nodes-list');
        if (!input || !list) return;
        input.addEventListener('input', () => {
            const q = input.value.trim().toLowerCase();
            const items = list.querySelectorAll('.nodes-list-item');
            items.forEach(it => {
                const s = it.dataset.search || '';
                it.style.display = (!q || s.includes(q)) ? '' : 'none';
            });
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

        function paint() {
            const sel = parseSelection();
            root.innerHTML = `
                <div class="nodes-sidebar">${renderSidebar(sel)}</div>
                <div class="nodes-detail">${renderDetail(sel)}</div>
            `;
            wireSearch(root);
        }
        paint();

        // Internal navigation repaints without full route change.
        window.addEventListener('hashchange', () => {
            if (location.hash.startsWith('#/nodes')) paint();
        });
    }

    window.Nodes = { render };
})();
