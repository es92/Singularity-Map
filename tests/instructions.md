# Singularity Map — Evaluation Instructions

This document explains how to run persona-based evaluations of the Singularity Map simulator and generate a coherence report.

## Prerequisites

1. Install dependencies: `npm install` from the project root
2. Copy `.env.example` to `.env` and add your `ANTHROPIC_API_KEY`
3. Optionally configure models in `.env`:
   - `EVAL_MODEL` — per-question probability calls (default: `claude-haiku-3-5-20241022`)
   - `REVIEW_MODEL` — post-path persona reviews (default: `claude-sonnet-4-20250514`)
   - `REPORT_MODEL` — final report synthesis (default: `claude-sonnet-4-20250514`)

## Step 1 — Generate evaluations and report

```bash
node tests/evaluate.js --k 3 --report
```

Options:
- `--k N` — runs per persona per mode (default 3)
- `--mode want|likely|both` — which prompt modes to run (default `both`)
- `--persona ID` — run only one persona (e.g., `--persona yudkowsky`)
- `--concurrency N` — how many runs to execute in parallel (default 5)
- `--report` — generate `tests/report.md` after all evaluations

This produces:
- One markdown file per persona-mode-run in `tests/evaluations/` (e.g., `yudkowsky-want-1.md`)
- A synthesized report at `tests/report.md` (if `--report` is passed)

## Step 2 — Review the report

Read `tests/report.md`. Focus on:

- **Low satisfaction scores** (below 3/5) — the persona felt the outcome didn't represent their worldview
- **Recurring missing questions** — multiple personas independently flagged the same gap
- **Forced-choice complaints** — questions where none of the options felt right to the persona
- **Want-vs-likely divergences** — where a persona's hopes and predictions produce different outcomes; are both narratives coherent?
- **Empty phases** — outcome cards missing "How it happened", "How society responded", or "What the world looks like" content

## Step 3 — (Optional) Propose and implement fixes

If the report identifies issues, propose specific edits to:
- `data/outcomes.json` — template matching, flavor text, variant summaries
- `graph.js` — node structure, edge conditions, derivation rules
- `data/narrative.json` — question text, answer labels, answer descriptions

After making changes, re-run the evaluations to verify the fixes.

## How it works

For each persona (defined in `tests/personas.json`), the script:

1. **Walks the DAG** node by node using the engine from `engine.js`
2. **At each decision point**, calls the Claude API with:
   - The persona's bio
   - The full path context (all prior choices)
   - The question text and context from `narrative.json`
   - The available options with labels and descriptions
   - A mode-specific instruction ("what would you choose" vs "what do you think will happen")
3. **Claude returns a probability distribution** over the options (e.g., `{"robust": 0.05, "failed": 0.85, "brittle": 0.10}`)
4. **The script samples** from the distribution to make the choice
5. **After the path completes**, the script resolves the outcome template and renders the flavor-grouped outcome card
6. **A review call** asks Claude (still in persona) to rate satisfaction, accuracy, and provide feedback
7. **If `--report` is passed**, a final call synthesizes all results into an analytical report

The `k` runs per persona produce variation because the script samples from probability distributions rather than always picking the most likely option. This surfaces edge cases where low-probability choices produce surprising (or incoherent) outcomes.
