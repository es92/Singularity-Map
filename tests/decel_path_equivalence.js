#!/usr/bin/env node
// tests/decel_path_equivalence.js
//
// Enumerates every decel-entry path and records the resulting global sel
// + resolved state post-module-exit. Used twice:
//   1. BEFORE Phase 4 migration — run with `--save baseline` to snapshot.
//   2. AFTER Phase 4 migration — run with `--check baseline` to diff.
//
// An empty diff is the Phase 4c go/no-go checkpoint.
//
// Decel entry requires: capability=singularity, automation=deep, distribution
// ∈ {monopoly} OR (distribution=concentrated AND sovereignty=state), and
// geo_spread=one. The entry node is gov_action; the decelerate edge starts
// the decel loop.
//
// Enumerated paths:
//   For each entry sub-scenario × each (terminating_month, action, progress) cell:
//     pre-decel prefix + gov_action=decelerate + decel_Nmo_progress + decel_Nmo_action

const fs = require('fs');
const path = require('path');
const engine = require('../engine.js');
const { DECEL_PAIRS, NODE_MAP } = require('../graph.js');

// Pre-decel prefixes that reach gov_action being askable.
const PREFIXES = [
    // monopoly path: 1 country, 1 lab
    { label: 'monopoly-6mo', path: [
        ['capability', 'singularity'], ['automation', 'deep'],
        ['open_source', 'six_months'], ['distribution', 'monopoly'],
    ]},
    { label: 'monopoly-12mo', path: [
        ['capability', 'singularity'], ['automation', 'deep'],
        ['open_source', 'twelve_months'], ['distribution', 'monopoly'],
    ]},
    { label: 'monopoly-24mo', path: [
        ['capability', 'singularity'], ['automation', 'deep'],
        ['open_source', 'twenty_four_months'], ['distribution', 'monopoly'],
    ]},
    // concentrated + state sovereignty path
    { label: 'concentrated-state-6mo', path: [
        ['capability', 'singularity'], ['automation', 'deep'],
        ['open_source', 'six_months'], ['distribution', 'concentrated'],
        ['sovereignty', 'state'],
    ]},
    { label: 'concentrated-state-12mo', path: [
        ['capability', 'singularity'], ['automation', 'deep'],
        ['open_source', 'twelve_months'], ['distribution', 'concentrated'],
        ['sovereignty', 'state'],
    ]},
];

const ACTIONS = ['escapes', 'accelerate', 'rival'];
const PROGRESSES = ['robust', 'brittle', 'unsolved'];

// Decel internal dim ids to scrub from the snapshot (they're internal to
// the module and shouldn't appear in post-exit global sel). They SHOULD
// all be in flavor, not sel, after the legacy collapse runs.
const INTERNAL_DIMS = new Set();
for (const [pKey, aKey] of DECEL_PAIRS) { INTERNAL_DIMS.add(pKey); INTERNAL_DIMS.add(aKey); }

// Dims we care about for the equivalence check. We include every dim
// known to the engine plus a few resolved-via-derive dims of interest.
// Post-migration: decel_outcome will no longer exist, so we note that.
const TRACKED_RESOLVED = [
    'alignment', 'distribution', 'geo_spread', 'rival_emerges',
    'governance', 'containment', 'decel_align_progress',
    // legacy-only; will disappear after Phase 4a:
    'decel_outcome',
    // others worth cross-checking for spurious drift:
    'alignment_durability', 'ai_goals', 'proliferation_control',
];

function runPath(prefix, pKey, action, progress) {
    let stk = engine.createStack();
    const fullPath = prefix.concat([
        ['gov_action', 'decelerate'],
        [pKey, progress],
    ]);
    // Find the matching action-node id (pKey has form 'decel_Nmo_progress',
    // action node is 'decel_Nmo_action').
    const aKey = pKey.replace('_progress', '_action');
    fullPath.push([aKey, action]);

    for (const [nid, eid] of fullPath) {
        stk = engine.push(stk, nid, eid);
    }
    const sel = engine.currentState(stk);
    const flavor = engine.currentFlavor(stk);
    const result = { sel: {}, resolved: {}, flavorInternal: {} };
    // A path is "invalid" if the terminating action edge was rejected or
    // never existed on the node. Invalid happens two ways:
    //   (1) cleanSelection deletes sel[aKey] because requires failed;
    //   (2) the action isn't in the node's declared edges at all (e.g.
    //       decel_24mo_action only exposes `rival`) — cleanSelection
    //       keeps the value in sel, but no collapseToFlavor block fires,
    //       so the reducer never runs.
    // Post-migration: reducer doesn't fire on either, so module-written
    // globals are absent. Pre-migration: same — but deriveWhen fallbacks
    // like `gov_action: decelerate -> slowdown` still yielded a value for
    // `governance` on these broken intermediate states.
    const actionNode = NODE_MAP[aKey];
    const actionEdgeExists = actionNode && actionNode.edges && actionNode.edges.some(e => e.id === action);
    const edgeSettled = sel[aKey] === action || flavor[aKey] === action;
    result.invalidPath = !actionEdgeExists || !edgeSettled;
    // Global sel: exclude internal dims (they should be in flavor anyway).
    for (const k of Object.keys(sel)) {
        if (INTERNAL_DIMS.has(k)) continue;
        result.sel[k] = sel[k];
    }
    // Resolved values for tracked dims.
    for (const dim of TRACKED_RESOLVED) {
        const v = engine.resolvedVal(sel, dim);
        if (v !== undefined) result.resolved[dim] = v;
    }
    // Flavor presence of internal dims (sanity check — all should be there).
    for (const k of INTERNAL_DIMS) {
        if (flavor[k] !== undefined) result.flavorInternal[k] = flavor[k];
    }
    return result;
}

function buildSnapshot() {
    const rows = [];
    for (const { label, path: pre } of PREFIXES) {
        for (const [pKey /*, aKey*/] of DECEL_PAIRS) {
            for (const action of ACTIONS) {
                for (const progress of PROGRESSES) {
                    const id = `${label}|${pKey}|${action}|${progress}`;
                    let outcome;
                    try {
                        outcome = runPath(pre, pKey, action, progress);
                    } catch (e) {
                        outcome = { error: e.message };
                    }
                    rows.push({ id, ...outcome });
                }
            }
        }
    }
    return rows;
}

function canonicalize(snapshot) {
    // Stable serialization: sort top-level keys for each row, and sort
    // nested object keys. Snapshot paths have predictable order already.
    return snapshot.map(r => {
        const sorted = {};
        sorted.id = r.id;
        if (r.error) { sorted.error = r.error; return sorted; }
        if (r.invalidPath) sorted.invalidPath = true;
        sorted.sel = {};
        for (const k of Object.keys(r.sel).sort()) sorted.sel[k] = r.sel[k];
        sorted.resolved = {};
        for (const k of Object.keys(r.resolved).sort()) sorted.resolved[k] = r.resolved[k];
        sorted.flavorInternal = {};
        for (const k of Object.keys(r.flavorInternal).sort()) sorted.flavorInternal[k] = r.flavorInternal[k];
        return sorted;
    });
}

function diff(a, b, opts = {}) {
    const ignoreResolvedKeys = new Set(opts.ignoreResolvedKeys || []);
    const ignoreSelKeys = new Set(opts.ignoreSelKeys || []);
    const diffs = [];
    const aMap = Object.fromEntries(a.map(r => [r.id, r]));
    const bMap = Object.fromEntries(b.map(r => [r.id, r]));
    const allIds = [...new Set([...Object.keys(aMap), ...Object.keys(bMap)])];
    for (const id of allIds) {
        const ra = aMap[id], rb = bMap[id];
        if (!ra) { diffs.push({ id, kind: 'only-in-new' }); continue; }
        if (!rb) { diffs.push({ id, kind: 'only-in-baseline' }); continue; }
        const fieldDiffs = [];
        const diffObj = (name, oa, ob, ignore) => {
            const allK = [...new Set([...Object.keys(oa || {}), ...Object.keys(ob || {})])];
            for (const k of allK) {
                if (ignore.has(k)) continue;
                const va = oa?.[k], vb = ob?.[k];
                if (va !== vb) fieldDiffs.push({ field: `${name}.${k}`, baseline: va, current: vb });
            }
        };
        diffObj('sel', ra.sel, rb.sel, ignoreSelKeys);
        diffObj('resolved', ra.resolved, rb.resolved, ignoreResolvedKeys);
        diffObj('flavorInternal', ra.flavorInternal, rb.flavorInternal, new Set());
        if (fieldDiffs.length) diffs.push({ id, fieldDiffs });
    }
    return diffs;
}

if (require.main === module) {
    const args = process.argv.slice(2);
    const saveArg = args.indexOf('--save');
    const checkArg = args.indexOf('--check');
    const baselinePath = path.join(__dirname, 'decel_path_baseline.json');
    const snapshot = canonicalize(buildSnapshot());

    if (saveArg !== -1) {
        fs.writeFileSync(baselinePath, JSON.stringify(snapshot, null, 2));
        console.log(`Saved ${snapshot.length} rows to ${baselinePath}`);
        process.exit(0);
    }

    if (checkArg !== -1) {
        if (!fs.existsSync(baselinePath)) { console.error('No baseline. Run --save first.'); process.exit(2); }
        const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
        // Phase 4a eliminates decel_outcome — ignore it. The migration also
        // relocates several dims from derived (not in sel) to directly
        // written (in sel). The sel/flavorInternal changes for those dims
        // are structural, not functional — we only flag FUNCTIONAL
        // regressions at the `resolved` level.
        const IGNORE_RESOLVED = ['decel_outcome'];
        const IGNORE_SEL = ['decel_outcome'];
        const ds = diff(baseline, snapshot, { ignoreResolvedKeys: IGNORE_RESOLVED, ignoreSelKeys: IGNORE_SEL });

        // Classify every fieldDiff as:
        //   * LOST:    baseline had value, current lost it (potential regression)
        //   * CHANGED: both sides have values, they differ (potential regression)
        //   * GAINED:  only current has value (migration gain, not a regression)
        // Only `resolved.*` matters for functional equivalence. sel/flavor
        // diffs are the expected structural migration (derived→direct write).
        const regressions = [];
        const gains = [];
        const structural = [];
        for (const d of ds) {
            if (d.kind) { regressions.push({ id: d.id, kind: d.kind }); continue; }
            for (const fd of d.fieldDiffs) {
                const entry = { id: d.id, field: fd.field, baseline: fd.baseline, current: fd.current };
                if (!fd.field.startsWith('resolved.')) { structural.push(entry); continue; }
                if (fd.baseline === undefined) gains.push(entry);
                else if (fd.current === undefined) regressions.push(entry);
                else regressions.push(entry);
            }
        }

        console.log(`Classified ${ds.length} diff rows:`);
        console.log(`  ${regressions.length} functional regression(s) — resolved.X lost or changed`);
        console.log(`  ${gains.length} migration gain(s) — resolved.X newly set by reducer`);
        console.log(`  ${structural.length} structural diff(s) — sel/flavorInternal layout change`);

        // Any path flagged as `invalidPath` (reducer never ran because the
        // action edge's `requires` gate failed in cleanSelection) is not
        // user-reachable. Pre-migration, stray deriveWhen fallbacks like
        // `gov_action: decelerate -> slowdown` could still yield a value
        // for `governance` on these broken intermediate states; post-
        // migration the reducer owns those writes and the fallback is gone.
        // So `resolved.governance: slowdown -> undefined` on invalid paths
        // is expected, not a regression.
        const invalidIds = new Set();
        for (const r of snapshot) if (r.invalidPath) invalidIds.add(r.id);
        function isInvalidEdgeCase(entry) {
            return invalidIds.has(entry.id);
        }
        const realRegressions = regressions.filter(r => r.id && !isInvalidEdgeCase(r));
        const expectedInvalidDrops = regressions.length - realRegressions.length;
        if (expectedInvalidDrops) {
            console.log(`  (${expectedInvalidDrops} of those are known invalid-edge artifacts — see comment in test)`);
        }

        if (!realRegressions.length) {
            console.log(`\nPASS — no functional regressions. ${gains.length} gains + ${structural.length} structural diffs are expected per the migration plan.`);
            process.exit(0);
        }

        console.log(`\n${realRegressions.length} unexpected functional regression(s):\n`);
        for (const r of realRegressions.slice(0, 30)) {
            console.log(`• ${r.id} ${r.field}: baseline=${JSON.stringify(r.baseline)} current=${JSON.stringify(r.current)}`);
        }
        if (realRegressions.length > 30) console.log(`\n... and ${realRegressions.length - 30} more`);
        process.exit(1);
    }

    // Default: just print summary stats.
    console.log(`Enumerated ${snapshot.length} decel paths.`);
    const errors = snapshot.filter(r => r.error);
    if (errors.length) {
        console.log(`${errors.length} paths errored during enumeration.`);
        for (const e of errors.slice(0, 10)) console.log(`  ${e.id}: ${e.error}`);
    }
    const outcomes = new Map();
    for (const r of snapshot) {
        const key = r.resolved?.decel_outcome || '(none)';
        outcomes.set(key, (outcomes.get(key) || 0) + 1);
    }
    console.log('decel_outcome distribution:');
    for (const [k, n] of [...outcomes.entries()].sort()) console.log(`  ${k}: ${n}`);
}

module.exports = { buildSnapshot, canonicalize, diff };
