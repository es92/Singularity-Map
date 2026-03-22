'use strict';

class AnimationValidator {
    constructor(options = {}) {
        this.maxDeltaPx = options.maxDeltaPx || 60;
        this.edgeFraction = options.edgeFraction || 0.15;
        this.opacityEpsilon = options.opacityEpsilon || 0.03;
        this.maxScrollDelta = options.maxScrollDelta || 80;
        this.cleanupJumpPx = options.cleanupJumpPx || 4;
        this.ghostFrameLimit = options.ghostFrameLimit || 3;
    }

    validate(trace, containerEl) {
        const results = [];
        results.push(this.checkMaxDelta(trace));
        results.push(this.checkEasing(trace));
        results.push(this.checkCleanupContinuity(trace));
        results.push(this.checkOpacity(trace));
        results.push(this.checkScroll(trace));
        if (containerEl) results.push(this.checkFinalState(containerEl));
        return {
            pass: results.every(r => r.pass),
            results,
        };
    }

    // No element should jump more than maxDeltaPx between consecutive frames,
    // scaled by time delta to tolerate variable framerates.
    checkMaxDelta(trace) {
        const violations = [];
        const frames = trace.frames;
        if (frames.length < 2) return { rule: 'maxDelta', pass: true, violations };

        const totalDuration = frames[frames.length - 1].t - frames[0].t;
        if (totalDuration <= 0) return { rule: 'maxDelta', pass: true, violations };

        const nominalFrameMs = totalDuration / (frames.length - 1);

        for (let i = 1; i < frames.length; i++) {
            const dt = frames[i].t - frames[i - 1].t;
            const scale = nominalFrameMs > 0 ? dt / nominalFrameMs : 1;
            const threshold = this.maxDeltaPx * Math.max(scale, 1);

            for (const [name, curEls] of Object.entries(frames[i].elements)) {
                const prevEls = frames[i - 1].elements[name];
                if (!prevEls) continue;

                const len = Math.min(curEls.length, prevEls.length);
                for (let e = 0; e < len; e++) {
                    const dy = Math.abs(curEls[e].y - prevEls[e].y);
                    const dx = Math.abs(curEls[e].x - prevEls[e].x);
                    const dh = Math.abs(curEls[e].h - prevEls[e].h);
                    const maxD = Math.max(dy, dx, dh);
                    if (maxD > threshold) {
                        violations.push({
                            element: name, index: e, frame: i,
                            detail: `Jumped ${maxD.toFixed(1)}px (threshold ${threshold.toFixed(1)}px) — dy:${dy.toFixed(1)} dx:${dx.toFixed(1)} dh:${dh.toFixed(1)}`,
                        });
                    }
                }
            }
        }
        return { rule: 'maxDelta', pass: violations.length === 0, violations };
    }

    // Verify easing: the average velocity in the first/last edgeFraction of the
    // animation should be lower than the velocity in the middle portion.
    checkEasing(trace) {
        const violations = [];
        const frames = trace.frames;
        if (frames.length < 10) return { rule: 'easing', pass: true, violations };

        const edgeN = Math.max(2, Math.floor(frames.length * this.edgeFraction));
        const tracks = this._buildPositionTracks(trace);

        for (const [key, positions] of Object.entries(tracks)) {
            if (positions.length < 10) continue;
            const totalTravel = Math.abs(positions[positions.length - 1] - positions[0]);
            if (totalTravel < 20) continue;

            const velocities = [];
            for (let i = 1; i < positions.length; i++) {
                velocities.push(Math.abs(positions[i] - positions[i - 1]));
            }

            const startVel = this._avg(velocities.slice(0, edgeN));
            const endVel = this._avg(velocities.slice(-edgeN));
            const midVel = this._avg(velocities.slice(edgeN, -edgeN));

            if (midVel > 0 && (startVel > midVel * 1.1 || endVel > midVel * 1.1)) {
                violations.push({
                    element: key,
                    detail: `Edge velocity not lower than middle — start:${startVel.toFixed(2)} end:${endVel.toFixed(2)} mid:${midVel.toFixed(2)}`,
                });
            }
        }
        return { rule: 'easing', pass: violations.length === 0, violations };
    }

    // Detect the cleanup frame (biggest DOM change) and verify surviving elements
    // don't jump across that boundary.
    checkCleanupContinuity(trace) {
        const violations = [];
        const frames = trace.frames;
        if (frames.length < 4) return { rule: 'cleanupContinuity', pass: true, violations };

        const cleanupFrame = this._findCleanupFrame(trace);
        if (cleanupFrame < 1 || cleanupFrame >= frames.length) {
            return { rule: 'cleanupContinuity', pass: true, violations };
        }

        const before = frames[cleanupFrame - 1];
        const after = frames[cleanupFrame];

        for (const [name, afterEls] of Object.entries(after.elements)) {
            const beforeEls = before.elements[name];
            if (!beforeEls) continue;
            const len = Math.min(afterEls.length, beforeEls.length);
            for (let e = 0; e < len; e++) {
                const dy = Math.abs(afterEls[e].y - beforeEls[e].y);
                const dx = Math.abs(afterEls[e].x - beforeEls[e].x);
                const maxD = Math.max(dy, dx);
                if (maxD > this.cleanupJumpPx) {
                    violations.push({
                        element: name, index: e, frame: cleanupFrame,
                        detail: `Cleanup jump of ${maxD.toFixed(1)}px (limit ${this.cleanupJumpPx}px)`,
                    });
                }
            }
        }
        return { rule: 'cleanupContinuity', pass: violations.length === 0, violations };
    }

    // Opacity should change monotonically for fading elements.
    // No ghost elements (appear for < ghostFrameLimit frames then vanish).
    checkOpacity(trace) {
        const violations = [];
        const frames = trace.frames;
        if (frames.length < 3) return { rule: 'opacity', pass: true, violations };

        for (const name of Object.keys(frames[0].elements)) {
            const presenceRuns = this._getPresenceRuns(trace, name);

            for (const run of presenceRuns) {
                if (run.length > 0 && run.length < this.ghostFrameLimit) {
                    violations.push({
                        element: name, frame: run[0],
                        detail: `Ghost element — appeared for only ${run.length} frame(s)`,
                    });
                }
            }

            for (let e = 0; ; e++) {
                const opacities = this._extractOpacitySeries(trace, name, e);
                if (!opacities || opacities.length < 3) break;

                const direction = this._detectFadeDirection(opacities);
                if (direction === 0) continue;

                for (let i = 1; i < opacities.length; i++) {
                    const delta = opacities[i] - opacities[i - 1];
                    if (direction > 0 && delta < -this.opacityEpsilon) {
                        violations.push({
                            element: name, index: e, frame: i,
                            detail: `Fade-in opacity dipped: ${opacities[i - 1].toFixed(3)} → ${opacities[i].toFixed(3)}`,
                        });
                        break;
                    }
                    if (direction < 0 && delta > this.opacityEpsilon) {
                        violations.push({
                            element: name, index: e, frame: i,
                            detail: `Fade-out opacity bumped: ${opacities[i - 1].toFixed(3)} → ${opacities[i].toFixed(3)}`,
                        });
                        break;
                    }
                }
            }
        }
        return { rule: 'opacity', pass: violations.length === 0, violations };
    }

    // scrollY should not jump by more than maxScrollDelta between frames.
    checkScroll(trace) {
        const violations = [];
        const frames = trace.frames;
        if (frames.length < 2) return { rule: 'scroll', pass: true, violations };

        const totalDuration = frames[frames.length - 1].t - frames[0].t;
        const nominalFrameMs = totalDuration / (frames.length - 1);

        for (let i = 1; i < frames.length; i++) {
            const dt = frames[i].t - frames[i - 1].t;
            const scale = nominalFrameMs > 0 ? Math.max(dt / nominalFrameMs, 1) : 1;
            const delta = Math.abs(frames[i].scrollY - frames[i - 1].scrollY);
            const threshold = this.maxScrollDelta * scale;
            if (delta > threshold) {
                violations.push({
                    frame: i,
                    detail: `Scroll jumped ${delta.toFixed(1)}px (threshold ${threshold.toFixed(1)}px)`,
                });
            }
        }
        return { rule: 'scroll', pass: violations.length === 0, violations };
    }

    // After animation, check for leftover inline animation artifacts.
    checkFinalState(containerEl) {
        const violations = [];
        const artifactProps = ['transform', 'clip-path'];
        const els = containerEl.querySelectorAll('*');

        for (const el of els) {
            for (const prop of artifactProps) {
                const val = el.style.getPropertyValue(prop);
                if (val && val !== 'none' && val !== '') {
                    const tag = el.tagName.toLowerCase();
                    const cls = el.className ? '.' + String(el.className).split(' ').join('.') : '';
                    violations.push({
                        element: `${tag}${cls}`,
                        detail: `Leftover inline ${prop}: "${val}"`,
                    });
                }
            }
        }
        return { rule: 'finalState', pass: violations.length === 0, violations };
    }

    // --- helpers ---

    _buildPositionTracks(trace) {
        const tracks = {};
        const frames = trace.frames;
        for (const name of Object.keys(frames[0].elements)) {
            const firstFrame = frames[0].elements[name];
            for (let e = 0; e < firstFrame.length; e++) {
                const key = firstFrame.length > 1 ? `${name}[${e}]` : name;
                const positions = [];
                for (const frame of frames) {
                    const els = frame.elements[name];
                    if (els && els[e]) positions.push(els[e].y);
                }
                if (positions.length === frames.length) tracks[key] = positions;
            }
        }

        const scrollTrack = frames.map(f => f.scrollY);
        if (Math.abs(scrollTrack[scrollTrack.length - 1] - scrollTrack[0]) > 20) {
            tracks['_scrollY'] = scrollTrack;
        }
        return tracks;
    }

    _findCleanupFrame(trace) {
        const frames = trace.frames;
        let maxChange = 0;
        let maxIdx = -1;

        for (let i = 1; i < frames.length; i++) {
            let change = 0;
            for (const name of Object.keys(frames[i].elements)) {
                const cur = frames[i].elements[name].length;
                const prev = (frames[i - 1].elements[name] || []).length;
                change += Math.abs(cur - prev);
            }
            if (change > maxChange) {
                maxChange = change;
                maxIdx = i;
            }
        }
        return maxIdx;
    }

    _getPresenceRuns(trace, name) {
        const runs = [];
        let current = null;
        for (let i = 0; i < trace.frames.length; i++) {
            const count = (trace.frames[i].elements[name] || []).length;
            if (count > 0) {
                if (current === null) current = [];
                current.push(i);
            } else {
                if (current !== null) { runs.push(current); current = null; }
            }
        }
        if (current !== null) runs.push(current);
        return runs;
    }

    _extractOpacitySeries(trace, name, elementIndex) {
        const series = [];
        for (const frame of trace.frames) {
            const els = frame.elements[name];
            if (!els || !els[elementIndex]) break;
            const op = els[elementIndex].opacity;
            if (op === undefined) return null;
            series.push(typeof op === 'number' ? op : parseFloat(op));
        }
        return series.length >= 3 ? series : null;
    }

    _detectFadeDirection(opacities) {
        const first = opacities[0];
        const last = opacities[opacities.length - 1];
        const delta = last - first;
        if (Math.abs(delta) < 0.1) return 0;
        return delta > 0 ? 1 : -1;
    }

    _avg(arr) {
        if (!arr.length) return 0;
        return arr.reduce((a, b) => a + b, 0) / arr.length;
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = AnimationValidator;
} else if (typeof window !== 'undefined') {
    window.AnimationValidator = AnimationValidator;
}
