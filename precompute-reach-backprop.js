#!/usr/bin/env node
'use strict';

// precompute-reach-backprop.js — Stage 3 of the reach pipeline.
//
// Walks every slot in REVERSE topological order. For each unique sel
// in the slot, takes its (already direct-match-populated) reach mask
// and ORs it into every parent slot's reach entry whose sel matches
// one of this sel's stored predecessors (`predSelsBuf`). After this
// pass, every reach mask carries the OR of every outcome reachable
// by any forward path from that (slot, sel) state.
//
// No `slotPickPriority`, no singleton DFS, no graph traversal at
// all — the predecessor table emitted by precompute-explore.js
// IS the reach DAG. We just walk it leaves-first.
//
// Run: `node precompute-reach-backprop.js`. Quick — dominated by
// per-slot selKey indexing + Map lookups; ~5-10s on 1.88M sels.

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const Cache = require(path.join(ROOT, 'explore-cache'));

// ─── Stable canonical selKey (mirrors GraphIO.selKey) ─────────────
// We build it ourselves so back-prop has zero dependencies on the
// graph runtime — the cache is the only input.
function selKey(sel) {
    const keys = Object.keys(sel).sort();
    const parts = new Array(keys.length * 2);
    for (let i = 0; i < keys.length; i++) {
        parts[i * 2] = keys[i];
        parts[i * 2 + 1] = sel[keys[i]];
    }
    return parts.join('\x00');
}

// ─── Discover slots ───────────────────────────────────────────────
const cacheDir = Cache.cacheDir();
const slotKeys = fs.readdirSync(cacheDir)
    .filter(f => f.endsWith('.full.bin'))
    .map(f => f.slice(0, -'.full.bin'.length));

if (slotKeys.length === 0) {
    throw new Error('precompute-reach-backprop: no .full.bin files found — run precompute-explore.js first.');
}

console.log(`Opening ${slotKeys.length} slot files…`);
const views = new Map();
for (const k of slotKeys) views.set(k, Cache.openFullSels(k));

// ─── Build the global selKey → (slot, idx)[] index ────────────────
//
// The same selKey can legitimately exist in multiple slots — node
// slots whose only edges `move` their answer dim to flavor
// (brittle.sufficient, takeoff, governance_window, etc.) leave the
// sel value identical to the input. We capture all owners.
//
// At ~1.88M sels with ~30B selKeys: ~60 MB of strings + Map overhead.
console.log('Indexing all sels by selKey…');
const ownersOfSelKey = new Map();   // selKey → [(slotKey, idx)]
let totalSels = 0;
for (const [k, v] of views) {
    for (let i = 0; i < v.selCount; i++) {
        const sk = selKey(v.getSel(i));
        let arr = ownersOfSelKey.get(sk);
        if (!arr) { arr = []; ownersOfSelKey.set(sk, arr); }
        arr.push(k, i);   // flat (slotKey, idx) pairs to keep allocation tight
        totalSels++;
    }
}
console.log(`  ${totalSels.toLocaleString()} sels, ${ownersOfSelKey.size.toLocaleString()} unique selKeys.`);

// ─── Build (slot → predKeys per i) cache + parent edges ───────────
console.log('Building per-sel predecessor selKey lists + topology…');
const predKeysBySel = new Map();   // slotKey → string[][]   (predKeys per sel)
const childrenOfSlot = new Map();  // K_p → Set<K>           (forward DAG)
for (const k of slotKeys) childrenOfSlot.set(k, new Set());

let totalEdges = 0;
for (const [k, v] of views) {
    const preds = new Array(v.selCount);
    for (let i = 0; i < v.selCount; i++) {
        const list = [];
        v.iteratePreds(i, p => { list.push(selKey(p)); });
        preds[i] = list;
        totalEdges += list.length;
        for (const pk of list) {
            const owners = ownersOfSelKey.get(pk);
            if (!owners) continue;
            for (let m = 0; m < owners.length; m += 2) {
                const ownerSlot = owners[m];
                if (ownerSlot !== k) childrenOfSlot.get(ownerSlot).add(k);
            }
        }
    }
    predKeysBySel.set(k, preds);
}
console.log(`  ${totalEdges.toLocaleString()} predecessor edges.\n`);

// ─── Reverse-topo order via post-order DFS from emergence ─────────
console.log('Computing reverse-topo order…');
const visited = new Set();
const order = [];
function visit(k) {
    if (visited.has(k)) return;
    visited.add(k);
    for (const c of childrenOfSlot.get(k) || []) visit(c);
    order.push(k);
}
visit('emergence');
for (const k of slotKeys) if (!visited.has(k)) order.push(k);

console.log(`  order: ${order.join(' → ')}\n`);

// ─── Back-prop pass ───────────────────────────────────────────────
console.log('Back-propagating reach masks…');
console.log('slot                          uniqSels   preds   newBits  ms');
console.log('----------------------------- --------  ------  --------  ----');

let totalNewBits = 0;

for (const slotKey of order) {
    const t0 = Date.now();
    const v = views.get(slotKey);
    const preds = predKeysBySel.get(slotKey);

    let newBitsHere = 0;
    let predsCount = 0;
    for (let i = 0; i < v.selCount; i++) {
        const r = v.getReach(i);
        const list = preds[i];
        predsCount += list.length;
        if (r <= 0 || !list.length) continue;
        for (const pk of list) {
            const owners = ownersOfSelKey.get(pk);
            if (!owners) continue;
            for (let m = 0; m < owners.length; m += 2) {
                const ownerSlot = owners[m];
                if (ownerSlot === slotKey) continue;
                const ownerIdx = owners[m + 1];
                const pv = views.get(ownerSlot);
                const before = pv.getReach(ownerIdx);
                const after = before | r;
                if (after !== before) {
                    pv.setReach(ownerIdx, after);
                    let diff = after & ~before;
                    while (diff) { newBitsHere++; diff &= diff - 1; }
                }
            }
        }
    }

    totalNewBits += newBitsHere;
    const ms = Date.now() - t0;
    console.log(
        `${slotKey.padEnd(29)} ${String(v.selCount).padStart(8)}  ${String(predsCount).padStart(6)}  ${String(newBitsHere).padStart(8)}  ${String(ms).padStart(4)}`);
}

console.log('\nFlushing reach buffers to disk…');
const flushT0 = Date.now();
for (const v of views.values()) v.writeReach();
const flushMs = Date.now() - flushT0;
console.log(`  ${(flushMs / 1000).toFixed(1)}s.`);

console.log(`\nTotal new bits ORed: ${totalNewBits.toLocaleString()}.`);

// ─── Summary stats: per-slot reach distribution ───────────────────
console.log('\nFinal reach distribution per slot:');
console.log('slot                          reach=0      reach>0   maxBits');
console.log('----------------------------- ----------  ----------  -------');
for (const slotKey of slotKeys.slice().sort()) {
    const v = views.get(slotKey);
    let zero = 0, nonZero = 0, maxBits = 0;
    for (let i = 0; i < v.selCount; i++) {
        const r = v.getReach(i);
        if (r === 0) zero++;
        else if (r > 0) {
            nonZero++;
            let bits = 0;
            for (let mm = r; mm; mm &= mm - 1) bits++;
            if (bits > maxBits) maxBits = bits;
        }
    }
    console.log(
        `${slotKey.padEnd(29)} ${String(zero).padStart(10)}  ${String(nonZero).padStart(10)}  ${String(maxBits).padStart(7)}`);
}
