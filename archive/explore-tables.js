// ─── Stateless explore tables sidebar ─────────────────────────────
// Replacement for the old "Show All Connections" live-state subsystem.
// The cards in the connections overlay are passive — they list each
// slot's atomic outcomes without any reachability filtering. Clicking
// an atomic outcome toggles a global `selectedCells` set. Clicking a
// card opens this sidebar with a uniform read x write table for that
// slot's underlying node/module, where rows = cartesian product over
// the slot's read dims (filtered to those satisfying activateWhen and
// not matching hideWhen), columns = atomic exit cells. Rows are
// highlighted when consistent with the union of writes across every
// `selectedCells` entry; columns are highlighted when their cell is in
// `selectedCells`; intersections get a double highlight.
//
// The sidebar itself is stateless: every render is a pure function of
// `selectedCells` + `currentSlotKey`. State changes (toggleCell /
// openSlot / clear) re-render automatically.

(function () {
    'use strict';

    const SIDEBAR_WIDTH = 400;
    // Sentinels used inside cartesian-product rows to represent "no
    // value" and "any value not explicitly mentioned". They flow through
    // engine.matchCondition unchanged: ET_OTHER passes any `true`-style
    // / `not`-style check (it's a non-null string not in any literal
    // list), and undefined passes any `false` check.
    const ET_UNSET = '__ET_UNSET__';
    const ET_OTHER = '__ET_OTHER__';

    // ─── State (the entire public surface area; nothing else is
    // persisted across renders or across page sessions for now).
    let selectedCells = new Set();      // 'slotKey|cellId'
    let currentSlotKey = null;
    let sidebarEl = null;

    // ─── Caches: keyed by slotKey, populated lazily, never invalidated.
    // The graph is static for the lifetime of the page so cells / rows /
    // read-dim sets per slot never change. Sidebar render results are
    // NOT cached (selectedCells changes them every click).
    const _cellsCache = new Map();
    const _rowsCache = new Map();
    const _readDimsCache = new Map();

    // ─── CSS ─────────────────────────────────────────────────────────
    // Inlined here so the sidebar is self-contained; we don't have to
    // touch explore.js's CSS string. Scoped under #et-sidebar so
    // nothing leaks into the connections overlay's card / arrow styles.
    const CSS = `
        #et-sidebar {
            position: absolute; top: 0; right: 0; bottom: 0;
            width: ${SIDEBAR_WIDTH}px;
            background: var(--bg-soft);
            border-left: 1px solid var(--border);
            font-size: 12px; line-height: 1.4;
            display: flex; flex-direction: column;
            z-index: 20;
            color: var(--text);
        }
        #et-sidebar .et-head {
            padding: 10px 12px; border-bottom: 1px solid var(--border);
            display: flex; align-items: baseline; gap: 8px;
        }
        #et-sidebar .et-head-title {
            font-weight: 600; font-size: 13px;
        }
        #et-sidebar .et-head-sub {
            color: var(--text-muted); font-size: 10px;
            font-family: ui-monospace, 'SF Mono', Consolas, monospace;
        }
        #et-sidebar .et-head-clear {
            margin-left: auto;
            background: transparent; color: var(--text-muted);
            border: 1px solid var(--border); border-radius: 4px;
            padding: 2px 8px; font-size: 11px; cursor: pointer;
        }
        #et-sidebar .et-head-clear:hover {
            color: var(--text); border-color: var(--text-muted);
        }
        #et-sidebar .et-head-clear:disabled {
            opacity: 0.4; cursor: default;
        }
        #et-sidebar .et-body {
            flex: 1 1 auto; overflow: auto;
            padding: 8px 0;
        }
        #et-sidebar .et-empty {
            padding: 40px 16px; text-align: center;
            color: var(--text-muted); font-style: italic;
        }
        #et-sidebar .et-meta {
            padding: 6px 12px; color: var(--text-muted);
            font-size: 10px;
            font-family: ui-monospace, 'SF Mono', Consolas, monospace;
        }
        #et-sidebar .et-meta code {
            font-family: inherit; background: var(--bg);
            padding: 0 4px; border-radius: 2px;
        }
        #et-sidebar .et-table-wrap { padding: 0 8px; }
        #et-sidebar table.et-table {
            width: 100%; border-collapse: collapse;
            font-family: ui-monospace, 'SF Mono', Consolas, monospace;
            font-size: 10px;
        }
        #et-sidebar table.et-table th,
        #et-sidebar table.et-table td {
            padding: 4px 6px; border: 1px solid var(--border);
            vertical-align: top; text-align: left;
            white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
            max-width: 160px;
        }
        #et-sidebar table.et-table th.et-corner {
            background: var(--bg);
            color: var(--text-muted);
            font-weight: 500; font-size: 9px;
            text-transform: uppercase; letter-spacing: 0.06em;
        }
        #et-sidebar table.et-table th.et-col-head {
            background: var(--bg);
            color: var(--text); font-weight: 600;
            position: relative;
        }
        #et-sidebar table.et-table th.et-col-head.is-selected {
            background: rgba(107,155,209,0.30);
            color: var(--text);
        }
        #et-sidebar table.et-table th.et-row-head {
            background: var(--bg);
            color: var(--text); font-weight: 500;
        }
        #et-sidebar table.et-table tr.is-row-hl th.et-row-head,
        #et-sidebar table.et-table tr.is-row-hl td.et-cell {
            background: rgba(95,138,82,0.18);
        }
        #et-sidebar table.et-table td.et-cell.is-col-hl {
            background: rgba(107,155,209,0.18);
        }
        #et-sidebar table.et-table tr.is-row-hl td.et-cell.is-col-hl {
            background: rgba(168,153,143,0.42);
            outline: 1px solid var(--accent, #6b9bd1);
        }
        #et-sidebar table.et-table td.et-cell.is-blocked {
            color: var(--text-muted); opacity: 0.5;
        }
        #et-sidebar table.et-table td.et-cell .et-mark {
            color: var(--text-muted);
        }
    `;

    function _injectCSS() {
        if (document.getElementById('et-sidebar-css')) return;
        const s = document.createElement('style');
        s.id = 'et-sidebar-css';
        s.textContent = CSS;
        document.head.appendChild(s);
    }

    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // ─── Slot lookup ────────────────────────────────────────────────
    // FLOW_DAG slot record by key. Virtual outcome / dead-end slots
    // are not in FLOW_DAG.nodes, so callers should fall back gracefully
    // when this returns undefined.
    function _slotByKey(slotKey) {
        const dag = window.Nodes && window.Nodes.FLOW_DAG;
        if (!dag) return null;
        return dag.nodes.find(n => n.key === slotKey) || null;
    }

    // ─── Cells per slot (atomic exit / output options) ──────────────
    // Permanent cache: pre-module sel is always {} for table generation
    // (the table is a static, all-inputs view) so the cell list is a
    // pure function of slot kind + node/module shape.
    function _getCellsForSlot(slotKey) {
        const cached = _cellsCache.get(slotKey);
        if (cached) return cached;
        const cells = _computeCellsForSlot(slotKey);
        _cellsCache.set(slotKey, cells);
        return cells;
    }

    function _computeCellsForSlot(slotKey) {
        // Outcome / dead-end slots have synthetic keys (`outcome:*`,
        // `deadend`) that aren't in FLOW_DAG.nodes — they are pure
        // sinks with no output cells of their own.
        if (slotKey === 'deadend' || (slotKey && slotKey.startsWith('outcome:'))) {
            return [];
        }
        const slot = _slotByKey(slotKey);
        if (!slot) return [];
        const NODE_MAP = (window.Engine && window.Engine.NODE_MAP) || {};
        const MODULE_MAP = (window.Graph && window.Graph.MODULE_MAP) || {};
        const I = window._ExploreInternals;
        if (slot.kind === 'module') {
            const mod = MODULE_MAP[slot.id];
            if (!mod || !I) return [];
            if (mod.reducerTable) {
                const synth = I.buildModuleSyntheticNode(mod);
                return synth.edges
                    .filter(e => !e._moduleEnter)
                    .map(e => ({
                        id: e.id,
                        label: e.label || e.id,
                        writes: e._moduleWrites || {},
                    }));
            }
            // Dynamic-cell module: enumerate from empty sel — this is
            // the global "all atomic exits" set the plan calls for.
            const map = I.dynamicCellEnumerate(mod, {});
            return [...map.values()].map(c => ({
                id: c.id,
                label: c.label || c.id,
                writes: c._moduleWrites || {},
            }));
        }
        // Flat node slot — every edge is an atomic outcome regardless
        // of activate/disable state. The sidebar shows the full output
        // contract; cellOk gating is a per-row column dim, not a
        // filter on the column list itself.
        const node = NODE_MAP[slot.id];
        if (!node || !node.edges) return [];
        return node.edges.map(e => {
            const writes = { [node.id]: e.id };
            const raw = e.collapseToFlavor;
            if (raw) {
                const blocks = Array.isArray(raw) ? raw : [raw];
                for (const b of blocks) {
                    if (b && b.set) Object.assign(writes, b.set);
                }
            }
            return {
                id: e.id,
                label: e.shortAnswerLabel || e.shortLabel || e.answerLabel || e.label || e.id,
                writes,
            };
        });
    }

    // ─── Read-dim discovery + literal-value extraction ──────────────
    // The set of dims a slot reads from external state (everything
    // EXCEPT its own writes / completion marker). Each dim contributes
    // one column of input space for the cartesian product. Per-edge
    // requires/disabledWhen dims are included so per-cell gating can
    // be displayed against each row.
    function _readDimsForSlot(slotKey) {
        const cached = _readDimsCache.get(slotKey);
        if (cached) return cached;
        const out = _computeReadDims(slotKey);
        _readDimsCache.set(slotKey, out);
        return out;
    }

    function _computeReadDims(slotKey) {
        const slot = _slotByKey(slotKey);
        if (!slot) return { dims: [], valuesByDim: new Map() };
        const NODE_MAP = (window.Engine && window.Engine.NODE_MAP) || {};
        const MODULE_MAP = (window.Graph && window.Graph.MODULE_MAP) || {};
        const dims = new Set();
        const valuesByDim = new Map();
        const ownDims = new Set();
        // ownDims: dims this slot writes (so we don't double-count
        // them as "reads" for table rows). For modules: writes ∪
        // completion marker. For flat nodes: just the node's own id.
        if (slot.kind === 'module') {
            const mod = MODULE_MAP[slot.id];
            if (mod) {
                for (const d of (mod.writes || [])) ownDims.add(d);
                const m = mod.completionMarker;
                if (typeof m === 'string') ownDims.add(m);
                else if (m && m.dim) ownDims.add(m.dim);
                _collectCondDims(mod.activateWhen, dims, valuesByDim);
                _collectCondDims(mod.hideWhen, dims, valuesByDim);
                for (const d of (mod.reads || [])) dims.add(d);
            }
        } else {
            const node = NODE_MAP[slot.id];
            if (node) {
                ownDims.add(node.id);
                _collectCondDims(node.activateWhen, dims, valuesByDim);
                _collectCondDims(node.hideWhen, dims, valuesByDim);
                for (const e of (node.edges || [])) {
                    _collectCondDims(e.requires, dims, valuesByDim);
                    _collectCondDims(e.disabledWhen, dims, valuesByDim);
                }
            }
        }
        // Drop any ownDim that snuck into the read set via a self-
        // referential condition — keeps rows from forking on values
        // the slot itself produces.
        for (const d of ownDims) dims.delete(d);
        // Stable order so render output is deterministic.
        const dimList = [...dims].sort();
        return { dims: dimList, valuesByDim, ownDims };
    }

    // Pull literal dim → value mappings out of a (possibly array)
    // condition block. The accumulator is shared across activateWhen /
    // hideWhen / per-edge conditions so each dim ends up with its full
    // observed value set, regardless of which condition first mentioned
    // it.
    function _collectCondDims(conds, dimsOut, valuesByDim) {
        if (!conds) return;
        const arr = Array.isArray(conds) ? conds : [conds];
        for (const c of arr) {
            if (!c || typeof c !== 'object') continue;
            for (const k of Object.keys(c)) {
                if (k === 'reason' || k.startsWith('_')) continue;
                dimsOut.add(k);
                if (!valuesByDim.has(k)) valuesByDim.set(k, new Set());
                const bag = valuesByDim.get(k);
                const v = c[k];
                if (Array.isArray(v)) {
                    for (const vv of v) bag.add(vv);
                } else if (v && typeof v === 'object' && Array.isArray(v.not)) {
                    for (const vv of v.not) bag.add(vv);
                } else if (typeof v === 'string') {
                    bag.add(v);
                }
                // booleans (true/false) contribute no specific
                // literal — the unset/other sentinels cover those.
            }
        }
    }

    // ─── Cartesian-product rows (filtered by activate/hide) ─────────
    function _getRowsForSlot(slotKey) {
        const cached = _rowsCache.get(slotKey);
        if (cached) return cached;
        const out = _computeRows(slotKey);
        _rowsCache.set(slotKey, out);
        return out;
    }

    function _computeRows(slotKey) {
        const slot = _slotByKey(slotKey);
        if (!slot) return [];
        const { dims, valuesByDim } = _readDimsForSlot(slotKey);
        if (!dims.length) {
            // No read dims — single trivial row. Activate/hide are
            // either unconditional (pass) or self-referential (rare
            // and would fail vacuously on an empty sel). We optimise
            // for the common case.
            return [{}];
        }
        const NODE_MAP = (window.Engine && window.Engine.NODE_MAP) || {};
        const MODULE_MAP = (window.Graph && window.Graph.MODULE_MAP) || {};
        const isModule = slot.kind === 'module';
        const target = isModule ? MODULE_MAP[slot.id] : NODE_MAP[slot.id];
        if (!target) return [];
        const activateWhen = target.activateWhen || null;
        const hideWhen = target.hideWhen || null;

        // Per-dim value list: literals + unset + other. Sentinels keep
        // the row count finite even when a dim has no literals (e.g.
        // mod.reads of a dim with only boolean checks).
        const valuesPerDim = dims.map(d => {
            const lits = [...(valuesByDim.get(d) || new Set())].sort();
            return [...lits, ET_UNSET, ET_OTHER];
        });

        // Cap to keep pathological reads from blowing up render. With
        // ~6 dims of avg cardinality 4 + 2 sentinels we hit ~46k pre-
        // filter rows; in practice only a handful of slots cross 1k
        // post-filter, but we cap defensively.
        const MAX_ROWS = 4096;
        const rows = [];
        const idxs = new Array(dims.length).fill(0);
        let total = 1;
        for (const vs of valuesPerDim) total *= vs.length;
        if (total > MAX_ROWS * 4) {
            // Hard cap at 4× max: we'll bail mid-iteration once we hit
            // the accept limit, but a 100k+ pre-filter total means the
            // slot has too much input space for a usable table.
            // eslint-disable-next-line no-console
            console.warn('[ExploreTables]', slotKey, 'has', total,
                'pre-filter rows; truncating.');
        }

        const E = window.Engine;
        const accept = (row) => {
            if (!E || !E.matchCondition) return true;
            const sel = {};
            for (const d of Object.keys(row)) {
                if (row[d] === ET_UNSET) continue;
                sel[d] = row[d];
            }
            if (activateWhen && activateWhen.length) {
                if (!activateWhen.some(c => E.matchCondition(sel, c))) return false;
            }
            if (hideWhen && hideWhen.length) {
                if (hideWhen.some(c => E.matchCondition(sel, c))) return false;
            }
            return true;
        };

        // Iterative Cartesian product so we can early-exit on the row
        // cap without recursive allocation.
        outer: while (rows.length < MAX_ROWS) {
            const row = {};
            for (let i = 0; i < dims.length; i++) {
                row[dims[i]] = valuesPerDim[i][idxs[i]];
            }
            if (accept(row)) rows.push(row);
            for (let i = dims.length - 1; i >= 0; i--) {
                idxs[i]++;
                if (idxs[i] < valuesPerDim[i].length) continue outer;
                idxs[i] = 0;
            }
            break;
        }
        return rows;
    }

    // ─── Cumulative writes from selectedCells ───────────────────────
    // Walks every entry in selectedCells, looks up the cell's writes,
    // and merges them into a per-dim Map<dim, Set<value>>. Multi-value
    // sets handle the case where two different selected cells write
    // the same dim with conflicting values — both possibilities stay
    // in the map so any matching row in the highlighted slot's table
    // lights up.
    function cumulativeWrites() {
        const out = new Map();
        for (const k of selectedCells) {
            const sep = k.indexOf('|');
            if (sep < 0) continue;
            const slotKey = k.slice(0, sep);
            const cellId = k.slice(sep + 1);
            const cells = _getCellsForSlot(slotKey);
            const cell = cells.find(c => c.id === cellId);
            if (!cell) continue;
            for (const [dim, val] of Object.entries(cell.writes || {})) {
                if (!out.has(dim)) out.set(dim, new Set());
                out.get(dim).add(val);
            }
        }
        return out;
    }

    // Row matches writes iff every dim in `row` that's also present in
    // `writes` has a matching value. Dims unconstrained by writes don't
    // exclude the row. Sentinels (ET_UNSET / ET_OTHER) are evaluated
    // against the slot's literal value list so "(other)" only matches
    // writes whose value isn't in any literal condition for that dim.
    function rowMatchesWrites(row, writes, slotKey) {
        if (!writes || !writes.size) return false;
        const { valuesByDim } = _readDimsForSlot(slotKey);
        let touched = false;
        for (const dim of Object.keys(row)) {
            const wrSet = writes.get(dim);
            if (!wrSet || !wrSet.size) continue;
            touched = true;
            const rv = row[dim];
            if (rv === ET_UNSET) {
                // writes always have a defined value, so an unset row
                // can never match a constrained dim.
                return false;
            }
            const lits = valuesByDim.get(dim) || new Set();
            if (rv === ET_OTHER) {
                // Match only if some written value is outside the
                // slot's literal set for this dim.
                let foundOther = false;
                for (const wv of wrSet) {
                    if (!lits.has(wv)) { foundOther = true; break; }
                }
                if (!foundOther) return false;
            } else if (!wrSet.has(rv)) {
                return false;
            }
        }
        return touched;
    }

    // ─── Per-cell, per-row gating (cellOk) ──────────────────────────
    // For flat-node columns: a cell is blocked on a row if any of its
    // disabledWhen conditions match the row, or if its requires doesn't
    // match. For module cells we always answer true — the per-input
    // gating happens inside the module's internal walk and there's no
    // good top-level expression of it yet.
    function _cellOk(slot, cell, row) {
        if (!slot) return true;
        if (slot.kind === 'module') return true;
        const NODE_MAP = (window.Engine && window.Engine.NODE_MAP) || {};
        const node = NODE_MAP[slot.id];
        if (!node) return true;
        const edge = (node.edges || []).find(e => e.id === cell.id);
        if (!edge) return true;
        const E = window.Engine;
        if (!E || !E.matchCondition) return true;
        const sel = {};
        for (const d of Object.keys(row)) {
            if (row[d] === ET_UNSET) continue;
            sel[d] = row[d];
        }
        if (edge.disabledWhen && edge.disabledWhen.some(c => E.matchCondition(sel, c))) {
            return false;
        }
        if (edge.requires && edge.requires.length) {
            if (!edge.requires.some(c => E.matchCondition(sel, c))) return false;
        }
        return true;
    }

    // ─── Sidebar mount / render ─────────────────────────────────────
    function init(rootEl) {
        if (!rootEl) return;
        _injectCSS();
        if (sidebarEl && sidebarEl.parentElement === rootEl) {
            // Already mounted in this overlay — just refresh it.
            render();
            return;
        }
        // If the previous overlay was torn down, the old sidebar may
        // still be referenced. Drop it and rebuild fresh inside the
        // new overlay so click delegation lands on the right element.
        if (sidebarEl && sidebarEl.parentElement) {
            sidebarEl.parentElement.removeChild(sidebarEl);
        }
        sidebarEl = document.createElement('div');
        sidebarEl.id = 'et-sidebar';
        rootEl.appendChild(sidebarEl);
        sidebarEl.addEventListener('click', _onSidebarClick);
        render();
    }

    function _onSidebarClick(e) {
        const clearBtn = e.target.closest && e.target.closest('.et-head-clear');
        if (clearBtn) {
            clear();
            return;
        }
    }

    function toggleCell(slotKey, cellId) {
        const k = slotKey + '|' + cellId;
        if (selectedCells.has(k)) selectedCells.delete(k);
        else selectedCells.add(k);
        render();
    }

    function openSlot(slotKey) {
        currentSlotKey = slotKey;
        render();
    }

    function clear() {
        selectedCells.clear();
        render();
    }

    function isSelected(slotKey, cellId) {
        return selectedCells.has(slotKey + '|' + cellId);
    }

    function _formatRowLabel(row, dims) {
        if (!dims.length) return '(no reads)';
        return dims.map(d => {
            const v = row[d];
            const shown = v === ET_UNSET ? '∅' : v === ET_OTHER ? '*' : v;
            return d + '=' + shown;
        }).join(', ');
    }

    function render() {
        if (!sidebarEl) return;
        const writes = cumulativeWrites();
        const totalSelected = selectedCells.size;

        const slotKey = currentSlotKey;
        if (!slotKey) {
            sidebarEl.innerHTML = `
                <div class="et-head">
                    <span class="et-head-title">Tables</span>
                    <button type="button" class="et-head-clear" ${totalSelected ? '' : 'disabled'}>Clear</button>
                </div>
                <div class="et-body">
                    <div class="et-empty">
                        Click a card to inspect its read × write table.
                    </div>
                    ${totalSelected ? `<div class="et-meta">${totalSelected} selected cell${totalSelected === 1 ? '' : 's'} — pick a card to see how it reacts.</div>` : ''}
                </div>
            `;
            return;
        }

        const slot = _slotByKey(slotKey);
        const isVirtual = slotKey === 'deadend' || slotKey.startsWith('outcome:');
        const titleText = _slotTitle(slotKey);
        const subText = isVirtual
            ? (slotKey === 'deadend' ? 'dead-end (terminal)' : 'narrative outcome')
            : (slot ? `${slot.kind}: ${slot.id}` : slotKey);

        let bodyHtml;
        if (isVirtual || !slot) {
            bodyHtml = `<div class="et-empty">
                ${slotKey === 'deadend'
                    ? 'The dead-end card is a terminal sink — no inputs, no outputs.'
                    : 'Outcome cards are terminal sinks — no inputs, no outputs.'}
            </div>`;
        } else {
            const cells = _getCellsForSlot(slotKey);
            const rows = _getRowsForSlot(slotKey);
            const { dims } = _readDimsForSlot(slotKey);
            bodyHtml = _renderTableHtml(slot, cells, rows, dims, writes);
        }

        sidebarEl.innerHTML = `
            <div class="et-head">
                <span class="et-head-title">${esc(titleText)}</span>
                <span class="et-head-sub">${esc(subText)}</span>
                <button type="button" class="et-head-clear" ${totalSelected ? '' : 'disabled'}>Clear</button>
            </div>
            <div class="et-body">
                ${bodyHtml}
            </div>
        `;
    }

    function _slotTitle(slotKey) {
        if (slotKey === 'deadend') return 'Dead end';
        if (slotKey.startsWith('outcome:')) {
            return 'Outcome: ' + slotKey.slice('outcome:'.length);
        }
        const slot = _slotByKey(slotKey);
        if (!slot) return slotKey;
        const NODE_MAP = (window.Engine && window.Engine.NODE_MAP) || {};
        const MODULE_MAP = (window.Graph && window.Graph.MODULE_MAP) || {};
        const target = slot.kind === 'module' ? MODULE_MAP[slot.id] : NODE_MAP[slot.id];
        if (slot.kind === 'module') {
            return ((target && target.label) || slot.id) + ' loop';
        }
        return (target && target.label) || slot.id;
    }

    function _renderTableHtml(slot, cells, rows, dims, writes) {
        if (!cells.length) {
            return `<div class="et-empty">No output cells for this slot.</div>`;
        }
        const slotKey = slot.key;
        let html = '';
        // Per-table meta: read dim count, output cell count, row count.
        html += `<div class="et-meta">`
             + `${rows.length} input row${rows.length === 1 ? '' : 's'}`
             + ` &times; ${cells.length} output cell${cells.length === 1 ? '' : 's'}`
             + (dims.length
                 ? ` &middot; reads <code>${esc(dims.join(', '))}</code>`
                 : ' &middot; no read dims')
             + `</div>`;
        html += `<div class="et-table-wrap"><table class="et-table">`;
        // Header row: corner + one column per cell.
        html += `<thead><tr>`;
        html += `<th class="et-corner">${dims.length ? 'inputs \\ outputs' : ''}</th>`;
        for (const cell of cells) {
            const colHl = isSelected(slotKey, cell.id);
            html += `<th class="et-col-head${colHl ? ' is-selected' : ''}" `
                 + `title="${esc(cell.id)}">${esc(cell.label)}</th>`;
        }
        html += `</tr></thead>`;
        // Body rows.
        html += `<tbody>`;
        if (!rows.length) {
            html += `<tr><td class="et-empty" colspan="${cells.length + 1}">`
                 + `No input rows satisfy this slot's activateWhen / hideWhen.`
                 + `</td></tr>`;
        }
        for (const row of rows) {
            const rowHl = rowMatchesWrites(row, writes, slotKey);
            const trCls = rowHl ? 'is-row-hl' : '';
            html += `<tr class="${trCls}">`;
            html += `<th class="et-row-head" title="${esc(_formatRowLabel(row, dims))}">`
                 + esc(_formatRowLabel(row, dims))
                 + `</th>`;
            for (const cell of cells) {
                const colHl = isSelected(slotKey, cell.id);
                const ok = _cellOk(slot, cell, row);
                let cls = 'et-cell';
                if (colHl) cls += ' is-col-hl';
                if (!ok) cls += ' is-blocked';
                html += `<td class="${cls}">`
                     + (ok ? '<span class="et-mark">✓</span>' : '<span class="et-mark">·</span>')
                     + `</td>`;
            }
            html += `</tr>`;
        }
        html += `</tbody></table></div>`;
        return html;
    }

    // ─── Public API ─────────────────────────────────────────────────
    window.ExploreTables = {
        init,
        toggleCell,
        openSlot,
        clear,
        isSelected,
        cumulativeWrites,
        rowMatchesWrites,
        render,
        // Cell enumeration: exposed so explore.js's card renderer can
        // list a slot's atomic outcomes without duplicating the
        // module-synthetic / dynamic-DFS routing logic. Cached, so
        // calling on every render is cheap.
        getCellsForSlot: _getCellsForSlot,
        // Direct accessors — explore.js consults these when rendering
        // cards (per-cell `is-selected` styling) and the toolbar
        // (selected-count display). We expose the live Set rather than
        // a snapshot so callers always see the latest state.
        get selectedCells() { return selectedCells; },
        get currentSlotKey() { return currentSlotKey; },
    };
})();
