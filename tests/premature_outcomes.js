/*
 * Premature-outcome check.
 *
 * For each outcome template's `reachable` clause we build a plausible "full"
 * user state — starting from reasonable defaults for upstream questions and
 * overlaying the clause values — then run `cleanSelection` and ask whether
 * any node would still be visible-and-unanswered. If yes, the outcome matches
 * before the user finishes answering → premature (plateau-style) termination.
 *
 * We try multiple default profiles to reduce false negatives from picks that
 * happen to deactivate a would-be-asked node via hideWhen.
 */

const fs = require('fs');
const path = require('path');
const { NODE_MAP, NODES } = require('../graph.js');
const {
    cleanSelection,
    resolvedState,
    isNodeVisible,
    templateMatches,
} = require('../engine.js');

function loadTemplates() {
    const files = [
        'data/outcomes.json',
        'data/automation.json',
        'data/singularity.json',
        'data/templates.json',
    ].filter(p => fs.existsSync(path.join(__dirname, '..', p)));
    const all = [];
    for (const f of files) {
        const j = JSON.parse(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'));
        const list = Array.isArray(j) ? j : (j.templates || j.outcomes || []);
        for (const t of list) all.push({ ...t, _source: f });
    }
    return all;
}

// Default upstream answers for the main ASI path; covers the common
// spine that most outcomes assume has been traversed. capability='asi'
// is the post-emergence value — the module rewrites the user's
// 'singularity' pick to 'asi' on exit.
const SINGULARITY_DEFAULTS = [
    { capability: 'asi', agi_threshold: 'few_months', asi_threshold: 'few_months',
      knowledge_rate: 'rapid', physical_rate: 'rapid',
      takeoff: 'slow', governance_window: 'partial', open_source: 'six_months',
      distribution: 'concentrated', geo_spread: 'one', sovereignty: 'state',
      alignment: 'robust', proliferation_control: 'deny_rivals',
      proliferation_outcome: 'holds', intent: 'coexistence', power_promise: 'for_everyone',
      mobilization: 'none', sincerity_test: 'sincere', failure_mode: 'none',
      benefit_distribution: 'equal', gov_action: 'accelerate' },
];

// Defaults for the plateau (long-stall) path. Plateau / agi rollouts go
// through EARLY_ROLLOUT_MODULE, whose completion marker is
// `early_rollout_set`; that's the marker the-plateau / the-automation
// reach clauses key on. The shared `rollout_set` marker is asi-only
// and is intentionally absent here.
const STALLS_DEFAULTS = [
    { capability: 'plateau', stall_duration: 'years',
      plateau_benefit_distribution: 'equal', knowledge_rate: 'gradual',
      physical_rate: 'gradual',
      early_rollout_set: 'yes',
      who_benefits_set: 'yes' },
];

// Defaults for the AGI-only / auto-shallow path (asi_threshold='never',
// recovery substantial/never). Module rewrites capability to 'agi' on
// exit. Same single-marker pattern as STALLS_DEFAULTS.
const AUTO_DEFAULTS = [
    { capability: 'agi', knowledge_rate: 'rapid',
      physical_rate: 'rapid', automation_recovery: 'substantial',
      benefit_distribution: 'equal', auto_benefit_distribution: 'equal',
      early_rollout_set: 'yes',
      who_benefits_set: 'yes' },
];

function clauseToState(clause) {
    const s = {};
    for (const [k, v] of Object.entries(clause)) {
        if (k === '_not') continue;
        if (Array.isArray(v) && v.length) s[k] = v[0];
    }
    return s;
}

function pickDefaults(clauseState) {
    const cap = clauseState.capability;
    if (cap === 'asi') return SINGULARITY_DEFAULTS;
    if (cap === 'plateau') return STALLS_DEFAULTS;
    if (cap === 'agi') return AUTO_DEFAULTS;
    return SINGULARITY_DEFAULTS;
}

function unansweredVisibleNodes(state) {
    const out = [];
    for (const node of NODES) {
        if (node.derived) continue;
        if (state[node.id] !== undefined) continue;
        if (!isNodeVisible(state, node)) continue;
        out.push(node.id);
    }
    return out;
}

const templates = loadTemplates();
const flags = new Map();

for (const t of templates) {
    if (!t.reachable) continue;
    for (let ci = 0; ci < t.reachable.length; ci++) {
        const clause = t.reachable[ci];
        const clauseState = clauseToState(clause);
        const defaultsList = pickDefaults(clauseState);

        // Iterate over default profiles; flag iff the outcome fires AND extras
        // exist in at least one reconstruction.
        for (const defaults of defaultsList) {
            // Clause values override defaults (so outcome fires as designed).
            const merged = { ...defaults, ...clauseState };
            const { sel } = cleanSelection({ ...merged });
            const eff = resolvedState(sel);
            if (!templateMatches(t, eff)) continue;
            const extras = unansweredVisibleNodes(sel);
            if (!extras.length) continue;
            // Drop upstream dims that are in `defaults` (we assumed answered).
            const truly_open = extras.filter(id => defaults[id] === undefined);
            if (!truly_open.length) continue;
            const key = `${t.id}#${ci}`;
            if (!flags.has(key)) {
                flags.set(key, {
                    id: t.id, ci, clause, sel, extras: truly_open,
                });
            }
        }
    }
}

for (const f of flags.values()) {
    console.log(`\n⚠  ${f.id}  (clause ${f.ci})`);
    console.log(`   reachable: ${JSON.stringify(f.clause)}`);
    console.log(`   would-still-ask: ${f.extras.join(', ')}`);
}

console.log(`\n${flags.size} clause(s) flagged.`);
