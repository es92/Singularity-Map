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
- **`deriveWhen`** *(optional)* — rules that compute this dimension's value from other dimensions instead of asking the user
- **`derived: true`** — marks the node as purely derived (never presented as a question, invisible to the priority system)
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

Applied during `cleanSelection` when the edge is selected. Supports three actions, any combination:

| Key | Effect |
|---|---|
| `set: { k: v, … }` | Write/overwrite `sel[k] = v`. Typically used to set a "marker" dim (e.g. `asi_happens: 'yes'`) so the collapsed state is distinguishable from pre-answer state (matters for `selKey`-based convergence). |
| `move: ['dim1', 'dim2']` | For each listed dim, if `sel[dim]` is set, move it to `flavor[dim]` and delete from `sel`. The specific chosen value is preserved in `flavor` for narrative lookups. |
| `setFlavor: { k: v, … }` | Write `flavor[k] = v` directly (without going through `sel`). Useful when a narrative-only derived field needs to be recorded. |

"Marker" dims (like `asi_happens`, `governance_set`, `takeoff_class`, `plateau_knowledge_set`) are written into `sel` via `collapseToFlavor.set` but aren't declared as graph nodes. The engine auto-registers them in its value-index tables at init so they can be used in `deriveWhen.match`, `activateWhen`, `requires`, etc., just like declared dims.

### When is it safe to move a dim to flavor?

A dim can be moved to `flavor` (via `collapseToFlavor.move`) **only if no downstream rule reads its specific value from `sel`**. Specifically, check all of the following across the rest of the graph:

- `activateWhen`
- `hideWhen`
- `requires`
- `disabledWhen`
- `deriveWhen` (both `match` and `fromState`)

If only **`primaryDimension` (outcome variants)**, **narrative `contextWhen`**, or **outcome `flavors._when` / `_default`** lookups reference it, it's fair game — those all resolve through `narrativeState`, which sees flavor.

If engine branching still needs *one bit* of information from the dim (e.g. "did AGI happen at all?" vs. specific timing), introduce a marker dim via `collapseToFlavor.set` that captures that bit, update the downstream rules to gate on the marker, and move the original dim to flavor. See `agi_threshold` → `agi_happens` for a worked example.

### How a Path Progresses

1. The engine presents the first unanswered, visible, non-derived question (determined by `displayOrder`, which follows the node order in `graph.js`)
2. The user picks an edge → `push()` sets `sel[nodeId] = edgeId`
3. `cleanSelection()` runs, which can cascade state changes:
   - **Retract** — if a previously-answered node is no longer activated (`activateWhen` fails), its answer is deleted
   - **Invalidate** — if a previously-chosen edge is now disabled, that answer is deleted
   - This runs as a fixpoint loop (up to 5 passes) since changes can cascade

   Note: when a node becomes **locked** (only one edge remains enabled), `cleanSelection` does *not* write that value into `sel` automatically. Instead, the UI detects locks via `Engine.isNodeLocked` and presents the node as a single-option "Continue" screen; the user commits it through the normal push flow like any other answer. Downstream code that needs the effective value (template matching, visibility in the resolved state) consults `resolvedState`/`isNodeLocked` directly.
4. Derived dimensions are recomputed from the new state
5. Repeat from step 1 until the template matches or no unanswered questions remain

### Key Invariants

- **No loops** — each step answers one new question. Once `sel[nodeId]` is set, that node is skipped. The walk is strictly forward (bounded by the number of nodes).
- **`cleanSelection` can mutate arbitrarily** — answering question X can retract, force, or invalidate answers to other questions. But the resulting state is deterministic given the inputs.
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

### Derivation Rules (`deriveWhen`)

Each rule in a node's `deriveWhen` array has:

| Property | Meaning |
|---|---|
| `match` | Condition object (same unified grammar as above) — all keys must match for the rule to fire |
| `value` | The derived value to assign if the rule fires |
| `fromState` | Copy the effective value from this other dimension (instead of a fixed `value`) |
| `valueMap` | Map input values to output values (instead of a fixed `value`) |

Rules are evaluated in order; the first matching rule wins.

### Template Matching

Outcome templates have `reachable` conditions in DNF. A template matches when the effective state satisfies any clause. The locked explore path feature uses DFS reachability to check whether a template *can* be reached from the current state.

### Outcomes are terminal

A state where any outcome template matches is **terminal**: the UI presents that outcome and no further questions are offered. A user's path is the prefix of clicks up to and including the first matching state; any later state that would also satisfy a template is out of scope, both for navigation and for reach-set computation.

Two consequences follow:

1. **Reach-map shape.** The precompute (`graph-walker.js`) stops DFS at the first template match, so `reach/<outcome>.json` contains irrKeys only for states that are *not yet* terminal. The UI predicate `reachSet.has(irrKey(postClickState))` is correct because the browser never asks a question from a terminal state.
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
├── engine.js                      ← state machine — selection, resolution, display order
├── graph-walker.js                ← DFS walker, equivalence classes, irrelevance, superposition
├── precompute-reachability.js    ← builds per-outcome reach sets into data/reach/
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
