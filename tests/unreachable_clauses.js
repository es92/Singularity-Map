/*
 * Find reachable clauses that describe states the engine cannot produce.
 *
 * Approach: for each clause, build a concrete state, run cleanSelection, and
 * see whether the cleaned state still matches the clause. If cleanSelection
 * strips fields out (e.g. because a node becomes invisible once derivations
 * apply), the state is unreachable via normal user flow.
 */

const fs = require('fs');
const path = require('path');
const { cleanSelection, resolvedState, templateMatches } = require('../engine.js');

function loadTemplates() {
    const files = ['data/outcomes.json'];
    const all = [];
    for (const f of files) {
        const j = JSON.parse(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'));
        const list = j.templates || [];
        for (const t of list) all.push(t);
    }
    return all;
}

const UPSTREAM_DEFAULTS = {
    capability: 'singularity', agi_threshold: 'few_months', asi_threshold: 'few_months',
    automation: 'deep', auto_knowledge_rate: 'dramatic', auto_physical_rate: 'dramatic',
    takeoff: 'slow', governance_window: 'partial', open_source: 'six_months',
    distribution: 'concentrated', geo_spread: 'one', sovereignty: 'state',
    proliferation_control: 'deny_rivals', proliferation_outcome: 'holds',
};

function stateFromClause(c) {
    const s = {};
    for (const [k, v] of Object.entries(c)) {
        if (k === '_not') continue;
        if (Array.isArray(v) && v.length) s[k] = v[0];
    }
    return s;
}

const templates = loadTemplates();
for (const t of templates) {
    if (!t.reachable) continue;
    t.reachable.forEach((clause, ci) => {
        const raw = { ...UPSTREAM_DEFAULTS, ...stateFromClause(clause) };
        const { sel } = cleanSelection({ ...raw });
        const eff = resolvedState(sel);
        const stillMatches = templateMatches({ reachable: [clause] }, eff);
        if (!stillMatches) {
            console.log(`DEAD  ${t.id}  clause ${ci}: ${JSON.stringify(clause)}`);
        }
    });
}
