# AI Singularity Map

**What do you think happens with AI?** Walk through the key questions and see the future your beliefs imply.

[**Try it →**](https://es92.github.io/Singularity-Map/)

68 questions. 13 possible outcomes. Your choices determine the path.

## What is this?

An interactive choose-your-own-adventure through the future of AI. You answer questions about AI capability, alignment, governance, and power — and the app shows you the future your answers imply, with a narrative timeline of how it unfolds.

Outcomes range from The Flourishing (genuine shared abundance) to The Ruin (civilizational catastrophe), with everything in between: plateaus, captures, standoffs, escapes, and chaos.

The app also generates personalized vignettes based on your profession and country — how each world event reaches you specifically.

## Running locally

No build step. It's a static site.

```bash
node serve.js
```

Then open `http://localhost:3000`.

## Project structure

```
index.html              Main app (single-page, all UI logic)
graph.js                Decision graph — nodes, edges, conditions
engine.js               State machine — selection, resolution, display order
timeline-animator.js    Timeline rendering and animation
timeline.css            All styles

data/
  narrative.json        Question text, answer descriptions, timeline events, personal vignettes
  outcomes.json         Outcome templates — titles, flavors, mood, variants
  personal.json         Profession list, country buckets

tests/
  evaluate.js           LLM-based evaluation — persona simulation, audits, reports
  personas.json         Test personas for evaluation

validate.js             Graph integrity checker
share/                  OG share pages and images for each outcome
```

## Analytics

Journey paths and outcomes are logged to a Cloudflare D1 database via a Worker endpoint. Pageview analytics use Cloudflare Web Analytics. No cookies, no personal data collected.

## License

MIT
