/*
 * Premature-outcome check (FLOW_DAG.earlyExits-driven).
 *
 * FLOW_DAG annotates each slot with an `earlyExits` list — the
 * outcomes that may legitimately terminate at this slot. The list is
 * the ground truth: anything outside it is either a clause leak (the
 * outcome's `reachable` clauses are loose enough to match a sel
 * produced by a slot that wasn't designed to terminate at it) or an
 * annotation gap (the slot really should be a terminus for this
 * outcome and the list needs extending).
 *
 * Method: drive the same propagation pass `validate.js` and the
 * precompute use (FlowPropagation.run). Each time matchOutcomes hits
 * at a slot whose `earlyExits` doesn't list the outcome, propagation
 * fires `onUnauthorizedSiphon` and routes the sel onward (without
 * siphoning). We capture every (slotKey, oid) pair plus a
 * representative sel and the matching clause, then group for output.
 *
 * Zero false positives by construction: every flag is a sel
 * propagation actually produced AND a slot whose annotation
 * explicitly excludes the outcome.
 *
 * This replaces an older synthetic-state heuristic that built clause
 * states from UPSTREAM_DEFAULTS + first-edge picks, ran cleanSelection,
 * and asked which nodes remained visible — over-flagging false
 * positives because the synthesized states violated upstream gates
 * the FLOW_DAG-driven engine would never let the user reach.
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
const TEMPLATES_BY_ID = new Map(TEMPLATES.map(t => [t.id, t]));

// flagged: (slotKey|oid|ci) → { slotKey, oid, ci, clause, sel }
const flagged = new Map();

FlowPropagation.run({
    onUnauthorizedSiphon(oid, sel, slotKey) {
        const t = TEMPLATES_BY_ID.get(oid);
        if (!t || !t.reachable) return;
        for (let ci = 0; ci < t.reachable.length; ci++) {
            if (!Engine.templateMatches({ reachable: [t.reachable[ci]] }, sel)) continue;
            const fkey = `${slotKey}|${oid}|${ci}`;
            if (flagged.has(fkey)) continue;
            flagged.set(fkey, { slotKey, oid, ci, clause: t.reachable[ci], sel });
        }
    }
});

// Group by (slotKey, oid) for readable output: one block per
// (slot, outcome) pair, listing every clause that leaks there.
const bySlotOid = new Map();
for (const f of flagged.values()) {
    const key = `${f.slotKey}|${f.oid}`;
    if (!bySlotOid.has(key)) bySlotOid.set(key, { slotKey: f.slotKey, oid: f.oid, clauses: [] });
    bySlotOid.get(key).clauses.push({ ci: f.ci, clause: f.clause, sel: f.sel });
}

const groups = [...bySlotOid.values()].sort((a, b) => {
    if (a.slotKey !== b.slotKey) return a.slotKey < b.slotKey ? -1 : 1;
    return a.oid < b.oid ? -1 : 1;
});

for (const g of groups) {
    console.log(`\n⚠  ${g.slotKey}  →  ${g.oid}   (${g.clauses.length} clause${g.clauses.length === 1 ? '' : 's'})`);
    for (const c of g.clauses) {
        console.log(`   clause ${c.ci}: ${JSON.stringify(c.clause)}`);
    }
}

console.log(`\n${groups.length} (slot, outcome) pair(s) flagged across ${flagged.size} (slot, outcome, clause) triple(s).`);
console.log('Resolution: either tighten the outcome\'s reachable clauses so they don\'t match at this slot,');
console.log('or add the outcome to FLOW_DAG.nodes[<slot>].earlyExits if this slot is a legit terminus.');
if (groups.length > 0) process.exitCode = 1;
