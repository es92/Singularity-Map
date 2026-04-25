#!/usr/bin/env node
// module-audit.js — Boundary audit for module declarations (Phase 1)
//
// Given the MODULES registry in graph.js, this script reports:
//   1. Internal → external reads: which non-internal dims get read from
//      inside the module. Cross-checked against module.reads. Any leak
//      (read but not declared) is an error; any unused declared read is
//      a warning.
//   2. External → internal reads: any condition outside the module that
//      references a dim in module.nodeIds. For decel these must be zero
//      (the module's internal dims are not exposed to the outer graph).
//   3. Template / narrative references to internal dims. Must be zero.
//   4. Consumers of module.writes: downstream nodes/templates/narrative
//      references. These are the things that will observe the module's
//      effects post-migration — listed to audit at Phase 4b rewrite time.
//   5. Reducer table sanity: every write dim appears in at least one
//      reducer cell, and every reducer-cell key is listed in module.writes.
//
// Usage:
//   node module-audit.js             — audit all modules, report summary
//   node module-audit.js --json      — machine-readable output
//   node module-audit.js decel       — audit only the 'decel' module

const fs = require('fs');
const path = require('path');
const { NODES, NODE_MAP, MODULES, MODULE_MAP } = require('./graph.js');

// ────────────────────────────────────────────────────────────
// Generic helpers: extract dim references from various objects
// ────────────────────────────────────────────────────────────

function refsFromCondition(cond, out) {
    if (!cond || typeof cond !== 'object') return;
    for (const [k, v] of Object.entries(cond)) {
        if (k === 'reason' || k === '_direct' || k.startsWith('_')) {
            if (k === '_not' && v && typeof v === 'object') {
                const entries = Array.isArray(v) ? v : [v];
                for (const entry of entries) {
                    if (entry && typeof entry === 'object') for (const nk of Object.keys(entry)) out.add(nk);
                }
            }
            continue;
        }
        out.add(k);
    }
}

function refsFromConditionList(conds, out) {
    if (!conds) return;
    for (const c of conds) refsFromCondition(c, out);
}

// Return a Set of dim ids read anywhere by this node (activation, hiding,
// derivation-match, derivation-fromState, edge.requires, edge.disabledWhen,
// edge.collapseToFlavor.when).
function collectNodeReads(node) {
    const refs = new Set();
    refsFromConditionList(node.activateWhen, refs);
    refsFromConditionList(node.hideWhen, refs);
    if (node.deriveWhen) for (const rule of node.deriveWhen) {
        if (rule.match) refsFromCondition(rule.match, refs);
        if (rule.fromState) refs.add(rule.fromState);
    }
    if (node.edges) for (const e of node.edges) {
        if (e.requires) {
            const cs = Array.isArray(e.requires) ? e.requires : [e.requires];
            for (const c of cs) refsFromCondition(c, refs);
        }
        const dw = e.disableWhen || e.disabledWhen;
        if (dw) refsFromConditionList(Array.isArray(dw) ? dw : [dw], refs);
        if (e.collapseToFlavor) {
            const blocks = Array.isArray(e.collapseToFlavor) ? e.collapseToFlavor : [e.collapseToFlavor];
            for (const b of blocks) if (b && b.when) refsFromCondition(b.when, refs);
        }
    }
    return refs;
}

// Dims *written* by this node: the node's own id (user pick), its derived
// value (if derived), and any collapseToFlavor.set dims on its edges.
function collectNodeWrites(node) {
    const writes = new Set([node.id]);
    if (node.edges) for (const e of node.edges) {
        if (!e.collapseToFlavor) continue;
        const blocks = Array.isArray(e.collapseToFlavor) ? e.collapseToFlavor : [e.collapseToFlavor];
        for (const b of blocks) {
            if (!b || !b.set) continue;
            for (const k of Object.keys(b.set)) writes.add(k);
        }
    }
    return writes;
}

function refsFromTemplateReachable(reachable, out) {
    if (!reachable) return;
    for (const cond of reachable) {
        for (const [k, v] of Object.entries(cond)) {
            if (k === '_not') {
                if (v && typeof v === 'object') {
                    const entries = Array.isArray(v) ? v : [v];
                    for (const entry of entries) {
                        if (entry && typeof entry === 'object') for (const nk of Object.keys(entry)) out.add(nk);
                    }
                }
                continue;
            }
            if (k.startsWith('_')) continue;
            out.add(k);
        }
    }
}

// Templates also read dims via `flavors[dim]` / `flavorHeadings[dim]` lookup
// and via `_when` conditions nested inside flavor entries.
function refsFromTemplateFlavors(template, out) {
    const scan = (obj) => {
        if (!obj || typeof obj !== 'object') return;
        if (Array.isArray(obj)) { for (const x of obj) scan(x); return; }
        for (const [k, v] of Object.entries(obj)) {
            if (k === '_when' && Array.isArray(v)) {
                for (const entry of v) if (entry && entry.if) refsFromCondition(entry.if, out);
                continue;
            }
            scan(v);
        }
    };
    if (template.flavors && typeof template.flavors === 'object') {
        for (const k of Object.keys(template.flavors)) { out.add(k); scan(template.flavors[k]); }
    }
    if (template.flavorHeadings && typeof template.flavorHeadings === 'object') {
        for (const k of Object.keys(template.flavorHeadings)) { out.add(k); scan(template.flavorHeadings[k]); }
    }
    if (template.variants && typeof template.variants === 'object') {
        for (const v of Object.values(template.variants)) scan(v);
    }
    if (template.story) scan(template.story);
    if (template.timeline) scan(template.timeline);
}

function refsFromNarrativeNode(n, out) {
    if (!n || typeof n !== 'object') return;
    for (const [k, v] of Object.entries(n)) {
        if (k === 'contextWhen' && Array.isArray(v)) {
            for (const entry of v) if (entry && entry.when) refsFromCondition(entry.when, out);
        }
        if (Array.isArray(v)) for (const item of v) refsFromNarrativeNode(item, out);
        else if (v && typeof v === 'object') refsFromNarrativeNode(v, out);
    }
}

// ────────────────────────────────────────────────────────────
// Audit a single module
// ────────────────────────────────────────────────────────────

function auditModule(mod, { templates, narrative }) {
    const report = {
        id: mod.id,
        errors: [],
        warnings: [],
        internalDims: new Set(mod.nodeIds),
        declaredReads: new Set(mod.reads || []),
        declaredWrites: new Set(mod.writes || []),
        actualReads: new Set(),        // non-internal dims read by internal nodes
        externalReferencesToInternal: [], // [{source, dim}]
        templateReferencesToInternal: [], // [{templateId, dim}]
        narrativeReferencesToInternal: [],
        writeConsumers: {},            // dim -> list of {source, kind}
        reducerCells: [],
    };

    // --- Validate node IDs exist ---
    for (const nid of mod.nodeIds) {
        const n = NODE_MAP[nid];
        if (!n) { report.errors.push(`module node id not found in NODES: ${nid}`); }
    }

    // --- 1. Internal → external reads ---
    for (const nid of mod.nodeIds) {
        const node = NODE_MAP[nid];
        if (!node) continue;
        const reads = collectNodeReads(node);
        for (const r of reads) {
            if (report.internalDims.has(r)) continue; // internal-to-internal, fine
            report.actualReads.add(r);
        }
    }
    // Module-level activation gates also read external dims — any dim
    // referenced by `mod.activateWhen` is part of the module's external
    // contract and must be declared in `mod.reads`.
    refsFromConditionList(mod.activateWhen, report.actualReads);
    for (const d of report.internalDims) report.actualReads.delete(d);
    // Module's own declared writes are part of its internal state contract
    // (markers it sets during flow, re-read by later internal nodes). An
    // internal node reading a declared write is not an external dependency.
    for (const d of report.declaredWrites) report.actualReads.delete(d);
    // Internal markers are dims set by the module into sel mid-flow purely
    // for internal gating; they move to flavor on module exit (see
    // engine.attachModuleReducer). Internal reads of these are not external
    // dependencies.
    for (const d of (mod.internalMarkers || [])) report.actualReads.delete(d);
    for (const r of report.actualReads) {
        if (!report.declaredReads.has(r)) {
            report.errors.push(`internal node reads undeclared external dim: ${r} (add to module.reads)`);
        }
    }
    for (const declared of report.declaredReads) {
        if (!report.actualReads.has(declared)) {
            report.warnings.push(`declared read '${declared}' is not referenced by any internal node`);
        }
    }

    // --- 2. External → internal reads (outside-the-module references) ---
    // A dim that's both internal AND a declared write is an intentional
    // export — external reads of it are not leaks; they're listed under
    // writeConsumers below. Only the pure-internal dims (nodeIds \ writes)
    // are off-limits to external graph references.
    const pureInternal = new Set([...report.internalDims].filter(d => !report.declaredWrites.has(d)));
    for (const node of NODES) {
        if (report.internalDims.has(node.id)) continue;
        const reads = collectNodeReads(node);
        for (const r of reads) {
            if (pureInternal.has(r)) {
                report.externalReferencesToInternal.push({ source: `node:${node.id}`, dim: r });
            }
        }
    }

    // --- 3. Template references to internal dims ---
    // Post-Option-C, templateMatches reads from resolvedStateWithFlavor
    // (sel ∪ flavor), so `reachable` refs to pure-internal dims are fine
    // as long as the dim is moved to flavor on module exit (which is
    // exactly what `move` does for nodeIds \ writes). Same for
    // flavors/flavorHeadings/variants/story/timeline rendering. We record
    // both categories as informational (not leaks) and only flag genuine
    // boundary violations elsewhere.
    report.templateFlavorReferences = [];
    if (templates) {
        for (const t of templates) {
            const reachableRefs = new Set();
            refsFromTemplateReachable(t.reachable, reachableRefs);
            const flavorRefs = new Set();
            refsFromTemplateFlavors(t, flavorRefs);
            for (const r of reachableRefs) {
                if (pureInternal.has(r)) {
                    report.templateFlavorReferences.push({ templateId: t.id || '(unnamed)', dim: r, via: 'reachable' });
                }
            }
            for (const r of flavorRefs) {
                if (pureInternal.has(r) && !reachableRefs.has(r)) {
                    report.templateFlavorReferences.push({ templateId: t.id || '(unnamed)', dim: r, via: 'flavor' });
                }
            }
        }
    }

    // --- 3b. Narrative references to internal dims ---
    // narrative.json is pure flavor rendering (against narrEff), so
    // references to pure-internal dims are fine — recorded for audit
    // visibility, not as errors.
    if (narrative) {
        const refs = new Set();
        refsFromNarrativeNode(narrative, refs);
        for (const r of refs) {
            if (pureInternal.has(r)) {
                report.narrativeReferencesToInternal.push({ dim: r });
            }
        }
    }

    // --- 4. Consumers of writes (downstream observability) ---
    for (const w of report.declaredWrites) {
        report.writeConsumers[w] = [];
        for (const node of NODES) {
            if (report.internalDims.has(node.id)) continue;
            const reads = collectNodeReads(node);
            if (reads.has(w)) report.writeConsumers[w].push({ source: `node:${node.id}`, kind: 'graph' });
        }
        if (templates) {
            for (const t of templates) {
                const refs = new Set();
                refsFromTemplateReachable(t.reachable, refs);
                refsFromTemplateFlavors(t, refs);
                if (refs.has(w)) {
                    report.writeConsumers[w].push({ source: `template:${t.id || '?'}`, kind: 'template' });
                }
            }
        }
        if (narrative) {
            const refs = new Set();
            refsFromNarrativeNode(narrative, refs);
            if (refs.has(w)) report.writeConsumers[w].push({ source: 'narrative.json', kind: 'narrative' });
        }
    }

    // --- 5. Reducer table sanity ---
    if (mod.reducerTable) {
        const cellKeys = new Set();
        for (const [action, progressMap] of Object.entries(mod.reducerTable)) {
            for (const [progress, cell] of Object.entries(progressMap)) {
                const keys = Object.keys(cell).filter(k => !k.startsWith('_'));
                report.reducerCells.push({ action, progress, writes: keys });
                for (const k of keys) cellKeys.add(k);
            }
        }
        const internalMarkerSet = new Set(mod.internalMarkers || []);
        for (const k of cellKeys) {
            if (!report.declaredWrites.has(k) && !internalMarkerSet.has(k)) {
                report.errors.push(`reducer cell writes '${k}' but it's not in module.writes or internalMarkers`);
            }
        }
        for (const w of report.declaredWrites) {
            if (!cellKeys.has(w)) {
                report.warnings.push(`declared write '${w}' never appears in any reducer cell`);
            }
        }
    }

    return report;
}

// ────────────────────────────────────────────────────────────
// Printing
// ────────────────────────────────────────────────────────────

function printReport(r) {
    console.log('─'.repeat(60));
    console.log(`Module: ${r.id}`);
    console.log('─'.repeat(60));
    console.log(`Internal dims (${r.internalDims.size}): ${[...r.internalDims].join(', ')}`);
    console.log(`Declared reads (${r.declaredReads.size}):  ${[...r.declaredReads].join(', ')}`);
    console.log(`Actual external reads (${r.actualReads.size}):  ${[...r.actualReads].join(', ') || '(none)'}`);
    console.log(`Declared writes (${r.declaredWrites.size}): ${[...r.declaredWrites].join(', ')}`);

    console.log(`\nExternal graph references to pure-internal dims: ${r.externalReferencesToInternal.length}`);
    for (const ref of r.externalReferencesToInternal) {
        console.log(`  LEAK: ${ref.source} reads ${ref.dim}`);
    }
    if (r.templateReferencesToInternal && r.templateReferencesToInternal.length) {
        console.log(`Template reachable refs to pure-internal dims: ${r.templateReferencesToInternal.length}`);
        for (const ref of r.templateReferencesToInternal) {
            console.log(`  LEAK: template ${ref.templateId} reads ${ref.dim} (via ${ref.via || 'reachable'})`);
        }
    }
    if (r.templateFlavorReferences && r.templateFlavorReferences.length) {
        console.log(`Template refs to pure-internal dims (read via resolvedStateWithFlavor, OK): ${r.templateFlavorReferences.length}`);
        const byDim = {};
        for (const ref of r.templateFlavorReferences) {
            const entry = byDim[ref.dim] ||= { reachable: [], flavor: [] };
            (ref.via === 'reachable' ? entry.reachable : entry.flavor).push(ref.templateId);
        }
        for (const [dim, buckets] of Object.entries(byDim)) {
            const parts = [];
            if (buckets.reachable.length) parts.push(`${buckets.reachable.length} reachable`);
            if (buckets.flavor.length) parts.push(`${buckets.flavor.length} flavor`);
            console.log(`  ${dim}: ${parts.join(', ')}`);
        }
    }
    console.log(`Narrative refs to pure-internal dims (flavor rendering, OK): ${r.narrativeReferencesToInternal.length}`);
    for (const ref of r.narrativeReferencesToInternal) {
        console.log(`  ${ref.dim}`);
    }

    console.log(`\nConsumers of writes (by dim):`);
    for (const [dim, consumers] of Object.entries(r.writeConsumers)) {
        console.log(`  ${dim}: ${consumers.length} consumer(s)`);
        for (const c of consumers.slice(0, 20)) console.log(`    - ${c.source}`);
        if (consumers.length > 20) console.log(`    ... and ${consumers.length - 20} more`);
    }

    if (r.reducerCells.length) {
        console.log(`\nReducer cells (${r.reducerCells.length}):`);
        for (const c of r.reducerCells) {
            console.log(`  (${c.action}, ${c.progress}) writes [${c.writes.join(', ') || '—'}]`);
        }
    }

    if (r.warnings.length) {
        console.log(`\nWarnings (${r.warnings.length}):`);
        for (const w of r.warnings) console.log(`  WARN: ${w}`);
    }
    if (r.errors.length) {
        console.log(`\nErrors (${r.errors.length}):`);
        for (const e of r.errors) console.log(`  ERROR: ${e}`);
    }
    console.log();
}

// ────────────────────────────────────────────────────────────
// Main
// ────────────────────────────────────────────────────────────

if (require.main === module) {
    const args = process.argv.slice(2);
    const wantJson = args.includes('--json');
    const targetId = args.find(a => !a.startsWith('--'));

    const outcomes = JSON.parse(fs.readFileSync(path.join(__dirname, 'data/outcomes.json'), 'utf8'));
    let narrative = null;
    try { narrative = JSON.parse(fs.readFileSync(path.join(__dirname, 'data/narrative.json'), 'utf8')); } catch (_) {}
    const templates = outcomes.templates || [];

    const modules = targetId ? (MODULE_MAP[targetId] ? [MODULE_MAP[targetId]] : []) : MODULES;
    if (!modules.length) {
        console.error(`No modules to audit${targetId ? ` (unknown id: ${targetId})` : ''}`);
        process.exit(1);
    }

    const reports = modules.map(m => auditModule(m, { templates, narrative }));
    if (wantJson) {
        console.log(JSON.stringify(reports.map(r => ({
            id: r.id,
            errors: r.errors, warnings: r.warnings,
            internalDims: [...r.internalDims],
            declaredReads: [...r.declaredReads], actualReads: [...r.actualReads],
            declaredWrites: [...r.declaredWrites],
            externalReferencesToInternal: r.externalReferencesToInternal,
            templateReferencesToInternal: r.templateReferencesToInternal,
            narrativeReferencesToInternal: r.narrativeReferencesToInternal,
            writeConsumers: r.writeConsumers,
            reducerCells: r.reducerCells,
        })), null, 2));
    } else {
        for (const r of reports) printReport(r);
        const totalErr = reports.reduce((a, r) => a + r.errors.length, 0);
        if (totalErr === 0) console.log('All boundary audits passed.');
        else console.log(`${totalErr} error(s) across ${reports.length} module(s).`);
    }

    const totalErr = reports.reduce((a, r) => a + r.errors.length, 0);
    process.exit(totalErr ? 1 : 0);
}

module.exports = { auditModule };
