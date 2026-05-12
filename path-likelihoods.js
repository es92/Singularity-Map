// Singularity Possibilities Map — /path-likelihoods view
//
// Probability-trace algorithm. The user assigns weights over the answer
// edges of every reachable engine state; this file builds the resulting
// state graph (DAG when path-dependence is off; tree when it's on),
// propagates probability mass from the root down, and renders both a
// vertical tree of states + unanswered questions and a summary pane
// listing per-outcome probabilities and the unsettled frontier.
//
// The state-stepping primitives are the same ones used by the runtime
// /map view in index.html (`WalkStep.nextAction`, `Engine.push`, etc.),
// so the set of reachable states drawn here is exactly the set the live
// walk could ever reach — no separate routing, locking, or outcome
// detection logic. See the spec section "Graph Engine Model" for the
// underlying invariants.

(function () {
    'use strict';

    const STORAGE_KEY = 'pathLikelihoods.v1';
    // v2: weights are now stored on a 0–100 scale (previously 0–1 decimals).
    //     Relative-weight semantics didn't change — `w[e] / Σ w[*]` is still
    //     scale-invariant — but old persisted decimals would render as ~0%
    //     in the new UI, so we drop them on load.
    // v3: replaced the boolean `pathDependent` flag with a 3-way `mode`:
    //       'questions' (default) — one weight distribution per question
    //                                node.id, flat list UI, no canvas tree.
    //       'sel'                  — full state DAG (selKey-keyed weights),
    //                                canvas tree.
    //       'path'                 — full state per-path tree (stack-keyed
    //                                weights), canvas tree.
    //     Adds a third weight bag triple keyed by question node.id:
    //       weights.question, autoFilled.question, expandAnyway.question.
    //     v2 records migrate forward (pathDependent → mode); user weights
    //     in `weights.sel` and `weights.path` are preserved.
    const VERSION = 3;
    const VALID_MODES = ['questions', 'sel', 'path'];

    // ────────────────────────────────────────────────────────────────
    // CSS — reuses existing theme variables from timeline.css so dark/
    // light mode look right without duplicating colour values.
    // ────────────────────────────────────────────────────────────────
    const CSS = `
        .pl-page {
            position: fixed; inset: 0;
            background: var(--bg);
            color: var(--text);
            display: flex;
            flex-direction: column;
            font-family: inherit;
        }
        .pl-topbar {
            display: flex; align-items: center; gap: 16px;
            padding: 10px 18px;
            border-bottom: 1px solid var(--border);
            background: var(--bg-surface);
            flex-wrap: wrap;
        }
        .pl-topbar h1 {
            font-size: 1.15rem; margin: 0; font-weight: 600;
            letter-spacing: -0.02em;
        }
        .pl-topbar .pl-totals { display: flex; gap: 14px; font-size: 0.88rem; flex-wrap: wrap; }
        .pl-topbar .pl-tot-label { color: var(--text-dim); margin-right: 4px; }
        .pl-topbar .pl-tot-val { font-variant-numeric: tabular-nums; font-weight: 600; }
        .pl-topbar .pl-tot-settled .pl-tot-val   { color: var(--accent); }
        .pl-topbar .pl-tot-unsettled .pl-tot-val { color: var(--accent-2); }
        .pl-topbar .pl-tot-stuck .pl-tot-val     { color: #ff7b7b; }
        .pl-topbar .pl-spacer { flex: 1; }
        .pl-toggle {
            display: inline-flex; align-items: center; gap: 6px; cursor: pointer;
            font-size: 0.88rem; color: var(--text-secondary);
            user-select: none;
        }
        .pl-toggle input { margin: 0; cursor: pointer; }
        /* Three-way mode segmented control. Mirrors the Cursor segmented
           button look: pill-shaped wrapper, flush buttons, accent
           background on the active segment. */
        .pl-mode-segment {
            display: inline-flex;
            background: var(--bg-card);
            border: 1px solid var(--border);
            border-radius: 999px;
            padding: 2px;
            gap: 0;
        }
        .pl-mode-btn {
            font: inherit;
            font-size: 0.82rem;
            color: var(--text-secondary);
            background: transparent;
            border: none;
            padding: 4px 12px;
            border-radius: 999px;
            cursor: pointer;
            white-space: nowrap;
        }
        .pl-mode-btn:hover { color: var(--text); }
        .pl-mode-btn.pl-mode-active {
            background: var(--accent);
            color: var(--bg);
            font-weight: 600;
        }
        .pl-mode-btn.pl-mode-active:hover { color: var(--bg); }
        .pl-actions { display: flex; gap: 8px; }
        .pl-btn {
            background: var(--bg-card);
            border: 1px solid var(--border);
            color: var(--text);
            padding: 5px 12px;
            border-radius: var(--radius-sm);
            font-size: 0.85rem;
            cursor: pointer;
            font-family: inherit;
        }
        .pl-btn:hover { background: var(--bg-card-hover); border-color: var(--border-hover); }
        .pl-btn:disabled,
        .pl-btn[disabled] {
            opacity: 0.45;
            cursor: not-allowed;
            background: var(--bg-card);
        }
        .pl-btn:disabled:hover,
        .pl-btn[disabled]:hover {
            background: var(--bg-card);
            border-color: var(--border);
        }

        .pl-body {
            flex: 1;
            overflow: hidden;
            display: flex;
            min-height: 0;
        }
        .pl-tree-pane {
            flex: 2;
            position: relative;
            overflow: hidden;
            background: var(--bg);
            min-width: 0;
            cursor: grab;
            user-select: none;
        }
        .pl-tree-pane.dragging { cursor: grabbing; }
        .pl-viewport {
            position: absolute; top: 0; left: 0;
            transform-origin: 0 0;
            will-change: transform;
            padding: 24px;
        }
        .pl-flow {
            display: flex; flex-direction: column;
            gap: 56px;
            position: relative;
            align-items: flex-start;
        }
        .pl-tier {
            display: flex; flex-direction: row;
            gap: 28px;
            align-items: flex-start;
        }
        .pl-edges-svg {
            position: absolute; top: 0; left: 0;
            pointer-events: none; overflow: visible;
            color: var(--text-dim, #888);
            z-index: 0;
        }
        .pl-edges-svg path {
            fill: none; stroke: currentColor; stroke-width: 1.4;
            opacity: 0.55;
        }
        .pl-edges-svg path.pl-edge-active {
            stroke: var(--accent);
            stroke-width: 2;
            opacity: 0.9;
        }
        .pl-edges-svg path.pl-edge-zero {
            stroke-dasharray: 4 4;
            opacity: 0.3;
        }
        .pl-help-overlay {
            position: absolute; bottom: 12px; left: 12px;
            z-index: 5;
            color: var(--text-dim);
            font-size: 0.78rem;
            line-height: 1.4;
            pointer-events: none;
            max-width: 540px;
            background: var(--bg-surface);
            border: 1px solid var(--border);
            border-radius: var(--radius-sm);
            padding: 6px 10px;
            opacity: 0.85;
        }
        .pl-canvas-tools {
            position: absolute; top: 12px; right: 12px;
            z-index: 5;
            display: flex; gap: 6px;
        }
        .pl-canvas-tools .pl-btn { font-size: 0.78rem; padding: 4px 9px; }
        .pl-summary-pane {
            flex: 1;
            border-left: 1px solid var(--border);
            background: var(--bg-surface);
            overflow: auto;
            padding: 18px;
            min-width: 280px;
        }
        /* Questions-only mode: vertical scrolling list of one card per
           question. Lives inside the same .pl-tree-pane as the canvas
           but is the only visible body when stored.mode === 'questions'.
           No pan/zoom transform — just normal scrolling. */
        .pl-questions-pane {
            position: absolute; inset: 0;
            overflow: auto;
            padding: 24px;
            display: flex;
            flex-direction: column;
            gap: 12px;
            background: var(--bg);
        }
        .pl-questions-pane[hidden] { display: none; }
        .pl-question-card {
            position: relative;
            box-sizing: border-box;
            max-width: 920px;
            padding: 12px 14px;
            background: var(--bg-card);
            border: 1px solid var(--border);
            border-radius: var(--radius-sm);
        }
        .pl-question-card.pl-target {
            border-color: var(--accent);
            box-shadow: 0 0 0 1px var(--accent), 0 0 12px var(--accent-glow);
        }
        @media (max-width: 900px) {
            .pl-body { flex-direction: column; }
            .pl-summary-pane {
                border-left: none;
                border-top: 1px solid var(--border);
                min-width: 0;
                flex: 0 0 auto;
                max-height: 50vh;
            }
        }

        /* States — cards on the canvas. Cards have a min-width for
           short questions and can grow horizontally to fit a row of
           option cells. */
        .pl-state {
            position: relative;
            box-sizing: border-box;
            min-width: 280px;
            max-width: 820px;
            flex: 0 0 auto;
            padding: 10px 12px;
            background: var(--bg-card);
            border: 1px solid var(--border);
            border-radius: var(--radius-sm);
            transition: box-shadow 0.15s ease, border-color 0.15s ease;
            z-index: 1;
        }
        .pl-state.pl-target {
            border-color: var(--accent);
            box-shadow: 0 0 0 1px var(--accent), 0 0 12px var(--accent-glow);
        }
        .pl-state.pl-locked { background: var(--bg-surface); }
        .pl-state.pl-outcome {
            background: var(--bg-card-hover);
            border-color: var(--border-hover);
        }
        .pl-state.pl-stuck { border-color: #ff7b7b; }

        .pl-state-head {
            display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap;
            font-size: 0.95rem;
        }
        .pl-state-pbadge {
            font-variant-numeric: tabular-nums;
            font-weight: 600;
            color: var(--accent);
            background: var(--accent-glow);
            padding: 2px 8px;
            border-radius: 4px;
            font-size: 0.85rem;
            min-width: 56px;
            text-align: right;
            flex: 0 0 auto;
        }
        .pl-state-pbadge.pl-pbadge-zero { color: var(--text-dim); background: transparent; }
        .pl-state.pl-outcome .pl-state-pbadge {
            color: var(--accent-2);
            background: rgba(124, 92, 255, 0.12);
        }
        .pl-state-title { color: var(--text); font-weight: 500; line-height: 1.4; flex: 1 1 200px; }
        .pl-state-meta {
            color: var(--text-dim); font-size: 0.78rem; margin-top: 4px;
        }
        .pl-state-tag {
            display: inline-block;
            font-size: 0.68rem;
            text-transform: uppercase;
            letter-spacing: 0.08em;
            padding: 2px 7px;
            border-radius: 3px;
            background: var(--border);
            color: var(--text-secondary);
            font-weight: 600;
            /* Always pinned to the right edge of the head row, even
               when the title is short. Don't wrap mid-tag. */
            margin-left: auto;
            white-space: nowrap;
            flex: 0 0 auto;
        }
        .pl-state-tag.pl-tag-unsettled { background: rgba(124, 92, 255, 0.18); color: var(--accent-2); }
        .pl-state-tag.pl-tag-locked    { background: var(--accent-glow); color: var(--accent); }
        .pl-state-tag.pl-tag-stuck     { background: rgba(255, 123, 123, 0.18); color: #ff7b7b; }
        /* Forced-outcome tag: this question's reachable outcomes
           collapse to one. Uses the outcome accent so it reads as
           "this branch is determined." */
        .pl-state-tag.pl-tag-forced {
            background: rgba(124, 92, 255, 0.18);
            color: var(--accent-2);
            text-transform: none;
            letter-spacing: 0;
            font-size: 0.74rem;
            max-width: 220px;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        /* Partial unsettled (some weights set, some not). Slightly
           dimmer so it's distinguishable at a glance from a fully
           unset card at "100% open". */
        .pl-state-tag.pl-tag-unsettled.pl-tag-partial {
            background: rgba(124, 92, 255, 0.10);
        }
        /* Forced-outcome card: a question card whose subtree only
           leads to one outcome. Borders + outcome-card visual cues
           reuse open-state styles. */
        .pl-state.pl-forced-outcome {
            background: var(--bg-card-hover);
            border-color: var(--border-hover);
        }
        .pl-state-forced-actions {
            margin-top: 8px;
            display: flex;
            gap: 8px;
            flex-wrap: wrap;
        }
        .pl-state-forced-btn {
            font: inherit;
            font-size: 0.74rem;
            padding: 3px 8px;
            border: 1px solid var(--border);
            background: transparent;
            color: var(--text-secondary);
            border-radius: 3px;
            cursor: pointer;
        }
        .pl-state-forced-btn:hover {
            color: var(--text);
            border-color: var(--border-hover);
            background: var(--bg-card);
        }
        /* Loading pill in the topbar while reach binaries fetch. */
        .pl-reach-status {
            font-size: 0.78rem;
            color: var(--text-dim);
            padding: 4px 10px;
            border-radius: 3px;
            background: var(--bg-card);
            border: 1px solid var(--border);
            font-variant-numeric: tabular-nums;
        }
        .pl-reach-status.pl-reach-loaded {
            color: var(--accent-2);
            border-color: rgba(124, 92, 255, 0.35);
        }
        .pl-reach-status.pl-reach-error {
            color: #ff7b7b;
            border-color: rgba(255, 123, 123, 0.45);
        }

        /* Question options laid out horizontally — one cell per
           answer edge. Each cell is the SVG anchor the arrow leaves
           from, so its position must be measurable independently of
           the card. */
        .pl-edges {
            margin-top: 10px;
            display: flex;
            flex-direction: row;
            gap: 8px;
            align-items: stretch;
        }
        .pl-edge-cell {
            position: relative;
            display: flex;
            flex-direction: column;
            align-items: stretch;
            gap: 6px;
            flex: 1 1 130px;
            min-width: 110px;
            padding: 7px 8px 6px;
            border: 1px solid var(--border);
            border-radius: 4px;
            background: var(--bg-surface);
        }
        .pl-edge-cell.pl-edge-cell-active { border-color: var(--accent); }
        .pl-edge-cell.pl-edge-cell-zero   { opacity: 0.55; }
        .pl-edge-cell-w {
            display: flex; align-items: center; justify-content: center;
            gap: 3px;
        }
        .pl-edge-w {
            width: 56px;
            background: var(--bg);
            border: 1px solid var(--border);
            color: var(--text);
            border-radius: 4px;
            padding: 3px 6px;
            font-family: inherit;
            font-size: 0.85rem;
            font-variant-numeric: tabular-nums;
            text-align: right;
            -moz-appearance: textfield;
        }
        .pl-edge-w::-webkit-outer-spin-button,
        .pl-edge-w::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
        .pl-edge-w:focus { outline: none; border-color: var(--accent); }
        .pl-edge-w.pl-edge-w-auto {
            background: var(--accent-glow);
            border-color: var(--accent);
            color: var(--accent);
            font-style: italic;
        }
        .pl-edge-w-suffix { color: var(--text-dim); font-size: 0.78rem; }
        .pl-edge-label {
            color: var(--text); line-height: 1.3;
            font-size: 0.83rem;
            text-align: center;
            flex: 1;
        }
        .pl-edge-label .pl-edge-id {
            color: var(--text-dim); font-size: 0.7rem;
            display: block;
            margin-top: 2px;
        }
        .pl-edge-label .pl-edge-auto-tag {
            color: var(--accent);
            background: var(--accent-glow);
            padding: 1px 5px;
            border-radius: 3px;
            text-transform: uppercase;
            letter-spacing: 0.06em;
            font-size: 0.62rem;
            font-weight: 600;
            margin-left: 4px;
            display: inline-block;
        }
        .pl-edge-cp {
            text-align: center;
            color: var(--text-dim);
            font-variant-numeric: tabular-nums;
            font-size: 0.78rem;
            min-height: 0.95em;
        }
        .pl-edge-cp.pl-edge-cp-active { color: var(--accent); }

        .pl-state-outcome-mood   { color: var(--text-dim); font-size: 0.82rem; margin-top: 4px; }
        .pl-state-outcome-summary{ color: var(--text-secondary); font-size: 0.85rem; margin-top: 6px; line-height: 1.45; }


        /* Summary */
        .pl-summary-pane h2 {
            font-size: 0.95rem; font-weight: 600; margin: 0 0 8px 0; color: var(--text);
            letter-spacing: -0.01em;
        }
        .pl-summary-pane section { margin-bottom: 22px; }
        .pl-row {
            display: flex; align-items: baseline; justify-content: space-between;
            padding: 6px 8px; gap: 10px;
            border-bottom: 1px solid var(--border);
            font-size: 0.88rem;
        }
        .pl-row:last-child { border-bottom: none; }
        .pl-row-label { color: var(--text-secondary); flex: 1; line-height: 1.35; }
        .pl-row-pct {
            font-variant-numeric: tabular-nums; font-weight: 500;
            min-width: 60px; text-align: right; color: var(--text);
        }
        .pl-row.pl-row-frontier { cursor: pointer; }
        .pl-row.pl-row-frontier:hover { background: var(--bg-card-hover); }
        .pl-row-empty { color: var(--text-dim); font-style: italic; padding: 6px 8px; font-size: 0.85rem; }
    `;

    function injectCss() {
        if (document.getElementById('path-likelihoods-css')) return;
        const s = document.createElement('style');
        s.id = 'path-likelihoods-css';
        s.textContent = CSS;
        document.head.appendChild(s);
    }

    // ────────────────────────────────────────────────────────────────
    // Outcome template loading. nodes.js does its own load too — even
    // though index.html's loadData() runs first, keeping it self-
    // contained means this file is independently testable and resilient
    // to future load-order shuffles.
    // ────────────────────────────────────────────────────────────────
    let templates = [];
    let templatesLoaded = false;
    async function ensureLoaded() {
        if (templatesLoaded) return;
        const bust = '?v=' + Date.now();
        const o = await fetch('data/outcomes.json' + bust).then(r => r.json());
        templates = o.templates || [];
        templatesLoaded = true;
    }

    // ────────────────────────────────────────────────────────────────
    // Reach precompute loading.
    //
    // Lazy-loads every per-outcome reach binary from data/reach/ and
    // builds a per-outcome `couldReach(slotKey, sel)` checker via the
    // same ReachChecker pipeline the runtime uses for locked-mode.
    //
    // Used by buildGraph to detect "this question's enabled edges all
    // funnel into the same outcome" — when exactly one outcome is
    // reachable from a question state, we collapse it into a
    // 'forced-outcome' card so the user doesn't have to assign weights
    // they can't influence.
    //
    // Sized for the manifest currently shipped: 28 outcomes, 3.1 MB
    // gzipped total. Fetched in parallel; first-paint is unblocked
    // (the page renders without collapse) and a rebuild fires once
    // every binary has decoded.
    // ────────────────────────────────────────────────────────────────
    const reachCheckers = new Map(); // entryId → outcome checker
    let reachLoadPromise = null;
    let reachLoadState = 'idle'; // 'idle' | 'loading' | 'loaded' | 'unsupported' | 'error'
    let reachLoadError = null;

    async function ensureReachCheckersLoaded() {
        if (reachLoadState === 'loaded' || reachLoadState === 'unsupported'
                || reachLoadState === 'error') return reachLoadPromise;
        if (reachLoadPromise) return reachLoadPromise;

        // Hard prerequisites for the runtime checker pipeline. Older
        // browsers without DecompressionStream degrade gracefully:
        // the page still works, no auto-collapse happens.
        if (typeof DecompressionStream === 'undefined'
                || !window.ExploreCache || !window.ReachChecker) {
            reachLoadState = 'unsupported';
            return null;
        }

        reachLoadState = 'loading';
        reachLoadPromise = (async () => {
            const manifest = await fetch('data/reach/_manifest.json?v=' + Date.now())
                .then(r => { if (!r.ok) throw new Error('manifest ' + r.status); return r.json(); });
            const entries = (manifest && manifest.entries) || [];

            const FLOW_DAG = window.Nodes && window.Nodes.FLOW_DAG;
            const MODULES = window.Engine.MODULES;
            if (!FLOW_DAG) throw new Error('Nodes.FLOW_DAG not available');

            // Templates may not be loaded yet if this is racing against
            // the outcomes fetch in render(). Wait for them — the
            // outcome checker needs the matching template object.
            await ensureLoaded();
            const tplById = new Map();
            for (const t of templates) tplById.set(t.id, t);

            await Promise.all(entries.map(async (e) => {
                try {
                    const r = await fetch('data/reach/'
                        + encodeURIComponent(e.id) + '.bin.gz');
                    if (!r.ok) throw new Error('fetch ' + r.status + ' for ' + e.id);
                    const buf = await new Response(
                        r.body.pipeThrough(new DecompressionStream('gzip'))
                    ).arrayBuffer();
                    const view = window.ExploreCache.openOutcomeFromBuffer(buf);
                    const idx = window.ReachChecker.buildOutcomeIndexFromView({
                        outcomeView: view, MODULES, FLOW_DAG,
                    });
                    const template = tplById.get(view.templateId);
                    if (!template) {
                        // The reach binary's template isn't in
                        // outcomes.json — surface but don't crash the
                        // load, the rest of the checkers still help.
                        console.warn('reach: missing template for', e.id, view.templateId);
                        return;
                    }
                    const checker = window.ReachChecker.createOutcomeChecker(idx, {
                        GraphIO: window.GraphIO,
                        Engine:  window.Engine,
                        template,
                    });
                    // Decorate so reachableOutcomesFromAction can build
                    // a card-friendly outcome shape without re-reading
                    // the binary.
                    checker._entryId    = e.id;
                    checker._template   = template;
                    checker._variantKey = view.variantKey || null;
                    reachCheckers.set(e.id, checker);
                } catch (err) {
                    console.warn('reach: failed to load', e.id, err);
                }
            }));

            reachLoadState = 'loaded';
        })().catch(err => {
            reachLoadError = err;
            reachLoadState = 'error';
            console.warn('Failed to load reach precompute', err);
        });

        return reachLoadPromise;
    }

    // Returns array of { entryId, template, variantKey } for every
    // outcome reachable from the given question action's enabled
    // edges. Returns null when reach data isn't loaded yet (signals
    // "skip auto-collapse for now").
    function reachableOutcomesFromAction(action, slotKey, sel) {
        if (reachLoadState !== 'loaded') return null;
        if (reachCheckers.size === 0) return null;
        if (!action || action.kind !== 'question') return null;
        if (!Array.isArray(action.enabled) || action.enabled.length === 0) return null;

        const Engine = window.Engine;
        const childSels = action.enabled.map(edge =>
            window.WalkStep.lightPushSel(sel, action.node, edge, { Engine }));

        const reachable = [];
        for (const checker of reachCheckers.values()) {
            // OR over enabled edges. Fresh memo per checker per call —
            // each checker has a distinct per-outcome reach set, so
            // memos can't be reused across them.
            let hit = false;
            const dfsMemo = new Map();
            for (const child of childSels) {
                if (checker.couldReach(slotKey, child, { dfsMemo })) {
                    hit = true; break;
                }
            }
            if (hit) {
                reachable.push({
                    entryId:    checker._entryId,
                    template:   checker._template,
                    variantKey: checker._variantKey,
                });
            }
        }
        return reachable;
    }

    // Build an outcome record matching findOutcome()'s shape from a
    // (template, variantKey) pair, so forced-outcome states can share
    // the same downstream rendering / summary code as 'open' states.
    function outcomeFromTemplate(template, variantKey) {
        if (!template) return null;
        let variant = null;
        if (variantKey && template.variants) {
            variant = template.variants[variantKey] || null;
        }
        return {
            templateId: template.id,
            variantKey: variantKey || null,
            title:    template.title,
            subtitle: (variant && variant.subtitle) || template.subtitle || null,
            mood:     (variant && variant.mood)     || template.mood     || 'mixed',
            summary:  (variant && variant.summary)  || template.summary  || '',
        };
    }

    // ────────────────────────────────────────────────────────────────
    // Persistence
    //   `weights.sel`      — { [stateKey]: { [edgeKey]: 0..100 } }
    //                        keyed by selKey(sel)         (DAG mode)
    //   `weights.path`     — keyed by serialized stack    (per-path mode)
    //   `weights.question` — keyed by question node.id    (questions-only
    //                        mode). One global distribution per question,
    //                        applied wherever the question is reached.
    //   `autoFilled.*`     — { [weightKey]: edgeKey } — which edge
    //                        currently holds the auto-computed remainder
    //                        for that key. Cleared when the user types a
    //                        value directly into that box.
    //   `expandAnyway.*`   — { [weightKey]: true } states the user
    //                        explicitly opted to expand even though
    //                        reach precompute says only one outcome
    //                        is reachable.
    // We keep all three sets independently so flipping modes doesn't
    // discard input from the others.
    // ────────────────────────────────────────────────────────────────
    function defaultStored() {
        return {
            _v: VERSION,
            mode: 'questions',
            weights:      { sel: {}, path: {}, question: {} },
            autoFilled:   { sel: {}, path: {}, question: {} },
            expandAnyway: { sel: {}, path: {}, question: {} },
        };
    }
    function loadStored() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return defaultStored();
            const v = JSON.parse(raw);
            if (!v) return defaultStored();
            // v2 → v3 migration: derive `mode` from the old boolean
            // `pathDependent` flag and seed an empty question bag.
            // User weights in `weights.sel` / `weights.path` carry over
            // unchanged, so flipping back to one of the full-state
            // modes restores their input.
            if (v._v === 2) {
                return {
                    _v: VERSION,
                    mode: v.pathDependent ? 'path' : 'sel',
                    weights: {
                        sel:      (v.weights && v.weights.sel)      || {},
                        path:     (v.weights && v.weights.path)     || {},
                        question: {},
                    },
                    autoFilled: {
                        sel:      (v.autoFilled && v.autoFilled.sel)      || {},
                        path:     (v.autoFilled && v.autoFilled.path)     || {},
                        question: {},
                    },
                    expandAnyway: {
                        sel:      (v.expandAnyway && v.expandAnyway.sel)      || {},
                        path:     (v.expandAnyway && v.expandAnyway.path)     || {},
                        question: {},
                    },
                };
            }
            if (v._v !== VERSION) return defaultStored();
            const mode = VALID_MODES.includes(v.mode) ? v.mode : 'questions';
            return {
                _v: VERSION,
                mode,
                weights: {
                    sel:      (v.weights && v.weights.sel)      || {},
                    path:     (v.weights && v.weights.path)     || {},
                    question: (v.weights && v.weights.question) || {},
                },
                autoFilled: {
                    sel:      (v.autoFilled && v.autoFilled.sel)      || {},
                    path:     (v.autoFilled && v.autoFilled.path)     || {},
                    question: (v.autoFilled && v.autoFilled.question) || {},
                },
                expandAnyway: {
                    sel:      (v.expandAnyway && v.expandAnyway.sel)      || {},
                    path:     (v.expandAnyway && v.expandAnyway.path)     || {},
                    question: (v.expandAnyway && v.expandAnyway.question) || {},
                },
            };
        } catch (_e) {
            return defaultStored();
        }
    }
    function saveStored(stored) {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(stored)); } catch (_e) {}
    }

    // The active weight bag depends on the mode. In 'questions' mode it
    // lives under `.question` and is keyed by question node.id; the two
    // full-state modes are keyed by stateKey.
    function bagFor(stored) {
        if (stored.mode === 'questions') return stored.weights.question;
        if (stored.mode === 'path')      return stored.weights.path;
        return stored.weights.sel;
    }
    function autoBagFor(stored) {
        if (stored.mode === 'questions') return stored.autoFilled.question;
        if (stored.mode === 'path')      return stored.autoFilled.path;
        return stored.autoFilled.sel;
    }
    function expandBagFor(stored) {
        if (stored.mode === 'questions') return stored.expandAnyway.question;
        if (stored.mode === 'path')      return stored.expandAnyway.path;
        return stored.expandAnyway.sel;
    }
    // weightKeyOf — the per-mode lookup key for a state's weight bag.
    // In 'questions' mode every state with the same node.id shares
    // one global distribution. In the full-state modes weights are
    // keyed by the (already mode-aware) state key.
    function weightKeyOf(entry, mode) {
        if (!entry) return null;
        if (mode === 'questions') return entry.nodeId || null;
        return entry.key;
    }
    function weightsFor(entry, stored) {
        const k = weightKeyOf(entry, stored.mode);
        if (!k) return null;
        return bagFor(stored)[k] || null;
    }
    function autoFilledEdgeFor(entry, stored) {
        const k = weightKeyOf(entry, stored.mode);
        if (!k) return null;
        return autoBagFor(stored)[k] || null;
    }
    function isExpandAnyway(entry, stored) {
        const k = weightKeyOf(entry, stored.mode);
        if (!k) return false;
        return !!expandBagFor(stored)[k];
    }
    function setExpandAnyway(entry, stored, value) {
        const k = weightKeyOf(entry, stored.mode);
        if (!k) return;
        const bag = expandBagFor(stored);
        if (value) bag[k] = true;
        else       delete bag[k];
    }
    // setWeight stores any non-null numeric (including 0). Passing
    // value === null is the only way to "unset" a box back to the
    // empty / placeholder state, so callers must distinguish:
    //   * cleared input  → null  (unset, eligible for auto-fill)
    //   * typed "0"      → 0     (explicit user value, contributes
    //                              its remainder to unsettled)
    function setWeight(entry, ek, value, stored) {
        const k = weightKeyOf(entry, stored.mode);
        if (!k) return;
        const bag = bagFor(stored);
        if (value === null || value === undefined) {
            if (bag[k]) {
                delete bag[k][ek];
                if (Object.keys(bag[k]).length === 0) delete bag[k];
            }
            return;
        }
        if (!bag[k]) bag[k] = {};
        bag[k][ek] = value;
    }
    function clearWeights(stored) {
        const bag = bagFor(stored);
        const auto = autoBagFor(stored);
        const exp = expandBagFor(stored);
        for (const k of Object.keys(bag))  delete bag[k];
        for (const k of Object.keys(auto)) delete auto[k];
        for (const k of Object.keys(exp))  delete exp[k];
    }

    // applyAutoFill — keeps a single "remainder" box auto-balanced so the
    // user-set values plus the auto-filled value sum to 100 whenever
    // exactly N-1 of the N enabled edges have user-typed weights. Called
    // after every user-driven weight change.
    //
    // Behaviour:
    //   * If the user just edited the previously auto-filled box, that
    //     box is now considered user-set (the auto flag is cleared).
    //   * If exactly N-1 boxes are user-set and the sum is < 100, the
    //     remaining box gets `100 - sum` and is flagged as auto.
    //   * If a previously auto-filled box exists and the user changed
    //     another box, the auto-filled value is recomputed.
    //   * If user-set values now sum to ≥ 100, the auto-filled box is
    //     cleared (no negative remainder).
    function applyAutoFill(state, justEditedEK, stored) {
        if (!state || state.classification !== 'question') return;
        const wk = weightKeyOf(state, stored.mode);
        if (!wk) return;
        const enabledEKs = state.enabledEdges.map(e => edgeKey(e.nodeId, e.edgeId));
        if (enabledEKs.length < 2) return;

        const bag = bagFor(stored);
        const autoBag = autoBagFor(stored);

        // The box the user just edited can no longer be the system's
        // remainder slot — even if they typed the same value back in.
        if (autoBag[wk] === justEditedEK) {
            delete autoBag[wk];
        }

        const currentAuto = autoBag[wk] || null;
        const w = bag[wk] || {};

        // Boxes the user has set explicitly (everything except the auto
        // slot). Includes 0 — typing "0" is a deliberate value, not an
        // empty box, and shouldn't trigger auto-fill.
        const userSetEKs = enabledEKs.filter(e => e !== currentAuto && w[e] != null);
        const userSum = userSetEKs.reduce((s, e) => s + (w[e] || 0), 0);

        if (userSetEKs.length !== enabledEKs.length - 1) {
            // Either < N-1 (need more user input) or all N user-set.
            // In the all-N case, clear any stale auto flag.
            if (currentAuto && userSetEKs.length === enabledEKs.length) {
                delete autoBag[wk];
            }
            return;
        }

        // Pick the slot that gets the remainder: keep the existing auto
        // box, or fall back to the (single) genuinely unset box (`null`,
        // not 0 — explicit 0 is user-set).
        let targetEK = currentAuto;
        if (!targetEK) targetEK = enabledEKs.find(e => w[e] == null);
        if (!targetEK) return;

        const remainder = 100 - userSum;
        if (remainder > 0) {
            if (!bag[wk]) bag[wk] = {};
            bag[wk][targetEK] = remainder;
            autoBag[wk] = targetEK;
        } else {
            // User-set values fill or overflow the budget; nothing left
            // for the auto slot.
            if (bag[wk]) {
                delete bag[wk][targetEK];
                if (Object.keys(bag[wk]).length === 0) delete bag[wk];
            }
            delete autoBag[wk];
        }
    }

    // ────────────────────────────────────────────────────────────────
    // Key helpers
    // ────────────────────────────────────────────────────────────────
    function selKeyOf(sel) { return window.SelKey.selKey(sel); }
    function stackPathKey(stack) {
        // Skip the leading sentinel (nodeId === null) added by createStack.
        return stack.filter(e => e.nodeId).map(e => e.nodeId + ':' + e.edgeId).join('|');
    }
    function stateKeyOf(stack, sel, mode) {
        // 'path' mode keeps a per-stack tree (visiting the same sel via
        // a different stack yields a distinct entry); 'sel' and
        // 'questions' modes both DAG-dedupe by selKey. The 'q|' prefix
        // is just bookkeeping — the questions-mode weight bag is
        // keyed by node.id, not by stateKey.
        if (mode === 'path') return 'p|' + stackPathKey(stack) + '#' + selKeyOf(sel);
        if (mode === 'questions') return 'q|' + selKeyOf(sel);
        return 's|' + selKeyOf(sel);
    }
    function edgeKey(nodeId, edgeId) { return nodeId + ':' + edgeId; }

    // ────────────────────────────────────────────────────────────────
    // Graph builder
    //
    // States are records keyed by stateKeyOf. Each record:
    //   {
    //     key, sel, stack,                  // canonical stack — first observed.
    //     classification: 'question' | 'auto-locked' | 'open' | 'stuck' | 'unknown-flow',
    //     parents: [{parentKey, edgeKey}],  // multiple in DAG mode.
    //     children: Map<edgeKey, childKey>, // expanded outgoing edges only.
    //     enabledEdges: [{nodeId, edgeId, edge}],  // for 'question' rows.
    //     nodeId, forcedEdgeId,             // 'question' / 'auto-locked' bookkeeping.
    //     outcome,                          // 'open' rows: matched template.
    //     p,                                // propagated probability (filled later).
    //   }
    //
    // Children are only created for edges with a positive user-stored
    // weight (or for the single forced edge of an auto-locked state).
    // Question states with no stored weights end up as leaves in the
    // built graph, which is exactly the "unsettled frontier" — those
    // are the states the user hasn't decided on yet.
    // ────────────────────────────────────────────────────────────────
    function buildGraph(stored) {
        const Engine = window.Engine;
        const states = new Map();
        const rootStack = Engine.createStack();
        const rootSel   = Engine.currentState(rootStack);
        const rootKey   = stateKeyOf(rootStack, rootSel, stored.mode);

        function visit(stack, sel, key, parentEdge) {
            let entry = states.get(key);
            if (!entry) {
                entry = createEntry(stack, sel, key);
                states.set(key, entry);
            }
            if (parentEdge) entry.parents.push(parentEdge);
            // Convergent re-visit: another path reached this canonical
            // state. Children are already pinned to the first-seen
            // canonical stack — just register the parent and stop.
            if (entry._expanded) return;
            entry._expanded = true;
            expandChildren(entry);
        }

        function createEntry(stack, sel, key) {
            const action = window.WalkStep.nextAction(stack, {
                Engine, FlowPropagation: window.FlowPropagation,
            });
            const entry = {
                key, sel, stack,
                classification: action.kind,
                parents: [],
                children: new Map(),
                enabledEdges: [],
                nodeId: null,
                forcedEdgeId: null,
                outcome: null,
                // slotKey from FLOW_DAG. Stored on every entry so
                // expandAnyway-toggled re-renders can re-run the
                // reach query without re-walking from the root.
                slotKey: (action.flow && action.flow.slotKey) || null,
                // Reach-precompute–derived fields. Set when this
                // state is forced to a single outcome (regardless of
                // user weights) by the precomputed reachability set.
                forcedByReach: false,
                forcedReachableCount: null,
                p: 0,
            };
            if (action.kind === 'question') {
                entry.nodeId = action.node.id;
                entry.enabledEdges = (action.enabled || []).map(e => ({
                    nodeId: action.node.id,
                    edgeId: e.id,
                    edge: e,
                }));

                // Reach-based collapse: if the precompute says exactly
                // one outcome can ever follow from here, treat this
                // state as a terminal that lands on that outcome —
                // unless the user has explicitly clicked "Expand
                // anyway" on this state. We always run the reach
                // query (when data is available) so the renderer can
                // know whether to offer the "Auto-collapse" undo
                // button on user-expanded cards.
                const reachable = reachableOutcomesFromAction(action, entry.slotKey, sel);
                if (reachable) {
                    entry.forcedReachableCount = reachable.length;
                    if (reachable.length === 1) {
                        const r = reachable[0];
                        entry.forcedOutcome = outcomeFromTemplate(r.template, r.variantKey);
                        if (!isExpandAnyway(entry, stored)) {
                            entry.classification = 'forced-outcome';
                            entry.outcome = entry.forcedOutcome;
                            entry.forcedByReach = true;
                        }
                    }
                    // reachable.length === 0 would indicate a precompute
                    // soundness gap; it shouldn't happen for a real
                    // question state, but the engine still surfaces it
                    // as a normal multi-outcome question (worst case:
                    // no auto-collapse).
                }
            } else if (action.kind === 'auto-locked') {
                entry.nodeId = action.node.id;
                entry.forcedEdgeId = action.edgeId;
            } else if (action.kind === 'open') {
                entry.outcome = findOutcome(sel);
            }
            // 'stuck' / 'unknown-flow': record the kind and stop.
            return entry;
        }

        function expandChildren(entry) {
            if (entry.classification === 'auto-locked') {
                const newStack = Engine.push(entry.stack, entry.nodeId, entry.forcedEdgeId);
                const newSel   = Engine.currentState(newStack);
                const childKey = stateKeyOf(newStack, newSel, stored.mode);
                const ek = edgeKey(entry.nodeId, entry.forcedEdgeId);
                entry.children.set(ek, childKey);
                visit(newStack, newSel, childKey, { parentKey: entry.key, edgeKey: ek });
                return;
            }
            if (entry.classification !== 'question') return;
            // Look up by entry so 'questions' mode shares one bag entry
            // across every state with the same node.id.
            const w = weightsFor(entry, stored);
            if (!w) return;
            // Effective weight = w[e] / sum(w). State counts as
            // "answered" iff the sum is positive.
            let sum = 0;
            for (const v of Object.values(w)) sum += (v > 0 ? v : 0);
            if (sum <= 0) return;
            for (const e of entry.enabledEdges) {
                const ek = edgeKey(e.nodeId, e.edgeId);
                if (!(w[ek] > 0)) continue;
                const newStack = Engine.push(entry.stack, e.nodeId, e.edgeId);
                const newSel   = Engine.currentState(newStack);
                const childKey = stateKeyOf(newStack, newSel, stored.mode);
                entry.children.set(ek, childKey);
                visit(newStack, newSel, childKey, { parentKey: entry.key, edgeKey: ek });
            }
        }

        visit(rootStack, rootSel, rootKey, null);
        return { states, rootKey };
    }

    function findOutcome(sel) {
        for (const t of templates) {
            if (window.Engine.templateMatches(t, sel)) {
                let variantKey = null, variant = null;
                if (t.primaryDimension && t.variants) {
                    variantKey = sel[t.primaryDimension] || null;
                    variant = (variantKey && t.variants[variantKey]) || null;
                }
                return {
                    templateId: t.id,
                    variantKey,
                    title:    t.title,
                    subtitle: (variant && variant.subtitle) || t.subtitle || null,
                    mood:     (variant && variant.mood)     || t.mood     || 'mixed',
                    summary:  (variant && variant.summary)  || t.summary  || '',
                };
            }
        }
        return null;
    }

    // ────────────────────────────────────────────────────────────────
    // Probability propagation — Kahn-style topological sort over the
    // built DAG.
    //
    // Weights are interpreted as LITERAL percentages of the parent's
    // P, not relative shares: a single 10% input sends 10% of the
    // parent's P to that child and leaves 90% in the parent as
    // "unsettled at this question". The denominator is
    //
    //   denom = max(Σw, 100)
    //
    // so a fully-allocated card (Σw = 100) sends all of P to children,
    // a partial card (Σw < 100) only sends Σw% and donates the rest
    // to the unsettled total, and an over-allocated card (Σw > 100)
    // is normalized down to conserve probability mass.
    //
    // Auto-locked states still pass their full P to their single
    // forced child. Convergent children sum contributions from every
    // parent. Root P = 1 and the invariant
    //
    //   Σ P(open) + Σ unsettled + Σ P(stuck) ≈ 1
    //
    // holds within float tolerance.
    // ────────────────────────────────────────────────────────────────
    function recomputeP(graph, stored) {
        for (const s of graph.states.values()) s.p = 0;
        const root = graph.states.get(graph.rootKey);
        if (!root) return;
        root.p = 1;

        const indeg = new Map();
        for (const s of graph.states.values()) indeg.set(s.key, s.parents.length);
        const ready = [];
        for (const [k, n] of indeg.entries()) if (n === 0) ready.push(k);

        while (ready.length) {
            const k = ready.shift();
            const s = graph.states.get(k);

            if (s.classification === 'auto-locked') {
                for (const childKey of s.children.values()) {
                    const c = graph.states.get(childKey);
                    if (c) c.p += s.p;
                }
            } else if (s.classification === 'question') {
                const w = weightsFor(s, stored);
                if (w) {
                    let sum = 0;
                    for (const v of Object.values(w)) sum += (v > 0 ? v : 0);
                    if (sum > 0) {
                        const denom = Math.max(sum, 100);
                        for (const [ek, childKey] of s.children.entries()) {
                            const wv = w[ek];
                            if (!(wv > 0)) continue;
                            const c = graph.states.get(childKey);
                            if (c) c.p += s.p * (wv / denom);
                        }
                    }
                }
            }

            for (const childKey of s.children.values()) {
                const cn = indeg.get(childKey);
                if (cn == null) continue;
                indeg.set(childKey, cn - 1);
                if (cn - 1 === 0) ready.push(childKey);
            }
        }
    }

    // computeTotals — buckets the propagated P into three sums whose
    // total is ~1 (root P). A question state contributes its unassigned
    // share to `unsettled` even if it has *some* weights (the user
    // hasn't finished filling the card).
    function computeTotals(graph, stored) {
        let settled = 0, unsettled = 0, stuck = 0;
        for (const s of graph.states.values()) {
            if (s.p <= 0) continue;
            if (s.classification === 'open' || s.classification === 'forced-outcome') {
                // forced-outcome is a question state whose subtree
                // collapses onto a single reachable outcome — it
                // contributes its full P to the settled bucket.
                settled += s.p;
            } else if (s.classification === 'stuck' || s.classification === 'unknown-flow') {
                stuck += s.p;
            } else if (s.classification === 'question') {
                const w = weightsFor(s, stored);
                let sum = 0;
                if (w) for (const v of Object.values(w)) sum += (v > 0 ? v : 0);
                if (sum <= 0) {
                    unsettled += s.p;
                } else if (sum < 100) {
                    // Partial assignment: the un-allocated share of
                    // this question contributes to the unsettled bucket.
                    unsettled += s.p * (100 - sum) / 100;
                }
                // sum >= 100: fully (or over-) assigned; nothing
                // unsettled at this question — the over-allocation
                // case is normalized away in recomputeP.
            }
        }
        return { settled, unsettled, stuck };
    }

    // ────────────────────────────────────────────────────────────────
    // Formatting helpers
    // ────────────────────────────────────────────────────────────────
    function pct(p) {
        if (p == null || isNaN(p)) return '0%';
        if (p === 0) return '0%';
        if (p < 0.0005) return '<0.1%';
        if (p < 0.01) return (p * 100).toFixed(2) + '%';
        if (p < 0.1)  return (p * 100).toFixed(1) + '%';
        return Math.round(p * 100) + '%';
    }
    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
            { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
        ));
    }
    function findStateEl(treeEl, key) {
        for (const el of treeEl.querySelectorAll('[data-state-key]')) {
            if (el.dataset.stateKey === key) return el;
        }
        return null;
    }

    // ────────────────────────────────────────────────────────────────
    // Render
    // ────────────────────────────────────────────────────────────────
    async function render(app) {
        injectCss();
        try {
            await ensureLoaded();
        } catch (err) {
            app.innerHTML = '<div class="pl-page"><div class="pl-topbar"><h1>Path Likelihoods</h1></div>'
                + '<div style="padding:18px;color:#ff7b7b">Failed to load outcomes.json: '
                + esc(err && err.message || String(err)) + '</div></div>';
            return;
        }

        const stored = loadStored();

        app.innerHTML = `
            <div class="pl-page">
                <div class="pl-topbar">
                    <h1>Path Likelihoods</h1>
                    <div class="pl-mode-segment" role="radiogroup" aria-label="Mode">
                        <button class="pl-mode-btn" data-mode="questions" type="button" role="radio" aria-checked="false">Questions only</button>
                        <button class="pl-mode-btn" data-mode="sel"       type="button" role="radio" aria-checked="false">Full state (DAG)</button>
                        <button class="pl-mode-btn" data-mode="path"      type="button" role="radio" aria-checked="false">Full state (per path)</button>
                    </div>
                    <div class="pl-totals">
                        <span class="pl-tot pl-tot-settled"><span class="pl-tot-label">Settled</span><span class="pl-tot-val" data-tot="settled">0%</span></span>
                        <span class="pl-tot pl-tot-unsettled"><span class="pl-tot-label">Unsettled</span><span class="pl-tot-val" data-tot="unsettled">0%</span></span>
                        <span class="pl-tot pl-tot-stuck"><span class="pl-tot-label">Stuck</span><span class="pl-tot-val" data-tot="stuck">0%</span></span>
                    </div>
                    <span class="pl-reach-status" data-reach-status></span>
                    <div class="pl-spacer"></div>
                    <div class="pl-actions">
                        <button class="pl-btn" data-action="reset">Reset weights</button>
                        <button class="pl-btn" data-action="back">Back to Map</button>
                    </div>
                </div>
                <div class="pl-body">
                    <div class="pl-tree-pane" data-canvas>
                        <div class="pl-help-overlay" data-help></div>
                        <div class="pl-canvas-tools">
                            <button class="pl-btn" data-action="snap-next" title="Center on the highest-probability unsettled question" disabled>Next</button>
                            <button class="pl-btn" data-action="zoom-fit"  title="Fit to view">Fit</button>
                            <button class="pl-btn" data-action="zoom-1"    title="Reset zoom">1:1</button>
                        </div>
                        <div class="pl-viewport" data-viewport>
                            <svg class="pl-edges-svg" data-edges xmlns="http://www.w3.org/2000/svg">
                                <defs>
                                    <marker id="pl-edge-arrow" viewBox="0 0 10 10" refX="9" refY="5"
                                            markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                                        <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor"/>
                                    </marker>
                                </defs>
                            </svg>
                            <div class="pl-flow" data-flow></div>
                        </div>
                        <div class="pl-questions-pane" data-questions hidden></div>
                    </div>
                    <div class="pl-summary-pane" data-summary></div>
                </div>
            </div>`;

        const canvasEl     = app.querySelector('[data-canvas]');
        const viewportEl   = app.querySelector('[data-viewport]');
        const flowEl       = app.querySelector('[data-flow]');
        const edgesSvg     = app.querySelector('[data-edges]');
        const helpEl       = app.querySelector('[data-help]');
        const summaryEl    = app.querySelector('[data-summary]');
        const questionsEl  = app.querySelector('[data-questions]');
        const modeBtns     = Array.from(app.querySelectorAll('.pl-mode-btn'));

        helpEl.textContent = 'Each input is the literal % of the parent\u2019s P that flows down that branch. '
            + 'Anything you haven\u2019t assigned (sum < 100) stays in the unsettled total. '
            + 'When N\u20131 boxes are filled, the last auto-fills with the remainder. '
            + 'Questions whose subtree only leads to one outcome auto-collapse to that outcome (override per-card with \u201cExpand anyway\u201d). '
            + 'Drag to pan, scroll to zoom.';

        const reachStatusEl = app.querySelector('[data-reach-status]');
        function paintReachStatus() {
            if (!reachStatusEl) return;
            reachStatusEl.classList.remove('pl-reach-loaded', 'pl-reach-error');
            if (reachLoadState === 'idle' || reachLoadState === 'loading') {
                reachStatusEl.textContent = 'Loading reachability\u2026';
                reachStatusEl.style.display = '';
            } else if (reachLoadState === 'unsupported') {
                // No DecompressionStream / required globals — silently
                // hide the status. Page still works, just no auto-collapse.
                reachStatusEl.style.display = 'none';
            } else if (reachLoadState === 'error') {
                reachStatusEl.classList.add('pl-reach-error');
                reachStatusEl.textContent = 'Reachability unavailable';
                reachStatusEl.style.display = '';
            } else if (reachLoadState === 'loaded') {
                // Count states the precompute auto-collapsed on this
                // build, so the user gets a sense of the impact.
                let collapsed = 0;
                if (graph) {
                    for (const s of graph.states.values()) {
                        if (s.classification === 'forced-outcome') collapsed++;
                    }
                }
                reachStatusEl.classList.add('pl-reach-loaded');
                reachStatusEl.textContent = collapsed > 0
                    ? collapsed + ' auto-collapsed by reach'
                    : 'Reach loaded';
                reachStatusEl.style.display = '';
            }
        }

        // View transform (pan x/y in CSS px in viewport-local space, zoom multiplier).
        const view = { x: 24, y: 24, k: 1 };
        const applyView = () => {
            viewportEl.style.transform =
                'translate(' + view.x + 'px, ' + view.y + 'px) scale(' + view.k + ')';
        };
        applyView();

        // Three-way mode toggle (questions / sel / path). The active
        // button gets `pl-mode-active`; clicking another mode persists
        // and rebuilds. Each mode owns its own weights bag, so flipping
        // doesn't lose input from the others.
        function paintModeButtons() {
            for (const b of modeBtns) {
                const active = b.dataset.mode === stored.mode;
                b.classList.toggle('pl-mode-active', active);
                b.setAttribute('aria-checked', active ? 'true' : 'false');
            }
        }
        paintModeButtons();
        for (const b of modeBtns) {
            b.addEventListener('click', () => {
                if (b.dataset.mode === stored.mode) return;
                stored.mode = b.dataset.mode;
                saveStored(stored);
                paintModeButtons();
                applyModeUI();
                rebuild();
            });
        }
        // Mode-aware UI affordances: the canvas tree pane is only
        // meaningful in the full-state modes; in 'questions' mode we
        // hide the canvas viewport + tools and show the flat list pane
        // instead. Pan/zoom listeners stay attached on canvasEl but
        // are inert when the children are hidden.
        function applyModeUI() {
            const isQuestions = stored.mode === 'questions';
            // Zoom buttons make no sense for the flat list; hide just
            // those, but keep the Next-frontier button visible (it
            // scrolls the list in questions mode).
            const zoomFitBtn = app.querySelector('[data-action="zoom-fit"]');
            const zoom1Btn   = app.querySelector('[data-action="zoom-1"]');
            if (zoomFitBtn) zoomFitBtn.style.display = isQuestions ? 'none' : '';
            if (zoom1Btn)   zoom1Btn.style.display   = isQuestions ? 'none' : '';
            if (viewportEl)    viewportEl.style.display    = isQuestions ? 'none' : '';
            if (helpEl)        helpEl.style.display        = isQuestions ? 'none' : '';
            if (questionsEl)   questionsEl.hidden          = !isQuestions;
            // The grab-cursor signal is misleading on the flat list.
            canvasEl.style.cursor = isQuestions ? 'default' : '';
        }
        applyModeUI();
        app.querySelector('[data-action="reset"]').addEventListener('click', () => {
            const label = stored.mode === 'questions' ? 'questions-only'
                       : stored.mode === 'path'      ? 'per-path'
                       : 'DAG';
            if (!confirm('Clear all weights for the ' + label + ' mode?')) return;
            clearWeights(stored);
            saveStored(stored);
            rebuild();
        });
        app.querySelector('[data-action="back"]').addEventListener('click', () => {
            // Hash-based navigation; index.html's hashchange listener
            // will re-route to the /map screen.
            location.hash = '';
        });
        app.querySelector('[data-action="zoom-fit"]').addEventListener('click', () => fitView());
        app.querySelector('[data-action="zoom-1"]').addEventListener('click', () => {
            view.k = 1; view.x = 24; view.y = 24; applyView();
        });

        // "Next" — pan/zoom to the highest-probability unsettled
        // question so the user knows where to weight next. The target
        // stateKey is updated by paintSummary() (which has already
        // computed the sorted frontier) and the button's disabled
        // state mirrors whether any frontier state exists.
        const snapBtn = app.querySelector('[data-action="snap-next"]');
        let nextFrontierKey = null;
        function setNextFrontierKey(key) {
            nextFrontierKey = key || null;
            if (snapBtn) snapBtn.disabled = !nextFrontierKey;
        }
        snapBtn.addEventListener('click', () => {
            if (!nextFrontierKey) return;
            // Reuse the same code path as clicking a frontier row in
            // the summary pane: refreshes the pl-target highlight and
            // pans the viewport so the card sits in the middle.
            onFrontierClick(nextFrontierKey);
        });

        // ── Pan (drag) ──────────────────────────────────────────────
        let drag = null;
        canvasEl.addEventListener('mousedown', (e) => {
            // Don't start a pan when the click originated inside an
            // interactive element (input, button, anchor, label) — we
            // want those to behave normally.
            if (e.target.closest('input, button, a, select, textarea, label')) return;
            drag = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
            canvasEl.classList.add('dragging');
            e.preventDefault();
        });
        window.addEventListener('mousemove', (e) => {
            if (!drag) return;
            view.x = drag.vx + (e.clientX - drag.x);
            view.y = drag.vy + (e.clientY - drag.y);
            applyView();
        });
        window.addEventListener('mouseup', () => {
            if (!drag) return;
            drag = null;
            canvasEl.classList.remove('dragging');
        });

        // ── Zoom (wheel, anchored on cursor position) ───────────────
        canvasEl.addEventListener('wheel', (e) => {
            e.preventDefault();
            const rect = canvasEl.getBoundingClientRect();
            const cx = e.clientX - rect.left;
            const cy = e.clientY - rect.top;
            // Direction: scrolling up (negative deltaY) zooms in.
            const factor = Math.exp(-e.deltaY * 0.0015);
            const nk = Math.max(0.2, Math.min(2.5, view.k * factor));
            // Keep the canvas-space point under the cursor stationary.
            const sx = (cx - view.x) / view.k;
            const sy = (cy - view.y) / view.k;
            view.x = cx - sx * nk;
            view.y = cy - sy * nk;
            view.k = nk;
            applyView();
        }, { passive: false });

        // Re-fit when the canvas resizes (e.g. summary pane stacking
        // on mobile breakpoint).
        const ro = new ResizeObserver(() => {
            // No-op for now; we don't auto-refit on resize so the
            // user's pan/zoom isn't disturbed. Hook left for future.
        });
        ro.observe(canvasEl);

        function fitView() {
            // Measure the unscaled flow; pick a zoom that fits both
            // dimensions with a small margin, then center it.
            const prevTransform = viewportEl.style.transform;
            viewportEl.style.transform = 'translate(0,0) scale(1)';
            const fr = flowEl.getBoundingClientRect();
            const cr = canvasEl.getBoundingClientRect();
            const w = fr.width, h = fr.height;
            viewportEl.style.transform = prevTransform;
            if (!w || !h) return;
            const margin = 32;
            const kx = (cr.width  - margin * 2) / w;
            const ky = (cr.height - margin * 2) / h;
            view.k = Math.max(0.2, Math.min(2.5, Math.min(kx, ky, 1)));
            view.x = (cr.width  - w * view.k) / 2;
            view.y = margin;
            applyView();
        }

        let graph = buildGraph(stored);

        function rebuild() {
            // Preserve the focused weight input (and its raw in-progress
            // text) across the DOM teardown so that live-typing keeps
            // working — e.g. typing "10." for a decimal would otherwise
            // be normalized back to "10" by the rebuild and the user
            // would lose the '.' before they could type the next digit.
            const focusInfo = captureFocusedWeight();

            graph = buildGraph(stored);
            recomputeP(graph, stored);
            paintTree();
            paintSummary();
            paintTotals();
            paintReachStatus();

            if (focusInfo) restoreFocusedWeight(focusInfo);
        }

        // Kick off the reach-precompute load. We don't await it here —
        // the page renders in degraded mode (no auto-collapse) until
        // the binaries arrive, then we rebuild once. Subsequent route
        // visits hit the in-memory checker cache and skip the rebuild
        // (the initial buildGraph above already used the loaded
        // checkers).
        paintReachStatus();
        const reachWasLoaded = reachLoadState === 'loaded';
        const reachP = ensureReachCheckersLoaded();
        if (!reachWasLoaded && reachP && typeof reachP.then === 'function') {
            reachP.then(() => {
                paintReachStatus();
                if (reachLoadState === 'loaded' && reachCheckers.size > 0) {
                    rebuild();
                }
            });
        }

        function captureFocusedWeight() {
            const a = document.activeElement;
            if (!a || !a.classList || !a.classList.contains('pl-edge-w')) return null;
            const cell = a.closest('[data-edge-anchor]');
            const card = a.closest('[data-state-key]');
            if (!cell || !card) return null;
            return {
                stateKey:   card.dataset.stateKey,
                edgeAnchor: cell.dataset.edgeAnchor,
                rawValue:   a.value,
                selStart:   a.selectionStart,
                selEnd:     a.selectionEnd,
            };
        }

        function restoreFocusedWeight(info) {
            // Match by dataset values rather than building a CSS
            // selector, since stateKey can contain arbitrary characters
            // (including '|' in path-dependent mode and ':' everywhere).
            for (const card of canvasEl.querySelectorAll('[data-state-key]')) {
                if (card.dataset.stateKey !== info.stateKey) continue;
                for (const cell of card.querySelectorAll('[data-edge-anchor]')) {
                    if (cell.dataset.edgeAnchor !== info.edgeAnchor) continue;
                    const input = cell.querySelector('input.pl-edge-w');
                    if (!input) return;
                    // Restore the raw text the user was typing — NOT
                    // the normalized stored value — so partial entries
                    // like "10." survive the rebuild.
                    input.value = info.rawValue;
                    input.focus();
                    try { input.setSelectionRange(info.selStart, info.selEnd); } catch (_e) {}
                    return;
                }
                return;
            }
        }

        function onWeightChange(state, ek, value) {
            // `state` is the live graph entry (carries .key, .nodeId,
            // .enabledEdges, .classification — everything the bag /
            // auto-fill helpers need). In 'questions' mode the bag is
            // keyed by state.nodeId; in the full-state modes by
            // state.key. `weightKeyOf` handles the dispatch.
            if (!state) return;
            setWeight(state, ek, value, stored);
            // Auto-fill the remainder box if the user has now defined
            // exactly N-1 of N enabled edges. The graph is in sync
            // with `stored` from the previous rebuild — the just-edited
            // weight has been applied via setWeight above, but the
            // graph still reflects the prior expansion shape, which is
            // fine because applyAutoFill only inspects the state's
            // enabled-edge list.
            applyAutoFill(state, ek, stored);
            saveStored(stored);
            rebuild();
        }

        function onFrontierClick(target) {
            // In 'questions' mode, `target` is a node.id and we scroll
            // the flat list. In tree modes it's the canonical
            // stateKey and we pan the canvas. Either way we refresh
            // the .pl-target highlight.
            canvasEl.querySelectorAll('.pl-state.pl-target').forEach(el => el.classList.remove('pl-target'));
            if (stored.mode === 'questions') {
                const card = findQuestionCardEl(target);
                if (!card) return;
                card.classList.add('pl-target');
                card.scrollIntoView({ behavior: 'smooth', block: 'center' });
                return;
            }
            const targetEl = findStateEl(canvasEl, target);
            if (!targetEl) return;
            targetEl.classList.add('pl-target');
            centerOnElement(targetEl);
        }

        // Pan the viewport so the given card sits roughly in the middle
        // of the canvas. Coordinates are computed in canvas-local space
        // and then offset by the current zoom.
        function centerOnElement(el) {
            const cr = canvasEl.getBoundingClientRect();
            const er = el.getBoundingClientRect();
            // Card center, expressed in already-transformed canvas
            // coordinates relative to canvasEl's top-left.
            const cx = (er.left - cr.left) + er.width  / 2;
            const cy = (er.top  - cr.top)  + er.height / 2;
            // Shift the pan so that point lands at the canvas center.
            view.x += (cr.width  / 2) - cx;
            view.y += (cr.height / 2) - cy;
            applyView();
        }

        // ── Layout: assign each state to a row by longest-path depth.
        // Returns { rows: state[][], rowOf: Map<key, idx> }.
        function computeRows(graph) {
            const rowOf = new Map();
            const indeg = new Map();
            const childrenOf = new Map();
            for (const [k, s] of graph.states.entries()) {
                indeg.set(k, s.parents.length);
                childrenOf.set(k, Array.from(s.children.values()));
            }
            // Kahn's algo seeded from sources (parents.length === 0).
            // Each child's row is max(parent.row) + 1, so the root is
            // 0 and convergent nodes drop to the longest-path depth.
            const queue = [];
            for (const [k, n] of indeg.entries()) if (n === 0) queue.push(k);
            const order = [];
            while (queue.length) {
                const k = queue.shift();
                const s = graph.states.get(k);
                const parentRows = s.parents.map(p => rowOf.get(p.parentKey)).filter(v => v != null);
                const r = parentRows.length ? Math.max(...parentRows) + 1 : 0;
                rowOf.set(k, r);
                order.push(k);
                for (const ck of childrenOf.get(k) || []) {
                    const next = (indeg.get(ck) || 0) - 1;
                    indeg.set(ck, next);
                    if (next === 0) queue.push(ck);
                }
            }
            // Group by row, preserving discovery order so siblings of a
            // shared parent stay adjacent (buildGraph walks DFS).
            const rows = [];
            for (const k of order) {
                const r = rowOf.get(k);
                while (rows.length <= r) rows.push([]);
                rows[r].push(graph.states.get(k));
            }
            return { rows, rowOf };
        }

        function paintTree() {
            // 'questions' mode skips the canvas tree entirely. The
            // canvas DOM is hidden via applyModeUI(); we still clear
            // the inner containers so old tree DOM doesn't accumulate
            // when the user toggles modes.
            if (stored.mode === 'questions') {
                flowEl.innerHTML = '';
                edgesSvg.innerHTML = '';
                paintQuestionList();
                return;
            }

            flowEl.innerHTML = '';

            const { rows } = computeRows(graph);
            for (const rowStates of rows) {
                const tierEl = document.createElement('div');
                tierEl.className = 'pl-tier';
                for (const s of rowStates) {
                    tierEl.appendChild(renderStateCard(s));
                }
                flowEl.appendChild(tierEl);
            }

            // Draw edges after the next layout pass so card sizes are
            // measurable. requestAnimationFrame is more reliable than
            // measuring synchronously after innerHTML mutation.
            requestAnimationFrame(() => drawEdges());
        }

        // ── Questions-only mode ────────────────────────────────────
        // Static catalogue of every question node defined in the
        // graph. Built once per render() and reused on every rebuild.
        // Order = Engine.NODES definition order (which already follows
        // narrative flow).
        const QUESTION_CATALOGUE = (() => {
            const out = [];
            const seen = new Set();
            for (const node of (window.Engine.NODES || [])) {
                if (!node || seen.has(node.id)) continue;
                if (node.derived) continue;
                if (!Array.isArray(node.edges) || node.edges.length === 0) continue;
                seen.add(node.id);
                out.push(node);
            }
            return out;
        })();

        // For each question node, the list of states in the current
        // graph that reach it (so we can sum p across instances and
        // dedupe by node.id for the flat-list view). Rebuilt on every
        // paintQuestionList() call from the live graph.
        function questionAggregates() {
            const byNode = new Map();
            for (const s of graph.states.values()) {
                if (!s.nodeId) continue;
                if (s.classification !== 'question'
                        && s.classification !== 'forced-outcome') continue;
                let cur = byNode.get(s.nodeId);
                if (!cur) {
                    cur = { nodeId: s.nodeId, p: 0, instances: [], anyQuestion: null };
                    byNode.set(s.nodeId, cur);
                }
                cur.p += (s.p > 0 ? s.p : 0);
                cur.instances.push(s);
                // Prefer a 'question' instance (it has enabledEdges)
                // over a 'forced-outcome' shadow so the card renders
                // with its real options.
                if (!cur.anyQuestion || s.classification === 'question') {
                    cur.anyQuestion = s;
                }
            }
            return byNode;
        }

        function paintQuestionList() {
            questionsEl.innerHTML = '';
            const aggBy = questionAggregates();

            for (const node of QUESTION_CATALOGUE) {
                const agg = aggBy.get(node.id);
                // The graph might never have walked into this question
                // (happens when other answers prune the path). In that
                // case we still show a card so the user can answer it
                // ahead of time — its weights will activate the moment
                // upstream answers permit reaching it.
                const synthetic = !agg ? syntheticQuestionState(node) : null;
                const cardState = agg && agg.anyQuestion ? agg.anyQuestion : synthetic;
                if (!cardState) continue;

                const card = renderQuestionCard(node, cardState, agg);
                questionsEl.appendChild(card);
            }
        }

        // Build a placeholder state record for a question node that
        // doesn't appear in the current graph (e.g. unreachable under
        // current weights). Carries every option of the node so the
        // user can pre-assign weights even before upstream answers
        // make this question reachable.
        function syntheticQuestionState(node) {
            const Engine = window.Engine;
            const stack = Engine.createStack();
            const sel = Engine.currentState(stack);
            return {
                key: 'q-static|' + node.id,
                nodeId: node.id,
                stack,
                sel,
                classification: 'question',
                enabledEdges: allEdgesOf(node),
                children: new Map(),
                parents: [],
                p: 0,
            };
        }

        // The full option list for a question, regardless of any
        // upstream `requires` / `disabledWhen` gating. Questions-only
        // mode shows one card per question and lets the user assign
        // weights to every option — propagation already prunes
        // disabled edges per-state at expansion time, so weights on
        // contextually-disabled options simply don't fire in those
        // contexts and remain harmless.
        function allEdgesOf(node) {
            return (node.edges || []).map(e => ({
                nodeId: node.id, edgeId: e.id, edge: e,
            }));
        }

        function renderQuestionCard(node, cardState, agg) {
            const card = document.createElement('div');
            card.className = 'pl-question-card pl-state pl-question';
            // Use the node.id as both `data-node-id` (so
            // findQuestionCardEl can locate the card) and as the
            // synthetic `data-state-key` for the focus-restore code.
            // node.id is stable across rebuilds even when the graph
            // entry chosen as `cardState` changes (e.g. a new branch
            // becomes reachable mid-typing), so the focused input is
            // reliably found again after rebuild.
            card.dataset.nodeId   = node.id;
            card.dataset.stateKey = node.id;

            const head = document.createElement('div');
            head.className = 'pl-state-head';

            const aggP = agg ? agg.p : 0;
            const pbadge = document.createElement('span');
            pbadge.className = 'pl-state-pbadge' + (aggP < 0.0005 ? ' pl-pbadge-zero' : '');
            pbadge.textContent = pct(aggP);
            pbadge.title = 'Total probability mass currently flowing into this question.';
            head.appendChild(pbadge);

            const title = document.createElement('span');
            title.className = 'pl-state-title';
            // Use canonical (context-free) phrasing here since the
            // same card represents every reach into this question.
            const Engine = window.Engine;
            const qt = Engine.resolveShortQuestionText({}, node)
                    || Engine.resolveQuestionText({}, node)
                    || node.label
                    || node.id;
            title.textContent = qt;
            head.appendChild(title);

            // Reuse renderTag's unsettled badge rendering by passing a
            // shim with the question's bag-keyed weights.
            const tag = renderTag({
                classification: 'question',
                nodeId: node.id,
                key: cardState.key,
            }, stored);
            if (tag) head.appendChild(tag);
            card.appendChild(head);

            // The card always offers every option of the question
            // node, even when the live graph entry chosen as
            // `cardState` only enabled a subset (because some prior
            // answer happened to gate one off). Otherwise the user
            // sees an inconsistent set of inputs depending on what
            // they answered upstream.
            const renderState = Object.assign({}, cardState, {
                nodeId: node.id,
                enabledEdges: allEdgesOf(node),
            });
            appendEdgesUI(card, renderState, stored, onWeightChange, { carrierP: aggP });
            return card;
        }

        function findQuestionCardEl(nodeId) {
            return questionsEl.querySelector('[data-node-id="' + cssEscape(nodeId) + '"]');
        }

        // Defensive CSS.escape — older browsers may not have it. Only
        // called for node ids which are simple identifiers anyway, so
        // a tiny shim suffices.
        function cssEscape(s) {
            if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(s);
            return String(s).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
        }

        function renderStateCard(s) {
            const card = document.createElement('div');
            card.className = 'pl-state pl-' + s.classification;
            card.dataset.stateKey = s.key;

            const head = document.createElement('div');
            head.className = 'pl-state-head';

            const pbadge = document.createElement('span');
            pbadge.className = 'pl-state-pbadge' + (s.p < 0.0005 ? ' pl-pbadge-zero' : '');
            pbadge.textContent = pct(s.p);
            head.appendChild(pbadge);

            const title = document.createElement('span');
            title.className = 'pl-state-title';
            title.innerHTML = renderTitle(s);
            head.appendChild(title);

            const tag = renderTag(s, stored);
            if (tag) head.appendChild(tag);

            card.appendChild(head);

            if (s.classification === 'question') {
                appendEdgesUI(card, s, stored, onWeightChange);
                // Only offer "Auto-collapse" when reach precompute
                // would actually collapse this card. Without that
                // gate we'd show a useless button on regular
                // multi-outcome questions whose user happened to
                // toggle the flag.
                if (isExpandAnyway(s, stored) && s.forcedReachableCount === 1) {
                    appendExpandUndoUI(card, s);
                }
            } else if (s.classification === 'auto-locked') {
                const node = window.Engine.NODE_MAP[s.nodeId];
                const edge = node && node.edges && node.edges.find(e => e.id === s.forcedEdgeId);
                const meta = document.createElement('div');
                meta.className = 'pl-state-meta';
                meta.textContent = 'Auto-resolves: ' + (edge ? (edge.answerLabel || edge.label || s.forcedEdgeId) : s.forcedEdgeId);
                card.appendChild(meta);
            } else if (s.classification === 'open') {
                appendOutcomeMeta(card, s);
            } else if (s.classification === 'forced-outcome') {
                appendOutcomeMeta(card, s);
                appendForcedActions(card, s);
            } else if (s.classification === 'stuck' || s.classification === 'unknown-flow') {
                const meta = document.createElement('div');
                meta.className = 'pl-state-meta';
                meta.textContent = 'No askable next question (engine stuck).';
                card.appendChild(meta);
            }

            return card;
        }

        // "Expand anyway" override on a forced-outcome card. Sets the
        // per-state flag and rebuilds — the state will come back as a
        // normal question with its weight inputs visible.
        function appendForcedActions(card, s) {
            const wrap = document.createElement('div');
            wrap.className = 'pl-state-forced-actions';
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'pl-state-forced-btn';
            btn.textContent = 'Expand anyway';
            btn.title = 'Show this question\u2019s answer choices even though every branch lands on the same outcome.';
            btn.addEventListener('click', () => {
                setExpandAnyway(s, stored, true);
                saveStored(stored);
                rebuild();
            });
            wrap.appendChild(btn);
            card.appendChild(wrap);
        }

        // Inverse: shown on a question card that the user expanded
        // even though reach precompute would auto-collapse it. One
        // click puts it back into the auto-collapsed state.
        function appendExpandUndoUI(card, s) {
            const wrap = document.createElement('div');
            wrap.className = 'pl-state-forced-actions';
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'pl-state-forced-btn';
            btn.textContent = 'Auto-collapse';
            btn.title = 'Reach precompute says all branches from here lead to one outcome. Collapse this card to that outcome.';
            btn.addEventListener('click', () => {
                setExpandAnyway(s, stored, false);
                saveStored(stored);
                rebuild();
            });
            wrap.appendChild(btn);
            card.appendChild(wrap);
        }

        // Draw a bezier from each parent's bottom-center to each child's
        // top-center. Coordinates are measured in viewport-local space
        // and undone by the current view scale so the SVG (which lives
        // inside the transformed viewport) stays in sync.
        function drawEdges() {
            // Measure every card and every option-cell in viewport-local
            // (unscaled) coords. We divide by view.k because vRect is
            // post-transform. Option-cell rects are keyed by the
            // composite "<parentStateKey>|<edgeKey>" since the same
            // edgeKey (nodeId:edgeId) can appear under multiple state
            // keys in path-dependent mode.
            const vRect = viewportEl.getBoundingClientRect();
            const toLocal = (r) => ({
                x: (r.left - vRect.left) / view.k,
                y: (r.top  - vRect.top)  / view.k,
                w: r.width  / view.k,
                h: r.height / view.k,
            });

            const cardRects = new Map();
            let maxRight = 0, maxBot = 0;
            for (const el of flowEl.querySelectorAll('[data-state-key]')) {
                const lr = toLocal(el.getBoundingClientRect());
                cardRects.set(el.dataset.stateKey, lr);
                if (lr.x + lr.w > maxRight) maxRight = lr.x + lr.w;
                if (lr.y + lr.h > maxBot)   maxBot   = lr.y + lr.h;
                // Map each option cell into the same coord space,
                // namespaced by its parent state key so we can look it
                // up while iterating edges below.
                const pkey = el.dataset.stateKey;
                for (const cellEl of el.querySelectorAll('[data-edge-anchor]')) {
                    const cr = toLocal(cellEl.getBoundingClientRect());
                    cardRects.set(pkey + '\u0001' + cellEl.dataset.edgeAnchor, cr);
                }
            }
            const pad = 32;
            const W = maxRight + pad, H = maxBot + pad;
            edgesSvg.setAttribute('width', W);
            edgesSvg.setAttribute('height', H);
            edgesSvg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);

            const paths = [];
            for (const [pkey, parentState] of graph.states.entries()) {
                const pr = cardRects.get(pkey);
                if (!pr) continue;
                const wbag = weightsFor(parentState, stored) || {};
                const totalW = (parentState.enabledEdges || []).reduce((a, e) => {
                    return a + (wbag[edgeKey(e.nodeId, e.edgeId)] || 0);
                }, 0);
                // entry.children is keyed by the FULL edge key
                // (`<nodeId>:<edgeId>`), not the bare edgeId — see
                // buildGraph.expandChildren. So we use the map key
                // directly as the lookup; no extra re-wrapping.
                for (const [ek, ckey] of parentState.children.entries()) {
                    const cr = cardRects.get(ckey);
                    if (!cr) continue;
                    // Each answer cell owns its own outgoing arrow:
                    // we use the cell's X-center so the arrow visually
                    // lines up under its option, but always start the
                    // arrow at the card's bottom Y. Anchoring at the
                    // cell's bottom Y put the arrow's first segment
                    // inside the card, where the solid card background
                    // covered it. Auto-locked / passthrough states have
                    // no answer cells, so we fall back to the card's
                    // X-center.
                    const anchor = cardRects.get(pkey + '\u0001' + ek);
                    const ax = anchor ? anchor.x + anchor.w / 2 : pr.x + pr.w / 2;
                    const ay = pr.y + pr.h;
                    const x2 = cr.x + cr.w / 2;
                    const y2 = cr.y;
                    const dy = Math.max(24, (y2 - ay) / 2);
                    const d  = 'M ' + ax + ' ' + ay
                             + ' C ' + ax + ' ' + (ay + dy) + ', '
                             +        x2 + ' ' + (y2 - dy) + ', '
                             +        x2 + ' ' + y2;

                    let cls = '';
                    if (parentState.classification === 'question') {
                        const wv = wbag[ek] || 0;
                        // Use max(totalW, 100) so a single 10% input
                        // isn't classified as "dominant" (10/10 > 0.5);
                        // dominance means >50% of the parent's P, not
                        // >50% of the answered fraction.
                        const denom = Math.max(totalW, 100);
                        if (wv === 0) cls = ' class="pl-edge-zero"';
                        else if (wv / denom > 0.5) cls = ' class="pl-edge-active"';
                    } else {
                        cls = ' class="pl-edge-active"';
                    }
                    paths.push('<path d="' + d + '"' + cls + ' marker-end="url(#pl-edge-arrow)"/>');
                }
            }

            // Preserve the existing <defs>; replace everything else.
            const defs = edgesSvg.querySelector('defs');
            edgesSvg.innerHTML = '';
            if (defs) edgesSvg.appendChild(defs);
            edgesSvg.insertAdjacentHTML('beforeend', paths.join(''));
        }

        function paintSummary() {
            summaryEl.innerHTML = '';

            // Per-outcome (per-variant) accumulated probability.
            const outcomesSec = document.createElement('section');
            const oHead = document.createElement('h2');
            oHead.textContent = 'Outcomes';
            outcomesSec.appendChild(oHead);

            const byVariant = new Map();
            for (const s of graph.states.values()) {
                // Both terminal kinds contribute to the per-outcome
                // breakdown: 'open' = sel matches a template here,
                // 'forced-outcome' = reach precompute proves only one
                // outcome is reachable downstream.
                const isOutcome = (s.classification === 'open'
                                || s.classification === 'forced-outcome');
                if (!isOutcome || !s.outcome || s.p <= 0) continue;
                const slug = s.outcome.templateId
                    + (s.outcome.variantKey ? '--' + s.outcome.variantKey : '');
                const cur = byVariant.get(slug) || {
                    p: 0,
                    label: s.outcome.title + (s.outcome.subtitle ? ' \u2014 ' + s.outcome.subtitle : ''),
                };
                cur.p += s.p;
                byVariant.set(slug, cur);
            }
            const sorted = Array.from(byVariant.values()).sort((a, b) => b.p - a.p);
            if (sorted.length === 0) {
                const empty = document.createElement('div');
                empty.className = 'pl-row-empty';
                empty.textContent = 'No outcomes reached yet.';
                outcomesSec.appendChild(empty);
            } else {
                for (const o of sorted) {
                    const row = document.createElement('div');
                    row.className = 'pl-row';
                    row.innerHTML = '<span class="pl-row-label">' + esc(o.label) + '</span>'
                        + '<span class="pl-row-pct">' + esc(pct(o.p)) + '</span>';
                    outcomesSec.appendChild(row);
                }
            }
            summaryEl.appendChild(outcomesSec);

            // Unsettled frontier, sorted by P descending.
            const frontierSec = document.createElement('section');
            const fHead = document.createElement('h2');
            fHead.textContent = 'Unsettled frontier';
            frontierSec.appendChild(fHead);

            const frontier = [];
            for (const s of graph.states.values()) {
                if (s.classification !== 'question') continue;
                if (s.p <= 0) continue;
                const w = weightsFor(s, stored);
                let sum = 0;
                if (w) for (const v of Object.values(w)) sum += (v > 0 ? v : 0);
                if (sum > 0) continue;
                frontier.push(s);
            }
            // In 'questions' mode, dedupe by node.id (one card per
            // question in the flat list) and aggregate p across all
            // states for that question. Tree modes keep one row per
            // state so the sidebar matches the canvas one-for-one.
            let displayFrontier = frontier;
            if (stored.mode === 'questions') {
                const byNode = new Map();
                for (const s of frontier) {
                    const nid = s.nodeId;
                    if (!nid) continue;
                    const cur = byNode.get(nid);
                    if (cur) cur.p += s.p;
                    else byNode.set(nid, { ...s, p: s.p, _aggregatedNodeId: nid });
                }
                displayFrontier = Array.from(byNode.values());
            }
            displayFrontier.sort((a, b) => b.p - a.p);

            if (displayFrontier.length === 0) {
                const empty = document.createElement('div');
                empty.className = 'pl-row-empty';
                empty.textContent = 'All paths settled.';
                frontierSec.appendChild(empty);
                setNextFrontierKey(null);
            } else {
                for (const s of displayFrontier) {
                    const node = window.Engine.NODE_MAP[s.nodeId];
                    const narrSel = window.Engine.narrativeState(s.stack);
                    const qt = node
                        ? (window.Engine.resolveShortQuestionText(narrSel, node)
                           || window.Engine.resolveQuestionText(narrSel, node)
                           || node.label)
                        : (s.nodeId || '?');
                    const row = document.createElement('div');
                    row.className = 'pl-row pl-row-frontier';
                    row.innerHTML = '<span class="pl-row-label">' + esc(qt) + '</span>'
                        + '<span class="pl-row-pct">' + esc(pct(s.p)) + '</span>';
                    // In 'questions' mode the click target is the
                    // node.id (a single flat-list card); otherwise it's
                    // the canonical state key.
                    const target = stored.mode === 'questions' ? s.nodeId : s.key;
                    row.addEventListener('click', () => onFrontierClick(target));
                    frontierSec.appendChild(row);
                }
                // Highlight the highest-probability unsettled state in
                // the tree (or question card in 'questions' mode) so
                // the next thing the user sees is "what should I
                // weight next?". The same key powers the "Next"
                // canvas-tools button.
                const headTarget = stored.mode === 'questions'
                    ? displayFrontier[0].nodeId
                    : displayFrontier[0].key;
                setNextFrontierKey(headTarget);
                setTimeout(() => {
                    if (stored.mode === 'questions') {
                        const card = findQuestionCardEl(headTarget);
                        if (card) card.classList.add('pl-target');
                    } else {
                        const targetEl = findStateEl(canvasEl, headTarget);
                        if (targetEl) targetEl.classList.add('pl-target');
                    }
                }, 0);
            }
            summaryEl.appendChild(frontierSec);
        }

        function paintTotals() {
            const totals = computeTotals(graph, stored);
            app.querySelector('[data-tot="settled"]').textContent   = pct(totals.settled);
            app.querySelector('[data-tot="unsettled"]').textContent = pct(totals.unsettled);
            app.querySelector('[data-tot="stuck"]').textContent     = pct(totals.stuck);
        }

        // First paint
        recomputeP(graph, stored);
        paintTree();
        paintSummary();
        paintTotals();
        // 'questions' mode renders a flat scrolling list (no canvas
        // tree), so the fit-to-view pan/zoom is a no-op and we skip it
        // — the questions pane manages its own scroll.
        if (stored.mode !== 'questions') {
            // Wait two frames so paintTree's edge measurement finishes
            // (it schedules its own rAF), then fit. fitView measures
            // the pl-flow box, so the rows must be in the DOM and
            // laid out.
            requestAnimationFrame(() => requestAnimationFrame(() => fitView()));
        }
    }

    // ────────────────────────────────────────────────────────────────
    // Subrenderers (pure given the state record + stored bag)
    // ────────────────────────────────────────────────────────────────
    function renderTitle(s) {
        if (s.classification === 'question'
                || s.classification === 'auto-locked'
                || s.classification === 'forced-outcome') {
            const node = window.Engine.NODE_MAP[s.nodeId];
            if (!node) return esc(s.nodeId || '(state)');
            const narrSel = window.Engine.narrativeState(s.stack);
            const qt = window.Engine.resolveQuestionText(narrSel, node);
            return esc(qt || node.label || s.nodeId);
        }
        if (s.classification === 'open') {
            if (s.outcome) {
                return '<b>' + esc(s.outcome.title) + '</b>'
                    + (s.outcome.subtitle ? ' \u2014 ' + esc(s.outcome.subtitle) : '');
            }
            return '<i>(open state with no matching outcome)</i>';
        }
        if (s.classification === 'stuck' || s.classification === 'unknown-flow') {
            return '<i>Stuck (no askable next question)</i>';
        }
        return '(state)';
    }

    function renderTag(s, stored) {
        if (s.classification === 'auto-locked') {
            const tag = document.createElement('span');
            tag.className = 'pl-state-tag pl-tag-locked';
            tag.textContent = 'Locked';
            return tag;
        }
        if (s.classification === 'stuck' || s.classification === 'unknown-flow') {
            const tag = document.createElement('span');
            tag.className = 'pl-state-tag pl-tag-stuck';
            tag.textContent = 'Stuck';
            return tag;
        }
        if (s.classification === 'forced-outcome' && s.outcome) {
            const tag = document.createElement('span');
            tag.className = 'pl-state-tag pl-tag-forced';
            const label = s.outcome.title
                + (s.outcome.subtitle ? ' \u2014 ' + s.outcome.subtitle : '');
            tag.textContent = '\u2192 ' + label;
            tag.title = 'Reach precompute: every branch from here lands on this outcome.';
            return tag;
        }
        if (s.classification === 'question') {
            const w = weightsFor(s, stored);
            let sum = 0;
            if (w) for (const v of Object.values(w)) sum += (v > 0 ? v : 0);
            // Show how much of THIS card's incoming probability hasn't
            // been allocated to an outgoing edge yet. Anything from 0
            // (fully assigned) up to 100 (nothing assigned). The badge
            // persists at every partial value — it only disappears
            // once the card is fully settled (sum >= 100).
            const remaining = Math.max(0, 100 - sum);
            if (remaining > 0.05) {
                const tag = document.createElement('span');
                const partial = sum > 0 ? ' pl-tag-partial' : '';
                tag.className = 'pl-state-tag pl-tag-unsettled' + partial;
                tag.textContent = formatRemaining(remaining) + ' unsettled';
                return tag;
            }
        }
        return null;
    }

    // Format a 0-100 remainder for the unsettled badge. Keeps integer
    // percentages compact ("90%") and falls back to one decimal place
    // for tiny slivers so a 0.5%-left card doesn't read as "0%".
    function formatRemaining(n) {
        if (n >= 10)  return Math.round(n) + '%';
        if (n >= 1)   return (Math.round(n * 10) / 10) + '%';
        return (Math.round(n * 100) / 100) + '%';
    }

    function appendEdgesUI(card, s, stored, onWeightChange, opts) {
        const w = weightsFor(s, stored) || {};
        const autoEK = autoFilledEdgeFor(s, stored);
        // Opts let callers override the propagated probability used to
        // display "→ child P" under each option. Tree-mode cards leave
        // this as s.p; the questions-only flat list passes the
        // aggregate p across all states sharing this nodeId so the
        // displayed child probabilities reflect every reach into the
        // question.
        const carrierP = (opts && opts.carrierP != null) ? opts.carrierP : s.p;
        let sumW = 0;
        for (const v of Object.values(w)) sumW += (v > 0 ? v : 0);
        const isAnswered = sumW > 0;
        // Weights are absolute percentages of the parent's P. The
        // denominator only normalizes when the user over-allocates
        // (Σw > 100); otherwise an unfilled remainder leaks to
        // unsettled at this question (see recomputeP).
        const denom = Math.max(sumW, 100);

        const row = document.createElement('div');
        row.className = 'pl-edges';
        for (const e of s.enabledEdges) {
            const ek = edgeKey(e.nodeId, e.edgeId);
            const wv = w[ek];
            const isAuto = autoEK === ek && wv > 0;
            // "Dominant" means more than half of the parent's P flows
            // through this edge — that's wv/denom > 0.5.
            const isActive = isAnswered && wv > 0 && (wv / denom) > 0.5;
            const isZero   = isAnswered && (!wv || wv <= 0);

            const cell = document.createElement('div');
            cell.className = 'pl-edge-cell'
                + (isActive ? ' pl-edge-cell-active' : '')
                + (isZero   ? ' pl-edge-cell-zero'   : '');
            // Tag the cell so drawEdges() can anchor the outgoing
            // arrow on the specific option, not the parent card.
            cell.dataset.edgeAnchor = ek;

            const wWrap = document.createElement('div');
            wWrap.className = 'pl-edge-cell-w';
            const input = document.createElement('input');
            input.type = 'number';
            input.step = '1';
            input.min = '0';
            input.max = '100';
            input.className = 'pl-edge-w' + (isAuto ? ' pl-edge-w-auto' : '');
            input.value = wv != null ? String(Math.round(wv * 100) / 100) : '';
            input.placeholder = '\u2014';
            if (isAuto) input.title = 'Auto-filled remainder. Type a value to set this edge yourself.';
            // Live update: fire on every keystroke (and arrow-step) so
            // the displayed P, the auto-fill remainder, and the SVG
            // arrows all track typing. The rebuild() inside
            // onWeightChange preserves focus and the raw in-progress
            // text in the focused input, so users can finish typing
            // partial decimals like "10." without being clobbered.
            input.addEventListener('input', () => {
                // Empty input (cleared) → null = "unset, eligible for
                // auto-fill". Numeric input (including 0) → explicit
                // user value.
                const raw = input.value.trim();
                if (raw === '') {
                    onWeightChange(s, ek, null);
                    return;
                }
                const v = parseFloat(raw);
                if (!isFinite(v) || v < 0)      onWeightChange(s, ek, null);
                else if (v > 100)               onWeightChange(s, ek, 100);
                else                            onWeightChange(s, ek, v);
            });
            // On commit (blur / Enter), normalize what the user typed
            // back from the canonical stored value (e.g. "010" → "10",
            // "10." → "10"). Skipped while live-typing because it
            // would interfere with partial decimal entry.
            input.addEventListener('change', () => {
                const wbagNow = weightsFor(s, stored) || {};
                const v = wbagNow[ek];
                input.value = v != null ? String(Math.round(v * 100) / 100) : '';
            });
            wWrap.appendChild(input);
            const pctSign = document.createElement('span');
            pctSign.className = 'pl-edge-w-suffix';
            pctSign.textContent = '%';
            wWrap.appendChild(pctSign);

            const label = document.createElement('div');
            label.className = 'pl-edge-label';
            const lbl = e.edge.answerLabel || e.edge.shortAnswerLabel || e.edge.label || e.edgeId;
            const autoTag = isAuto ? '<span class="pl-edge-auto-tag">auto</span>' : '';
            label.innerHTML = esc(lbl)
                + '<span class="pl-edge-id">' + esc(e.edgeId) + autoTag + '</span>';

            const cp = document.createElement('div');
            cp.className = 'pl-edge-cp';
            if (isAnswered && wv > 0) {
                // Show the absolute child P. We do NOT show a separate
                // "conditional" because the input value (wv%) is the
                // conditional share by construction.
                cp.classList.add('pl-edge-cp-active');
                cp.textContent = '\u2192 ' + pct(carrierP * (wv / denom));
            } else if (isAnswered) {
                cp.textContent = '0%';
            } else {
                cp.textContent = '';
            }

            cell.appendChild(wWrap);
            cell.appendChild(label);
            cell.appendChild(cp);
            row.appendChild(cell);
        }
        card.appendChild(row);
    }

    function appendOutcomeMeta(card, s) {
        if (!s.outcome) {
            const meta = document.createElement('div');
            meta.className = 'pl-state-meta';
            meta.textContent = 'Open state with no matching outcome.';
            card.appendChild(meta);
            return;
        }
        const meta = document.createElement('div');
        meta.className = 'pl-state-outcome-mood';
        const parts = [];
        if (s.outcome.mood) parts.push('mood: ' + s.outcome.mood);
        parts.push('id: ' + s.outcome.templateId
            + (s.outcome.variantKey ? '/' + s.outcome.variantKey : ''));
        meta.textContent = parts.join(' \u00b7 ');
        card.appendChild(meta);
        if (s.outcome.summary) {
            const sm = document.createElement('div');
            sm.className = 'pl-state-outcome-summary';
            sm.textContent = s.outcome.summary;
            card.appendChild(sm);
        }
    }

    // ────────────────────────────────────────────────────────────────
    // Public API
    // ────────────────────────────────────────────────────────────────
    if (typeof window !== 'undefined') {
        window.PathLikelihoods = { render };
    }
})();
