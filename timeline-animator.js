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
        this.rollDuration = options.rollDuration !== undefined ? options.rollDuration : 1500;
        this.morphAnimating = false;

        this._customRender = options.render || null;
        this._customWireButtons = options.wireAnswerButtons || null;
        this._stripFromAnimation = options.stripFromAnimation || null;
    }

    setMorphDuration(ms) { this.morphDuration = ms; }
    setRollDuration(ms) { this.rollDuration = ms; }
    isAnimating() { return this.morphAnimating; }

    _getCard() {
        return this.questionZoneEl.querySelector('.' + this.cardClass);
    }

    _wireAnswerButtons(container) {
        if (this._customWireButtons) {
            this._customWireButtons(container, (count) => this.addItems(count));
            return;
        }
        container.querySelectorAll('.answer-btn').forEach(btn => {
            btn.addEventListener('click', () => this.addItems(parseInt(btn.dataset.count)));
        });
    }

    reset() {
        this.morphAnimating = false;
        if (this.outcomeEl) this.outcomeEl.style.cssText = '';
        const spacer = document.getElementById('scroll-spacer');
        if (spacer) spacer.remove();
        this.render();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    render() {
        if (this._customRender) {
            this._customRender();
            return;
        }

        const dp = this.dp;
        const counter = dp.getCurrentCount();
        const totalEvents = dp.getEventCount();

        let html = '';
        let lastStage = 0;
        const firstStage = dp.stageForIndex(0);
        if (counter === 0) {
            html += dp.stageHeaderHtml(firstStage);
            lastStage = firstStage;
        }
        for (let i = 0; i < counter; i++) {
            const s = dp.stageForIndex(i);
            if (s !== lastStage) { lastStage = s; html += dp.stageHeaderHtml(s); }
            html += dp.eventHtml(i);
        }
        if (counter < totalEvents) {
            const nextStage = dp.stageForIndex(counter);
            if (nextStage !== lastStage) {
                html += dp.stageHeaderHtml(nextStage);
            }
        }
        this.timelineEl.innerHTML = html;

        if (dp.hasMoreQuestions()) {
            this.questionZoneEl.innerHTML = `<div class="${this.cardClass}">${dp.questionInnerHtml()}</div>`;
            this._wireAnswerButtons(this.questionZoneEl);
        } else {
            this.questionZoneEl.innerHTML = '<p style="color:var(--text-dim); padding: 1rem 0;">All items added.</p>';
        }

        if (dp.onRender) dp.onRender();
    }

    // Run the core morph animation. Shared between addItems and animateTransition.
    _runAnimation(p) {
        const MORPH_DURATION = this.morphDuration;
        const ROLL_DURATION = this.rollDuration;

        const easing = 'cubic-bezier(0.42, 0, 0.58, 1)';
        const fadeOutDur = Math.round(MORPH_DURATION * 0.35) + 'ms';
        const fadeInDur = Math.round(MORPH_DURATION * 0.6) + 'ms';
        const fadeInDelay = MORPH_DURATION * 0.15;
        const decorDur = Math.round(MORPH_DURATION * 0.3) + 'ms';
        const shrinkDur = Math.round(MORPH_DURATION * 0.7) + 'ms';

        let card = p.card;
        const cardRect = p.cardRect;
        const questionZone = p.questionZone;
        const outcomeCard = p.outcomeCard;
        const targetHeight = p.targetHeight;
        const newContentHtml = p.newContentHtml;
        const tempItemCount = p.tempItemCount;
        const count = p.count;
        const postCardRect = p.postCardRect;
        const outcomeDelta = p.outcomeDelta;
        const hasNextQuestion = p.hasNextQuestion;

        const hasNewContent = targetHeight > 0 && newContentHtml;

        // flowTarget: the total space these events will occupy in the timeline.
        // Use postCardRect delta for accuracy (captures inter-event margins, stage headers, etc.)
        const flowTarget = postCardRect
            ? (postCardRect.top - cardRect.top)
            : targetHeight;

        const effectiveRollDur = ROLL_DURATION !== null ? ROLL_DURATION : MORPH_DURATION;
        const totalAnimDur = Math.max(MORPH_DURATION, effectiveRollDur);

        const rootFontSize = parseFloat(getComputedStyle(document.documentElement).fontSize);
        const dotInCard = 0.55 * rootFontSize;
        const existingDotCenterY = dotInCard + 5;
        const finalDotTop = postCardRect
            ? (postCardRect.top + dotInCard - cardRect.top)
            : targetHeight + dotInCard;
        const finalDotCenterY = finalDotTop + 5;
        const finalVlineHeight = finalDotCenterY - existingDotCenterY;

        card.style.position = 'relative';
        const isLight = this.timelineEl && this.timelineEl.classList.contains('timeline-light');
        if (isLight) {
            card.classList.add('hide-decorations');
            card.style.height = cardRect.height + 'px';
        }

        if (!hasNewContent) {
            // Simple fade-out only (no morph to timeline content)
            card.style.transition = `opacity ${fadeOutDur} ease`;
            card.offsetHeight;
            card.style.opacity = '0';
        } else {

        // Step 1: Fade out + slide up old question content
        const slideUpAmount = cardRect.height - flowTarget;
        const contentEls = Array.from(card.querySelectorAll(this.contentSelector));
        const contentSet = new Set(contentEls);
        const otherCardEls = Array.from(card.children).filter(el => !contentSet.has(el) && el.nodeType === 1);

        // In light mode, the param label moves to its final position instead of fading
        const paramRow = isLight ? card.querySelector('.timeline-top-row') : null;
        let paramRowStartTop = 0;
        if (paramRow) {
            paramRowStartTop = paramRow.getBoundingClientRect().top - card.getBoundingClientRect().top;
        }

        if (contentEls.length > 0) {
            const oldWrapper = document.createElement('div');
            oldWrapper.style.cssText = `overflow:hidden; position:relative; z-index:0; height:${contentEls.reduce((h, el) => h + el.offsetHeight + parseFloat(getComputedStyle(el).marginTop) + parseFloat(getComputedStyle(el).marginBottom), 0)}px;`;
            contentEls[0].parentNode.insertBefore(oldWrapper, contentEls[0]);
            contentEls.forEach(el => oldWrapper.appendChild(el));

            const oldInner = document.createElement('div');
            oldInner.style.cssText = `transition: opacity ${fadeOutDur} ease, transform ${shrinkDur} ${easing};`;
            while (oldWrapper.firstChild) oldInner.appendChild(oldWrapper.firstChild);
            oldWrapper.appendChild(oldInner);

            const fadeGradient = document.createElement('div');
            fadeGradient.style.cssText = `position:absolute; top:0; left:0; right:0; height:50px; background:radial-gradient(ellipse at 25% 50%, var(--bg-glow-1, var(--accent-glow)) 0%, transparent 60%), radial-gradient(ellipse at 75% 20%, var(--bg-glow-2, rgba(124,92,255,0.025)) 0%, transparent 60%), var(--bg); background-attachment:fixed; -webkit-mask-image:linear-gradient(to bottom, black, transparent); mask-image:linear-gradient(to bottom, black, transparent); opacity:0; z-index:2; pointer-events:none;`;
            oldWrapper.appendChild(fadeGradient);

            oldInner.offsetHeight;
            oldInner.style.opacity = '0';
            oldInner.style.transform = `translateY(-${slideUpAmount}px)`;
            fadeGradient.style.transition = `opacity ${fadeOutDur} ease`;
            fadeGradient.style.opacity = '1';
        }

        // In light mode: fade out remaining card children, animate param label to final position
        if (isLight) {
            otherCardEls.forEach(el => {
                if (el === paramRow) return;
                el.style.transition = `opacity ${fadeOutDur} ease`;
                el.offsetHeight;
                el.style.opacity = '0';
            });
        }

        if (paramRow) {
            const spacer = document.createElement('div');
            spacer.style.height = paramRow.offsetHeight + 'px';
            paramRow.parentNode.insertBefore(spacer, paramRow);
            paramRow.style.position = 'absolute';
            paramRow.style.top = paramRowStartTop + 'px';
            paramRow.style.left = '0';
            paramRow.style.right = '0';
            paramRow.style.zIndex = '4';
            paramRow.offsetHeight;
            paramRow.style.transition = `top ${shrinkDur} ${easing}`;
            paramRow.style.top = '0px';
        }

        // Step 2: Fade in new timeline event content, centered vertically on the card
        const centerOffset = Math.max(0, (cardRect.height - targetHeight) / 2);
        const newLayer = document.createElement('div');
        if (tempItemCount === 1) {
            newLayer.style.cssText = `position:absolute; top:${centerOffset}px; left:0; right:0; opacity:0;${isLight ? '' : ' padding-top:1.4rem;'}`;
        } else {
            newLayer.style.cssText = `position:absolute; top:${centerOffset}px; left:0; right:0; z-index:1;`;
        }
        if (this.timelineEl) {
            for (const cls of this.timelineEl.classList) {
                if (cls !== 'timeline') newLayer.classList.add(cls);
            }
        }
        newLayer.innerHTML = newContentHtml;
        if (this._stripFromAnimation) {
            const firstMatch = newLayer.querySelector(this._stripFromAnimation);
            if (firstMatch) firstMatch.style.visibility = 'hidden';
        }
        card.appendChild(newLayer);

        if (count === 1 && !isLight) {
            newLayer.querySelectorAll('.timeline-event').forEach(ev => {
                ev.classList.add('morph-no-decorations');
            });
        }

        if (tempItemCount > 1) {
            newLayer.querySelectorAll('.timeline-event, .timeline-stage-label, .timeline-stage-header').forEach(el => {
                el.style.opacity = '0';
            });
        }

        setTimeout(() => {
            if (tempItemCount === 1) {
                newLayer.style.opacity = '1';
            } else {
                newLayer.querySelectorAll('.timeline-event, .timeline-stage-label, .timeline-stage-header').forEach(el => {
                    el.style.transition = `opacity ${fadeInDur} ease`;
                    el.style.opacity = '1';
                });
            }
        }, fadeInDelay);

        // Step 3: Animate decorations for the next question card position
        // In light mode, also create a persistent dot to replace the fading current card ::before
        if (isLight) {
            const persistDot = document.createElement('div');
            persistDot.style.cssText = `position:absolute; left:calc(-2.5rem + 3px); top:${dotInCard}px; width:10px; height:10px; border-radius:50%; background:var(--accent); box-shadow:0 0 8px var(--accent-glow); border:2px solid var(--bg); z-index:3;`;
            card.appendChild(persistDot);
            persistDot.offsetHeight;
            const lightDotTarget = 0.67 * rootFontSize;
            persistDot.style.transition = `top ${shrinkDur} ${easing}`;
            persistDot.style.top = lightDotTarget + 'px';
        }

        const newDotTop = cardRect.height;
        const newDot = document.createElement('div');
        newDot.style.cssText = `position:absolute; left:calc(-2.5rem + 3px); top:${newDotTop}px; width:10px; height:10px; border-radius:50%; background:var(--accent); box-shadow:0 0 8px var(--accent-glow); border:2px solid var(--bg); z-index:3; opacity:0;`;
        card.appendChild(newDot);

        const newHline = document.createElement('div');
        newHline.style.cssText = `position:absolute; left:-1.85rem; top:${newDotTop + 4}px; right:0; height:1px; background:var(--border); opacity:0; z-index:0;`;
        card.appendChild(newHline);

        const newDotCenterY = newDotTop + 5;
        const vline = document.createElement('div');
        vline.style.cssText = `position:absolute; left:calc(-2.5rem + 7px); top:${existingDotCenterY}px; width:2px; height:${newDotCenterY - existingDotCenterY}px; background:linear-gradient(to bottom, var(--accent), var(--accent-2)); opacity:0; border-radius:1px; z-index:0;`;
        card.appendChild(vline);

        // Step 4: Height shrink — card shrinks, decorations fade in + move up
        card.style.height = cardRect.height + 'px';
        card.style.clipPath = 'inset(0 -100vw -50px -100vw)';
        card.offsetHeight;

        if (isLight) {
            card.style.transition = `height ${shrinkDur} ${easing}`;
            card.style.height = flowTarget + 'px';
        } else {
            card.style.transition = `height ${shrinkDur} ${easing}`;
            card.style.height = targetHeight + 'px';
        }

        const spacer = document.getElementById('scroll-spacer') || document.createElement('div');
        spacer.id = 'scroll-spacer';
        if (!spacer.parentNode) document.body.appendChild(spacer);
        spacer.style.height = '1000px';
        spacer.offsetHeight;

        // Take outcome card out of flow and animate it directly to final position
        if (outcomeCard && Math.abs(outcomeDelta) > 0) {
            const appRect = outcomeCard.offsetParent.getBoundingClientRect();
            const outcomeRect = outcomeCard.getBoundingClientRect();
            const absTop = outcomeRect.top - appRect.top;
            const absLeft = outcomeRect.left - appRect.left;
            outcomeCard.style.position = 'absolute';
            outcomeCard.style.top = absTop + 'px';
            outcomeCard.style.left = absLeft + 'px';
            outcomeCard.style.width = outcomeRect.width + 'px';
            outcomeCard.style.margin = '0';
            outcomeCard.style.zIndex = '0';
            outcomeCard.offsetHeight;
            outcomeCard.style.transition = `top ${totalAnimDur}ms ${easing}`;
            outcomeCard.style.top = (absTop + outcomeDelta) + 'px';
        }

        // Scroll disabled for now
        // if (postCardRect) {
        //     const scrollDelta = postCardRect.top - cardRect.top;
        //     if (scrollDelta > 0) {
        //         const targetScroll = window.scrollY + scrollDelta;
        //         window.scrollTo({ top: targetScroll, behavior: 'smooth' });
        //     }
        // }

        // Move new content from center to top
        newLayer.style.transition = tempItemCount === 1
            ? `opacity ${fadeInDur} ease, top ${shrinkDur} ${easing}`
            : `top ${shrinkDur} ${easing}`;
        newLayer.style.top = '0px';

        // Fade in + move decorations up to next question card position
        newDot.style.transition = `opacity ${decorDur} ease, top ${shrinkDur} ${easing}`;
        newDot.style.opacity = '1';
        newDot.style.top = finalDotTop + 'px';

        newHline.style.transition = `opacity ${decorDur} ease, top ${shrinkDur} ${easing}`;
        newHline.style.opacity = '0.6';
        newHline.style.top = (finalDotTop + 4) + 'px';

        vline.style.transition = `opacity ${decorDur} ease, height ${shrinkDur} ${easing}`;
        vline.style.opacity = '0.3';
        vline.style.height = finalVlineHeight + 'px';

        } // end hasNewContent

        // Step 5: Roll down next question card
        const rollDurMs = ROLL_DURATION !== null ? ROLL_DURATION : Math.round(MORPH_DURATION * 0.4);
        const rollDelay = ROLL_DURATION !== null
            ? Math.max(0, MORPH_DURATION - ROLL_DURATION)
            : Math.round(MORPH_DURATION * 0.5);
        let rollCard = null;
        let rollWrapper = null;

        if (hasNextQuestion) {
            setTimeout(() => {
                rollCard = document.createElement('div');
                rollCard.className = this.cardClass + ' hide-decorations';
                rollCard.innerHTML = p.questionHtml();
                this._wireAnswerButtons(rollCard);

                rollCard.style.cssText = 'position:absolute; visibility:hidden;';
                questionZone.appendChild(rollCard);
                const fullHeight = rollCard.offsetHeight;
                rollCard.remove();
                rollCard.style.cssText = 'opacity:0;';

                rollWrapper = document.createElement('div');
                rollWrapper.style.cssText = 'overflow:hidden; height:0px; margin-top:-1.5rem; margin-bottom:1.5rem; position:relative;';
                rollWrapper.appendChild(rollCard);

                const rollFade = document.createElement('div');
                rollFade.style.cssText = `position:absolute; bottom:0; left:0; right:0; height:40px; background:radial-gradient(ellipse at 25% 50%, var(--bg-glow-1, var(--accent-glow)) 0%, transparent 60%), radial-gradient(ellipse at 75% 20%, var(--bg-glow-2, rgba(124,92,255,0.025)) 0%, transparent 60%), var(--bg); background-attachment:fixed; -webkit-mask-image:linear-gradient(to top, black, transparent); mask-image:linear-gradient(to top, black, transparent); pointer-events:none; z-index:2; transition:opacity ${Math.round(rollDurMs * 0.3)}ms ease;`;
                rollWrapper.appendChild(rollFade);

                questionZone.appendChild(rollWrapper);

                rollWrapper.offsetHeight;
                rollWrapper.style.transition = `height ${rollDurMs}ms ${easing}`;
                rollWrapper.style.height = fullHeight + 'px';

                rollCard.style.transition = `opacity ${rollDurMs}ms ${easing}`;
                rollCard.style.opacity = '1';

                setTimeout(() => {
                    rollFade.style.opacity = '0';
                }, Math.round(rollDurMs * 0.6));
            }, rollDelay);
        }

        // Cleanup after animation completes
        setTimeout(() => {
            p.cleanup({
                card, rollCard, rollWrapper, rollBefore: rollCard ? rollCard.getBoundingClientRect() : null,
                outcomeCard, outcomeVisualTop: outcomeCard ? outcomeCard.getBoundingClientRect().top : 0,
                hasNextQuestion, easing, questionZone, totalAnimDur
            });
        }, totalAnimDur + 50);
    }

    // Counter-based animation for the test file. Uses the data provider to build
    // temp content and manually insert events at cleanup.
    addItems(count) {
        if (this.morphAnimating) return;
        let card = this._getCard();
        if (!card) return;
        this.morphAnimating = true;

        const dp = this.dp;
        const questionZone = this.questionZoneEl;
        const timeline = this.timelineEl;

        const cardRect = card.getBoundingClientRect();
        const outcomeCard = this.outcomeEl;
        const outcomeBefore = outcomeCard ? outcomeCard.getBoundingClientRect().top : 0;

        // Measure combined height of new timeline items in a temp container
        const savedCounter = dp.getCurrentCount();
        const tempContainer = document.createElement('div');
        tempContainer.style.cssText = `visibility:hidden; position:absolute; width:${card.offsetWidth}px;`;
        let lastStageTemp = savedCounter > 0 ? dp.stageForIndex(savedCounter - 1) : dp.stageForIndex(0);
        const lastTlEl = timeline.lastElementChild;
        const hasTrailingHeader = lastTlEl && lastTlEl.classList.contains('timeline-stage-header');
        if (hasTrailingHeader) {
            lastStageTemp = dp.stageForIndex(savedCounter);
        }
        for (let i = 0; i < count; i++) {
            const eventIdx = savedCounter + i;
            const s = dp.stageForIndex(eventIdx);
            if (s !== lastStageTemp) {
                tempContainer.insertAdjacentHTML('beforeend', dp.stageHeaderHtml(s));
                lastStageTemp = s;
            }
            tempContainer.insertAdjacentHTML('beforeend', dp.eventHtml(eventIdx));
        }
        const nextIdx = savedCounter + count;
        if (nextIdx < dp.getEventCount() && !hasTrailingHeader) {
            const nextStage = dp.stageForIndex(nextIdx);
            if (nextStage !== lastStageTemp) {
                tempContainer.insertAdjacentHTML('beforeend', dp.stageHeaderHtml(nextStage));
            }
        }
        card.parentNode.appendChild(tempContainer);
        const targetHeight = tempContainer.offsetHeight;
        const firstEvent = tempContainer.querySelector('.timeline-event');
        const tempItemCount = tempContainer.children.length;
        const newContentHtml = tempItemCount === 1 ? firstEvent.innerHTML : tempContainer.innerHTML;
        tempContainer.remove();

        // Pre-render final state to measure exact decoration positions
        dp.setCurrentCount(savedCounter + count);
        this.render();
        const postCard = this._getCard();
        const postCardRect = postCard ? postCard.getBoundingClientRect() : null;
        const outcomeAfterPrerender = outcomeCard ? outcomeCard.getBoundingClientRect().top : 0;
        const outcomeDelta = outcomeAfterPrerender - outcomeBefore;
        const hasNextQuestion = dp.hasMoreQuestions();
        const nextQuestionHtml = dp.questionInnerHtml();
        dp.setCurrentCount(savedCounter);
        this.render();
        card = this._getCard();

        this._runAnimation({
            card, cardRect, questionZone, outcomeCard,
            targetHeight, newContentHtml, tempItemCount, count,
            postCardRect, outcomeDelta, hasNextQuestion,
            questionHtml: () => nextQuestionHtml,
            cleanup: (state) => {
                const { rollCard, rollWrapper, rollBefore, outcomeVisualTop, easing } = state;

                if (outcomeCard) outcomeCard.style.cssText = 'transition:none;';
                card.remove();

                // Insert new events into timeline
                const counter = dp.getCurrentCount();
                let lastStage = counter > 0 ? dp.stageForIndex(counter - 1) : dp.stageForIndex(0);
                const trailingEl = timeline.lastElementChild;
                if (trailingEl && trailingEl.classList.contains('timeline-stage-header')) {
                    lastStage = dp.stageForIndex(counter);
                }
                for (let i = 0; i < count; i++) {
                    const eventIdx = counter + i;
                    const s = dp.stageForIndex(eventIdx);
                    if (s !== lastStage) {
                        timeline.insertAdjacentHTML('beforeend', dp.stageHeaderHtml(s));
                        lastStage = s;
                    }
                    timeline.insertAdjacentHTML('beforeend', dp.eventHtml(eventIdx));
                }
                dp.setCurrentCount(counter + count);

                if (dp.hasMoreQuestions()) {
                    const newCounter = dp.getCurrentCount();
                    const nextStage = dp.stageForIndex(newCounter);
                    if (nextStage !== lastStage) {
                        timeline.insertAdjacentHTML('beforeend', dp.stageHeaderHtml(nextStage));
                    }
                }

                if (dp.onItemsAdded) dp.onItemsAdded(count);

                this._flipCleanup({ rollCard, rollWrapper, rollBefore, outcomeCard, outcomeVisualTop, hasNextQuestion: state.hasNextQuestion, easing, questionZone: state.questionZone });
            }
        });
    }

    // State-based animation for index.html. Captures new content from the DOM
    // after applying a state change, then reverts and runs the animation.
    animateTransition({ applyChange, revertChange, count, questionHtml, hasNextQuestion, onComplete }) {
        if (this.morphAnimating) return false;
        let card = this._getCard();
        if (!card) { applyChange(); this.render(); return false; }
        this.morphAnimating = true;

        count = count || 1;
        const questionZone = this.questionZoneEl;
        const timeline = this.timelineEl;

        const cardRect = card.getBoundingClientRect();
        const outcomeCard = this.outcomeEl;
        const outcomeBefore = outcomeCard ? outcomeCard.getBoundingClientRect().top : 0;

        const oldChildCount = timeline ? timeline.childElementCount : 0;

        // Apply change + render to get new state in the DOM
        applyChange();
        this.render();

        // Capture new timeline items by comparing child counts
        const allNewChildren = Array.from(timeline.children);
        const animatedItems = allNewChildren.slice(oldChildCount);

        // Measure from actual rendered DOM (use bounding rects to include margins)
        let targetHeight = 0;
        if (animatedItems.length > 0) {
            const firstRect = animatedItems[0].getBoundingClientRect();
            const lastItem = animatedItems[animatedItems.length - 1];
            const lastRect = lastItem.getBoundingClientRect();
            const lastMargin = parseFloat(getComputedStyle(lastItem).marginBottom) || 0;
            targetHeight = lastRect.bottom - firstRect.top + lastMargin;
        }
        const tempItemCount = animatedItems.length;
        const firstEvent = animatedItems.find(el => el.classList.contains('timeline-event'));
        const newContentHtml = tempItemCount <= 1 && firstEvent
            ? firstEvent.innerHTML
            : animatedItems.map(el => el.outerHTML).join('');

        // Measure new question card position
        const postCard = this._getCard();
        const postCardRect = postCard ? postCard.getBoundingClientRect() : null;
        const outcomeAfterPrerender = outcomeCard ? outcomeCard.getBoundingClientRect().top : 0;
        const outcomeDelta = outcomeAfterPrerender - outcomeBefore;
        const _hasNextQuestion = hasNextQuestion !== undefined ? hasNextQuestion : (postCard !== null);

        // Cache the next question HTML from the rendered DOM if not provided
        const _questionHtml = questionHtml || (postCard ? postCard.innerHTML : '');

        // Revert to old state
        revertChange();
        this.render();
        card = this._getCard();

        if (!card) { applyChange(); this.render(); this.morphAnimating = false; return false; }

        this._runAnimation({
            card, cardRect, questionZone, outcomeCard,
            targetHeight, newContentHtml, tempItemCount, count,
            postCardRect, outcomeDelta, hasNextQuestion: _hasNextQuestion,
            questionHtml: () => _questionHtml,
            cleanup: (state) => {
                const { rollCard, rollWrapper, rollBefore, outcomeVisualTop, easing } = state;

                if (outcomeCard) outcomeCard.style.cssText = 'transition:none;';

                const contentVisualTop = card.getBoundingClientRect().top;

                // Save rollCard before re-rendering. Use rollBefore (measured
                // while inside the wrapper with its compensating margin-top:-1.5rem)
                // as the visual reference — re-measuring after extraction would lose
                // that offset and introduce a ~1.5rem FLIP delta.
                let savedRollCard = null;
                let savedRollBefore = rollBefore;
                if (rollCard && rollCard.parentNode) {
                    savedRollCard = rollCard;
                    if (rollWrapper && rollWrapper.parentNode) {
                        rollWrapper.parentNode.insertBefore(rollCard, rollWrapper);
                        rollWrapper.remove();
                    }
                    savedRollCard.remove();
                }

                card.remove();

                // Apply change + render to get the real final state
                applyChange();
                this.render();

                // FLIP newly added timeline items from animated position to natural position
                const newChildren = Array.from(timeline.children).slice(oldChildCount);
                if (newChildren.length > 0) {
                    const naturalTop = newChildren[0].getBoundingClientRect().top;
                    const flipDy = contentVisualTop - naturalTop;
                    if (Math.abs(flipDy) > 1) {
                        newChildren.forEach(el => {
                            el.style.transform = `translateY(${flipDy}px)`;
                            el.style.transition = 'none';
                        });
                        newChildren[0].offsetHeight;
                        newChildren.forEach(el => {
                            el.style.transition = `transform 300ms ${easing}`;
                            el.style.transform = 'translateY(0)';
                        });
                        setTimeout(() => {
                            newChildren.forEach(el => {
                                el.style.transform = '';
                                el.style.transition = '';
                            });
                        }, 350);
                    }
                }

                if (savedRollCard) {
                    const freshCard = this._getCard();
                    const lightMode = timeline && timeline.classList.contains('timeline-light');

                    // Measure FLIP delta for rollCard
                    if (freshCard) {
                        freshCard.style.display = 'none';
                        questionZone.insertBefore(savedRollCard, freshCard);
                    } else {
                        questionZone.appendChild(savedRollCard);
                    }
                    const rollAfter = savedRollCard.getBoundingClientRect();
                    const dy = savedRollBefore ? savedRollBefore.top - rollAfter.top : 0;

                    // FLIP outcome
                    if (outcomeCard) {
                        const outcomeNaturalTop = outcomeCard.getBoundingClientRect().top;
                        const ody = outcomeVisualTop - outcomeNaturalTop;
                        if (Math.abs(ody) > 1) {
                            outcomeCard.style.transform = `translateY(${ody}px)`;
                            outcomeCard.offsetHeight;
                            outcomeCard.style.transition = `transform 300ms ${easing}`;
                            outcomeCard.style.transform = 'translateY(0)';
                        }
                    }

                    if (Math.abs(dy) <= 1) {
                        // No significant FLIP needed — swap to freshCard immediately.
                        // Decorations appear at full opacity (the morph animation already
                        // handled the visual transition via newDot/newHline/vline).
                        savedRollCard.remove();
                        if (freshCard) freshCard.style.display = '';
                        if (outcomeCard) {
                            setTimeout(() => { outcomeCard.style.cssText = ''; }, 350);
                        }
                        const spacer = document.getElementById('scroll-spacer');
                        if (spacer) spacer.remove();
                        this.morphAnimating = false;
                        if (onComplete) onComplete();
                    } else {
                        // Significant FLIP — animate savedRollCard, then swap after transition
                        savedRollCard.style.transform = `translateY(${dy}px)`;
                        savedRollCard.style.transition = 'none';
                        if (!lightMode) {
                            savedRollCard.classList.add('no-transition');
                            savedRollCard.classList.remove('hide-decorations');
                            savedRollCard.offsetHeight;
                            savedRollCard.classList.remove('no-transition');
                        } else {
                            savedRollCard.offsetHeight;
                            requestAnimationFrame(() => {
                                savedRollCard.classList.remove('hide-decorations');
                            });
                        }
                        savedRollCard.style.transition = `transform 300ms ${easing}`;
                        savedRollCard.style.transform = 'translateY(0)';

                        setTimeout(() => {
                            savedRollCard.remove();
                            if (freshCard) freshCard.style.display = '';
                            if (outcomeCard) outcomeCard.style.cssText = '';
                            const spacer = document.getElementById('scroll-spacer');
                            if (spacer) spacer.remove();
                            this.morphAnimating = false;
                            if (onComplete) onComplete();
                        }, 350);
                    }
                } else if (!_hasNextQuestion) {
                    if (outcomeCard) outcomeCard.style.cssText = '';
                    const spacer = document.getElementById('scroll-spacer');
                    if (spacer) spacer.remove();
                    this.morphAnimating = false;
                    if (onComplete) onComplete();
                } else {
                    this.morphAnimating = false;
                    if (onComplete) onComplete();
                }
            }
        });

        return true;
    }

    // Shared FLIP cleanup for the counter-based addItems path
    _flipCleanup({ rollCard, rollWrapper, rollBefore, outcomeCard, outcomeVisualTop, hasNextQuestion, easing, questionZone }) {
        if (rollCard && rollCard.parentNode) {
            if (rollWrapper && rollWrapper.parentNode) {
                rollWrapper.parentNode.insertBefore(rollCard, rollWrapper);
                rollWrapper.remove();
            }

            const rollAfter = rollCard.getBoundingClientRect();
            const dy = rollBefore ? rollBefore.top - rollAfter.top : 0;

            rollCard.style.transform = Math.abs(dy) > 1 ? `translateY(${dy}px)` : '';
            rollCard.style.transition = 'none';

            rollCard.classList.add('no-transition');
            rollCard.classList.remove('hide-decorations');
            rollCard.offsetHeight;
            rollCard.classList.remove('no-transition');

            if (Math.abs(dy) > 1) {
                rollCard.style.transition = `transform 300ms ${easing}`;
                rollCard.style.transform = 'translateY(0)';
            }

            if (outcomeCard) {
                const outcomeNaturalTop = outcomeCard.getBoundingClientRect().top;
                const ody = outcomeVisualTop - outcomeNaturalTop;
                if (Math.abs(ody) > 1) {
                    outcomeCard.style.transform = `translateY(${ody}px)`;
                    outcomeCard.offsetHeight;
                    outcomeCard.style.transition = `transform 300ms ${easing}`;
                    outcomeCard.style.transform = 'translateY(0)';
                }
            }

            setTimeout(() => {
                rollCard.style.transform = '';
                rollCard.style.transition = '';
                rollCard.style.opacity = '';
                if (outcomeCard) outcomeCard.style.cssText = '';
                const spacer = document.getElementById('scroll-spacer');
                if (spacer) spacer.remove();
                this.morphAnimating = false;
            }, 350);
        } else if (!hasNextQuestion) {
            questionZone.innerHTML = '<p style="color:var(--text-dim); padding: 1rem 0;">All items added.</p>';
            this.morphAnimating = false;
        } else {
            this.morphAnimating = false;
        }
    }
}
