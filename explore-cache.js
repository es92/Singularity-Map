'use strict';

// explore-cache.js — Loader for the per-slot tables persisted by
// precompute-explore.js.
//
// Two shapes coexist:
//
//   PASS 1 — projection cache (`<slotKey>.bin`):
//     loadSlot(slotKey)    — rehydrate to legacy
//                            {dims, rows, byInput: Map<string, Set<string>>}.
//     openSlot(slotKey)    — binary view; getRowSel / getInputSel /
//                            getInputOutputs without string allocation.
//
//   PASS 2 — full-sel + reach + predecessors cache (`<slotKey>.full.bin`):
//     openFullSels(slotKey)        — Node-side disk loader. Returns a
//                                    binary view: getSel / getReach /
//                                    setReach / getPredCount / getPred /
//                                    iteratePreds. writeReach flushes
//                                    only the reach slab.
//     openFullSelsFromBuffer(buf,
//                            slotKey)
//                                  — Cross-platform. Same view but
//                                    parses from an already-fetched
//                                    Uint8Array (browser uses this
//                                    after fetch + DecompressionStream).
//                                    No mutation / writeReach.
//     loadFullSels(slotKey)        — JS-object form; Node only.
//
// The Node functions (`require('fs')`-backed) are no-ops in browsers.
// `openFullSelsFromBuffer` and the lower-level parser are the
// cross-platform path; every Node disk loader funnels through it.
//
// File format is documented in precompute-explore.js.

(function (root) {

const _isNode = typeof process !== 'undefined'
    && process.versions
    && process.versions.node
    && typeof require === 'function';

const fs = _isNode ? require('fs') : null;
const path = _isNode ? require('path') : null;

const ROOT = _isNode ? __dirname : null;
const CACHE_DIR = _isNode ? path.join(ROOT, 'data', 'explore-cache') : null;

const UNSET = '__GIO_UNSET__';

// ─── Cross-platform binary readers ───────────────────────────────
// Node Buffer is a Uint8Array subclass, so index access and the
// helpers below are identical across environments — no Buffer
// .readUInt32LE / .toString calls anywhere in the parser.

function _u8(buf, off)  { return buf[off]; }
function _u16(buf, off) { return buf[off] | (buf[off + 1] << 8); }
function _u32(buf, off) {
    // Avoid sign extension on the high byte.
    return ((buf[off]) | (buf[off + 1] << 8) | (buf[off + 2] << 16))
        + (buf[off + 3] * 0x1000000);
}
function _i32(buf, off) {
    return (buf[off]) | (buf[off + 1] << 8) | (buf[off + 2] << 16) | (buf[off + 3] << 24);
}
function _w_i32(buf, off, v) {
    buf[off]     = v & 0xff;
    buf[off + 1] = (v >>> 8)  & 0xff;
    buf[off + 2] = (v >>> 16) & 0xff;
    buf[off + 3] = (v >>> 24) & 0xff;
}

const _td = (typeof TextDecoder !== 'undefined')
    ? new TextDecoder('utf-8')
    : null;
function _decodeUtf8(buf, off, len) {
    if (_td) return _td.decode(buf.subarray(off, off + len));
    // Fallback (older Node without global TextDecoder):
    return Buffer.from(buf.buffer, buf.byteOffset + off, len).toString('utf8');
}

function _asUint8Array(buf) {
    // Accept Buffer, Uint8Array, or ArrayBuffer. Normalize to
    // Uint8Array for index access. Buffer is already a Uint8Array
    // so a no-op pass-through; ArrayBuffer needs wrapping.
    if (buf instanceof Uint8Array) return buf;
    if (typeof ArrayBuffer !== 'undefined' && buf instanceof ArrayBuffer) {
        return new Uint8Array(buf);
    }
    throw new Error('explore-cache: expected Uint8Array, Buffer, or ArrayBuffer');
}

// ─── Pass 1 view (projection cache) ──────────────────────────────

function _readFileBuf(slotKey) {
    if (!_isNode) return null;
    const p = path.join(CACHE_DIR, slotKey + '.bin');
    if (!fs.existsSync(p)) return null;
    return fs.readFileSync(p);
}

function _parseHeader(fileBuf) {
    const headerLen = _u32(fileBuf, 0);
    const headerJson = _decodeUtf8(fileBuf, 4, headerLen);
    const header = JSON.parse(headerJson);
    if (header.v !== 1) {
        throw new Error('explore-cache: unsupported format version ' + header.v);
    }
    const bodyOff = 4 + headerLen;
    return { header, bodyOff };
}

function _openSlotFromBuffer(buf) {
    const fileBuf = _asUint8Array(buf);
    const { header, bodyOff } = _parseHeader(fileBuf);

    const dimsLen = header.dims.length;
    const rowsOff = bodyOff;
    const rowsBytes = header.rowCount * dimsLen;
    const byInputOff = rowsOff + rowsBytes;

    const inputOffsets = new Uint32Array(header.byInputCount + 1);
    let off = byInputOff;
    for (let n = 0; n < header.byInputCount; n++) {
        inputOffsets[n] = off;
        const pairCount = _u8(fileBuf, off);
        const setOff = off + 1 + pairCount * 2;
        const setSize = _u16(fileBuf, setOff);
        off = setOff + 2 + setSize * 2;
    }
    inputOffsets[header.byInputCount] = off;

    function getRowValueIdx(rowIdx, dimPos) {
        return _u8(fileBuf, rowsOff + rowIdx * dimsLen + dimPos);
    }

    function getRowSel(rowIdx) {
        const sel = {};
        const base = rowsOff + rowIdx * dimsLen;
        for (let j = 0; j < dimsLen; j++) {
            const vi = _u8(fileBuf, base + j);
            if (vi !== 0) sel[header.dims[j]] = header.values[vi];
        }
        return sel;
    }

    function getInputSel(n) {
        const o = inputOffsets[n];
        const pairCount = _u8(fileBuf, o);
        const sel = {};
        for (let i = 0; i < pairCount; i++) {
            const di = _u8(fileBuf, o + 1 + i * 2);
            const vi = _u8(fileBuf, o + 1 + i * 2 + 1);
            sel[header.inputDims[di]] = header.values[vi];
        }
        return sel;
    }

    function getInputOutputs(n) {
        const o = inputOffsets[n];
        const pairCount = _u8(fileBuf, o);
        const setOff = o + 1 + pairCount * 2;
        const setSize = _u16(fileBuf, setOff);
        const arr = new Uint16Array(setSize);
        for (let i = 0; i < setSize; i++) {
            arr[i] = _u16(fileBuf, setOff + 2 + i * 2);
        }
        return arr;
    }

    return {
        slotKey: header.slotKey,
        slotKind: header.slotKind,
        slotId: header.slotId,
        dims: header.dims,
        inputDims: header.inputDims,
        values: header.values,
        rowCount: header.rowCount,
        byInputCount: header.byInputCount,
        truncated: !!header.truncated,
        stats: header.stats || null,
        getRowValueIdx,
        getRowSel,
        getInputSel,
        getInputOutputs,
    };
}

function openSlot(slotKey) {
    const buf = _readFileBuf(slotKey);
    if (!buf) return null;
    return _openSlotFromBuffer(buf);
}

// ─── Legacy-shape rehydration (Node-only) ────────────────────────

function _rebuildSelKey(sel) {
    const keys = Object.keys(sel).sort();
    const parts = new Array(keys.length * 2);
    for (let i = 0; i < keys.length; i++) {
        parts[i * 2] = keys[i];
        parts[i * 2 + 1] = sel[keys[i]];
    }
    return parts.join('\x00');
}

function _rebuildProjKey(rowSel, dims) {
    const parts = new Array(dims.length);
    for (let j = 0; j < dims.length; j++) {
        const v = rowSel[dims[j]];
        parts[j] = [dims[j], v === undefined ? UNSET : v];
    }
    return JSON.stringify(parts);
}

function loadSlot(slotKey) {
    const view = openSlot(slotKey);
    if (!view) return null;

    const rows = new Array(view.rowCount);
    const projKeys = new Array(view.rowCount);
    for (let i = 0; i < view.rowCount; i++) {
        const sel = view.getRowSel(i);
        const denseRow = {};
        for (const d of view.dims) denseRow[d] = (sel[d] === undefined) ? UNSET : sel[d];
        rows[i] = denseRow;
        projKeys[i] = _rebuildProjKey(sel, view.dims);
    }

    const byInput = new Map();
    for (let n = 0; n < view.byInputCount; n++) {
        const inSel = view.getInputSel(n);
        const inKey = _rebuildSelKey(inSel);
        const outIdxs = view.getInputOutputs(n);
        const set = new Set();
        for (let i = 0; i < outIdxs.length; i++) set.add(projKeys[outIdxs[i]]);
        byInput.set(inKey, set);
    }

    return {
        slotKey: view.slotKey,
        slotKind: view.slotKind,
        slotId: view.slotId,
        dims: view.dims,
        rows,
        byInput,
        truncated: view.truncated,
        stats: view.stats,
    };
}

function loadAll() {
    if (!_isNode) return new Map();
    if (!fs.existsSync(CACHE_DIR)) return new Map();
    const files = fs.readdirSync(CACHE_DIR).filter(f => f.endsWith('.bin'));
    const out = new Map();
    for (const f of files) {
        const slotKey = f.slice(0, -'.bin'.length);
        out.set(slotKey, loadSlot(slotKey));
    }
    return out;
}

// ─── Pass 2 view (full-sel + reach + predecessors) ──────────────
//
// The cross-platform parser sits below; both the Node disk loader
// (openFullSels — supports writeReach) and the browser path
// (openFullSelsFromBuffer — read-only, no mutation) wrap it.

function _parseFullSelsBuffer(buf, opts) {
    const fileBuf = _asUint8Array(buf);
    const headerLen = _u32(fileBuf, 0);
    const header = JSON.parse(_decodeUtf8(fileBuf, 4, headerLen));
    if (header.v !== 3) {
        throw new Error('explore-cache: unsupported full-sel format version '
            + header.v + ' (expected 3)');
    }

    const dimsLen = header.dims.length;
    const selsOff = 4 + headerLen;
    const selsBytes = header.selCount * dimsLen;
    const reachOff = selsOff + selsBytes;
    const reachBytes = header.selCount * 4;
    const predOffsetsOff = reachOff + reachBytes;
    const predOffsetsBytes = (header.selCount + 1) * 4;
    const predSelsOff = predOffsetsOff + predOffsetsBytes;

    // Reach is small (selCount × 4 bytes); copy into a typed array
    // so callers can mutate without touching the file slab.
    const reach = new Int32Array(header.selCount);
    for (let i = 0; i < header.selCount; i++) {
        reach[i] = _i32(fileBuf, reachOff + i * 4);
    }

    function _decodeSelAt(byteOff) {
        const sel = {};
        for (let j = 0; j < dimsLen; j++) {
            const vi = _u8(fileBuf, byteOff + j);
            if (vi !== 0) sel[header.dims[j]] = header.values[vi];
        }
        return sel;
    }

    function getSelValueIdx(selIdx, dimPos) {
        return _u8(fileBuf, selsOff + selIdx * dimsLen + dimPos);
    }

    function getSel(selIdx) {
        return _decodeSelAt(selsOff + selIdx * dimsLen);
    }

    function getReach(selIdx) { return reach[selIdx]; }
    function setReach(selIdx, mask) { reach[selIdx] = mask | 0; }

    function _predRange(selIdx) {
        const lo = _u32(fileBuf, predOffsetsOff + selIdx * 4);
        const hi = _u32(fileBuf, predOffsetsOff + (selIdx + 1) * 4);
        return [lo, hi];
    }

    function getPredCount(selIdx) {
        const r = _predRange(selIdx);
        return r[1] - r[0];
    }

    function getPred(selIdx, k) {
        const [lo, hi] = _predRange(selIdx);
        if (k < 0 || k >= hi - lo) return null;
        return _decodeSelAt(predSelsOff + (lo + k) * dimsLen);
    }

    function iteratePreds(selIdx, cb) {
        const [lo, hi] = _predRange(selIdx);
        for (let k = lo; k < hi; k++) {
            if (cb(_decodeSelAt(predSelsOff + k * dimsLen)) === false) return;
        }
    }

    const view = {
        slotKey: header.slotKey,
        slotKind: header.slotKind,
        slotId: header.slotId,
        dims: header.dims,
        values: header.values,
        selCount: header.selCount,
        totalPredCount: header.totalPredCount,
        stats: header.stats || null,
        getSelValueIdx,
        getSel,
        getReach,
        setReach,
        getPredCount,
        getPred,
        iteratePreds,
    };

    if (opts && opts.writeReachTo) {
        // Node-only path: writeReach re-serializes just the reach
        // slab and atomic-renames over the source file. selsBuf,
        // predOffsets, predSelsBuf are pass-2-immutable so we splice
        // a fresh reach buffer between them.
        view.writeReach = function () {
            const newReach = Buffer.alloc(reachBytes);
            for (let i = 0; i < header.selCount; i++) {
                _w_i32(newReach, i * 4, reach[i] | 0);
            }
            const head = fileBuf.subarray(0, reachOff);
            const tail = fileBuf.subarray(predOffsetsOff);
            const merged = Buffer.concat([head, newReach, tail]);
            const tmp = opts.writeReachTo + '.tmp';
            fs.writeFileSync(tmp, merged);
            fs.renameSync(tmp, opts.writeReachTo);
        };
    }

    return view;
}

function openFullSelsFromBuffer(buf, slotKey) {
    // Browser entrypoint: caller owns the buffer (typically the result
    // of fetch + DecompressionStream → ArrayBuffer). Read-only.
    const view = _parseFullSelsBuffer(buf);
    if (slotKey && !view.slotKey) view.slotKey = slotKey;
    return view;
}

function openFullSels(slotKey) {
    if (!_isNode) {
        throw new Error('explore-cache.openFullSels is Node-only — '
            + 'browsers should use openFullSelsFromBuffer(fetchedBuffer, slotKey)');
    }
    const p = path.join(CACHE_DIR, slotKey + '.full.bin');
    if (!fs.existsSync(p)) return null;
    return _parseFullSelsBuffer(fs.readFileSync(p), { writeReachTo: p });
}

function loadFullSels(slotKey) {
    const v = openFullSels(slotKey);
    if (!v) return null;
    const sels = new Array(v.selCount);
    for (let i = 0; i < v.selCount; i++) sels[i] = v.getSel(i);
    const reach = new Int32Array(v.selCount);
    for (let i = 0; i < v.selCount; i++) reach[i] = v.getReach(i);
    const predOffsets = new Array(v.selCount + 1);
    const predSels = [];
    let n = 0;
    for (let i = 0; i < v.selCount; i++) {
        predOffsets[i] = n;
        v.iteratePreds(i, p => { predSels.push(p); n++; });
    }
    predOffsets[v.selCount] = n;
    return {
        slotKey: v.slotKey, slotKind: v.slotKind, slotId: v.slotId,
        dims: v.dims, values: v.values, selCount: v.selCount,
        sels, reach, predOffsets, predSels, stats: v.stats,
    };
}

function loadMeta() {
    if (!_isNode) return null;
    const p = path.join(CACHE_DIR, '_meta.json');
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function cacheDir() { return CACHE_DIR; }

const api = {
    loadSlot, openSlot, loadAll,
    openFullSels, openFullSelsFromBuffer, loadFullSels,
    loadMeta,
    cacheDir,
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
} else {
    root.ExploreCache = api;
}

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
