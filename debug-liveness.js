const { NODES, NODE_MAP } = require('./graph.js');
const { resolvedVal, isNodeVisible, isEdgeDisabled, cleanSelection, createStack, push, currentState } = require('./engine.js');

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

const _visStack = new Set();
function canNodeBecomeVisible(sel, node) {
    if (isNodeVisible(sel, node)) return true;
    if (!node.activateWhen) return true;
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
                    if (kNode && !canNodeBecomeVisible(sel, kNode)) {
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
            if (!blocked) { return true; }
        }
        return false;
    } finally {
        _visStack.delete(node.id);
    }
}

// Could changing dim's value change derivedDim's resolved value?
function couldAffect(sel, dim, derivedDim) {
    const reps = classReps[dim] || [undefined];
    const results = new Set();
    // Test with dim undefined (if currently unanswered)
    if (sel[dim] === undefined) {
        results.add(resolvedVal(sel, derivedDim));
    }
    for (const v of reps) {
        const testSel = { ...sel, [dim]: v };
        results.add(resolvedVal(testSel, derivedDim));
    }
    return results.size > 1;
}

let dimsInKey;

function isIrrelevant(sel, dim, seen) {
    if (!seen) seen = new Set();
    if (seen.has(dim)) return true;
    seen.add(dim);

    for (const node of (directReaders[dim] || [])) {
        if (!sel[node.id] && canNodeBecomeVisible(sel, node)) return false;
    }

    for (const derivedDim of (derivedReaders[dim] || [])) {
        if (dimsInKey.has(derivedDim) && sel[dim] !== undefined) continue;

        if (!couldAffect(sel, dim, derivedDim)) continue;
        if (!isIrrelevant(sel, derivedDim, seen)) return false;
    }

    return true;
}

// ═══════════════════════════════════════════════
// Expanded search (boundary at ai_goals, decel_2mo_progress, benefit_distribution)
// ═══════════════════════════════════════════════

const boundaryNodes = new Set(['ai_goals','benefit_distribution','power_promise','proliferation_control']);
const miniDims = new Set(NODES.filter(n => n.edges && !boundaryNodes.has(n.id)).map(n => n.id));

const dimOrder = NODES.filter(n => n.edges).map(n => n.id);
dimsInKey = new Set(dimOrder);

function classKey(sel) {
    const p = [];
    for (const dim of dimOrder) {
        const v = resolvedVal(sel, dim);
        if (v === undefined) p.push('U');
        else p.push(String(classes[dim]?.get(v) ?? 0));
    }
    return p.join(',');
}

function runDfs(keyFn, label) {
    const visited = new Set();
    let stateCount = 0;
    const terminals = [];

    function dfs(stk) {
        const sel = currentState(stk);
        const key = keyFn(sel);
        if (visited.has(key)) return;
        visited.add(key);
        stateCount++;

        let nextNode = null, bestP = -Infinity;
        for (const n of NODES) {
            if (n.derived) continue; if (sel[n.id]) continue;
            if (!isNodeVisible(sel, n)) continue;
            if (!n.edges || n.edges.length === 0) continue;
            const p = n.priority || 0; if (p > bestP) { bestP = p; nextNode = n; }
        }
        if (!nextNode) { terminals.push({ sel: { ...sel }, key, type: 'leaf', boundaryNode: null }); return; }
        if (!miniDims.has(nextNode.id)) { terminals.push({ sel: { ...sel }, key, type: 'boundary', boundaryNode: nextNode.id }); return; }
        if (stateCount > 500000) { console.log('OVERFLOW at ' + stateCount); process.exit(1); }

        const enabled = nextNode.edges.filter(e => !isEdgeDisabled(sel, nextNode, e));
        if (enabled.length === 1) { dfs(push(stk, nextNode.id, enabled[0].id, { autoForce: false })); return; }
        for (const edge of enabled) dfs(push(stk, nextNode.id, edge.id, { autoForce: false }));
    }

    const t0 = Date.now();
    dfs(createStack());
    const elapsed = Date.now() - t0;
    console.log(`\n=== ${label} ===`);
    console.log(`Visited: ${stateCount}, Raw Terminals: ${terminals.length}, Time: ${(elapsed/1000).toFixed(1)}s`);
    return terminals;
}

function irrKey(sel) {
    const p = [];
    for (const dim of dimOrder) {
        const v = resolvedVal(sel, dim);
        if (isIrrelevant(sel, dim, null)) {
            const node = NODE_MAP[dim];
            if (v !== undefined || !node || node.derived || !isNodeVisible(sel, node)) {
                p.push('*'); continue;
            }
        }
        if (v === undefined) p.push('U');
        else p.push(String(classes[dim]?.get(v) ?? 0));
    }
    return p.join(',');
}

function fullIrrKey(sel) {
    const p = [];
    for (const dim of dimOrder) {
        if (isIrrelevant(sel, dim, null)) { p.push('*'); continue; }
        const v = resolvedVal(sel, dim);
        if (v === undefined) p.push('U');
        else p.push(String(classes[dim]?.get(v) ?? 0));
    }
    return p.join(',');
}

// Run irrKey only
const irrTerminals = runDfs(irrKey, 'irrKey DFS');

// Collapse with fullIrrKey
function collapseTerminals(terms) {
    const m = new Map();
    for (const t of terms) {
        const fk = fullIrrKey(t.sel);
        if (!m.has(fk)) m.set(fk, t);
    }
    return m;
}

const irrCollapsed = collapseTerminals(irrTerminals);
console.log(`irrKey collapsed (fullIrrKey dedup): ${irrCollapsed.size}`);

// Count terminal types
const typeCounts = {};
for (const t of irrTerminals) {
    const k = t.type + (t.boundaryNode ? ':'+t.boundaryNode : '');
    typeCounts[k] = (typeCounts[k] || 0) + 1;
}
console.log(`\nTerminal types:`);
for (const [k, c] of Object.entries(typeCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k}: ${c}`);
}

// Analyze decel dim relevance at benefit_distribution terminals
const bdTerms = irrTerminals.filter(t => t.boundaryNode === 'benefit_distribution');
const decelDims = ['decel_2mo_progress','decel_2mo_action','decel_4mo_progress'];
const decelAnalysis = {};
for (const dd of decelDims) {
    let answered = 0, answeredIrr = 0, answeredRel = 0, unanswered = 0;
    for (const t of bdTerms) {
        const v = resolvedVal(t.sel, dd);
        if (v !== undefined) {
            answered++;
            if (isIrrelevant(t.sel, dd, null)) answeredIrr++;
            else answeredRel++;
        } else {
            unanswered++;
        }
    }
    decelAnalysis[dd] = { answered, answeredIrr, answeredRel, unanswered };
}
console.log(`\n=== Decel dim relevance at benefit_distribution terminals (${bdTerms.length} total) ===`);
for (const [dd, a] of Object.entries(decelAnalysis)) {
    console.log(`  ${dd}: answered=${a.answered} (irr=${a.answeredIrr}, RELEVANT=${a.answeredRel}), unanswered=${a.unanswered}`);
}

// What reads decel dims? Show direct readers
console.log(`\nDirect readers of decel dims:`);
for (const dd of decelDims) {
    const readers = (directReaders[dd] || []).map(n => n.id);
    const derivedR = (derivedReaders[dd] || []);
    console.log(`  ${dd}: direct=[${readers.join(',')}] derived=[${derivedR.join(',')}]`);
}

// How many unique benefit_distribution terminals if we forcibly wildcard decel dims?
const bdKeysWithDecel = new Set();
const bdKeysWithoutDecel = new Set();
for (const t of bdTerms) {
    bdKeysWithDecel.add(fullIrrKey(t.sel));
    // Force-wildcard decel dims
    const parts = fullIrrKey(t.sel).split(',');
    for (const dd of decelDims) {
        const idx = dimOrder.indexOf(dd);
        if (idx >= 0) parts[idx] = '*';
    }
    bdKeysWithoutDecel.add(parts.join(','));
}
console.log(`\nbenefit_dist unique keys: ${bdKeysWithDecel.size}`);
console.log(`benefit_dist if force-wildcard decel dims: ${bdKeysWithoutDecel.size}`);
console.log(`Savings from wildcarding decel: ${bdKeysWithDecel.size - bdKeysWithoutDecel.size}`);

// Check: are decel dims collapsing at each boundary?
const allDecelDims = dimOrder.filter(d => d.startsWith('decel_') || d === 'gov_action');
const allDecelPlusOutcome = [...allDecelDims, 'decel_outcome', 'decel_align_progress'];
console.log(`\nDecel dims in key: ${allDecelDims.join(', ')}`);

for (const bnd of ['proliferation_control','power_promise','ai_goals','benefit_distribution']) {
    const bndTerms = irrTerminals.filter(t => t.boundaryNode === bnd);
    if (bndTerms.length === 0) continue;

    const rawKeys = new Set(bndTerms.map(t => fullIrrKey(t.sel)));
    
    // Force-wildcard all decel intermediate dims
    const collapsedKeys = new Set();
    for (const t of bndTerms) {
        const parts = fullIrrKey(t.sel).split(',');
        for (const dd of allDecelDims) {
            const idx = dimOrder.indexOf(dd);
            if (idx >= 0) parts[idx] = '*';
        }
        collapsedKeys.add(parts.join(','));
    }
    
    // Force-wildcard decel dims + outcome
    const collapsedAll = new Set();
    for (const t of bndTerms) {
        const parts = fullIrrKey(t.sel).split(',');
        for (const dd of allDecelPlusOutcome) {
            const idx = dimOrder.indexOf(dd);
            if (idx >= 0) parts[idx] = '*';
        }
        collapsedAll.add(parts.join(','));
    }

    // Check which decel dims are relevant
    const relevantDecel = {};
    for (const dd of allDecelPlusOutcome) {
        let rel = 0;
        for (const t of bndTerms) {
            if (resolvedVal(t.sel, dd) !== undefined && !isIrrelevant(t.sel, dd, null)) rel++;
        }
        if (rel > 0) relevantDecel[dd] = rel;
    }
    
    console.log(`\n  boundary:${bnd} (${bndTerms.length} terminals):`);
    console.log(`    unique fullIrrKeys: ${rawKeys.size}`);
    console.log(`    if force-wildcard decel intermediates: ${collapsedKeys.size}`);
    console.log(`    if force-wildcard decel + outcome: ${collapsedAll.size}`);
    if (Object.keys(relevantDecel).length > 0) {
        console.log(`    RELEVANT decel dims: ${Object.entries(relevantDecel).map(([k,v]) => `${k}=${v}`).join(', ')}`);
    } else {
        console.log(`    all decel dims irrelevant`);
    }
}

// DEBUG: why are decel dims NOT irrelevant at prolif_control terminals?
const prolifTerms = irrTerminals.filter(t => t.boundaryNode === 'proliferation_control');
const decelAnsweredProlif = prolifTerms.filter(t => t.sel['decel_2mo_progress'] !== undefined);
console.log(`\n=== DEBUG: decel irrelevance at proliferation_control ===`);
console.log(`prolif terminals with decel answered: ${decelAnsweredProlif.length} / ${prolifTerms.length}`);

// For ALL prolif terminals with decel answered, find which decel dims are NOT irrelevant
const allDecelCheck = ['decel_2mo_progress','decel_2mo_action','decel_4mo_progress','decel_4mo_action','decel_6mo_progress','decel_6mo_action'];
const decelRelevanceCounts = {};
for (const dd of allDecelCheck) decelRelevanceCounts[dd] = { answered: 0, irr: 0, rel: 0 };

for (const t of decelAnsweredProlif) {
    for (const dd of allDecelCheck) {
        if (t.sel[dd] === undefined) continue;
        decelRelevanceCounts[dd].answered++;
        if (isIrrelevant(t.sel, dd, null)) decelRelevanceCounts[dd].irr++;
        else decelRelevanceCounts[dd].rel++;
    }
}
console.log(`\nPer-dim relevance at prolif terminals (${decelAnsweredProlif.length} with decel):`);
for (const [dd, c] of Object.entries(decelRelevanceCounts)) {
    if (c.answered > 0) console.log(`  ${dd}: answered=${c.answered}, irr=${c.irr}, RELEVANT=${c.rel}`);
}

// Find a terminal where a decel dim IS relevant and trace it
const relTerminal = decelAnsweredProlif.find(t => {
    for (const dd of allDecelCheck) {
        if (t.sel[dd] !== undefined && !isIrrelevant(t.sel, dd, null)) return true;
    }
    return false;
});

if (relTerminal) {
    const s = relTerminal.sel;
    console.log(`\nSample terminal where decel IS relevant:`);
    const answered = Object.entries(s).filter(([k,v]) => v !== undefined);
    for (const [k,v] of answered) console.log(`  ${k} = ${v}`);

    for (const dd of allDecelCheck) {
        if (s[dd] === undefined) continue;
        const irr = isIrrelevant(s, dd, null);
        if (irr) { console.log(`\n  ${dd}: irrelevant (ok)`); continue; }
        console.log(`\n--- ${dd} = ${s[dd]}: NOT irrelevant ---`);
        for (const node of (directReaders[dd] || [])) {
            const ans = !!s[node.id];
            const canVis = canNodeBecomeVisible(s, node);
            console.log(`  directReader ${node.id}: answered=${ans}, canBecomeVisible=${canVis}`);
            if (!ans && canVis) {
                console.log(`    ^ BLOCKING: ${node.id} is unanswered + could become visible`);
                console.log(`    activateWhen: ${JSON.stringify(node.activateWhen)}`);
                // Check each condition
                if (node.activateWhen) for (let ci = 0; ci < node.activateWhen.length; ci++) {
                    const cond = node.activateWhen[ci];
                    let blocked = false;
                    for (const [k, v] of Object.entries(cond)) {
                        if (k === 'reason' || k.startsWith('_')) continue;
                        const cur = resolvedVal(s, k);
                        if (cur === undefined) continue;
                        let matches;
                        if (Array.isArray(v)) matches = v.includes(cur);
                        else if (v && v.not) matches = !v.not.includes(cur);
                        else if (v === true) matches = !!cur;
                        else if (v === false) matches = !cur;
                        else matches = cur === v;
                        if (!matches) {
                            const unsettled = isDerivedUnsettled(s, k);
                            console.log(`    cond[${ci}].${k}: cur=${cur}, need=${JSON.stringify(v)}, match=${matches}, unsettled=${unsettled}`);
                            if (!unsettled) { blocked = true; break; }
                            console.log(`    ^ unsettled, treating as could-match`);
                        }
                    }
                    console.log(`    cond[${ci}] blocked=${blocked}`);
                }
            }
        }
        for (const derivedDim of (derivedReaders[dd] || [])) {
            const affects = couldAffect(s, dd, derivedDim);
            const inKey = dimsInKey.has(derivedDim);
            const bakedIn = inKey && s[dd] !== undefined;
            console.log(`  derivedReader ${derivedDim}: affects=${affects}, bakedIn=${bakedIn}`);
        }
    }
} else {
    console.log(`\nAll answered decel dims are irrelevant — issue is with UNANSWERED decel dims`);
    const sample = decelAnsweredProlif[0];
    if (sample) {
        const s = sample.sel;
        const fk = fullIrrKey(s);
        const parts = fk.split(',');
        console.log(`\nSample terminal (exited at 2mo, decel_2mo_action=${s.decel_2mo_action}):`);
        
        // Check unanswered decel dims
        for (const dd of ['decel_4mo_progress','decel_4mo_action','decel_6mo_progress','decel_6mo_action']) {
            const idx = dimOrder.indexOf(dd);
            const irr = isIrrelevant(s, dd, null);
            console.log(`\n  ${dd} (pos ${idx}): val=${s[dd]||'unanswered'}, fullIrrKey=${parts[idx]}, irr=${irr}`);
            
            if (!irr) {
                // Trace WHY it's not irrelevant
                for (const node of (directReaders[dd] || [])) {
                    const ans = !!s[node.id];
                    const canVis = canNodeBecomeVisible(s, node);
                    console.log(`    directReader: ${node.id} — answered=${ans}, canBecomeVisible=${canVis}`);
                    if (!ans && canVis) {
                        console.log(`    ^ BLOCKING irrelevance!`);
                        // Show the activateWhen and why canNodeBecomeVisible thinks it could activate
                        if (node.activateWhen) for (let ci = 0; ci < node.activateWhen.length; ci++) {
                            const cond = node.activateWhen[ci];
                            let condBlocked = false;
                            const condParts = [];
                            for (const [k, v] of Object.entries(cond)) {
                                if (k === 'reason' || k.startsWith('_')) continue;
                                const cur = resolvedVal(s, k);
                                if (cur === undefined) {
                                    // This is the key: unanswered dim treated as "could match"
                                    // But can this dim's node ever become visible?
                                    const dimNode = NODE_MAP[k];
                                    const dimCanVis = dimNode ? canNodeBecomeVisible(s, dimNode) : 'no_node';
                                    condParts.push(`${k}=UNDEF(need ${JSON.stringify(v)}) nodeCanVis=${dimCanVis}`);
                                    continue;
                                }
                                let matches;
                                if (Array.isArray(v)) matches = v.includes(cur);
                                else if (v && v.not) matches = !v.not.includes(cur);
                                else matches = cur === v;
                                if (!matches) { condBlocked = true; }
                                condParts.push(`${k}=${cur}(need ${JSON.stringify(v)}) ${matches?'✓':'✗'}`);
                            }
                            console.log(`      cond[${ci}]: blocked=${condBlocked} — ${condParts.join(', ')}`);
                        }
                    }
                }
            }
        }
        
        // Also check decel_outcome
        for (const dd of ['decel_outcome','decel_align_progress']) {
            const idx = dimOrder.indexOf(dd);
            if (idx >= 0) {
                const irr = isIrrelevant(s, dd, null);
                console.log(`\n  ${dd} (pos ${idx}): fullIrrKey=${parts[idx]}, irr=${irr}`);
            }
        }
    }
}

// Deeper analysis: what's driving the benefit_distribution growth?
const decelOutIdx = dimOrder.indexOf('decel_outcome');
const decelAlignIdx = dimOrder.indexOf('decel_align_progress');
const decelOutValues = {};
for (const t of bdTerms) {
    const dout = resolvedVal(t.sel, 'decel_outcome');
    const dalign = resolvedVal(t.sel, 'decel_align_progress');
    const label = `decel_out=${dout||'U'}, decel_align=${dalign||'U'}`;
    if (!decelOutValues[label]) decelOutValues[label] = 0;
    decelOutValues[label]++;
}
console.log(`\nDecel outcome breakdown at benefit_distribution:`);
for (const [k, c] of Object.entries(decelOutValues).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k}: ${c}`);
}

// Are decel_outcome / decel_align_progress irrelevant at BD terminals?
let doutIrr = 0, doutRel = 0, dalignIrr = 0, dalignRel = 0;
for (const t of bdTerms) {
    const dout = resolvedVal(t.sel, 'decel_outcome');
    if (dout !== undefined) {
        if (isIrrelevant(t.sel, 'decel_outcome', null)) doutIrr++; else doutRel++;
    }
    const da = resolvedVal(t.sel, 'decel_align_progress');
    if (da !== undefined) {
        if (isIrrelevant(t.sel, 'decel_align_progress', null)) dalignIrr++; else dalignRel++;
    }
}
console.log(`\ndecel_outcome relevance: irr=${doutIrr}, RELEVANT=${doutRel}`);
console.log(`decel_align_progress relevance: irr=${dalignIrr}, RELEVANT=${dalignRel}`);

// Force-wildcard decel_outcome + decel_align_progress too
const bdKeysNoDecelOut = new Set();
for (const t of bdTerms) {
    const parts = fullIrrKey(t.sel).split(',');
    for (const dd of [...decelDims, 'decel_outcome', 'decel_align_progress']) {
        const idx = dimOrder.indexOf(dd);
        if (idx >= 0) parts[idx] = '*';
    }
    bdKeysNoDecelOut.add(parts.join(','));
}
console.log(`\nbenefit_dist if force-wildcard ALL decel dims + outcome: ${bdKeysNoDecelOut.size} (was ${bdKeysWithDecel.size})`);

// Sample 20 benefit_distribution terminals
const step = Math.max(1, Math.floor(bdTerms.length / 20));
const sample = [];
for (let i = 0; i < bdTerms.length && sample.length < 20; i += step) sample.push(bdTerms[i]);

console.log(`\n=== SAMPLE benefit_distribution terminals (${sample.length} of ${bdTerms.length}) ===\n`);

// Show only non-irrelevant, non-U dims for each terminal
for (let i = 0; i < sample.length; i++) {
    const s = sample[i].sel;
    const parts = [];
    const irrParts = [];
    for (const dim of dimOrder) {
        const v = resolvedVal(s, dim);
        const irr = isIrrelevant(s, dim, null);
        if (irr) {
            if (v !== undefined) irrParts.push(dim.replace(/_.*/g, m => m.slice(0,4)));
            continue;
        }
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
            .replace('sincerity','sinc').replace('alignment','align');
        parts.push(`${short}=${v}(c${cls})`);
    }
    console.log(`${String(i+1).padStart(2)}. ${parts.join(', ')}`);
    if (irrParts.length > 0) console.log(`    irr+answered: ${irrParts.join(', ')}`);
}
