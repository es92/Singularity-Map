/*
 * Find reachable clauses that describe states the engine cannot produce.
 *
 * Methodology: drive the same propagation pass that `validate.js` uses
 * (via FlowPropagation.run) and observe every (templateId, sel) pair the
 * engine actually siphons. For each reachable clause in each template,
 * check whether at least one observed sel matches that specific clause
 * — if zero sels do, the clause is unreachable through any user-walkable
 * path.
 *
 * This replaces an older heuristic that synthesized states from
 * UPSTREAM_DEFAULTS + the first value of each clause field, then ran
 * cleanSelection on the synthetic state. That approach over-flagged
 * because the synthetic state often violated upstream gates, so the
 * cleaner stripped clause-relevant dims; the truly-reachable templates
 * still showed up as DEAD because the synthetic-state path never reached
 * them. The propagation-driven check has zero false positives by
 * construction — if FlowPropagation siphons a sel to a template and the
 * sel matches a clause, the clause is reachable.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

global.window = {
    location: { search: '', hash: '' },
    requestAnimationFrame: () => 0,
    addEventListener: () => {},
    Graph: require('../graph.js'),
    Engine: require('../engine.js'),
};
global.document = {
    addEventListener: () => {},
    readyState: 'complete',
    getElementById: () => null,
    querySelector: () => null,
};
new Function('window', fs.readFileSync(path.join(ROOT, 'graph-io.js'), 'utf8'))(global.window);
new Function('window', 'document', fs.readFileSync(path.join(ROOT, 'nodes.js'), 'utf8'))(global.window, global.document);
new Function('window', fs.readFileSync(path.join(ROOT, 'flow-propagation.js'), 'utf8'))(global.window);

const Engine = global.window.Engine;
const GraphIO = global.window.GraphIO;
const FlowPropagation = global.window.FlowPropagation;

const TEMPLATES = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/outcomes.json'), 'utf8')).templates;
GraphIO.registerOutcomes(TEMPLATES);

// Track per-(template, clauseIdx) whether at least one reachable sel
// has matched that specific clause. Bool-flip on first hit; sels for
// that clause are then ignored to keep the inner loop O(unmatched).
const clauseHit = new Map();
for (const t of TEMPLATES) {
    if (!t.reachable) continue;
    t.reachable.forEach((_, ci) => clauseHit.set(`${t.id}|${ci}`, false));
}

const TEMPLATES_BY_ID = new Map(TEMPLATES.map(t => [t.id, t]));

FlowPropagation.run({
    onOutcomeMatch(oid, sel) {
        const t = TEMPLATES_BY_ID.get(oid);
        if (!t || !t.reachable) return;
        for (let ci = 0; ci < t.reachable.length; ci++) {
            const key = `${oid}|${ci}`;
            if (clauseHit.get(key)) continue;
            if (Engine.templateMatches({ reachable: [t.reachable[ci]] }, sel)) {
                clauseHit.set(key, true);
            }
        }
    }
});

let dead = 0;
for (const t of TEMPLATES) {
    if (!t.reachable) continue;
    t.reachable.forEach((clause, ci) => {
        if (!clauseHit.get(`${t.id}|${ci}`)) {
            console.log(`DEAD  ${t.id}  clause ${ci}: ${JSON.stringify(clause)}`);
            dead++;
        }
    });
}

if (dead === 0) {
    console.log('All reachable clauses have at least one matching sel.');
} else {
    process.exitCode = 1;
}
