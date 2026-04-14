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

function canNodeBecomeVisible(sel, node) {
    if (isNodeVisible(sel, node)) return true;
    if (!node.activateWhen) return true;
    for (const cond of node.activateWhen) {
        let blocked = false;
        for (const [k, v] of Object.entries(cond)) {
            if (k === 'reason' || k.startsWith('_')) continue;
            const current = resolvedVal(sel, k);
            if (current === undefined) continue;
            if (Array.isArray(v)) { if (!v.includes(current)) { blocked = true; break; } }
            else if (v && v.not) { if (v.not.includes(current)) { blocked = true; break; } }
            else if (v === true) { if (!current) { blocked = true; break; } }
            else if (v === false) { if (current) { blocked = true; break; } }
            else { if (current !== v) { blocked = true; break; } }
        }
        if (!blocked) return true;
    }
    return false;
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
        // If the derived dim is in the dedup key (has edges) and dim is already
        // answered, then dim's effect on derivedDim is permanently baked into
        // derivedDim's resolved value — the key already captures this information.
        if (dimsInKey.has(derivedDim) && sel[dim] !== undefined) continue;

        if (!couldAffect(sel, dim, derivedDim)) continue;
        if (!isIrrelevant(sel, derivedDim, seen)) return false;
    }

    return true;
}

// ═══════════════════════════════════════════════
// Mini-search: class-only (the working 29-terminal version)
// ═══════════════════════════════════════════════

const miniDims = new Set(['capability','stall_duration','stall_recovery',
    'plateau_benefit_distribution','plateau_knowledge_rate','plateau_physical_rate',
    'agi_threshold','asi_threshold','automation_recovery',
    'auto_benefit_distribution','auto_knowledge_rate','auto_physical_rate',
    'takeoff','governance_window','open_source']);

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

const visited = new Set();
let stateCount = 0;
const terminals = [];

function dfs(stk) {
    const sel = currentState(stk);
    const key = irrKey(sel);
    const answered = Object.keys(sel).filter(k => sel[k]);
    const keyParts = key.split(',');
    const showIdxs = ['capability','agi_threshold','asi_threshold','automation','takeoff','open_source']
        .map(d => dimOrder.indexOf(d));
    const shortKey = showIdxs.map(i => `${dimOrder[i].slice(0,4)}=${keyParts[i]}`).join(' ');
    if (visited.has(key)) {
        if (stateCount < 8) console.log(`  PRUNED(d=${answered.length}): ${shortKey}`);
        return;
    }
    if (stateCount < 20) console.log(`  NEW #${stateCount}(d=${answered.length}): ${shortKey}`);
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
    if (stateCount > 200000) { console.log('OVERFLOW'); process.exit(1); }

    const enabled = nextNode.edges.filter(e => !isEdgeDisabled(sel, nextNode, e));
    if (enabled.length === 1) { dfs(push(stk, nextNode.id, enabled[0].id, { autoForce: false })); return; }
    for (const edge of enabled) dfs(push(stk, nextNode.id, edge.id, { autoForce: false }));
}

dfs(createStack());

console.log(`\n=== Mini Search: class-only ===`);
console.log(`Visited: ${stateCount}, Terminals: ${terminals.length}`);

console.log(`\n=== TERMINAL TABLE (I = irrelevant) ===\n`);
const hdr = '#'.padEnd(4) + 'cap'.padEnd(12) + 'stall_dur'.padEnd(12) + 'stall_rec'.padEnd(14) +
    'agi'.padEnd(14) + 'asi'.padEnd(14) + 'auto_rec'.padEnd(14) + 'takeoff'.padEnd(14) +
    'open_src'.padEnd(14) + 'type';
console.log(hdr);
console.log('-'.repeat(hdr.length));
const sorted = [...terminals].sort((a, b) => a.key.localeCompare(b.key));
let num = 0;
for (const t of sorted) {
    num++;
    const s = t.sel;

    const getC = (dim, val) => val && classes[dim] ? classes[dim].get(val) : undefined;
    const cap = resolvedVal(s, 'capability');
    const capLabel = cap === 'singularity' ? 'sing' : (cap === 'stalls' ? 'stall' : (cap || 'U'));
    const sdLabel = s.stall_duration ? 'all' : undefined;
    const srLabel = s.stall_recovery ? (getC('stall_recovery', s.stall_recovery) === 0 ? 'mild' : 'sub+') : undefined;
    const agiLabel = s.agi_threshold ? (getC('agi_threshold', s.agi_threshold) === 0 ? 'yes' : 'never') : undefined;
    const asiR = resolvedVal(s, 'asi_threshold');
    const asiLabel = asiR ? (getC('asi_threshold', asiR) === 0 ? 'yes' : 'never') : undefined;
    const arecLabel = s.automation_recovery ? (getC('automation_recovery', s.automation_recovery) === 0 ? 'mild' : 'sub+') : undefined;
    const tkLabel = s.takeoff ? (getC('takeoff', s.takeoff) === 0 ? 'norm' : 'boom') : undefined;
    const osLabel = s.open_source || undefined;

    const fmtDim = (dim, label) => {
        const irr = isIrrelevant(s, dim, null);
        if (!label) return irr ? '(U,I)' : 'U';
        return irr ? `(${label},I)` : label;
    };

    console.log(
        String(num).padEnd(4) +
        fmtDim('capability', capLabel).padEnd(12) +
        fmtDim('stall_duration', sdLabel).padEnd(12) +
        fmtDim('stall_recovery', srLabel).padEnd(14) +
        fmtDim('agi_threshold', agiLabel).padEnd(14) +
        fmtDim('asi_threshold', asiLabel).padEnd(14) +
        fmtDim('automation_recovery', arecLabel).padEnd(14) +
        fmtDim('takeoff', tkLabel).padEnd(14) +
        fmtDim('open_source', osLabel).padEnd(14) +
        t.type + (t.boundaryNode ? ':' + t.boundaryNode : '')
    );
}

// ═══════════════════════════════════════════════
// Collapse: irrelevance-aware dedup
// ═══════════════════════════════════════════════

function irrKey(sel) {
    const p = [];
    for (const dim of dimOrder) {
        const v = resolvedVal(sel, dim);
        if (isIrrelevant(sel, dim, null)) {
            const node = NODE_MAP[dim];
            // Wildcard if: answered, or derived, or node not visible (will never be chosen)
            // Keep as U if: unanswered + visible (still in DFS expansion path)
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

const uniqueByIrr = new Map();
for (const t of sorted) {
    const ik = fullIrrKey(t.sel);
    if (!uniqueByIrr.has(ik)) uniqueByIrr.set(ik, t);
}

console.log(`\n=== COLLAPSED (irrelevance-aware): ${uniqueByIrr.size} unique terminals ===\n`);

const showDims = ['capability','stall_duration','stall_recovery','agi_threshold','asi_threshold',
    'automation','automation_recovery','takeoff','open_source'];
const colW = [4, 8, 10, 10, 8, 8, 8, 10, 8, 16];
const hdr2 = '#'.padEnd(colW[0]) + showDims.map((d, i) => d.replace(/_/g,'_').slice(0,colW[i+1]-1).padEnd(colW[i+1])).join('');
console.log(hdr2);
console.log('-'.repeat(hdr2.length));

let uNum = 0;
for (const [ik, t] of uniqueByIrr) {
    uNum++;
    const s = t.sel;
    const parts = [];
    for (const dim of showDims) {
        const v = resolvedVal(s, dim);
        const irr = isIrrelevant(s, dim, null);
        const cls = v && classes[dim] ? classes[dim].get(v) : undefined;
        let label;
        if (v === undefined) label = irr ? '*' : 'U';
        else if (irr) label = '*';
        else label = `c${cls}`;
        parts.push(label);
    }
    console.log(String(uNum).padEnd(colW[0]) + parts.map((p, i) => p.padEnd(colW[i+1])).join('') +
        t.type + (t.boundaryNode ? ':' + t.boundaryNode : ''));
}
