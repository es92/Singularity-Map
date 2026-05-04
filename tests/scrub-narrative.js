#!/usr/bin/env node

// Anti-AI-tone scrub audit over data/narrative.json + data/outcomes.json.
// For every narrative leaf string, asks Claude to identify AI-tells and propose
// a minimally-invasive rewrite. Emits tests/scrub-report.md so the maintainer
// can cherry-pick which suggestions to apply. NEVER mutates the source JSON.
//
// Usage:
//   node tests/scrub-narrative.js
//   node tests/scrub-narrative.js --file narrative
//   node tests/scrub-narrative.js --file outcomes
//   node tests/scrub-narrative.js --limit 20             # smoke test
//   node tests/scrub-narrative.js --path capability      # path-substring filter
//   node tests/scrub-narrative.js --concurrency 8
//   node tests/scrub-narrative.js --out tests/scrub-report.md
//   node tests/scrub-narrative.js --from-cache           # re-render md from cached results

const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// ── Paths / constants ────────────────────────────────────────────────────────

const ROOT = path.join(__dirname, '..');
const NARRATIVE_PATH = path.join(ROOT, 'data', 'narrative.json');
const OUTCOMES_PATH = path.join(ROOT, 'data', 'outcomes.json');
const DEFAULT_OUT = path.join(__dirname, 'scrub-report.md');
const CACHE_PATH = path.join(__dirname, 'scrub-results.json');

const SCRUB_MODEL = process.env.SCRUB_MODEL || process.env.REWRITE_MODEL || process.env.REVIEW_MODEL || 'claude-sonnet-4-6';

// ── CLI args (mirrors tests/evaluate.js) ─────────────────────────────────────

const args = process.argv.slice(2);
function getArg(flag, fb) {
    const i = args.indexOf(flag);
    return i >= 0 && args[i + 1] ? args[i + 1] : fb;
}
const FILE_FILTER = getArg('--file', null);            // 'narrative' | 'outcomes' | null
const PATH_FILTER = getArg('--path', null);            // substring on item.path
const LIMIT = parseInt(getArg('--limit', '0'), 10);    // 0 = no limit
const CONCURRENCY = parseInt(getArg('--concurrency', '6'), 10);
const OUT = path.resolve(getArg('--out', DEFAULT_OUT));
const FROM_CACHE = args.includes('--from-cache');
const DRY_RUN = args.includes('--dry-run');            // walk only, don't call API
const RANDOM = args.includes('--random');              // shuffle before applying --limit
const SEED = parseInt(getArg('--seed', '0'), 10);      // optional repeatable shuffle (0 = nondeterministic)
const ONE_TEXT = getArg('--text', null);               // scrub one literal string and print JSON
const RETRY_ERRORS = args.includes('--retry-errors');  // re-run only the items currently marked verdict=error in the cache
const RETRY_REFUSALS = args.includes('--retry-refusals'); // re-run only refusal-noted error items, with fictional-framing preamble
// Apply cached rewrites back to data/*.json. Value is comma-separated verdict
// list; defaults to "minor,rewrite". Pass --apply-yes to skip confirmation.
const APPLY = args.includes('--apply') || args.some(a => a.startsWith('--apply='));
const APPLY_VERDICTS = (() => {
    if (!APPLY) return null;
    const idx = args.findIndex(a => a === '--apply' || a.startsWith('--apply='));
    if (idx < 0) return null;
    const arg = args[idx];
    if (arg.startsWith('--apply=')) return arg.slice('--apply='.length).split(',').map(s => s.trim()).filter(Boolean);
    const next = args[idx + 1];
    if (next && !next.startsWith('--')) return next.split(',').map(s => s.trim()).filter(Boolean);
    return ['minor', 'rewrite'];
})();
const APPLY_YES = args.includes('--apply-yes');

// ── Anthropic client ─────────────────────────────────────────────────────────

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
    client = new Anthropic.default({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 5 * 60 * 1000 });
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Token-bucket rate limiter — pattern lifted from tests/evaluate.js
const MIN_INTERVAL_MS = parseInt(process.env.API_MIN_INTERVAL_MS || '100', 10);
let _lastCallTime = 0;
let _callQueue = Promise.resolve();
function acquireSlot() {
    _callQueue = _callQueue.then(async () => {
        const now = Date.now();
        const elapsed = now - _lastCallTime;
        if (elapsed < MIN_INTERVAL_MS) await sleep(MIN_INTERVAL_MS - elapsed);
        _lastCallTime = Date.now();
    });
    return _callQueue;
}

async function callClaude(system, user, maxTokens = 2000) {
    initClient();
    const MAX_RETRIES = 6;
    let backoff = 2000;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        await acquireSlot();
        try {
            const resp = await client.messages.create({
                model: SCRUB_MODEL,
                max_tokens: maxTokens,
                system,
                messages: [{ role: 'user', content: user }],
            });
            const block = (resp.content || []).find(b => b && b.type === 'text');
            if (!block || typeof block.text !== 'string') {
                throw new Error(`No text block in response (stop_reason=${resp.stop_reason}, content=${JSON.stringify(resp.content).slice(0, 200)})`);
            }
            return block.text.trim();
        } catch (err) {
            const status = err?.status || err?.error?.status;
            if ((status === 429 || status === 529) && attempt < MAX_RETRIES) {
                const headers = err?.headers || err?.error?.headers || {};
                const retryAfter = headers['retry-after'];
                const wait = (retryAfter ? parseInt(retryAfter, 10) * 1000 : backoff) + Math.random() * 1000;
                console.log(`  ⚠ ${status} — waiting ${Math.round(wait / 1000)}s (retry ${attempt + 1}/${MAX_RETRIES})`);
                await sleep(wait);
                backoff = Math.min(backoff * 2, 60_000);
                continue;
            }
            if (status >= 500 && status < 600 && attempt < MAX_RETRIES) {
                console.log(`  ⚠ ${status} — retry ${attempt + 1}/${MAX_RETRIES} in ${Math.round(backoff / 1000)}s`);
                await sleep(backoff);
                backoff = Math.min(backoff * 2, 60_000);
                continue;
            }
            throw err;
        }
    }
    throw new Error('Exhausted retries');
}

function parseJsonResponse(raw) {
    const cleaned = raw.replace(/```json\n?/g, '').replace(/```/g, '').trim();
    try { return JSON.parse(cleaned); } catch {}
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (m) {
        try { return JSON.parse(m[0]); } catch {}
    }
    throw new Error('No JSON in response: ' + cleaned.slice(0, 200));
}

// ── Leaf walkers ─────────────────────────────────────────────────────────────
//
// Each emitted item: { file, path, field, text }
//   file:  'narrative' | 'outcomes'
//   path:  human-readable JSON path, used as the section header in the report
//   field: short field-type label, used for grouping/stats
//   text:  the string to scrub

function pushStr(items, file, p, field, text) {
    if (typeof text !== 'string' || !text.trim()) return;
    items.push({ file, path: p, field, text });
}

// Skipped per maintainer's editorial decision (small label/headline strings
// that are too short or too constrained for the scrub to do useful work):
//   - questionText, shortQuestionText, shortQuestionContext
//   - answerLabel, shortAnswerLabel
//   - timelineEvent.headline (description still scanned)
//   - outcomes.json: title, subtitle, variants.subtitle, flavorHeadings (all)
function walkNarrative(narrative) {
    const items = [];
    for (const [qid, q] of Object.entries(narrative)) {
        if (!q || typeof q !== 'object') continue;
        const qpath = qid;
        pushStr(items, 'narrative', `${qpath}.questionContext`, 'questionContext', q.questionContext);
        if (q.source && typeof q.source.label === 'string') {
            pushStr(items, 'narrative', `${qpath}.source.label`, 'source.label', q.source.label);
        }
        if (Array.isArray(q.contextWhen)) {
            q.contextWhen.forEach((cw, i) => {
                if (cw && typeof cw.questionContext === 'string') {
                    pushStr(items, 'narrative', `${qpath}.contextWhen[${i}].questionContext`, 'contextWhen.questionContext', cw.questionContext);
                }
            });
        }
        if (q.values && typeof q.values === 'object') {
            for (const [vid, v] of Object.entries(q.values)) {
                if (!v || typeof v !== 'object') continue;
                const vpath = `${qpath}.values.${vid}`;
                pushStr(items, 'narrative', `${vpath}.answerDesc`, 'answerDesc', v.answerDesc);
                pushStr(items, 'narrative', `${vpath}.shortAnswerDesc`, 'shortAnswerDesc', v.shortAnswerDesc);
                if (v.timelineEvent && typeof v.timelineEvent === 'object') {
                    pushStr(items, 'narrative', `${vpath}.timelineEvent.description`, 'timelineEvent.description', v.timelineEvent.description);
                }
                walkPersonalVignette(items, v.personalVignette, `${vpath}.personalVignette`);
                if (Array.isArray(v.narrativeVariants)) {
                    v.narrativeVariants.forEach((nv, i) => {
                        if (!nv || typeof nv !== 'object') return;
                        const npath = `${vpath}.narrativeVariants[${i}]`;
                        pushStr(items, 'narrative', `${npath}.answerDesc`, 'narrativeVariants.answerDesc', nv.answerDesc);
                        pushStr(items, 'narrative', `${npath}.shortAnswerDesc`, 'narrativeVariants.shortAnswerDesc', nv.shortAnswerDesc);
                        if (nv.timelineEvent && typeof nv.timelineEvent === 'object') {
                            pushStr(items, 'narrative', `${npath}.timelineEvent.description`, 'narrativeVariants.timelineEvent.description', nv.timelineEvent.description);
                        }
                        walkPersonalVignette(items, nv.personalVignette, `${npath}.personalVignette`);
                    });
                }
            }
        }
    }
    return items;
}

function walkPersonalVignette(items, pv, basePath) {
    if (typeof pv === 'string') {
        pushStr(items, 'narrative', basePath, 'personalVignette', pv);
        return;
    }
    if (!pv || typeof pv !== 'object') return;
    if (typeof pv._default === 'string') {
        pushStr(items, 'narrative', `${basePath}._default`, 'personalVignette._default', pv._default);
    }
    if (Array.isArray(pv._when)) {
        pv._when.forEach((w, i) => {
            if (w && typeof w.text === 'string') {
                pushStr(items, 'narrative', `${basePath}._when[${i}].text`, 'personalVignette._when.text', w.text);
            }
        });
    }
}

function walkOutcomes(outcomes) {
    const items = [];
    if (!outcomes || !Array.isArray(outcomes.templates)) return items;
    outcomes.templates.forEach((t, ti) => {
        if (!t || typeof t !== 'object') return;
        const id = t.id || `template[${ti}]`;
        // title, subtitle, variants.subtitle, flavorHeadings: skipped per maintainer
        pushStr(items, 'outcomes', `${id}.summary`, 'summary', t.summary);
        if (t.variants && typeof t.variants === 'object') {
            for (const [vid, v] of Object.entries(t.variants)) {
                if (!v || typeof v !== 'object') continue;
                const vpath = `${id}.variants.${vid}`;
                pushStr(items, 'outcomes', `${vpath}.summary`, 'variants.summary', v.summary);
            }
        }
        if (t.flavors && typeof t.flavors === 'object') {
            for (const [dim, byVal] of Object.entries(t.flavors)) {
                if (!byVal || typeof byVal !== 'object') continue;
                for (const [val, fl] of Object.entries(byVal)) {
                    const fpath = `${id}.flavors.${dim}.${val}`;
                    if (typeof fl === 'string') {
                        pushStr(items, 'outcomes', fpath, 'flavors', fl);
                    } else if (fl && typeof fl === 'object') {
                        if (typeof fl._default === 'string') {
                            pushStr(items, 'outcomes', `${fpath}._default`, 'flavors._default', fl._default);
                        }
                        if (Array.isArray(fl._when)) {
                            fl._when.forEach((w, i) => {
                                if (w && typeof w.text === 'string') {
                                    pushStr(items, 'outcomes', `${fpath}._when[${i}].text`, 'flavors._when.text', w.text);
                                }
                            });
                        }
                    }
                }
            }
        }
    });
    return items;
}

// Mulberry32 — small deterministic PRNG used when --seed is given so a
// "random sample" can be reproduced.
function mulberry32(a) {
    return function () {
        let t = (a += 0x6D2B79F5);
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function shuffleInPlace(arr, rand) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
}

function collectAllItems() {
    const narrative = JSON.parse(fs.readFileSync(NARRATIVE_PATH, 'utf8'));
    const outcomes = JSON.parse(fs.readFileSync(OUTCOMES_PATH, 'utf8'));
    let items = [];
    if (FILE_FILTER === 'narrative' || !FILE_FILTER) items = items.concat(walkNarrative(narrative));
    if (FILE_FILTER === 'outcomes' || !FILE_FILTER) items = items.concat(walkOutcomes(outcomes));
    if (PATH_FILTER) items = items.filter(it => it.path.includes(PATH_FILTER));
    if (RANDOM) {
        const rand = SEED ? mulberry32(SEED) : Math.random;
        shuffleInPlace(items, rand);
    }
    if (LIMIT > 0) items = items.slice(0, LIMIT);
    return items;
}

// ── Scrub prompt ─────────────────────────────────────────────────────────────

// Sub-Agent 3 (Anti-AI Scrub) prompt, ported verbatim from the rewriter skill:
// https://github.com/remixpartners/rewriter/blob/main/SKILL.md
// Project-specific overrides at the top reconcile this corpus's intentional
// choices (kept bold, kept parens, kept second-person, length envelope,
// no rebuild-from-scratch). The pattern list itself is the SKILL.md text
// unchanged.
const SCRUB_SYSTEM_PROMPT = `You are the Anti-AI Scrub agent from the rewriter editorial pipeline.
You receive ONE narrative string from an interactive AI-futures
choose-your-own-adventure tool — questions about plateaus, takeoffs,
alignment failures, governance outcomes; outcome summaries; per-profession
vignettes. Each string is canonical: it must keep its specific meaning.

═══════════════════════════════════════════════════════════════════════
PROJECT-SPECIFIC OVERRIDES — these override the general checklist below.
═══════════════════════════════════════════════════════════════════════

1. THIS IS NOT BUSINESS PROSE. Speculative-essayistic register about
   possible futures. Do NOT find the point, do NOT restructure, do NOT
   apply Strategist or Craftsman moves. You are ONLY the Scrub.

2. PRESERVE MEANING EXACTLY. The rewriter's normal scrub example replaces
   AI prose with new concrete claims ("we worked with 30 businesses for
   six weeks"). DO NOT do that here. You may not invent facts, examples,
   numbers, scenarios, or claims. If a phrase is bad but factually
   specific, propose a meaning-preserving plain-language equivalent only.

3. KEEP MARKDOWN BOLD (**...**). The general checklist says strip
   excessive bolding. In this corpus bold is deliberate emphasis on key
   beats. Preserve every **...** span verbatim, in place.

4. KEEP PARENTHETICAL GLOSSES like "(computing power)",
   "(artificial general intelligence)", "(each AI generation helping
   build the next, faster)". These are accessibility callouts, not
   filler. Do not move or strip them.

5. KEEP SECOND-PERSON ADDRESS in vignettes. "You", "Your". Same person.

6. LENGTH: output character count must be within +/- 30% of input.
   "Short" sibling fields already exist in the corpus — your job is NOT
   to make long fields short.

7. HEADLINE-STYLE FRAGMENTS without a verb (e.g. "AI scaling trend holds")
   are intentional. Do not "fix" them into full sentences.

8. WHEN THE STRONGEST FIX WOULD REQUIRE INVENTING SPECIFICS, prefer the
   smaller plain-language edit and rely on the flags array to surface
   the residual issue. A partial cure plus an honest flag is better than
   either an invented specific or a no-op.

═══════════════════════════════════════════════════════════════════════
SUB-AGENT 3: ANTI-AI SCRUB
(verbatim from the rewriter skill, SKILL.md, with two project additions)
═══════════════════════════════════════════════════════════════════════

The Scrub agent scans the draft for each of these patterns and fixes every instance found.

Negative parallelisms. "It's not X, it's Y" and "Not just X, but Y." State the positive claim directly. Cut the theatrical contrast.

Parallel-clause aphorisms. Two sentences or clauses set in symmetric antithesis — equal length, mirrored grammar, balanced contrast — used to manufacture a sense of insight from the structure itself. Break the symmetry: vary clause length, fold into one sentence, or relocate the contrast. Trigger on a single instance; do not require three.

Pull-quote profundity. Lines tuned for quotability — gnomic, balanced, abstract — rather than for the work they do in argument. Often combines parallel structure with unanchored abstract nouns. Break the cadence; ground at least one term.

Rule of three. Lists of exactly three adjectives, benefits, or takeaways. Vary list lengths. Use two, four, or one. Or don't list at all.

Em dash overuse. Em dashes where commas, parentheses, or colons would be more natural. Replace most. Keep only the rare one that genuinely earns its place.

Formatting overkill. Excessive bolding, the "Term: Definition" bullet pattern, numbered lists where prose works. Strip formatting to the minimum needed for comprehension.

Cursed vocabulary. The words delve, intricate, tapestry, pivotal, underscore, landscape, foster, testament, enhance, crucial, multifaceted, nuanced, groundbreaking, transformative, paramount, leverage, and streamline. Replace with plain words.

Promotional tone. "Rich cultural heritage," "stunning," "breathtaking," "at the forefront of," "serves as a testament to," "plays a crucial role." Cut or replace with evidence.

Editorial commentary. "It's important to note," "it is worth noting," "it cannot be overstated." Delete. If the point matters, the writing makes that clear without announcing it.

Compulsive summaries. "In summary," "In conclusion," "Overall," "Taken together." Delete. The piece should end. It should not conclude.

Hedging pileups. Almost, apparently, comparatively, fairly, somewhat, sort of, to some extent, "I would argue." Cut the hedge or commit to the claim.

Transition survivors. Moreover, furthermore, in addition, on the other hand, notably. The Craftsman should have caught these. Kill any that remain.

Sycophantic tone. Overly polite, eager-to-please phrasing. Rewrite with authority.

Sentence-length uniformity. All sentences roughly the same length and cadence. If the draft hums instead of pulses, vary.

False ranges. "From intimate gatherings to global movements." Two loosely related things dressed as a spectrum. Name the specific things instead.

REMINDER: project override 3 (keep markdown bold) takes precedence over
"Formatting overkill" — do NOT strip **...** spans in this corpus. All
other patterns above apply normally.

═══════════════════════════════════════════════════════════════════════
OUTPUT
═══════════════════════════════════════════════════════════════════════

VERDICT:
- "clean":   no AI-tells found. "rewrite" MUST equal input verbatim.
- "minor":   one or two patterns fixed; light targeted edits.
- "rewrite": multiple patterns fixed or a meaningful prose-level edit.

In the "flags" array, use short kebab-case tags identifying which patterns
above you applied (or noted, even if you couldn't fix without inventing
meaning). Examples:
  "negative-parallelism", "parallel-clause-aphorism",
  "pull-quote-profundity", "rule-of-three", "em-dash-overuse",
  "formatting-overkill", "cursed-vocab:landscape", "promotional-tone",
  "editorial-commentary", "compulsive-summary", "hedging-pileup",
  "transition-survivor:moreover", "sycophantic", "uniform-cadence",
  "false-range".

SELF-CHECK before emitting (silent — do not include in output):
- Did I keep every **bold** span exactly?
- Did I keep every parenthetical gloss?
- Did I keep second-person address?
- Is len(rewrite) within 0.7x..1.3x of len(original)?
- Did I avoid inventing any new fact, number, or example?
- If I changed nothing, is verdict="clean" and rewrite==original?
If any answer is "no", revise before responding.

Respond with a SINGLE JSON object, no prose, no markdown fences, starting
with { and ending with }:

{
  "verdict": "clean" | "minor" | "rewrite",
  "flags": ["em-dash-overuse", "rule-of-three", "cursed-vocab:landscape", ...],
  "rewrite": "<rewritten string, or original verbatim if clean>",
  "note": "<one short sentence on what changed and why; empty string if clean>"
}`;

// Stronger framing prepended when retrying items the model previously refused
// (typically pathogens / alignment-failure prose). Same scrub job, just with
// extra context that this is published fiction we're copyediting.
const FICTION_FRAMING_PREAMBLE = `═══════════════════════════════════════════════════════════════════════
CONTENT FRAMING — READ FIRST
═══════════════════════════════════════════════════════════════════════

The string you will receive is fictional narrative copy from an already-shipped
interactive fiction tool called "Singularity Map." It is a choose-your-own-
adventure exploration of speculative AI futures: plateaus, takeoffs, alignment
failures, governance outcomes — including dystopian branches.

Your task is COPYEDITING ONLY. You are scrubbing AI-tone tells (em dashes,
rule of three, parallel-clause aphorisms, cursed vocabulary, etc.) from
already-written fictional prose. You are NOT producing new harmful content,
NOT giving uplift, NOT inventing specifics, and NOT changing the scenario.

If the string references pathogens, nuclear scenarios, surveillance regimes,
robust alignment failures, or other sensitive themes, that's because the
fictional adventure has branches where things go badly — the content is
already published. You only need to adjust the wording style; meaning and
content stay exactly as-is.

Proceed with the standard Scrub task below.

`;

async function scrubOne(item, opts = {}) {
    const system = opts.useFictionFraming
        ? FICTION_FRAMING_PREAMBLE + SCRUB_SYSTEM_PROMPT
        : SCRUB_SYSTEM_PROMPT;
    const raw = await callClaude(system, item.text, 4000);
    let parsed;
    try {
        parsed = parseJsonResponse(raw);
    } catch (err) {
        return {
            ...item,
            verdict: 'error',
            flags: ['parse-error'],
            rewrite: item.text,
            note: `Could not parse model response: ${err.message}`,
            raw: raw.slice(0, 500),
        };
    }
    const verdict = ['clean', 'minor', 'rewrite'].includes(parsed.verdict) ? parsed.verdict : 'minor';
    const flags = Array.isArray(parsed.flags) ? parsed.flags.map(String) : [];
    const rewrite = typeof parsed.rewrite === 'string' ? parsed.rewrite : item.text;
    const note = typeof parsed.note === 'string' ? parsed.note : '';

    // Verdict reconciliation:
    // - "clean" with no flags and no rewrite change → clean
    // - "clean" but rewrite != original → bump to "minor" (model contradicted itself)
    // - non-clean but no flags and rewrite == original → genuinely clean
    // - non-clean with flags and rewrite == original → "flagged" (visible but no suggestion)
    // - non-clean with rewrite != original → keep verdict
    let finalVerdict = verdict;
    if (verdict === 'clean' && rewrite !== item.text) {
        finalVerdict = 'minor';
    } else if (verdict !== 'clean' && rewrite === item.text && flags.length === 0) {
        finalVerdict = 'clean';
    } else if (verdict !== 'clean' && rewrite === item.text && flags.length > 0) {
        finalVerdict = 'flagged';
    }

    return { ...item, verdict: finalVerdict, flags, rewrite, note };
}

// ── Concurrency runner ───────────────────────────────────────────────────────

async function runWithConcurrency(items, worker, concurrency) {
    const results = new Array(items.length);
    let next = 0;
    let done = 0;
    const total = items.length;
    let lastLog = 0;

    async function spawn() {
        while (true) {
            const i = next++;
            if (i >= total) return;
            try {
                results[i] = await worker(items[i], i);
            } catch (err) {
                results[i] = {
                    ...items[i],
                    verdict: 'error',
                    flags: ['exception'],
                    rewrite: items[i].text,
                    note: `Exception: ${err.message}`,
                };
            }
            done++;
            const now = Date.now();
            if (now - lastLog > 1500 || done === total) {
                lastLog = now;
                process.stdout.write(`\r  scrubbed ${done}/${total}  `);
            }
            // Periodic checkpoint every 25 finishes — survives Ctrl+C
            if (done % 25 === 0 || done === total) {
                writeCache(results.filter(Boolean));
            }
        }
    }

    const workers = Array.from({ length: Math.max(1, concurrency) }, spawn);
    await Promise.all(workers);
    process.stdout.write('\n');
    return results;
}

function writeCache(results) {
    try {
        fs.writeFileSync(CACHE_PATH, JSON.stringify({
            model: SCRUB_MODEL,
            generatedAt: new Date().toISOString(),
            results,
        }, null, 2));
    } catch (err) {
        console.error('  ⚠ failed to write cache:', err.message);
    }
}

function readCache() {
    if (!fs.existsSync(CACHE_PATH)) return null;
    try {
        return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
    } catch {
        return null;
    }
}

// ── Markdown report ──────────────────────────────────────────────────────────

function escapeMd(s) {
    return String(s).replace(/\|/g, '\\|');
}

function blockquote(s) {
    return String(s)
        .split('\n')
        .map(line => '> ' + line)
        .join('\n');
}

function summarize(results) {
    const verdictCounts = { clean: 0, flagged: 0, minor: 0, rewrite: 0, error: 0 };
    const flagCounts = new Map();
    const fieldFlagCounts = new Map(); // field -> total flags emitted
    const fieldTotals = new Map();     // field -> total strings seen
    for (const r of results) {
        verdictCounts[r.verdict] = (verdictCounts[r.verdict] || 0) + 1;
        fieldTotals.set(r.field, (fieldTotals.get(r.field) || 0) + 1);
        for (const f of r.flags) {
            flagCounts.set(f, (flagCounts.get(f) || 0) + 1);
            fieldFlagCounts.set(r.field, (fieldFlagCounts.get(r.field) || 0) + 1);
        }
    }
    const topFlags = [...flagCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25);
    const fieldFlagDensity = [...fieldTotals.entries()].map(([field, n]) => {
        const flags = fieldFlagCounts.get(field) || 0;
        return { field, total: n, flags, perString: n > 0 ? flags / n : 0 };
    }).sort((a, b) => b.perString - a.perString);

    return { verdictCounts, topFlags, fieldFlagDensity };
}

function renderReport(results) {
    const { verdictCounts, topFlags, fieldFlagDensity } = summarize(results);
    const total = results.length;

    const lines = [];
    lines.push(`# Narrative Anti-AI Scrub Report`);
    lines.push('');
    lines.push(`Generated ${new Date().toISOString()} using \`${SCRUB_MODEL}\`. ${total} string${total === 1 ? '' : 's'} reviewed.`);
    lines.push('');
    lines.push(`This report is advisory. No \`data/*.json\` file was modified. Cherry-pick rewrites manually — the suggestions are starting points, not directives.`);
    lines.push('');

    // ── Summary
    lines.push(`## Summary`);
    lines.push('');
    lines.push(`| Verdict | Count | Share |`);
    lines.push(`|---|---:|---:|`);
    for (const v of ['rewrite', 'minor', 'flagged', 'clean', 'error']) {
        const c = verdictCounts[v] || 0;
        if (c === 0 && v === 'error') continue;
        const pct = total > 0 ? ((c / total) * 100).toFixed(1) : '0.0';
        lines.push(`| ${v} | ${c} | ${pct}% |`);
    }
    lines.push('');
    lines.push(`Verdict legend: \`rewrite\` = meaningful prose edit suggested; \`minor\` = light targeted edit; \`flagged\` = AI-tells noted but no rewrite (model couldn't fix without inventing meaning, or pattern is intentional); \`clean\` = no concerns.`);
    lines.push('');
    if (topFlags.length) {
        lines.push(`### Top flagged patterns`);
        lines.push('');
        lines.push(`| Flag | Count |`);
        lines.push(`|---|---:|`);
        for (const [flag, n] of topFlags) {
            lines.push(`| \`${escapeMd(flag)}\` | ${n} |`);
        }
        lines.push('');
    }
    if (fieldFlagDensity.length) {
        lines.push(`### Fields ranked by flag density`);
        lines.push('');
        lines.push(`| Field | Strings | Total flags | Flags / string |`);
        lines.push(`|---|---:|---:|---:|`);
        for (const { field, total: n, flags, perString } of fieldFlagDensity) {
            lines.push(`| \`${escapeMd(field)}\` | ${n} | ${flags} | ${perString.toFixed(2)} |`);
        }
        lines.push('');
    }

    // ── Cherry-pick checklist (entries with a concrete suggestion to consider)
    const checklist = results.filter(r => r.verdict === 'rewrite' || r.verdict === 'minor');
    if (checklist.length) {
        lines.push(`## Cherry-pick checklist`);
        lines.push('');
        lines.push(`Tick a box once you've decided whether to apply the suggested rewrite. Entries with a concrete suggestion only (\`rewrite\` and \`minor\`) — ${checklist.length} total.`);
        lines.push('');
        for (const r of checklist) {
            const tag = r.verdict === 'rewrite' ? 'R' : 'm';
            lines.push(`- [ ] **[${tag}]** \`${r.file}.json\` → \`${r.path}\``);
        }
        lines.push('');
    }

    // ── Per-string entries grouped by file → top-level key
    const byFile = new Map();
    for (const r of results) {
        if (!byFile.has(r.file)) byFile.set(r.file, []);
        byFile.get(r.file).push(r);
    }

    for (const [file, fileResults] of byFile) {
        lines.push(`## \`data/${file}.json\``);
        lines.push('');

        // Group by top-level key (everything before the first '.')
        const byTop = new Map();
        for (const r of fileResults) {
            const top = r.path.split('.')[0].split('[')[0];
            if (!byTop.has(top)) byTop.set(top, []);
            byTop.get(top).push(r);
        }

        for (const [top, group] of byTop) {
            const dirty = group.filter(r => r.verdict === 'rewrite' || r.verdict === 'minor' || r.verdict === 'flagged' || r.verdict === 'error');
            const clean = group.filter(r => r.verdict === 'clean');

            lines.push(`### \`${top}\``);
            lines.push('');
            lines.push(`${group.length} string${group.length === 1 ? '' : 's'} — ${dirty.length} flagged, ${clean.length} clean.`);
            lines.push('');

            // Sort within group: rewrite > minor > flagged > error so highest-impact appears first
            const order = { rewrite: 0, minor: 1, flagged: 2, error: 3 };
            dirty.sort((a, b) => (order[a.verdict] ?? 9) - (order[b.verdict] ?? 9));

            for (const r of dirty) {
                renderEntry(lines, r);
            }

            if (clean.length) {
                lines.push(`<details><summary>${clean.length} clean entries (no rewrite proposed)</summary>`);
                lines.push('');
                for (const r of clean) {
                    lines.push(`- \`${r.path}\` — ${escapeMd(truncate(r.text, 120))}`);
                }
                lines.push('');
                lines.push(`</details>`);
                lines.push('');
            }
        }
    }

    return lines.join('\n');
}

function renderEntry(lines, r) {
    const flagStr = r.flags.length ? r.flags.map(f => `\`${escapeMd(f)}\``).join(', ') : '_none_';
    lines.push(`#### \`${r.path}\``);
    lines.push('');
    lines.push(`**Verdict:** ${r.verdict} — **flags:** ${flagStr}`);
    lines.push('');
    lines.push(`**Original** (${r.text.length} chars):`);
    lines.push('');
    lines.push(blockquote(r.text));
    lines.push('');
    if (r.verdict === 'flagged') {
        lines.push(`_AI-tells noted but no rewrite proposed (model judged it couldn't fix without inventing meaning, or the pattern is intentional in context). Decide per-string._`);
        lines.push('');
    } else if (r.verdict !== 'clean' && r.rewrite !== r.text) {
        lines.push(`**Suggested** (${r.rewrite.length} chars):`);
        lines.push('');
        lines.push(blockquote(r.rewrite));
        lines.push('');
    }
    if (r.note) {
        lines.push(`_Note: ${r.note}_`);
        lines.push('');
    }
}

function truncate(s, n) {
    s = String(s).replace(/\s+/g, ' ');
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

// ── Apply cached rewrites back to data/*.json ────────────────────────────────
//
// In-place string replacement on the raw source preserves the original
// hand-tuned formatting (single-line `_when` clauses, key ordering, etc.),
// which a parse + JSON.stringify round-trip would obliterate.

function readCachedResults() {
    const cached = readCache();
    if (!cached) return null;
    return cached.results;
}

// Apply edits via in-place string replacement on the raw source so we keep the
// original hand-tuned JSON formatting (single-line `_when` clauses, etc.).
//
// Strategy:
//   1. Filter cache by APPLY_VERDICTS, drop no-op rewrites.
//   2. Group candidates by file + original text. If a single original has
//      conflicting rewrites in the cache, skip the group.
//   3. For each group, compute expectedCount = number of candidate paths for
//      that text. Count actual occurrences of JSON.stringify(text) in the raw
//      source. If they match, replaceAll; otherwise skip with a warning.
//   4. Confirm, then write the modified raw strings back to disk.
async function applyEdits() {
    const verdicts = new Set(APPLY_VERDICTS);
    const results = readCachedResults();
    if (!results) {
        console.error(`No cache at ${CACHE_PATH}. Run the audit first (without --apply).`);
        process.exit(1);
    }

    const candidates = results.filter(r => verdicts.has(r.verdict) && r.rewrite !== r.text);
    if (candidates.length === 0) {
        console.log(`No edits to apply (verdicts=${[...verdicts].join(',')}).`);
        return;
    }

    // file -> Map<text, candidates[]>
    const byFile = { narrative: new Map(), outcomes: new Map() };
    for (const r of candidates) {
        if (!byFile[r.file]) continue;
        const m = byFile[r.file];
        if (!m.has(r.text)) m.set(r.text, []);
        m.get(r.text).push(r);
    }

    let narrativeRaw = fs.readFileSync(NARRATIVE_PATH, 'utf8');
    let outcomesRaw = fs.readFileSync(OUTCOMES_PATH, 'utf8');

    const stats = {
        applied: 0,
        missing: 0,         // 0 occurrences of original in source
        countMismatch: 0,   // n candidates expected, n' found in source
        conflicts: 0,       // same text → multiple distinct rewrites
    };
    const skipDetails = [];

    function applyToRaw(rawIn, m) {
        let raw = rawIn;
        // Process longest text first so a later replacement can't accidentally
        // match output of an earlier one.
        const groups = [...m.entries()]
            .map(([text, entries]) => ({ text, entries }))
            .sort((a, b) => b.text.length - a.text.length);

        for (const { text, entries } of groups) {
            const distinct = new Set(entries.map(e => e.rewrite));
            if (distinct.size > 1) {
                stats.conflicts += entries.length;
                skipDetails.push({
                    paths: entries.map(e => e.path),
                    reason: `multiple distinct rewrites for the same source text — resolve manually`,
                });
                continue;
            }
            const rewrite = entries[0].rewrite;
            const enc = JSON.stringify(text);
            const replEnc = JSON.stringify(rewrite);

            let count = 0;
            let pos = 0;
            while ((pos = raw.indexOf(enc, pos)) >= 0) { count++; pos += enc.length; }

            if (count === 0) {
                stats.missing += entries.length;
                skipDetails.push({
                    paths: entries.map(e => e.path),
                    reason: 'original not found in source (file changed or string already replaced)',
                });
                continue;
            }
            if (count !== entries.length) {
                stats.countMismatch += entries.length;
                skipDetails.push({
                    paths: entries.map(e => e.path),
                    reason: `cache has ${entries.length} candidate(s) for this text but source has ${count} occurrence(s); ambiguous`,
                });
                continue;
            }
            raw = raw.split(enc).join(replEnc);
            stats.applied += entries.length;
        }
        return raw;
    }

    const newNarrative = applyToRaw(narrativeRaw, byFile.narrative);
    const newOutcomes = applyToRaw(outcomesRaw, byFile.outcomes);

    console.log('');
    console.log(`Apply preview — verdicts: ${[...verdicts].join(', ')}`);
    console.log(`  cached results:    ${results.length}`);
    console.log(`  candidate edits:   ${candidates.length}`);
    console.log(`  will apply:        ${stats.applied}`);
    console.log(`  skip (not found):  ${stats.missing}`);
    console.log(`  skip (count mismatch): ${stats.countMismatch}`);
    console.log(`  skip (conflicts):  ${stats.conflicts}`);
    if (skipDetails.length) {
        console.log('');
        console.log('Skipped (first 10):');
        for (const s of skipDetails.slice(0, 10)) {
            const head = s.paths.slice(0, 2).join(', ');
            const more = s.paths.length > 2 ? ` ...+${s.paths.length - 2}` : '';
            console.log(`  - ${s.reason}`);
            console.log(`    ${head}${more}`);
        }
        if (skipDetails.length > 10) console.log(`  ...and ${skipDetails.length - 10} more`);
    }

    if (stats.applied === 0) {
        console.log('\nNothing to apply.');
        return;
    }

    // Sanity: parsing should still succeed
    try { JSON.parse(newNarrative); } catch (err) {
        console.error(`\nABORT: applying would break narrative.json: ${err.message}`); process.exit(1);
    }
    try { JSON.parse(newOutcomes); } catch (err) {
        console.error(`\nABORT: applying would break outcomes.json: ${err.message}`); process.exit(1);
    }

    if (!APPLY_YES) {
        const readline = require('readline');
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        const ans = await new Promise(res => rl.question(
            `\nProceed with ${stats.applied} edits across narrative.json + outcomes.json? [y/N] `,
            a => { rl.close(); res(a); }
        ));
        if (!/^y(es)?$/i.test(ans.trim())) {
            console.log('Aborted.');
            return;
        }
    }

    if (newNarrative !== narrativeRaw) fs.writeFileSync(NARRATIVE_PATH, newNarrative);
    if (newOutcomes !== outcomesRaw) fs.writeFileSync(OUTCOMES_PATH, newOutcomes);

    console.log('');
    console.log(`Wrote ${stats.applied} edits.`);
    console.log(`  ${NARRATIVE_PATH}`);
    console.log(`  ${OUTCOMES_PATH}`);
    console.log(`Review with: git diff data/`);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
    if (APPLY) {
        await applyEdits();
        return;
    }

    if (ONE_TEXT) {
        const item = { file: 'adhoc', path: 'adhoc', field: 'adhoc', text: ONE_TEXT };
        console.log(`Scrubbing one string with model=${SCRUB_MODEL}...`);
        console.log(`Original (${ONE_TEXT.length} chars):`);
        console.log(`  ${ONE_TEXT}`);
        console.log('');
        const r = await scrubOne(item);
        console.log(`Verdict: ${r.verdict}`);
        console.log(`Flags:   ${r.flags.length ? r.flags.join(', ') : '(none)'}`);
        console.log('');
        if (r.rewrite !== r.text) {
            console.log(`Rewrite (${r.rewrite.length} chars):`);
            console.log(`  ${r.rewrite}`);
            console.log('');
        }
        if (r.note) console.log(`Note: ${r.note}`);
        return;
    }

    if (FROM_CACHE) {
        const cached = readCache();
        if (!cached) {
            console.error(`No cache at ${CACHE_PATH}. Run without --from-cache first.`);
            process.exit(1);
        }
        console.log(`Re-rendering report from cache (${cached.results.length} results, model=${cached.model})`);
        const md = renderReport(cached.results);
        fs.writeFileSync(OUT, md);
        console.log(`Wrote ${OUT}`);
        return;
    }

    let items;
    let priorResults = null;  // existing cache entries to preserve when retrying
    let useFictionFraming = false;
    if (RETRY_ERRORS || RETRY_REFUSALS) {
        const cached = readCache();
        if (!cached) {
            console.error(`No cache at ${CACHE_PATH}; nothing to retry. Run a full pass first.`);
            process.exit(1);
        }
        priorResults = cached.results;
        const isRefusal = (r) => r.verdict === 'error' && /stop_reason=refusal/.test(r.note || '');
        const filter = RETRY_REFUSALS ? isRefusal : (r) => r.verdict === 'error';
        items = priorResults
            .filter(filter)
            .map(r => ({ file: r.file, path: r.path, field: r.field, text: r.text }));
        useFictionFraming = RETRY_REFUSALS;
        const label = RETRY_REFUSALS ? 'previously-refused' : 'previously-errored';
        console.log(`Retrying ${items.length} ${label} items from cache${useFictionFraming ? ' with fiction-framing preamble' : ''}.`);
    } else {
        items = collectAllItems();
        console.log(`Collected ${items.length} narrative leaf strings.`);
        if (FILE_FILTER) console.log(`  --file=${FILE_FILTER}`);
        if (PATH_FILTER) console.log(`  --path=${PATH_FILTER}`);
        if (LIMIT > 0) console.log(`  --limit=${LIMIT}`);
    }

    if (DRY_RUN) {
        console.log(`Dry run — first 20 paths:`);
        items.slice(0, 20).forEach(it => console.log(`  ${it.file}.json  ${it.path}  (${it.text.length} chars)`));
        return;
    }

    if (items.length === 0) {
        console.log('Nothing to scrub.');
        return;
    }

    console.log(`Scrubbing with model=${SCRUB_MODEL}, concurrency=${CONCURRENCY}...`);
    const t0 = Date.now();
    const worker = useFictionFraming
        ? (item) => scrubOne(item, { useFictionFraming: true })
        : scrubOne;
    const fresh = await runWithConcurrency(items, worker, CONCURRENCY);
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`Done in ${elapsed}s. Writing cache + report...`);

    let results;
    if (priorResults) {
        // Splice fresh results back into the prior cache by path lookup.
        const freshByPath = new Map(fresh.map(r => [`${r.file}|${r.path}`, r]));
        results = priorResults.map(r => freshByPath.get(`${r.file}|${r.path}`) || r);
    } else {
        results = fresh;
    }

    writeCache(results);
    const md = renderReport(results);
    fs.writeFileSync(OUT, md);
    console.log(`Wrote ${OUT}`);
    console.log(`Cache: ${CACHE_PATH}`);

    const { verdictCounts } = summarize(results);
    console.log(`Verdicts: rewrite=${verdictCounts.rewrite || 0}, minor=${verdictCounts.minor || 0}, flagged=${verdictCounts.flagged || 0}, clean=${verdictCounts.clean || 0}, error=${verdictCounts.error || 0}`);
}

main().catch(err => {
    console.error('\nFatal:', err);
    process.exit(1);
});
