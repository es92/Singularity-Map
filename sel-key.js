// sel-key.js — canonical sel-stringification.
//
// One function. NUL-delimited, sorted-key string built by interleaving
// keys and values into a flat array, then `join('\x00')`. Same shape
// V8 hashes cheaply on Map ops, and the hot path is in
// `reachableFullSelsFromInputs` (escape_late: O(1M) calls per slot).
//
// Single source of truth — used by:
//   * graph-io.js's per-slot enumeration / merge
//   * reach-checker.js's slot-keyed cache lookups + in-module DFS memo
//   * precompute-reach-backprop.js's predecessor-table walk
//   * tests/runtime_cache_parity.js's diff-against-cache loop
//
// Dual-mode export: in Node `require('./sel-key').selKey`, in browser
// `window.SelKey.selKey`. Mirrors engine.js's pattern. Has no
// dependencies on graph runtime — safe to load before graph.js.
//
// (`explore-cache.js`'s `getSelKey(i)` is intentionally specialized —
// it builds the same string from dense byte buffers without a temporary
// object — so it's not consolidated here.)

(function () {
    'use strict';

    function selKey(sel) {
        const keys = Object.keys(sel).sort();
        const parts = new Array(keys.length * 2);
        for (let i = 0; i < keys.length; i++) {
            const k = keys[i];
            parts[i * 2] = k;
            parts[i * 2 + 1] = sel[k];
        }
        return parts.join('\x00');
    }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { selKey };
    }
    if (typeof window !== 'undefined') {
        window.SelKey = { selKey };
    }
})();
