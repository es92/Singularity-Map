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

// Default upstream answers for a `singularity` path; covers the common spine
// that most outcomes assume has been traversed.
const SINGULARITY_DEFAULTS = [
    { capability: 'singularity', agi_threshold: 'few_months', asi_threshold: 'few_months',
      automation: 'deep', auto_knowledge_rate: 'dramatic', auto_physical_rate: 'dramatic',
      takeoff: 'slow', governance_window: 'partial', open_source: 'six_months',
      distribution: 'concentrated', geo_spread: 'one', sovereignty: 'state',
      alignment: 'robust', proliferation_control: 'deny_rivals',
      proliferation_outcome: 'holds', intent: 'coexistence', power_promise: 'for_everyone',
      mobilization: 'none', sincerity_test: 'sincere', failure_mode: 'none',
      benefit_distribution: 'equal', gov_action: 'accelerate' },
];

// Defaults for a `stalls` path.
const STALLS_DEFAULTS = [
    { capability: 'stalls', stall_duration: 'years', stall_later: 'yes',
      plateau_benefit_distribution: 'equal', plateau_knowledge_rate: 'substantial',
      plateau_physical_rate: 'substantial' },
];

// Defaults for an `automation` path.
const AUTO_DEFAULTS = [
    { capability: 'automates', automation: 'deep', auto_knowledge_rate: 'dramatic',
      auto_physical_rate: 'dramatic', automation_recovery: 'mild',
      benefit_distribution: 'equal', auto_benefit_distribution: 'equal' },
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
    if (cap === 'singularity') return SINGULARITY_DEFAULTS;
    if (cap === 'stalls') return STALLS_DEFAULTS;
    if (cap === 'automates') return AUTO_DEFAULTS;
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
