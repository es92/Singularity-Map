# Singularity Map — Project Spec

## Overview

Singularity Map is an interactive, choose-your-own-adventure experience that guides users through a branching questionnaire about the future of AI. Based on the choices they make, users arrive at one of many possible "AI futures" — each rendered as a short narrative story paired with a visual timeline of key events.

---

## Core Concepts

### 1. Dimensions

The questionnaire collects a set of **dimensions** — the key variables that define an AI future. Each question sets one or more dimension values based on the user's answer.

| Dimension | Values | Source Question |
|---|---|---|
| `capability` | `singularity`, `hours`, `days`, `weeks`, `months` | scaling-continues, where-tops-out |
| `takeoff` | `gradual`, `hard` | takeoff-speed |
| `distribution` | `open`, `lagging`, `concentrated`, `monopoly` | who-controls (or implicitly set by hard takeoff) |
| `alignment` | `solved`, `failed` | alignment |
| `containment` | `contained`, `escaped` | ai-containment |
| `power_structure` | `monopoly`, `oligopoly`, `distributed`, `international` | power-structure |
| `intent` | `flourishing`, `self_interest`, `coexistence`, `rivalry`, `escalation` | controller-intent |
| `economic_speed` | `rapid`, `steady`, `uneven` | economic-speed |
| `failure_mode` | `entrench`, `whimper`, `disempowerment` | contained-failure |
| `ai_goals` | `benevolent`, `alien_coexistence`, `alien_extinction`, `paperclip`, `swarm` | escaped-ai-goals |

Not every path sets every dimension — only the dimensions relevant to that branch.

### 2. Outcome Templates

Instead of fixed outcomes, the system uses **parameterized templates**. Each template defines:

- **ID** — unique identifier (e.g. `"the-flourishing"`)
- **Primary Dimension** *(optional)* — the dimension that selects the variant
- **Variants** — a map from dimension values to variant-specific title, mood, and summary
- **Flavors** *(optional)* — dimension-keyed additional context paragraphs that customize the outcome based on other dimensions (e.g., how open-source distribution flavors a flourishing outcome)
- **Story** — shared narrative paragraphs (will be parameterized when stories are written)
- **Timeline** — shared timeline events (will be parameterized when timelines are written)

Templates without variants (e.g. `the-mosaic`) are standalone outcomes with direct title/mood/summary fields.

**Current templates:** 9 templates → 20 outcome variants.

### 3. Question Tree (Decision Graph)

The questionnaire is a DAG of questions, where each answer either leads to another question or terminates at an outcome template.

Each **question node** consists of:

- **ID** — unique identifier
- **Text** — the question itself
- **Context** *(optional)* — background/framing
- **Source** *(optional)* — citation with label and URL
- **Dimension** — which dimension this question sets
- **Answers** — an ordered list of 2–4 choices, each with:
  - `label` — short answer text
  - `description` *(optional)* — clarifying detail
  - `value` *(optional)* — the dimension value this answer sets (for the question's `dimension`)
  - `sets` *(optional)* — object of dimension→value pairs, for answers that set multiple dimensions (overrides `value`)
  - `next` — ID of the next question or outcome template

Some answers use `sets` to set multiple dimensions at once (e.g., hard takeoff sets both `takeoff: "hard"` and `distribution: "monopoly"`, skipping the open-source question).

### 4. Data Format

All content lives in **data files** (JSON), separate from the renderer:

```
data/
  outcomes.json    — array of outcome templates (with variants and flavors)
  questions.json   — question DAG (with dimension annotations)
```

The HTML/JS renderer reads these files, collects dimensions as users answer, resolves templates to specific variants, and renders outcomes with dimension-appropriate flavor text.

---

## Key Question Axes (Brainstorm)

These are the major dimensions / branching factors the question tree should explore:

| Axis | Example Question |
|---|---|
| **Capability trajectory** | Does AI capability keep doubling at the current projected rate? |
| **Scaling wall** | If progress slows, where does it stall — reasoning? robotics? generality? |
| **Open-source parity** | Does open-source keep pace with frontier labs? |
| **Geopolitical race** | Does China keep pace with (or surpass) the US? |
| **Alignment / safety** | Are alignment techniques solved before superhuman AI arrives? |
| **Regulation** | Do governments successfully regulate AI development? |
| **Economic disruption** | How fast does AI displace jobs — gradual transition or sudden shock? |
| **Concentration of power** | Does AI consolidate power in a few actors, or distribute it? |
| **Agency / autonomy** | Do AI agents gain significant real-world autonomy? |
| **Public trust** | Does public trust in AI increase, hold, or collapse? |

Not every axis needs its own question — some are implied by combinations. The tree should feel like ~5–10 questions deep on any given path.

---

## Renderer (index.html)

The front-end is a single `index.html` file (with inline or co-located CSS/JS) that:

1. **Loads** `data/outcomes.json` and `data/questions.json` at startup
2. **Presents** the questionnaire one question at a time, with smooth transitions
3. **Tracks** the user's path through the tree
4. **Renders the outcome** when a leaf node is reached:
   - Display the story
   - Display the timeline (visual, scrollable)
   - Show a summary of the choices that led here
   - Offer a "Start Over" / "Go Back" option
5. **Provides a gallery/index view** where users can browse all possible futures (spoiler mode)

### UI Principles

- Clean, modern, slightly futuristic aesthetic
- Dark mode by default, light mode toggle
- Mobile-responsive
- No build step — vanilla HTML/CSS/JS (or a single-file framework if warranted)
- Animated transitions between questions
- Timeline rendered as a vertical or horizontal scrollable strip with event cards

### No Server Required

Everything is static. Can be opened as a local file or served from any static host (GitHub Pages, Netlify, etc.).

---

## Data Pipeline (How We'll Build Content)

1. **Define axes** — finalize the list of branching dimensions
2. **Sketch the tree** — map out the question graph on paper / in a diagram
3. **Write questions** — author each question node with its answers and links
4. **Enumerate outcomes** — identify every leaf of the tree
5. **Write outcomes** — author the story + timeline for each future
6. **Validate** — ensure every answer path terminates at a valid outcome, no orphan nodes, no cycles
7. **Render** — plug it all into the HTML renderer

---

## File Structure

```
Singularity Map/
├── SPEC.md              ← this file
├── index.html           ← renderer (reads data/, presents UI)
├── data/
│   ├── outcomes.json    ← all AI future outcomes
│   └── questions.json   ← the question DAG
└── assets/              ← optional images, icons, fonts
```

---

## Decisions (Resolved)

- **How many outcomes?** Uncapped. Could be 50+ including all variations. We won't artificially limit this — let the tree's natural branching determine how many futures exist.
- **Shared sub-paths?** Yes. Multiple question branches can converge on the same outcome (e.g. different reasoning paths both lead to "AI Winter"). The DAG supports this naturally.
- **Scoring vs. pathing?** Pure pathing. Each answer leads to a specific next question or directly to an outcome. True choose-your-own-adventure style — no scoring, no axis accumulation.
- **Replayability?** Yes. Track discovered futures in localStorage. Show a progress/collection screen so users can try to find them all.
- **Sharability?** Yes. Encode the path/outcome in the URL hash so users can share direct links to their result. Outcomes are also directly browsable from a gallery/index view.
- **Browsable outcomes?** Yes. In addition to the questionnaire path, users can browse all outcomes directly from a gallery view (spoiler mode).
- **Question depth per path?** Varies. Some paths are short (3–5 questions), some are long (8–12). Depends on how much branching a given trajectory needs.
- **Answers per question?** 2–4, flexible per question. Some are clean binary splits, others warrant 3 or 4 options.
- **Tone?** A blend — conversational enough to be accessible, journalistic enough to feel authoritative, with enough precision to not be hand-wavy. Not dry academic, not flippant.
- **Timeline range?** Flexible per outcome. Some futures resolve by 2030, others play out through 2100. The timeline fits the story.
- **Story POV?** TBD — will emerge as we write. Questions themselves will be framed as "Do you think that..." style, asking the user for their belief/prediction.
- **Back button?** Yes. Full back navigation — users can revisit and change any previous answer, which updates the path forward accordingly.

---

## Next Steps

1. ✅ Create this spec
2. Design the question tree structure (axes, branching, depth)
3. Author the questions and outcomes data files
4. Build the index.html renderer
5. Polish and iterate
