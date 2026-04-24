#!/usr/bin/env node
// tests/chain_order.js — dynamic path-ordering audit for the new modular graph.
//
// Runs a sel-only DFS (same structure as validate2.js Phase 2) but
// instrumented to record the ordered sequence of (module-exit |
// flat-node-answer) steps for every terminal path, plus which outcome
// template matched at that terminal.
//
// Then audits each distinct path against the expected CHAIN spec and
// reports:
//   1. The set of distinct observed orderings with their outcomes
//   2. Order violations (path steps out of spec order)
//   3. Outcome-placement violations (outcome emitted at wrong position)
//
// CHAIN spec (per user):
//   emergence                                  [required]
//     --> the-plateau, the-automaton (early exit ok)
//   control                                    [required]
//   alignment                                  [required]
//   decel?                                     [optional]
//   escape?  (EARLY window — ≤1 in this band)  [optional]
//     --> the-ruin, the-escape, the-chaos (ends chain)
//   proliferation                              [required]
//     (alt slot for the one EARLY escape, before or after proliferation)
//   intent_loop                                [required]
//   war_loop?                                  [optional]
//     --> the-ruin (ends chain)
//   who_benefits                               [required]
//   inert_stays?                               [optional]
//   brittle_resolution?                        [optional]
//   escape?  (LATE window — ≤1 in this band)   [optional]
//     --> the-ruin, the-escape, the-chaos (ends chain)
//   rollout                                    [required]
//     --> gilded-singularity, new-hierarchy, flourishing, capture,
//         standoff, mosaic, failure, escape (benevolent), alien-ai

const path = require('path');
const fs = require('fs');
const { NODES, NODE_MAP, MODULES, MODULE_MAP } = require('../graph.js');
const {
    matchCondition, resolvedState, isEdgeDisabled, cleanSelection, templateMatches,
} = require('../engine.js');
const {
    isModuleActivelyPending, pickActiveModule, pickNextAction,
    getModuleTable, resetCache: resetModuleCache,
} = require('../module-tables.js');

// ────────────────────────────────────────────────────────
// Expected chain spec
// ────────────────────────────────────────────────────────
// Each slot is: { id, optional, earlyExits }
//   id          — step identifier ('module:xxx' or 'node:xxx')
//   optional    — whether this slot can be skipped
//   earlyExits  — outcome IDs that may emit AFTER this slot is consumed
//                 (the path ends here; no later slot is taken). undefined
//                 means no outcome can emit here.
//
// `escape` appears at 2 independent windows (EARLY + LATE). Each window
// allows ≤1 escape occurrence; we encode the windows as alternative
// positions but cap total escape-count at 2.

const CHAIN = [
    { id: 'module:emergence',          optional: false, earlyExits: ['the-plateau', 'the-automation'] },
    // If emergence exits into a plateau or automation branch, a
    // benefit-distribution flat node fires followed by a stand-alone
    // rollout call that emits the-plateau / the-automation. These two
    // flat slots and the early rollout slot are the optional
    // plateau/automation sub-chain off of emergence.
    { id: 'node:plateau_benefit_distribution', optional: true },
    { id: 'node:auto_benefit_distribution',    optional: true },
    { id: 'module:rollout#early',      optional: true, matches: 'module:rollout',
      earlyExits: ['the-plateau', 'the-automation'] },
    { id: 'module:control',            optional: false },
    { id: 'module:alignment_loop',     optional: false },
    { id: 'module:decel',              optional: true },
    { id: 'module:escape#early',       optional: true, matches: 'module:escape',
      earlyExits: ['the-ruin', 'the-escape', 'the-chaos', 'the-alien-ai'] },
    { id: 'module:proliferation',      optional: false },
    // Alternative EARLY escape slot (between proliferation and intent_loop)
    // — treated as the same band; only one of the two EARLY slots may fire.
    { id: 'module:escape#early-alt',   optional: true, matches: 'module:escape',
      earlyExits: ['the-ruin', 'the-escape', 'the-chaos', 'the-alien-ai'] },
    { id: 'module:intent_loop',        optional: false },
    { id: 'module:war_loop',           optional: true, earlyExits: ['the-ruin'] },
    { id: 'module:who_benefits',       optional: false },
    { id: 'node:inert_stays',          optional: true },
    { id: 'node:brittle_resolution',   optional: true },
    { id: 'module:escape#late',        optional: true, matches: 'module:escape',
      earlyExits: ['the-ruin', 'the-escape', 'the-chaos', 'the-alien-ai'] },
    { id: 'module:rollout',            optional: false, earlyExits: [
        'the-gilded-singularity', 'the-new-hierarchy', 'the-flourishing',
        'the-capture', 'the-standoff', 'the-mosaic', 'the-failure',
        'the-escape', 'the-alien-ai',
    ] },
];

// Normalize: `matches` is what the step's literal ID looks like when it
// appears in a path (multiple CHAIN slots may map to the same literal).
function stepMatchId(slot) {
    return slot.matches || slot.id;
}

// Constraint: of the three escape slots in CHAIN, the EARLY ones (slots
// escape#early and escape#early-alt) together permit ≤1 escape. The LATE
// slot permits ≤1 escape. So total escape count ≤ 2, with at most 1 in
// each band. Enforced during match.
const EARLY_ESCAPE_SLOTS = new Set(['module:escape#early', 'module:escape#early-alt']);
const LATE_ESCAPE_SLOTS = new Set(['module:escape#late']);

// ────────────────────────────────────────────────────────
// Instrumented DFS — copies validate2 Phase 2, adds path tracking.
// ────────────────────────────────────────────────────────

const _MODULE_NODES = new Set();
for (const m of MODULES) for (const n of (m.nodeIds || [])) _MODULE_NODES.add(n);

function isAskableFlatNode(sel, node) {
    if (node.derived) return null;
    if (node.module) return null;
    if (_MODULE_NODES.has(node.id)) return null;
    if (sel[node.id] !== undefined) return null;
    if (!node.edges || node.edges.length === 0) return null;
    if (node.activateWhen && !node.activateWhen.some(c => matchCondition(sel, c))) return null;
    if (node.hideWhen && node.hideWhen.some(c => matchCondition(sel, c))) return null;
    const enabled = node.edges.filter(e => !isEdgeDisabled(sel, node, e));
    return enabled;
}

function stateKey(sel) {
    return Object.keys(sel).filter(k => sel[k] != null).sort().map(k => k + '=' + sel[k]).join('|');
}

function applyExit(sel, exit) {
    const nextSel = { ...sel };
    for (const k of Object.keys(exit.setSel)) nextSel[k] = exit.setSel[k];
    return nextSel;
}

// Memoized enumeration of distinct suffix-path shapes from a given sel.
// Each entry: { steps: string[], outcomes: Set<string>, dead: boolean, sampleSel }
// Dedup is on `steps.join('>')` to keep the result set small.
function runInstrumentedDfs(templates) {
    resetModuleCache();
    const memo = new Map();           // stateKey(sel) -> Array<suffixEntry>
    const stack = new Set();          // cycle detection

    function enumerate(sel) {
        const key = stateKey(sel);
        if (memo.has(key)) return memo.get(key);
        if (stack.has(key)) {
            // Cycle (shouldn't happen in a DAG, but be defensive).
            return [{ steps: ['CYCLE'], outcomes: new Set(), dead: true, sampleSel: { ...sel } }];
        }
        stack.add(key);

        const rs = resolvedState(sel);
        const matched = templates.filter(t => templateMatches(t, rs));
        if (matched.length > 0) {
            const out = new Set(matched.map(m => m.id));
            const result = [{ steps: [], outcomes: out, dead: false, sampleSel: { ...sel } }];
            memo.set(key, result);
            stack.delete(key);
            return result;
        }

        const merged = new Map(); // stepsSig -> suffixEntry (merged outcomes)
        const mergeIn = (steps, outcomes, dead, sampleSel) => {
            const sig = steps.join('>');
            let e = merged.get(sig);
            if (!e) {
                e = { steps, outcomes: new Set(), dead, sampleSel };
                merged.set(sig, e);
            }
            for (const o of outcomes) e.outcomes.add(o);
            e.dead = e.dead && dead;
        };

        const action = pickNextAction(sel);
        if (!action) {
            const result = [{ steps: [], outcomes: new Set(), dead: true, sampleSel: { ...sel } }];
            memo.set(key, result);
            stack.delete(key);
            return result;
        }

        if (action.kind === 'module') {
            const mod = action.mod;
            const { exits } = getModuleTable(mod, sel);
            if (exits.length === 0) {
                mergeIn([`module:${mod.id}:STUCK`], new Set(), true, sel);
            } else {
                const seenSetSel = new Set();
                for (const exit of exits) {
                    const sig = Object.keys(exit.setSel).sort().map(k => k + '=' + exit.setSel[k]).join('|');
                    if (seenSetSel.has(sig)) continue;
                    seenSetSel.add(sig);
                    const nextSel = applyExit(sel, exit);
                    const subs = enumerate(nextSel);
                    for (const s of subs) {
                        mergeIn([`module:${mod.id}`, ...s.steps], s.outcomes, s.dead, s.sampleSel);
                    }
                }
            }
        } else {
            const picked = action.node;
            const pickedEnabled = picked.edges.filter(e => !isEdgeDisabled(sel, picked, e));
            if (pickedEnabled.length === 0) {
                const result = [{ steps: [], outcomes: new Set(), dead: true, sampleSel: { ...sel } }];
                memo.set(key, result);
                stack.delete(key);
                return result;
            }
            for (const edge of pickedEnabled) {
                const nextSel = { ...sel, [picked.id]: edge.id };
                const r = cleanSelection(nextSel, {});
                if (r.sel[picked.id] === undefined && r.flavor[picked.id] !== edge.id) continue;
                const subs = enumerate(r.sel);
                for (const s of subs) {
                    mergeIn([`node:${picked.id}`, ...s.steps], s.outcomes, s.dead, s.sampleSel);
                }
            }
        }

        const result = Array.from(merged.values());
        memo.set(key, result);
        stack.delete(key);
        return result;
    }

    const { sel: startSel } = cleanSelection({}, {});
    const all = enumerate(startSel);

    const paths = new Map();
    const deadPaths = new Map();
    for (const s of all) {
        const sig = s.steps.join(' -> ');
        if (s.dead || s.outcomes.size === 0) {
            if (!deadPaths.has(sig)) deadPaths.set(sig, { example: s.steps.slice(), exampleSel: s.sampleSel });
        } else {
            if (!paths.has(sig)) paths.set(sig, { example: s.steps.slice(), exampleSel: s.sampleSel, outcomes: new Map() });
            const entry = paths.get(sig);
            for (const o of s.outcomes) entry.outcomes.set(o, (entry.outcomes.get(o) || 0) + 1);
        }
    }

    return { paths, deadPaths, visited: memo.size, truncated: false };
}

// ────────────────────────────────────────────────────────
// Match a path against CHAIN
// ────────────────────────────────────────────────────────

// Returns { ok, reason, finalSlot } for a given path and outcomeId.
// Algorithm: greedy left-to-right. For each path step, find the lowest-
// index CHAIN slot that matches (on stepMatchId) AND is ≥ current
// position. Advance. If none found, ordering violation.
// Optional slots can be skipped freely. At the end, the outcomeId must
// be permitted at the "final slot" position (the slot we consumed for
// the final path step), OR, for rollout, at the rollout slot (outcome
// emits upon module completion).
function matchPathAgainstChain(path, outcomeId) {
    let pos = -1;  // index in CHAIN of last-consumed slot
    let earlyEscapeUsed = false;
    let lateEscapeUsed = false;

    for (let i = 0; i < path.length; i++) {
        const step = path[i];
        // Find next slot (index > pos) whose stepMatchId matches step.
        let found = -1;
        for (let j = pos + 1; j < CHAIN.length; j++) {
            const slot = CHAIN[j];
            if (stepMatchId(slot) !== step) continue;
            // Before a non-optional slot, we're not allowed to jump past
            // it — enforce by scanning intermediate slots: if any is
            // non-optional, we must have already visited it (pos ≥ its
            // index), else violation. Since we're scanning pos+1..j, any
            // non-optional in between is a problem.
            let skipViolation = false;
            for (let k = pos + 1; k < j; k++) {
                if (!CHAIN[k].optional) { skipViolation = true; break; }
            }
            if (skipViolation) continue;
            // Escape-window cap
            if (step === 'module:escape') {
                const inEarly = EARLY_ESCAPE_SLOTS.has(CHAIN[j].id);
                const inLate = LATE_ESCAPE_SLOTS.has(CHAIN[j].id);
                if (inEarly && earlyEscapeUsed) continue;
                if (inLate && lateEscapeUsed) continue;
            }
            found = j;
            break;
        }
        if (found === -1) {
            return { ok: false, reason: `step '${step}' (index ${i}) has no valid CHAIN slot after pos ${pos}`, consumedSlots: null };
        }
        pos = found;
        if (step === 'module:escape') {
            if (EARLY_ESCAPE_SLOTS.has(CHAIN[pos].id)) earlyEscapeUsed = true;
            else if (LATE_ESCAPE_SLOTS.has(CHAIN[pos].id)) lateEscapeUsed = true;
        }
    }

    // Verify any non-optional slot AFTER the final consumed pos is
    // allowed to be skipped only if the path ended at a slot that emits
    // the matched outcome as an earlyExit.
    const finalSlot = pos >= 0 ? CHAIN[pos] : null;
    const finalAllowed = !finalSlot
        ? true
        : !!(finalSlot.earlyExits && outcomeId && finalSlot.earlyExits.includes(outcomeId));

    // If there are remaining required slots, we must have emitted at an
    // earlyExits-permitted outcome.
    let hasRequiredAfter = false;
    for (let k = pos + 1; k < CHAIN.length; k++) {
        if (!CHAIN[k].optional) { hasRequiredAfter = true; break; }
    }

    if (outcomeId == null) {
        // Dead-end (no outcome). Reported as a violation irrespective of
        // chain order.
        return { ok: false, reason: 'no outcome matched', consumedSlots: null };
    }

    if (hasRequiredAfter && !finalAllowed) {
        return {
            ok: false,
            reason: `outcome '${outcomeId}' emitted after '${finalSlot ? finalSlot.id : '(start)'}' but ` +
                    `chain has required slots remaining (next: ${CHAIN[pos+1].id})`,
            consumedSlots: null,
        };
    }

    if (!finalAllowed && finalSlot) {
        return {
            ok: false,
            reason: `outcome '${outcomeId}' emitted at slot '${finalSlot.id}' but that slot's ` +
                    `earlyExits=${JSON.stringify(finalSlot.earlyExits || [])}`,
            consumedSlots: null,
        };
    }

    return { ok: true, finalSlot: finalSlot ? finalSlot.id : null };
}

// ────────────────────────────────────────────────────────
// Report
// ────────────────────────────────────────────────────────

function selToUrl(sel) {
    const params = Object.entries(sel).filter(([, v]) => v != null).map(([k, v]) => `${k}=${v}`).join('&');
    return `http://localhost:3000/#/explore${params ? '?' + params : ''}`;
}

function main() {
    const outcomes = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data/outcomes.json'), 'utf8'));
    const templates = outcomes.templates;

    console.log('Chain-order audit');
    console.log('═'.repeat(60));
    console.log(`${MODULES.length} modules, ${templates.length} outcome templates`);
    console.log();

    const t0 = Date.now();
    const { paths, deadPaths, visited, truncated } = runInstrumentedDfs(templates);
    const elapsed = Date.now() - t0;
    console.log(`DFS: ${visited} states, ${paths.size} distinct paths, ${deadPaths.size} distinct dead-end paths (${(elapsed/1000).toFixed(1)}s)${truncated ? ' — TRUNCATED' : ''}`);
    console.log();

    // Audit every distinct path+outcome against CHAIN.
    const violations = [];
    const byShape = new Map();  // pathSig → { outcomes, check results }

    for (const [sig, entry] of paths) {
        const pathSteps = entry.example;
        const outcomeCounts = entry.outcomes;
        for (const [outcomeId] of outcomeCounts) {
            const res = matchPathAgainstChain(pathSteps, outcomeId);
            if (!res.ok) {
                violations.push({ sig, outcomeId, reason: res.reason, example: entry.exampleSel });
            }
        }
        byShape.set(sig, { pathSteps, outcomes: Array.from(outcomeCounts.entries()).map(([o, c]) => `${o}×${c}`), total: entry.count, example: entry.exampleSel });
    }

    // Report distinct orderings
    console.log(`Distinct orderings (${byShape.size}):`);
    console.log('─'.repeat(60));
    const sortedShapes = Array.from(byShape.values()).sort((a, b) => a.pathSteps.length - b.pathSteps.length || a.pathSteps.join('').localeCompare(b.pathSteps.join('')));
    for (const s of sortedShapes) {
        console.log(`  ${s.pathSteps.length ? s.pathSteps.join(' -> ') : '(empty)'}`);
        console.log(`    outcomes: ${s.outcomes.join(', ')}`);
    }
    console.log();

    // Group violations by reason class
    console.log(`Violations (${violations.length}):`);
    console.log('─'.repeat(60));
    if (violations.length === 0) {
        console.log('  OK — every terminal path is consistent with the spec');
    } else {
        // Group by (path shape, reason class) to avoid listing the same shape
        // once per outcome.
        const byShapeReason = new Map();
        for (const v of violations) {
            const key = v.sig + '\n' + v.reason;
            if (!byShapeReason.has(key)) byShapeReason.set(key, { ...v, outcomes: new Set() });
            byShapeReason.get(key).outcomes.add(v.outcomeId);
        }
        let i = 0;
        for (const v of byShapeReason.values()) {
            i++;
            console.log(`\n  [${i}] ${v.reason}`);
            console.log(`    path: ${v.sig || '(empty)'}`);
            console.log(`    outcomes: ${Array.from(v.outcomes).join(', ')}`);
            console.log(`    url: ${selToUrl(v.example)}`);
        }
    }
    console.log();

    if (deadPaths.size > 0) {
        console.log(`Dead-end path shapes (${deadPaths.size}):`);
        console.log('─'.repeat(60));
        const sortedDead = Array.from(deadPaths.entries()).sort((a, b) => a[0].length - b[0].length);
        for (const [sig, entry] of sortedDead.slice(0, 10)) {
            console.log(`  ${sig || '(empty)'}`);
            console.log(`    sel: ${selToUrl(entry.exampleSel)}`);
        }
        if (sortedDead.length > 10) console.log(`  ... and ${sortedDead.length - 10} more`);
    }

    process.exit(violations.length ? 1 : 0);
}

if (require.main === module) main();

module.exports = { runInstrumentedDfs, matchPathAgainstChain, CHAIN };
