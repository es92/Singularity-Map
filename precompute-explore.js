#!/usr/bin/env node
'use strict';

// precompute-explore.js — Persist per-slot static-analysis tables to
// `data/explore-cache/`. Two passes, each produces its own per-slot
// binary file:
//
//   PASS 1 — projections (`<slotKey>.bin`)
//     `cartesianWriteRows` results, deduped by writeDims projection.
//     Mirrors what the browser /explore page renders for each card.
//
//     Layout:
//       [u32 LE  headerJsonLen ]
//       [bytes   headerJson     ] — UTF-8 JSON
//       [bytes   rowsBuf        ] — rowCount × dims.length u8 value indices
//       [bytes   byInputBuf     ] — byInputCount entries:
//                                     u8 keyPairCount
//                                     keyPairCount × {u8 dimIdx, u8 valueIdx}
//                                     u16 LE outputSize
//                                     outputSize × u16 LE row indices
//
//     Header fields: slotKey/Kind/Id, dims (= projDims, mod.writes for
//     module slots / writeDimsForSlot for nodes), inputDims, values
//     (string table; index 0 = UNSET sentinel), rowCount, byInputCount,
//     truncated, stats.
//
//   PASS 2 — full sels + predecessors (`<slotKey>.full.bin`)
//     Every unique full sel emitted at this slot's exit by
//     FlowPropagation, deduped by `selKey`. These carry every dim
//     including upstream pass-throughs — the canonical engine-runtime
//     sel at slot exit. For each unique exit sel we also persist the
//     SET of unique predecessor sels (= dedup'd inputs into this slot
//     that produced this exit sel via the merge in
//     `reachableFullSelsFromInputs`). Reach masks initialized to -1.
//     The predecessor table is what the back-prop stage uses to OR
//     reach masks upstream — no `slotPickPriority` calls, no
//     singleton DFS, just `selKey` lookup against parent slots.
//
//     Layout:
//       [u32 LE  headerJsonLen ]
//       [bytes   headerJson     ] — UTF-8 JSON
//       [bytes   selsBuf        ] — selCount × dims.length u8 value indices
//                                   (UNSET = 0; absent dims encode as 0)
//       [bytes   reachBuf       ] — selCount × i32 LE; -1 means "no
//                                   direct-match pass run yet". After
//                                   the direct-match pass runs, every
//                                   value is ≥ 0 (a 31-bit mask).
//       [bytes   predOffsets    ] — (selCount + 1) × u32 LE; CSR-style
//                                   offsets into predSelsBuf. Pred
//                                   list for sel i is rows
//                                   [predOffsets[i], predOffsets[i+1]).
//       [bytes   predSelsBuf    ] — totalPredCount × dims.length u8;
//                                   each row encodes one predecessor
//                                   sel using the same dim/value
//                                   table as `selsBuf`.
//
//     Header fields: v, slotKey/Kind/Id, dims (sorted union of dims
//     across both exit AND predecessor sels), values (per-slot
//     string table), selCount, totalPredCount, stats.
//
// Plus one global file:
//
//   `_meta.json`
//     Outcome-entry → bit-position table, shared by every slot's
//     reach mask. 28 entries today (13 templates, 15 of those split
//     into per-variant entries via `primaryDimension`).
//
// Run: `node precompute-explore.js` (~3-4 min: ~110s for the 19
// cartesianWriteRows DFSes, ~15-30s for forward propagation + sel
// encoding). Memory peak ~2-3GB during propagation; bump
// --max-old-space-size if needed.

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const { Graph, GraphIO, FlowPropagation, FLOW_DAG, TEMPLATES } =
    require('./node-runtime').loadNodeRuntime();
const MODULE_MAP = (Graph.MODULES || []).reduce((m, mod) => { m[mod.id] = mod; return m; }, {});

const UNSET = '__GIO_UNSET__';

// ─── Outcome entries (variant-aware, 32-bit indexable) ────────────
// Persisted to `_meta.json` so reach-checker.js (used by both the
// Node tests and the browser runtime gate) reads the bit assignment
// from one place. Templates with a
// `primaryDimension` get one entry per variant key; everything else
// gets a single entry. The bit index is the entry's position in the
// flat list. Limit is 31 bits (signed-int safe; lets us use -1 as a
// sentinel without ambiguity).
const outcomeEntries = [];
for (const t of TEMPLATES) {
    const variantKeys = (t.variants && typeof t.variants === 'object')
        ? Object.keys(t.variants) : [];
    if (variantKeys.length > 0 && t.primaryDimension) {
        for (const vk of variantKeys) {
            outcomeEntries.push({
                id: t.id + '--' + vk,
                templateId: t.id,
                primaryDim: t.primaryDimension,
                variantKey: vk,
            });
        }
    } else {
        outcomeEntries.push({ id: t.id, templateId: t.id });
    }
}
if (outcomeEntries.length > 31) {
    throw new Error(outcomeEntries.length + ' entries exceeds 31-bit reach-mask limit');
}
outcomeEntries.forEach((e, i) => { e.bit = 1 << i; });

// ─── Output dir ───────────────────────────────────────────────────
const outDir = path.join(ROOT, 'data', 'explore-cache');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

// Wipe stale per-slot files from any prior format / pass.
for (const f of fs.readdirSync(outDir)) {
    if (f.endsWith('.json') && f !== '_meta.json') fs.unlinkSync(path.join(outDir, f));
    if (f.endsWith('.bin')) fs.unlinkSync(path.join(outDir, f));
}

fs.writeFileSync(
    path.join(outDir, '_meta.json'),
    JSON.stringify({ v: 2, outcomeEntries: outcomeEntries.map(e => ({
        id: e.id, templateId: e.templateId,
        primaryDim: e.primaryDim || null,
        variantKey: e.variantKey || null,
        bit: e.bit,
    })) }, null, 2)
);

// ─── PASS 1 — projections (rows + byInput) ────────────────────────
const slots = FLOW_DAG.nodes.filter(n =>
    n && n.kind !== 'outcome' && n.kind !== 'deadend');

console.log(`Pass 1: cartesianWriteRows for ${slots.length} slots…\n`);
console.log('slot                          inputs   outputs   ms     bytes');
console.log('----------------------------- -------  -------  -----  --------');

let pass1Bytes = 0;
let pass1Ms = 0;

function projDimsForSlot(slot) {
    if (slot.kind === 'module') {
        const mod = MODULE_MAP[slot.id];
        if (mod && Array.isArray(mod.writes)) return mod.writes.slice();
    }
    return GraphIO.writeDimsForSlot(slot).slice();
}

function buildProjectionBinary(slot, r) {
    const projDims = projDimsForSlot(slot);
    const dimsLen = projDims.length;

    const values = [UNSET];
    const valueIdx = new Map([[UNSET, 0]]);
    function intern(v) {
        if (v === undefined || v === UNSET) return 0;
        let idx = valueIdx.get(v);
        if (idx === undefined) {
            idx = values.length;
            values.push(v);
            valueIdx.set(v, idx);
        }
        return idx;
    }

    // `r.rows` is deduped by writes-only — each unique writes-projection
    // gets exactly one row, regardless of how many distinct moved-dim
    // sets DFS paths produced for it. The on-disk format mirrors that:
    // rowsBuf stores writes only, so byInput's [writes,moved] projKeys
    // collapse onto the same row index and we dedupe before encoding.
    const rowCount = r.rows.length;
    const rowsBuf = Buffer.alloc(rowCount * dimsLen);
    const writesKeyToRowIdx = new Map();
    for (let i = 0; i < rowCount; i++) {
        const row = r.rows[i];
        const parts = new Array(dimsLen);
        for (let j = 0; j < dimsLen; j++) {
            const d = projDims[j];
            const v = row[d];
            rowsBuf[i * dimsLen + j] = intern(v);
            parts[j] = [d, v === undefined ? UNSET : v];
        }
        // _keyToRow strips moved when emitting r.rows, so a row's
        // canonical key here is just the writes pairs (no moved
        // wrapping). Match the same shape when extracting from a
        // [writes, moved] projKey below.
        writesKeyToRowIdx.set(JSON.stringify(parts), i);
    }

    const inputDimSet = new Set();
    for (const k of r.byInput.keys()) {
        if (!k) continue;
        const segs = k.split('\x00');
        for (let i = 0; i < segs.length; i += 2) inputDimSet.add(segs[i]);
    }
    const inputDims = [...inputDimSet].sort();
    const inputDimIdx = new Map(inputDims.map((d, i) => [d, i]));

    const byInputCount = r.byInput.size;
    let byInputByteLen = 0;
    const entries = [];
    for (const [inKey, outSet] of r.byInput) {
        const segs = inKey ? inKey.split('\x00') : [];
        const pairCount = segs.length / 2;
        if (pairCount > 255) {
            throw new Error(`Slot ${slot.key}: input key has ${pairCount} pairs (>255)`);
        }
        const pairs = new Array(pairCount);
        for (let i = 0; i < pairCount; i++) {
            const di = inputDimIdx.get(segs[i * 2]);
            const vi = intern(segs[i * 2 + 1]);
            pairs[i] = [di, vi];
        }
        pairs.sort((a, b) => a[0] - b[0]);

        const rowIdxSet = new Set();
        for (const projK of outSet) {
            const parsed = JSON.parse(projK);
            const writesKey = JSON.stringify(parsed[0]);
            const ri = writesKeyToRowIdx.get(writesKey);
            if (ri === undefined) {
                throw new Error(`Slot ${slot.key}: byInput projKey writes-portion not found in rows: ${projK.slice(0, 80)}…`);
            }
            rowIdxSet.add(ri);
        }
        const rowIdxs = [...rowIdxSet].sort((a, b) => a - b);

        const len = 1 + pairCount * 2 + 2 + rowIdxs.length * 2;
        byInputByteLen += len;
        entries.push({ pairs, rowIdxs });
    }

    if (values.length > 256) {
        throw new Error(`Slot ${slot.key}: values table size ${values.length} (>256, format v1 max)`);
    }
    if (inputDims.length > 256) {
        throw new Error(`Slot ${slot.key}: inputDims size ${inputDims.length} (>256, format v1 max)`);
    }
    if (rowCount > 65536) {
        throw new Error(`Slot ${slot.key}: rowCount ${rowCount} (>65536, format v1 max)`);
    }

    const byInputBuf = Buffer.alloc(byInputByteLen);
    let off = 0;
    for (const { pairs, rowIdxs } of entries) {
        byInputBuf.writeUInt8(pairs.length, off); off += 1;
        for (const [di, vi] of pairs) {
            byInputBuf.writeUInt8(di, off); off += 1;
            byInputBuf.writeUInt8(vi, off); off += 1;
        }
        byInputBuf.writeUInt16LE(rowIdxs.length, off); off += 2;
        for (const ri of rowIdxs) {
            byInputBuf.writeUInt16LE(ri, off); off += 2;
        }
    }

    const header = {
        v: 1,
        slotKey: slot.key,
        slotKind: slot.kind,
        slotId: slot.id,
        dims: projDims,
        inputDims,
        values,
        rowCount,
        byInputCount,
        truncated: !!r.truncated,
    };
    return { header, rowsBuf, byInputBuf };
}

for (const slot of slots) {
    const t0 = Date.now();
    const r = GraphIO.cartesianWriteRows(slot);
    const ms = Date.now() - t0;
    pass1Ms += ms;

    const { header, rowsBuf, byInputBuf } = buildProjectionBinary(slot, r);
    header.stats = { inputs: header.byInputCount, outputs: header.rowCount, ms };

    const headerJson = Buffer.from(JSON.stringify(header), 'utf8');
    const headerLen = Buffer.alloc(4);
    headerLen.writeUInt32LE(headerJson.length, 0);
    const fileBuf = Buffer.concat([headerLen, headerJson, rowsBuf, byInputBuf]);

    const outPath = path.join(outDir, slot.key + '.bin');
    fs.writeFileSync(outPath, fileBuf);
    const bytes = fileBuf.length;
    pass1Bytes += bytes;

    console.log(
        `${slot.key.padEnd(29)} ${String(header.byInputCount).padStart(7)}  ${String(header.rowCount).padStart(7)}  ${String(ms).padStart(5)}  ${bytes.toLocaleString().padStart(8)}`);
}

console.log(`\nPass 1 total: ${slots.length} slots, ${(pass1Bytes / 1024 / 1024).toFixed(1)}MB, ${(pass1Ms / 1000).toFixed(1)}s.\n`);

// ─── PASS 2 — full sels per slot (forward propagation) ────────────
//
// FlowPropagation.run walks emergence → terminals; the onSlotOutput
// hook fires once per (slot, output sel) tuple. We dedupe by selKey
// per slot so the captured set is the unique exit-sel set the
// engine could observe at that slot.
//
// `cartesianWriteRows` results are already in `_writeRowsCache` from
// pass 1, so the propagation skips its own DFS work and is dominated
// by the merge inside `reachableFullSelsFromInputs`.

console.log('Pass 2: forward propagation (full sels + preds per slot)…');

// exitDataBySlot: slotKey → Map<exitSelKey, { sel, predSels: Map<predSelKey, predSel> }>
// Built incrementally from two FlowPropagation hooks:
//   onSlotOutput → ensures every exit sel has an entry (covers
//                  emergence, which has no inputs and so doesn't fire
//                  onEdge). Pre-creates the entry with empty preds.
//   onEdge       → adds the deduped input sel as a predecessor of
//                  the corresponding output sel. Fires inside
//                  reachableFullSelsFromInputs's merge loop.
const exitDataBySlot = new Map();

function ensureExit(slotKey, sel) {
    let m = exitDataBySlot.get(slotKey);
    if (!m) { m = new Map(); exitDataBySlot.set(slotKey, m); }
    const k = GraphIO.selKey(sel);
    let entry = m.get(k);
    if (!entry) { entry = { sel, predSels: new Map() }; m.set(k, entry); }
    return entry;
}

function recordSel(slotKey, sel) {
    ensureExit(slotKey, sel);
}

function recordEdge(slotKey, inputSel, outputSel) {
    const entry = ensureExit(slotKey, outputSel);
    const pk = GraphIO.selKey(inputSel);
    if (!entry.predSels.has(pk)) entry.predSels.set(pk, inputSel);
}

const propT0 = Date.now();
FlowPropagation.run({ onSlotOutput: recordSel, onEdge: recordEdge });
const propMs = Date.now() - propT0;
const totalSels = [...exitDataBySlot.values()].reduce((a, m) => a + m.size, 0);
const totalPreds = [...exitDataBySlot.values()].reduce(
    (a, m) => a + [...m.values()].reduce((b, e) => b + e.predSels.size, 0), 0);
console.log(`  propagation: ${(propMs / 1000).toFixed(1)}s, ${totalSels} unique exit sels, ${totalPreds} predecessor edges across ${exitDataBySlot.size} slots\n`);

console.log('slot                          uniqSels  preds  dims  values    ms     bytes');
console.log('----------------------------- --------  -----  ----  ------  -----  --------');

function buildFullSelBinary(slot, exitMap) {
    // ── Per-slot dim union (covers BOTH succ and pred sels) ──
    const dimsSet = new Set();
    for (const { sel, predSels } of exitMap.values()) {
        for (const d of Object.keys(sel)) dimsSet.add(d);
        for (const pred of predSels.values()) for (const d of Object.keys(pred)) dimsSet.add(d);
    }
    const dims = [...dimsSet].sort();
    const dimsLen = dims.length;

    const values = [UNSET];
    const valueIdx = new Map([[UNSET, 0]]);
    function intern(v) {
        if (v === undefined || v === UNSET) return 0;
        let idx = valueIdx.get(v);
        if (idx === undefined) {
            idx = values.length;
            values.push(v);
            valueIdx.set(v, idx);
        }
        return idx;
    }

    const selCount = exitMap.size;

    // Pre-pass: pack sels first so we exercise interns over the
    // exit-sel dim values (most common case) before spilling into
    // pred-only values. Stable across runs.
    const selsBuf = Buffer.alloc(selCount * dimsLen);
    const predLists = new Array(selCount);
    let totalPredCount = 0;
    let i = 0;
    for (const { sel, predSels } of exitMap.values()) {
        for (let j = 0; j < dimsLen; j++) {
            selsBuf[i * dimsLen + j] = intern(sel[dims[j]]);
        }
        const list = [...predSels.values()];
        predLists[i] = list;
        totalPredCount += list.length;
        i++;
    }

    // Pred CSR encoding.
    const predOffsetsBuf = Buffer.alloc((selCount + 1) * 4);
    const predSelsBuf = Buffer.alloc(totalPredCount * dimsLen);
    let predRow = 0;
    for (let n = 0; n < selCount; n++) {
        predOffsetsBuf.writeUInt32LE(predRow, n * 4);
        const list = predLists[n];
        for (const pred of list) {
            for (let j = 0; j < dimsLen; j++) {
                predSelsBuf[predRow * dimsLen + j] = intern(pred[dims[j]]);
            }
            predRow++;
        }
    }
    predOffsetsBuf.writeUInt32LE(predRow, selCount * 4);

    if (values.length > 256) {
        throw new Error(`Slot ${slot.key}: full-sel values table size ${values.length} (>256, format v3 max)`);
    }
    if (dimsLen > 256) {
        throw new Error(`Slot ${slot.key}: full-sel dims ${dimsLen} (>256, format v3 max)`);
    }

    // Reach masks default to -1 (i32 LE = 0xFFFFFFFF). Sentinel for
    // "direct-match pass hasn't run yet". Once that pass runs every
    // entry is ≥ 0 (any 31-bit subset of `outcomeEntries` bits).
    const reachBuf = Buffer.alloc(selCount * 4);
    for (let j = 0; j < selCount; j++) reachBuf.writeInt32LE(-1, j * 4);

    const header = {
        v: 3,
        slotKey: slot.key,
        slotKind: slot.kind,
        slotId: slot.id,
        dims,
        values,
        selCount,
        totalPredCount,
    };
    return { header, selsBuf, reachBuf, predOffsetsBuf, predSelsBuf };
}

let pass2Bytes = 0;
let pass2Ms = 0;
let totalEncodedPreds = 0;

for (const slot of slots) {
    const exitMap = exitDataBySlot.get(slot.key);
    if (!exitMap || exitMap.size === 0) {
        console.log(`${slot.key.padEnd(29)} ${'0'.padStart(8)}  (no exit sels — slot unreached)`);
        continue;
    }

    const t0 = Date.now();
    const { header, selsBuf, reachBuf, predOffsetsBuf, predSelsBuf } = buildFullSelBinary(slot, exitMap);
    const ms = Date.now() - t0;
    pass2Ms += ms;
    totalEncodedPreds += header.totalPredCount;

    header.stats = {
        uniqSels: header.selCount,
        preds: header.totalPredCount,
        dims: header.dims.length,
        values: header.values.length,
        ms,
    };

    const headerJson = Buffer.from(JSON.stringify(header), 'utf8');
    const headerLen = Buffer.alloc(4);
    headerLen.writeUInt32LE(headerJson.length, 0);
    const fileBuf = Buffer.concat([headerLen, headerJson, selsBuf, reachBuf, predOffsetsBuf, predSelsBuf]);

    const outPath = path.join(outDir, slot.key + '.full.bin');
    fs.writeFileSync(outPath, fileBuf);
    const bytes = fileBuf.length;
    pass2Bytes += bytes;

    console.log(
        `${slot.key.padEnd(29)} ${String(header.selCount).padStart(8)}  ${String(header.totalPredCount).padStart(5)}  ${String(header.dims.length).padStart(4)}  ${String(header.values.length).padStart(6)}  ${String(ms).padStart(5)}  ${bytes.toLocaleString().padStart(8)}`);
}

console.log(`\nPass 2 total: ${exitDataBySlot.size} slots, ${(pass2Bytes / 1024 / 1024).toFixed(1)}MB, encode ${(pass2Ms / 1000).toFixed(1)}s + propagation ${(propMs / 1000).toFixed(1)}s.`);
console.log(`Edges captured: ${totalEncodedPreds.toLocaleString()} predecessor edges (avg ${(totalEncodedPreds / totalSels).toFixed(2)} preds/sel).`);
console.log(`Output: ${path.relative(ROOT, outDir)}/`);
