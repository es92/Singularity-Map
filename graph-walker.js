// graph-walker.js — Reusable equivalence-class graph traverser
// Extracts the core DFS infrastructure from debug-liveness.js into a module.

(function() {

const { NODES, NODE_MAP } = (typeof module !== 'undefined' && module.exports)
    ? require('./graph.js') : window.Graph;

const _eng = (typeof module !== 'undefined' && module.exports)
    ? require('./engine.js') : window.Engine;
const { resolvedVal, setRvCache, isNodeVisible, isEdgeDisabled,
        cleanSelection, createStack, push, currentState } = _eng;

// ═══════════════════════════════════════════════
// Equivalence Classes
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
        if (node.deriveWhen) for (let ri = 0; ri < node.deriveWhen.length; ri++) {
            const rule = node.deriveWhen[ri];
            if (rule.match) for (const [k, v] of Object.entries(rule.match)) {
                if (k === 'reason') continue;
                addRef(k, { ...parseVal(v), targetDim: node.id, ctx: `${node.id}.derive${ri}`, category: 'cond' });
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
                    const isVisRef = /\.act\d|\.hide\d/.test(ref.ctx);
                    if (!isVisRef && classCount(ref.targetDim) <= 1) { sigParts.push('*'); continue; }
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

    // Transitive irrelevance — merge classes when no reader distinguishes them.
    // Exception: dims referenced by activateWhen/hideWhen control node visibility,
    // which is always structural even if the target node has 1 class.
    const dimReadBy = {};
    const visibilityDeps = new Set();
    for (const node of NODES) {
        const allRefs = new Set();
        if (!node.derived && node.edges && node.edges.length > 0) {
            if (node.activateWhen) for (const c of node.activateWhen) for (const r of extractCondRefs(c)) { allRefs.add(r); visibilityDeps.add(r); }
            if (node.hideWhen) for (const c of node.hideWhen) for (const r of extractCondRefs(c)) { allRefs.add(r); visibilityDeps.add(r); }
        } else {
            if (node.activateWhen) for (const c of node.activateWhen) for (const r of extractCondRefs(c)) allRefs.add(r);
            if (node.hideWhen) for (const c of node.hideWhen) for (const r of extractCondRefs(c)) allRefs.add(r);
        }
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
            if (visibilityDeps.has(node.id)) continue;
            const readers = dimReadBy[node.id] || new Set();
            if ([...readers].every(r => !classes[r] || new Set(classes[r].values()).size <= 1)) {
                for (const v of classes[node.id].keys()) classes[node.id].set(v, 0);
                tiChanged = true;
            }
        }
    }
    return classes;
}

// ═══════════════════════════════════════════════
// Static pre-computation (run once at require time)
// ═══════════════════════════════════════════════

const classes = computeClasses();
const dimOrder = NODES.filter(n => n.edges).map(n => n.id);
const derivedDimSet = new Set(NODES.filter(n => n.derived || n.deriveWhen).map(n => n.id));

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

// Pre-compute directReaders: for each dim, which non-derived nodes read it?
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

// Pre-compute derivedReaders: for each dim, which derived dims read it?
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

// Pre-compute safePushDims: dims not referenced by any edge condition
const edgeConditionDeps = new Set();
for (const node of NODES) {
    if (!node.edges) continue;
    for (const edge of node.edges) {
        const refs = [];
        if (edge.disabledWhen) for (const cond of edge.disabledWhen) refs.push(...Object.keys(cond).filter(k => k !== 'reason'));
        if (edge.requires) {
            const condSets = Array.isArray(edge.requires) ? edge.requires : [edge.requires];
            for (const cond of condSets) refs.push(...Object.keys(cond).filter(k => k !== 'reason' && !k.startsWith('_')));
        }
        for (const k of refs) {
            edgeConditionDeps.add(k);
            const kNode = NODE_MAP[k];
            if (kNode && kNode.deriveWhen) {
                for (const rule of kNode.deriveWhen) {
                    if (rule.match) for (const mk of Object.keys(rule.match)) { if (mk !== 'reason') edgeConditionDeps.add(mk); }
                    if (rule.fromState) edgeConditionDeps.add(rule.fromState);
                }
            }
        }
    }
}
const safePushDims = new Set(dimOrder.filter(d => !edgeConditionDeps.has(d)));
const dimsInKey = new Set(dimOrder);

const derivedNodes = NODES.filter(n => n.deriveWhen);

// ═══════════════════════════════════════════════
// Runtime: caching layer
// ═══════════════════════════════════════════════

let _activeRvMap = null;
function pauseRvCache() { setRvCache(null); }
function resumeRvCache() { setRvCache(_activeRvMap); }

const stateCache = new Map();
let cacheHits = 0, cacheMisses = 0;

let _lastCk = null, _lastSc = null;
function getCache(ck) {
    if (ck === _lastCk) return _lastSc;
    let sc = stateCache.get(ck);
    if (!sc) {
        sc = { irr: new Map(), vis: new Map(), edge: new Map(), cnbv: new Map(), du: new Map(), ca: new Map() };
        stateCache.set(ck, sc);
    }
    _lastCk = ck;
    _lastSc = sc;
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

// ═══════════════════════════════════════════════
// Irrelevance analysis
// ═══════════════════════════════════════════════

function _isDerivedUnsettled(sel, dim) {
    const node = NODE_MAP[dim];
    if (!node || !node.deriveWhen) return false;
    pauseRvCache();
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
            sel[k] = v;
            const testVal = resolvedVal(sel, dim);
            delete sel[k];
            if (testVal !== currentVal) { resumeRvCache(); return true; }
        }
    }
    resumeRvCache();
    return false;
}

function isDerivedUnsettled(sel, dim, ck) {
    if (ck) {
        const sc = getCache(ck);
        const cached = sc.du.get(dim);
        if (cached !== undefined) { cacheHits++; return cached; }
        cacheMisses++;
        const result = _isDerivedUnsettled(sel, dim);
        sc.du.set(dim, result);
        return result;
    }
    return _isDerivedUnsettled(sel, dim);
}

function _couldAffect(sel, dim, derivedDim) {
    const reps = classReps[dim] || [undefined];
    const results = new Set();
    const saved = sel[dim];
    const hadKey = saved !== undefined;
    pauseRvCache();
    if (!hadKey) {
        results.add(resolvedVal(sel, derivedDim));
    }
    for (const v of reps) {
        sel[dim] = v;
        results.add(resolvedVal(sel, derivedDim));
        if (results.size > 1) {
            if (hadKey) sel[dim] = saved; else delete sel[dim];
            resumeRvCache();
            return true;
        }
    }
    if (hadKey) sel[dim] = saved; else delete sel[dim];
    resumeRvCache();
    return false;
}

function couldAffect(sel, dim, derivedDim, ck) {
    if (ck) {
        const sc = getCache(ck);
        let caByDim = sc.ca.get(dim);
        if (!caByDim) { caByDim = new Map(); sc.ca.set(dim, caByDim); }
        const cached = caByDim.get(derivedDim);
        if (cached !== undefined) { cacheHits++; return cached; }
        cacheMisses++;
        const result = _couldAffect(sel, dim, derivedDim);
        caByDim.set(derivedDim, result);
        return result;
    }
    return _couldAffect(sel, dim, derivedDim);
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
                    if (isDerivedUnsettled(sel, k, ck)) continue;
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

const _irrComputing = new Set();

function cachedIsIrrelevant(ck, sel, dim) {
    const sc = getCache(ck);
    const cached = sc.irr.get(dim);
    if (cached !== undefined) { cacheHits++; return cached; }

    const guard = ck + '\0' + dim;
    if (_irrComputing.has(guard)) return true;
    _irrComputing.add(guard);

    cacheMisses++;
    const result = isIrrelevant(sel, dim, null, ck);
    sc.irr.set(dim, result);

    _irrComputing.delete(guard);
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
            if (!couldAffect(sel, dim, derivedDim, ck)) continue;
            if (dimsInKey.has(derivedDim) && sel[dim] !== undefined) continue;
            if (!isIrrelevant(sel, derivedDim, seen, ck)) { result = false; break; }
        }
    }
    return result;
}

// ═══════════════════════════════════════════════
// Key computation
// ═══════════════════════════════════════════════

const _ckBuf = new Uint8Array(dimOrder.length);
const _skBuf = new Uint8Array(dimOrder.length);

function classKey(sel) {
    for (let i = 0; i < dimOrder.length; i++) {
        const dim = dimOrder[i];
        const v = derivedDimSet.has(dim) ? resolvedVal(sel, dim) : sel[dim];
        _ckBuf[i] = v === undefined ? 85 : 48 + (classes[dim]?.get(v) ?? 0);
    }
    return String.fromCharCode.apply(null, _ckBuf);
}

const irrVectorCache = new Map();

function classAndSuperKey(sel, superSet) {
    for (let i = 0; i < dimOrder.length; i++) {
        const dim = dimOrder[i];
        const v = derivedDimSet.has(dim) ? resolvedVal(sel, dim) : sel[dim];
        _ckBuf[i] = v === undefined ? 85 : 48 + (classes[dim]?.get(v) ?? 0);
    }
    const ck = String.fromCharCode.apply(null, _ckBuf);

    let irrVec = irrVectorCache.get(ck);
    if (!irrVec) {
        irrVec = new Uint8Array(dimOrder.length);
        for (let i = 0; i < dimOrder.length; i++) {
            const dim = dimOrder[i];
            const v = derivedDimSet.has(dim) ? resolvedVal(sel, dim) : sel[dim];
            const node = NODE_MAP[dim];
            const canWildcard = v !== undefined || !node || node.derived || !cachedIsNodeVisible(ck, sel, node);
            if (canWildcard && cachedIsIrrelevant(ck, sel, dim)) irrVec[i] = 1;
        }
        irrVectorCache.set(ck, irrVec);
    }

    for (let i = 0; i < dimOrder.length; i++) {
        _skBuf[i] = (superSet.has(dimOrder[i]) || irrVec[i]) ? 42 : _ckBuf[i];
    }
    return { ck, sk: String.fromCharCode.apply(null, _skBuf) };
}

// ═══════════════════════════════════════════════
// DFS helpers
// ═══════════════════════════════════════════════

function dfsPush(stk, nodeId, edgeId) {
    const existingIdx = stk.findIndex(e => e.nodeId === nodeId);
    if (existingIdx <= 0 && safePushDims.has(nodeId)) {
        const prev = stk[stk.length - 1].state;
        const next = Object.assign({}, prev);
        next[nodeId] = edgeId;
        return [...stk, { nodeId, edgeId, state: next }];
    }
    return push(stk, nodeId, edgeId, { autoForce: false });
}

function pickNextNode(sel, ck) {
    let nextNode = null, bestP = -Infinity;
    for (const n of NODES) {
        if (n.derived) continue;
        if (sel[n.id]) continue;
        if (!(ck ? cachedIsNodeVisible(ck, sel, n) : isNodeVisible(sel, n))) continue;
        if (!n.edges || n.edges.length === 0) continue;
        if (n.edges.every(e => ck ? cachedIsEdgeDisabled(ck, sel, n, e) : isEdgeDisabled(sel, n, e))) continue;
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
    const saved = sel[superDim];
    for (const rep of reps) {
        sel[superDim] = rep;
        const tck = classKey(sel);
        const tn = pickNextNode(sel, tck);
        if (tn?.id !== baseNextId) { sel[superDim] = saved; return true; }
        if (tn && enabledEdgeIds(sel, nextNode, tck).join(',') !== baseEdges) { sel[superDim] = saved; return true; }
    }
    sel[superDim] = saved;
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
        sel[node.id] = rep;
        const tck = classKey(sel);
        if (stateFingerprint(sel, tck) !== baseFP) { delete sel[node.id]; return false; }
    }
    delete sel[node.id];
    return true;
}

function resolvedState(sel) {
    const state = Object.assign({}, sel);
    for (const n of derivedNodes) {
        const v = resolvedVal(sel, n.id);
        if (v !== undefined) state[n.id] = v;
    }
    return state;
}

// ═══════════════════════════════════════════════
// Main DFS runner
// ═══════════════════════════════════════════════

/**
 * Walk the full graph with superposition DFS.
 * @param {Object} opts
 * @param {Function} [opts.isTerminal] - (sel) => bool. If true, stop exploring this branch.
 * @param {Function} [opts.onVisit] - (sel, stk, { ck, nextNode, enabled }) => void.
 *        Called for every visited state (including terminals). `enabled` is the list of
 *        enabled edges for nextNode (empty array if nextNode is null).
 * @param {Function} [opts.onPush] - (sel, nodeId, edgeId) => void.
 *        Called each time a node/edge is pushed onto the stack during branching.
 * @param {Set} [opts.excludeDims] - Dims to treat as boundaries.
 * @param {boolean} [opts.quiet] - Suppress console output.
 * @returns {{ visited, terminals, deadEnds, elapsed }}
 */
function walk(opts = {}) {
    const isTerminal = opts.isTerminal || (() => false);
    const onVisit = opts.onVisit || null;
    const onPush = opts.onPush || null;
    const excludeDims = opts.excludeDims || new Set();
    const quiet = opts.quiet || false;

    const visited = new Set();
    let stateCount = 0, collapses = 0, superimposed = 0, earlyTerminations = 0;
    const terminals = [];
    const deadEnds = [];

    _activeRvMap = new Map();

    function doPush(stk, nodeId, edgeId) {
        if (onPush) onPush(currentState(stk), nodeId, edgeId);
        return dfsPush(stk, nodeId, edgeId);
    }

    function dfs(stk, superSet) {
        const sel = currentState(stk);
        _activeRvMap.clear();
        setRvCache(_activeRvMap);
        const { ck, sk: key } = classAndSuperKey(sel, superSet);
        if (visited.has(key)) { setRvCache(null); return; }
        visited.add(key);
        stateCount++;

        if (isTerminal(sel)) {
            earlyTerminations++;
            if (onVisit) onVisit(sel, stk, { ck, nextNode: null, enabled: [] });
            terminals.push({ sel: { ...sel }, key, type: 'terminal', superSet: new Set(superSet) });
            setRvCache(null);
            return;
        }

        const nextNode = pickNextNode(sel, ck);
        const enabled = nextNode ? nextNode.edges.filter(e => !cachedIsEdgeDisabled(ck, sel, nextNode, e)) : [];
        if (onVisit) onVisit(sel, stk, { ck, nextNode, enabled });
        setRvCache(null);

        if (!nextNode) {
            deadEnds.push({ sel: { ...sel }, key, superSet: new Set(superSet) });
            terminals.push({ sel: { ...sel }, key, type: 'dead_end', superSet: new Set(superSet) });
            return;
        }
        if (excludeDims.has(nextNode.id)) {
            terminals.push({ sel: { ...sel }, key, type: 'boundary', boundaryNode: nextNode.id, superSet: new Set(superSet) });
            return;
        }

        for (const superDim of superSet) {
            if (needsCollapse(sel, superDim, nextNode, ck)) {
                collapses++;
                const newSuper = new Set(superSet);
                newSuper.delete(superDim);
                for (const rep of classReps[superDim]) {
                    dfs(doPush(stk, superDim, rep), newSuper);
                }
                return;
            }
        }

        if (enabled.length === 0) {
            deadEnds.push({ sel: { ...sel }, key, superSet: new Set(superSet) });
            terminals.push({ sel: { ...sel }, key, type: 'dead_end', superSet: new Set(superSet) });
            return;
        }
        const seenClasses = new Set();
        const classEdges = [];
        for (const e of enabled) {
            const c = classes[nextNode.id]?.get(e.id);
            if (!seenClasses.has(c)) { seenClasses.add(c); classEdges.push(e); }
        }

        if (classEdges.length <= 1) {
            dfs(doPush(stk, nextNode.id, enabled[0].id), superSet);
            return;
        }

        if (canSuperimpose(sel, nextNode, ck)) {
            superimposed++;
            const newSuper = new Set(superSet);
            newSuper.add(nextNode.id);
            dfs(doPush(stk, nextNode.id, classEdges[0].id), newSuper);
            return;
        }

        for (const edge of classEdges) {
            dfs(doPush(stk, nextNode.id, edge.id), superSet);
        }
    }

    const t0 = Date.now();
    dfs(createStack(), new Set());
    const elapsed = Date.now() - t0;

    if (!quiet) {
        console.log(`Visited: ${stateCount}, Terminals: ${terminals.length}, Time: ${(elapsed/1000).toFixed(1)}s`);
        console.log(`  Early terminations: ${earlyTerminations}, Dead ends: ${deadEnds.length}`);
        console.log(`  Superimposed: ${superimposed}, Collapses: ${collapses}`);
    }

    return { visited: stateCount, terminals, deadEnds, elapsed };
}

/**
 * Compute reachability for multiple outcomes in a single walk.
 * Uses the same superposition DFS as walk() but propagates a bitmask of
 * which outcomes are reachable from each state. One bit per outcome (max 31).
 *
 * When expanding superimposed dims, ALL raw edge values are tried and
 * terminals are rechecked per variant (since template matching depends on
 * raw values that equivalence classes intentionally collapse).
 *
 * @param {Object} opts
 * @param {Function[]} opts.matchers - Array of (sel) => bool functions, one per outcome.
 * @param {Set<string>} [opts.noClassMergeDims] - Dimensions to explore all enabled edges (not class reps).
 * @param {Set<string>} [opts.outcomeDims] - Dimensions referenced by outcome templates (never wildcarded in memoization key).
 * @param {boolean} [opts.quiet]
 * @returns {{ reachMap: Map<string,number>, visited: number, elapsed: number }}
 */
function computeReachability(opts = {}) {
    const matchers = opts.matchers || [];
    const noMerge = opts.noClassMergeDims || new Set();
    const outcomeDims = opts.outcomeDims || new Set();
    const quiet = opts.quiet || false;
    if (matchers.length > 31) throw new Error('Max 31 outcomes (bitmask limit)');

    const visited = new Set();
    const skReach = new Map();
    const reachMap = new Map();
    let stateCount = 0;

    const _emptySet = new Set();
    _activeRvMap = new Map();

    function checkTerminals(sel) {
        let mask = 0;
        for (let i = 0; i < matchers.length; i++) {
            if (matchers[i](sel)) mask |= (1 << i);
        }
        return mask;
    }

    function irrKey(sel) {
        return classAndSuperKey(sel, _emptySet).sk;
    }

    function expandSuper(sel, superDims, childMask) {
        if (superDims.length === 0) {
            _rrRvMap.clear();
            const ik = irrKey(sel);
            const m = checkTerminals(sel) | childMask;
            reachMap.set(ik, (reachMap.get(ik) || 0) | m);
            return m;
        }
        const dim = superDims[0];
        const rest = superDims.slice(1);
        const saved = sel[dim];
        const node = NODE_MAP[dim];
        const values = node && node.edges ? node.edges.map(e => e.id) : (classReps[dim] || []);
        let combined = 0;
        for (const v of values) {
            sel[dim] = v;
            combined |= expandSuper(sel, rest, childMask);
        }
        sel[dim] = saved;
        return combined;
    }

    const _rrRvMap = new Map();

    function expandVariants(sel, dims, idx, childMask) {
        if (idx >= dims.length) {
            _rrRvMap.clear();
            const ik = irrKey(sel);
            reachMap.set(ik, (reachMap.get(ik) || 0) | checkTerminals(sel) | childMask);
            return;
        }
        const dim = dims[idx];
        const saved = sel[dim];
        const currentClass = classes[dim]?.get(saved);
        const node = NODE_MAP[dim];
        if (!node || !node.edges) {
            expandVariants(sel, dims, idx + 1, childMask);
            return;
        }
        for (const e of node.edges) {
            if (classes[dim]?.get(e.id) !== currentClass) continue;
            if (e.id !== saved && isEdgeDisabled(sel, node, e)) continue;
            sel[dim] = e.id;
            expandVariants(sel, dims, idx + 1, childMask);
        }
        sel[dim] = saved;
    }

    function recordReach(sel, superSet, childMask) {
        _rrRvMap.clear();
        setRvCache(_rrRvMap);
        const ik = irrKey(sel);
        let fullMask = checkTerminals(sel) | childMask;
        reachMap.set(ik, (reachMap.get(ik) || 0) | fullMask);
        if (superSet.size > 0) {
            const temp = Object.assign({}, sel);
            fullMask |= expandSuper(temp, [...superSet], childMask);
        }
        const varDims = [];
        for (const d of noMerge) {
            if (sel[d] !== undefined) varDims.push(d);
        }
        if (varDims.length > 0) {
            const temp = Object.assign({}, sel);
            expandVariants(temp, varDims, 0, childMask);
        }
        setRvCache(null);
        return fullMask;
    }

    function memoKey(ck, rawKey, sel) {
        if (outcomeDims.size === 0) return rawKey;
        const buf = new Uint8Array(dimOrder.length);
        for (let i = 0; i < dimOrder.length; i++) {
            const c = rawKey.charCodeAt(i);
            buf[i] = (c === 42 && sel[dimOrder[i]] && outcomeDims.has(dimOrder[i]))
                ? ck.charCodeAt(i) : c;
        }
        return String.fromCharCode.apply(null, buf);
    }

    function dfs(stk, superSet) {
        const sel = currentState(stk);
        _activeRvMap.clear();
        setRvCache(_activeRvMap);
        const { ck, sk: rawKey } = classAndSuperKey(sel, superSet);
        const key = memoKey(ck, rawKey, sel);

        const nextNode = pickNextNode(sel, ck);
        const enabled = nextNode ? nextNode.edges.filter(e => !cachedIsEdgeDisabled(ck, sel, nextNode, e)) : [];
        setRvCache(null);

        if (!nextNode || enabled.length === 0) {
            return recordReach(sel, superSet, 0);
        }

        if (visited.has(key)) {
            const cached = skReach.get(key);
            if (cached) recordReach(sel, superSet, cached.childMask);
            return cached ? cached.mask : 0;
        }
        visited.add(key);
        stateCount++;

        for (const superDim of superSet) {
            if (needsCollapse(sel, superDim, nextNode, ck)) {
                const newSuper = new Set(superSet);
                newSuper.delete(superDim);
                let childMask = 0;
                for (const rep of classReps[superDim]) {
                    childMask |= dfs(dfsPush(stk, superDim, rep), newSuper);
                }
                const mask = recordReach(sel, superSet, childMask);
                skReach.set(key, { mask, childMask: mask });
                return mask;
            }
        }

        const seenClasses = new Set();
        const classEdges = [];
        for (const e of enabled) {
            const c = classes[nextNode.id]?.get(e.id);
            if (!seenClasses.has(c)) { seenClasses.add(c); classEdges.push(e); }
        }

        let childMask = 0;
        if (classEdges.length <= 1) {
            const needsExpand = enabled.length > 1;
            const sub = needsExpand ? new Set([...superSet, nextNode.id]) : superSet;
            childMask = dfs(dfsPush(stk, nextNode.id, enabled[0].id), sub);
        } else if (canSuperimpose(sel, nextNode, ck)) {
            const newSuper = new Set(superSet);
            newSuper.add(nextNode.id);
            childMask = dfs(dfsPush(stk, nextNode.id, classEdges[0].id), newSuper);
        } else {
            for (const edge of classEdges) {
                childMask |= dfs(dfsPush(stk, nextNode.id, edge.id), superSet);
            }
        }

        const mask = recordReach(sel, superSet, childMask);
        skReach.set(key, { mask, childMask: mask });
        return mask;
    }

    const t0 = Date.now();
    dfs(createStack(), new Set());
    const elapsed = Date.now() - t0;

    if (!quiet) {
        console.log(`Reachability: ${stateCount} states, ${reachMap.size} irrKeys, ${(elapsed/1000).toFixed(1)}s`);
    }

    return { reachMap, visited: stateCount, elapsed };
}

function irrKeyPublic(sel) {
    setRvCache(new Map());
    const result = classAndSuperKey(sel, new Set()).sk;
    setRvCache(null);
    return result;
}

const _exports = {
    walk, computeReachability,
    classes, classReps, dimOrder, derivedDimSet, derivedNodes, safePushDims,
    classKey, classAndSuperKey, irrKey: irrKeyPublic,
    resolvedState,
    cachedIsNodeVisible, cachedIsEdgeDisabled, cachedIsIrrelevant,
    pickNextNode, enabledEdgeIds,
    stateCache, irrVectorCache,
    getCacheStats() { return { hits: cacheHits, misses: cacheMisses, classKeys: stateCache.size }; },
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = _exports;
}
if (typeof window !== 'undefined') {
    window.GraphWalker = _exports;
}

})();
