#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { NODES, NODE_MAP } = require('../graph.js');
const Engine = require('../engine.js');

const outcomes = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'outcomes.json'), 'utf8'));
const narrative = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'narrative.json'), 'utf8'));
const personas = JSON.parse(fs.readFileSync(path.join(__dirname, 'personas.json'), 'utf8'));

const templatesList = outcomes.templates;

const EVAL_MODEL = process.env.EVAL_MODEL || 'claude-haiku-4-5-20250315';
const REVIEW_MODEL = process.env.REVIEW_MODEL || 'claude-sonnet-4-6-20250627';
const REPORT_MODEL = process.env.REPORT_MODEL || 'claude-sonnet-4-6-20250627';

// ── Conditional flavor resolution (mirrors index.html) ──

function resolveConditionalText(entry, state) {
    if (typeof entry === 'string') return entry;
    if (entry && typeof entry === 'object' && entry._default) {
        if (entry._when) {
            for (const cond of entry._when) {
                const match = Object.entries(cond.if).every(
                    ([k, vals]) => vals.includes(state[k])
                );
                if (match) return cond.text;
            }
        }
        return entry._default;
    }
    return null;
}

function resolveHeading(nodeId, val, flavorHeadings) {
    if (flavorHeadings && flavorHeadings[nodeId]) {
        const h = flavorHeadings[nodeId];
        if (typeof h === 'string') return h;
        if (h[val]) return h[val];
    }
    const node = NODE_MAP[nodeId];
    return node ? node.label : nodeId;
}

const MODE_INSTRUCTIONS = {
    want: `This is WANT mode. You are expressing what this persona would PREFER — their ideal outcome, not their prediction.

Think step by step: What does this persona dream about? What outcome would they celebrate? Score THAT highest.

- If the question is about a factual outcome (alignment, capability, speed of progress), rate the option this persona would MOST HOPE is true — not what they think is likely.
- If the question is about a policy choice (governance, open source, distribution), rate the option this persona would ADVOCATE for.

Rate each option from 1 to 100 based on how much the persona would WANT it to happen. This is about desire, values, and hopes — NOT about realism or probability. A safety researcher should rate "alignment works" very high even if they think it's unlikely. An optimist should rate positive outcomes near 100. A nationalist should rate outcomes that favor their country near 100.

Do NOT let your assessment of what is "realistic" influence the scores. This is purely about preference intensity.

Return a JSON object mapping each option ID to a whole number between 1 and 100. Return ONLY the JSON object, no other text.`,

    likely: 'For each option, estimate the probability that this persona would judge it MOST LIKELY to actually happen — i.e., their honest prediction, regardless of what they want.'
};

const MODE_RESPONSE_FORMATS = {
    want: 'Return a JSON object mapping each option ID to a desirability score from 1 to 100. Return ONLY the JSON object, no other text.',
    likely: 'Return a JSON object mapping each option ID to a probability (0.0-1.0). Probabilities must sum to 1.0. Return ONLY the JSON object, no other text.'
};

// ── CLI args ──

const args = process.argv.slice(2);
function getArg(flag, fallback) {
    const idx = args.indexOf(flag);
    return idx >= 0 && args[idx + 1] ? args[idx + 1] : fallback;
}
const K = parseInt(getArg('--k', '3'), 10);
const ONLY_PERSONA = getArg('--persona', null);
const MODE_ARG = getArg('--mode', 'both');
const CONCURRENCY = parseInt(getArg('--concurrency', '10'), 10);
const GENERATE_REPORT = args.includes('--report');
const REPORT_ONLY = args.includes('--report-only');
const AUDIT_MODE = args.includes('--audit');
const modes = MODE_ARG === 'both' ? ['want', 'likely'] : [MODE_ARG];

// ── Anthropic client ──

let Anthropic;
let client;

function initClient() {
    if (client) return;
    try {
        Anthropic = require('@anthropic-ai/sdk');
    } catch {
        console.error('Missing dependency: npm install @anthropic-ai/sdk');
        process.exit(1);
    }
    if (!process.env.ANTHROPIC_API_KEY) {
        console.error('Missing ANTHROPIC_API_KEY in .env');
        process.exit(1);
    }
    client = new Anthropic.default({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 20 * 60 * 1000 });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Token-bucket rate limiter — controls API calls per second across all workers
const MIN_INTERVAL_MS = parseInt(process.env.API_MIN_INTERVAL_MS || '100', 10);
let _lastCallTime = 0;
let _callQueue = Promise.resolve();

function acquireSlot() {
    _callQueue = _callQueue.then(async () => {
        const now = Date.now();
        const elapsed = now - _lastCallTime;
        if (elapsed < MIN_INTERVAL_MS) {
            await sleep(MIN_INTERVAL_MS - elapsed);
        }
        _lastCallTime = Date.now();
    });
    return _callQueue;
}

async function callClaude(model, system, user, maxTokens = 256, { prefill } = {}) {
    initClient();
    const MAX_RETRIES = 6;
    let backoff = 2000;

    const messages = [{ role: 'user', content: user }];
    if (prefill) messages.push({ role: 'assistant', content: prefill });

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        await acquireSlot();
        try {
            const resp = await client.messages.create({
                model,
                max_tokens: maxTokens,
                temperature: 0,
                system,
                messages,
            });
            const text = resp.content[0].text.trim();
            return prefill ? prefill + text : text;
        } catch (err) {
            const status = err?.status || err?.error?.status;
            if (status === 429 && attempt < MAX_RETRIES) {
                const headers = err?.headers || err?.error?.headers || {};
                const retryAfter = headers['retry-after'];
                const waitMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : backoff;
                console.log(`  ⚠ Rate limited (429) — waiting ${Math.round(waitMs / 1000)}s (retry ${attempt + 1}/${MAX_RETRIES})`);
                await sleep(waitMs + Math.random() * 1000);
                backoff = Math.min(backoff * 2, 60_000);
                continue;
            }
            if (status === 529 && attempt < MAX_RETRIES) {
                console.log(`  ⚠ Overloaded (529) — waiting ${Math.round(backoff / 1000)}s before retry ${attempt + 1}/${MAX_RETRIES}`);
                await sleep(backoff + Math.random() * 1000);
                backoff = Math.min(backoff * 2, 60_000);
                continue;
            }
            throw err;
        }
    }
}

// ── Narrative helpers ──

function getQuestionText(nodeId) {
    const n = narrative[nodeId];
    return n?.questionText || NODE_MAP[nodeId]?.label || nodeId;
}

function getQuestionContext(nodeId, sel) {
    const narr = narrative[nodeId];
    if (!narr) return '';
    if (sel && narr.contextWhen) return Engine.resolveContextWhen(sel, narr);
    return narr.questionContext || '';
}

function resolveNarrativeVariant(variants, sel) {
    if (!variants || !sel) return null;
    for (const v of variants) {
        if (!v.when) return v;
        const match = Object.entries(v.when).every(([nodeId, vals]) =>
            sel[nodeId] && vals.includes(sel[nodeId])
        );
        if (match) return v;
    }
    return null;
}

function getAnswerLabel(nodeId, edgeId, sel) {
    const n = narrative[nodeId];
    if (n?.values?.[edgeId]) {
        const val = n.values[edgeId];
        if (sel && val.narrativeVariants) {
            const variant = resolveNarrativeVariant(val.narrativeVariants, sel);
            if (variant?.answerLabel) return variant.answerLabel;
        }
        if (val.answerLabel) return val.answerLabel;
    }
    const node = NODE_MAP[nodeId];
    const edge = node?.edges?.find(e => e.id === edgeId);
    return edge?.label || edgeId;
}

function getAnswerDesc(nodeId, edgeId, sel) {
    const n = narrative[nodeId];
    if (n?.values?.[edgeId]) {
        const val = n.values[edgeId];
        if (sel && val.narrativeVariants) {
            const variant = resolveNarrativeVariant(val.narrativeVariants, sel);
            if (variant?.answerDesc) return variant.answerDesc;
        }
        return val.answerDesc || '';
    }
    return '';
}

// ── JSON parsing (robust) ──

function parseJsonResponse(raw) {
    const cleaned = raw.replace(/```json\n?/g, '').replace(/```/g, '').trim();
    try {
        return JSON.parse(cleaned);
    } catch {
        const objMatch = cleaned.match(/\{[\s\S]*\}/);
        if (objMatch) return JSON.parse(objMatch[0]);
        const arrMatch = cleaned.match(/\[[\s\S]*\]/);
        if (arrMatch) return JSON.parse(arrMatch[0]);
        throw new Error('No JSON found in response: ' + cleaned.slice(0, 100));
    }
}

// ── Probability sampling ──

function sampleFromDistribution(probs) {
    const entries = Object.entries(probs);
    const total = entries.reduce((s, [, p]) => s + p, 0);
    let r = Math.random() * total;
    for (const [id, p] of entries) {
        r -= p;
        if (r <= 0) return id;
    }
    return entries[entries.length - 1][0];
}

// ── Template resolution ──

function resolveTemplate(templateId, state) {
    const t = templatesList.find(tt => tt.id === templateId);
    if (!t) return null;

    let variantKey = null, subtitle = t.subtitle || null, mood = t.mood, summary = t.summary;
    if (t.variants && t.primaryDimension) {
        variantKey = state[t.primaryDimension];
        const variant = variantKey ? t.variants[variantKey] : null;
        if (variant) {
            subtitle = variant.subtitle;
            mood = variant.mood || t.mood;
            summary = variant.summary;
        } else {
            const first = Object.entries(t.variants)[0];
            if (first) {
                variantKey = first[0];
                subtitle = first[1].subtitle;
                mood = first[1].mood || t.mood;
                summary = first[1].summary;
            }
        }
    }

    const vignettes = [];
    if (t.flavors) {
        for (const [nodeId, options] of Object.entries(t.flavors)) {
            const val = state[nodeId];
            if (!val || !options[val]) continue;
            const text = resolveConditionalText(options[val], state);
            if (!text) continue;
            const heading = resolveHeading(nodeId, val, t.flavorHeadings);
            vignettes.push({ key: nodeId, val, heading, text });
        }
    }

    return { title: t.title, subtitle, mood, summary, variantKey, vignettes };
}

// ── DAG walking ──

async function simulatePath(persona, mode, { deterministic = false } = {}) {
    const sel = { _locked: {} };
    const log = [];
    let apiCalls = 0;
    const pathContext = [];

    const loggedNodes = new Set();

    for (let pass = 0; pass < 500; pass++) {
        const prevLocked = sel._locked ? { ...sel._locked } : {};
        Engine.cleanSelection(sel);
        let acted = false;

        for (const node of NODES) {
            if (node.derived) continue;
            if (!Engine.isNodeVisible(sel, node)) continue;
            if (!sel._locked || !sel._locked[node.id]) continue;
            if (prevLocked[node.id]) continue;
            if (loggedNodes.has(node.id)) continue;

            loggedNodes.add(node.id);
            const val = sel[node.id];
            const disabledReasons = [];
            for (const edge of node.edges) {
                const reason = Engine.getEdgeDisabledReason(sel, node, edge);
                if (reason) disabledReasons.push({ id: edge.id, label: getAnswerLabel(node.id, edge.id, sel), reason });
            }

            log.push({ id: node.id, label: node.label, val, prob: 1.0, source: 'auto', disabledReasons });

            if (disabledReasons.length > 0) {
                let ctx = `- ${getQuestionText(node.id)}: ${getAnswerLabel(node.id, val, sel)} [only option — previous choices ruled out the rest]`;
                for (const d of disabledReasons) {
                    ctx += `\n    ✗ "${d.label}" unavailable: ${d.reason}`;
                }
                pathContext.push(ctx);
            } else {
                pathContext.push(`- ${getQuestionText(node.id)}: ${getAnswerLabel(node.id, val, sel)} [auto-locked]`);
            }
            acted = true;
        }

        for (const node of NODES) {
            if (node.derived) continue;
            if (!Engine.isNodeVisible(sel, node)) continue;
            if (sel[node.id]) continue;

            const enabledEdges = node.edges.filter(e => !Engine.isEdgeDisabled(sel, node, e));
            if (enabledEdges.length === 0) continue;

            const optionsText = enabledEdges.map(e => {
                const label = getAnswerLabel(node.id, e.id, sel);
                const desc = getAnswerDesc(node.id, e.id, sel);
                return `- ${e.id}: "${label}"${desc ? ' — ' + desc : ''}`;
            }).join('\n');

            const disabledEdges = node.edges.filter(e => Engine.isEdgeDisabled(sel, node, e));
            let disabledText = '';
            if (disabledEdges.length > 0) {
                const lines = disabledEdges.map(e => {
                    const label = getAnswerLabel(node.id, e.id, sel);
                    const reason = Engine.getEdgeDisabledReason(sel, node, e);
                    return reason
                        ? `- ✗ "${label}" — unavailable: ${reason}`
                        : `- ✗ "${label}" — unavailable`;
                }).join('\n');
                disabledText = `\n\nUnavailable options (ruled out by earlier choices):\n${lines}`;
            }

            const system = `You are roleplaying as ${persona.name}. ${persona.bio}

You are navigating a scenario about the future of AI. At each step, you will be given a question with available options. Some options may be unavailable because of earlier choices — these are shown for context but cannot be selected.

${MODE_INSTRUCTIONS[mode]}

${MODE_RESPONSE_FORMATS[mode]}`;

            const wantFraming = mode === 'want'
                ? 'Imagine your ideal scenario — the best realistic version of events from this persona\'s perspective.\n\n'
                : '';
            const user = `${pathContext.length > 0 ? 'Choices made so far:\n' + pathContext.join('\n') + '\n\n---\n\n' : ''}${wantFraming}**${getQuestionText(node.id)}**

${getQuestionContext(node.id, sel)}

Available options:
${optionsText}${disabledText}`;

            let weights;
            try {
                const raw = await callClaude(EVAL_MODEL, system, user, 256, { prefill: '{' });
                apiCalls++;
                weights = parseJsonResponse(raw);
            } catch (err) {
                console.error(`  API error at ${node.id}: ${err.message}, falling back to uniform`);
                weights = {};
                for (const e of enabledEdges) weights[e.id] = 1.0 / enabledEdges.length;
            }

            const validProbs = {};
            for (const e of enabledEdges) {
                validProbs[e.id] = Math.max(weights[e.id] || 0, 0.01);
            }
            if (mode === 'want') {
                for (const k of Object.keys(validProbs)) validProbs[k] = Math.pow(validProbs[k], 3);
            }
            const total = Object.values(validProbs).reduce((s, p) => s + p, 0);
            for (const k of Object.keys(validProbs)) validProbs[k] /= total;

            const chosen = deterministic
                ? Object.entries(validProbs).reduce((a, b) => b[1] > a[1] ? b : a)[0]
                : sampleFromDistribution(validProbs);
            sel[node.id] = chosen;
            log.push({
                id: node.id, label: node.label, val: chosen,
                prob: validProbs[chosen], probs: validProbs, source: 'llm'
            });
            pathContext.push(`- ${getQuestionText(node.id)}: ${getAnswerLabel(node.id, chosen, sel)}`);
            acted = true;
            break;
        }
        if (!acted) break;
    }

    Engine.cleanSelection(sel);

    const eff = Engine.resolvedState(sel);
    const matched = templatesList.filter(t => Engine.templateMatches(t, eff));
    const template = matched.length > 0 ? matched[0] : null;
    const resolved = template ? resolveTemplate(template.id, eff) : null;

    return { log, sel, eff, template, resolved, apiCalls };
}

// ── Persona review ──

async function getPersonaReview(persona, mode, log, resolved) {
    const choicesText = log.map((l, i) => {
        if (l.source === 'auto' && l.disabledReasons && l.disabledReasons.length > 0) {
            let text = `${i + 1}. "${getQuestionText(l.id)}" → ${getAnswerLabel(l.id, l.val)} [only option — previous choices ruled out:]`;
            for (const d of l.disabledReasons) {
                text += `\n     ✗ "${d.label}": ${d.reason}`;
            }
            return text;
        }
        const probStr = l.source === 'llm' ? ` (your probability: ${l.prob.toFixed(2)})` : ' [auto]';
        return `${i + 1}. "${getQuestionText(l.id)}" → ${getAnswerLabel(l.id, l.val)}${probStr}`;
    }).join('\n');

    let outcomeText = 'NO OUTCOME MATCHED';
    if (resolved) {
        outcomeText = `**${resolved.title}`;
        if (resolved.subtitle) outcomeText += ` — ${resolved.subtitle}`;
        outcomeText += `** (${resolved.mood})\n\n${resolved.summary}`;
        if (resolved.vignettes.length > 0) {
            outcomeText += '\n\n**Narrative Vignettes:**\n';
            for (const v of resolved.vignettes) {
                outcomeText += `\n**${v.heading}** — ${v.text}`;
            }
        }
    }

    const modeLabel = mode === 'want' ? 'what you would want' : 'what you think is likely';

    const system = `You are ${persona.name}. ${persona.bio}

You just completed an interactive scenario about the future of AI. You will be shown the questions you were asked, the choices that were made, and the outcome you reached. Stay in character and respond with honest reactions as this persona.`;

    const user = `Mode: ${mode} (${modeLabel})

Questions and choices:
${choicesText}

Outcome reached:
${outcomeText}

---

Respond in JSON with these fields:
- satisfaction (1-5): How satisfied are you with this outcome as a representation of ${modeLabel}?
- accuracy (1-5): How accurately did the questions and options capture the considerations that matter to you?
- missing_questions: Questions you wish had been asked but weren't. (array of strings, can be empty)
- forced_choices: Any questions where none of the available options felt right. (array of objects with "question" and "complaint" fields, can be empty)
- outcome_reaction: 2-3 sentences reacting to the outcome — does it feel like a fair conclusion from the choices made?
- narrative_contradictions: List any vignettes where the text contradicts or doesn't match the choices you made. For each, cite the vignette heading and explain the mismatch. (array of objects with "heading" and "issue" fields, can be empty)

Return ONLY the JSON object.`;

    try {
        const raw = await callClaude(REVIEW_MODEL, system, user, 1024);
        return parseJsonResponse(raw);
    } catch (err) {
        console.error(`  Review API error: ${err.message}`);
        return { satisfaction: 0, accuracy: 0, missing_questions: [], forced_choices: [], outcome_reaction: 'Error generating review.', narrative_contradictions: [] };
    }
}

// ── Markdown generation ──

function buildEvaluationMd(persona, mode, runNum, result, review) {
    const { log, template, resolved, apiCalls } = result;
    const modeDesc = mode === 'want' ? 'What they would choose' : 'What they think will happen';

    let md = `# ${persona.name} — ${mode} — Run ${runNum}\n\n`;
    md += `*${persona.bio}*\n\n`;
    md += `**Mode:** ${mode} — "${modeDesc}"\n\n`;

    md += `## Path\n\n`;
    md += `| Question | Choice | Probability | Source |\n|---|---|---|---|\n`;
    for (const l of log) {
        md += `| ${l.label} | ${l.val} | ${l.prob.toFixed(2)} | ${l.source} |\n`;
    }
    md += '\n';

    const forcedSteps = log.filter(l => l.disabledReasons && l.disabledReasons.length > 0);
    if (forcedSteps.length > 0) {
        md += `## Forced Choices (from earlier decisions)\n\n`;
        for (const l of forcedSteps) {
            md += `**${l.label}** → \`${l.val}\` (only option)\n`;
            for (const d of l.disabledReasons) {
                md += `- ✗ "${d.label}": ${d.reason}\n`;
            }
            md += '\n';
        }
    }

    const llmSteps = log.filter(l => l.probs);
    if (llmSteps.length > 0) {
        md += `## Full Distributions\n\n`;
        for (const l of llmSteps) {
            md += `**${l.label}** → chose \`${l.val}\`\n`;
            const sorted = Object.entries(l.probs).sort((a, b) => b[1] - a[1]);
            for (const [optId, p] of sorted) {
                const marker = optId === l.val ? ' ◀' : '';
                md += `- \`${optId}\`: ${(p * 100).toFixed(1)}%${marker}\n`;
            }
            md += '\n';
        }
    }

    md += `## Outcome Card\n\n`;
    if (resolved) {
        md += `> **${resolved.title}`;
        if (resolved.subtitle) md += ` — ${resolved.subtitle}`;
        md += `** *(${resolved.mood})*\n>\n`;
        md += `> ${resolved.summary}\n>\n> ---\n`;
        if (resolved.vignettes.length > 0) {
            for (const v of resolved.vignettes) {
                md += `>\n> **${v.heading}** — ${v.text}\n`;
            }
        }
    } else {
        md += `**NO OUTCOME MATCHED**\n`;
    }
    md += '\n';

    md += `## Persona Review\n\n`;
    md += `- **Satisfaction:** ${review.satisfaction}/5\n`;
    md += `- **Question Accuracy:** ${review.accuracy}/5\n`;
    md += `- **Outcome Reaction:** "${review.outcome_reaction}"\n`;
    if (review.missing_questions && review.missing_questions.length > 0) {
        md += `- **Missing Questions:**\n`;
        for (const q of review.missing_questions) md += `  - ${q}\n`;
    } else {
        md += `- **Missing Questions:** None\n`;
    }
    if (review.forced_choices && review.forced_choices.length > 0) {
        md += `- **Forced Choices:**\n`;
        for (const fc of review.forced_choices) md += `  - ${fc.question}: ${fc.complaint}\n`;
    } else {
        md += `- **Forced Choices:** None\n`;
    }
    if (review.narrative_contradictions && review.narrative_contradictions.length > 0) {
        md += `- **Narrative Contradictions:**\n`;
        for (const nc of review.narrative_contradictions) md += `  - **${nc.heading}**: ${nc.issue}\n`;
    } else {
        md += `- **Narrative Contradictions:** None\n`;
    }
    md += '\n';

    md += `## Metadata\n\n`;
    md += `- Template: ${template ? template.id : 'none'}\n`;
    md += `- Variant: ${resolved?.variantKey || 'n/a'}\n`;
    md += `- Mode: ${mode}\n`;
    const vignetteCount = resolved ? resolved.vignettes.length : 0;
    md += `- Vignettes: ${vignetteCount}\n`;
    md += `- API calls: ${apiCalls + 1} (including review)\n`;

    return md;
}

// ── Report generation ──

async function generateReport(allResults) {
    let summaryRows = [];
    let reviewsText = '';

    for (const r of allResults) {
        summaryRows.push(`| ${r.persona} | ${r.mode} | ${r.run} | ${r.outcome} | ${r.mood} | ${r.satisfaction}/5 | ${r.accuracy}/5 |`);
        reviewsText += `### ${r.persona} — ${r.mode} — Run ${r.run}\n`;
        reviewsText += `Outcome: ${r.outcome} (${r.mood})\n`;
        reviewsText += `Satisfaction: ${r.satisfaction}/5, Accuracy: ${r.accuracy}/5\n`;
        reviewsText += `Reaction: ${r.outcomeReaction}\n`;
        if (r.missingQuestions.length > 0) reviewsText += `Missing: ${r.missingQuestions.join('; ')}\n`;
        if (r.forcedChoices.length > 0) reviewsText += `Forced: ${r.forcedChoices.map(f => f.question + ': ' + f.complaint).join('; ')}\n`;
        if (r.narrativeContradictions && r.narrativeContradictions.length > 0) reviewsText += `Contradictions: ${r.narrativeContradictions.map(c => c.heading + ': ' + c.issue).join('; ')}\n`;
        reviewsText += '\n';
    }

    const system = `You are an expert evaluator of an interactive AI futures scenario simulator. Write a concise, actionable report. Avoid restating raw data — focus on patterns and issues.`;

    const user = `## Evaluation Results (${allResults.length} runs, ${new Set(allResults.map(r => r.persona)).size} personas, modes: want & likely)

| Persona | Mode | Run | Outcome | Mood | Sat | Acc |
|---|---|---|---|---|---|---|
${summaryRows.join('\n')}

## Reviews

${reviewsText}

---

Write a report in markdown. Keep it under 2000 words. Sections:

1. **Summary Table** — reproduce the table above, no commentary.
2. **Key Patterns** — 3-5 bullet points on the most important patterns across want vs. likely, persona clusters, and outcome diversity. Note any persona whose want and likely modes consistently diverge.
3. **Low Scores** — list any runs with satisfaction or accuracy below 3. One line each with persona, mode, score, and their complaint.
4. **Recurring Feedback** — aggregate missing_questions and forced_choices. Only list items mentioned by 2+ personas.
5. **Narrative Contradictions** — list every narrative_contradiction reported. Group by vignette heading. These are cases where the outcome text contradicts the choices made.
6. **Issues** — up to 8 concrete problems. Each: one-line description, severity (critical/moderate/minor), affected file, proposed fix.
7. **Top 3 Priorities** — the most impactful changes to make next.

Be specific. Reference node IDs and template names where relevant. Do NOT pad with filler.`;

    try {
        const raw = await callClaude(REPORT_MODEL, system, user, 12000);
        return raw;
    } catch (err) {
        return `# Report Generation Error\n\n${err.message}`;
    }
}

// ── Progress bar ──

function formatDuration(ms) {
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0) return `${h}h ${m}m ${s}s`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
}

function printProgress(completed, total, startTime) {
    const pct = ((completed / total) * 100).toFixed(1);
    const elapsed = Date.now() - startTime;
    const avgPerRun = elapsed / completed;
    const estTotal = avgPerRun * total;
    const remaining = estTotal - elapsed;

    const barWidth = 30;
    const filled = Math.round((completed / total) * barWidth);
    const bar = '█'.repeat(filled) + '░'.repeat(barWidth - filled);

    const line = `  ${bar}  ${completed}/${total} (${pct}%)  ` +
        `Elapsed: ${formatDuration(elapsed)}  ` +
        `Est. total: ${formatDuration(estTotal)}  ` +
        `Remaining: ${formatDuration(remaining)}`;

    console.log(line);
}

// ── Concurrency pool ──

async function runPool(jobs, concurrency, onComplete) {
    let idx = 0;
    const results = new Array(jobs.length);

    async function worker() {
        while (idx < jobs.length) {
            const i = idx++;
            results[i] = await jobs[i]();
            onComplete(results[i], i);
        }
    }

    const workerCount = Math.min(concurrency, jobs.length);
    const workers = Array.from({ length: workerCount }, () => worker());
    await Promise.all(workers);
    return results;
}

// ── Audit mode ──

const CONTEXT_COMBOS = [
    { distribution: 'monopoly', geo_spread: 'one' },
    { distribution: 'open', geo_spread: 'several' },
    { distribution: 'concentrated', geo_spread: 'two' },
];

function generateTestStates(template) {
    const states = [];
    const seen = new Set();

    function addState(s) {
        const key = JSON.stringify(Object.entries(s).filter(([k]) => !k.startsWith('_')).sort());
        if (seen.has(key)) return;
        seen.add(key);
        states.push(s);
    }

    const relevantDims = new Set();
    for (const reachable of template.reachable) {
        for (const k of Object.keys(reachable)) {
            if (k !== '_not') relevantDims.add(k);
        }
    }
    if (template.flavors) {
        for (const options of Object.values(template.flavors)) {
            for (const entry of Object.values(options)) {
                if (entry && typeof entry === 'object' && entry._when) {
                    for (const cond of entry._when) {
                        for (const k of Object.keys(cond.if)) relevantDims.add(k);
                    }
                }
            }
        }
    }

    const useContextCombos = relevantDims.has('distribution') || relevantDims.has('geo_spread');
    const combos = useContextCombos ? CONTEXT_COMBOS : [{}];

    for (const reachable of template.reachable) {
        const base = {};
        for (const [k, vals] of Object.entries(reachable)) {
            if (k === '_not') continue;
            base[k] = Array.isArray(vals) ? vals[0] : vals;
        }

        for (const combo of combos) {
            const flavorEntries = Object.entries(template.flavors);
            const defaultFill = {};
            for (const [dimId, options] of flavorEntries) {
                defaultFill[dimId] = Object.keys(options)[0];
            }

            addState({ ...base, ...defaultFill, ...combo });

            for (const [dimId, options] of flavorEntries) {
                for (const val of Object.keys(options)) {
                    addState({ ...base, ...defaultFill, ...combo, [dimId]: val });
                }
            }
        }
    }

    return states;
}

function describeState(state) {
    return Object.entries(state)
        .filter(([k]) => !k.startsWith('_'))
        .map(([k, v]) => {
            const node = NODE_MAP[k];
            const edge = node?.edges?.find(e => e.id === v);
            return `${node?.label || k}=${edge?.label || v}`;
        })
        .join(', ');
}

async function auditTemplate(model, templateId, testCases) {
    let casesText = '';
    for (let i = 0; i < testCases.length; i++) {
        const tc = testCases[i];
        casesText += `\n--- Test Case ${i + 1} ---\nUser's path: ${describeState(tc.state)}\n\nVignettes shown:\n`;
        for (const v of tc.vignettes) {
            casesText += `- [${v.heading}]: ${v.text}\n`;
        }
    }

    const system = `You are a QA reviewer for a narrative scenario app. Users make choices about the future of AI (distribution model, geographic spread, governance approach, etc.) and receive narrative vignettes describing what happened.

Your job: flag any vignette whose text contradicts or is inconsistent with the user's choices.

Key things to check:
- If distribution=One dominates (monopoly), text should NOT reference "some labs," "multiple actors," "different jurisdictions," etc.
- If Countries=One country, text should NOT reference "nations," "developing economies," "wealthy nations," "international," "geopolitical," etc.
- If distribution=Distributed (open), text should NOT imply a single controlling entity.
- Governance text should match the governance approach in the state.
- Physical world text should match the geographic context.

Only flag genuine contradictions — not minor style issues. Be specific about what contradicts what.`;

    const user = `Template: ${templateId}

${casesText}

---

For each contradiction found, return a JSON array. Each entry: { "case": <number>, "heading": "<vignette heading>", "issue": "<what contradicts what>" }

If no contradictions, return an empty array: []

Return ONLY the JSON array.`;

    try {
        const raw = await callClaude(model, system, user, 4096);
        const parsed = parseJsonResponse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
        console.error(`  Audit API error for ${templateId}: ${err.message}`);
        return [];
    }
}

async function runAudit() {
    initClient();
    const AUDIT_MODEL = process.env.AUDIT_MODEL || REVIEW_MODEL;
    console.log(`\nRunning flavor text consistency audit...`);
    console.log(`Model: ${AUDIT_MODEL}\n`);

    const allIssues = [];

    for (const template of templatesList) {
        if (!template.flavors || !template.reachable) continue;
        process.stdout.write(`  ${template.id}...`);

        const testStates = generateTestStates(template);
        const testCases = [];
        const seenVignettes = new Set();
        for (const state of testStates) {
            const resolved = resolveTemplate(template.id, state);
            if (!resolved || resolved.vignettes.length === 0) continue;
            const vigKey = resolved.vignettes.map(v => `${v.heading}:${v.text}`).join('|')
                + '||' + (state.distribution || '') + '|' + (state.geo_spread || '');
            if (seenVignettes.has(vigKey)) continue;
            seenVignettes.add(vigKey);
            testCases.push({ state, vignettes: resolved.vignettes });
        }

        if (testCases.length === 0) {
            console.log(' no test cases');
            continue;
        }

        const MAX_CASES_PER_CALL = 20;
        let templateIssues = [];

        for (let i = 0; i < testCases.length; i += MAX_CASES_PER_CALL) {
            const batch = testCases.slice(i, i + MAX_CASES_PER_CALL);
            const issues = await auditTemplate(AUDIT_MODEL, template.id, batch);
            for (const issue of issues) {
                templateIssues.push({
                    template: template.id,
                    case: issue.case,
                    state: batch[issue.case - 1]?.state || {},
                    heading: issue.heading,
                    issue: issue.issue
                });
            }
        }

        if (templateIssues.length > 0) {
            allIssues.push(...templateIssues);
            console.log(` ${templateIssues.length} issues across ${testCases.length} test cases`);
        } else {
            console.log(` clean (${testCases.length} test cases)`);
        }
    }

    console.log(`\n--- Audit Summary ---`);
    console.log(`Total issues: ${allIssues.length}`);

    if (allIssues.length > 0) {
        console.log(`\nIssues by template:`);
        const byTemplate = {};
        for (const issue of allIssues) {
            if (!byTemplate[issue.template]) byTemplate[issue.template] = [];
            byTemplate[issue.template].push(issue);
        }
        for (const [tid, issues] of Object.entries(byTemplate)) {
            console.log(`\n  ${tid} (${issues.length}):`);
            for (const issue of issues) {
                const stateStr = describeState(issue.state);
                console.log(`    - [${issue.heading}] ${issue.issue}`);
                console.log(`      State: ${stateStr}`);
            }
        }
    }

    const reportPath = path.join(__dirname, 'audit-report.json');
    fs.writeFileSync(reportPath, JSON.stringify(allIssues, null, 2));
    console.log(`\nFull report: ${reportPath}`);
}

// ── Main ──

async function main() {
    const evalsDir = path.join(__dirname, 'evaluations');
    if (fs.existsSync(evalsDir)) {
        fs.rmSync(evalsDir, { recursive: true });
    }
    fs.mkdirSync(evalsDir, { recursive: true });

    const targetPersonas = ONLY_PERSONA
        ? personas.filter(p => p.id === ONLY_PERSONA)
        : personas;

    if (targetPersonas.length === 0) {
        console.error(`Persona "${ONLY_PERSONA}" not found`);
        process.exit(1);
    }

    const jobs = [];
    for (const persona of targetPersonas) {
        for (const mode of modes) {
            for (let run = 1; run <= K; run++) {
                jobs.push({ persona, mode, run });
            }
        }
    }

    const totalRuns = jobs.length;
    const effectiveConcurrency = Math.min(CONCURRENCY, totalRuns);

    console.log(`Evaluating ${targetPersonas.length} persona(s), k=${K}, modes: ${modes.join(', ')}`);
    console.log(`Total runs: ${totalRuns}, workers: ${effectiveConcurrency}, min interval: ${MIN_INTERVAL_MS}ms`);
    console.log(`Models: eval=${EVAL_MODEL}, review=${REVIEW_MODEL}${GENERATE_REPORT ? ', report=' + REPORT_MODEL : ''}\n`);

    let completed = 0;
    const startTime = Date.now();

    const jobFns = jobs.map(({ persona, mode, run }) => async () => {
        const isDeterministic = mode === 'want' && run === 1;
        const modeLabel = mode === 'want'
            ? (isDeterministic ? 'want' : 'want (with noise)')
            : mode;
        const label = `${persona.name} — ${modeLabel} — run ${run}/${K}`;

        const result = await simulatePath(persona, mode, { deterministic: isDeterministic });
        const review = await getPersonaReview(persona, mode, result.log, result.resolved);

        const outcomeTitle = result.resolved
            ? `${result.resolved.title}${result.resolved.subtitle ? ' — ' + result.resolved.subtitle : ''}`
            : 'NO MATCH';
        const mood = result.resolved?.mood || 'n/a';

        const md = buildEvaluationMd(persona, mode, run, result, review);
        const filename = `${persona.id}-${mode}-${run}.md`;
        fs.writeFileSync(path.join(evalsDir, filename), md);

        return {
            label, outcomeTitle, mood,
            persona: persona.name,
            personaId: persona.id,
            mode, run,
            outcome: outcomeTitle,
            satisfaction: review.satisfaction,
            accuracy: review.accuracy,
            outcomeReaction: review.outcome_reaction,
            missingQuestions: review.missing_questions || [],
            forcedChoices: review.forced_choices || [],
            narrativeContradictions: review.narrative_contradictions || []
        };
    });

    const allResults = await runPool(jobFns, effectiveConcurrency, (result) => {
        completed++;
        console.log(`  ✓ ${result.label} → ${result.outcomeTitle} (${result.mood}) [sat=${result.satisfaction}, acc=${result.accuracy}]`);
        printProgress(completed, totalRuns, startTime);
    });

    console.log(`\nDone. ${allResults.length} evaluations written to tests/evaluations/`);
    console.log(`Total time: ${formatDuration(Date.now() - startTime)}`);

    fs.writeFileSync(path.join(evalsDir, '_results.json'), JSON.stringify(allResults, null, 2));

    if (GENERATE_REPORT) {
        console.log(`\nGenerating report with ${REPORT_MODEL}...`);
        const report = await generateReport(allResults);
        fs.writeFileSync(path.join(__dirname, 'report.md'), report);
        console.log('Report written to tests/report.md');
    }
}

async function reportOnly() {
    const resultsPath = path.join(__dirname, 'evaluations', '_results.json');
    if (!fs.existsSync(resultsPath)) {
        console.error('No _results.json found. Run evaluations first.');
        process.exit(1);
    }
    const allResults = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
    console.log(`Loaded ${allResults.length} results. Generating report with ${REPORT_MODEL}...`);
    const report = await generateReport(allResults);
    fs.writeFileSync(path.join(__dirname, 'report.md'), report);
    console.log('Report written to tests/report.md');
}

(AUDIT_MODE ? runAudit() : REPORT_ONLY ? reportOnly() : main()).catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
});
