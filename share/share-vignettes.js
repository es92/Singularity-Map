// Share-page personalization: reads query params for profession and answer
// stack, then recomputes and renders the same merged vignette timeline the
// sharer saw in the app. Relies on graph.js + engine.js being loaded first.
// Silently no-ops if query params are missing or data fetches fail, so the
// static share card remains the base experience for crawlers and cold loads.

(function() {
    'use strict';

    const params = new URLSearchParams(location.search);
    if (params.toString().length === 0) return;

    const profession = params.get('pp') || null;
    const pairs = [];
    for (const [k, v] of params.entries()) {
        if (k === 'pp' || k === 'locked' || k === 'fq' || k === 'sq' || k === 'et' || k === 'cd' || k === 'db') continue;
        pairs.push({ nodeId: k, edgeId: v });
    }
    if (!profession && pairs.length === 0) return;

    const container = document.getElementById('personalized-timeline');
    if (!container) return;

    const DATA_BASE = '../data/';

    Promise.all([
        fetch(DATA_BASE + 'outcomes.json').then(r => r.json()),
        fetch(DATA_BASE + 'narrative.json').then(r => r.json()),
        fetch(DATA_BASE + 'personal.json').then(r => r.json()),
    ]).then(([outcomes, narrative, personalData]) => {
        applyNarrative(narrative);
        renderPersonalizedTimeline(outcomes, narrative, personalData, profession, pairs, container);
    }).catch(err => {
        console.warn('Share personalization disabled:', err);
    });

    // ─── Narrative merge (mirrors index.html loadData) ───
    function applyNarrative(narrative) {
        const { SCENARIO, NODE_MAP } = window.Graph;
        if (narrative._stages) SCENARIO.stages = narrative._stages;
        for (const [nodeId, narr] of Object.entries(narrative)) {
            if (nodeId === '_stages') continue;
            const node = NODE_MAP[nodeId];
            if (!node) continue;
            if (narr.questionText) node.questionText = narr.questionText;
            if (narr.contextWhen) node.contextWhen = narr.contextWhen;
            if (narr.values) {
                for (const [edgeId, vn] of Object.entries(narr.values)) {
                    const v = node.edges && node.edges.find(vv => vv.id === edgeId);
                    if (v) Object.assign(v, vn);
                }
            }
        }
    }

    // ─── Markdown + escape helpers ───
    function esc(s) {
        if (s == null) return '';
        const d = document.createElement('div');
        d.textContent = String(s);
        return d.innerHTML;
    }

    function md(s) {
        if (!s) return '';
        if (window.marked && typeof window.marked.parse === 'function') {
            return window.marked.parse(String(s).replace(/~/g, '\\~'));
        }
        return '<p>' + esc(s) + '</p>';
    }

    // ─── Date formatting (mirrors index.html) ───
    const _timelineStart = new Date();
    const _monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

    function formatMonths(m) {
        const d = new Date(_timelineStart.getFullYear(), _timelineStart.getMonth() + m);
        return { year: d.getFullYear(), month: _monthNames[d.getMonth()] };
    }

    function formatRange(startMonths, endMonths) {
        const s = formatMonths(startMonths);
        const e = formatMonths(endMonths);
        if (startMonths === endMonths || (s.year === e.year && s.month === e.month)) {
            return s.year + ' ' + s.month;
        }
        if (s.year === e.year) return s.year + ' ' + s.month + ' – ' + e.month;
        return s.year + ' ' + s.month + ' – ' + e.year + ' ' + e.month;
    }

    // ─── Narrative variant resolution ───
    function resolveNarrativeVariant(variants, sel) {
        if (!variants || !sel) return null;
        for (const v of variants) {
            if (!v.when) return v;
            if (window.Engine.matchCondition(sel, v.when)) return v;
        }
        return null;
    }

    function nodeNarrativeFor(nodeId, edgeId, sel) {
        const { NODE_MAP } = window.Graph;
        const node = NODE_MAP[nodeId];
        if (!node) return {};
        const v = node.edges && node.edges.find(vv => vv.id === edgeId);
        if (!v) return {};
        let variant = null;
        if (v.narrativeVariants && sel) variant = resolveNarrativeVariant(v.narrativeVariants, sel);
        const te = (variant && variant.timelineEvent) || v.timelineEvent || {};
        return {
            durationMin: te.durationMin,
            durationMax: te.durationMax,
            stage: node.stage,
        };
    }

    // ─── Template / flavor resolution ───
    function resolveConditionalText(entry, state) {
        if (typeof entry === 'string') return entry;
        if (entry && typeof entry === 'object' && entry._default) {
            if (entry._when) {
                for (const cond of entry._when) {
                    const match = Object.entries(cond.if).every(
                        ([k, vals]) => Array.isArray(vals) && vals.includes(state[k])
                    );
                    if (match) return cond.text;
                }
            }
            return entry._default;
        }
        return null;
    }

    function resolveFlavors(flavors, state, flavorHeadings) {
        if (!flavors) return [];
        const { NODE_MAP } = window.Graph;
        const result = [];
        for (const [nodeId, options] of Object.entries(flavors)) {
            const val = state[nodeId];
            if (!val || !options[val]) continue;
            const text = resolveConditionalText(options[val], state);
            if (!text) continue;
            let heading = null;
            if (flavorHeadings && flavorHeadings[nodeId]) {
                const h = flavorHeadings[nodeId];
                heading = typeof h === 'string' ? h : (h[val] || null);
            }
            if (!heading) {
                const node = NODE_MAP[nodeId];
                heading = node ? node.label : nodeId;
            }
            result.push({ nodeId, heading, text });
        }
        return result;
    }

    function resolveTimeline(rawTimeline, state) {
        if (Array.isArray(rawTimeline)) return rawTimeline;
        if (!rawTimeline || typeof rawTimeline !== 'object') return [];
        const method = state.escape_method;
        if (!method || !rawTimeline[method]) {
            const firstMethod = Object.keys(rawTimeline)[0];
            if (!firstMethod) return [];
            const mo = rawTimeline[firstMethod];
            if (Array.isArray(mo)) return mo;
            const firstTl = Object.keys(mo)[0];
            return firstTl ? mo[firstTl] : [];
        }
        const mo = rawTimeline[method];
        if (Array.isArray(mo)) return mo;
        const tl = state.escape_timeline;
        if (tl && mo[tl]) return mo[tl];
        const firstKey = Object.keys(mo)[0];
        return firstKey ? mo[firstKey] : [];
    }

    function resolveTemplate(templatesMap, templateId, state) {
        const t = templatesMap[templateId];
        if (!t) return null;
        let subtitle = null, mood, summary, variantKey = null;
        if (t.variants && t.primaryDimension) {
            variantKey = state[t.primaryDimension];
            const variant = variantKey ? t.variants[variantKey] : null;
            if (variant) {
                subtitle = variant.subtitle;
                mood = variant.mood || t.mood;
                summary = variant.summary;
            } else {
                const first = Object.entries(t.variants)[0];
                variantKey = first[0];
                subtitle = first[1].subtitle;
                mood = first[1].mood || t.mood;
                summary = first[1].summary;
            }
        } else {
            mood = t.mood;
            summary = t.summary;
        }
        return {
            variantKey, title: t.title, subtitle, mood, summary,
            story: t.story,
            timeline: resolveTimeline(t.timeline, state),
            flavors: resolveFlavors(t.flavors, state, t.flavorHeadings),
        };
    }

    // ─── Personal vignettes (mirrors index.html) ───
    function resolvePersonalVignetteText(spec, ctx) {
        if (!spec) return null;
        if (typeof spec === 'string') return spec;
        if (spec._when && Array.isArray(spec._when)) {
            for (const rule of spec._when) {
                if (!rule.if) continue;
                const match = Object.entries(rule.if).every(([k, vals]) =>
                    ctx[k] && Array.isArray(vals) && vals.includes(ctx[k])
                );
                if (match) return rule.text || null;
            }
        }
        return spec._default || null;
    }

    function resolvePersonalVignettes(stack, professionId, personalData, dateMap) {
        if (!professionId) return [];
        const Engine = window.Engine;
        const sel = Engine.currentState(stack);
        // narrSel layers flavor under sel — needed for dims that live in
        // flavor post-module-exit (e.g., response_success).
        const narrSel = Engine.narrativeState(stack);
        const ctx = Object.assign({}, narrSel, { profession: professionId });

        const profEntry = personalData && personalData.professions.find(p => p.id === professionId);
        const tokenReplace = (str) => {
            if (!str) return str;
            return str.replace(/\{profession\}/g, profEntry ? profEntry.label : professionId);
        };

        const professionalNodes = new Set([
            'agi_threshold', 'knowledge_rate', 'physical_rate',
        ]);

        const vignettes = [];
        const seen = new Set();
        const collectVignette = (node) => {
            const value = sel[node.id];
            if (!value) return;
            const edge = node.edges && node.edges.find(e => e.id === value);
            if (!edge) return;
            let pv = null;
            if (edge.narrativeVariants && sel) {
                const variant = resolveNarrativeVariant(edge.narrativeVariants, sel);
                if (variant && variant.personalVignette) pv = variant.personalVignette;
            }
            if (!pv && edge.personalVignette) pv = edge.personalVignette;
            if (!pv) return;
            const text = resolvePersonalVignetteText(pv, ctx);
            if (!text) return;

            const dateInfo = dateMap && dateMap[node.id] ? dateMap[node.id] : null;
            vignettes.push({
                nodeId: node.id,
                category: professionalNodes.has(node.id) ? 'Professional Impact' : 'Personal Impact',
                dateInfo,
                text: tokenReplace(text),
            });
        };
        // Stack-order only (chronological) — matches index.html. Iterating
        // NODES on top would double-render canonical dims that effects
        // wrote (e.g., early_knowledge_rate=gradual writes
        // knowledge_rate=gradual, and both nodes have personalVignettes
        // in narrative.json). Stack-only renders the user's actual pick.
        for (const entry of stack) {
            if (!entry.nodeId) continue;
            const node = Engine.NODE_MAP[entry.nodeId];
            if (!node || node.derived) continue;
            if (seen.has(node.id)) continue;
            seen.add(node.id);
            collectVignette(node);
        }

        const latePersonalNodes = new Set(['power_use']);
        const benefitNodes = new Set(['plateau_benefit_distribution', 'auto_benefit_distribution', 'benefit_distribution']);
        const deathNodes = new Set(['war_survivors']);
        if (narrSel.response_success !== 'yes') deathNodes.add('escape_method');
        // Pre-merge this was `catch_outcome === 'holds_temporarily'` — the
        // AI was stopped but the threat returns. Post-merge, that case is
        // `not_permanent` + `response_success=yes`; `response_success=no`
        // is the old `never_stopped` leg with no actual catch, so no
        // end-date to propagate. The consolidated post_catch marker keys
        // 'loose' on catch_outcome=not_permanent. response_success still
        // lives in flavor → narrSel.
        if (sel.post_catch === 'loose' && narrSel.response_success === 'yes') {
            const endDate = dateMap && dateMap['catch_outcome'];
            if (endDate) {
                for (const v of vignettes) {
                    if (deathNodes.has(v.nodeId)) v.dateInfo = endDate;
                }
            }
        }
        for (const v of vignettes) if (deathNodes.has(v.nodeId)) v.death = true;
        const hasDeath = vignettes.some(v => v.death);
        const reordered = vignettes.filter(v => !benefitNodes.has(v.nodeId) && !latePersonalNodes.has(v.nodeId));
        reordered.push(...vignettes.filter(v => latePersonalNodes.has(v.nodeId)));
        if (!hasDeath) reordered.push(...vignettes.filter(v => benefitNodes.has(v.nodeId)));
        let maxMonths = -1;
        for (const v of reordered) {
            if (v.dateInfo && v.dateInfo._months != null) {
                if (v.dateInfo._months < maxMonths) {
                    const fm = formatMonths(maxMonths);
                    v.dateInfo = { year: fm.year, month: fm.month, label: fm.month + ' ' + fm.year, _months: maxMonths };
                } else {
                    maxMonths = v.dateInfo._months;
                }
            }
        }
        return reordered;
    }

    // ─── Timeline events + date map ───
    function buildTimelineEvents(stack) {
        const Engine = window.Engine;
        const sel = Engine.currentState(stack);
        const events = [];
        const seen = new Set();
        const pushEvent = (node, value) => {
            const narr = nodeNarrativeFor(node.id, value, sel);
            events.push({
                nodeId: node.id,
                durationMin: narr.durationMin != null ? narr.durationMin : null,
                durationMax: narr.durationMax != null ? narr.durationMax : null,
                stage: narr.stage || node.stage,
            });
        };
        // Stack-order only (chronological) — matches index.html
        // buildTimelineEvents. Dims set by upstream edge effects (e.g.,
        // canonical knowledge_rate written by early_knowledge_rate) are
        // deliberately NOT rendered as separate events.
        for (const entry of stack) {
            if (!entry.nodeId) continue;
            const node = Engine.NODE_MAP[entry.nodeId];
            if (!node || node.derived) continue;
            if (seen.has(node.id)) continue;
            const value = entry.edgeId || sel[node.id];
            if (!value) continue;
            seen.add(node.id);
            pushEvent(node, value);
        }
        return events;
    }

    function buildDurations(events) {
        return events.map(e => {
            const min = e.durationMin || 0;
            const max = e.durationMax != null ? e.durationMax : min;
            const step = max <= 1 ? 0.25 : 1;
            return { min, max, current: Math.round((min + max) / 2 / step) * step };
        });
    }

    function buildDateMap(stack, events) {
        const durations = buildDurations(events);
        const timelineNodeIds = events.map(e => e.nodeId);
        const map = {};
        let cumulative = 0;
        for (let i = 0; i < durations.length; i++) {
            const d = durations[i];
            const nodeId = timelineNodeIds[i];
            if (nodeId && !map[nodeId]) {
                const fm = formatMonths(cumulative + d.current);
                const entry = { year: fm.year, month: fm.month, label: fm.month + ' ' + fm.year, _months: cumulative + d.current };
                if (d.min !== d.max) entry.rangeLabel = formatRange(cumulative + d.min, cumulative + d.max);
                map[nodeId] = entry;
            }
            cumulative += d.current;
        }
        const totalFm = formatMonths(cumulative);
        map._totalYear = totalFm.year;
        map._totalMonths = cumulative;

        const sel = window.Engine.currentState(stack);
        const agiVal = sel['agi_threshold'];
        const takeoffVal = sel['takeoff'];
        if (agiVal && takeoffVal) {
            const agiDoublings = { twenty_four_hours: 1, one_week: 3.8, few_months: 7.5, one_year: 9.5, ten_plus_years: 9.5 };
            const takeoffAccel = { none: 0, slow: 0.1, moderate: 0.2, fast: 0.35, explosive: 0.5 };
            const T = 9.5;
            const N = agiDoublings[agiVal];
            const a = takeoffAccel[takeoffVal];
            if (N != null && a != null) {
                const fraction = a === 0 ? N / T : (1 - Math.pow(1 - a, N)) / (1 - Math.pow(1 - a, T));
                let takeoffStart = 0, takeoffDur = 0;
                for (let i = 0; i < timelineNodeIds.length; i++) {
                    if (timelineNodeIds[i] === 'takeoff') { takeoffDur = durations[i].current; break; }
                    takeoffStart += durations[i].current;
                }
                if (takeoffDur) {
                    const months = takeoffStart + takeoffDur * fraction;
                    const fm = formatMonths(months);
                    map['agi_threshold'] = { year: fm.year, month: fm.month, label: fm.month + ' ' + fm.year, _months: months };
                }
            }
        }
        return map;
    }

    // ─── Merged rendering ───
    function buildMergedVignettesHtml(resolved, stack, dateMap, professionId, personalData) {
        const worldItems = resolved.flavors.map(f => ({
            type: 'world', nodeId: f.nodeId, heading: f.heading, text: f.text,
            dateInfo: dateMap[f.nodeId] || null,
        }));

        let personalItems = [];
        if (professionId) {
            personalItems = resolvePersonalVignettes(stack, professionId, personalData, dateMap);
            const endMonths = dateMap._totalMonths || 0;
            const endFm = formatMonths(endMonths);
            const endDateInfo = { year: endFm.year, month: endFm.month, label: endFm.month + ' ' + endFm.year, _months: endMonths };
            const terminalNodes = new Set(['escape_method', 'war_survivors']);
            for (const v of personalItems) {
                if (!v.dateInfo || v.dateInfo._months == null || terminalNodes.has(v.nodeId)) {
                    v.dateInfo = endDateInfo;
                }
            }
        }

        const personalNodeIds = new Set(personalItems.map(v => v.nodeId));
        const filtered = worldItems.filter(w => !personalNodeIds.has(w.nodeId));
        const merged = [
            ...filtered.filter(w => w.dateInfo && w.dateInfo._months != null),
            ...personalItems.map(p => ({ ...p, type: 'personal' })),
        ];
        merged.sort((a, b) => {
            const am = a.dateInfo && a.dateInfo._months != null ? a.dateInfo._months : Infinity;
            const bm = b.dateInfo && b.dateInfo._months != null ? b.dateInfo._months : Infinity;
            return am - bm;
        });

        if (merged.length === 0) return '';

        let html = '';
        let lastDateLabel = null;
        for (let i = 0; i < merged.length; i++) {
            const item = merged[i];
            const dateLabel = item.dateInfo ? item.dateInfo.label : null;
            const showDate = dateLabel && (i === 0 || dateLabel !== lastDateLabel || item.type === 'personal');
            const yearHtml = showDate ? `<span class="timeline-year">${esc(dateLabel)}</span>` : '';
            if (dateLabel) lastDateLabel = dateLabel;

            if (item.type === 'personal') {
                const catClass = item.death ? 'heading-death' : (item.category === 'Professional Impact' ? 'heading-professional' : 'heading-personal');
                const dotClass = item.death ? 'dot-death' : (item.category === 'Professional Impact' ? 'dot-professional' : 'dot-personal');
                html += `<div class="timeline-event personal-milestone">
                    <div class="tl-vline-seg"></div><div class="tl-dot ${dotClass}"></div><div class="tl-hline"></div>
                    <div class="timeline-top-row ${catClass}">
                        <span class="personal-vignette-heading">${esc(item.category)}</span>
                        ${yearHtml}
                    </div>
                    <div class="timeline-desc">${md(item.text)}</div>
                </div>`;
            } else {
                html += `<div class="timeline-event world-milestone">
                    <div class="tl-vline-seg"></div><div class="tl-dot dot-world"></div><div class="tl-hline"></div>
                    <div class="timeline-top-row heading-world">
                        <span class="world-vignette-heading">${esc(item.heading)}</span>
                        ${yearHtml}
                    </div>
                    <div class="timeline-desc">${md(item.text)}</div>
                </div>`;
            }
        }
        return `<div class="outcome-timeline timeline">${html}</div>`;
    }

    function adjustPersonalVlines(container) {
        if (!container) return;
        const events = container.querySelectorAll('.timeline-event');
        const dots = [], segs = [], parents = [];
        events.forEach(evt => {
            const dot = evt.querySelector('.tl-dot');
            const seg = evt.querySelector('.tl-vline-seg');
            if (dot && seg) { dots.push(dot); segs.push(seg); parents.push(evt); }
        });
        for (let i = 0; i < dots.length; i++) {
            if (i === 0) { segs[i].style.display = 'none'; continue; }
            const prevRect = dots[i - 1].getBoundingClientRect();
            const currRect = dots[i].getBoundingClientRect();
            const evtRect = parents[i].getBoundingClientRect();
            const prevCenter = prevRect.top + prevRect.height / 2;
            const currCenter = currRect.top + currRect.height / 2;
            segs[i].style.display = '';
            segs[i].style.top = (prevCenter - evtRect.top) + 'px';
            segs[i].style.height = (currCenter - prevCenter) + 'px';
        }
    }

    function renderPersonalizedTimeline(outcomes, narrative, personalData, professionId, pairs, container) {
        const Engine = window.Engine;

        let stack = Engine.createStack();
        for (const { nodeId, edgeId } of pairs) {
            if (!window.Graph.NODE_MAP[nodeId]) continue;
            try { stack = Engine.push(stack, nodeId, edgeId); } catch (_) {}
        }

        const sel = Engine.currentState(stack);
        // Template matching reads `sel` only — outcome `reachable` clauses
        // are sel-only by contract (see Engine.templateMatches). Narrative
        // resolution still needs the fused `sel ∪ flavor` view so module-
        // exported flavor dims (escape_method/escape_timeline/etc.) remain
        // visible to flavor blocks and timeline events.
        const narrEff = Engine.resolvedStateWithFlavor(sel, Engine.currentFlavor(stack));

        const templatesMap = {};
        for (const t of outcomes.templates) templatesMap[t.id] = t;
        const matched = outcomes.templates.filter(t => Engine.templateMatches(t, sel));
        if (matched.length === 0) return;
        const resolved = resolveTemplate(templatesMap, matched[0].id, narrEff);
        if (!resolved) return;

        const events = buildTimelineEvents(stack);
        const dateMap = buildDateMap(stack, events);
        const html = buildMergedVignettesHtml(resolved, stack, dateMap, professionId, personalData);
        if (!html) return;

        let intro;
        if (professionId) {
            const profEntry = personalData && personalData.professions.find(p => p.id === professionId);
            const label = profEntry ? profEntry.label : professionId;
            intro = `<div class="share-vignette-intro">The timeline I got, as someone in <strong>${esc(label)}</strong>:</div>`;
        } else {
            intro = `<div class="share-vignette-intro">I got...</div>`;
        }

        container.innerHTML = intro + html;
        requestAnimationFrame(() => adjustPersonalVlines(container));
        window.addEventListener('resize', () => adjustPersonalVlines(container));
    }
})();
