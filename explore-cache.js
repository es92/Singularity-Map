'use strict';

// explore-cache.js — Loader for the per-slot tables persisted by
// precompute-explore.js.
//
// Two pairs of APIs are exposed, one per pass of the precompute:
//
//   PASS 1 — projection cache (`<slotKey>.bin`):
//     loadSlot(slotKey)    — rehydrate to legacy
//                            {dims, rows, byInput: Map<string, Set<string>>}.
//     openSlot(slotKey)    — binary view; getRowSel / getInputSel /
//                            getInputOutputs without string allocation.
//
//   PASS 2 — full-sel + reach + predecessors cache (`<slotKey>.full.bin`):
//     openFullSels(slotKey) — binary view; getSel(i) / getReach(i) /
//                             setReach(i, mask) / getPredCount(i) /
//                             getPred(i, k) / iteratePreds(i, fn).
//                             writeReach flushes only the reach slab;
//                             selsBuf, predOffsets, predSelsBuf
//                             are constant after pass 2.
//     loadFullSels(slotKey) — convenient JS-object form: returns
//                             { dims, sels, reach, predOffsets,
//                               predSels (flat sel[]) }.
//
// File format is documented in precompute-explore.js.

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const CACHE_DIR = path.join(ROOT, 'data', 'explore-cache');

const UNSET = '__GIO_UNSET__';

function _readFileBuf(slotKey) {
    const p = path.join(CACHE_DIR, slotKey + '.bin');
    if (!fs.existsSync(p)) return null;
    return fs.readFileSync(p);
}

function _parseHeader(fileBuf) {
    const headerLen = fileBuf.readUInt32LE(0);
    const headerJson = fileBuf.slice(4, 4 + headerLen).toString('utf8');
    const header = JSON.parse(headerJson);
    if (header.v !== 1) {
        throw new Error(`explore-cache: unsupported format version ${header.v}`);
    }
    const bodyOff = 4 + headerLen;
    return { header, bodyOff };
}

// ─── Binary view (memory-efficient) ───────────────────────────────

function openSlot(slotKey) {
    const fileBuf = _readFileBuf(slotKey);
    if (!fileBuf) return null;
    const { header, bodyOff } = _parseHeader(fileBuf);

    const dimsLen = header.dims.length;
    const rowsOff = bodyOff;
    const rowsBytes = header.rowCount * dimsLen;
    const byInputOff = rowsOff + rowsBytes;

    // Pre-scan byInput to record (offset, pairCount, outputSize) per
    // entry. O(byInputCount) once, then O(1) per random access. The
    // offsets array is the only auxiliary memory we keep; everything
    // else is read directly from `fileBuf`.
    const inputOffsets = new Uint32Array(header.byInputCount + 1);
    let off = byInputOff;
    for (let n = 0; n < header.byInputCount; n++) {
        inputOffsets[n] = off;
        const pairCount = fileBuf.readUInt8(off);
        const setOff = off + 1 + pairCount * 2;
        const setSize = fileBuf.readUInt16LE(setOff);
        off = setOff + 2 + setSize * 2;
    }
    inputOffsets[header.byInputCount] = off;

    function getRowValueIdx(rowIdx, dimPos) {
        return fileBuf.readUInt8(rowsOff + rowIdx * dimsLen + dimPos);
    }

    function getRowSel(rowIdx) {
        const sel = {};
        const base = rowsOff + rowIdx * dimsLen;
        for (let j = 0; j < dimsLen; j++) {
            const vi = fileBuf.readUInt8(base + j);
            if (vi !== 0) sel[header.dims[j]] = header.values[vi];
        }
        return sel;
    }

    function getInputSel(n) {
        const o = inputOffsets[n];
        const pairCount = fileBuf.readUInt8(o);
        const sel = {};
        for (let i = 0; i < pairCount; i++) {
            const di = fileBuf.readUInt8(o + 1 + i * 2);
            const vi = fileBuf.readUInt8(o + 1 + i * 2 + 1);
            sel[header.inputDims[di]] = header.values[vi];
        }
        return sel;
    }

    function getInputOutputs(n) {
        const o = inputOffsets[n];
        const pairCount = fileBuf.readUInt8(o);
        const setOff = o + 1 + pairCount * 2;
        const setSize = fileBuf.readUInt16LE(setOff);
        const arr = new Uint16Array(setSize);
        for (let i = 0; i < setSize; i++) {
            arr[i] = fileBuf.readUInt16LE(setOff + 2 + i * 2);
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

// ─── Legacy-shape rehydration ─────────────────────────────────────

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
        // Legacy `rows` carry UNSET as an explicit value on each dim,
        // matching `_keyToRow(_projectKey(sel, writes))` in graph-io.
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
    if (!fs.existsSync(CACHE_DIR)) return new Map();
    const files = fs.readdirSync(CACHE_DIR).filter(f => f.endsWith('.bin'));
    const out = new Map();
    for (const f of files) {
        const slotKey = f.slice(0, -'.bin'.length);
        out.set(slotKey, loadSlot(slotKey));
    }
    return out;
}

// ─── PASS 2 — full-sel + reach cache ─────────────────────────────

function _readFullSelFile(slotKey) {
    const p = path.join(CACHE_DIR, slotKey + '.full.bin');
    if (!fs.existsSync(p)) return null;
    return { path: p, buf: fs.readFileSync(p) };
}

function openFullSels(slotKey) {
    const f = _readFullSelFile(slotKey);
    if (!f) return null;
    const fileBuf = f.buf;
    const headerLen = fileBuf.readUInt32LE(0);
    const header = JSON.parse(fileBuf.slice(4, 4 + headerLen).toString('utf8'));
    if (header.v !== 3) {
        throw new Error(`explore-cache: unsupported full-sel format version ${header.v} (expected 3)`);
    }

    const dimsLen = header.dims.length;
    const selsOff = 4 + headerLen;
    const selsBytes = header.selCount * dimsLen;
    const reachOff = selsOff + selsBytes;
    const reachBytes = header.selCount * 4;
    const predOffsetsOff = reachOff + reachBytes;
    const predOffsetsBytes = (header.selCount + 1) * 4;
    const predSelsOff = predOffsetsOff + predOffsetsBytes;

    // Reach is always small (selCount × 4 bytes); copy out into a
    // typed array so callers can mutate it in place without
    // mucking with the file Buffer's underlying slab.
    const reach = new Int32Array(header.selCount);
    for (let i = 0; i < header.selCount; i++) {
        reach[i] = fileBuf.readInt32LE(reachOff + i * 4);
    }

    function _decodeSelAt(byteOff) {
        const sel = {};
        for (let j = 0; j < dimsLen; j++) {
            const vi = fileBuf.readUInt8(byteOff + j);
            if (vi !== 0) sel[header.dims[j]] = header.values[vi];
        }
        return sel;
    }

    function getSelValueIdx(selIdx, dimPos) {
        return fileBuf.readUInt8(selsOff + selIdx * dimsLen + dimPos);
    }

    function getSel(selIdx) {
        return _decodeSelAt(selsOff + selIdx * dimsLen);
    }

    function getReach(selIdx) { return reach[selIdx]; }
    function setReach(selIdx, mask) { reach[selIdx] = mask | 0; }

    function _predRange(selIdx) {
        const lo = fileBuf.readUInt32LE(predOffsetsOff + selIdx * 4);
        const hi = fileBuf.readUInt32LE(predOffsetsOff + (selIdx + 1) * 4);
        return [lo, hi];
    }

    function getPredCount(selIdx) {
        const [lo, hi] = _predRange(selIdx);
        return hi - lo;
    }

    function getPred(selIdx, k) {
        const [lo, hi] = _predRange(selIdx);
        if (k < 0 || k >= hi - lo) return null;
        return _decodeSelAt(predSelsOff + (lo + k) * dimsLen);
    }

    // Iterate each predecessor sel of `selIdx`. Decodes lazily; cb
    // receives the sel object. Returning false short-circuits.
    function iteratePreds(selIdx, cb) {
        const [lo, hi] = _predRange(selIdx);
        for (let k = lo; k < hi; k++) {
            if (cb(_decodeSelAt(predSelsOff + k * dimsLen)) === false) return;
        }
    }

    function writeReach() {
        // Re-serialize only the reach slab. selsBuf, predOffsets, and
        // predSelsBuf are precompute-only and never mutated after
        // pass 2 — splice them around a fresh reachBuf and atomic-
        // rename.
        const newReachBuf = Buffer.alloc(reachBytes);
        for (let i = 0; i < header.selCount; i++) {
            newReachBuf.writeInt32LE(reach[i] | 0, i * 4);
        }
        const head = fileBuf.slice(0, reachOff);
        const tail = fileBuf.slice(predOffsetsOff);
        const merged = Buffer.concat([head, newReachBuf, tail]);
        const tmp = f.path + '.tmp';
        fs.writeFileSync(tmp, merged);
        fs.renameSync(tmp, f.path);
    }

    return {
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
        writeReach,
    };
}

function loadFullSels(slotKey) {
    const v = openFullSels(slotKey);
    if (!v) return null;
    const sels = new Array(v.selCount);
    for (let i = 0; i < v.selCount; i++) sels[i] = v.getSel(i);
    const reach = new Int32Array(v.selCount);
    for (let i = 0; i < v.selCount; i++) reach[i] = v.getReach(i);
    // Flatten preds into a parallel { offsets, sels } pair. Offsets
    // are JS numbers (small enough; back-prop callers don't need a
    // typed array here).
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
    const p = path.join(CACHE_DIR, '_meta.json');
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function cacheDir() { return CACHE_DIR; }

module.exports = {
    loadSlot, openSlot, loadAll,
    openFullSels, loadFullSels,
    loadMeta,
    cacheDir,
};
