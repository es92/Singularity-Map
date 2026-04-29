# AI Singularity Map

**What do you think happens with AI?** Walk through the key questions and see the future your beliefs imply.

[**Try it →**](https://es92.github.io/Singularity-Map/)

~20 questions per path. 28 possible futures. Your choices determine the path.

## What is this?

An interactive choose-your-own-adventure through the future of AI. You answer questions about AI capability, alignment, governance, and power — and the app shows you the future your answers imply, with a narrative timeline of how it unfolds.

Outcomes range from The Flourishing (genuine shared abundance) to The Ruin (civilizational catastrophe), with everything in between: plateaus, captures, standoffs, escapes, and chaos. 13 outcome families branch into 28 distinct variants.

The app also generates personalized vignettes based on your profession and country — how each world event reaches you specifically.

Think of this as a tool for exploring possibilities about AI, not as a source of truth about what will happen. The real world will likely be messier, more surprising, and shaped by factors simple branching can't capture. But we do expect many of these components to appear as AI develops, and mapping how they connect may help you reason about them before they do.

## Running locally

No build step. It's a static site.

```bash
node serve.js
```

Then open `http://localhost:3000`.

## Project structure

```
index.html                    Main app (single-page, all UI logic)
graph.js                      Decision graph — nodes, edges, conditions
engine.js                     State machine — selection, resolution, display order
graph-io.js                   Cartesian read/write enumeration + outcome matching primitives
flow-propagation.js           Topological FLOW_DAG driver shared by validate / explore / precompute
nodes.js                      /nodes view — graph debugger / inspector
explore.js                    /explore view — module/card combinatorics surface
precompute-reachability.js    Builds per-outcome reach sets into data/reach/
timeline-animator.js          Timeline rendering and animation
timeline.css                  All styles
milestone-utils.js            Timeline event grouping helpers
generate-share-assets.js      OG image + share page generator
serve.js                      Local dev server (PORT=3000 default)
validate.js                   Graph integrity checker (run via `npm test`)

data/
  narrative.json        Question text, answer descriptions, timeline events, personal vignettes
  outcomes.json         Outcome templates — titles, flavors, mood, variants
  personal.json         Profession list, country buckets
  reach/                Per-outcome reachability sets (JSON + gzipped)

tests/
  module_primitive.js          Module reducer / exit-plan integration
  module_reads_complete.js     Module reads completeness audit
  post_write_dim_usage.js      Dim writers/readers boundary audit
  premature_outcomes.js        Outcome reachability at every slot
  unreachable_clauses.js       Outcome reachable-clause coverage
  decel_exit_evictions.js      Decel exit-tuple eviction shape
  flow_next_parity.js          FlowPropagation.run vs. flowNext routing parity
  all_variants_reachable.js    Every declared outcome variant is reached
  reach_parity.js              Runtime walk vs. precomputed reach parity
  evaluate.js                  LLM-based evaluation — persona simulation
  personas.json                Test personas for evaluation

research/
  graph-formalization.tex   Formal writeup of the graph, algorithms, reductions
  graph-formalization.pdf

share/                  OG share pages and images for each outcome variant
```

## Analytics

Journey paths and outcomes are logged to a Cloudflare D1 database via a Worker endpoint. Pageview analytics use Cloudflare Web Analytics. No cookies, no personal data collected.

## License

MIT
