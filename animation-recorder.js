'use strict';

class AnimationRecorder {
    constructor(options = {}) {
        this._targets = options.targets || {
            questionCard: '.question-card',
            outcomeCard: '#outcome-card',
            timelineEvents: '.timeline-event',
            rollWrapper: '.roll-wrapper',
            questionZone: '.question-zone',
        };
        this._extraProps = options.captureProperties || ['opacity'];
        this._container = options.container || document.getElementById('app');

        this._recording = false;
        this._rafId = null;
        this._frames = [];
        this._startTime = 0;
        this._traces = [];
    }

    start() {
        if (this._recording) return;
        this._recording = true;
        this._frames = [];
        this._startTime = performance.now();
        this._tick();
    }

    stop() {
        if (!this._recording) return null;
        this._recording = false;
        if (this._rafId) {
            cancelAnimationFrame(this._rafId);
            this._rafId = null;
        }
        this._captureFrame();

        const trace = {
            meta: {
                startTime: this._startTime,
                endTime: performance.now(),
                frameCount: this._frames.length,
                userAgent: navigator.userAgent,
            },
            frames: this._frames,
        };
        this._traces.push(trace);
        return trace;
    }

    getLastTrace() {
        return this._traces.length ? this._traces[this._traces.length - 1] : null;
    }

    getAllTraces() {
        return this._traces.slice();
    }

    clearTraces() {
        this._traces = [];
    }

    isRecording() {
        return this._recording;
    }

    _tick() {
        if (!this._recording) return;
        this._captureFrame();
        this._rafId = requestAnimationFrame(() => this._tick());
    }

    _captureFrame() {
        const t = performance.now() - this._startTime;
        const elements = {};

        for (const [name, selector] of Object.entries(this._targets)) {
            const nodes = this._container.querySelectorAll(selector);
            const captured = [];
            for (const node of nodes) {
                const rect = node.getBoundingClientRect();
                const entry = {
                    x: Math.round(rect.x * 100) / 100,
                    y: Math.round(rect.y * 100) / 100,
                    w: Math.round(rect.width * 100) / 100,
                    h: Math.round(rect.height * 100) / 100,
                };
                if (this._extraProps.length) {
                    const cs = getComputedStyle(node);
                    for (const prop of this._extraProps) {
                        const raw = cs.getPropertyValue(prop);
                        entry[prop] = isNaN(parseFloat(raw)) ? raw : parseFloat(raw);
                    }
                }
                captured.push(entry);
            }
            elements[name] = captured;
        }

        this._frames.push({
            t: Math.round(t * 100) / 100,
            scrollY: Math.round(window.scrollY * 100) / 100,
            elements,
        });
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = AnimationRecorder;
} else if (typeof window !== 'undefined') {
    window.AnimationRecorder = AnimationRecorder;
}
