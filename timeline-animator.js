'use strict';

class TimelineAnimator {
    constructor(options) {
        this.containerEl = options.containerEl;
        this.timelineEl = options.timelineEl;
        this.questionZoneEl = options.questionZoneEl;
        this.outcomeEl = options.outcomeEl || null;
        this.dp = options.dataProvider;

        this.cardClass = options.cardClass || 'question-card';
        this.contentSelector = options.contentSelector || '.question-text, .question-context, .answers';

        this.morphDuration = options.morphDuration || 600;
        this.morphAnimating = false;

        this._customRender = options.render || null;
        this._customWireButtons = options.wireAnswerButtons || null;
        this._stripFromAnimation = options.stripFromAnimation || null;

        this.stages = options.stages || null;
        this._currentAnswerCards = null;
        this._scrollMinHeight = 0;
        this._oldCardEl = null;
        this._beforeAnimate = options.beforeAnimate || null;
        this._headerEl = options.headerEl || null;

        this._elementVisibility = {
            oldCard: true,
            newEvents: true,
            newCard: true,
            outcome: true,
            scroll: true,
            stageHeaders: true,
            dot: true,
            hline: true,
            vline: true,
        };
    }

    setMorphDuration(ms) { this.morphDuration = ms; }
    isAnimating() { return this.morphAnimating; }

    _getScrollRoomEl() {
        return this.containerEl.querySelector('.map-screen') || this.containerEl;
    }

    _ensureScrollRoom(extraPx) {
        const el = this._getScrollRoomEl();
        const needed = window.scrollY + window.innerHeight + extraPx;
        this._scrollMinHeight = Math.max(this._scrollMinHeight, needed);
        el.style.minHeight = this._scrollMinHeight + 'px';
    }

    _releaseScrollRoom() {
        if (this._scrollMinHeight <= 0) return;
        const el = this._getScrollRoomEl();

        el.style.minHeight = '';
        this._scrollMinHeight = 0;

        const naturalHeight = this.containerEl.scrollHeight;
        const maxScroll = Math.max(0, naturalHeight - window.innerHeight);
        if (window.scrollY > maxScroll + 5) {
            console.warn('[anim] scroll past content after animation:', { scrollY: Math.round(window.scrollY), maxScroll: Math.round(maxScroll), naturalHeight, diff: Math.round(window.scrollY - maxScroll) });
        }
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

    // ---- Rendering methods ----

    renderStageHeader(stageId) {
        const info = this.stages ? this.stages[stageId] : null;
        if (!info) return '';
        return `<div class="timeline-stage-header"><div class="tl-stage-bg"></div><span class="timeline-stage-label">${this._esc(info.label)}</span></div>`;
    }

    renderPills(event) {
        if (!event.siblings || event.siblings.length < 2) {
            if (!event.paramLabel) return '';
            return `<span class="timeline-param-wrap"><span class="timeline-param-dim">${this._esc(event.nodeLabel)}</span><span class="timeline-param">${this._esc(event.paramLabel)}</span></span>`;
        }
        const allLocked = event.isLocked;
        const pills = event.siblings.map(s => {
            const active = event.isFrontier ? false : s.value === event.selectedValue;
            if (event.isFrontier) {
                if (s.disabled || !s.reachable) return `<span class="tl-pill disabled">${this._esc(s.label)}</span>`;
                return `<span class="tl-pill" data-pathaction="frontier" data-dim="${this._esc(s.nodeId)}" data-val="${this._esc(s.value)}">${this._esc(s.label)}</span>`;
            }
            if (active) {
                return `<span class="tl-pill active${allLocked ? ' locked' : ''}" data-pathaction="unclick" data-dim="${this._esc(event.nodeId)}">${this._esc(s.label)}</span>`;
            }
            if (allLocked || s.disabled || !s.reachable) {
                return `<span class="tl-pill disabled">${this._esc(s.label)}</span>`;
            }
            return `<span class="tl-pill" data-pathaction="change" data-dim="${this._esc(s.nodeId)}" data-val="${this._esc(s.value)}">${this._esc(s.label)}</span>`;
        }).join('');
        return `<span class="timeline-param-wrap"><span class="timeline-param-dim">${this._esc(event.nodeLabel)}</span><span class="tl-pills">${pills}</span></span>`;
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
        const descHtml = (expanded && event.description) ? `<div class="timeline-desc">${this._esc(event.description)}</div>` : '';
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
                ${showDesc && a.desc ? `<div class="desc">${this._esc(a.desc)}</div>` : ''}
                ${badgeHtml}
            </div>`;
        }).join('');

        const continueHtml = isForced
            ? `<div class="forced-continue"><button class="btn btn-primary forced-continue-btn">Continue</button></div>` : '';

        const innerHtml = `<div class="tl-vline-seg"></div><div class="tl-dot"></div><div class="tl-hline"></div>
            <div class="timeline-top-row"><span class="timeline-param-wrap"><span class="timeline-param-dim">${this._esc(nodeLabel)}</span></span></div>
            <div class="question-text">${this._esc(questionText)}</div>
            ${showContext && questionContext ? `<div class="question-context">${this._esc(questionContext)}</div>` : ''}
            ${sourceHtml}
            <div class="answers">${answersHtml}</div>
            ${continueHtml}`;

        const html = `<div class="${this.cardClass}${compact ? ' compact' : ''}${isForced ? ' forced-card' : ''}">${innerHtml}</div>`;

        return { html, innerHtml, answerCards, isForced };
    }

    // ---- Core methods ----

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

    reset() {
        this.morphAnimating = false;
        this.containerEl.classList.remove('flip-animating');
        if (this._oldCardEl) { this._oldCardEl.remove(); this._oldCardEl = null; }
        [this.timelineEl, this.questionZoneEl, this.outcomeEl].forEach(el => {
            if (el) { el.style.transform = ''; el.style.opacity = ''; }
        });
        if (this.outcomeEl) this.outcomeEl.style.cssText = '';
        this.containerEl.style.minHeight = '';
        this._scrollMinHeight = 0;
        this.render();
        window.scrollTo({ top: 0, behavior: 'smooth' });
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

    // ---- Pure FLIP animation ----
    //
    // All decorations (dots, lines) are real DOM elements now.
    // The old card copy includes them naturally. No manual decoration creation needed.
    //
    // 1. Apply end state (render the final DOM)
    // 2. Snapshot end positions, compute FLIP deltas
    // 3. Create old card copy, displace new elements to start positions
    // 4. Animate all elements from start → end on a single easing curve
    // 5. Cleanup: remove old card copy, clear inline styles

    _runAnimation({ startCardRect, startCardContent, startCardClassName, startOutcomeTop, startOutcomeVisible, applyEndState, onComplete, fadeFooterIn }) {
        const DURATION = this.morphDuration;
        const vis = this._elementVisibility;

        const timeline = this.timelineEl;
        const outcomeCard = this.outcomeEl;
        const oldEventCount = timeline.querySelectorAll('.timeline-event').length;
        const oldHeaderCount = timeline.querySelectorAll('.timeline-stage-header').length;

        // --- Phase 1: Apply end state ---
        this.containerEl.classList.add('flip-animating');
        const footer = this.containerEl.querySelector('.map-actions');
        const footerTopBefore = footer ? footer.getBoundingClientRect().top : null;
        this._ensureScrollRoom(5000);
        applyEndState();
        let footerDrift = 0;
        if (footer && footerTopBefore !== null) {
            const footerTopNow = footer.getBoundingClientRect().top;
            footerDrift = footerTopNow - footerTopBefore;
            if (Math.abs(footerDrift) > 1) {
                footer.style.transform = `translateY(${-footerDrift}px)`;
            }
        }

        // --- Phase 2: Snapshot end positions ---
        const newCard = this._getCard();
        const newCardRect = newCard ? newCard.getBoundingClientRect() : null;
        const endOutcomeTop = outcomeCard ? outcomeCard.getBoundingClientRect().top : 0;
        const newEvents = Array.from(timeline.querySelectorAll('.timeline-event')).slice(oldEventCount);
        const newHeaders = Array.from(timeline.querySelectorAll('.timeline-stage-header')).slice(oldHeaderCount);

        const outcomeNowVisible = outcomeCard && outcomeCard.style.display !== 'none' && outcomeCard.innerHTML.trim() !== '';
        const outcomeAppearing = outcomeNowVisible && !startOutcomeVisible;
        const endOutcomeRect = outcomeCard ? outcomeCard.getBoundingClientRect() : null;

        let totalShift = 0;
        if (newCardRect) {
            totalShift = newCardRect.top - startCardRect.top;
        } else if (newEvents.length > 0) {
            const lastEvt = newEvents[newEvents.length - 1];
            totalShift = lastEvt.getBoundingClientRect().bottom - startCardRect.top;
        } else if (outcomeAppearing && endOutcomeRect) {
            totalShift = endOutcomeRect.top - startCardRect.top;
        }

        let shiftWasCapped = false;
        if (this._headerEl && totalShift > 0) {
            const headerBottom = this._headerEl.getBoundingClientRect().bottom;
            const targetTop = newCardRect ? newCardRect.top
                            : (outcomeAppearing && endOutcomeRect) ? endOutcomeRect.top
                            : (newEvents.length > 0) ? newEvents[0].getBoundingClientRect().top
                            : null;
            if (targetTop !== null) {
                const maxShift = targetTop - headerBottom - 50;
                if (maxShift < totalShift) {
                    totalShift = Math.max(0, maxShift);
                    shiftWasCapped = true;
                }
            }
        }

        // --- Phase 3: Create old card copy (content only, no timeline decorations) ---
        if (startCardContent) {
            this._oldCardEl = document.createElement('div');
            this._oldCardEl.className = startCardClassName || this.cardClass;
            this._oldCardEl.innerHTML = startCardContent;
            this._oldCardEl.style.cssText =
                `position:fixed;top:${startCardRect.top}px;left:${startCardRect.left}px;` +
                `width:${startCardRect.width}px;height:${startCardRect.height}px;` +
                `z-index:1;pointer-events:none;overflow:hidden;`;
            this._oldCardEl.querySelectorAll('.tl-dot, .tl-hline, .tl-vline-seg').forEach(el => {
                el.style.display = 'none';
            });
            this.containerEl.appendChild(this._oldCardEl);
        }

        // --- Phase 4: Pre-compute FLIP deltas ---

        // New events: slide from old card position; fade content only (dot/hline/vline-seg stay visible)
        const eventFlips = [];
        newEvents.forEach(el => {
            const dy = startCardRect.top - el.getBoundingClientRect().top;
            const fadeEls = Array.from(el.querySelectorAll('.timeline-top-row, .timeline-headline, .timeline-desc, .timeline-slider'));
            eventFlips.push({ el, dy, fadeEls });
            el.style.transform = `translateY(${dy}px)`;
            fadeEls.forEach(c => { c.style.opacity = '0'; });
        });

        // New headers + new card: slide from old card position + fade in
        const slideFlips = [];
        newHeaders.forEach(el => {
            const dy = startCardRect.top - el.getBoundingClientRect().top;
            slideFlips.push({ el, dy });
            el.style.transform = `translateY(${dy}px)`;
            el.style.opacity = '0';
        });

        let newCardDy = null;
        if (newCard) {
            newCardDy = (startCardRect.top + startCardRect.height) - newCardRect.top;
            slideFlips.push({ el: newCard, dy: newCardDy });
            newCard.style.transform = `translateY(${newCardDy}px)`;
            newCard.style.opacity = '0';
        }

        // When outcome appears with no new card, it takes the new card's role
        let outcomeDy = null;
        if (outcomeAppearing && outcomeCard && endOutcomeRect && !newCard) {
            outcomeDy = (startCardRect.top + startCardRect.height) - endOutcomeRect.top;
            outcomeCard.style.transform = `translateY(${outcomeDy}px)`;
            outcomeCard.style.opacity = '0';
        }

        // --- Segment adjustments: stretch each new segment to track both dots ---
        const segFlips = [];
        newEvents.forEach((el, i) => {
            const seg = el.querySelector('.tl-vline-seg');
            if (!seg || seg.style.display === 'none') return;
            const flip = eventFlips.find(f => f.el === el);
            const dyCurr = flip ? flip.dy : 0;
            let dyPrev = 0;
            if (i > 0) {
                const prevFlip = eventFlips.find(f => f.el === newEvents[i - 1]);
                dyPrev = prevFlip ? prevFlip.dy : 0;
            }
            const deltaDy = dyCurr - dyPrev;
            if (Math.abs(deltaDy) < 1) return;
            segFlips.push({
                seg,
                origTop: parseFloat(seg.style.top) || 0,
                origHeight: parseFloat(seg.style.height) || 0,
                deltaDy,
            });
        });

        if (newCard) {
            const seg = newCard.querySelector('.tl-vline-seg');
            if (seg && seg.style.display !== 'none') {
                const dyCard = newCardDy ?? 0;
                const lastFlip = eventFlips.length > 0 ? eventFlips[eventFlips.length - 1] : null;
                const dyPrev = lastFlip ? lastFlip.dy : 0;
                const deltaDy = dyCard - dyPrev;
                if (Math.abs(deltaDy) > 1) {
                    segFlips.push({
                        seg,
                        origTop: parseFloat(seg.style.top) || 0,
                        origHeight: parseFloat(seg.style.height) || 0,
                        deltaDy,
                    });
                }
            }
        }

        // Outcome: FLIP if already visible and shifted, or appearing handled above
        let outcomeFlip = null;
        if (!outcomeAppearing && outcomeCard && endOutcomeRect) {
            const ody = startOutcomeTop - endOutcomeRect.top;
            if (Math.abs(ody) > 1) {
                outcomeFlip = { el: outcomeCard, dy: ody };
                outcomeCard.style.transform = `translateY(${ody}px)`;
            }
        }

        // --- Scroll setup ---
        // scrollDelta: how much to scroll during animation.
        // Positive = scroll down (content grew), negative = scroll up (card above viewport).
        let scrollDelta = totalShift;
        if (newCardRect && this._headerEl) {
            const headerBottom = this._headerEl.getBoundingClientRect().bottom;
            const desiredTop = headerBottom + 50;
            if (newCardRect.top < desiredTop) {
                scrollDelta = Math.min(scrollDelta, newCardRect.top - desiredTop);
            }
        }
        const scrollStart = window.scrollY;
        if (!vis.scroll && Math.abs(scrollDelta) > 1) {
            window.scrollBy({ top: scrollDelta, behavior: 'instant' });
        }

        // --- Phase 5: Animate ---
        // Capture scroll room for gradual release during animation.
        // All visual transitions must happen within this single animation loop —
        // pre/post animations are considered bugs.
        const scrollRoomEl = this._getScrollRoomEl();
        const inflatedMinH = this._scrollMinHeight;
        scrollRoomEl.style.minHeight = '';
        const naturalMinH = document.documentElement.scrollHeight;
        scrollRoomEl.style.minHeight = inflatedMinH + 'px';

        const startTime = performance.now();
        const oldCardEl = this._oldCardEl;
        const tick = () => {
            const elapsed = performance.now() - startTime;
            const t = Math.min(elapsed / DURATION, 1);
            const e = this._ease(t);

            // Old card: locked to incoming element (new card or outcome), fades out, gradient-clipped at top
            if (oldCardEl) {
                oldCardEl.style.opacity = String(1 - e);
                const refDy = newCardDy !== null ? newCardDy : outcomeDy;
                const refTop = newCardDy !== null ? newCardRect.top : (outcomeDy !== null ? endOutcomeRect.top : null);
                if (refDy !== null && refTop !== null) {
                    const scrollAdj = vis.scroll ? scrollDelta * e : 0;
                    const refVisualTop = refTop + refDy * (1 - e) - scrollAdj;
                    const dy = refVisualTop - startCardRect.height - startCardRect.top;
                    oldCardEl.style.transform = `translateY(${dy}px)`;
                    const clipTop = Math.max(0, -dy);
                    if (clipTop > 0.5) {
                        const fade = `linear-gradient(to bottom, transparent ${clipTop}px, black ${clipTop + 40}px)`;
                        oldCardEl.style.webkitMaskImage = fade;
                        oldCardEl.style.maskImage = fade;
                    } else {
                        oldCardEl.style.webkitMaskImage = '';
                        oldCardEl.style.maskImage = '';
                    }
                }
            }

            // New events: slide to final position, fade in content
            eventFlips.forEach(({ el, dy, fadeEls }) => {
                el.style.transform = `translateY(${dy * (1 - e)}px)`;
                fadeEls.forEach(c => { c.style.opacity = String(e); });
            });

            // New headers + new card: slide to final position, fade in
            slideFlips.forEach(({ el, dy }) => {
                el.style.transform = `translateY(${dy * (1 - e)}px)`;
                el.style.opacity = String(e);
            });

            // Vertical line segments: stretch between displaced dots
            segFlips.forEach(({ seg, origTop, origHeight, deltaDy }) => {
                const delta = deltaDy * (1 - e);
                seg.style.top = (origTop - delta) + 'px';
                seg.style.height = Math.max(0, origHeight + delta) + 'px';
            });

            // Outcome card: slide from old card bottom to final position, or FLIP if already visible
            if (outcomeAppearing && outcomeCard && outcomeDy !== null) {
                outcomeCard.style.opacity = String(e);
                outcomeCard.style.transform = `translateY(${outcomeDy * (1 - e)}px)`;
            } else if (outcomeFlip) {
                outcomeFlip.el.style.transform = `translateY(${outcomeFlip.dy * (1 - e)}px)`;
            }

            // Scroll: animate page scroll in sync
            if (vis.scroll && Math.abs(scrollDelta) > 1) {
                window.scrollTo({ top: scrollStart + scrollDelta * e, behavior: 'instant' });
            }

            // Gradually release scroll room so scrollbar doesn't snap at cleanup
            if (inflatedMinH > naturalMinH) {
                const currentMinH = inflatedMinH + (naturalMinH - inflatedMinH) * e;
                scrollRoomEl.style.minHeight = currentMinH + 'px';
            }

            // Footer: FLIP from start position to natural end position
            if (footer && Math.abs(footerDrift) > 1) {
                footer.style.transform = `translateY(${-footerDrift * (1 - e)}px)`;
            }

            if (t < 1) {
                requestAnimationFrame(tick);
            } else {
                // --- Cleanup: remove old card, clear all inline animation styles ---
                if (oldCardEl) { oldCardEl.remove(); this._oldCardEl = null; }
                eventFlips.forEach(({ el, fadeEls }) => {
                    el.style.transform = '';
                    fadeEls.forEach(c => { c.style.opacity = ''; });
                });
                slideFlips.forEach(({ el }) => { el.style.transform = ''; el.style.opacity = ''; });
                if (outcomeAppearing && outcomeCard) { outcomeCard.style.opacity = ''; outcomeCard.style.transform = ''; }
                if (outcomeFlip) outcomeFlip.el.style.transform = '';
                segFlips.forEach(({ seg, origTop, origHeight }) => {
                    seg.style.top = origTop + 'px';
                    seg.style.height = origHeight + 'px';
                });
                if (footer && fadeFooterIn) footer.style.opacity = '0';
                if (footer) footer.style.transform = '';
                this._releaseScrollRoom();
                if (footer && fadeFooterIn) {
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
                this.morphAnimating = false;
                if (!shiftWasCapped) {
                    const card = this._getCard();
                    if (card && this._headerEl) {
                        const headerBottom = this._headerEl.getBoundingClientRect().bottom;
                        const cardTop = card.getBoundingClientRect().top;
                        if (cardTop < headerBottom + 10) {
                            console.warn('[anim] card under header after animation:', { cardTop: Math.round(cardTop), headerBottom: Math.round(headerBottom), gap: Math.round(cardTop - headerBottom) });
                        }
                    }
                }
                if (onComplete) onComplete();
            }
        };

        if (this._beforeAnimate) this._beforeAnimate();
        requestAnimationFrame(tick);
    }

    _captureStartState(card) {
        const outcomeVisible = this.outcomeEl && this.outcomeEl.style.display !== 'none' && this.outcomeEl.innerHTML.trim() !== '';
        return {
            startCardRect: card.getBoundingClientRect(),
            startCardContent: card.innerHTML,
            startCardClassName: card.className,
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

    animateTransition({ applyChange, revertChange, count, questionHtml, hasNextQuestion, onComplete, fadeFooterIn }) {
        if (this.morphAnimating) return false;
        const card = this._getCard();
        if (!card) { applyChange(); this.render(); return false; }
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

    _scrollCardBelowHeader() {
        if (!this._headerEl) return;
        const card = this._getCard();
        if (!card) return;
        const headerBottom = this._headerEl.getBoundingClientRect().bottom;
        const cardTop = card.getBoundingClientRect().top;
        const gap = 50;
        if (cardTop < headerBottom + gap) {
            this._animateScroll(cardTop - headerBottom - gap, 400);
        }
    }

    _animateScroll(delta, durationMs) {
        if (Math.abs(delta) < 1) return;
        const startScroll = window.scrollY;
        const startTime = performance.now();

        const tick = () => {
            const elapsed = performance.now() - startTime;
            const progress = Math.min(elapsed / durationMs, 1);
            const eased = this._ease(progress);
            window.scrollTo({ top: startScroll + delta * eased, behavior: 'instant' });
            if (progress < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
    }

}
