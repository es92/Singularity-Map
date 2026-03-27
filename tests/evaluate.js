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

const FLAVOR_PHASES = {
    'How it happened': [
        'distribution', 'takeoff', 'governance', 'sovereignty',
        'rival_emerges', 'stall_recovery', 'automation_recovery',
        'conflict_result', 'proliferation_outcome'
    ],
    'How society responded': [
        'societal_response', 'capture_confrontation'
    ],
    'What the world looks like': [
        'benefit_distribution', 'plateau_benefit_distribution',
        'auto_benefit_distribution', 'alignment',
        'knowledge_replacement', 'physical_automation',
        'auto_knowledge_rate', 'auto_physical_rate',
        'plateau_knowledge_rate', 'plateau_physical_rate',
        'escape_method', 'escape_timeline'
    ]
};
const KEY_TO_PHASE = {};
for (const [phase, keys] of Object.entries(FLAVOR_PHASES)) {
    for (const k of keys) KEY_TO_PHASE[k] = phase;
}

const MODE_INSTRUCTIONS = {
    want: 'For each option, estimate the probability that this persona would CHOOSE it — i.e., what they would want to happen, given their values, hopes, and goals.',
    likely: 'For each option, estimate the probability that this persona would judge it MOST LIKELY to actually happen — i.e., their honest prediction, regardless of what they want.'
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
const GENERATE_REPORT = args.includes('--report');
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
    client = new Anthropic.default({ apiKey: process.env.ANTHROPIC_API_KEY });
}

async function callClaude(model, system, user, maxTokens = 256) {
    initClient();
    const resp = await client.messages.create({
        model,
        max_tokens: maxTokens,
        temperature: 0,
        system,
        messages: [{ role: 'user', content: user }]
    });
    return resp.content[0].text.trim();
}

// ── Narrative helpers ──

function getQuestionText(nodeId) {
    const n = narrative[nodeId];
    return n?.questionText || NODE_MAP[nodeId]?.label || nodeId;
}

function getQuestionContext(nodeId) {
    return narrative[nodeId]?.questionContext || '';
}

function getAnswerLabel(nodeId, edgeId) {
    const n = narrative[nodeId];
    if (n?.values?.[edgeId]?.answerLabel) return n.values[edgeId].answerLabel;
    const node = NODE_MAP[nodeId];
    const edge = node?.edges?.find(e => e.id === edgeId);
    return edge?.label || edgeId;
}

function getAnswerDesc(nodeId, edgeId) {
    return narrative[nodeId]?.values?.[edgeId]?.answerDesc || '';
}

// ── JSON parsing (robust) ──

function parseJsonResponse(raw) {
    const cleaned = raw.replace(/```json\n?/g, '').replace(/```/g, '').trim();
    try {
        return JSON.parse(cleaned);
    } catch {
        const match = cleaned.match(/\{[\s\S]*\}/);
        if (match) return JSON.parse(match[0]);
        throw new Error('No JSON object found in response: ' + cleaned.slice(0, 100));
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

    const grouped = {};
    if (t.flavors) {
        for (const [nodeId, options] of Object.entries(t.flavors)) {
            if (state[nodeId] && options[state[nodeId]]) {
                const phase = KEY_TO_PHASE[nodeId] || 'What the world looks like';
                if (!grouped[phase]) grouped[phase] = [];
                grouped[phase].push({ key: nodeId, val: state[nodeId], text: options[state[nodeId]] });
            }
        }
    }

    return { title: t.title, subtitle, mood, summary, variantKey, grouped };
}

// ── DAG walking ──

async function simulatePath(persona, mode) {
    const sel = { _locked: {} };
    const log = [];
    let apiCalls = 0;
    const pathContext = [];

    for (let pass = 0; pass < 500; pass++) {
        Engine.cleanSelection(sel);
        let acted = false;

        for (const node of NODES) {
            if (node.derived) continue;
            if (!Engine.isNodeVisible(sel, node)) continue;
            if (sel[node.id]) continue;

            const locked = Engine.isNodeLocked(sel, node);
            if (locked !== null) {
                sel[node.id] = locked;
                if (!sel._locked) sel._locked = {};
                sel._locked[node.id] = true;
                log.push({ id: node.id, label: node.label, val: locked, prob: 1.0, source: 'auto' });
                pathContext.push(`- ${getQuestionText(node.id)}: ${getAnswerLabel(node.id, locked)} [auto-locked]`);
                acted = true;
                break;
            }

            const enabledEdges = node.edges.filter(e => !Engine.isEdgeDisabled(sel, node, e));
            if (enabledEdges.length === 0) continue;

            if (enabledEdges.length === 1) {
                sel[node.id] = enabledEdges[0].id;
                if (!sel._locked) sel._locked = {};
                sel._locked[node.id] = true;
                log.push({ id: node.id, label: node.label, val: enabledEdges[0].id, prob: 1.0, source: 'auto' });
                pathContext.push(`- ${getQuestionText(node.id)}: ${getAnswerLabel(node.id, enabledEdges[0].id)} [auto-locked]`);
                acted = true;
                break;
            }

            const optionsText = enabledEdges.map(e => {
                const label = getAnswerLabel(node.id, e.id);
                const desc = getAnswerDesc(node.id, e.id);
                return `- ${e.id}: "${label}"${desc ? ' — ' + desc : ''}`;
            }).join('\n');

            const system = `You are roleplaying as ${persona.name}. ${persona.bio}

You are navigating a scenario about the future of AI. At each step, you will be given a question with available options.

${MODE_INSTRUCTIONS[mode]}

Return a JSON object mapping each option ID to a probability (0.0-1.0). Probabilities must sum to 1.0. Return ONLY the JSON object, no other text.`;

            const user = `${pathContext.length > 0 ? 'Choices made so far:\n' + pathContext.join('\n') + '\n\n---\n\n' : ''}**${getQuestionText(node.id)}**

${getQuestionContext(node.id)}

Available options:
${optionsText}`;

            let probs;
            try {
                const raw = await callClaude(EVAL_MODEL, system, user);
                apiCalls++;
                probs = parseJsonResponse(raw);
            } catch (err) {
                console.error(`  API error at ${node.id}: ${err.message}, falling back to uniform`);
                probs = {};
                for (const e of enabledEdges) probs[e.id] = 1.0 / enabledEdges.length;
            }

            const validProbs = {};
            for (const e of enabledEdges) {
                validProbs[e.id] = probs[e.id] || 0.01;
            }
            const total = Object.values(validProbs).reduce((s, p) => s + p, 0);
            for (const k of Object.keys(validProbs)) validProbs[k] /= total;

            const chosen = sampleFromDistribution(validProbs);
            sel[node.id] = chosen;
            log.push({
                id: node.id, label: node.label, val: chosen,
                prob: validProbs[chosen], probs: validProbs, source: 'llm'
            });
            pathContext.push(`- ${getQuestionText(node.id)}: ${getAnswerLabel(node.id, chosen)}`);
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
        const probStr = l.source === 'llm' ? ` (your probability: ${l.prob.toFixed(2)})` : ' [auto]';
        return `${i + 1}. "${getQuestionText(l.id)}" → ${getAnswerLabel(l.id, l.val)}${probStr}`;
    }).join('\n');

    let outcomeText = 'NO OUTCOME MATCHED';
    if (resolved) {
        outcomeText = `**${resolved.title}`;
        if (resolved.subtitle) outcomeText += ` — ${resolved.subtitle}`;
        outcomeText += `** (${resolved.mood})\n\n${resolved.summary}`;
        const phaseOrder = Object.keys(FLAVOR_PHASES);
        for (const phase of phaseOrder) {
            const items = resolved.grouped[phase];
            if (!items || items.length === 0) continue;
            outcomeText += `\n\n**${phase.toUpperCase()}**\n`;
            outcomeText += items.map(f => f.text).join('\n\n');
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

Return ONLY the JSON object.`;

    try {
        const raw = await callClaude(REVIEW_MODEL, system, user, 1024);
        return parseJsonResponse(raw);
    } catch (err) {
        console.error(`  Review API error: ${err.message}`);
        return { satisfaction: 0, accuracy: 0, missing_questions: [], forced_choices: [], outcome_reaction: 'Error generating review.' };
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

    md += `## Outcome Card\n\n`;
    if (resolved) {
        md += `> **${resolved.title}`;
        if (resolved.subtitle) md += ` — ${resolved.subtitle}`;
        md += `** *(${resolved.mood})*\n>\n`;
        md += `> ${resolved.summary}\n>\n> ---\n`;
        const phaseOrder = Object.keys(FLAVOR_PHASES);
        for (const phase of phaseOrder) {
            const items = resolved.grouped[phase];
            if (!items || items.length === 0) continue;
            md += `>\n> **${phase.toUpperCase()}**\n>\n`;
            for (const item of items) {
                md += `> ${item.text}\n>\n`;
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
    md += '\n';

    md += `## Metadata\n\n`;
    md += `- Template: ${template ? template.id : 'none'}\n`;
    md += `- Variant: ${resolved?.variantKey || 'n/a'}\n`;
    md += `- Mode: ${mode}\n`;
    const flavorCount = resolved ? Object.values(resolved.grouped).reduce((s, a) => s + a.length, 0) : 0;
    const phaseCount = resolved ? Object.keys(resolved.grouped).length : 0;
    md += `- Flavors: ${flavorCount} across ${phaseCount} phases\n`;
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
        reviewsText += '\n';
    }

    const system = `You are an expert evaluator of an interactive AI futures scenario simulator. You will be given the results of ${allResults.length} evaluation runs across multiple personas and two prompt modes (want = what persona would choose, likely = what persona predicts). Write a thorough analytical report.`;

    const user = `## Evaluation Results

| Persona | Mode | Run | Outcome | Mood | Satisfaction | Accuracy |
|---|---|---|---|---|---|---|
${summaryRows.join('\n')}

## Detailed Reviews

${reviewsText}

---

Write a report in markdown with these sections:

1. **Summary Table** — reproduce the table above
2. **Want vs. Likely Comparison** — for each persona, do the two modes produce different outcomes? Where do they diverge? Are both narratively coherent?
3. **Aggregated Persona Feedback** — what missing questions come up repeatedly? What forced-choice complaints recur? Which evaluations had satisfaction below 3?
4. **Issues Found** — specific narrative problems, template gaps, or inconsistencies. For each: description, severity (critical/moderate/minor), affected file (outcomes.json, graph.js, or narrative.json), proposed fix.
5. **Conclusion** — overall health of the simulator, top priorities for improvement.

Be specific and actionable. Reference template names, flavor keys, and node IDs where relevant.`;

    try {
        const raw = await callClaude(REPORT_MODEL, system, user, 4096);
        return raw;
    } catch (err) {
        return `# Report Generation Error\n\n${err.message}`;
    }
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

    console.log(`Evaluating ${targetPersonas.length} persona(s), k=${K}, modes: ${modes.join(', ')}`);
    console.log(`Models: eval=${EVAL_MODEL}, review=${REVIEW_MODEL}${GENERATE_REPORT ? ', report=' + REPORT_MODEL : ''}\n`);

    const allResults = [];

    for (const persona of targetPersonas) {
        for (const mode of modes) {
            for (let run = 1; run <= K; run++) {
                const label = `${persona.name} — ${mode} — run ${run}/${K}`;
                process.stdout.write(`  ${label}...`);

                const result = await simulatePath(persona, mode);
                const review = await getPersonaReview(persona, mode, result.log, result.resolved);

                const outcomeTitle = result.resolved
                    ? `${result.resolved.title}${result.resolved.subtitle ? ' — ' + result.resolved.subtitle : ''}`
                    : 'NO MATCH';
                const mood = result.resolved?.mood || 'n/a';

                console.log(` → ${outcomeTitle} (${mood}) [sat=${review.satisfaction}, acc=${review.accuracy}]`);

                const md = buildEvaluationMd(persona, mode, run, result, review);
                const filename = `${persona.id}-${mode}-${run}.md`;
                fs.writeFileSync(path.join(evalsDir, filename), md);

                allResults.push({
                    persona: persona.name,
                    personaId: persona.id,
                    mode, run,
                    outcome: outcomeTitle,
                    mood,
                    satisfaction: review.satisfaction,
                    accuracy: review.accuracy,
                    outcomeReaction: review.outcome_reaction,
                    missingQuestions: review.missing_questions || [],
                    forcedChoices: review.forced_choices || []
                });
            }
        }
    }

    console.log(`\nDone. ${allResults.length} evaluations written to tests/evaluations/`);

    if (GENERATE_REPORT) {
        console.log(`\nGenerating report with ${REPORT_MODEL}...`);
        const report = await generateReport(allResults);
        fs.writeFileSync(path.join(__dirname, 'report.md'), report);
        console.log('Report written to tests/report.md');
    }
}

main().catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
});
