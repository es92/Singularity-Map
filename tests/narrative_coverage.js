#!/usr/bin/env node
'use strict';

/*
 * narrative_coverage.js — Static check that every reachable askable node
 * has its narrative content populated in data/narrative.json.
 *
 * Motivation
 * ──────────
 * The runtime renders questions by reading questionText / questionContext
 * (and per-edge answerLabel / answerDesc) merged onto the structural
 * graph from data/narrative.json (see loadData in index.html). When a
 * node lacks an entry in narrative.json — or has an entry that omits
 * a particular field — the runtime silently falls back to bare node
 * labels and empty strings. The user sees a question with no context
 * paragraph and answer cards with no descriptions.
 *
 * The original failure case was the plateau path's
 * early_knowledge_rate / early_physical_rate nodes (URL example:
 *
 *     /#/map?capability=stalls&stall_duration=days
 *           &stall_recovery=substantial
 *           &plateau_benefit_distribution=unequal
 *
 * lands the user on early_knowledge_rate, which had no entry in
 * narrative.json at all — the question rendered as "Knowledge Work"
 * with three unlabeled answer pills).
 *
 * What this test checks
 * ─────────────────────
 * Drives the same FlowPropagation.run() the rest of the static suite
 * uses to enumerate every reachable askable node. For node-kind FLOW_DAG
 * slots we check the slot's node directly; for module-kind slots we
 * iterate every internal nodeId so that subsequent internals (e.g.
 * early_physical_rate after early_knowledge_rate) are exercised even
 * though flowNext only ever surfaces the FIRST askable internal at
 * a time. For each unique reachable node we assert:
 *
 *   1. Engine.resolveQuestionText(sel, node) returns a non-empty string
 *      (i.e. narrative.json provides questionText, OR a contextWhen
 *      entry whose `when` matches sel provides a questionText override).
 *
 *   2. Engine.resolveContextWhen(sel, node) returns a non-empty string
 *      (same contract for questionContext).
 *
 *   3. Every edge that is enabled in at least one input sel has both
 *      `answerLabel` and `answerDesc` populated (loaded from
 *      narrative.values[edgeId] by index.html's loadData; edges with
 *      `narrativeVariants` whose `when` matches the current sel are
 *      also accepted). Per-edge fields are checked against every input
 *      sel — not just the first — so that an edge gated on one
 *      stall_duration value still gets verified by some sel that
 *      satisfies its gate.
 *
 * Forced-pick nodes (every edge but one disabled in a given state)
 * are still checked: the runtime renders them as a one-option
 * "Continue" card and the user benefits from the description even
 * when there's no choice to make.
 *
 * What this test deliberately does NOT check
 * ──────────────────────────────────────────
 *   * timelineEvent / personalVignette / shortAnswerLabel coverage —
 *     these are optional decorations and absence is graceful.
 *
 *   * Outcome template content — that is covered separately by the
 *     outcomes-side reachability tests.
 *
 *   * Flavor-state specific contextWhen overrides — propagation walks
 *     in sel-space (no flavor tracking) so we can only verify the
 *     base resolution. State-specific overrides are tested
 *     incidentally when their `when` clauses key on sel-resident dims.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

global.window = {
    location: { search: '', hash: '' },
    requestAnimationFrame: () => 0,
    addEventListener: () => {},
    Graph: require(path.join(ROOT, 'graph.js')),
    Engine: require(path.join(ROOT, 'engine.js')),
};
global.document = {
    addEventListener: () => {},
    readyState: 'complete',
    getElementById: () => null,
    querySelector: () => null,
};
new Function('window', fs.readFileSync(path.join(ROOT, 'graph-io.js'), 'utf8'))(global.window);
new Function('window', 'document', fs.readFileSync(path.join(ROOT, 'nodes.js'), 'utf8'))(global.window, global.document);
new Function('window', fs.readFileSync(path.join(ROOT, 'flow-propagation.js'), 'utf8'))(global.window);

const Engine = global.window.Engine;
const GraphIO = global.window.GraphIO;
const FlowPropagation = global.window.FlowPropagation;
const NODE_MAP = Engine.NODE_MAP;

const NARRATIVE = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/narrative.json'), 'utf8'));
const TEMPLATES = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/outcomes.json'), 'utf8')).templates;
GraphIO.registerOutcomes(TEMPLATES);

// Mirror index.html loadData: merge narrative.json onto graph nodes.
// This is the ONLY path that wires per-edge answerLabel / answerDesc /
// narrativeVariants onto the edge objects, so the test must run it
// before any resolution check.
for (const [nodeId, narr] of Object.entries(NARRATIVE)) {
    if (nodeId === '_stages') continue;
    const node = NODE_MAP[nodeId];
    if (!node) continue;
    if (narr.questionText) node.questionText = narr.questionText;
    if (narr.shortQuestionText) node.shortQuestionText = narr.shortQuestionText;
    if (narr.questionContext) node.questionContext = narr.questionContext;
    if (narr.shortQuestionContext) node.shortQuestionContext = narr.shortQuestionContext;
    if (narr.contextWhen) node.contextWhen = narr.contextWhen;
    if (narr.source) node.source = narr.source;
    if (narr.values) {
        for (const [edgeId, vn] of Object.entries(narr.values)) {
            const v = node.edges && node.edges.find(vv => vv.id === edgeId);
            if (v) Object.assign(v, vn);
        }
    }
}

// Mirror the runtime's edge variant resolution (index.html
// resolveNarrativeVariant). When an edge declares narrativeVariants,
// the first variant whose `when` matches the current sel wins and
// its answerLabel / answerDesc shadow the edge's base values.
function resolveNarrativeVariant(variants, sel) {
    if (!variants || !sel) return null;
    for (const v of variants) {
        if (!v || !v.when) continue;
        if (Engine.matchCondition(sel, v.when)) return v;
    }
    return null;
}

// ─── Drive propagation, observe every routed (sel → slot) pair ─────
const t0 = Date.now();
const prop = FlowPropagation.run();
const propMs = Date.now() - t0;

// failures keyed by `${nodeId}|${reasonTag}` so each distinct gap
// reports once, even if many sels reach the same node. Sample sel
// is stored for the report so a maintainer can reproduce.
const failures = new Map();
function recordFailure(nodeId, reason, detail, sampleSel) {
    const key = `${nodeId}|${reason}`;
    if (failures.has(key)) return;
    failures.set(key, { nodeId, reason, detail, sampleSel });
}

// Slot lookup so we can discriminate node-kind from module-kind.
const FLOW_DAG = global.window.Nodes.FLOW_DAG;
const slotByKey = new Map();
for (const s of FLOW_DAG.nodes) if (s && s.key) slotByKey.set(s.key, s);

// Per-(node, sels[]) check. Question-level fields (questionText /
// questionContext) are checked against the FIRST sel only — they
// resolve via contextWhen entries that key on sel-resident dims,
// and a node either has a base entry that always wins or has a
// contextWhen that covers every reachable state. Per-edge fields
// are checked against EVERY sel for which the edge is enabled, so
// that an edge gated on one stall_duration value (e.g. `gradual`
// is disabledWhen stall_duration=hours but enabled at days/weeks/
// months) still gets verified by some entry sel that satisfies its
// gate. Without the per-sel sweep an edge that's never enabled in
// the first input sel would slip past the audit.
function checkNodeRender(node, sels) {
    const sampleSel = sels[0];
    const qt = Engine.resolveQuestionText(sampleSel, node);
    if (!qt || !qt.trim()) {
        recordFailure(node.id, 'questionText',
            'no narrative.json entry provides questionText for this state',
            sampleSel);
    }
    const qc = Engine.resolveContextWhen(sampleSel, node);
    if (!qc || !qc.trim()) {
        recordFailure(node.id, 'questionContext',
            'no narrative.json entry provides questionContext for this state',
            sampleSel);
    }
    for (const edge of node.edges) {
        // Find any input sel where this edge is enabled. If none,
        // the edge is structurally unreachable from the inputs we
        // observed and we skip it (a separate concern; not a
        // narrative-coverage failure).
        const enabledSel = sels.find(s => !Engine.isEdgeDisabled(s, node, edge));
        if (!enabledSel) continue;
        const variant = edge.narrativeVariants
            ? resolveNarrativeVariant(edge.narrativeVariants, enabledSel)
            : null;
        const lbl = (variant && variant.answerLabel) || edge.answerLabel;
        const desc = (variant && variant.answerDesc) || edge.answerDesc;
        if (!lbl || !String(lbl).trim()) {
            recordFailure(node.id, `edge:${edge.id}:answerLabel`,
                `narrative.values["${edge.id}"].answerLabel is missing`,
                enabledSel);
        }
        if (!desc || !String(desc).trim()) {
            recordFailure(node.id, `edge:${edge.id}:answerDesc`,
                `narrative.values["${edge.id}"].answerDesc is missing`,
                enabledSel);
        }
    }
}

// For every sel routed into a slot, verify the rendered question.
//
// node-kind slots — flowNext returns slot.id; one render check.
//
// module-kind slots — flowNext only ever returns the FIRST askable
// internal (lowest priority via findNextInternalNode). Subsequent
// internals (e.g. early_physical_rate after early_knowledge_rate)
// are answered later in the module's walk, by which time the sel
// has been mutated by the prior internal's edge effects and is no
// longer the entry sel. To make sure every internal is exercised,
// iterate the module's nodeIds and run the same render check
// against the entry sel for each internal that's askable.
//
// Dedup by nodeId is intentional: gaps in narrative.json are
// node-level (an entire entry is missing) or edge-level (a values
// entry is missing). State-specific contextWhen gaps are out of
// scope for this initial check (see header comment).
const checkedNodeIds = new Set();

for (const [slotKey, sels] of prop.inputsBySlot) {
    if (!sels || !sels.length) continue;
    const slot = slotByKey.get(slotKey);
    if (!slot) continue;
    if (slot.kind === 'outcome' || slot.kind === 'deadend') continue;
    if (slotKey === 'emergence') continue;

    if (slot.kind === 'node') {
        const node = NODE_MAP[slot.id];
        if (!node || node.derived) continue;
        if (checkedNodeIds.has(node.id)) continue;
        checkedNodeIds.add(node.id);
        checkNodeRender(node, sels);
    } else if (slot.kind === 'module') {
        const mod = Engine.MODULE_MAP[slot.id];
        if (!mod || !mod.nodeIds) continue;
        for (const nid of mod.nodeIds) {
            const node = NODE_MAP[nid];
            if (!node || node.derived) continue;
            if (checkedNodeIds.has(node.id)) continue;
            // Restrict to the input sels for which this internal is
            // askable. An internal node may only become askable
            // after a sibling internal commits its answer, so the
            // raw entry sels don't always contain a valid sample.
            // Skip only if no entry sel ever satisfies the gate.
            const askableSels = sels.filter(s => Engine.isAskableInternal(s, node));
            if (!askableSels.length) continue;
            checkedNodeIds.add(node.id);
            checkNodeRender(node, askableSels);
        }
    }
}

// ─── Report ────────────────────────────────────────────────────────
const totalDur = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`narrative coverage audit (propagation: ${(propMs/1000).toFixed(1)}s, total: ${totalDur}s)`);
console.log(`  reachable askable nodes checked: ${checkedNodeIds.size}`);
console.log(`  narrative gaps detected:         ${failures.size}`);
console.log('');

if (failures.size === 0) {
    console.log('narrative coverage: PASS');
    process.exit(0);
}

// Group failures by nodeId for a tidy report.
const byNode = new Map();
for (const f of failures.values()) {
    let arr = byNode.get(f.nodeId);
    if (!arr) { arr = []; byNode.set(f.nodeId, arr); }
    arr.push(f);
}

console.error('narrative coverage: FAIL');
console.error('');
console.error(`The runtime resolves question text, question context, and`);
console.error(`per-edge answer label/description from data/narrative.json`);
console.error(`(merged onto graph nodes by index.html's loadData). Nodes`);
console.error(`listed below are reachable in normal play but lack one or`);
console.error(`more of these fields — the user sees an empty paragraph,`);
console.error(`unlabeled answer pills, or both.`);
console.error('');

const abbrev = (sel) => {
    const keys = Object.keys(sel).sort();
    if (keys.length <= 6) {
        return JSON.stringify(sel);
    }
    return JSON.stringify(Object.fromEntries(keys.slice(0, 6).map(k => [k, sel[k]])))
        + ` (+${keys.length - 6} more)`;
};

for (const [nodeId, fs_] of byNode) {
    console.error(`  ${nodeId}`);
    for (const f of fs_) {
        console.error(`    - ${f.reason}: ${f.detail}`);
    }
    console.error(`    sample sel: ${abbrev(fs_[0].sampleSel)}`);
    console.error('');
}

process.exit(1);
