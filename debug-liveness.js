const { NODES, NODE_MAP } = require('./graph.js');
const { resolvedVal, isNodeVisible, isEdgeDisabled, cleanSelection, createStack, push, currentState } = require('./engine.js');

let pushCleanChanges = 0, pushTruncations = 0, pushTotal = 0;
function dfsPush(stk, nodeId, edgeId) {
    pushTotal++;
    const existingIdx = stk.findIndex(e => e.nodeId === nodeId);
    if (existingIdx > 0) pushTruncations++;
    const base = existingIdx > 0 ? stk.slice(0, existingIdx) : stk;
    const prev = base[base.length - 1].state;
    const next = { ...prev };
    next[nodeId] = edgeId;
    const snap = Object.keys(next).filter(k => next[k] !== undefined).sort().join(',');
    cleanSelection(next, { autoForce: false });
    const snap2 = Object.keys(next).filter(k => next[k] !== undefined).sort().join(',');
    if (snap !== snap2) pushCleanChanges++;
    return [...base, { nodeId, edgeId, state: next }];
}

// ═══════════════════════════════════════════════
// Equivalence Classes (with 1-class skip fix)
// ═══════════════════════════════════════════════

function extractCondRefs(cond) {
    const refs = new Set();
    if (!cond || typeof cond !== 'object') return refs;
    for (const k of Object.keys(cond)) {
        if (k === 'reason' || k === '_not' || k.startsWith('_')) continue;
        refs.add(k);
    }
    return refs;
}

function parseVal(v) {
    if (v === true) return { type: 'bool', val: true };
    if (v === false) return { type: 'bool', val: false };
    if (v && v.not) return { type: 'not', notValues: v.not, required: !!v.required };
    return { type: 'match', values: Array.isArray(v) ? v : [v] };
}

function buildRefIndex() {
    const condRefs = {}, fromStateDeps = {};
    function addRef(dim, entry) { if (!condRefs[dim]) condRefs[dim] = []; condRefs[dim].push(entry); }
    for (const node of NODES) {
        const addConds = (conds, suffix) => {
            if (!conds) return;
            for (let i = 0; i < conds.length; i++) {
                for (const [k, v] of Object.entries(conds[i])) {
                    if (k === 'reason' || k.startsWith('_')) continue;
                    addRef(k, { ...parseVal(v), targetDim: node.id, ctx: `${node.id}.${suffix}${i}`, category: 'cond' });
                }
            }
        };
        addConds(node.activateWhen, 'act');
        addConds(node.hideWhen, 'hide');
        if (node.deriveWhen) for (const rule of node.deriveWhen) {
            if (rule.match) for (const [k, v] of Object.entries(rule.match)) {
                if (k === 'reason') continue;
                addRef(k, { ...parseVal(v), targetDim: node.id, ctx: `${node.id}.derive`, category: 'cond' });
            }
            if (rule.fromState) {
                if (!fromStateDeps[rule.fromState]) fromStateDeps[rule.fromState] = new Set();
                fromStateDeps[rule.fromState].add(node.id);
            }
        }
        if (node.edges) for (const edge of node.edges) {
            if (edge.requires) {
                const cs = Array.isArray(edge.requires) ? edge.requires : [edge.requires];
                for (const cond of cs) for (const [k, v] of Object.entries(cond)) {
                    if (k === 'reason' || k.startsWith('_')) continue;
                    addRef(k, { type: 'edge_requires', values: Array.isArray(v) ? v : [v],
                        targetDim: node.id, targetEdge: edge.id, category: 'edge' });
                }
            }
            const dw = edge.disableWhen || edge.disabledWhen;
            if (dw) for (const cond of (Array.isArray(dw) ? dw : [dw])) for (const [k, v] of Object.entries(cond)) {
                if (k === 'reason' || k.startsWith('_')) continue;
                addRef(k, { ...parseVal(v), type: 'edge_disabled',
                    targetDim: node.id, targetEdge: edge.id, category: 'edge' });
            }
        }
    }
    return { condRefs, fromStateDeps };
}

function computeClasses() {
    const { condRefs, fromStateDeps } = buildRefIndex();
    const classes = {};
    for (const node of NODES) {
        if (!node.edges) continue;
        const m = new Map();
        node.edges.forEach((e, i) => m.set(e.id, i));
        classes[node.id] = m;
    }

    function classCount(dim) {
        return classes[dim] ? new Set(classes[dim].values()).size : 1;
    }

    for (let iter = 0; iter < 20; iter++) {
        let changed = false;
        for (const node of NODES) {
            if (!node.edges) continue;
            const allValues = node.edges.map(e => e.id);
            const refs = condRefs[node.id] || [];
            if (refs.length === 0 && !fromStateDeps[node.id]) {
                if (classCount(node.id) > 1) {
                    for (const v of allValues) classes[node.id].set(v, 0); changed = true;
                }
                continue;
            }

            const condRefList = refs.filter(r => r.category === 'cond');
            const edgeRefList = refs.filter(r => r.category === 'edge');
            const edgesByTarget = {};
            for (const ref of edgeRefList) {
                if (!edgesByTarget[ref.targetDim]) edgesByTarget[ref.targetDim] = [];
                edgesByTarget[ref.targetDim].push(ref);
            }

            const signatures = new Map();
            for (const v of allValues) {
                const sigParts = [];

                for (const ref of condRefList) {
                    if (classCount(ref.targetDim) <= 1) { sigParts.push('*'); continue; }
                    if (ref.type === 'bool') sigParts.push(`cond:${ref.ctx}:bool:${ref.val}`);
                    else if (ref.type === 'not') sigParts.push(`cond:${ref.ctx}:not:${ref.notValues.includes(v) ? 1 : 0}`);
                    else if (ref.type === 'match') sigParts.push(`cond:${ref.ctx}:${ref.values.includes(v) ? 1 : 0}`);
                }

                for (const [targetDim, targetRefs] of Object.entries(edgesByTarget)) {
                    if (classCount(targetDim) <= 1) { sigParts.push('*'); continue; }
                    const targetNode = NODE_MAP[targetDim];
                    if (!targetNode?.edges) continue;
                    const targetClassSet = new Set(classes[targetDim].values());
                    for (const tc of targetClassSet) {
                        const edgesInClass = targetNode.edges.filter(e => classes[targetDim].get(e.id) === tc);
                        let anyReachable = false;
                        for (const te of edgesInClass) {
                            let ok = true;
                            for (const rr of targetRefs.filter(r => r.type === 'edge_requires' && r.targetEdge === te.id)) {
                                if (!rr.values.includes(v)) { ok = false; break; }
                            }
                            if (!ok) continue;
                            let disabled = false;
                            for (const dr of targetRefs.filter(r => r.type === 'edge_disabled' && r.targetEdge === te.id)) {
                                if (dr.values?.includes(v)) { disabled = true; break; }
                                if (dr.notValues && !dr.notValues.includes(v)) { disabled = true; break; }
                            }
                            if (!disabled) { anyReachable = true; break; }
                        }
                        sigParts.push(`edge:${targetDim}.c${tc}:${anyReachable ? 1 : 0}`);
                    }
                }

                if (fromStateDeps[node.id]) for (const td of fromStateDeps[node.id]) {
                    if (classCount(td) <= 1) { sigParts.push('*'); continue; }
                    sigParts.push(`fromState:${td}=${classes[td]?.get(v) ?? 'none'}`);
                }

                signatures.set(v, sigParts.sort().join('|'));
            }

            const sigToId = new Map(); let nextId = 0;
            for (const v of allValues) {
                const sig = signatures.get(v);
                if (!sigToId.has(sig)) sigToId.set(sig, nextId++);
                const nc = sigToId.get(sig);
                if (classes[node.id].get(v) !== nc) changed = true;
                classes[node.id].set(v, nc);
            }
        }
        if (!changed) break;
    }

    // Transitive irrelevance
    const dimReadBy = {};
    for (const node of NODES) {
        const allRefs = new Set();
        if (node.activateWhen) for (const c of node.activateWhen) for (const r of extractCondRefs(c)) allRefs.add(r);
        if (node.hideWhen) for (const c of node.hideWhen) for (const r of extractCondRefs(c)) allRefs.add(r);
        if (node.deriveWhen) for (const rule of node.deriveWhen) {
            if (rule.match) for (const r of extractCondRefs(rule.match)) allRefs.add(r);
            if (rule.fromState) allRefs.add(rule.fromState);
        }
        if (node.edges) for (const e of node.edges) {
            if (e.requires) { const cs = Array.isArray(e.requires) ? e.requires : [e.requires]; for (const c of cs) for (const r of extractCondRefs(c)) allRefs.add(r); }
            const dw = e.disableWhen || e.disabledWhen;
            if (dw) for (const c of (Array.isArray(dw) ? dw : [dw])) for (const r of extractCondRefs(c)) allRefs.add(r);
        }
        allRefs.delete(node.id);
        for (const r of allRefs) { if (!dimReadBy[r]) dimReadBy[r] = new Set(); dimReadBy[r].add(node.id); }
    }
    let tiChanged = true;
    while (tiChanged) {
        tiChanged = false;
        for (const node of NODES) {
            if (!classes[node.id]) continue;
            if (new Set(classes[node.id].values()).size <= 1) continue;
            const readers = dimReadBy[node.id] || new Set();
            if ([...readers].every(r => !classes[r] || new Set(classes[r].values()).size <= 1)) {
                for (const v of classes[node.id].keys()) classes[node.id].set(v, 0);
                tiChanged = true;
            }
        }
    }
    return classes;
}

const classes = computeClasses();

// Print class summary for key dims
console.log('=== KEY CLASSES ===\n');
const keyDims = ['capability','stall_duration','stall_recovery','agi_threshold','asi_threshold',
    'automation','automation_recovery','takeoff','governance_window','open_source'];
for (const id of keyDims) {
    if (!classes[id]) { console.log(`  ${id}: (no edges / derived)`); continue; }
    const groups = {};
    for (const [v, c] of classes[id]) { if (!groups[c]) groups[c] = []; groups[c].push(v); }
    const nc = new Set(classes[id].values()).size;
    console.log(`  ${id} (${nc}): ${Object.values(groups).map(vs => `{${vs.join(',')}}`).join(', ')}`);
}

// ═══════════════════════════════════════════════
// Irrelevance check (annotation only, does NOT change keys)
// "From this state forward, can dim D's value ever influence a future decision?"
// ═══════════════════════════════════════════════

// Pre-compute: for each dim, which non-derived nodes read it in their conditions?
const directReaders = {};
for (const node of NODES) {
    if (node.derived) continue;
    const reads = new Set();
    if (node.activateWhen) for (const c of node.activateWhen) for (const r of extractCondRefs(c)) reads.add(r);
    if (node.hideWhen) for (const c of node.hideWhen) for (const r of extractCondRefs(c)) reads.add(r);
    if (node.edges) for (const e of node.edges) {
        if (e.requires) {
            const cs = Array.isArray(e.requires) ? e.requires : [e.requires];
            for (const c of cs) for (const r of extractCondRefs(c)) reads.add(r);
        }
        const dw = e.disableWhen || e.disabledWhen;
        if (dw) for (const c of (Array.isArray(dw) ? dw : [dw])) for (const r of extractCondRefs(c)) reads.add(r);
    }
    for (const dim of reads) {
        if (!directReaders[dim]) directReaders[dim] = [];
        directReaders[dim].push(node);
    }
}

// Pre-compute: for each dim, which derived dims read it in their deriveWhen?
const derivedReaders = {};
for (const node of NODES) {
    if (!node.deriveWhen) continue;
    const reads = new Set();
    for (const rule of node.deriveWhen) {
        if (rule.match) for (const r of extractCondRefs(rule.match)) reads.add(r);
        if (rule.fromState) reads.add(rule.fromState);
    }
    for (const dim of reads) {
        if (!derivedReaders[dim]) derivedReaders[dim] = [];
        derivedReaders[dim].push(node.id);
    }
}

// Pre-compute: one representative value per class for each dim
const classReps = {};
for (const node of NODES) {
    if (!node.edges) continue;
    const seen = new Set();
    classReps[node.id] = [];
    for (const e of node.edges) {
        const c = classes[node.id].get(e.id);
        if (!seen.has(c)) { seen.add(c); classReps[node.id].push(e.id); }
    }
}

function isDerivedUnsettled(sel, dim) {
    const node = NODE_MAP[dim];
    if (!node || !node.deriveWhen) return false;
    const currentVal = resolvedVal(sel, dim);
    const inputs = new Set();
    for (const rule of node.deriveWhen) {
        if (rule.match) for (const k of Object.keys(rule.match)) {
            if (k !== 'reason') inputs.add(k);
        }
        if (rule.fromState) inputs.add(rule.fromState);
    }
    for (const k of inputs) {
        if (sel[k] !== undefined) continue;
        for (const v of (classReps[k] || [])) {
            if (resolvedVal({ ...sel, [k]: v }, dim) !== currentVal) return true;
        }
    }
    return false;
}

// ── Two-level cache: classKey → per-dim/node Maps ──
const stateCache = new Map();
let cacheHits = 0, cacheMisses = 0;

function getCache(ck) {
    let sc = stateCache.get(ck);
    if (!sc) {
        sc = { irr: new Map(), vis: new Map(), edge: new Map(), cnbv: new Map() };
        stateCache.set(ck, sc);
    }
    return sc;
}

function cachedIsNodeVisible(ck, sel, node) {
    const sc = getCache(ck);
    const cached = sc.vis.get(node.id);
    if (cached !== undefined) { cacheHits++; return cached; }
    cacheMisses++;
    const result = isNodeVisible(sel, node);
    sc.vis.set(node.id, result);
    return result;
}

function cachedIsEdgeDisabled(ck, sel, node, edge) {
    const sc = getCache(ck);
    const ekey = node.id + '|' + edge.id;
    const cached = sc.edge.get(ekey);
    if (cached !== undefined) return cached;
    const result = isEdgeDisabled(sel, node, edge);
    sc.edge.set(ekey, result);
    return result;
}

const _visStack = new Set();
function canNodeBecomeVisible(sel, node, ck) {
    const sc = ck ? getCache(ck) : null;
    if (sc) {
        const cached = sc.cnbv.get(node.id);
        if (cached !== undefined) { cacheHits++; return cached; }
    }
    if (cachedIsNodeVisible(ck, sel, node)) {
        if (sc) { cacheMisses++; sc.cnbv.set(node.id, true); }
        return true;
    }
    if (!node.activateWhen) {
        if (sc) { cacheMisses++; sc.cnbv.set(node.id, true); }
        return true;
    }
    if (_visStack.has(node.id)) return false;
    _visStack.add(node.id);
    try {
        for (const cond of node.activateWhen) {
            let blocked = false;
            for (const [k, v] of Object.entries(cond)) {
                if (k === 'reason' || k.startsWith('_')) continue;
                const current = resolvedVal(sel, k);
                if (current === undefined) {
                    const kNode = NODE_MAP[k];
                    if (kNode && !canNodeBecomeVisible(sel, kNode, ck)) {
                        blocked = true; break;
                    }
                    continue;
                }
                let matches;
                if (Array.isArray(v)) matches = v.includes(current);
                else if (v && v.not) matches = !v.not.includes(current);
                else if (v === true) matches = !!current;
                else if (v === false) matches = !current;
                else matches = current === v;
                if (!matches) {
                    if (isDerivedUnsettled(sel, k)) continue;
                    blocked = true; break;
                }
            }
            if (!blocked) {
                if (sc) { cacheMisses++; sc.cnbv.set(node.id, true); }
                return true;
            }
        }
        if (sc) { cacheMisses++; sc.cnbv.set(node.id, false); }
        return false;
    } finally {
        _visStack.delete(node.id);
    }
}

function couldAffect(sel, dim, derivedDim) {
    const reps = classReps[dim] || [undefined];
    const results = new Set();
    if (sel[dim] === undefined) {
        results.add(resolvedVal(sel, derivedDim));
    }
    for (const v of reps) {
        const testSel = { ...sel, [dim]: v };
        results.add(resolvedVal(testSel, derivedDim));
        if (results.size > 1) break;
    }
    return results.size > 1;
}

let dimsInKey;

function cachedIsIrrelevant(ck, sel, dim) {
    const sc = getCache(ck);
    const cached = sc.irr.get(dim);
    if (cached !== undefined) { cacheHits++; return cached; }
    cacheMisses++;
    const result = isIrrelevant(sel, dim, null, ck);
    sc.irr.set(dim, result);
    return result;
}

function isIrrelevant(sel, dim, seen, ck) {
    if (!seen) seen = new Set();
    if (seen.has(dim)) return true;
    seen.add(dim);

    let result = true;
    outer:
    for (const node of (directReaders[dim] || [])) {
        if (!sel[node.id] && canNodeBecomeVisible(sel, node, ck)) { result = false; break outer; }
    }
    if (result) {
        for (const derivedDim of (derivedReaders[dim] || [])) {
            if (dimsInKey.has(derivedDim) && sel[dim] !== undefined) continue;
            if (!couldAffect(sel, dim, derivedDim)) continue;
            if (!isIrrelevant(sel, derivedDim, seen, ck)) { result = false; break; }
        }
    }
    return result;
}

// ═══════════════════════════════════════════════
// Expanded search (boundary at ai_goals, decel_2mo_progress, benefit_distribution)
// ═══════════════════════════════════════════════

const boundaryNodes = new Set(['power_promise']);
const miniDims = new Set(NODES.filter(n => n.edges && !boundaryNodes.has(n.id)).map(n => n.id));

const dimOrder = NODES.filter(n => n.edges).map(n => n.id);
dimsInKey = new Set(dimOrder);
const derivedDimSet = new Set(NODES.filter(n => n.derived || n.deriveWhen).map(n => n.id));

function classKey(sel) {
    const p = [];
    for (const dim of dimOrder) {
        const v = derivedDimSet.has(dim) ? resolvedVal(sel, dim) : sel[dim];
        if (v === undefined) p.push('U');
        else p.push(String(classes[dim]?.get(v) ?? 0));
    }
    return p.join(',');
}

function runDfs(keyFn, label) {
    const visited = new Set();
    let stateCount = 0;
    const terminals = [];
    let tPush = 0, tKey = 0, tPick = 0;

    function dfs(stk) {
        let t0p = performance.now();
        const sel = currentState(stk);
        const ck = classKey(sel);
        const key = keyFn(sel, ck);
        tKey += performance.now() - t0p;
        if (visited.has(key)) return;
        visited.add(key);
        stateCount++;

        t0p = performance.now();
        let nextNode = null, bestP = -Infinity;
        for (const n of NODES) {
            if (n.derived) continue; if (sel[n.id]) continue;
            if (!cachedIsNodeVisible(ck, sel, n)) continue;
            if (!n.edges || n.edges.length === 0) continue;
            const p = n.priority || 0; if (p > bestP) { bestP = p; nextNode = n; }
        }
        tPick += performance.now() - t0p;
        if (!nextNode) { terminals.push({ sel: { ...sel }, key, type: 'leaf', boundaryNode: null }); return; }
        if (!miniDims.has(nextNode.id)) { terminals.push({ sel: { ...sel }, key, type: 'boundary', boundaryNode: nextNode.id }); return; }
        if (stateCount > 500000) { console.log('OVERFLOW at ' + stateCount); process.exit(1); }

        const enabled = nextNode.edges.filter(e => !cachedIsEdgeDisabled(ck, sel, nextNode, e));
        t0p = performance.now();
        if (enabled.length === 1) { const s = dfsPush(stk, nextNode.id, enabled[0].id); tPush += performance.now() - t0p; dfs(s); return; }
        for (const edge of enabled) { const t1 = performance.now(); const s = dfsPush(stk, nextNode.id, edge.id); tPush += performance.now() - t1; dfs(s); }
    }

    const t0 = Date.now();
    dfs(createStack());
    const elapsed = Date.now() - t0;
    console.log(`\n=== ${label} ===`);
    console.log(`Visited: ${stateCount}, Raw Terminals: ${terminals.length}, Time: ${(elapsed/1000).toFixed(1)}s`);
    console.log(`  push: ${(tPush/1000).toFixed(1)}s, key: ${(tKey/1000).toFixed(1)}s, pick: ${(tPick/1000).toFixed(1)}s`);
    return terminals;
}

const irrKeyCache = new Map();
let irrKeyCacheHits = 0, irrKeyCacheMisses = 0;

function irrKey(sel, ck) {
    if (!ck) ck = classKey(sel);
    const cached = irrKeyCache.get(ck);
    if (cached !== undefined) { irrKeyCacheHits++; return cached; }
    irrKeyCacheMisses++;
    const p = [];
    for (const dim of dimOrder) {
        const v = derivedDimSet.has(dim) ? resolvedVal(sel, dim) : sel[dim];
        const node = NODE_MAP[dim];
        const canWildcard = v !== undefined || !node || node.derived || !cachedIsNodeVisible(ck, sel, node);
        if (canWildcard && cachedIsIrrelevant(ck, sel, dim)) {
            p.push('*'); continue;
        }
        if (v === undefined) p.push('U');
        else p.push(String(classes[dim]?.get(v) ?? 0));
    }
    const result = p.join(',');
    irrKeyCache.set(ck, result);
    return result;
}

function fullIrrKey(sel, ck) {
    if (!ck) ck = classKey(sel);
    const p = [];
    for (const dim of dimOrder) {
        if (cachedIsIrrelevant(ck, sel, dim)) { p.push('*'); continue; }
        const v = derivedDimSet.has(dim) ? resolvedVal(sel, dim) : sel[dim];
        if (v === undefined) p.push('U');
        else p.push(String(classes[dim]?.get(v) ?? 0));
    }
    return p.join(',');
}

// ═══════════════════════════════════════════════
// Superposition DFS
// ═══════════════════════════════════════════════

function pickNextNode(sel, ck) {
    let nextNode = null, bestP = -Infinity;
    for (const n of NODES) {
        if (n.derived) continue;
        if (sel[n.id]) continue;
        if (!(ck ? cachedIsNodeVisible(ck, sel, n) : isNodeVisible(sel, n))) continue;
        if (!n.edges || n.edges.length === 0) continue;
        const p = n.priority || 0;
        if (p > bestP) { bestP = p; nextNode = n; }
    }
    return nextNode;
}

function enabledEdgeIds(sel, node, ck) {
    return node.edges.filter(e => !(ck ? cachedIsEdgeDisabled(ck, sel, node, e) : isEdgeDisabled(sel, node, e))).map(e => e.id).sort();
}

function needsCollapse(sel, superDim, nextNode, ck) {
    const reps = classReps[superDim];
    if (!reps || reps.length <= 1) return false;

    const baseNextId = nextNode.id;
    const baseEdges = enabledEdgeIds(sel, nextNode, ck).join(',');

    for (const rep of reps) {
        const testSel = { ...sel, [superDim]: rep };
        const tck = classKey(testSel);
        const tn = pickNextNode(testSel, tck);
        if (tn?.id !== baseNextId) return true;
        if (tn && enabledEdgeIds(testSel, nextNode, tck).join(',') !== baseEdges) return true;
    }
    return false;
}

function canSuperimpose(sel, node, ck) {
    const reps = classReps[node.id];
    if (!reps || reps.length <= 1) return false;

    const enabled = node.edges.filter(e => !(ck ? cachedIsEdgeDisabled(ck, sel, node, e) : isEdgeDisabled(sel, node, e)));
    const enabledClassSet = new Set();
    for (const e of enabled) enabledClassSet.add(classes[node.id]?.get(e.id));
    if (enabledClassSet.size <= 1) return false;

    const enabledReps = [];
    const seen = new Set();
    for (const e of enabled) {
        const c = classes[node.id]?.get(e.id);
        if (!seen.has(c)) { seen.add(c); enabledReps.push(e.id); }
    }

    function stateFingerprint(testSel, fck) {
        const parts = [];
        for (const n of NODES) {
            if (n.derived) continue;
            if (n.id === node.id) continue;
            if (testSel[n.id]) continue;
            if (!(fck ? cachedIsNodeVisible(fck, testSel, n) : isNodeVisible(testSel, n))) continue;
            if (!n.edges || n.edges.length === 0) continue;
            parts.push(n.id + ':' + enabledEdgeIds(testSel, n, fck).join(','));
        }
        return parts.sort().join('|');
    }

    const baseFP = stateFingerprint(sel, ck);
    for (const rep of enabledReps) {
        const testSel = { ...sel, [node.id]: rep };
        if (stateFingerprint(testSel, classKey(testSel)) !== baseFP) return false;
    }
    return true;
}

const superKeyCache = new Map();
let superKeyCacheHits = 0, superKeyCacheMisses = 0;

function superSetKey(superSet) {
    if (superSet.size === 0) return '';
    const parts = [];
    for (const d of superSet) parts.push(d);
    return parts.sort().join(',');
}

function superKey(sel, superSet, ck) {
    if (!ck) ck = classKey(sel);
    const p = [];
    for (const dim of dimOrder) {
        if (superSet.has(dim)) { p.push('*'); continue; }
        const v = derivedDimSet.has(dim) ? resolvedVal(sel, dim) : sel[dim];
        const node = NODE_MAP[dim];
        const canWildcard = v !== undefined || !node || node.derived || !cachedIsNodeVisible(ck, sel, node);
        if (canWildcard && cachedIsIrrelevant(ck, sel, dim)) {
            p.push('*'); continue;
        }
        if (v === undefined) p.push('U');
        else p.push(String(classes[dim]?.get(v) ?? 0));
    }
    return p.join(',');
}

function runSuperDfs(label) {
    const visited = new Set();
    let stateCount = 0, collapses = 0, superimposed = 0;
    const superDimCounts = {};
    const terminals = [];

    let tPush = 0, tCk = 0, tSk = 0, tPick = 0, tCollapse = 0;

    function dfs(stk, superSet) {
        const sel = currentState(stk);
        let t0p = performance.now();
        const ck = classKey(sel);
        tCk += performance.now() - t0p;
        t0p = performance.now();
        const key = superKey(sel, superSet, ck);
        tSk += performance.now() - t0p;
        if (visited.has(key)) return;
        visited.add(key);
        stateCount++;

        t0p = performance.now();
        const nextNode = pickNextNode(sel, ck);
        tPick += performance.now() - t0p;
        if (!nextNode) {
            terminals.push({ sel: { ...sel }, key, type: 'leaf', boundaryNode: null, superSet: new Set(superSet) });
            return;
        }
        if (!miniDims.has(nextNode.id)) {
            terminals.push({ sel: { ...sel }, key, type: 'boundary', boundaryNode: nextNode.id, superSet: new Set(superSet) });
            return;
        }
        if (stateCount > 500000) { console.log('OVERFLOW at ' + stateCount); process.exit(1); }

        t0p = performance.now();
        for (const superDim of superSet) {
            if (needsCollapse(sel, superDim, nextNode, ck)) {
                collapses++;
                const newSuper = new Set(superSet);
                newSuper.delete(superDim);
                tCollapse += performance.now() - t0p;
                for (const rep of classReps[superDim]) {
                    const t1 = performance.now();
                    const s = dfsPush(stk, superDim, rep);
                    tPush += performance.now() - t1;
                    dfs(s, newSuper);
                }
                return;
            }
        }
        tCollapse += performance.now() - t0p;

        const enabled = nextNode.edges.filter(e => !cachedIsEdgeDisabled(ck, sel, nextNode, e));
        if (enabled.length === 0) {
            terminals.push({ sel: { ...sel }, key, type: 'leaf', boundaryNode: null, superSet: new Set(superSet) });
            return;
        }
        const seenClasses = new Set();
        const classEdges = [];
        for (const e of enabled) {
            const c = classes[nextNode.id]?.get(e.id);
            if (!seenClasses.has(c)) { seenClasses.add(c); classEdges.push(e); }
        }

        if (classEdges.length <= 1) {
            t0p = performance.now();
            const s = dfsPush(stk, nextNode.id, enabled[0].id);
            tPush += performance.now() - t0p;
            dfs(s, superSet);
            return;
        }

        if (canSuperimpose(sel, nextNode, ck)) {
            superimposed++;
            if (!superDimCounts[nextNode.id]) superDimCounts[nextNode.id] = 0;
            superDimCounts[nextNode.id]++;
            const newSuper = new Set(superSet);
            newSuper.add(nextNode.id);
            t0p = performance.now();
            const s = dfsPush(stk, nextNode.id, classEdges[0].id);
            tPush += performance.now() - t0p;
            dfs(s, newSuper);
            return;
        }

        for (const edge of classEdges) {
            t0p = performance.now();
            const s = dfsPush(stk, nextNode.id, edge.id);
            tPush += performance.now() - t0p;
            dfs(s, superSet);
        }
    }

    const t0 = Date.now();
    dfs(createStack(), new Set());
    const elapsed = Date.now() - t0;
    console.log(`\n=== ${label} ===`);
    console.log(`Visited: ${stateCount}, Raw Terminals: ${terminals.length}, Time: ${(elapsed/1000).toFixed(1)}s`);
    console.log(`  push: ${(tPush/1000).toFixed(1)}s, classKey: ${(tCk/1000).toFixed(1)}s, superKey: ${(tSk/1000).toFixed(1)}s, pick: ${(tPick/1000).toFixed(1)}s, collapse: ${(tCollapse/1000).toFixed(1)}s`);
    console.log(`Superimposed: ${superimposed}, Collapses: ${collapses}`);
    console.log(`Dims superimposed:`);
    for (const [dim, cnt] of Object.entries(superDimCounts).sort((a,b) => b[1]-a[1])) {
        console.log(`  ${dim}: ${cnt}x (${classReps[dim]?.length || 0} classes)`);
    }
    return terminals;
}

// Run both and compare (skip baseline for speed with SKIP_BASELINE=1)
const irrTerminals = process.env.SKIP_BASELINE ? [] : runDfs(irrKey, 'irrKey DFS (baseline)');
const superTerminals = runSuperDfs('Superposition DFS');

function collapseTerminals(terms) {
    const m = new Map();
    for (const t of terms) {
        const fk = fullIrrKey(t.sel);
        if (!m.has(fk)) m.set(fk, t);
    }
    return m;
}

function superFullIrrKey(sel, superSet) {
    const ck = classKey(sel);
    const p = [];
    for (const dim of dimOrder) {
        if (superSet && superSet.has(dim)) { p.push('*'); continue; }
        if (cachedIsIrrelevant(ck, sel, dim)) { p.push('*'); continue; }
        const v = derivedDimSet.has(dim) ? resolvedVal(sel, dim) : sel[dim];
        if (v === undefined) p.push('U');
        else p.push(String(classes[dim]?.get(v) ?? 0));
    }
    return p.join(',');
}

function collapseSuperTerminals(terms) {
    const m = new Map();
    for (const t of terms) {
        const fk = superFullIrrKey(t.sel, t.superSet);
        if (!m.has(fk)) m.set(fk, t);
    }
    return m;
}

const irrCollapsed = collapseTerminals(irrTerminals);
const superCollapsed = collapseSuperTerminals(superTerminals);
console.log(`\nirrKey collapsed:  ${irrCollapsed.size}`);
console.log(`super collapsed:  ${superCollapsed.size}`);

const missingKeys = [...irrCollapsed.keys()].filter(k => !superCollapsed.has(k));
const extraKeys = [...superCollapsed.keys()].filter(k => !irrCollapsed.has(k));
console.log(`Missing from super: ${missingKeys.length}, Extra in super: ${extraKeys.length}`);

const normalizeKey = k => k.replace(/U/g, '*');
const irrNorm = new Set([...irrCollapsed.keys()].map(normalizeKey));
const superNorm = new Set([...superCollapsed.keys()].map(normalizeKey));
const normMissing = [...irrNorm].filter(k => !superNorm.has(k));
const normExtra = [...superNorm].filter(k => !irrNorm.has(k));
console.log(`After normalizing U→*: missing=${normMissing.length}, extra=${normExtra.length}, irr=${irrNorm.size}, super=${superNorm.size}`);
for (const k of normMissing) {
    const parts = k.split(',');
    const nonStar = [];
    for (let i = 0; i < dimOrder.length; i++) {
        if (parts[i] !== '*') nonStar.push(`${dimOrder[i]}=${parts[i]}`);
    }
    console.log(`  norm-missing: ${nonStar.join(', ')}`);
}
for (const k of normExtra) {
    const parts = k.split(',');
    const nonStar = [];
    for (let i = 0; i < dimOrder.length; i++) {
        if (parts[i] !== '*') nonStar.push(`${dimOrder[i]}=${parts[i]}`);
    }
    console.log(`  norm-extra: ${nonStar.join(', ')}`);
}

if (missingKeys.length > 0 && missingKeys.length <= 10) {
    console.log(`\nMissing terminal keys:`);
    for (const k of missingKeys) {
        const t = irrCollapsed.get(k);
        const parts = k.split(',');
        const nonStar = [];
        for (let i = 0; i < dimOrder.length; i++) {
            if (parts[i] !== '*' && parts[i] !== 'U') nonStar.push(`${dimOrder[i]}=c${parts[i]}`);
            else if (parts[i] === 'U') nonStar.push(`${dimOrder[i]}=U`);
        }
        console.log(`  boundary:${t.boundaryNode || 'leaf'} — ${nonStar.join(', ')}`);
    }
}
if (extraKeys.length > 0) {
    console.log(`\nExtra terminal keys (first 5):`);
    for (const k of extraKeys.slice(0, 5)) {
        const t = superCollapsed.get(k);
        const parts = k.split(',');
        const nonStar = [];
        for (let i = 0; i < dimOrder.length; i++) {
            if (parts[i] !== '*' && parts[i] !== 'U') nonStar.push(`${dimOrder[i]}=c${parts[i]}`);
            else if (parts[i] === 'U') nonStar.push(`${dimOrder[i]}=U`);
        }
        console.log(`  boundary:${t.boundaryNode || 'leaf'}`);
        console.log(`    superSet: [${[...t.superSet].join(', ')}]`);
        console.log(`    ${nonStar.join(', ')}`);
    }
}

function printTypeCounts(terms, label) {
    const tc = {};
    for (const t of terms) {
        const k = t.type + (t.boundaryNode ? ':'+t.boundaryNode : '');
        tc[k] = (tc[k] || 0) + 1;
    }
    console.log(`\n${label} terminal types:`);
    for (const [k, c] of Object.entries(tc).sort((a, b) => b[1] - a[1])) {
        console.log(`  ${k}: ${c}`);
    }
}
let totalInnerEntries = 0;
for (const sc of stateCache.values()) {
    totalInnerEntries += sc.irr.size + sc.vis.size + sc.edge.size + sc.cnbv.size;
}
console.log(`\n=== Cache stats ===`);
console.log(`Unique classKeys: ${stateCache.size}, Total inner entries: ${totalInnerEntries}`);
console.log(`Hits: ${cacheHits}, Misses: ${cacheMisses}, Rate: ${(100*cacheHits/(cacheHits+cacheMisses||1)).toFixed(1)}%`);
console.log(`irrKey cache: hits=${irrKeyCacheHits}, misses=${irrKeyCacheMisses}`);
console.log(`push stats: total=${pushTotal}, truncations=${pushTruncations}, cleanChanges=${pushCleanChanges}`);
console.log(`superKey cache: hits=${superKeyCacheHits}, misses=${superKeyCacheMisses}, entries=${superKeyCache.size}`);

printTypeCounts(irrTerminals, 'irrKey');
printTypeCounts(superTerminals, 'super');

// Sample ai_goals terminals from super DFS
const aiTerms = superTerminals.filter(t => t.boundaryNode === 'ai_goals');
const step = Math.max(1, Math.floor(aiTerms.length / 20));
const sample = [];
for (let i = 0; i < aiTerms.length && sample.length < 20; i += step) sample.push(aiTerms[i]);

console.log(`\n=== SAMPLE ai_goals terminals (${sample.length} of ${aiTerms.length}) ===\n`);
for (let i = 0; i < sample.length; i++) {
    const s = sample[i].sel;
    const sup = sample[i].superSet;
    const parts = [];
    for (const dim of dimOrder) {
        const v = resolvedVal(s, dim);
        const irr = cachedIsIrrelevant(classKey(s), s, dim);
        if (sup.has(dim)) { if (v !== undefined) parts.push(`${dim}=S`); continue; }
        if (irr) continue;
        if (v === undefined) continue;
        const cls = classes[dim] ? classes[dim].get(v) : '?';
        const short = dim.replace('_threshold','').replace('_recovery','_rec')
            .replace('_distribution','_dist').replace('_outcome','_out')
            .replace('_control','_ctrl').replace('_entrants','_ent')
            .replace('_dynamics','_dyn').replace('_survivors','_surv')
            .replace('_promise','_prom').replace('_result','_res')
            .replace('proliferation','prolif').replace('escalation','escal')
            .replace('mobilization','mobil').replace('pushback','push')
            .replace('coalition','coal').replace('governance','gov')
            .replace('sincerity','sinc').replace('alignment','align')
            .replace('durability','dur').replace('automation','auto')
            .replace('distribution','dist').replace('sovereignty','sov');
        parts.push(`${short}=${v}(c${cls})`);
    }
    console.log(`${String(i+1).padStart(2)}. ${parts.join(', ')}`);
}
