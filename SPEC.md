# Singularity Map — Project Spec

## Overview

Singularity Map is an interactive, choose-your-own-adventure experience that guides users through a branching questionnaire about the future of AI. Based on the choices they make, users arrive at one of many possible "AI futures" — each rendered as a short narrative story paired with a visual timeline of key events.

---

## Core Concepts

### Dimensions

The questionnaire collects a set of **dimensions** — the key variables that define an AI future. Each node in the graph represents a dimension, and choosing an edge sets its value.

Not every path sets every dimension — nodes activate conditionally, so only the dimensions relevant to a given branch appear.

### Outcome Templates

The system uses **parameterized templates** (defined in `data/outcomes.json`). Each template defines:

- **ID** — unique identifier (e.g. `"the-flourishing"`)
- **Primary Dimension** *(optional)* — the dimension that selects the variant
- **Variants** — a map from dimension values to variant-specific title, mood, and summary
- **Flavors** *(optional)* — dimension-keyed additional context paragraphs that customize the outcome based on other dimensions
- **Reachable** — DNF conditions (array of conjunctive clauses) defining when this outcome is reachable from the current state

Templates without variants (e.g. `the-mosaic`) are standalone outcomes with direct title/mood/summary fields.

---

## Graph Engine Model

The decision graph is defined declaratively in `graph.js` and interpreted by the state machine in `engine.js`.

### State

The state (`sel`) is a flat object mapping dimension IDs to their chosen values: `{ capability: 'singularity', takeoff: 'moderate', ... }`.

**The state fully determines the future.** Given the same `sel`, all derived values, visibility, locking, edge disabling, and template matching produce identical results. There is no hidden state or order-dependence.

### Nodes and Edges

Each node in `graph.js` represents a question (dimension). Each node has:

- **`edges`** — possible answers, each with an `id` (the value set in `sel`)
- **`activateWhen`** *(optional)* — conditions that must be met for this question to appear
- **`hideWhen`** *(optional)* — conditions that hide this node even if `activateWhen` passes (replaces the old global `hideConditions` + per-node flags)
- **`derived: true`** — marks the node as purely derived (never presented as a question, invisible to the priority system). The dim's value lands in `sel`/`flavor` from upstream edges' `collapseToFlavor.set` / `setFlavor` writes (or from a module exit plan), not from a per-node derivation rule.
- **`priority`** *(optional, default 0)* — controls question ordering; nodes with higher priority are deferred until all lower-priority visible questions are answered (replaces the old `terminal` flag; `priority: 2` = terminal)
Edges can have:
- **`requires`** — conditions that must be met for this edge to be available
- **`disabledWhen`** — conditions under which this edge is disabled
- **`collapseToFlavor`** — state-shrinking rules applied when this edge is selected (see below)

### State Split: `sel` vs `flavor`

The decision state is split into two parallel bags:

- **`sel`** — the behavioral state vector. Everything that affects engine branching (activation, derivation, edge enabling/disabling, template matching) reads from `sel`. Two states with identical `sel` are behaviorally identical.
- **`flavor`** — the narrative state vector. Holds dimensions (or specific values of dimensions) that are only read by narrative renderers. Never consulted for branching decisions.

`narrativeState(stack) = { ...flavor, ...sel }` (sel wins on conflict) is the merged view narrative text resolution uses. The main UI passes `narrativeState` everywhere a human-readable answer might need to be shown (including `primaryDimension` lookups, `contextWhen`, and outcome `flavors._when`/`_default` resolution).

**Why split them?** Two reasons:
1. **Convergence.** If five `agi_threshold` answers (`twenty_four_hours` … `ten_plus_years`) all lead to the same downstream decisions, moving the specific value to `flavor` lets them collapse to a single `sel` — crucial for `/explore`'s DAG convergence and for keeping the reachability / precompute tables small.
2. **Narrative fidelity.** The specific value is still available to narrative text even when engine-level state has been deduplicated ("you chose 'week-long tasks'" can still show up in the story).

### `collapseToFlavor`

Applied by `cleanSelection` for each set node, in `NODES` (topological) order. Supports three actions, any combination:

| Key | Effect |
|---|---|
| `set: { k: v, … }` | Write/overwrite `sel[k] = v`. Typically used to set a "marker" dim (e.g. `asi_happens: 'yes'`) so the collapsed state is distinguishable from pre-answer state (matters for `selKey`-based convergence). |
| `move: ['dim1', 'dim2']` | For each listed dim, if `sel[dim]` is set, move it to `flavor[dim]` and delete from `sel`. The specific chosen value is preserved in `flavor` for narrative lookups. |
| `setFlavor: { k: v, … }` | Write `flavor[k] = v` directly (without going through `sel`). Useful when a narrative-only derived field needs to be recorded. |

"Marker" dims (like `asi_happens`, `emergence_set`, `takeoff_class`, `rollout_set`) are written into `sel` via `collapseToFlavor.set` but aren't declared as graph nodes. The engine auto-registers them in its value-index tables at init so they can be used in `activateWhen`, `requires`, etc., just like declared dims.

### When is it safe to move a dim to flavor?

A dim can be moved to `flavor` (via `collapseToFlavor.move`) **only if no downstream rule reads its specific value from `sel`**. Specifically, check all of the following across the rest of the graph:

- `activateWhen`
- `hideWhen`
- `requires`
- `disabledWhen`
- `collapseToFlavor.when`

If only **`primaryDimension` (outcome variants)**, **narrative `contextWhen`**, or **outcome `flavors._when` / `_default`** lookups reference it, it's fair game — those all resolve through `narrativeState`, which sees flavor.

If engine branching still needs *one bit* of information from the dim (e.g. "did AGI happen at all?" vs. specific timing), introduce a marker dim via `collapseToFlavor.set` that captures that bit, update the downstream rules to gate on the marker, and move the original dim to flavor. See `agi_threshold` → `agi_happens` for a worked example.

### How a Path Progresses

1. The engine presents the next question by calling `FlowPropagation.flowNext(sel)` — the same primitive `validate.js` and `/explore` use. `flowNext` picks the slot with the lowest `_slotPickPriority` among every slot whose activate gate / completion marker accepts the current `sel`, breaking ties on `FLOW_DAG.nodes` order (first wins). The same criterion drives `FlowPropagation.run`'s sibling routing, so runtime and static analysis agree on a single signal. For module slots, the next render node is the lowest-priority askable internal. Outcome matching is suppressed whenever a slot still owns the sel; only `flowNext` returning `kind: 'open'` allows templates to fire
2. The user picks an edge → `push()` sets `sel[nodeId] = edgeId`
3. `cleanSelection()` runs in a single pass: for each node with a set edge (in `NODES` topological order), it applies that edge's `collapseToFlavor` blocks (`set` / `setFlavor` / `move`) whose `when` matches the current `sel`. No invalidation sweep, no fixpoint loop — every cascade effect that older versions of the engine derived multi-pass is now expressed as an explicit, gated `collapseToFlavor` block on the originating edge (one-shot gates like `proliferation_set: false` keep blocks idempotent across re-pushes). This makes runtime push behavior identical to the static `_applyEdgeWrites` projection used by `validate.js` and `precompute-reachability` — the two paths cannot drift apart.

   Note: when a node becomes **locked** (only one edge remains enabled), `cleanSelection` does *not* write that value into `sel` automatically. Instead, the UI detects locks via `Engine.isNodeLocked` and presents the node as a single-option "Continue" screen; the user commits it through the normal push flow like any other answer. Downstream code that needs the effective value (template matching, visibility in the resolved state) consults `resolvedState`/`isNodeLocked` directly.
4. Derived dimensions are recomputed from the new state
5. Repeat from step 1 until the template matches or no unanswered questions remain

### Key Invariants

- **No loops** — each step answers one new question. Once `sel[nodeId]` is set, that node is skipped. The walk is strictly forward (bounded by the number of nodes).
- **`cleanSelection` is local** — every state mutation happens in the just-pushed edge's `collapseToFlavor` blocks; the function does not invalidate or retract answers it didn't directly write. The resulting state is deterministic given the inputs and identical to what static analysis (`graph-io._applyEdgeWrites`) computes for the same push.
- **State equivalence** — two states with identical `sel` values will have identical derived values, identical visibility, and identical reachability to any template. This makes state-based caching sound.

### Condition System

All conditions (`activateWhen`, `requires`, `disabledWhen`, `hideWhen`) use a unified grammar based on effective (resolved) values:

| Syntax | Meaning |
|---|---|
| `dim: ['val1', 'val2']` | Effective value of `dim` is one of the listed values |
| `dim: true` | Effective value of `dim` is set (non-null) |
| `dim: false` | Effective value of `dim` is NOT set (null/undefined) |
| `dim: { not: ['val1'] }` | Effective value is NOT one of the listed values (undefined passes) |
| `dim: { not: ['val1'], required: true }` | Same as above, but must also be set (undefined fails) |
| `reason: '...'` | Annotation for UI display; skipped by logic |

### Edge-local writes replace lazy derivation

Every change to `sel` / `flavor` is committed by the edge that fires (directly via its `collapseToFlavor.set` / `setFlavor` blocks, or via a module's exit plan installed by `attachModuleReducer`). There is no separate derivation pass — `resolvedVal(sel, dim)` is now a direct `sel[dim]` lookup, and `matchCondition` reads `sel[k]` directly (no recursion, no JIT derivation tables).

Dims that the user never picks (e.g. `ruin_type`, `governance`, `alignment` on the `alignment_durability=breaks` shortcut) are still kept `derived: true` so the priority system / question UI never surfaces them; their values land in `sel` via `collapseToFlavor.set` writes from the edges that own the upstream signal. To trace where a dim is written, walk every edge's `collapseToFlavor.set` and every `module.exitPlan[*].set` — that's the complete authoring contract.

### Template Matching

Outcome templates have `reachable` conditions in DNF. A template matches when the effective state satisfies any clause. The locked explore path feature uses DFS reachability to check whether a template *can* be reached from the current state.

### Outcomes are terminal

A state where any outcome template matches is **terminal**: the UI presents that outcome and no further questions are offered. A user's path is the prefix of clicks up to and including the first matching state; any later state that would also satisfy a template is out of scope, both for navigation and for reach-set computation.

Two consequences follow:

1. **Reach-map shape.** The precompute (`precompute-reachability.js`) stops at the first siphon (template match) when walking the FLOW_DAG, so `reach/<outcome>.json` contains projection-keyed entries only for states that are *not yet* terminal. The UI predicate `reachSet.has(<slotKey>|out:<projKey>)` is correct because the browser never asks a question from a terminal state.
2. **Authoring invariant.** If every path to outcome `B` transits a state where some other outcome `A` also matches, the user can never reach `B` — `A` terminates the path first. The existing `violations.ambiguous` check (no two templates match the same state) is strictly required for this invariant to hold; authors should treat it as a hard rule.

---

## Renderer (index.html)

The front-end is a single `index.html` file (with co-located CSS/JS) that:

1. **Presents** the questionnaire one question at a time, with smooth transitions
2. **Tracks** the user's path through the graph via an immutable answer stack
3. **Renders the outcome** when a template matches — story, timeline, and a summary of choices
4. **Provides an about/gallery view** where users can browse all possible futures
5. **Supports locked explore mode** — guided paths that filter choices to reach a specific outcome

### UI Principles

- Clean, modern, slightly futuristic aesthetic
- Dark mode by default, light mode toggle
- Mobile-responsive
- No build step — vanilla HTML/CSS/JS
- Animated transitions between questions
- Timeline rendered as a vertical scrollable strip with event cards

### No Server Required

Everything is static. Can be opened as a local file or served from any static host (GitHub Pages, Netlify, etc.).

---

## File Structure

```
Singularity Map/
├── SPEC.md                        ← this file
├── README.md                      ← project overview and setup
├── index.html                     ← main app (single-page, all UI logic)
├── graph.js                       ← decision graph — nodes, edges, conditions
├── engine.js                      ← state machine — selection (single-pass cleanSelection), resolution, display order
├── graph-io.js                    ← per-slot static-analysis primitives (cartesianWriteRows, reachableFullSelsFromInputs, _applyEdgeWrites, selKey, projectKey, read/writeDimsForSlot)
├── flow-propagation.js            ← DAG-level driver composing graph-io primitives over FLOW_DAG (powers validate.js + reach precompute)
├── nodes.js                       ← FLOW_DAG (slot inventory + parent/child edges) and /nodes view
├── precompute-reachability.js     ← builds per-outcome reach sets into data/reach/ via FlowPropagation outer pass + per-module inner DFS, projection-keyed
├── timeline-animator.js           ← timeline rendering and animation
├── timeline.css                   ← all styles
├── milestone-utils.js             ← timeline event grouping helpers
├── generate-share-assets.js       ← OG image + share page generator
├── validate.js                    ← graph integrity checker (static + DFS invariants)
├── serve.js                       ← local dev server
├── data/
│   ├── outcomes.json              ← outcome templates (with variants, flavors, reachable conditions)
│   ├── narrative.json             ← question text, answer descriptions, timeline events, vignettes
│   ├── personal.json              ← profession list, country buckets
│   └── reach/                     ← per-outcome reachability sets (JSON + gzipped)
├── test/                          ← reduction-correctness harness
│   ├── run.js                     ← baseline-vs-optimized DFS comparison
│   ├── graphs/                    ← minimal graphs exercising each reduction
│   ├── reach-browser-sim.js       ← simulates the browser's wouldReachOutcome path
│   └── reach-table.js             ← reach-map inspection CLI
├── tests/                         ← narrative/evaluation
│   ├── evaluate.js                ← LLM-based evaluation — persona simulation, audits
│   └── personas.json              ← test personas for evaluation
├── research/
│   ├── graph-formalization.tex    ← formal writeup (see \ref{sec:reductions})
│   └── graph-formalization.pdf
└── share/                         ← OG share pages and images for each outcome variant
```

---

## Design Decisions

- **How many outcomes?** Uncapped — the tree's natural branching determines how many futures exist.
- **Shared sub-paths?** Yes. Multiple branches can converge on the same outcome. The graph supports this naturally.
- **Scoring vs. pathing?** Pure pathing. Each answer leads to a specific next state — no scoring, no axis accumulation.
- **Replayability?** Yes. Discovered futures are tracked in localStorage.
- **Sharability?** Yes. Path/outcome is encoded in the URL hash for direct links. Outcomes are also browsable from the about page.
- **Question depth per path?** Varies (3–12 questions depending on the branch).
- **Answers per question?** 2–7, flexible per question.
- **Tone?** Conversational enough to be accessible, journalistic enough to feel authoritative.
- **Back button?** Yes. Full back navigation — users can revisit and change any previous answer, which updates the path forward via `cleanSelection`.

---

## Modules

As of the decel migration, the engine has first-class support for **modules** — self-contained sub-loops with an explicit input/output contract.

### Contract

A module declaration lives in `graph.js` alongside `NODES`:

```js
{
  id: 'decel',
  activateWhen: [{ gov_action: ['decelerate'] }],
  reads:  ['gov_action', 'alignment', 'open_source', 'capability', 'automation'],
  writes: ['alignment', 'geo_spread', 'rival_emerges', 'governance',
           'containment', 'decel_align_progress'],
  nodeIds: [...14 internal dim ids...],
  reduce(local) -> bundle,   // (local state) -> partial sel writes
  reducerTable: {...}        // enumerable cells for audit + walker
}
```

- `reads` lists the global dims the module's internals consult.
- `writes` lists the global dims the reducer commits to `sel` on module exit.
- `nodeIds` lists internal dims; they still live in top-level `NODES` for now but are logically scoped to the module.
- `reduce` is a pure function from frame-local state → write bundle.

Modules are registered in the `MODULES` array exported from `graph.js`.

### Runtime

- **Entry.** When a module's `activateWhen` fires, the engine pushes a frame onto `stack.moduleStack` and scopes `findNextQ` to the module's internal dims.
- **Exit.** On a terminating internal edge, the module's `reduce(local)` produces the write bundle, which is committed to global `sel` via `collapseToFlavor` installed by `attachModuleReducer(mod)`. Internal dims are moved to `flavor`.
- **No `outcome` tag.** The decel module intentionally eliminates the intermediate `decel_outcome` dim that previously dispatched through a cascade of derivation rules. Writes land directly on consumer globals — simpler, faster, easier to audit.

### Static analysis (Phase 5)

`graph-io.js` enumerates each module's exit space declaratively: `cartesianWriteRows(slot)` returns a `(bucketKey → projKeySet)` table where the bucket is the projection onto `module.reads` and each `projKey` is a JSON-stringified projection onto `module.writes`. `flow-propagation.js` composes those per-slot tables across the FLOW_DAG via topological propagation; `validate.js`, `precompute-reachability.js`, and `/explore` all share the same primitives. The runtime gate (`wouldReachOutcome` in `index.html`) computes the same `<slotKey>|out:<projKey>` keys against the precompute output, so static analysis and the live UI agree by construction.

Modules without an explicit reducer table fall through the same DFS — the table is now derived from `attachModuleReducer`'s exit-tuple installation rather than authored separately, so the question of whether to keep one is moot.

### Auditing

`module-audit.js` validates each module's contract:
- Internal dims not read from outside the module.
- Template flavors/headings don't reference internal dims.
- Every cross-module `reads` cell is declared in `module.reads`.
- Every reducer cell's writes are declared in `module.writes`.
- External consumers of `module.writes` are enumerated.

Run: `node module-audit.js`.

### Decel retrospective

Decel was a well-contained sub-loop — 14 internal dims, a linear time-step structure, and a clean dispatch-table outcome shape. That made it an ideal first module; the migration exposed several design decisions that generalize well:

- **Reducer table as source of truth.** Keeping the (action × progress) → writes table as pure data enabled the boundary audit, the path-equivalence test, and the walker's atomic-edge optimization to all consume the same declaration without duplication.
- **Direct writes beat intermediate dispatch dims.** Deleting `decel_outcome` removed a whole layer of derivation chains and made downstream dependencies explicit. This is the pattern to replicate for future modules.
- **Marker dims without node declarations.** `decel_align_progress` became a module-written sel-dim with no node declaration. Its values are registered via the engine's `markerVals` scan of `collapseToFlavor` blocks, which prevents the DFS from enumerating it as a user-selectable dim (an earlier attempt to keep the node declaration caused 3k+ spurious DFS violations).

### Escape retrospective

Escape (7 internal dims, 4 writes) was the second module. It deliberately broke two assumptions decel had baked in, and the infrastructure adapted without regressions.

- **Not every module wants an explicit reducer table.** Decel's (action × progress) lattice had 9 cells, fully written out; escape's exit space (`response_success × collateral_impact × discovery_timing × catch_outcome`) has long-tail conditional structure. The escape module relies on `attachModuleReducer` to derive its exit-tuple set from `exitPlan`, so the per-cell table is built lazily by `cartesianWriteRows` rather than authored by hand. `MODULES`-iterating code (`module-audit.js`, `/explore` cluster rendering, `/nodes` sidebar grouping) works the same regardless.
- **`writes ⊂ nodeIds` is legal.** Decel wrote to globals it didn't own (`alignment`, `governance`, `containment`). Escape writes to two of its own internal nodes (`catch_outcome`, `collateral_impact`) because external consumers (downstream nodes that read these dims via `activateWhen` / `hideWhen` / `disabledWhen`, template `reachable` clauses, and the vignette builder) need them in `sel`. `attachModuleReducer` was generalized to compute `move = nodeIds \ writes`, so the remaining pure-internal dims (`escape_method`, `escape_timeline`, `discovery_timing`, `response_method`, `response_success`) collapse to `flavor` on exit. Decel's behaviour is unchanged (writes disjoint from nodeIds → all nodeIds move).
- **"Third scope" template matching.** `templateMatches` reads from `resolvedStateWithFlavor(sel, flavor)` — a fused view with flavor underlaid and sel winning on conflict — so outcome templates can reference module-internal dims (e.g. `discovery_timing`) without those dims polluting global `sel`. (The current FlowPropagation reach pipeline runs on `sel` only, but `cleanSelection` keeps `sel` faithful to the move list so the precompute and the live UI siphon at the same states.)
- **`module-audit.js` classifies template/narrative references to internal dims.** Refs split into two categories: (a) `template.reachable` blocks — these drive template gating, now via `resolvedStateWithFlavor`, so flavor-moved dims work; and (b) `template.flavor` / `narrative.json` entries — these render via the merged `narrEff = sel ∪ flavor`. Both categories are informational (not leaks) as long as the dim is moved to flavor on module exit.
- **Hidden narrEff consumer in share-vignettes.** `share/share-vignettes.js::renderPersonalizedTimeline` was passing `resolvedState(sel)` (not `narrEff`) into `resolveTemplate`, which would have broken the escape timeline once `escape_method`/`escape_timeline` moved to flavor. Caught during the external-consumer audit and fixed in this migration. The general rule: any narrative/flavor consumer needs `Object.assign({}, currentFlavor(stack), eff)` as its state arg.
- **Metrics.** DFS violations dropped from 7144 → 6146 (−998) — the gain comes from escape's internal dims no longer polluting URL keys on exit, which collapses many previously-distinct "stuck node" terminals. Reach mismatches held at 575 (pre-existing, unrelated to modularization). Decel path-equivalence still PASS.

### Who Benefits retrospective

Who Benefits (7 internal dims) was the third module. It exposed two previously-implicit design patterns.

- **External consumers need refactoring, not suppression.** The initial contract hit 16 boundary violations — external rules (`OUTCOME_ACTIVATE`, `failure_mode.activateWhen`, the prior `intent` derivation) reached into Who Benefits' internals (`pushback_outcome`, `sincerity_test`, `power_promise`, `mobilization`). Rather than widening the module's `writes` to keep those dims in `sel`, we refactored external consumers to depend on the new `who_benefits_set` completion marker (Option B). This let all seven internal dims collapse to flavor on exit and kept the module truly self-contained.
- **Completion markers decouple ordering from internal structure.** `who_benefits_set: 'yes'` is a single sel-dim written by the reducer (alongside `benefit_distribution` and `concentration_type`). External activation gates that used to enumerate internal branches (`pushback_outcome: ['pushed_back']`, etc.) now read the marker directly. This generalizes cleanly: any downstream question that currently gates on "after the user has answered questions A, B, C" can instead gate on a single post-module marker.
- **Metrics.** DFS violations dropped from 6146 → 2392 (−3754) — the biggest single gain of the three modules, because Who Benefits sits on most major outcome paths, so removing its internals from the URL key collapses a huge fraction of the state space. Premature-outcomes warnings dropped from 27 → 18 (−9). Module audit passes cleanly; `writes` and cross-module `reads` are fully declared.

### Rate-question deduplication (not a module)

Following Who Benefits, we merged six near-duplicate stage-3 rate questions into two unified dims. **This is node-level deduplication, not modularization** — `knowledge_rate` and `physical_rate` are flat graph nodes with context-aware activation/collapse rules, not members of a `MODULE`. No reducer, no completion-via-reducer, no `/explore` cluster box. The only module-ish artifact is the `_set` marker pattern (already used by `takeoff_class`, `agi_happens`, etc.).

**Before:** `knowledge_replacement` (main), `plateau_knowledge_rate` (stalls), `auto_knowledge_rate` (auto-shallow), and the symmetric physical trio — six nodes, each with its own narrative entry, each hardcoded into templates and marker dims (`plateau_knowledge_set`, `auto_knowledge_set`, etc.).

**After:** one `knowledge_rate` node and one `physical_rate` node, each with:
- A union `activateWhen` spanning main / plateau / auto-shallow paths.
- Edge-level `disabledWhen` rules per context (e.g., `limited` is disabled on the main path; `rapid` on physical is disabled on the plateau path).
- Post-rollout-module, both dims (and `failure_mode` on the main path) are auto-moved to `flavor` via `attachModuleReducer` (`nodeIds \ writes`, with `ROLLOUT_WRITES = []`). `rollout_set` serves as the single re-ask guard for all three nodes via `hideWhen`. Templates / narrative / `primaryDimension` lookups read the dim through the fused view (`sel ∪ flavor`), so no template surface changes.

**Narrative preserved without schema changes.** Context-specific text was already supported by two existing mechanisms:
- `narrativeVariants` on each value entry — per-context `answerLabel`, `answerDesc`, `timelineEvent`, `personalVignette` overrides keyed by `when`.
- `contextWhen` at the node level — per-context `questionContext` override. Extended in this migration to also honor `questionText` / `shortQuestionText` / `shortQuestionContext` overrides (three new `Engine.resolve*` helpers, wired through `findNextQuestion` in `index.html`). No loss of fidelity vs. the three separate entries.

**Disabled-but-present pattern.** Rather than gating edges out of existence, `limited` is always an edge — `disabledWhen` removes it on paths where it doesn't make sense (with per-context `reason` strings). This is cleaner than the pre-refactor mix of edge existence / absence: the UI renders a consistent set of options with contextual grey-outs, and the graph walker sees a single edge list to reason about.

**Metrics.** DFS violations dropped from 2392 → 20 (−2372). Reach mismatches dropped from 575 → 0 (−575) — the 575 baseline was entirely an artifact of the three duplicated rate nodes presenting the same semantic question under different IDs on different paths, which the lightPush/commit invariant couldn't reconcile. Premature-outcomes held at 18. The remaining 20 DFS violations are the pre-existing takeoff auto-collapse warning (16) and the stalls-mild dead-ends (4), neither introduced by this refactor.

### Rollout retrospective

Rollout (3 internal dims: `knowledge_rate`, `physical_rate`, `failure_mode`) was the fourth module. It's the first module where the internal question set varies by context:

- **Main singularity path** asks all three; all three move to flavor on module exit (`failure_mode.*`).
- **Plateau path** asks only knowledge_rate / physical_rate; both move to flavor on module exit (`physical_rate.*`).
- **Auto-shallow path** asks only knowledge_rate / physical_rate; same as plateau.

This pattern generalizes: a module can be a *question-set superset* spanning multiple contexts, with per-context activation and exit behavior, as long as exit tuples are expressed at the node level (`exitPlan` with `when` gates) and the module-level machinery (`writes`, `nodeIds`, `internalMarkers`) declares the union contract.

Key design points:

- **`writes = []` when all internals are flavor-consumed.** None of the three rollout dims have external sel-only logic-gate readers: outcome templates consume them via `primaryDimension` (which reads fused state), reachable clauses consume only the `rollout_set` completion marker, and narrative reads via `narrEff`. So `writes = []`, and `attachModuleReducer`'s `nodeIds \ writes` auto-moves all three to flavor on every module exit. `rollout_set` serves as the single post-answer hide gate via `hideWhen` on each of the three nodes.
- **Multi-context exit plan.** `buildRolloutExitPlan` emits tuples for two distinct exit edges: `failure_mode.{none,drift}` (main path, unconditional `set: rollout_set`) and `physical_rate.{rapid,gradual,uneven,limited}` with `when: capability=stalls` and `when: capability=singularity,automation=shallow` gates (plateau / auto-shallow exits). knowledge_rate is never an exit edge — physical_rate always comes second (same priority, later NODES position).
- **Single completion marker.** `rollout_set` is the only sel-level output; there are no longer any per-node completion markers (`knowledge_rate_set` / `physical_rate_set` were removed in favor of the unified gate). This both shrinks the marker set and keeps the `rollout_set`-to-external-readers contract minimal.

### Emergence retrospective

Emergence (8 internal dims: `capability`, `stall_duration`, `stall_recovery`, `agi_threshold`, `asi_threshold`, `automation_recovery`, `takeoff`, `governance_window`) was the fifth module — and the first entry / root module. It covers the "Act 1" arc from the very first question up to the point where the scenario branches into plateau, auto-shallow, or the main path's entry into `open_source`.

Firsts this module introduces:

- **Root activation.** `activateWhen: []` — always pending. The module is live from an empty sel through to `emergence_set: 'yes'`. Prior modules all had non-trivial activation gates because they sat mid-flow; emergence is the flow's origin, so no gate is needed. The completion marker alone handles exit.
- **Four-way exit plan (9 edges).** `buildEmergenceExitPlan` emits tuples across four nodes:
  - `stall_recovery.{substantial, never}` → plateau branch (sets `stall_later: yes`).
  - `automation_recovery.{substantial, never}` → auto-shallow branch (sets `automation_later: yes`).
  - `takeoff.{fast, explosive}` → main path, governance-skipped direct exit.
  - `governance_window.{governed, partial, race}` → main path, post-governance exit.

  Each edge unconditionally sets `emergence_set: 'yes'`; no `when` gates needed because the edge id uniquely identifies the path.
- **Derived-dim-as-write.** `automation` (a derived `forwardKey` node) is listed in `writes` even though it's not in `nodeIds`. Its value is committed by emergence-internal edges (`automation_recovery.*`, `asi_threshold.*`) via `collapseToFlavor.set`, so it's effectively a module output written from inside the DFS. Declaring it as a write signals to `module-audit` that external consumers legitimately read it. `governance` has similar shape but a dual source (decel's `gov_action` also writes it on the accelerate path, plus the `gov_action.accelerate` edge writes `governance='race'` to flavor), so it's left outside the contract and shows as a LEAK informational only.
- **Writes include conditional-sel dims.** `asi_threshold` is in writes because on the `asi_threshold: 'never'` edge it stays in sel (downstream rules read it); on other edges it moves to flavor via the node's own `collapseToFlavor`. `attachModuleReducer` doesn't force a move because the dim is in writes, so the per-edge rules own the placement decision. This generalizes the rollout pattern ("writes dims the edges themselves manage") one level further: writes can include dims that are sometimes moved and sometimes kept, and the module contract is still coherent.

Audit refinement:

- **Module's own writes are part of internal state.** `module-audit.js` previously flagged any dim read by an internal node but absent from `mod.reads` as an undeclared external read. That's wrong for markers the module itself sets (e.g., `stall_later`, `agi_happens`, `automation_later`, `takeoff_class`): those are module-internal state threaded between nodes, not external dependencies. The audit now excludes declared writes from the undeclared-read check, which removed 8 false positives for emergence without loosening the boundary for genuine external dims (those are in `reads`, not `writes`).

Metrics (unchanged from post-rollout baseline):

- 0 static errors, 20 DFS violations, 0 reach mismatches, 18 premature-outcome warnings.
- Module audits: all 5 modules (decel, escape, who_benefits, rollout, emergence) pass cleanly.

With emergence in place, the graph is now 100% covered by modules from root to stage-3 completion: **emergence → (who_benefits + rollout)** on the main path, and **emergence → (rollout)** on the plateau / auto-shallow paths. The remaining non-modularized region is stage-3 "main sequence" proper (open_source, distribution, geo_spread, sovereignty, alignment, containment, ai_goals, intent, escape family, decel family) — which is itself the decel module plus a large decision tree that hasn't yet been factored into sub-loops.

### Control retrospective

Control (4 internal dims: `open_source`, `distribution`, `geo_spread`, `sovereignty`) is the sixth module. It sits in the stage-2 bridge between emergence and alignment on the main singularity path, grouping the "who ends up running the AI?" questions. This is the first module whose internal tree has genuinely branching shape — not every internal node is answered on every path.

Shape specifics:

- **Variable question count per path.** 5 exit edges across 3 terminal nodes:
  - `distribution.open` — only reachable when `open_source=near_parity` forces distribution's other edges disabled; `geo_spread` / `sovereignty` both skipped by their own `activateWhen`. 2-question path.
  - `geo_spread.{two, several}` — `sovereignty` requires `geo_spread=one`, so the multi-country branch exits a question short. 3-question path.
  - `sovereignty.{lab, state}` — the `geo_spread=one` branch, 4 questions total.

  Escape and who_benefits had branching internally but still had one canonical exit node each; control is the first where the exit node itself varies with state.
- **Every internal dim is a write.** `writes` = all 4 internal dims + `open_source_set` marker + `control_set` marker. None of the four user-pickable dims can be pure-internal: each is consumed by at least one downstream node or outcome template on at least one path. This makes `nodeIds \ writes = ∅`, so `attachModuleReducer` forces zero flavor moves — the per-edge node-level `collapseToFlavor` rules (which already encode the correct per-path move decisions, e.g. `geo_spread.two` moves `open_source`, `sovereignty.lab+concentrated` moves `open_source`) own all placement. Same inverse-of-decel shape as rollout / emergence.
- **Cross-module overrides count as reads.** `geo_spread` is overwritten by PROLIFERATION's exit plan whenever the leaked-weights path fires (proliferation_outcome=leaks_*); control reads `proliferation_outcome` indirectly through that downstream override path, so the dim is declared in `reads` alongside the always-live inputs (`capability`, `takeoff_class`).
- **Layered hideWhen with a cross-module writer.** `takeoff.hideWhen` (inside emergence) reads `open_source_set` (written by control). Emergence already declared it in `reads` when control didn't exist yet — now it's a clean cross-module pair: emergence reads a marker that control writes. No audit change needed; this is exactly what the contract is for.

Metrics (unchanged from post-emergence baseline):

- 0 static errors, 20 DFS violations, 0 reach mismatches, 18 premature-outcome warnings, 23 unreachable-clause DEAD entries.
- Module audits: all 6 modules (decel, escape, who_benefits, rollout, emergence, control) pass cleanly.

Coverage now: **emergence → control → (who_benefits + rollout)** on the main path. Stage 2's remaining non-modularized region is (alignment, alignment_durability, containment, ai_goals, intent, brittle_resolution, gov_action, proliferation_control, proliferation_outcome) plus escape / decel (already modularized). The "main-sequence alignment module" candidate is the natural next step.

### Escape widening retrospective (ai_goals subsumed)

Escape was originally drawn tight around its 7-node pipeline (`escape_method → ... → catch_outcome`), with `ai_goals` left outside as an external gate. A user review surfaced the re-use argument: `ai_goals` is asked in two distinct activation contexts (alignment=failed+containment=escaped, and concentration_type=ai_itself), and in both cases its answer is precisely what decides whether the escape pipeline runs. Encapsulating the question + its consequences into one module means we can reason about the whole "what does the AI want? then what happens?" sub-flow as a single unit — and if a future context needs to re-invoke it, there's one contract to invoke rather than two loose pieces.

The widening introduced the first **early-exit module** pattern:

- **activateWhen broadened** to exactly `ai_goals`'s own activateWhen (drop the old hostile-only gate). Module is pending from the moment `ai_goals` would first be askable.
- **nodeIds expanded to 8** (ai_goals prepended). On hostile paths (alien_coexistence / alien_extinction / paperclip / swarm / power_seeking) the original 7-node pipeline runs; on `benevolent` / `marginal` it short-circuits.
- **4 exit tuples, 2 terminal nodes.** `ai_goals.{benevolent, marginal}` fire early-exit tuples (pipeline skipped entirely — user's 1 answer was all the module needed). `catch_outcome.{not_permanent, holds_permanently}` fire the original pipeline-complete exits. Every tuple sets the new `escape_set` completion marker. (`not_permanent` fuses the pre-merge `never_stopped` + `holds_temporarily` edges — the two were already mutually exclusive on `response_success`, so the sel-level split carried no information the engine actually branched on; narrative/flavor text now disambiguates the two sub-cases by reading `response_success` from flavor via `narrSel` / `resolvedStateWithFlavor`.)
- **Explicit `completionMarker: 'escape_set'`.** The prior auto-detection ("last write") assumed a single terminal node; with two exit nodes we need an explicit marker so the walker knows the module is done regardless of which path was taken. Same pattern as who_benefits / rollout / emergence / control — escape_set becomes the 5th module to declare one.
- **`ai_goals` added to writes.** It's externally consumed by dozens of nodes and outcome templates (intent.hideWhen, containment.hideWhen, ruin_type, failure_mode, who_benefits, etc.). The user's answer stays in sel on exit, same as on the pre-module graph.
- **`inert_outcome` node removed.** The inert-wakes path now re-asks `ai_goals` inside the escape module (instead of asking a near-duplicate `inert_outcome` node). `inert_stays.no.collapseToFlavor.move` evicts the `marginal` pick; `ai_goals.marginal.disabledWhen` blocks re-choosing it; the escape pipeline runs as normal via `ai_goals ∈ hostile`. All external references that used to read `inert_outcome` (hideWhen `inert_outcome: false`, activateWhen `inert_outcome: true`, conditional matches) now read `inert_stays` directly.

Audit / validation: all 6 modules pass cleanly. Metrics unchanged (0 static errors, 20 DFS violations, 0 reach mismatches, 18 premature-outcome warnings, 23 unreachable-clause DEAD entries). The `module_primitive.js` test was updated to reflect the new 5-tuple exit plan and 6-write contract.

Takeaways for future modules:

- **Gate questions belong inside the module whenever the gate + follow-up form a coherent sub-flow.** The alternative (gate outside, follow-up inside) forces callers to understand both pieces; with the gate inside, the module is self-contained and trivially re-usable across activation contexts.
- **Early-exits are cheap.** An exit tuple on a non-pipeline edge is just a marker write plus the standard `attachModuleReducer` move list. The move targets dims that were never set on that path — harmless no-ops. Dynamic atomic-cell enumeration in `/explore` will show these as degenerate cells labeled with just the `ai_goals` value + `escape_set: yes` (no pipeline dims to differentiate).
- **Mirror the gate node's activateWhen verbatim when it's the first internal node.** Widened escape's activateWhen = `ai_goals`'s activateWhen. No new invariants to reason about; module pending-ness tracks node askability 1:1.

### Proliferation retrospective

Proliferation (3 internal dims: `proliferation_control`, `proliferation_outcome`, `proliferation_alignment`) is the 8th module. It's a short stage-2 chain that answers "once the AI works, who gets access, does control hold, and can alignment survive if it leaks". Structurally it's the simplest module yet (3 nodes, linear), but it introduced one genuinely new pattern.

- **Conditional exit tuples.** Two exit edges (`proliferation_control.none`, `proliferation_outcome.leaks_public`) behave differently depending on `alignment`: on `alignment=robust` the module must stay active (downstream `proliferation_alignment` fires); on `alignment ≠ robust` the module exits. Expressed by giving those exit tuples a `when: { alignment: { not: ['robust'] } }` gate. The runtime `cleanSelection` step evaluates per-block `when` clauses against the post-edge `sel` — the only new wiring was letting `exitPlan` tuples carry non-empty `when`, which `attachModuleReducer` already plumbs through verbatim. No engine changes needed.

  This is the first time a single edge is ambiguous between "exit" and "continue" based on external state. Previous modules either exited unconditionally on an edge (escape, control) or varied exit *writes* by path (decel's reducerTable) but never varied *whether* the edge was an exit at all.

- **Edge-local writes set internal-only dims without asking.** The `proliferation_control.none` edge writes `proliferation_outcome: 'leaks_public'` via `collapseToFlavor.set`. When the user picks that edge, `proliferation_outcome` is committed to `sel` mid-module — `proliferation_alignment.activateWhen` sees `proliferation_outcome=leaks_public` and fires (or doesn't), exactly as if the user had answered. The module's completion logic (via `proliferation_set` marker) works orthogonally to this: the marker is set on whichever user-answered edge terminates the module, regardless of which other internal dims are written by upstream edges vs. asked vs. skipped. No special handling required.

- **activateWhen = first-node's activateWhen verbatim.** Mirrors `proliferation_control`'s 3-clause activation exactly (gov_action didn't run, or ran with non-escape/non-fail outcome). Same "mirror the gate node" pattern escape widening introduced — module pending-ness tracks node askability 1:1.

- **Two of three internal dims are flavor-moved on exit.** Only `proliferation_alignment` stays in `writes` (gate-read by 5 `ai_goals.*.disabledWhen` clauses on `holds`, used to rule out hostile goals on robust-aligned-survived-leak escape paths). `proliferation_control` and `proliferation_outcome` are mid-module-only gate readers (control → outcome's `activateWhen` / `requires`; outcome → alignment's `activateWhen`) and have no external sel-only readers post-exit; outcome flavor blocks (~7 in `outcomes.json`) and one `containment.contextWhen` entry read them via fused state. `nodeIds \ writes = { proliferation_control, proliferation_outcome }` — `attachModuleReducer` auto-moves both to flavor on every exit tuple. Two wrinkles worth noting: (1) the mid-module `secure_access` eviction on `proliferation_outcome.leaks_public` lives as a direct edge-level `collapseToFlavor` block (not in `buildProliferationExitPlan`) so it doesn't receive the auto-move list — it must fire on the alignment=robust path where the module hasn't exited yet and `proliferation_outcome` must remain in `sel` for `proliferation_alignment.activateWhen`. (2) `LEAKED_OPEN` explicitly writes `proliferation_outcome: 'leaks_public'` because on the `proliferation_control=none + alignment≠robust` exit, `proliferation_outcome` was only resolved via `deriveWhen` (never set in sel); without the explicit write, the auto-move would have nothing to shuttle into flavor and the post-exit narrative read would resolve to undefined.

Metrics unchanged from post-escape-widening baseline: 0 static errors, 20 DFS violations, 0 reach mismatches, 18 premature-outcome warnings, 23 unreachable DEAD, all 7 modules pass audit, `module_primitive.js` PASS. Functional spot-checks confirmed the conditional exits fire correctly (none + brittle → exit; none + robust → stay active until proliferation_alignment; leaks_public + robust → stay active; leaks_public + brittle → exit).

Coverage now, on the main singularity path: **emergence → control → proliferation → ...**. The "..." stage-2 region that remains outside any module is now (alignment, alignment_durability, containment, intent, brittle_resolution, gov_action) — and gov_action is the entry point of the already-modularized decel. Intent is typically the last stage-2 gating question before the outcome transitions; alignment / durability / containment are mostly decision points feeding into either decel, escape, or proliferation. The remaining structure is decorative-decision rather than sub-loop-shaped, which argues against forcing another module on top of it.

### Next candidates

- **More node-level dedup.** `benefit_distribution` (main) / `plateau_benefit_distribution` (stalls) / `auto_benefit_distribution` (auto-shallow) follow the same three-context pattern as the rate questions. Same unification treatment should apply cleanly. Note: keep `benefit_distribution` in the Who Benefits module (not merged into Rollout) — on the main path, stage-3 questions can intervene between Who Benefits completion and the rate questions, and we want those to sit cleanly between the two modules rather than mid-module.
- **Stopping point?** With 8 modules covering emergence, control, proliferation, decel, escape (incl. ai_goals), who_benefits, and rollout, the main remaining non-modularized stage-2 nodes are (alignment, alignment_durability, containment, intent, brittle_resolution, gov_action). Gov_action is already the decel entry gate. The other five are mostly linear decision points between modules rather than a self-contained sub-loop — modularizing them would likely be organizational rather than structural. Worth evaluating whether the marginal clarity benefit justifies another module, or whether they're better off as flat nodes that bridge between module exits.
