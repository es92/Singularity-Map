// graph-walker.js — Reusable equivalence-class graph traverser
// Extracts the core DFS infrastructure from debug-liveness.js into a module.

(function() {

const _graph = (typeof module !== 'undefined' && module.exports)
    ? require('./graph.js') : window.Graph;
const { NODES, NODE_MAP } = _graph;
const _MODULES = _graph.MODULES || [];

const _eng = (typeof module !== 'undefined' && module.exports)
    ? require('./engine.js') : window.Engine;
const { resolvedVal, setRvCache, isNodeVisible, isEdgeDisabled,
        cleanSelection, createStack, push, currentState, currentFlavor } = _eng;

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

// Pre-compute safePushDims: dims not referenced by any edge condition.
// Also exclude dims whose own edges carry collapseToFlavor — pushing them
// via the fast path would skip cleanSelection and miss the set/move/setFlavor
// directives (e.g. module completion markers like who_benefits_set).
const edgeConditionDeps = new Set();
const collapseSourceDims = new Set();
for (const node of NODES) {
    if (!node.edges) continue;
    for (const edge of node.edges) {
        if (edge.collapseToFlavor) collapseSourceDims.add(node.id);
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
const safePushDims = new Set(dimOrder.filter(d => !edgeConditionDeps.has(d) && !collapseSourceDims.has(d)));
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

// Cap the per-ck caches so long walks don't OOM. These caches are pure speed
// optimizations (isNodeVisible/isEdgeDisabled/etc. are pure functions of sel
// classes), so evicting on size is correctness-neutral. Chosen to comfortably
// hold the hot working set without exceeding a few hundred MB of heap.
const STATE_CACHE_MAX = 25000;
const IRR_VECTOR_CACHE_MAX = 25000;

// ═══════════════════════════════════════════════
// Template awareness for irrelevance + class refinement
// ═══════════════════════════════════════════════
// Templates are a third kind of dim-reader (alongside directReaders for
// navigators and derivedReaders for deriveWhen). Without them, two effects
// cause irrKey to collapse outcome-distinct states:
//   (1) isIrrelevant wildcards the dim in the super-key.
//   (2) computeClasses merges values with no navigator-reader into one class,
//       so even a preserved dim char can't distinguish e.g. red from blue.
// setTemplates fixes both: it indexes template-readers for (1), and refines
// `classes[dim]` using per-value template signatures for (2).

let _outcomeReadersByDim = {};
// Dims that are (a) read by some template's `reachable` clause AND (b) moved
// to flavor by some edge's `collapseToFlavor.move`. For these, a path's final
// sel alone doesn't determine template match — we must also observe the dim's
// flavor value. Populated by setTemplates(); empty unless a module actually
// exports a template-read dim via flavor.
let _templateFlavorDims = new Set();
// Nodes whose edges' collapseToFlavor directives would move a templateFlavorDim
// into flavor. Answering these nodes must go through the full push() +
// cleanSelection pipeline (not the safePush fast path) so the walker's flavor
// tracking stays in sync with the engine.
let _templateFlavorMoverNodes = new Set();
let _baseClasses = null;
let _baseClassReps = null;

function _captureBaseClasses() {
    if (_baseClasses) return;
    _baseClasses = {};
    for (const dim of Object.keys(classes)) _baseClasses[dim] = new Map(classes[dim]);
    _baseClassReps = {};
    for (const dim of Object.keys(classReps)) _baseClassReps[dim] = [...classReps[dim]];
}

function _restoreBaseClasses() {
    for (const dim of Object.keys(_baseClasses)) {
        const cm = classes[dim];
        cm.clear();
        for (const [k, v] of _baseClasses[dim]) cm.set(k, v);
    }
    for (const dim of Object.keys(_baseClassReps)) {
        classReps[dim].length = 0;
        for (const v of _baseClassReps[dim]) classReps[dim].push(v);
    }
}

function _templateValueSig(t, dim, v) {
    const parts = [];
    for (let i = 0; i < (t.reachable || []).length; i++) {
        const c = t.reachable[i];
        let pos = '-';
        if (c[dim]) pos = c[dim].includes(v) ? 'y' : 'n';
        let neg = '-';
        if (c._not && c._not[dim]) neg = c._not[dim].includes(v) ? 'y' : 'n';
        parts.push(`${i}:${pos}:${neg}`);
    }
    if (t.primaryDimension === dim && t.variants) {
        parts.push(`var:${Object.prototype.hasOwnProperty.call(t.variants, v) ? v : '-'}`);
    }
    return parts.join('|');
}

function setTemplates(templates) {
    _captureBaseClasses();
    _restoreBaseClasses();

    _outcomeReadersByDim = {};
    for (const t of (templates || [])) {
        const reads = new Set();
        for (const cond of (t.reachable || [])) {
            for (const k of Object.keys(cond)) {
                if (k === '_not' || k.startsWith('_')) continue;
                reads.add(k);
            }
            if (cond._not) for (const k of Object.keys(cond._not)) reads.add(k);
        }
        if (t.primaryDimension && t.variants && Object.keys(t.variants).length > 0) {
            reads.add(t.primaryDimension);
        }
        for (const d of reads) {
            (_outcomeReadersByDim[d] ||= []).push(t);
        }
    }

    for (const [dim, readers] of Object.entries(_outcomeReadersByDim)) {
        const cm = classes[dim];
        if (!cm) continue;
        const node = NODE_MAP[dim];
        if (!node || !node.edges) continue;

        const sigByValue = new Map();
        for (const e of node.edges) {
            const v = e.id;
            const parts = [String(cm.get(v) ?? 0)];
            for (const t of readers) parts.push(`${t.id}:${_templateValueSig(t, dim, v)}`);
            sigByValue.set(v, parts.join('||'));
        }

        const sigToId = new Map();
        let nextId = 0;
        for (const e of node.edges) {
            const sig = sigByValue.get(e.id);
            if (!sigToId.has(sig)) sigToId.set(sig, nextId++);
            cm.set(e.id, sigToId.get(sig));
        }

        const seen = new Set();
        classReps[dim].length = 0;
        for (const e of node.edges) {
            const c = cm.get(e.id);
            if (!seen.has(c)) { seen.add(c); classReps[dim].push(e.id); }
        }
    }

    // Compute templateFlavorDims: template-read dims that can be moved to
    // flavor by at least one edge. These need to be tracked in irrKey.
    _templateFlavorDims = new Set();
    _templateFlavorMoverNodes = new Set();
    for (const node of NODES) {
        if (!node.edges) continue;
        for (const edge of node.edges) {
            if (!edge.collapseToFlavor) continue;
            const blocks = Array.isArray(edge.collapseToFlavor) ? edge.collapseToFlavor : [edge.collapseToFlavor];
            for (const b of blocks) {
                if (b.move) {
                    for (const d of b.move) {
                        if (_outcomeReadersByDim[d]) {
                            _templateFlavorDims.add(d);
                            _templateFlavorMoverNodes.add(node.id);
                        }
                    }
                }
                if (b.setFlavor) {
                    for (const d of Object.keys(b.setFlavor)) {
                        if (_outcomeReadersByDim[d]) {
                            _templateFlavorDims.add(d);
                            _templateFlavorMoverNodes.add(node.id);
                        }
                    }
                }
            }
        }
    }

    irrVectorCache.clear();
    stateCache.clear();
    _lastCk = null;
    _lastSc = null;
}

let _lastCk = null, _lastSc = null;
function getCache(ck) {
    if (ck === _lastCk) return _lastSc;
    let sc = stateCache.get(ck);
    if (!sc) {
        if (stateCache.size >= STATE_CACHE_MAX) {
            stateCache.clear();
            _lastCk = null;
            _lastSc = null;
        }
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
let _irrDepth = 0;
const IRR_DEPTH_WARN = 80;

function cachedIsIrrelevant(ck, sel, dim) {
    const sc = getCache(ck);
    const cached = sc.irr.get(dim);
    if (cached !== undefined) { cacheHits++; return cached; }

    const guard = ck + '\0' + dim;
    if (_irrComputing.has(guard)) return true;
    _irrComputing.add(guard);
    _irrDepth++;
    if (_irrDepth === IRR_DEPTH_WARN) {
        console.warn(`[graph-walker] isIrrelevant depth reached ${IRR_DEPTH_WARN} (dim="${dim}")`);
    }

    cacheMisses++;
    const result = isIrrelevant(sel, dim, null, ck);
    sc.irr.set(dim, result);

    _irrDepth--;
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
    // Templates are also readers: if any template reading this dim could still
    // match, wildcarding the dim would collapse outcome-distinct states.
    if (result) {
        const templateReaders = _outcomeReadersByDim[dim];
        if (templateReaders && templateReaders.length > 0) {
            const state = resolvedState(sel);
            for (const t of templateReaders) {
                if (_eng.templatePartialMatch(t, state)) { result = false; break; }
            }
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

// Digest of flavor content. Two paths with the same sel but different
// flavor are NOT equivalent for dedup purposes:
//   - Templates may read flavor via resolvedStateWithFlavor.
//   - More importantly, flavor records "answered-and-moved" dims.
//     cleanSelection shrinks sel, which otherwise breaks the walker's
//     "sel only grows" invariant and causes post-collapse states to
//     collapse back onto their own ancestors' irrKeys (silent dedup).
// We include every flavor entry (key+value). This enlarges the key but
// keeps dedup correct under collapseToFlavor.
function _flavorDigest(sel, flavor) {
    if (!flavor) return '';
    const keys = Object.keys(flavor);
    if (keys.length === 0) return '';
    keys.sort();
    const parts = [];
    for (const d of keys) {
        // If sel also has this dim, sel wins (matches resolvedStateWithFlavor).
        // We still include the flavor entry so that different flavor
        // histories distinguish states.
        parts.push(d + '=' + flavor[d]);
    }
    return '|F:' + parts.join(';');
}

function classAndSuperKey(sel, superSet, flavor) {
    for (let i = 0; i < dimOrder.length; i++) {
        const dim = dimOrder[i];
        const v = derivedDimSet.has(dim) ? resolvedVal(sel, dim) : sel[dim];
        _ckBuf[i] = v === undefined ? 85 : 48 + (classes[dim]?.get(v) ?? 0);
    }
    const ck = String.fromCharCode.apply(null, _ckBuf);

    let irrVec = irrVectorCache.get(ck);
    if (!irrVec) {
        if (irrVectorCache.size >= IRR_VECTOR_CACHE_MAX) irrVectorCache.clear();
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
    const base = String.fromCharCode.apply(null, _skBuf);
    const suffix = _flavorDigest(sel, flavor);
    return { ck, sk: suffix ? base + suffix : base };
}

// ═══════════════════════════════════════════════
// Module-as-atomic-edge support (Phase 5)
// ═══════════════════════════════════════════════
// When DFS is poised to descend into a module's internals, short-circuit
// by enumerating the module's reducer cells directly. Each cell is an
// atomic transition: apply its writes to sel and recurse. This drops the
// 14 decel internal dims out of the walked state space entirely, shrinking
// reach maps and speeding validation.

// Set of dim ids that are internal to any module.
const MODULE_INTERNAL_DIMS = new Set();
for (const m of _MODULES) {
    for (const d of (m.nodeIds || [])) MODULE_INTERNAL_DIMS.add(d);
}

// Completion marker per module: a dim the reducer always writes. If the dim
// is set in sel, the module has already exited.
// For decel this is decel_align_progress (written by all 9 reducer cells).
function _moduleCompletionMarker(mod) {
    if (mod.completionMarker) return mod.completionMarker;
    const writes = mod.writes || [];
    for (const w of writes) {
        // Prefer a marker that's module-exclusive — heuristic: contains the
        // module id in the dim name. Falls back to last write otherwise.
        if (w.startsWith(mod.id + '_')) return w;
    }
    return writes[writes.length - 1];
}
// Marker may be a string dim or { dim, values } (see engine._isModuleDone).
function _isMarkerSatisfied(marker, sel) {
    if (!marker) return false;
    if (typeof marker === 'string') return sel[marker] !== undefined;
    const v = sel[marker.dim];
    return v !== undefined && marker.values.indexOf(v) !== -1;
}
const MODULE_COMPLETION_MARKER = {};
for (const m of _MODULES) MODULE_COMPLETION_MARKER[m.id] = _moduleCompletionMarker(m);

// Per-module atomic exit cells: one per reducer cell, with writes bundle.
function _buildModuleCells(mod) {
    const cells = [];
    if (mod.reducerTable) {
        for (const [action, progressMap] of Object.entries(mod.reducerTable)) {
            for (const [progress, cell] of Object.entries(progressMap)) {
                const writes = {};
                for (const k of Object.keys(cell)) {
                    if (k.startsWith('_')) continue;
                    writes[k] = cell[k];
                }
                cells.push({ id: action + '__' + progress, writes });
            }
        }
    }
    return cells;
}
const MODULE_CELLS = {};
for (const m of _MODULES) MODULE_CELLS[m.id] = _buildModuleCells(m);

function _moduleActivateWhenMatches(sel, mod) {
    const conds = mod.activateWhen;
    if (!conds || !conds.length) return true;
    for (const cond of conds) {
        let ok = true;
        for (const [k, v] of Object.entries(cond)) {
            if (k === 'reason' || k.startsWith('_')) continue;
            const cur = resolvedVal(sel, k);
            if (Array.isArray(v)) { if (!v.includes(cur)) { ok = false; break; } }
            else if (v === true) { if (!cur) { ok = false; break; } }
            else if (v === false) { if (cur) { ok = false; break; } }
            else if (v && v.not) { if (v.not.includes(cur)) { ok = false; break; } }
            else if (cur !== v) { ok = false; break; }
        }
        if (ok) return true;
    }
    return false;
}

// Find the active-but-not-yet-reduced module, if any.
// Only modules with a non-empty cell set are eligible for atomic-edge
// short-circuiting; modules without a reducerTable (e.g. escape, whose
// exit space doesn't compress cleanly) fall through to normal DFS and
// are walked internally like any other subgraph.
function _pendingModule(sel) {
    for (const m of _MODULES) {
        const cells = MODULE_CELLS[m.id];
        if (!cells || cells.length === 0) continue;
        const marker = MODULE_COMPLETION_MARKER[m.id];
        if (_isMarkerSatisfied(marker, sel)) continue;
        if (_moduleActivateWhenMatches(sel, m)) return m;
    }
    return null;
}

// Synthetic "module transition" push: apply all writes from a reducer cell
// as one atomic step. Sel-level only; flavor/moduleStack preserved.
function _modulePush(stk, mod, cell) {
    const prev = stk[stk.length - 1].state;
    const next = Object.assign({}, prev);
    for (const [k, v] of Object.entries(cell.writes)) next[k] = v;
    const syntheticNodeId = '__module__' + mod.id;
    return [...stk, {
        nodeId: syntheticNodeId,
        edgeId: cell.id,
        state: next,
        flavor: stk[stk.length - 1].flavor || {},
        moduleStack: stk[stk.length - 1].moduleStack || [],
    }];
}

// ═══════════════════════════════════════════════
// DFS helpers
// ═══════════════════════════════════════════════

function dfsPush(stk, nodeId, edgeId) {
    const existingIdx = stk.findIndex(e => e.nodeId === nodeId);
    // Safe fast path skips cleanSelection, which also means it skips
    // collapseToFlavor processing. If this node's edges can move any
    // template-read dim into flavor, the slow path is required so the
    // walker's flavor tracking stays consistent with irrKey's flavor
    // digest (and therefore with the engine's runtime state).
    if (existingIdx <= 0 && safePushDims.has(nodeId) && !_templateFlavorMoverNodes.has(nodeId)) {
        const prev = stk[stk.length - 1].state;
        const next = Object.assign({}, prev);
        next[nodeId] = edgeId;
        return [...stk, { nodeId, edgeId, state: next }];
    }
    return push(stk, nodeId, edgeId);
}

function pickNextNode(sel, ck, flavor) {
    let nextNode = null, bestP = -Infinity;
    for (const n of NODES) {
        if (n.derived) continue;
        if (sel[n.id]) continue;
        // Dim may have been moved to flavor by a prior collapseToFlavor.move —
        // it's effectively answered, just relocated. Without this skip, the
        // walker re-asks the same question forever (cleanSelection moves the
        // answer right back to flavor on each push, producing duplicate keys
        // that visited-dedup silently swallows).
        if (flavor && flavor[n.id] !== undefined) continue;
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
    // Templates are downstream readers too. If any template could still match
    // and reads this dim, its reachable bits may differ per value, so
    // superposition (which OR-aggregates across values) would leak outcomes
    // onto each value's irrKey. Refuse.
    if (_outcomeReadersByDim[node.id]) {
        const state = resolvedState(sel);
        for (const t of _outcomeReadersByDim[node.id]) {
            if (_eng.templatePartialMatch(t, state)) return false;
        }
    }
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
    const onDescent = opts.onDescent || null;
    const onFinish = opts.onFinish || null;
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

    function dfs(stk, superSet, parentKey) {
        const sel = currentState(stk);
        const flavor = currentFlavor(stk);
        _activeRvMap.clear();
        setRvCache(_activeRvMap);
        const { ck, sk: key } = classAndSuperKey(sel, superSet, flavor);
        if (onDescent && parentKey !== null) onDescent(parentKey, key);
        if (visited.has(key)) { setRvCache(null); return; }
        visited.add(key);
        stateCount++;

        try {
            if (isTerminal(sel, flavor)) {
                earlyTerminations++;
                if (onVisit) onVisit(sel, stk, { ck, key, superSet, nextNode: null, enabled: [] });
                terminals.push({ sel: { ...sel }, flavor: { ...flavor }, key, type: 'terminal', superSet: new Set(superSet) });
                setRvCache(null);
                return;
            }

            // Phase 5: module-as-atomic-edge. If a module is active but not
            // yet reduced, enumerate its reducer cells as virtual edges and
            // skip the internal node walk entirely.
            const pendingMod = _MODULES.length > 0 ? _pendingModule(sel) : null;
            if (pendingMod) {
                const cells = MODULE_CELLS[pendingMod.id] || [];
                if (onVisit) onVisit(sel, stk, { ck, key, superSet, nextNode: null, enabled: [], moduleId: pendingMod.id });
                setRvCache(null);
                for (const cell of cells) {
                    dfs(_modulePush(stk, pendingMod, cell), superSet, key);
                }
                return;
            }

            const nextNode = pickNextNode(sel, ck, flavor);
            const enabled = nextNode ? nextNode.edges.filter(e => !cachedIsEdgeDisabled(ck, sel, nextNode, e)) : [];
            if (onVisit) onVisit(sel, stk, { ck, key, superSet, nextNode, enabled });
            setRvCache(null);

            if (!nextNode) {
                deadEnds.push({ sel: { ...sel }, flavor: { ...flavor }, key, superSet: new Set(superSet) });
                terminals.push({ sel: { ...sel }, flavor: { ...flavor }, key, type: 'dead_end', superSet: new Set(superSet) });
                return;
            }
            if (excludeDims.has(nextNode.id)) {
                terminals.push({ sel: { ...sel }, flavor: { ...flavor }, key, type: 'boundary', boundaryNode: nextNode.id, superSet: new Set(superSet) });
                return;
            }

            for (const superDim of superSet) {
                if (needsCollapse(sel, superDim, nextNode, ck)) {
                    collapses++;
                    const newSuper = new Set(superSet);
                    newSuper.delete(superDim);
                    for (const rep of classReps[superDim]) {
                        dfs(doPush(stk, superDim, rep), newSuper, key);
                    }
                    return;
                }
            }

            if (enabled.length === 0) {
                deadEnds.push({ sel: { ...sel }, flavor: { ...flavor }, key, superSet: new Set(superSet) });
                terminals.push({ sel: { ...sel }, flavor: { ...flavor }, key, type: 'dead_end', superSet: new Set(superSet) });
                return;
            }
            const seenClasses = new Set();
            const classEdges = [];
            for (const e of enabled) {
                const c = classes[nextNode.id]?.get(e.id);
                if (!seenClasses.has(c)) { seenClasses.add(c); classEdges.push(e); }
            }

            if (classEdges.length <= 1) {
                dfs(doPush(stk, nextNode.id, enabled[0].id), superSet, key);
                return;
            }

            if (canSuperimpose(sel, nextNode, ck)) {
                superimposed++;
                const newSuper = new Set(superSet);
                newSuper.add(nextNode.id);
                dfs(doPush(stk, nextNode.id, classEdges[0].id), newSuper, key);
                return;
            }

            for (const edge of classEdges) {
                dfs(doPush(stk, nextNode.id, edge.id), superSet, key);
            }
        } finally {
            if (onFinish) onFinish(key);
        }
    }

    const t0 = Date.now();
    dfs(createStack(), new Set(), null);
    const elapsed = Date.now() - t0;

    if (!quiet) {
        console.log(`Visited: ${stateCount}, Terminals: ${terminals.length}, Time: ${(elapsed/1000).toFixed(1)}s`);
        console.log(`  Early terminations: ${earlyTerminations}, Dead ends: ${deadEnds.length}`);
        console.log(`  Superimposed: ${superimposed}, Collapses: ${collapses}`);
    }

    return { visited: stateCount, terminals, deadEnds, elapsed };
}

/**
 * Compute reachability for multiple outcomes by reusing walk()'s DFS exactly,
 * then doing a single backward sweep over the recorded edge graph to propagate
 * outcome bitmasks from terminals up to every visited state.
 *
 * Relies on setTemplates() having been called beforehand so that class
 * refinement keeps outcome-discriminating dimensions (including primary
 * variant dims) in distinct classes — irrKey alone is then sufficient; no
 * post-hoc expansion is needed.
 *
 * @param {Object} opts
 * @param {Function[]} opts.matchers - Array of (sel, flavor) => bool functions, one per outcome.
 *        flavor is passed so matchers can read module-exported flavor dims
 *        referenced by template `reachable` clauses. Legacy (sel)-only
 *        matchers still work — they just ignore the extra arg.
 * @param {boolean} [opts.quiet]
 * @returns {{ reachMap: Map<string,number>, visited: number, elapsed: number }}
 */
function computeReachability(opts = {}) {
    const matchers = opts.matchers || [];
    const quiet = opts.quiet || false;
    if (matchers.length > 31) throw new Error('Max 31 outcomes (bitmask limit)');

    const _emptySet = new Set();
    function irrKey(sel, flavor) {
        return classAndSuperKey(sel, _emptySet, flavor).sk;
    }

    // Forward pass: walk() with hooks to record edges, sel+flavor-per-key,
    // and post-order finish sequence. isTerminal mirrors validate.js
    // semantics: stop DFS as soon as any outcome matches.
    const children = new Map();     // parentKey -> Set<childKey>
    const selByKey = new Map();     // key -> { sel, flavor, superSet }
    const finishOrder = [];         // DFS post-order: children precede parents

    const isTerminal = (sel, flavor) => {
        for (let i = 0; i < matchers.length; i++) {
            if (matchers[i](sel, flavor)) return true;
        }
        return false;
    };

    const t0 = Date.now();
    const result = walk({
        isTerminal,
        onDescent(parentKey, childKey) {
            let set = children.get(parentKey);
            if (!set) { set = new Set(); children.set(parentKey, set); }
            set.add(childKey);
        },
        onVisit(sel, stk, ctx) {
            const ss = (ctx.superSet && ctx.superSet.size > 0) ? new Set(ctx.superSet) : null;
            const flavor = currentFlavor(stk);
            selByKey.set(ctx.key, { sel: { ...sel }, flavor: { ...flavor }, superSet: ss });
        },
        onFinish(key) {
            finishOrder.push(key);
        },
        quiet: true,
    });
    const fwElapsed = Date.now() - t0;
    if (!quiet) {
        console.log(`Forward (walk): ${result.visited} states, ${result.terminals.length} terminals, ${(fwElapsed/1000).toFixed(1)}s`);
    }

    // Compute the outcome bitmask for each terminal state.
    const terminalMask = new Map();
    for (const t of result.terminals) {
        if (t.type !== 'terminal') continue;
        let m = 0;
        for (let i = 0; i < matchers.length; i++) {
            if (matchers[i](t.sel, t.flavor)) m |= (1 << i);
        }
        if (m) terminalMask.set(t.key, m);
    }

    // Backward pass: DFS post-order guarantees children have been labeled
    // before their parents. One linear sweep labels every state.
    const t1 = Date.now();
    const masks = new Map();
    const reachMap = new Map();
    const _rvMap = new Map();

    for (let i = 0; i < finishOrder.length; i++) {
        const key = finishOrder[i];
        let m = terminalMask.get(key) || 0;
        const kids = children.get(key);
        if (kids) {
            for (const c of kids) m |= masks.get(c) || 0;
        }
        masks.set(key, m);

        const entry = selByKey.get(key);
        if (!entry) continue;
        const { sel, flavor, superSet } = entry;

        _rvMap.clear();
        setRvCache(_rvMap);

        // Without compression, one write per state. With compression, broadcast
        // the mask to each class rep of each compressed dim so the browser's
        // concrete-state irrKey lookup hits an entry for every value the walker
        // deemed equivalent here.
        let superDims = null;
        if (superSet) {
            superDims = [];
            for (const d of superSet) {
                const reps = classReps[d];
                if (reps && reps.length > 1) superDims.push({ dim: d, reps });
            }
        }

        if (!superDims || superDims.length === 0) {
            const ik = irrKey(sel, flavor);
            reachMap.set(ik, (reachMap.get(ik) || 0) | m);
        } else {
            const saved = {};
            for (const { dim } of superDims) saved[dim] = sel[dim];
            (function recurse(i) {
                if (i === superDims.length) {
                    _rvMap.clear();
                    const ik = irrKey(sel, flavor);
                    reachMap.set(ik, (reachMap.get(ik) || 0) | m);
                    return;
                }
                const { dim, reps } = superDims[i];
                for (const rep of reps) {
                    sel[dim] = rep;
                    recurse(i + 1);
                }
            })(0);
            for (const { dim } of superDims) sel[dim] = saved[dim];
        }

        setRvCache(null);
    }

    const bwElapsed = Date.now() - t1;
    const elapsed = fwElapsed + bwElapsed;

    if (!quiet) {
        console.log(`Backward: ${finishOrder.length} states, ${(bwElapsed/1000).toFixed(1)}s`);
        console.log(`Reachability: ${result.visited} states, ${reachMap.size} irrKeys, total ${(elapsed/1000).toFixed(1)}s`);
    }

    return { reachMap, visited: result.visited, elapsed };
}

// Phase 2: module-stack signature suffix. Empty stack → '' (no-op).
// Non-empty → '|M:mod1(writesHash),mod2(...)'. Currently unreachable because
// Phase 3 is what pushes frames; included here so consumers (reach cache,
// super-keys) can already accept a moduleStack argument without churn.
function moduleStackSig(moduleStack) {
    if (!moduleStack || !moduleStack.length) return '';
    const parts = [];
    for (const f of moduleStack) {
        const localKeys = Object.keys(f.local && f.local.sel ? f.local.sel : {}).sort();
        const localSig = localKeys.map(k => `${k}=${f.local.sel[k]}`).join(';');
        parts.push(`${f.moduleId}(${localSig})`);
    }
    return '|M:' + parts.join(',');
}

function irrKeyPublic(sel, flavorOrModuleStack, moduleStackArg) {
    // Backward-compat: historical signature was (sel, moduleStack). If the
    // second arg is an Array, treat it as moduleStack and assume no flavor.
    // New signature: (sel, flavor, moduleStack) — flavor is a plain object.
    let flavor, moduleStack;
    if (Array.isArray(flavorOrModuleStack)) {
        flavor = null;
        moduleStack = flavorOrModuleStack;
    } else {
        flavor = flavorOrModuleStack || null;
        moduleStack = moduleStackArg || null;
    }
    setRvCache(new Map());
    const result = classAndSuperKey(sel, new Set(), flavor).sk;
    setRvCache(null);
    return result + moduleStackSig(moduleStack);
}

const _exports = {
    walk, computeReachability,
    classes, classReps, dimOrder, derivedDimSet, derivedNodes, safePushDims,
    classKey, classAndSuperKey, irrKey: irrKeyPublic, moduleStackSig,
    resolvedState,
    setTemplates,
    getTemplateFlavorDims: () => new Set(_templateFlavorDims),
    getTemplateFlavorMoverNodes: () => new Set(_templateFlavorMoverNodes),
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
