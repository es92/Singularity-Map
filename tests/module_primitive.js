#!/usr/bin/env node
// tests/module_primitive.js — Phase 3 runtime-primitive check.
//
// Exercises the toy 2-node module fixture end-to-end without any graph
// migration. Verifies:
//   1. `attachModuleReducer(mod)` installs collapseToFlavor blocks with
//      the expected (when, set, move) shape.
//   2. Engine push through the attached edge applies the reducer's writes
//      to sel and evicts all internal dims to flavor.
//   3. Matches the existing DECEL_OUTCOME_TABLE behavior for a sanity-
//      checked path (this is the "non-regression" aspect — the primitive
//      produces a sel shape consistent with today's decel collapse except
//      for the direct-write dims which Phase 4a will switch on).
//
// No actual runtime changes yet: decel is still driven by
// DECEL_OUTCOME_TABLE. Phase 4a flips the switch.

const assert = require('assert');
const { MODULES, MODULE_MAP, attachModuleReducer } = require('../graph.js');

// ────────────────────────────────────────────────────────────
// 1. Toy 2-node module: one progress, one action, 2-cell reducer.
// ────────────────────────────────────────────────────────────

const toyProgressNode = {
    id: 'toy_progress',
    label: 'Toy Progress',
    edges: [
        { id: 'low' },
        { id: 'high' },
    ],
};
const toyActionNode = {
    id: 'toy_action',
    label: 'Toy Action',
    edges: [
        { id: 'continue' },
        { id: 'commit' },   // terminating edge
    ],
};

const toyReducerTable = {
    commit: {
        low:  { alignment: 'failed' },
        high: { alignment: 'robust' },
    },
};

function buildToyExitPlan() {
    const plan = [];
    for (const [action, pm] of Object.entries(toyReducerTable)) {
        for (const [progress, cell] of Object.entries(pm)) {
            plan.push({
                nodeId: 'toy_action',
                edgeId: action,
                when: { toy_progress: [progress] },
                set: { ...cell },
            });
        }
    }
    return plan;
}

const toyModule = {
    id: 'toy',
    activateWhen: [{ toy_gate: ['on'] }],
    reads: ['toy_gate'],
    writes: ['alignment'],
    nodeIds: ['toy_progress', 'toy_action'],
    // reducerTable retained here (not on the real modules) only to
    // exercise the attachModuleReducer path that was originally designed
    // around it. The source of truth is still the exitPlan — the
    // reducerTable is just a fixture convenience for this test.
    reducerTable: toyReducerTable,
    get exitPlan() { return buildToyExitPlan(); },
};

// Inject toy nodes into a local copy of NODE_MAP for the attachment test
// (we don't pollute the real graph). attachModuleReducer consults
// NODE_MAP, so we temporarily monkeypatch it.
const graph = require('../graph.js');
graph.NODE_MAP.toy_progress = toyProgressNode;
graph.NODE_MAP.toy_action = toyActionNode;

attachModuleReducer(toyModule);

// ────────────────────────────────────────────────────────────
// Assertions on the attachment shape.
// ────────────────────────────────────────────────────────────

const commitEdge = toyActionNode.edges.find(e => e.id === 'commit');
assert(commitEdge.collapseToFlavor, 'collapseToFlavor should be attached to commit edge');
assert(Array.isArray(commitEdge.collapseToFlavor), 'should be an array');
assert.strictEqual(commitEdge.collapseToFlavor.length, 2, 'two cells (low, high)');

const lowBlock = commitEdge.collapseToFlavor.find(b => b.when.toy_progress[0] === 'low');
assert.deepStrictEqual(lowBlock.set, { alignment: 'failed' });
assert.deepStrictEqual(lowBlock.move.sort(), ['toy_action', 'toy_progress']);

const highBlock = commitEdge.collapseToFlavor.find(b => b.when.toy_progress[0] === 'high');
assert.deepStrictEqual(highBlock.set, { alignment: 'robust' });

// The non-terminating 'continue' edge must NOT have gotten anything attached.
const continueEdge = toyActionNode.edges.find(e => e.id === 'continue');
assert.strictEqual(continueEdge.collapseToFlavor, undefined,
    'non-terminating continue edge should have no reducer attachment');

console.log('toy module attachment: PASS');

// ────────────────────────────────────────────────────────────
// 2. Decel module primitive self-consistency check.
// ────────────────────────────────────────────────────────────
//
// Verify the generic engine.reduceFromExitPlan helper is internally
// consistent with decel's exitPlan. For each tuple, synthesize the
// exact local state that matches it and assert the helper returns
// that tuple's `set`. This is what the old bespoke `decelReduce`
// function used to guarantee — now it's an invariant of any exitPlan
// the engine can safely drive.

const decel = MODULE_MAP.decel;
assert(decel, 'decel module must exist');

const plan = decel.exitPlan;
assert(Array.isArray(plan) && plan.length > 0, 'decel exitPlan should be non-empty');
assert(plan.every(t => t.when && t.set), 'every tuple has when + set');

// Every exit-tuple write dim is declared in writes or internalMarkers
// (internalMarkers are set into sel mid-tick then evicted to flavor on
// module exit — they're module-internal routing, not external contract).
const declaredWrites = new Set(decel.writes);
const declaredInternal = new Set(decel.internalMarkers || []);
for (const t of plan) {
    for (const k of Object.keys(t.set)) {
        assert(declaredWrites.has(k) || declaredInternal.has(k),
            `exitPlan writes ${k} which isn't in declaredWrites or internalMarkers`);
    }
}

// reduceFromExitPlan(decel, local) should pick the matching tuple and
// return its set bundle. Synthesize local = { [nodeId]: edgeId } ∪
// when-dim values and compare to the tuple's set.
const engineLib = require('../engine.js');
for (const t of plan) {
    const local = { [t.nodeId]: t.edgeId };
    for (const [k, v] of Object.entries(t.when)) local[k] = Array.isArray(v) ? v[0] : v;
    const fnBundle = engineLib.reduceFromExitPlan(decel, local);
    assert.deepStrictEqual(fnBundle, t.set,
        `reduceFromExitPlan() vs exitPlan mismatch for ${JSON.stringify(t)}: got ${JSON.stringify(fnBundle)}`);
}
console.log(`decel exitPlan self-consistency via reduceFromExitPlan (${plan.length} tuples): PASS`);

// ────────────────────────────────────────────────────────────
// 3. Engine integration — walk a full decel path via the real
//    push pipeline and verify the module reducer writes.
//    Post-Phase-4a: the (accelerate, robust) cell writes
//    { alignment: 'robust', governance: 'race', decel_align_progress:
//    'robust' } directly to sel via the reducer-installed
//    collapseToFlavor block.
// ────────────────────────────────────────────────────────────

const engine = require('../engine.js');

let stk = engine.createStack();
const path = [
    ['capability', 'singularity'],
    ['agi_threshold', 'few_months'],
    ['asi_threshold', 'few_months'],
    ['takeoff', 'slow'],
    ['governance_window', 'partial'],
    ['open_source', 'six_months'],
    ['distribution', 'monopoly'],
    ['sovereignty', 'state'],
    ['gov_action', 'decelerate'],
    ['decel_2mo_progress', 'robust'],
    ['decel_2mo_action', 'accelerate'],
];
for (const [nid, eid] of path) stk = engine.push(stk, nid, eid);
const selEnd = engine.currentState(stk);
const flavorEnd = engine.currentFlavor(stk);

// Post-Phase-4a: decel_outcome no longer exists. The reducer writes the
// (accelerate, robust) bundle directly to sel for external dims
// (alignment, geo_spread, containment), and into flavor for internal
// markers (governance, decel_align_progress, rival_emerges).
assert.strictEqual(selEnd.decel_outcome, undefined, 'decel_outcome is removed in Phase 4a');
assert.strictEqual(selEnd.alignment, 'robust', 'reducer writes alignment=robust on (accelerate, robust)');
assert.strictEqual(flavorEnd.governance, 'race', 'reducer moves governance=race to flavor on (accelerate, robust)');
assert.strictEqual(selEnd.governance, undefined, 'governance no longer in sel');
assert.strictEqual(flavorEnd.decel_align_progress, 'robust', 'reducer moves decel_align_progress=robust to flavor');
assert.strictEqual(selEnd.decel_align_progress, undefined, 'decel_align_progress no longer in sel');
// Internal decel dims should have been moved to flavor by the
// module-reducer-installed collapseToFlavor.move.
assert.strictEqual(selEnd.decel_2mo_progress, undefined, 'decel_2mo_progress moved to flavor');
assert.strictEqual(flavorEnd.decel_2mo_progress, 'robust');
// alignment now resolves directly from sel (not via deriveWhen).
const resolvedAlign = engine.resolvedVal(selEnd, 'alignment');
assert.strictEqual(resolvedAlign, 'robust', 'resolved alignment=robust after reducer write');
console.log('engine decel module path integration: PASS');

// ────────────────────────────────────────────────────────────
// 4. Escape module — writes⊂nodeIds contract with early-exits.
//    Escape has no reducerTable; its reducer is an identity pass-through
//    for ai_goals. catch_outcome + collateral_impact are internal nodes
//    that move to flavor on exit (they're in nodeIds but not writes).
//    The module's exit tuples compute the consolidated post_catch marker
//    ({loose, contained, ruined}) — that single marker is the external
//    routing key, replacing the old (catch_outcome, collateral_impact)
//    compound reads.
//    Exit plan tuples:
//      * ai_goals.{benevolent, marginal} (early exits; pipeline skipped;
//        post_catch unset — outcome clauses keyed on post_catch don't
//        fire on these paths)
//      * catch_outcome.not_permanent → post_catch=loose (unconditional)
//      * catch_outcome.holds_permanently → post_catch=contained (only
//        when collateral_impact ≠ civilizational)
//      * collateral_survivors.{most, remnants, none} → post_catch=ruined
//        (civilizational tail; also writes war_survivors)
// ────────────────────────────────────────────────────────────

const escape = MODULE_MAP.escape;
assert(escape, 'escape module must exist');
assert.deepStrictEqual(escape.writes.slice().sort(), [
    'ai_goals', 'containment', 'escape_set', 'post_catch', 'ruin_type', 'war_survivors',
].sort(), 'escape.writes should be ai_goals + post_catch + war_survivors + containment + escape_set + ruin_type');

const escPlan = escape.exitPlan;
// Tuple breakdown (18 total):
//   2  ai_goals early-exit (benevolent, marginal)
//   2  catch_outcome (not_permanent, holds_permanently)
//   1  response_success.no  gated on concentration_type=ai_itself
//   1  discovery_timing.never gated on concentration_type=ai_itself
//   5  collateral_impact early-slot exits (2 minimal/severe on
//      response_success=yes; 3 minimal/severe/civilizational on
//      response_success=delayed,no)
//   7  collateral_survivors (3 edges × 2 tuples — terminal and early-slot,
//      both setting war_set + war_survivors — plus 1 ai_goals-eviction
//      tuple on collateral_survivors=none)
assert(Array.isArray(escPlan) && escPlan.length === 18,
    `escape exitPlan should have 18 tuples; got ${escPlan.length}`);
const planByNode = {};
for (const t of escPlan) {
    // Most tuples set escape_set=yes; the collateral_survivors=none
    // ai_goals-eviction tuple is purely a `move` (no `set`) — exempt it.
    const isCsAiGoalsMove = t.nodeId === 'collateral_survivors' && t.edgeId === 'none' && !t.set;
    if (!isCsAiGoalsMove) {
        assert(t.set && t.set.escape_set === 'yes', 'every escape exit (except cs.none ai_goals move) sets escape_set=yes');
    }
    (planByNode[t.nodeId] = planByNode[t.nodeId] || []).push({ edgeId: t.edgeId, set: t.set, when: t.when, move: t.move });
}
assert.deepStrictEqual(planByNode.ai_goals.map(x => x.edgeId).sort(),
    ['benevolent', 'marginal'], 'ai_goals early-exit edges');
// catch_outcome exits: not_permanent → loose; holds_permanently → contained.
const catchTuples = Object.fromEntries(planByNode.catch_outcome.map(x => [x.edgeId, x]));
assert.strictEqual(catchTuples.not_permanent.set.post_catch, 'loose',
    'catch_outcome.not_permanent → post_catch=loose');
assert.deepStrictEqual(catchTuples.not_permanent.when, {},
    'catch_outcome.not_permanent exit is unconditional');
assert.strictEqual(catchTuples.holds_permanently.set.post_catch, 'contained',
    'catch_outcome.holds_permanently → post_catch=contained');
assert.deepStrictEqual(catchTuples.holds_permanently.when,
    { collateral_impact: { not: ['civilizational'] } },
    'catch_outcome.holds_permanently exit gated on collateral_impact≠civilizational');
// collateral_survivors exits: 3 edges (most/remnants/none) × 2 tuples
// (terminal vs. early-slot) → each terminal+early tuple → post_catch=ruined,
// writes war_survivors=edgeId, and sets war_set=yes (mirrors WAR_MODULE
// completion). Plus a 7th tuple on cs.none that's purely a move:[ai_goals]
// to mirror cleanSelection's invalidation of pro-humanity ai_goals on
// extinction.
const csTuples = planByNode.collateral_survivors;
assert.strictEqual(csTuples.length, 7, '7 collateral_survivors tuples (3 edges × 2 + 1 ai_goals move)');
const csSetTuples = csTuples.filter(t => t.set);
const csMoveTuples = csTuples.filter(t => !t.set);
assert.strictEqual(csSetTuples.length, 6, '6 set-tuples (3 edges × 2)');
assert.strictEqual(csMoveTuples.length, 1, '1 move-only tuple (cs.none ai_goals eviction)');
assert.deepStrictEqual(csMoveTuples[0].move, ['ai_goals'],
    'cs.none move-tuple evicts ai_goals');
assert.strictEqual(csMoveTuples[0].edgeId, 'none',
    'move-only tuple is on cs.none');
for (const t of csSetTuples) {
    assert.strictEqual(t.set.post_catch, 'ruined',
        `collateral_survivors.${t.edgeId} → post_catch=ruined`);
    assert.strictEqual(t.set.war_survivors, t.edgeId,
        `collateral_survivors.${t.edgeId} writes war_survivors=${t.edgeId}`);
    assert.strictEqual(t.set.war_set, 'yes',
        `collateral_survivors.${t.edgeId} writes war_set=yes (mirrors WAR_MODULE completion)`);
}

// After attachModuleReducer ran at graph.js load, each exit edge should
// carry a collapseToFlavor block with move list covering the 5 pure
// pipeline flavor dims PLUS catch_outcome + collateral_impact (now
// evicted to flavor since they're nodeIds outside of writes).
const catchNode = graph.NODE_MAP.catch_outcome;
const expectedMove = [
    'catch_outcome', 'collateral_impact', 'collateral_survivors',
    'discovery_timing', 'escape_method', 'escape_timeline',
    'response_method', 'response_success',
].sort();
for (const e of catchNode.edges) {
    assert(e.collapseToFlavor, `catch_outcome.${e.id} should have collapseToFlavor installed`);
    const blocks = Array.isArray(e.collapseToFlavor) ? e.collapseToFlavor : [e.collapseToFlavor];
    const ourBlock = blocks.find(b => b.set && b.set.escape_set === 'yes');
    assert(ourBlock, `catch_outcome.${e.id}: module block with escape_set=yes`);
    assert.deepStrictEqual(ourBlock.move.slice().sort(), expectedMove,
        `catch_outcome.${e.id}: move list evicts internal + pipeline dims to flavor`);
}
const aiGoalsNode = graph.NODE_MAP.ai_goals;
for (const edgeId of ['benevolent', 'marginal']) {
    const e = aiGoalsNode.edges.find(x => x.id === edgeId);
    assert(e, `ai_goals.${edgeId} edge must exist`);
    const blocks = Array.isArray(e.collapseToFlavor) ? e.collapseToFlavor : (e.collapseToFlavor ? [e.collapseToFlavor] : []);
    const ourBlock = blocks.find(b => b.set && b.set.escape_set === 'yes');
    assert(ourBlock, `ai_goals.${edgeId}: module block with escape_set=yes should be installed`);
    assert.deepStrictEqual(ourBlock.move.slice().sort(), expectedMove,
        `ai_goals.${edgeId}: module-computed move list`);
}

// Retired: the bespoke `escape.reduce()` pass-through test. Its job
// was to verify that `escapeReduce(local)` projected local state down
// to the declared writes. Post-migration, runtime writes go through
// the collapseToFlavor blocks attached to each exit edge (validated
// above), and the generic engine.reduceFromExitPlan no longer does a
// writes-based pass-through — it just returns the matching exit
// tuple's `set`. The equivalent runtime guarantee (escape commits
// only declared writes to sel) is covered end-to-end by test #5
// below.

console.log('escape module contract (writes⊂nodeIds): PASS');

// ────────────────────────────────────────────────────────────
// 5. Escape engine integration — walk a full escape path and verify
//    internal-flavor dims moved, write dims stayed, catch_outcome
//    consumers (ruin_type) resolve correctly.
// ────────────────────────────────────────────────────────────

let escStk = engine.createStack();
const escapePath = [
    ['capability', 'singularity'],
    ['agi_threshold', 'few_months'],
    ['asi_threshold', 'few_months'],
    ['takeoff', 'slow'],
    ['governance_window', 'partial'],
    ['open_source', 'six_months'],
    ['distribution', 'monopoly'],
    ['sovereignty', 'state'],
    ['gov_action', 'decelerate'],
    ['decel_2mo_progress', 'unsolved'],
    ['decel_2mo_action', 'escapes'],      // decel writes alignment='failed', containment='escaped'
    ['ai_goals', 'paperclip'],
    ['escape_method', 'nanotech'],
    ['escape_timeline', 'days_weeks'],
    ['discovery_timing', 'early_execution'],
    ['response_method', 'physical_strikes'],
    ['response_success', 'yes'],
    ['collateral_impact', 'civilizational'],
    ['catch_outcome', 'holds_permanently'],
    // catch_outcome=holds_permanently with collateral_impact=civilizational
    // does NOT exit the module (exit tuple when-clause excludes
    // civilizational); the civilizational tail defers to
    // collateral_survivors. Picking a survivor value triggers the final
    // exit with post_catch=ruined and war_survivors=<edgeId>.
    ['collateral_survivors', 'most'],
];
for (const [nid, eid] of escapePath) escStk = engine.push(escStk, nid, eid);
const escSel = engine.currentState(escStk);
const escFlavor = engine.currentFlavor(escStk);

// Writes stay in sel (post-module-exit).
assert.strictEqual(escSel.post_catch, 'ruined',
    'post_catch=ruined on civilizational tail');
assert.strictEqual(escSel.war_survivors, 'most',
    'war_survivors=most written by collateral_survivors exit tuple');
assert.strictEqual(escSel.ai_goals, 'paperclip', 'ai_goals stays in sel');
assert.strictEqual(escSel.escape_set, 'yes', 'escape_set=yes on exit');
// catch_outcome + collateral_impact move to flavor (no longer in writes).
assert.strictEqual(escSel.catch_outcome, undefined,
    'catch_outcome evicted to flavor (nodeId outside writes)');
assert.strictEqual(escFlavor.catch_outcome, 'holds_permanently',
    'catch_outcome preserved in flavor for narrative');
assert.strictEqual(escSel.collateral_impact, undefined,
    'collateral_impact evicted to flavor');
assert.strictEqual(escFlavor.collateral_impact, 'civilizational',
    'collateral_impact preserved in flavor');
// Pure-internal pipeline dims moved to flavor.
assert.strictEqual(escSel.escape_method, undefined, 'escape_method moved out of sel');
assert.strictEqual(escFlavor.escape_method, 'nanotech', 'escape_method in flavor');
assert.strictEqual(escSel.escape_timeline, undefined, 'escape_timeline moved out of sel');
assert.strictEqual(escFlavor.escape_timeline, 'days_weeks', 'escape_timeline in flavor');
assert.strictEqual(escSel.discovery_timing, undefined, 'discovery_timing moved out of sel');
assert.strictEqual(escFlavor.discovery_timing, 'early_execution', 'discovery_timing in flavor');
assert.strictEqual(escSel.response_method, undefined, 'response_method moved out of sel');
assert.strictEqual(escFlavor.response_method, 'physical_strikes', 'response_method in flavor');
assert.strictEqual(escSel.response_success, undefined, 'response_success moved out of sel');
assert.strictEqual(escFlavor.response_success, 'yes', 'response_success in flavor');

// Downstream: ruin_type='self_inflicted' is now written explicitly by
// the collateral_survivors exit-plan tuples (replaces the prior
// ruin_type.deriveWhen rule keyed on post_catch='ruined').
assert.strictEqual(escSel.ruin_type, 'self_inflicted',
    `ruin_type='self_inflicted' must land in sel via collateral_survivors exit tuple; got ${escSel.ruin_type}`);

console.log('engine escape module path integration: PASS');

// ────────────────────────────────────────────────────────────
// 5. Invariant: every module's string completionMarker must be in
//    its `writes` list. Otherwise captureExitResult puts it in
//    setFlavor, and any sel-only outer DFS (validate.js Phase 2's
//    FlowPropagation pass, the precompute reach pipeline, etc.) will
//    see the module as perpetually pending and re-fire it. Emergence
//    uses a structured marker ({dim, values}) — skipped here.
// ────────────────────────────────────────────────────────────
for (const mod of MODULES) {
    const cm = mod.completionMarker;
    if (!cm || typeof cm !== 'string') continue;
    assert(
        (mod.writes || []).includes(cm),
        `${mod.id}.completionMarker='${cm}' must be listed in ${mod.id}.writes (else the sel-only DFS won't see the module as done)`
    );
}
console.log('module completionMarker ⊆ writes invariant: PASS');

console.log('\nAll Phase 3 runtime-primitive checks passed.');
