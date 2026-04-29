'use strict';

// ---------------------------------------------------------------------------
// TimelineRenderer — DOM rendering (separated from animation)
// ---------------------------------------------------------------------------

class TimelineRenderer {
    constructor(options) {
        this.containerEl = options.containerEl;
        this.timelineEl = options.timelineEl;
        this.questionZoneEl = options.questionZoneEl;
        this.outcomeEl = options.outcomeEl || null;
        this.dp = options.dataProvider;

        this.cardClass = options.cardClass || 'question-card';
        this.contentSelector = options.contentSelector || '.question-text, .question-context, .answers';

        this.stages = options.stages || null;
        this._currentAnswerCards = null;
        this._customRender = options.render || null;
        this._customWireButtons = options.wireAnswerButtons || null;
        this._stripFromAnimation = options.stripFromAnimation || null;
    }

    _getCard() {
        return this.questionZoneEl.querySelector('.' + this.cardClass);
    }

    _esc(str) {
        if (!str && str !== 0) return '';
        const d = document.createElement('div');
        d.textContent = String(str);
        return d.innerHTML;
    }

    _md(str) {
        if (!str && str !== 0) return '';
        return marked.parse(String(str).replace(/~/g, '\\~'));
    }

    renderStageHeader(stageId) {
        const info = this.stages ? this.stages[stageId] : null;
        if (!info) return '';
        return `<div class="timeline-stage-header"><div class="tl-stage-bg"></div><span class="timeline-stage-label">${this._esc(info.label)}</span></div>`;
    }

    renderPills(event) {
        // Frontier events always render their (possibly single) sibling as a
        // clickable pill — otherwise a forced/locked next question with only
        // one reachable option would silently produce no UI and the timeline
        // would appear to dead-end.
        const hasSiblings = event.siblings && event.siblings.length > 0;
        const shouldFallback = !hasSiblings || (!event.isFrontier && event.siblings.length < 2);
        if (shouldFallback) {
            if (!event.paramLabel) return '';
            return `<span class="timeline-param-wrap"><span class="timeline-param-dim">${this._esc(event.nodeLabel)}</span><span class="timeline-param">${this._esc(event.paramLabel)}</span></span>`;
        }
        const allLocked = event.isLocked;
        const pills = event.siblings.map(s => {
            const pillText = s.shortLabel || s.label;
            const active = event.isFrontier ? false : s.value === event.selectedValue;
            if (event.isFrontier) {
                if (s.disabled || !s.reachable) return `<span class="tl-pill disabled">${this._esc(pillText)}</span>`;
                return `<span class="tl-pill" data-pathaction="frontier" data-dim="${this._esc(s.nodeId)}" data-val="${this._esc(s.value)}">${this._esc(pillText)}</span>`;
            }
            if (active) {
                return `<span class="tl-pill active${allLocked ? ' locked' : ''}" data-pathaction="unclick" data-dim="${this._esc(event.nodeId)}">${this._esc(pillText)}</span>`;
            }
            if (allLocked || s.disabled || !s.reachable) {
                return `<span class="tl-pill disabled">${this._esc(pillText)}</span>`;
            }
            return `<span class="tl-pill" data-pathaction="change" data-dim="${this._esc(s.nodeId)}" data-val="${this._esc(s.value)}">${this._esc(pillText)}</span>`;
        }).join('');
        const undoHtml = (!event.isFrontier && event.selectedValue)
            ? `<button class="tl-undo" data-pathaction="unclick" data-dim="${this._esc(event.nodeId)}" aria-label="Go back to this question">&#x21a9;&#xFE0E;</button>`
            : '';
        return `<span class="timeline-param-wrap"><span class="timeline-param-dim">${this._esc(event.nodeLabel)}${undoHtml}</span><span class="tl-pills">${pills}</span></span>`;
    }

    renderEvent(event, options) {
        const opts = options || {};
        const expanded = opts.expanded !== false;
        const yearLabel = opts.yearLabel || '';
        const sliderHtml = opts.sliderHtml || '';
        const eventIndex = opts.eventIndex;

        const yearHtml = yearLabel
            ? `<div class="timeline-year"${eventIndex != null ? ` data-tsy="${eventIndex}"` : ''}>${this._esc(yearLabel)}</div>`
            : '';
        const headlineHtml = (expanded && event.headline) ? `<div class="timeline-headline">${this._esc(event.headline)}</div>` : '';
        const descHtml = (expanded && event.description) ? `<div class="timeline-desc">${this._md(event.description)}</div>` : '';
        const frontierCls = event.isFrontier ? ' frontier-event' : '';

        return `<div class="timeline-event${frontierCls}" data-dim="${this._esc(event.nodeId || '')}">
            <div class="tl-vline-seg"></div><div class="tl-dot"></div><div class="tl-hline"></div>
            <div class="timeline-top-row">${this.renderPills(event)}${yearHtml}</div>
            ${headlineHtml}
            ${descHtml}
            ${sliderHtml}
        </div>`;
    }

    renderTimeline(events, options) {
        const opts = options || {};
        const expanded = opts.expanded !== false;
        const formatRange = opts.formatRange || null;
        const formatDuration = opts.formatDuration || null;
        const nextQuestion = opts.nextQuestion || null;
        const nextStage = opts.nextStage || null;
        const fullQuestions = opts.fullQuestions !== false;

        let lastStage = 0;
        const hasDurations = events.some(e => e.durationMin != null);

        const durations = events.map(e => {
            const min = e.durationMin || 0;
            const max = e.durationMax != null ? e.durationMax : min;
            const step = max <= 1 ? 0.25 : 1;
            return { min, max, current: Math.round((min + max) / 2 / step) * step };
        });
        const ranges = durations.filter(d => d.max > d.min).map(d => d.max - d.min);
        const meanRange = ranges.length ? ranges.reduce((a, b) => a + b, 0) / ranges.length : 1;
        let cumulative = 0;

        const seenStages = new Set();
        let leadingHeader = '';
        if (events.length === 0 && fullQuestions && this.stages) {
            const firstKey = Object.keys(this.stages).sort((a, b) => Number(a) - Number(b))[0];
            if (firstKey) {
                leadingHeader = this.renderStageHeader(Number(firstKey));
                seenStages.add(firstKey);
            }
        }

        const html = events.map((e, i) => {
            let headerHtml = '';
            if (e.stage && e.stage !== lastStage) {
                lastStage = e.stage;
                seenStages.add(String(e.stage));
                headerHtml = this.renderStageHeader(e.stage);
            }

            const d = durations[i];
            const yearLabel = (hasDurations && formatRange) ? formatRange(cumulative, cumulative + d.current) : '';
            cumulative += d.current;

            const isPoint = d.min === 0 && d.max === 0 && i > 0;

            let sliderHtml = '';
            if (expanded && d.max > d.min && formatDuration) {
                const ratio = (d.max - d.min) / meanRange;
                const tt = Math.sqrt(ratio);
                const pct = Math.min(100, Math.max(15, tt * 50));
                sliderHtml = `<div class="timeline-slider">
                    <input type="range" min="${d.min}" max="${d.max}" step="${d.max <= 1 ? 0.25 : 1}" value="${d.current}" data-tsi="${i}" style="width:${pct.toFixed(0)}%">
                    <span class="timeline-slider-label" data-tsl="${i}">${formatDuration(d.current)}</span>
                </div>`;
            }

            return headerHtml + this.renderEvent(e, {
                expanded,
                yearLabel: (isPoint || !yearLabel) ? '' : yearLabel,
                sliderHtml,
                eventIndex: i,
            });
        }).join('');

        let trailingHeaders = '';
        if (this.stages) {
            if (!fullQuestions) {
                const maxStage = events.length ? Math.max(...events.map(e => e.stage || 0)) : 0;
                for (const key of Object.keys(this.stages).sort((a, b) => Number(a) - Number(b))) {
                    if (!seenStages.has(key) && Number(key) <= maxStage) {
                        trailingHeaders += this.renderStageHeader(Number(key));
                    }
                }
            } else {
                const trailingStage = (nextQuestion && nextQuestion.stage) || nextStage;
                if (trailingStage && !seenStages.has(String(trailingStage))) {
                    trailingHeaders = this.renderStageHeader(trailingStage);
                }
            }
        }

        return { html: leadingHeader + html + trailingHeaders, durations };
    }

    renderQuestionCard(question, options) {
        const opts = options || {};
        const compact = opts.compact || false;
        const showContext = opts.showContext !== false;
        const showSource = opts.showSource !== false;
        const showDesc = opts.showDesc !== false;

        const nodeLabel = question.nodeLabel || '';
        const questionText = question.questionText || '';
        const questionContext = question.questionContext || '';
        const source = question.source;
        const answers = question.answers || [];

        const isForced = question.isForced === true;
        const forcedValue = question.forcedValue || null;

        const answerCards = answers.map(a => ({
            ...a,
            disabled: a.disabled === true || a.reachable === false,
            disabledReason: a.disabledReason || null,
            isForced: isForced && a.value === forcedValue,
        }));

        let sourceHtml = '';
        if (showSource && source) {
            sourceHtml = `<div class="question-source"><a href="${this._esc(source.url)}" target="_blank" rel="noopener">${this._esc(source.label)} \u2197</a></div>`;
        }

        const answersHtml = answerCards.map((a, i) => {
            const cls = a.isForced ? ' forced-selected' : (a.disabled ? ' disabled' : '');
            const badgeHtml = a.disabled && a.disabledReason
                ? `<div class="disabled-badge">${this._esc(a.disabledReason)}</div>` : '';
            return `<div class="answer-card${cls}" data-aidx="${i}">
                <div class="label">${this._esc(a.label)}</div>
                ${showDesc && a.desc ? `<div class="desc">${this._md(a.desc)}</div>` : ''}
                ${badgeHtml}
            </div>`;
        }).join('');

        const continueHtml = isForced
            ? `<div class="forced-continue"><button class="btn btn-primary forced-continue-btn">Continue</button></div>` : '';

        const innerHtml = `<div class="tl-vline-seg"></div><div class="tl-dot"></div><div class="tl-hline"></div>
            <div class="timeline-top-row"><span class="timeline-param-wrap"><span class="timeline-param-dim">${this._esc(nodeLabel)}<button class="tl-undo tl-undo-spacer" aria-hidden="true">&#x21a9;&#xFE0E;</button></span></span></div>
            <div class="question-text">${this._esc(questionText)}</div>
            ${showContext && questionContext ? `<div class="question-context">${this._md(questionContext)}</div>` : ''}
            ${sourceHtml}
            <div class="answers">${answersHtml}</div>
            ${continueHtml}`;

        const html = `<div class="${this.cardClass}${compact ? ' compact' : ''}${isForced ? ' forced-card' : ''}">${innerHtml}</div>`;

        return { html, innerHtml, answerCards, isForced };
    }

    _wireAnswerButtons(container) {
        if (this._customWireButtons) {
            this._customWireButtons(container, (count) => this.addItems(count));
            return;
        }
        const cards = this._currentAnswerCards || [];
        container.querySelectorAll('.answer-card[data-aidx]').forEach(cardEl => {
            const idx = parseInt(cardEl.dataset.aidx, 10);
            const data = cards[idx];
            if (data && data.count != null) {
                cardEl.addEventListener('click', () => this.addItems(data.count));
            }
        });
    }

    render() {
        if (this._customRender) {
            this._customRender();
            this._adjustVlines();
            return;
        }

        const dp = this.dp;
        const events = dp.getEvents();

        let nextStage = null;
        if (dp.hasMoreQuestions() && dp.stageForIndex) {
            nextStage = dp.stageForIndex(dp.getCurrentCount());
        }

        const { html } = this.renderTimeline(events, { nextStage });
        this.timelineEl.innerHTML = html;

        if (dp.hasMoreQuestions()) {
            const qData = dp.getQuestion();
            const qResult = this.renderQuestionCard(qData);
            this._currentAnswerCards = qResult.answerCards;
            this.questionZoneEl.innerHTML = qResult.html;
            this._wireAnswerButtons(this.questionZoneEl);
        } else {
            this.questionZoneEl.innerHTML = '<p style="color:var(--text-dim); padding: 1rem 0;">All items added.</p>';
        }

        this._adjustVlines();

        if (dp.onRender) dp.onRender();
    }

    _adjustVlines() {
        if (this.questionZoneEl && this._headerEl) {
            this.questionZoneEl.style.paddingBottom = (window.scrollY + window.innerHeight) + 'px';
        }
        this._updateScrollPadding();

        const events = this.timelineEl.querySelectorAll('.timeline-event');
        const dots = [];
        const segs = [];
        const parents = [];

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
            segs[i].style.height = Math.max(0, currCenter - prevCenter) + 'px';
        }

        const card = this.questionZoneEl ? this.questionZoneEl.querySelector('.' + this.cardClass) : null;
        if (!card) return;
        const qzDot = card.querySelector('.tl-dot');
        const qzSeg = card.querySelector('.tl-vline-seg');
        if (!qzDot || !qzSeg) return;

        if (dots.length === 0) { qzSeg.style.display = 'none'; return; }

        const lastRect = dots[dots.length - 1].getBoundingClientRect();
        const qzDotRect = qzDot.getBoundingClientRect();
        const cardRect = card.getBoundingClientRect();
        const prevCenter = lastRect.top + lastRect.height / 2;
        const currCenter = qzDotRect.top + qzDotRect.height / 2;
        qzSeg.style.display = '';
        qzSeg.style.top = (prevCenter - cardRect.top) + 'px';
        qzSeg.style.height = Math.max(0, currCenter - prevCenter) + 'px';
    }

    _updateScrollPadding() {
        if (!this._headerEl || !this.questionZoneEl) return;
        const card = this._getCard();
        const frontier = this.timelineEl && this.timelineEl.querySelector('.frontier-event');
        const anchor = card || frontier;
        if (!anchor) { this.questionZoneEl.style.paddingBottom = ''; return; }

        // Force the questionZone back into layout before reading scrollHeight, since
        // the host page sets `display: none` when it has no card to render and
        // padding-bottom on a display:none element doesn't contribute to docHeight.
        if (this.questionZoneEl.style.display === 'none') {
            this.questionZoneEl.style.display = 'block';
        }

        const currentPadding = parseFloat(this.questionZoneEl.style.paddingBottom) || 0;
        const headerHeight = this._headerEl.offsetHeight;
        const desiredOffset = 50;
        const anchorTop = anchor.getBoundingClientRect().top + window.scrollY;
        const viewportHeight = window.innerHeight;
        const docHeight = document.documentElement.scrollHeight;
        const naturalHeight = docHeight - currentPadding;

        let neededPadding;
        if (card) {
            // Full mode: pad so the card can scroll up to within desiredOffset of
            // the header bottom. The card is part of the natural layout and itself
            // takes substantial height, so this typically leaves modest padding.
            neededPadding = anchorTop + viewportHeight - headerHeight - desiredOffset - naturalHeight;
        } else {
            // Compact mode: the frontier is in the timeline (well above the
            // questionZone), so an "anchor scrolls to top" target would inflate the
            // padding far beyond the natural content. Pad just enough to fill the
            // viewport (footer lands at the bottom in steady state) — but never
            // shrink docHeight below the current scrollY+viewport. If we did, the
            // browser would clamp scrollY back, and a render() that happens mid
            // click animation (in _runScrollOnly) would snap the page back to the
            // top before the scroll animation kicked in.
            neededPadding = window.scrollY + viewportHeight - naturalHeight;
        }
        const appliedPadding = neededPadding > 0 ? neededPadding : 0;
        this.questionZoneEl.style.paddingBottom = appliedPadding + 'px';
    }
}

// ---------------------------------------------------------------------------
// FlipGroup — FLIP animation helper, manages Web Animations API instances
// ---------------------------------------------------------------------------

class FlipGroup {
    constructor(duration, easing) {
        this._opts = { duration, easing: easing || 'ease-in-out', fill: 'none' };
        this._animations = [];
    }

    slide(el, fromY, options) {
        const opts = options || {};
        const dy = fromY - el.getBoundingClientRect().top;
        const animOpts = this._opts;

        if (Math.abs(dy) >= 1) {
            this._animations.push(el.animate(
                [{ transform: `translateY(${dy}px)` }, { transform: 'translateY(0)' }],
                animOpts
            ));
        }

        if (opts.fade) {
            this._animations.push(el.animate(
                [{ opacity: '0' }, { opacity: '1' }],
                animOpts
            ));
        }

        if (opts.fadeChildren) {
            for (const c of opts.fadeChildren) {
                this._animations.push(c.animate(
                    [{ opacity: '0', offset: 0 }, { opacity: '0', offset: 0.5 }, { opacity: '1', offset: 1 }],
                    animOpts
                ));
            }
        }

        return dy;
    }

    segment(seg, origTop, origHeight, deltaDy) {
        this._animations.push(seg.animate([
            { top: `${origTop - deltaDy}px`, height: `${Math.max(0, origHeight + deltaDy)}px` },
            { top: `${origTop}px`, height: `${origHeight}px` }
        ], this._opts));
    }

    get finished() {
        if (this._animations.length === 0) return Promise.resolve();
        return Promise.all(this._animations.map(a => a.finished));
    }

    cancel() {
        this._animations.forEach(a => { try { a.cancel(); } catch (_) {} });
    }
}

// ---------------------------------------------------------------------------
// TimelineAnimator — animation core. No scroll room, direct scroll targets,
// Web Animations API for elements, rAF only for scroll + old card.
// ---------------------------------------------------------------------------

class TimelineAnimator extends TimelineRenderer {
    constructor(options) {
        super(options);

        this.morphDuration = options.morphDuration || 600;
        this.morphAnimating = false;

        this._oldCardEl = null;
        this._headerEl = options.headerEl || null;
        this._beforeAnimate = options.beforeAnimate || null;

        this._currentFlip = null;
        this._scrollRafId = null;
    }

    setMorphDuration(ms) { this.morphDuration = ms; }
    isAnimating() { return this.morphAnimating; }

    reset() {
        if (this._currentFlip) { this._currentFlip.cancel(); this._currentFlip = null; }
        if (this._scrollRafId) { cancelAnimationFrame(this._scrollRafId); this._scrollRafId = null; }
        this.morphAnimating = false;
        this.containerEl.classList.remove('flip-animating');
        if (this._oldCardEl) { this._oldCardEl.remove(); this._oldCardEl = null; }
        if (this.outcomeEl) this.outcomeEl.style.cssText = '';
        this.render();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    _captureStartState(card) {
        const outcomeVisible = this.outcomeEl && this.outcomeEl.style.display !== 'none' && this.outcomeEl.innerHTML.trim() !== '';
        const topRow = card.querySelector('.timeline-top-row');
        const paramDim = card.querySelector('.timeline-param-dim');
        const cardRect = card.getBoundingClientRect();
        return {
            startCardRect: cardRect,
            startCardContent: card.innerHTML,
            startCardClassName: card.className,
            startTopRowHeight: topRow ? topRow.offsetHeight : 0,
            startLabelInternalOffset: paramDim ? paramDim.getBoundingClientRect().top - cardRect.top : 0,
            startOutcomeTop: this.outcomeEl ? this.outcomeEl.getBoundingClientRect().top : 0,
            startOutcomeVisible: outcomeVisible,
        };
    }

    addItems(count) {
        if (this.morphAnimating) return;
        const card = this._getCard();
        if (!card) return;
        this.morphAnimating = true;

        const dp = this.dp;
        const start = this._captureStartState(card);

        this._runAnimation({
            ...start,
            applyEndState: () => {
                dp.setCurrentCount(dp.getCurrentCount() + count);
                if (dp.onItemsAdded) dp.onItemsAdded(count);
                this.render();
            },
            onComplete: null,
        });
    }

    animateTransition({ applyChange, onComplete, fadeFooterIn }) {
        if (this.morphAnimating) return false;
        const card = this._getCard();
        if (!card) {
            // Compact ("question mode off") path: there's no question card, but the
            // .frontier-event in the timeline is the inline next-question. Run a
            // scroll-only animation anchored on that frontier so the new frontier
            // ends up at the same viewport position as the old one. No FLIP slides
            // on timeline elements — they appear in place at the new layout.
            return this._runScrollOnly({ applyChange, onComplete });
        }
        this.morphAnimating = true;

        const start = this._captureStartState(card);

        this._runAnimation({
            ...start,
            applyEndState: () => {
                applyChange();
                this.render();
            },
            onComplete,
            fadeFooterIn,
        });

        return true;
    }

    // Linear-with-offset-and-cap formula. See `_runAnimation` for the rationale.
    _computeDuration(H) {
        const BASE_OFFSET = 600;
        const TARGET_SPEED = 0.5;
        return Math.max(1, Math.round(Math.max(
            H / TARGET_SPEED,
            BASE_OFFSET + H
        )));
    }

    _runScrollOnly({ applyChange, onComplete }) {
        const oldFrontier = this.timelineEl.querySelector('.frontier-event');
        if (!oldFrontier) {
            applyChange();
            this.render();
            if (onComplete) onComplete();
            return false;
        }

        const scrollStart = window.scrollY;
        const oldRect = oldFrontier.getBoundingClientRect();

        this.morphAnimating = true;
        applyChange();
        this.render();

        // The host's `update()` briefly sets `display:none` on questionZone before
        // we re-render, which removes its (huge) padding from layout. If docHeight
        // dips below scrollStart+viewport during that window, the browser clamps
        // scrollY to 0 — a flash the user sees as the page snapping back to top
        // before our scroll animation kicks in. Force questionZone visible with
        // enough padding to keep scrollStart feasible, then restore scrollY.
        if (this.questionZoneEl) {
            if (this.questionZoneEl.style.display === 'none') {
                this.questionZoneEl.style.display = 'block';
            }
            const required = scrollStart + window.innerHeight;
            const docH = document.documentElement.scrollHeight;
            if (docH < required) {
                const currentPadding = parseFloat(this.questionZoneEl.style.paddingBottom) || 0;
                this.questionZoneEl.style.paddingBottom = (currentPadding + (required - docH)) + 'px';
            }
        }
        if (window.scrollY !== scrollStart) {
            window.scrollTo({ top: scrollStart, behavior: 'instant' });
        }

        const newFrontier = this.timelineEl.querySelector('.frontier-event');
        if (!newFrontier) {
            this.morphAnimating = false;
            if (onComplete) onComplete();
            return true;
        }
        const newRect = newFrontier.getBoundingClientRect();
        const newDocTop = newRect.top + window.scrollY;

        // Compute scroll delta in document coordinates (robust to any mid-render
        // scroll clamps): we want the new frontier to land at oldRect.top in the
        // viewport, i.e. final scrollY = newDocTop - oldRect.top.
        let scrollDelta = (newDocTop - oldRect.top) - scrollStart;

        // Extend questionZone padding just-in-time if the page isn't tall enough
        // for the final scroll target. _updateScrollPadding only pads to fill the
        // viewport in compact mode; the click animation typically needs more.
        if (this.questionZoneEl && scrollDelta > 0) {
            const targetScroll = scrollStart + scrollDelta;
            const requiredDoc = targetScroll + window.innerHeight;
            const docHeight = document.documentElement.scrollHeight;
            if (requiredDoc > docHeight) {
                const currentPadding = parseFloat(this.questionZoneEl.style.paddingBottom) || 0;
                this.questionZoneEl.style.paddingBottom = (currentPadding + (requiredDoc - docHeight)) + 'px';
            }
        }

        const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
        if (scrollStart + scrollDelta > maxScroll) scrollDelta = Math.max(0, maxScroll - scrollStart);
        if (scrollStart + scrollDelta < 0) scrollDelta = -scrollStart;

        if (Math.abs(scrollDelta) < 1) {
            this.morphAnimating = false;
            if (onComplete) onComplete();
            return true;
        }

        const DURATION = this._computeDuration(oldRect.height);

        let startTime = 0;
        const tick = (now) => {
            if (!startTime) startTime = now;
            const t = Math.min((now - startTime) / DURATION, 1);
            const e = this._ease(t);
            window.scrollTo({ top: scrollStart + scrollDelta * e, behavior: 'instant' });
            if (t < 1) {
                this._scrollRafId = requestAnimationFrame(tick);
            } else {
                this._scrollRafId = null;
                this.morphAnimating = false;
                if (onComplete) onComplete();
            }
        };
        this._scrollRafId = requestAnimationFrame(tick);
        return true;
    }

    // ------------------------------------------------------------------
    // Core animation — FLIP with Web Animations API + rAF scroll
    //
    // 1. Apply end state directly (no scroll room inflation)
    // 2. Snapshot end positions, compute FLIP deltas
    // 3. Compute scroll target directly from end-state layout
    // 4. Animate elements via FlipGroup (Web Animations API, auto-cleanup)
    // 5. Animate scroll + old card via rAF
    // 6. Cleanup: remove old card, done
    // ------------------------------------------------------------------

    _runAnimation({ startCardRect, startCardContent, startCardClassName, startTopRowHeight, startLabelInternalOffset, startOutcomeTop, startOutcomeVisible, applyEndState, onComplete, fadeFooterIn }) {
        const EASING = 'ease-in-out';

        const timeline = this.timelineEl;
        const outcomeCard = this.outcomeEl;
        const oldEventCount = timeline.querySelectorAll('.timeline-event').length;
        const oldHeaderCount = timeline.querySelectorAll('.timeline-stage-header').length;

        const footerEl = this.containerEl.querySelector('.map-actions');
        const footerOriginalTop = footerEl ? footerEl.getBoundingClientRect().top : null;

        // Derive DURATION from H_old (the old card's height) via _computeDuration:
        // it takes the max of (H_old / TARGET_SPEED) and (BASE_OFFSET + H_old), so the
        // dominant viewport motion is capped at TARGET_SPEED px/ms but short cards
        // get an additive pad to keep secondary motions (children sliding ~H_event,
        // scroll ~H_event, etc.) from appearing rushed.
        const DURATION = this._computeDuration(startCardRect.height);

        // --- 1. Apply end state (no inflation, natural layout) ---
        const savedScrollY = window.scrollY;
        this.containerEl.classList.add('flip-animating');
        this.containerEl.style.setProperty('--flip-duration', DURATION + 'ms');
        applyEndState();
        if (window.scrollY !== savedScrollY) {
            window.scrollTo({ top: savedScrollY, behavior: 'instant' });
        }

        // --- 2. Snapshot end positions ---
        const newCard = this._getCard();
        const newCardRect = newCard ? newCard.getBoundingClientRect() : null;
        const newEvents = Array.from(timeline.querySelectorAll('.timeline-event')).slice(oldEventCount);
        const newHeaders = Array.from(timeline.querySelectorAll('.timeline-stage-header')).slice(oldHeaderCount);

        const outcomeNowVisible = outcomeCard && outcomeCard.style.display !== 'none' && outcomeCard.innerHTML.trim() !== '';
        const outcomeAppearing = outcomeNowVisible && !startOutcomeVisible;
        const endOutcomeRect = outcomeCard ? outcomeCard.getBoundingClientRect() : null;

        // --- 3. Compute scroll delta from content shift ---
        const scrollStart = window.scrollY;
        let scrollDelta = 0;

        if (newCardRect) {
            scrollDelta = newCardRect.top - startCardRect.top;
        } else if (newEvents.length > 0) {
            scrollDelta = newEvents[newEvents.length - 1].getBoundingClientRect().bottom - startCardRect.top;
        } else if (outcomeAppearing && endOutcomeRect) {
            scrollDelta = endOutcomeRect.top - startCardRect.top;
        }

        if (this._headerEl) {
            const headerBottom = this._headerEl.getBoundingClientRect().bottom;
            const targetTop = newCardRect ? newCardRect.top
                            : (outcomeAppearing && endOutcomeRect) ? endOutcomeRect.top
                            : (newEvents.length > 0) ? newEvents[0].getBoundingClientRect().top
                            : null;
            if (targetTop !== null) {
                const desiredTop = headerBottom + 50;
                if (scrollDelta > 0) {
                    const maxShift = targetTop - desiredTop;
                    if (maxShift < scrollDelta) {
                        scrollDelta = Math.max(0, maxShift);
                    }
                }
                if (targetTop < desiredTop) {
                    scrollDelta = Math.min(scrollDelta, targetTop - desiredTop);
                }
            }
        }

        const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
        if (scrollStart + scrollDelta > maxScroll) {
            scrollDelta = Math.max(0, maxScroll - scrollStart);
        }
        if (scrollStart + scrollDelta < 0) {
            scrollDelta = -scrollStart;
        }

        // --- 4. FLIP animations via FlipGroup (Web Animations API) ---
        const flip = new FlipGroup(DURATION, EASING);
        this._currentFlip = flip;

        const eventDys = [];
        const stripSel = this._stripFromAnimation;
        newEvents.forEach(el => {
            const fadeChildren = Array.from(el.querySelectorAll(
                '.tl-pills, .tl-undo, .timeline-year, .timeline-headline, .timeline-desc, .timeline-slider'
            )).filter(c => !stripSel || !c.matches(stripSel));
            const dy = flip.slide(el, startCardRect.top, { fadeChildren });
            eventDys.push(dy);

            if (startLabelInternalOffset != null && stripSel) {
                const labelEl = el.querySelector(stripSel);
                if (labelEl) {
                    const elRect = el.getBoundingClientRect();
                    const labelRect = labelEl.getBoundingClientRect();
                    const newOffset = labelRect.top - elRect.top;
                    const compensation = startLabelInternalOffset - newOffset;
                    if (Math.abs(compensation) >= 1) {
                        flip._animations.push(labelEl.animate(
                            [{ transform: `translateY(${compensation}px)` }, { transform: 'translateY(0)' }],
                            { duration: DURATION, easing: EASING, fill: 'none' }
                        ));
                    }
                }
            }
        });

        newHeaders.forEach(el => {
            flip.slide(el, startCardRect.top, { fade: true });
        });

        let newCardDy = null;
        if (newCard) {
            newCardDy = flip.slide(newCard, startCardRect.top + startCardRect.height, { fade: true });
        }

        if (footerEl && footerOriginalTop !== null) {
            const footerDy = footerOriginalTop - footerEl.getBoundingClientRect().top;
            if (Math.abs(footerDy) > 1) {
                footerEl.animate(
                    [{ transform: `translateY(${footerDy}px)` }, { transform: 'translateY(0)' }],
                    { duration: 750, easing: 'ease-out', fill: 'none' }
                );
            }
        }

        let outcomeDy = null;
        if (outcomeAppearing && outcomeCard && endOutcomeRect && !newCard) {
            outcomeDy = flip.slide(outcomeCard, startCardRect.top + startCardRect.height, { fade: true });
        } else if (!outcomeAppearing && outcomeCard && endOutcomeRect) {
            const ody = startOutcomeTop - endOutcomeRect.top;
            if (Math.abs(ody) > 1) {
                flip.slide(outcomeCard, startOutcomeTop);
            }
        }

        // Vline segments: stretch between displaced dots
        newEvents.forEach((el, i) => {
            const seg = el.querySelector('.tl-vline-seg');
            if (!seg || seg.style.display === 'none') return;
            const dyCurr = eventDys[i] || 0;
            const dyPrev = i > 0 ? (eventDys[i - 1] || 0) : 0;
            const deltaDy = dyCurr - dyPrev;
            if (Math.abs(deltaDy) < 1) return;
            flip.segment(seg, parseFloat(seg.style.top) || 0, parseFloat(seg.style.height) || 0, deltaDy);
        });

        if (newCard) {
            const seg = newCard.querySelector('.tl-vline-seg');
            if (seg && seg.style.display !== 'none') {
                const dyCard = newCardDy ?? 0;
                const dyPrev = eventDys.length > 0 ? eventDys[eventDys.length - 1] : 0;
                const deltaDy = dyCard - dyPrev;
                if (Math.abs(deltaDy) > 1) {
                    flip.segment(seg, parseFloat(seg.style.top) || 0, parseFloat(seg.style.height) || 0, deltaDy);
                }
            }
        }

        // --- Old card clone (managed by rAF, not FlipGroup) ---
        let oldCardEl = null;
        if (startCardContent) {
            oldCardEl = document.createElement('div');
            oldCardEl.className = startCardClassName || this.cardClass;
            oldCardEl.innerHTML = startCardContent;
            oldCardEl.style.cssText =
                `position:fixed;top:${startCardRect.top}px;left:${startCardRect.left}px;` +
                `width:${startCardRect.width}px;height:${startCardRect.height}px;` +
                `z-index:1;pointer-events:none;overflow:hidden;`;
            oldCardEl.querySelectorAll('.tl-dot, .tl-hline, .tl-vline-seg').forEach(el => {
                el.style.display = 'none';
            });
            if (this._stripFromAnimation) {
                oldCardEl.querySelectorAll(this._stripFromAnimation).forEach(el => {
                    el.style.visibility = 'hidden';
                });
            }
            if (startTopRowHeight) {
                const cloneTopRow = oldCardEl.querySelector('.timeline-top-row');
                if (cloneTopRow) {
                    cloneTopRow.style.height = startTopRowHeight + 'px';
                    cloneTopRow.style.overflow = 'hidden';
                }
            }
            this.containerEl.appendChild(oldCardEl);
            this._oldCardEl = oldCardEl;

            // Forced-continue button (only present on forced questions): fade it out
            // explicitly so it visibly disappears during the animation. Independent of
            // any global opacity on the card itself. fill:'forwards' keeps it at opacity
            // 0 until the clone is removed, avoiding a 1-frame flash if WAAPI ends
            // before the rAF cleanup tick.
            const continueEl = oldCardEl.querySelector('.forced-continue');
            if (continueEl) {
                flip._animations.push(continueEl.animate(
                    [{ opacity: '1' }, { opacity: '0' }],
                    { duration: DURATION, easing: EASING, fill: 'forwards' }
                ));
            }
        }

        // --- 5. rAF loop: scroll + old card only ---
        const refDy = newCardDy !== null ? newCardDy : outcomeDy;
        const refTop = newCardDy !== null ? newCardRect.top
                     : (outcomeDy !== null ? endOutcomeRect.top : null);

        // When there's no new card or outcome to anchor against (e.g. clicking
        // Start in compact mode — intro card disappears, only inline timeline
        // events remain), the rAF tick has nothing to drive the old card's
        // slide-up + soft mask. Fade it out instead so it doesn't sit static
        // under the incoming timeline event.
        const oldCardFadeOnly = oldCardEl && refDy === null && refTop === null;
        if (oldCardFadeOnly) {
            flip._animations.push(oldCardEl.animate(
                [{ opacity: '1' }, { opacity: '0' }],
                { duration: DURATION, easing: EASING, fill: 'forwards' }
            ));
        }

        if (oldCardEl) oldCardEl.style.willChange = 'transform';

        let startTime = 0;
        let lastMaskClip = -1;
        const tick = (now) => {
            if (!startTime) startTime = now;
            const elapsed = now - startTime;
            const t = Math.min(elapsed / DURATION, 1);
            const e = this._ease(t);

            if (Math.abs(scrollDelta) > 1) {
                window.scrollTo({ top: scrollStart + scrollDelta * e, behavior: 'instant' });
            }

            if (oldCardEl) {
                if (refDy !== null && refTop !== null) {
                    const scrollAdj = scrollDelta * e;
                    const refVisualTop = refTop + refDy * (1 - e) - scrollAdj;
                    const dy = refVisualTop - startCardRect.height - startCardRect.top;
                    oldCardEl.style.transform = `translateY(${dy}px)`;
                    const clipTop = Math.max(0, -dy) + (startTopRowHeight || 0);
                    const roundedClip = Math.round(clipTop);
                    if (roundedClip !== lastMaskClip) {
                        lastMaskClip = roundedClip;
                        if (roundedClip > 0) {
                            const fade = `linear-gradient(to bottom, transparent ${roundedClip}px, black ${roundedClip + 40}px)`;
                            oldCardEl.style.webkitMaskImage = fade;
                            oldCardEl.style.maskImage = fade;
                        } else {
                            oldCardEl.style.webkitMaskImage = '';
                            oldCardEl.style.maskImage = '';
                        }
                    }
                }
            }

            if (t < 1) {
                this._scrollRafId = requestAnimationFrame(tick);
            } else {
                // --- 6. Cleanup ---
                this._scrollRafId = null;
                if (oldCardEl) { oldCardEl.style.willChange = ''; oldCardEl.remove(); this._oldCardEl = null; }
                this._currentFlip = null;

                const footer = this.containerEl.querySelector('.map-actions');
                if (footer && fadeFooterIn) {
                    footer.style.opacity = '0';
                    footer.style.transition = 'opacity 0.35s ease';
                    requestAnimationFrame(() => {
                        footer.style.opacity = '1';
                        footer.addEventListener('transitionend', () => {
                            footer.style.transition = '';
                            footer.style.opacity = '';
                        }, { once: true });
                    });
                }

                this.containerEl.classList.remove('flip-animating');
                this.containerEl.style.removeProperty('--flip-duration');
                this.morphAnimating = false;
                this._updateScrollPadding();
                if (onComplete) onComplete();
            }
        };

        if (this._beforeAnimate) this._beforeAnimate();
        this._scrollRafId = requestAnimationFrame(tick);
    }

    _ease(t) {
        let lo = 0, hi = 1;
        for (let i = 0; i < 15; i++) {
            const mid = (lo + hi) / 2;
            const m = 1 - mid;
            const x = 3 * m * m * mid * 0.42 + 3 * m * mid * mid * 0.58 + mid * mid * mid;
            if (x < t) lo = mid; else hi = mid;
        }
        const u = (lo + hi) / 2;
        return 3 * u * u - 2 * u * u * u;
    }
}
